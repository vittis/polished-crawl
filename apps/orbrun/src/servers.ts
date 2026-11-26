import type { GameLink } from '@orbrun/webtiles'
import bundled from '../data/servers.json'
import { ownWindow } from './quit'
import { decodeRoutePart, HOME, MENU_PATH, OFFLINE_SERVER_ID, pageAt, parsePlayMenuPath, parseServerPath, routeSegments, titleAt } from './site'
import { DEFAULT_PROFILE, profileName } from '@orbrun/offline'

export interface ServerInfo {
  id: string
  name: string
  /** Where it is, as the official server list (crawl.develz.org/servers.json) gives it. */
  location?: string
  ws: string
  http: string
  host: string
  custom?: boolean
  /** Games on this device (@orbrun/offline): no socket, no proxies, gamedata from ENGINE_BASE. */
  offline?: boolean
}

/** Where the offline engine's files are served (engine/dist; the dev server's /engine route). */
export const ENGINE_BASE = '/engine'

export const OFFLINE_SERVER: ServerInfo = { id: OFFLINE_SERVER_ID, name: 'Offline', ws: '', http: '', host: 'this device', offline: true }

/** Hosted builds use only the bundled public-server registry. */
export function customServersAllowed(): boolean {
  return !import.meta.env.PROD
}

/** Offline play is available on development builds and hosted preview. */
export function offlineOffered(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'offline' || !!import.meta.env.VITE_PREVIEW_SHA
}

/** Durable device play needs a controlling service worker, persistent files and cross-tab locks. */
export function offlineRuns(): boolean {
  return offlineOffered() && typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined' &&
    typeof caches !== 'undefined' && typeof indexedDB !== 'undefined' &&
    !!navigator.locks && 'serviceWorker' in navigator
}

const KEY = 'orbrun.servers'
const TOKEN_KEY = 'orbrun.tokens'
const LAST_KEY = 'orbrun.last'
const HOME_SERVER_KEY = 'orbrun.homeServer'
const LOGIN_SERVER_KEY = 'orbrun.loginServer'
const GAMES_KEY = 'orbrun.games'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function listServers(): ServerInfo[] {
  const custom = customServersAllowed() ? load<ServerInfo[]>(KEY, []) : []
  return [...(bundled as ServerInfo[]), ...custom]
}

export function getHomeServer(): ServerInfo | null {
  const ids = [load(LOGIN_SERVER_KEY, ''), load(HOME_SERVER_KEY, ''), getLast()?.serverId]
  for (const id of ids) {
    if (!id || id === OFFLINE_SERVER.id) continue
    const server = findServer(id)
    if (server) return server
  }
  return null
}

export function setHomeServer(id: string) {
  save(HOME_SERVER_KEY, id)
}

/** Keep the last confirmed login ahead of the picker and latency defaults. */
export function setLoginServer(id: string) {
  save(LOGIN_SERVER_KEY, id)
}

/**
 * Add a server by its host or the address of its page (any path is dropped:
 * the socket is always `/socket` at its root). A host already on the list
 * gives back the server listed there, bundled or not, rather than a second
 * row for it. Throws, in words for the player, on anything that is not an address.
 */
