import { buildOf, CHANNEL_NAMES, channelOf, DEFAULT_PROFILE, hasSaves, profileSaveDir, saveFiles, slotOf, type EngineInfo, type EngineVariant } from './channels.js'
import { CHARACTER_BUILD } from './saves.js'
import { PART_BYTES, selectVariant, validateManifest } from './manifest.js'
import type { OfflineChannel, PreparedGame } from './server.js'

export const ENGINE_CACHE = 'orbrun-engine'
const RECORD = 'orbrun.engine.installed.'
const LEGACY = 'orbrun.engine.legacy.'
type FileEntry = EngineInfo['files'][number]

export interface EngineStoreOptions {
  base: string
  caches?: CacheStorage
  fetch?: typeof fetch
  variant(): Promise<EngineVariant>
  shellReady(): Promise<boolean>
  checkSaveStorage(): Promise<void>
  storage(): Storage
  locks(): LockManager
  profileDirs?(profile: string): Promise<string[]>
  saves?(dir: string): Promise<string[] | null>
}

export class EngineStore {
  private published = new Map<string, EngineInfo>()
  private installed: EngineInfo[] = []
  private verified = new Set<string>()
  private listeners = new Set<() => void>()
  private checking?: Promise<void>
  private progress = new Map<string, number>()
  private failures = new Map<string, string>()
  private readonly fetch: typeof fetch

  constructor(private readonly o: EngineStoreOptions) {
    this.fetch = o.fetch ?? ((...args) => fetch(...args))
  }

