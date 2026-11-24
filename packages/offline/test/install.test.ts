import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EngineStore, channelOf, type EngineInfo } from '../src/index.js'

const base = 'https://local.test/engine/'
function manifest(channel: string, n: string): EngineInfo {
  const commit = n.repeat(40), build = commit + '-' + 'a'.repeat(16)
  const paths = ['crawl.js','crawl.wasm','asyncify/crawl.js','asyncify/crawl.wasm','crawl.data','prewarm/manifest.json','prewarm/prewarm.bin']
    .map(name => 'builds/' + build + '/' + name).concat(['enums.js', ...['wall','floor','icons','feat','player','gui','main'].flatMap(n => [n + '.png', 'tileinfo-' + n + '.js'])]
      .map(name => 'gamedata/' + commit + '/' + name))
  return { channel, commit, build, recipe: 'a'.repeat(16), version: '0.34.1', stamp: '1', gamedata: commit, variants: ['asyncify','jspi'],
    files: paths.map(path => [path, path.length, createHash('sha256').update(path).digest('hex')]) }
}

function fixture() {
  const published = new Map(['stable','trunk'].map((c,i) => [c, manifest(c, String(i+1))]))
  const assets = new Map<string, Response>()
  const store = Object.assign(Object.create(null), {
    getItem(k: string) { return store[k] ?? null },
    setItem(k: string,v: string) { store[k] = v },
    removeItem(k: string) { delete store[k] },
  })
  const cache = {
    match: async (url: string) => assets.get(url)?.clone(),
    keys: async () => [...assets.keys()].map(k => new Request(k)),
    delete: (req: Request | string) => assets.delete(typeof req === 'string' ? req : req.url),
    put: async (url: string, res: Response) => {
      if (state.full) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      assets.set(url, res.clone())
    },
  }
  const held = new Set<string>(), saves = new Set<string>(), fetched: string[] = []
  const state = { online: true, shell: true, full: false, corrupt: '', denied: false }
  const make = (variant: 'asyncify' | 'jspi' = 'asyncify') => new EngineStore({ base, variant: async () => variant, storage: () => store,
    caches: { open: async () => cache } as unknown as CacheStorage,
    locks: () => ({ request: async (key: string, opt: unknown, cb?: (lock: object | null) => Promise<unknown>) => {
      const run = cb ?? opt as typeof cb
      if (held.has(key)) return run!(null)
      held.add(key)
      try { return await run!({}) } finally { held.delete(key) }
    } } as LockManager),
    profileDirs: async () => [...saves], checkSaveStorage: async () => {}, shellReady: async () => state.shell, saves: async dir => state.denied ? null : saves.has(dir) ? ['player.cs'] : [],
    fetch: async input => {
      const path = String(input).slice(base.length)
      fetched.push(path)
      if (!state.online) throw new Error('offline')
      if (path.endsWith('/engine.json')) return Response.json(published.get(path.split('/')[0]))
      if (![...published.values()].some(i => i.files.some(([p]) => p === path))) return new Response(null,{status:404})
      return new Response(path === state.corrupt ? 'x'.repeat(path.length) : path)
    } })
  return { published, assets, saves, fetched, state, make, store }
}