export function addServer(url: string): ServerInfo {
  const text = url.trim()
  if (!text) throw new Error('Enter a host or an address.')
  let u: URL
  try {
    u = new URL(text.includes('://') ? text : 'https://' + text)
  } catch {
    throw new Error(`${text} is not an address.`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('A server is reached over http or https.')
  if (!customServersAllowed() && u.protocol !== 'https:') throw new Error('Use HTTPS for a listed public server.')
  const host = u.host.toLowerCase()
  if (!host || /\s/.test(text) || !/[a-z0-9]/.test(host)) throw new Error(`${text} is not an address.`)
  const had = listServers().find((s) => !s.offline && s.host.toLowerCase() === host)
  if (had) return had
  if (!customServersAllowed()) throw new Error('Choose a server from the public server list.')
  const ws = (u.protocol === 'http:' ? 'ws://' : 'wss://') + host + '/socket'
  const info: ServerInfo = { id: host, name: host, ws, http: u.origin, host, custom: true }
  const custom = load<ServerInfo[]>(KEY, []).filter((s) => s.id !== info.id)
  custom.push(info)
  save(KEY, custom)
  return info
}

/** Take a server the player added off the list; the bundled ones stay. */
export function removeServer(id: string) {
  save(
    KEY,
    load<ServerInfo[]>(KEY, []).filter((s) => s.id !== id),
  )
}

// ------------------------------------------------------------------ accounts

/** An identity on a WebTiles server or this device. */
export interface Account {
  serverId: string
  username: string
}

const ACCOUNT_KEY = 'orbrun.account'
const DEVICE_PROFILE_KEY = 'orbrun.deviceProfile'
const LEGACY_ACCOUNTS_KEY = 'orbrun.accounts'
const LEGACY_USED_KEY = 'orbrun.accountUsed'

function tokenKey(serverId: string, username: string): string {
  return serverId + '/' + username.toLowerCase()
}

export function sameAccount(a: Account | null | undefined, b: Account | null | undefined): boolean {
  return !!a && !!b && a.serverId === b.serverId && a.username.toLowerCase() === b.username.toLowerCase()
}

function validAccount(a: Account | null): a is Account {
  return typeof a?.username === 'string' && !!a.username && typeof a.serverId === 'string' && (a.serverId === OFFLINE_SERVER.id || !!findServer(a.serverId))
}

/** Keep the active online login and the offline save directory that was last used. */
function migrateAccounts() {
  if (load(DEVICE_PROFILE_KEY, '')) return
  const stored = load<unknown>(LEGACY_ACCOUNTS_KEY, [])
  const used = load<Record<string, number> | null>(LEGACY_USED_KEY, null)
  const accounts: Account[] = Array.isArray(stored) ? stored.filter(validAccount).sort((a, b) =>
    (used?.[tokenKey(b.serverId, b.username)] ?? 0) - (used?.[tokenKey(a.serverId, a.username)] ?? 0)) : []
  const chosen = load<Account | null>(ACCOUNT_KEY, null)
  const last = getLast()
  const local = chosen?.serverId === OFFLINE_SERVER.id ? chosen.username
    : accounts.find(a => a.serverId === OFFLINE_SERVER.id)?.username ?? (last?.serverId === OFFLINE_SERVER.id ? last.username : null)
  let online = validAccount(chosen) && chosen.serverId !== OFFLINE_SERVER.id ? chosen : accounts.find(a => a.serverId !== OFFLINE_SERVER.id) ?? null
  const tokens = readTokens()
  // Before the account list, tokens were keyed by server and the name was stored in last played.
  const lastAccount = last?.username ? { serverId: last.serverId, username: last.username } : null
  if (!online && validAccount(lastAccount) && lastAccount.serverId !== OFFLINE_SERVER.id && tokens[lastAccount.serverId]) online = lastAccount
  if (online) {
    const key = tokenKey(online.serverId, online.username)
    const token = tokens[key] ?? (sameAccount(lastAccount, online) ? tokens[online.serverId] : undefined)
    save(TOKEN_KEY, token ? { [key]: token } : {})
  } else if (Object.keys(tokens).length) save(TOKEN_KEY, {})
  if (save(ACCOUNT_KEY, online ? { serverId: online.serverId, username: online.username } : null)) {
    save(DEVICE_PROFILE_KEY, profileName(local ?? '') ?? DEFAULT_PROFILE)
  }
}

export function getOnlineAccount(): Account | null {
  migrateAccounts()
  const a = load<Account | null>(ACCOUNT_KEY, null)
  return validAccount(a) && a.serverId !== OFFLINE_SERVER.id ? a : null
}

export function setOnlineAccount(a: Account | null) {
  migrateAccounts()
  if (!a) {
    save(ACCOUNT_KEY, null)
    save(TOKEN_KEY, {})
    return
  }
  const key = tokenKey(a.serverId, a.username)
  const tokens = readTokens()
  if (Object.keys(tokens).some(k => k !== key)) save(TOKEN_KEY, tokens[key] ? { [key]: tokens[key] } : {})
  save(ACCOUNT_KEY, { serverId: a.serverId, username: a.username })
}

export function onlineAccountChanged(event: StorageEvent, account: Account): boolean {
  return event.key === ACCOUNT_KEY && account.serverId !== OFFLINE_SERVER.id && !sameAccount(account, getOnlineAccount())
}

/** Mode is local to a tab. Visiting Offline leaves the remembered login available. */
let offlineMode = false

export function getDeviceAccount(): Account {
  migrateAccounts()
  return { serverId: OFFLINE_SERVER.id, username: load(DEVICE_PROFILE_KEY, DEFAULT_PROFILE) }
}

export function enterOffline() {
  offlineMode = offlineOffered()
}

export function leaveOffline() {
  offlineMode = false
}

export function getChosenAccount(): Account | null {
  return offlineMode ? getDeviceAccount() : getOnlineAccount()
}

/**
 * A stored token: the cookie string and when the server will have forgotten
 * it (ms since the epoch), or a bare string from a build that kept no expiry
 * (2026-09-18), read as a token that has not expired.
 */
interface LoginRecord {
  token: string
  until?: number
  renewAfter?: number
}
type StoredToken = string | LoginRecord

function readTokens(): Record<string, StoredToken> {
  const t = load<unknown>(TOKEN_KEY, {})
  return t && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, StoredToken>) : {}
}

const DAY_MS = 24 * 60 * 60 * 1000

function loginRecord(v: StoredToken | undefined): LoginRecord | null {
  if (typeof v === 'string') return v ? { token: v } : null
  if (!v || typeof v !== 'object' || typeof v.token !== 'string' || !v.token) return null
  return v
}

export function savedLogin(serverId: string, username: string) {
  return loginRecord(readTokens()[tokenKey(serverId, username)])
}

/** Expired records cannot be used, but can still be compared during an in-flight renewal. */
export function getToken(serverId: string, username: string, now = Date.now()): string | null {
  const record = savedLogin(serverId, username)
  return !record || (typeof record.until === 'number' && now >= record.until) ? null : record.token
}

/**
 * File `token` under the account, or forget it (`null`). `expiresDays` is the
 * `login_cookie` message's `expires`: how many days the server keeps the token
 * (ws_handler.py `set_login_cookie` sends `login_token_lifetime`).
 */
export function setToken(serverId: string, username: string, token: string | null, expiresDays?: number, now = Date.now()) {
  writeToken(readTokens(), tokenKey(serverId, username), token, expiresDays, now)
}

/** An answer from one connection can only replace the record it used. */
export function replaceToken(serverId: string, username: string, previous: string | null, token: string | null, expiresDays?: number): boolean {
  // A reply in another tab may arrive after the remembered login changed.
  if (token && load(DEVICE_PROFILE_KEY, '') &&
    !sameAccount({ serverId, username }, load<Account | null>(ACCOUNT_KEY, null))) return false
  const all = readTokens()
  const key = tokenKey(serverId, username)
  if ((loginRecord(all[key])?.token ?? null) !== previous) return false
  return writeToken(all, key, token, expiresDays, Date.now())
}

function writeToken(all: Record<string, StoredToken>, key: string, token: string | null, expiresDays: number | undefined, now: number) {
  if (token) {
    const lifetime = typeof expiresDays === 'number' && isFinite(expiresDays) && expiresDays > 0 ? expiresDays * DAY_MS : undefined
    if (lifetime === undefined) all[key] = { token }
    else {
      const until = now + lifetime
      all[key] = { token, until, renewAfter: until - Math.min(60 * 60 * 1000, lifetime / 4) }
    }
  } else delete all[key]
  return save(TOKEN_KEY, all)
}

/**
 * Where an account stands in its server's lobby: `in` (the lobby said who),
 * `pending` (a token is stored and its login not yet answered; a refused one
 * is dropped, so this cannot last), or `out` (nobody, and nothing to try).
 * The server sends its "Play now" lines only once logged in (ws_handler.py
 * `send_lobby_html`: `if not self.username: return`), so `out` is when the
 * lobby screen offers Log in instead of Play.
 */
export type LoginState = 'in' | 'pending' | 'out'

export function loginState(account: Account | null, loggedIn: string | null | undefined, loggingIn = false): LoginState {
  if (loggedIn) return 'in'
  if (loggingIn) return 'pending'
  // an offline profile's token is its name (session.ts), never stored and never refused
  if (account && (account.serverId === OFFLINE_SERVER.id || getToken(account.serverId, account.username))) return 'pending'
  return 'out'
}

/**
 * A character as a roster line or a lobby's save info describes them: the
 * stats screen's first lines (grid/stats.ts), as the home screen's Continue
 * and the browser tab speak them.
 */
export interface LastCharacter {
  name: string
  /** "the Severer", or ", the ..." when the title carries its own comma (stats.ts) */
  title: string
  species: string
  /** "Vehumet"; '' for a character without a god (the `player` message's `god`, the roster's) */
  god?: string
  xl: number
  /** "Dungeon", "Snake Pit"; `depth` 0 for a branch without one */
  place: string
  depth: number
}

export interface LastPlayed {
  serverId: string
  gameId?: string
  username?: string
  /**
   * The gamedata version (a sha1) the last game on this server ran on, from its `game_client`: what the
   * next visit warms the cache with before Play is pressed (main.ts `warmGamedata`). Only ever learned
   * in play, so a version can lag behind a server upgrade by one game; the warm-up then fetches a set
   * that is still served, and the new one loads as it always has.
   */
  gamedataVersion?: string
}

/**
 * The character a lobby roster line describes (`lobby_entry`: the game a
 * player has open on the server), as the home screen's Continue speaks one:
 * the title without its "the", the species and background as the roster's
 * four letters ("VSIE"), the place as the HUD abbreviates it ("D:2"). The
 * account's own line is a game of theirs still open on the server, left
 * through a dropped socket or in another tab.
 *
 * Everything here comes from the line itself, nothing from what this device
 * saw last: the same account can be played from anywhere, so a remembered
 * character may already be dead and would contradict the live line.
 */
export function characterOf(e: { username: string; char?: string; xl?: string; place?: string; title?: string; god?: string }): LastCharacter {
  const colon = e.place?.lastIndexOf(':') ?? -1
  const depth = colon > 0 ? Number(e.place!.slice(colon + 1)) : 0
  const place = colon > 0 && depth ? e.place!.slice(0, colon) : e.place ?? ''
  return {
    name: e.username,
    title: e.title ? 'the ' + e.title : '',
    species: e.char ?? '',
    god: e.god || '',
    xl: Number(e.xl) || 0,
    place,
    depth: depth || 0,
  }
}

/**
 * "Kai the Severer, Mountain Dwarf XL12": the character in a line, as
 * the lobby roster speaks one. Where they stand is a line of its own
 * (describePlace): the two together run past a handheld's width.
 */
export function describeCharacter(c: LastCharacter): string {
  const who = c.name + (c.title ? ((c.title[0] === ',' ? '' : ' ') + c.title) : '')
  const what = [c.species, c.xl ? `XL${c.xl}` : ''].filter(Boolean).join(' ')
  return [who, what].filter(Boolean).join(', ')
}

/** "Snake Pit:2", "Zot": where the character stands, as the HUD's place line says it; '' before the game has said. */
export function describePlace(c: LastCharacter): string {
  return c.place ? c.place + (c.depth ? ':' + c.depth : '') : ''
}

/**
 * "orbrun the Chiller | Vine Stalker of Vehumet - Polished Crawl": the browser tab's
 * title while in a game, so a tab (or a window in a taskbar) says whose game
 * it is. The species and god read as the HUD's second line does, and the site
 * follows a hyphen, as the site's page titles have it (site.ts).
 * `base` is the site's name.
 */
export function gameTitle(c: LastCharacter, base: string): string {
  const who = c.name + (c.title ? ((c.title[0] === ',' ? '' : ' ') + c.title) : '')
  const what = c.species + (c.god ? (c.species ? ' of ' : 'of ') + c.god : '')
  const game = [who, what].filter(Boolean).join(' | ')
  return [game, base].filter(Boolean).join(' - ')
}

const MORGUE_KEY = 'orbrun.morgue'

/**
 * Where a server keeps an account's morgue directory ("/crawl/morgue/orbrun/"), once something has said: a
 * `game_ended` `dump` names the real one, and before that the home screen tries the layouts
 * dgamelaunch-config ships with (whereis.ts `morgueDirGuesses`) and keeps whichever answered. '' is a
 * server that answered none of them, kept so the tries are not made again on every redraw.
 */
export function getMorgueDir(serverId: string, username: string): string | null {
  const all = load<Record<string, string>>(MORGUE_KEY, {})
  return all[tokenKey(serverId, username)] ?? null
}

export function setMorgueDir(serverId: string, username: string, dir: string) {
  const all = load<Record<string, string>>(MORGUE_KEY, {})
  all[tokenKey(serverId, username)] = dir
  save(MORGUE_KEY, all)
}

export function getLast(): LastPlayed | null {
  return load<LastPlayed | null>(LAST_KEY, null)
}

export function setLast(l: LastPlayed) {
  save(LAST_KEY, l)
}

/** A game the server's lobby offers, as `set_game_links` lists it, with the save it reported waiting there. */
export type CachedGame = GameLink

/**
 * The game list a server's lobby sent last time, kept per server so the
 * home screen can offer "Play 0.34" and "Play trunk" before the connection
 * is up. The live list replaces it as soon as the lobby sends one.
 */
export function getGames(serverId: string): CachedGame[] | null {
  return load<Record<string, CachedGame[]>>(GAMES_KEY, {})[serverId] ?? null
}

export function setGames(serverId: string, games: CachedGame[]) {
  const all = load<Record<string, CachedGame[]>>(GAMES_KEY, {})
  all[serverId] = games.map((g) => {
    const c: CachedGame = { id: g.id, label: g.label }
    if (g.save !== undefined) c.save = g.save
    if (g.disabled) c.disabled = true
    if (g.rc) c.rc = g.rc
    return c
  })
  save(GAMES_KEY, all)
}

/** Where gamedata is fetched from for a server, in this shell. */
export function gamedataBaseFor(server: ServerInfo): string {
  if (server.offline) return ENGINE_BASE
  return `/gamedata-proxy/${server.host}`
}

/**
 * Where a game's morgue file or character dump is read from, in this shell:
 * `game_ended` hands the file's URL less its `.txt`, absolute or as a path
 * on the server, and the server publishes it without CORS headers, so it is
 * read through the same-origin proxy. Null when the URL is not one the
 * proxy can carry (another scheme, a host the server picker would refuse).
 */
export function morgueUrlFor(server: ServerInfo, dump: string): string | null {
  if (server.offline) return null
  let u: URL
  try {
    u = new URL(dump + '.txt', server.http)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  return `/morgue-proxy/${u.host}${u.pathname}`
}

/** Input family, retained for keyboard and controller classification. */
export type DirSource = 'arrows' | 'vim' | 'numpad' | 'dpad' | 'lstick'

// ------------------------------------------------------------------- servers

/** A server by id or host, from the bundled list or the custom ones, or this device's. */
export function findServer(idOrHost: string): ServerInfo | null {
  if (idOrHost === OFFLINE_SERVER.id) return offlineOffered() ? OFFLINE_SERVER : null
  return listServers().find((s) => s.id === idOrHost || s.host === idOrHost) ?? null
}

// --------------------------------------------------------------------- route

/** The URL uses a verb and server, with player names in the fragment. */
export type Route =
  | { kind: 'home' }
  | MenuRoute
  | { kind: 'lobby'; serverId: string; account: Account | null }
  | { kind: 'play'; account: Account; gameId: string }
  | { kind: 'watch'; serverId: string; account: Account | null; username: string }

export interface MenuRoute {
  kind: 'menu'
  path: string
  serverId?: string
  username?: string
  gameId?: string
  morgue?: string
}

/** what every game id on this device starts with (@orbrun/offline channelOf), which its address says as CDI would */
const DEVICE_GAME = 'offline-'

/** a game on this device in an address: `offline-0.34` is `dcss-0.34`, `offline-trunk` CDI's `dcss-git` */
function deviceGameAddress(gameId: string): string {
  const slot = gameId.startsWith(DEVICE_GAME) ? gameId.slice(DEVICE_GAME.length) : gameId
  return 'dcss-' + (slot === 'trunk' ? 'git' : slot)
}

/** the game on this device an address names; the bare slot (`0.34`, `trunk`) is how older addresses said it */
function deviceGameAt(game: string): string {
  const slot = game.toLowerCase().replace(/^dcss-/, '')
  return DEVICE_GAME + (slot === 'git' ? 'trunk' : slot)
}

/** The remembered online account, when it belongs to the server in the URL. */
function onlineOn(serverId: string): Account | null {
  const account = getOnlineAccount()
  return account?.serverId === serverId ? account : null
}

export function parseRoute(href: string = window.location.href): Route {
  const { pathname, hash } = new URL(href)
  const parts = routeSegments(pathname)
  if (!parts.length) return { kind: 'home' }
  const menu = parts.join('/').toLowerCase()
  if (menu === 'about' || menu === 'about/new') return { kind: 'menu', path: menu }
  if (menu === 'offline') return offlineOffered() ? { kind: 'menu', path: menu } : { kind: 'home' }
  if (MENU_PATH.test(menu)) return { kind: 'menu', path: menu }
  const tagged = hash.length > 1 ? decodeRoutePart(hash.slice(1)) : null
  const path = parsePlayMenuPath(parts) ?? parseServerPath(parts)
  if (!path) return { kind: 'home' }
  const server = findServer(path.server.toLowerCase())
  if (!server) return { kind: 'home' }
  const serverId = server.id
  const account = server.offline ? getDeviceAccount() : onlineOn(serverId)
  const named = ('username' in path ? path.username : undefined) ?? tagged
  const matches = account && (!named || sameAccount(account, { serverId, username: named }))
  if ('path' in path) {
    if (server.offline && !matches) return { kind: 'menu', path: 'offline' }
    if (matches) return { kind: 'menu', path: path.path, serverId, ...(!server.offline ? { username: account.username } : {}),
      ...('gameId' in path ? { gameId: path.gameId } : {}), ...('morgue' in path ? { morgue: path.morgue } : {}) }
    return { kind: 'menu', path: 'login', serverId, ...(named ? { username: named } : {}) }
  }
  if (path.verb === 'login' || path.verb === 'register') {
    if (server.offline) return { kind: 'menu', path: 'offline' }
    return { kind: 'menu', path: path.verb, serverId, ...(named ? { username: matches ? account.username : named } : {}) }
  }
  if (path.verb === 'play') {
    if (matches) return { kind: 'play', account, gameId: server.offline ? deviceGameAt(path.game) : path.game }
    if (server.offline) return { kind: 'menu', path: 'offline' }
    return { kind: 'menu', path: 'login', serverId, ...(named ? { username: named } : {}) }
  }
  if (!named) return { kind: 'lobby', serverId, account }
  return { kind: 'watch', serverId, account, username: named }
}

/** a path of names, each encoded whole: a space, `/`, `?`, `#` or `%` in one stays in it */
function pathOf(...parts: string[]): string {
  return '/' + parts.map(encodeURIComponent).join('/')
}

/** who, after the `#`, encoded whole as a path's names are */
function tagOf(name: string | undefined): string {
  return name ? '#' + encodeURIComponent(name) : ''
}

/**
 * The address for a route. The query is carried through unchanged: the flags
 * that live there (`?perf`, `?fullscreen`) are set once when the page is
 * opened — by a Steam shortcut's launch options, say — and a device with no
 * address bar could not put one back, so a Play must not drop them.
 */
export function formatRoute(r: Route): string {
  const q = window.location.search
  if (r.kind === 'home') return '/' + q
  if (r.kind === 'menu') return (r.serverId ? pathOf(...r.path.split('/'), r.serverId, ...(r.gameId ? [r.gameId] : []), ...(r.morgue ? [r.morgue] : [])) : '/' + r.path) + q + tagOf(r.serverId ? r.username : undefined)
  if (r.kind === 'lobby') return pathOf('watch', r.serverId) + q
  if (r.kind === 'watch') return pathOf('watch', r.serverId) + q + tagOf(r.username)
  const { serverId, username } = r.account
  return pathOf('play', serverId, serverId === OFFLINE_SERVER.id ? deviceGameAddress(r.gameId) : r.gameId) + q + tagOf(serverId === OFFLINE_SERVER.id ? undefined : username)
}

/**
 * How deep in the front end a route is: the home screen, or anything else
 * (a menu, the Watch screen, a game, a spectate). Games and Play utilities
 * leave their Play submenu in history. Other transitions reuse the existing entry.
 */
function routeDepth(r: Route): number {
  if (r.kind === 'home') return 0
  if (r.kind === 'play' || (r.kind === 'menu' && (r.serverId || r.path === 'about' || r.path === 'whats-new'))) return 2
  return 1
}

/**
 * Leave the app for one of the site's own pages (`/about`), carrying the
 * query as a Play does (formatRoute), so the flags set at launch come back
 * with the player. In a window of our own the page takes this one's place in
 * history rather than adding to it, as setRoute does, so Quit can still close
 * the window afterwards.
 */
export function openPage(path: string) {
  const next = path + window.location.search
  if (ownWindow()) window.location.replace(next)
  else window.location.assign(next)
}

/**
 * Put the route in the address bar. Returning to an entry pushed by this app
 * uses browser Back so the parent appears once in history.
 * Installed windows keep one entry so the app can close its own window.
 */
export function setRoute(r: Route) {
  const next = formatRoute(r)
  const cur = window.location.pathname + window.location.search + window.location.hash
  if (cur === next) return
  const standalone = ownWindow()
  const mainPage = r.kind === 'home' || (r.kind === 'menu' && (r.path === 'play' || r.path === 'offline'))
  if (!standalone && mainPage && history.state?.orbrunParent === next) {
    history.back()
    return
  }
  if (!standalone && routeDepth(r) > routeDepth(parseRoute())) history.pushState({ orbrunParent: cur }, '', next)
  else history.replaceState(history.state, '', next)
  // a game names the tab after its character (main.ts updateTitle); every other screen after its page
  if (r.kind !== 'play' && r.kind !== 'watch') document.title = screenTitle(window.location.pathname)
}

/**
 * The title of a screen that is not a game. In a window of its own (an
 * installed app, a kiosk) the title bar names the app and nothing more; in a
 * tab it is the page's search headline (site.ts).
 */
export function screenTitle(pathname: string): string {
  return ownWindow() && !pageAt(pathname) ? HOME.name : titleAt(pathname)
}