  onChange(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private changed() { for (const fn of this.listeners) fn() }

  private records(prefix: string): EngineInfo[] {
    const store = this.o.storage()
    return Object.keys(store).filter(k => k.startsWith(prefix)).map(k => JSON.parse(store.getItem(k)!) as EngineInfo)
  }

  private read(key: string): EngineInfo | null {
    return JSON.parse(this.o.storage().getItem(key) ?? 'null') as EngineInfo | null
  }

  private async cache() {
    if (!this.o.caches) throw new Error('Allow browser storage to install offline games.')
    return this.o.caches.open(ENGINE_CACHE)
  }

  refresh(): Promise<void> {
    return this.checking ??= this.discover().finally(() => { this.checking = undefined; this.changed() })
  }

  private async discover() {
    const cache = await this.cache()
    const variant = await this.o.variant()
    const legacy = await cache.match(this.o.base + 'device.json')
    if (legacy) {
      const state = await legacy.json() as { installed?: Record<string, EngineInfo> }
      for (const [slot, info] of Object.entries(state.installed ?? {}))
        if (!this.read(LEGACY + slot)) this.o.storage().setItem(LEGACY + slot, JSON.stringify(info))
      await cache.delete(this.o.base + 'device.json')
    }
    // Local catalog first: reconnect checks must never hold an installed game hostage.
    const shell = await this.o.shellReady()
    this.installed = this.records(RECORD)
    this.verified.clear()
    for (const info of this.installed) {
      if (shell && await this.complete(cache, info)) this.verified.add(buildOf(info))
    }
    this.changed()
    await Promise.all(CHANNEL_NAMES.map(async channel => {
      try {
        const res = await this.fetch(this.o.base + channel + '/engine.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
        if (!res.ok) throw new Error('Download unavailable.')
        const info = await res.json() as EngineInfo
        validateManifest(info, channel)
        this.published.set(channel, selectVariant(info, variant))
        this.failures.delete(channel)
      } catch {
        this.failures.set(channel, 'Connect to check for a downloadable build.')
      }
    }))
  }

  async channels(profile = DEFAULT_PROFILE): Promise<OfflineChannel[]> {
    const slots = new Map(this.records(RECORD).map(info => [slotOf(info), info]))
    for (const info of [...this.records(CHARACTER_BUILD), ...this.records(LEGACY)]) {
      const slot = slotOf(info)
      if (slots.has(slot)) continue
      const dir = profileSaveDir(channelOf(info).saveDir, profile)
      const pin = this.read(CHARACTER_BUILD + dir)
      if (pin) slots.set(slot, pin)
      else if (this.read(LEGACY + slot) && (await this.saveFiles(dir))?.length) slots.set(slot, info)
    }
    return Array.from(slots.values(), channelOf)
  }

  private saveFiles(dir: string) {
    return this.o.saves ? this.o.saves(dir) : saveFiles(indexedDB, dir)
  }

  async unidentifiedSlots(profile: string): Promise<string[]> {
    const unknown: string[] = []
    for (const dir of await this.o.profileDirs?.(profile) ?? []) {
      const slot = /^\/crawl-(trunk|\d+\.\d+)(?:~|$)/.exec(dir)?.[1]
      if (!slot || this.read(CHARACTER_BUILD + dir) || this.read(LEGACY + slot)) continue
      if ((await this.saveFiles(dir))?.length) unknown.push(slot)
    }
    return unknown
  }

  offer(channel: string) {
    const installed = this.installed.find(info => info.channel === channel)
    const info = this.published.get(channel) ?? installed
    return { info, installed, bytes: info?.files.reduce((n, f) => n + f[1], 0) ?? 0,
      ready: !!installed && this.verified.has(buildOf(installed)), progress: this.progress.get(channel), error: this.failures.get(channel) }
  }

  engineBase(c: OfflineChannel) { return this.o.base + 'builds/' + (c.build ?? c.commit) + '/' }

  async install(channel: string) {
    if (this.progress.has(channel)) return
    this.progress.set(channel, 0)
    this.failures.delete(channel)
    this.changed()
    try {
      const { info, installed } = this.offer(channel)
      if (!info) throw new Error('Connect to download this channel.')
      if (!await this.o.shellReady()) throw new Error('The app is still preparing offline storage. Reload while connected and retry.')
      await this.o.checkSaveStorage()
      await this.o.locks().request('orbrun.engine.catalog', async () => {
        const latest = this.records(RECORD).find(record => record.channel === channel)
        if (latest && latest.build !== installed?.build && latest.build !== info.build) {
          await this.refresh()
          throw new Error('Another tab updated this channel. Review the installed version and retry.')
        }
        const cache = await this.cache()
        await this.ensure(cache, info, pct => { this.progress.set(channel, pct); this.changed() })
        this.o.storage().setItem(RECORD + slotOf(info), JSON.stringify(info))
        for (const old of this.records(RECORD)) {
          if (old.channel === info.channel && slotOf(old) !== slotOf(info)) {
            this.o.storage().removeItem(RECORD + slotOf(old))
          }
        }
        this.installed = this.records(RECORD)
        this.verified.add(buildOf(info))
        await this.prune(cache)
      })
    } catch (err) {
      let message = 'Could not install this channel. Retry while connected.'
      if (err instanceof Error) {
        if (err.name === 'QuotaExceededError') message = 'Storage is full. Free space and retry.'
        else if (!(err instanceof TypeError) && err.name !== 'TimeoutError') message = err.message
      }
      this.failures.set(channel, message)
    } finally { this.progress.delete(channel); this.changed() }
  }

  private async complete(cache: Cache, info: EngineInfo) {
    for (const [path,,digest] of info.files) {
      const hit = await cache.match(this.o.base + path)
      if (!hit || hit.headers.get('X-Engine-Digest') !== digest) return false
    }
    return true
  }

  private async ensure(cache: Cache, info: EngineInfo, report?: (percent: number) => void) {
    const total = info.files.reduce((n, f) => n + f[1], 0)
    let done = 0
    for (const file of info.files) {
      const [path, size, digest] = file
      const url = this.o.base + path
      const hit = await cache.match(url)
      if (!hit || !digest || hit.headers.get('X-Engine-Digest') !== digest) await this.download(cache, file)
      done += size
      report?.(Math.floor(done * 100 / total))
    }
  }

  private async download(cache: Cache, [path, size, digest]: FileEntry) {
    const url = this.o.base + path
    const pieces: ArrayBuffer[] = []
    const count = Math.max(1, Math.ceil(size / PART_BYTES))
    for (let i = 0; i < count; i++) {
      const response = await this.fetch(count === 1 ? url : url + '.part' + i, { cache: 'reload', headers: { 'X-Orbrun-Install': '1' }, signal: AbortSignal.timeout(90000) })
      if (response.status !== 200) throw new Error('This exact engine build is unavailable. Your character is kept on this device.')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== Math.min(PART_BYTES, size - i * PART_BYTES)) throw new Error('Incomplete engine file. Retry the download.')
      pieces.push(bytes)
    }
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.wasm') ? 'application/wasm' :
      path.endsWith('.json') ? 'application/json' : path.endsWith('.png') ? 'image/png' : 'application/octet-stream'
    const body = new Blob(pieces, { type })
    const hash = await crypto.subtle.digest('SHA-256', await body.arrayBuffer())
    if (Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('') !== digest)
      throw new Error('Engine verification failed. Retry the download.')
    await cache.put(url, new Response(body, { headers: { 'Content-Type': type, 'X-Engine-Digest': digest! } }))
  }

  private async prune(cache: Cache) {
    for (const legacy of this.records(LEGACY)) {
      // Unmigrated saves have no per-character pin. Only retire a legacy record
      // when IndexedDB can confirm the entire slot is empty.
      const slot = slotOf(legacy)
      if (!await hasSaves(slot).catch(() => true)) this.o.storage().removeItem(LEGACY + slot)
    }
    const keep = new Set([...this.records(RECORD), ...this.records(CHARACTER_BUILD), ...this.records(LEGACY), ...this.published.values()]
      .flatMap(info => info.files.map(([path]) => this.o.base + path)))
    for (const req of await cache.keys()) {
      if ((req.url.startsWith(this.o.base + 'builds/') || req.url.startsWith(this.o.base + 'gamedata/')) && !keep.has(req.url)) await cache.delete(req)
    }
  }

  async prepare(c: OfflineChannel, profile: string): Promise<PreparedGame> {
    const dir = profileSaveDir(c.saveDir, profile)
    let unlock!: () => void
    const held = new Promise<void>(resolve => { unlock = resolve })
    return new Promise((resolve, reject) => {
      const released = this.o.locks().request('orbrun.save.' + dir, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('This character is already open in another tab.')
        if (!await this.o.shellReady()) throw new Error('Reconnect and retry the offline installation to restore the app files.')
        await this.o.checkSaveStorage()
        const info = await this.o.locks().request('orbrun.engine.catalog', () => this.pinBuild(c, dir))
        resolve({
          channel: channelOf(info),
          release: async () => { unlock(); await released },
          ended: () => this.o.storage().removeItem(CHARACTER_BUILD + dir),
        })
        await held
      }).catch(reject)
    })
  }

