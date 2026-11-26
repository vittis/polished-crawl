import { EngineStore, profileDatabases, type EngineVariant } from '@orbrun/offline'
import { ENGINE_BASE, offlineRuns } from './servers'

let busy: () => boolean = () => false
let atRest: () => boolean = () => false
/** the service worker is registered here, so there is a version to look for */
let kept = false
/** a new version took over this page while the player was busy: switched to when they are not */
let arrived = false
let lastLook = 0
/** how often an open page asks after a new version, beyond the browser's own look at each page load */
const LOOK_MS = 5 * 60_000
/** Time allowed for background installation or a shell readiness reply. */
const SETTLE_MS = 30_000
/** the look for a new version of the app at load, and its install if there is one */
let settled: Promise<void> = Promise.resolve()
let checkingShell: Promise<boolean> | undefined

/** The offline engine builds kept on this device, and their updates (@orbrun/offline EngineStore). */
export const engines = new EngineStore({
  // no page to be relative to under node (the session tests), where nothing is kept anyway
  base: new URL(ENGINE_BASE + '/', typeof location === 'undefined' ? 'http://localhost/' : location.href).href,
  caches: typeof caches === 'undefined' ? undefined : caches,
  storage: () => localStorage,
  locks: () => navigator.locks,
  checkSaveStorage,
  profileDirs: profileDatabases,
  shellReady: () => checkingShell ??= checkShell().finally(() => { checkingShell = undefined }),
  variant: detectVariant,
})

/** A browser can expose IndexedDB yet reject writes in this browsing context. */
function checkSaveStorage(): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('Allow browser storage or free space on this device, then retry.'))
    const open = indexedDB.open('orbrun.offline.storage', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('checks')
    open.onerror = fail
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('checks', 'readwrite')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); fail() }
      tx.objectStore('checks').put(true, 'writable')
    }
  })
}

let variant: Promise<EngineVariant> | undefined
function detectVariant(): Promise<EngineVariant> {
  return variant ??= new Promise<EngineVariant>((resolve, reject) => {
    const worker = new Worker(new URL('./engine-capability.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = e => { worker.terminate(); resolve(e.data) }
    worker.onerror = () => { worker.terminate(); reject(new Error('This browser could not start the offline worker.')) }
  }).catch(error => { variant = undefined; throw error })
}

/**
 * Keep Polished Crawl and the offline engine on this device: the service worker that
 * keeps the app, so it opens with no connection, and answers the engine's
 * requests from what is kept (public/sw.js), and what counts as a game under
 * way, which downloads wait for. Only where the engine runs: elsewhere the
 * app is no use offline.
 *
 * A page load is the deployed version wherever there is a connection
 * (sw.js); a page the kept one stood in for, with none, switches to a new
 * deploy as soon as it takes over, if the player is resting on the home
 * screen (`resting`), else the next time they are (`updateApp`).
 */
export function keepEngines(gameUnderWay: () => boolean, resting: () => boolean) {
  busy = gameUnderWay
  atRest = resting
  if (!offlineRuns() || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  const look = sw
    .register('/sw.js')
    .then(async (r) => {
      // the browser looks for itself as the page loads (Chrome a second or two in, however early it is asked);
      // asking too is how the page hears that it has looked, and what it found
      if (sw.controller) await r.update()
      await installed(r.installing ?? r.waiting ?? r.active)
    })
    .catch(() => {})
  settled = Promise.race([look, new Promise<void>((done) => setTimeout(done, SETTLE_MS))])
  kept = true
  lastLook = Date.now()
  // a first install takes over a page that already runs its version: nothing new to switch to
  let controlled = !!sw.controller
  sw.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true
      return
    }
    const controller = sw.controller
    void askWorker(controller, 'keeps', 5000).then((same) => {
      if (same !== false || sw.controller !== controller) return
      arrived = true
      updateApp()
    })
  })
}

async function checkShell(): Promise<boolean> {
  const sw = navigator.serviceWorker
  if (!sw.controller) await appSettled()
  const controller = sw.controller
  const ready = await askWorker(controller, 'ready', SETTLE_MS)
  if (ready && sw.controller === controller) return true
  // A network-loaded page can be ahead of the worker that currently controls it.
  if (sw.controller === controller) await appSettled()
  const next = sw.controller
  return next !== controller && await askWorker(next, 'ready', SETTLE_MS) === true && sw.controller === next
}

function askWorker(worker: ServiceWorker | null, type: 'ready' | 'keeps', timeout: number): Promise<boolean | undefined> {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src
  if (!worker || !src) return Promise.resolve(undefined)
  return new Promise((done) => {
    const sw = navigator.serviceWorker
    const ch = new MessageChannel()
    const switched = () => { if (sw.controller !== worker) finish() }
    const finish = (answer?: boolean) => {
      clearTimeout(timer)
      sw.removeEventListener('controllerchange', switched)
      ch.port1.close()
      done(answer)
    }
    const timer = setTimeout(finish, timeout)
    sw.addEventListener('controllerchange', switched)
    ch.port1.onmessage = (e) => finish(typeof e.data === 'boolean' ? e.data : undefined)
    try { worker.postMessage({ type, url: src }, [ch.port2]) }
    catch { ch.port2.close(); finish() }
  })
}

/** Resolves once `w` is the version in use, or was passed over. */
function installed(w: ServiceWorker | null): Promise<void> {
  return new Promise((done) => {
    if (!w) return done()
    const look = () => {
      if (w.state !== 'activated' && w.state !== 'redundant') return
      w.removeEventListener('statechange', look)
      done()
    }
    w.addEventListener('statechange', look)
    look()
  })
}

/**
 * Resolves once the look for a new version of the app made at load is done,
 * and the version it found installed. Cached play can use the current
 * controller immediately, while background prefetch and first-time setup wait.
 */
export function appSettled(): Promise<void> {
  return settled
}

/**
 * On the home screen: switch to a version that arrived while the player was
 * busy, or ask whether there is one (no more than every few minutes), so a
 * page left open finds a deploy too.
 */
export function updateApp() {
  if (!kept) return
  if (arrived) {
    if (atRest() && !busy()) {
      arrived = false
      location.reload()
    }
    return
  }
  if (navigator.onLine === false || Date.now() - lastLook < LOOK_MS) return
  lastLook = Date.now()
  navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {})
}

/**
 * Ask the browser to keep this device's games when it runs short of space:
 * the saves and the engine are otherwise the first things it clears. Chrome
 * answers without asking the player.
 */
export function keepSaves() {
  if (typeof navigator === 'undefined') return
  navigator.storage?.persist?.().catch(() => {})
}