describe('explicit offline installs', () => {
  it('installs only the chosen variant and channel, resumes verified files after corruption and verifies readiness on reopen', async () => {
    const f = fixture(), s = f.make()
    await s.refresh()
    expect(f.fetched.sort()).toEqual(['stable/engine.json','trunk/engine.json'])
    f.state.corrupt = f.published.get('stable')!.files[4][0]
    await s.install('stable')
    expect(s.offer('stable').error).toContain('verification')
    expect(await s.channels()).toEqual([])
    f.state.corrupt = ''
    await s.install('stable')
    expect(s.offer('stable').ready).toBe(true)
    expect(f.fetched.some(p => /^builds\/[^/]+\/crawl.wasm$/.test(p))).toBe(false)
    expect(f.fetched.filter(p => p.endsWith('/asyncify/crawl.wasm'))).toHaveLength(1)
    expect(s.offer('trunk').installed).toBeUndefined()
    f.state.online = false
    const reopened = f.make()
    await reopened.refresh()
    expect(reopened.offer('stable').ready).toBe(true)
    f.state.shell = false
    await reopened.refresh()
    expect(reopened.offer('stable').ready).toBe(false)
    f.state.shell = true
    f.assets.delete(base + f.published.get('stable')!.files[4][0])
    await reopened.refresh()
    expect(reopened.offer('stable').ready).toBe(false)
  })

  it('reports quota failure before offering play', async () => {
    const f = fixture(), s = f.make()
    await s.refresh()
    f.state.full = true
    await s.install('stable')
    expect(s.offer('stable').error).toMatch(/space/)
    expect(await s.channels()).toEqual([])
  })

  it('resumes the pinned build after an update, excludes competing tabs and keeps the pin when the original is lost', async () => {
    const f = fixture(), s = f.make()
    const a = f.published.get('trunk')!, b = manifest('trunk','3')
    await s.refresh()
    await s.install('trunk')
    const slot = channelOf(a)
    const first = await s.prepare(slot,'Player')
    f.saves.add('/crawl-trunk')
    await expect(f.make().prepare(slot,'player')).rejects.toThrow('another tab')
    f.published.set('trunk',b)
    await s.refresh()
    await s.install('trunk')
    const second = await s.prepare(slot,'Sam')
    expect(second.channel.build).toBe(b.build)
    await second.release()
    await first.release()
    const resumed = await f.make().prepare(slot,'Player')
    expect(resumed.channel.build).toBe(a.build)
    expect(resumed.channel.gamedata).toBe(a.gamedata)
    await resumed.release()
    f.assets.delete(base+a.files[4][0])
    await expect(s.prepare(slot,'Player')).rejects.toThrow('exact engine')
    f.published.set('trunk',a)
    const recovered = await s.prepare(slot,'Player')
    expect(recovered.channel.build).toBe(a.build)
    recovered.ended()
    await recovered.release()
    f.saves.clear()
    expect((await s.prepare(slot,'Player')).channel.build).toBe(b.build)
  })
  it('offers an older stable release only to its pinned profile after installing the next release', async () => {
    const f = fixture(), s = f.make()
    const old = f.published.get('stable')!
    await s.refresh()
    await s.install('stable')
    const game = await s.prepare(channelOf(old), 'Sam')
    f.saves.add('/crawl-0.34~sam')
    await game.release()
    f.published.set('stable', { ...manifest('stable', '4'), version: '0.35.0' })
    await s.refresh()
    await s.install('stable')
    expect((await s.channels('Player')).map(c => c.id)).toEqual(['offline-0.35'])
    expect((await s.channels('Sam')).map(c => c.id).sort()).toEqual(['offline-0.34','offline-0.35'])
    expect((await s.prepare(channelOf(old), 'Sam')).channel.build).toBe(old.build)
  })

  it('resumes an identifiable legacy save from its original cached JSPI build', async () => {
    const f = fixture()
    const old = { ...manifest('trunk', '5'), variants: undefined }
    f.saves.add('/crawl-trunk')
    f.assets.set(base + 'device.json', Response.json({ installed: { trunk: old } }))
    for (const [path] of old.files) f.assets.set(base + path, new Response(path))
    const s = f.make('jspi')
    await s.refresh()
    const game = await s.prepare(channelOf(old), 'Player')
    expect(game.channel.build).toBe(old.build)
    await game.release()
    f.assets.delete(base + old.files[0][0])
    await expect(s.prepare(channelOf(old), 'Player')).rejects.toThrow('original locally installed engine')
    expect(f.saves.has('/crawl-trunk')).toBe(true)
  })

  it('refuses an unidentified legacy character or unreadable save database', async () => {
    const f = fixture(), s = f.make(), slot = channelOf(f.published.get('stable')!)
    await s.refresh()
    await s.install('stable')
    f.saves.add('/crawl-0.34')
    expect(await s.unidentifiedSlots('Player')).toEqual(['0.34'])
    await expect(s.prepare(slot,'Player')).rejects.toThrow('unknown')
    f.state.denied = true
    await expect(s.prepare(slot,'Player')).rejects.toThrow('read')
  })
})