  /** The slot lock excludes another game. The catalog lock excludes an install pruning this build. */
  private async pinBuild(channel: OfflineChannel, dir: string): Promise<EngineInfo> {
    const slot = channel.id.slice('offline-'.length)
    const files = await this.saveFiles(dir)
    if (!files) throw new Error('Unable to read this character’s saved files.')
    const current = this.read(RECORD + slot)
    let build = files.length ? this.read(CHARACTER_BUILD + dir) : current
    if (!build && files.length) {
      const legacy = this.read(LEGACY + slot)
      if (!legacy) throw new Error('The original build of this character is unknown. Its save has been preserved.')
      build = current && buildOf(legacy) === buildOf(current) ? current : legacy
    }
    build ??= current
    if (!build) throw new Error('Install this channel before playing.')
    const cache = await this.cache()
    if (build.variants) {
      if (!files.length && !await this.complete(cache, build)) {
        throw new Error('This installation is incomplete. Reconnect and repair this channel before starting a character.')
      }
      try { await this.ensure(cache, build) }
      catch (error) {
        if (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')) {
          throw new Error('Reconnect to restore this character’s exact engine build. Its save has been preserved.')
        }
        throw error
      }
    } else {
      const files = await Promise.all(build.files.map(([path]) => cache.match(this.o.base + path)))
      if (await this.o.variant() !== 'jspi' || !files.every(Boolean)) {
        throw new Error('This character needs its original locally installed engine. Its save has been preserved.')
      }
    }
    this.o.storage().setItem(CHARACTER_BUILD + dir, JSON.stringify(build))
    return build
  }
}
