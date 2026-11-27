import {
  RemoteConnection,
  initialState,
  reduce,
  cm,
  ctrl,
  Keys,
  MouseMode,
  UiState,
  type ClientMessage,
  type Connection,
  type GameState,
  type ServerMessage,
} from '@orbrun/webtiles'
import { loadGamedata, browserIo, type Gamedata } from '@orbrun/gamedata'
import { buildScene } from '@orbrun/scene-webtiles'
import { cellAhead, cellKey, emptyScene, isThreat, type Dir8, type Scene } from '@orbrun/scene'
import { LocalWasmConnection, browserRcBook, browserSaveBook } from '@orbrun/offline'
import { engines, keepSaves } from './engines'
import type { ServerInfo } from './servers'
import { gamedataBaseFor, getToken, replaceToken, savedLogin, setToken } from './servers'
import { deriveMode } from './context'
import { MOVE_KEYS } from './keys'

const LOGIN_REPLY_MS = 10_000
const LOGIN_CHECK_MS = 60_000
const LOGIN_RENEWAL_LEAD_MS = 60 * 60 * 1000
const PACED_ACTION_INTERVAL_MS = 80
const PACED_MOVEMENT_INTERVAL_MS = 65
const ACTION_REDRAW_MS = 20
const MAX_STEPS_IN_FLIGHT = 3
const MOVE_CODES = new Set(MOVE_KEYS.flatMap(key => [key.charCodeAt(0), key.toUpperCase().charCodeAt(0), ctrl(key)]))

export function pacedDungeonAction(msg: ClientMessage): 'action' | 'explore' | 'move' | 'run' | 'rest' | null {
  const key = msg.msg === 'key' ? msg.keycode : msg.msg === 'input' ? msg.text : undefined
  switch (key) {
    case 'o': case 111:
      return 'explore'
    case '\t': case Keys.TAB: case Keys.CK_SHIFT_TAB: case 'p': case 112:
    case '.': case 46:
      return 'action'
    case '5': case 53: case Keys.NUMPAD(5): case Keys.CK_CLEAR: case Keys.CK_SHIFT_CLEAR:
      return 'rest'
  }
  if (typeof key === 'string' && MOVE_KEYS.includes(key.toLowerCase())) return key === key.toLowerCase() ? 'move' : 'run'
  if (typeof key === 'number' && MOVE_CODES.has(key)) return key < 32 ? 'action' : key <= 90 ? 'run' : 'move'
  return null
}

interface WalkPending {
  dir: Dir8
  count: number
  end: { x: number; y: number }
  level: Scene['levelKey']
  blocked: boolean
}

interface PacedAction {
  turn: number
  interruptible: boolean
  walk?: WalkPending
}

interface LoginWork {
  username: string
  controller: AbortController
  phase: 'lock' | 'login' | 'cookie' | 'late-cookie'
  previous: string | null
  retried: boolean
  release?: () => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * A close with no reason of its own, in words (RFC 6455 §7.4.1): the server
 * ends a socket with 1000 or 1001 when it stops or the player leaves, the
 * browser reports 1005 when the close frame carried no status and 1006 when
 * there was no close frame at all (the network went, or the server did).
 */
function closeWord(code: number): string {
  switch (code) {
    case 1000: return 'closed by the server'
    case 1001: return 'the server went away'
    case 1005: return 'closed without a reason'
    case 1006: return 'the connection dropped'
    case 1011: return 'the server hit an error'
    case 1012: return 'the server is restarting'
    case 1013: return 'the server is busy'
    default: return `code ${code}`
  }
}

export type SessionEvent =
  | { type: 'state'; msg: ServerMessage }
  | { type: 'scene'; scene: Scene }
  | { type: 'gamedata'; status: 'loading' | 'ready' | 'error'; detail?: string; done?: number; total?: number }
  | { type: 'closed'; reason: string }
  | { type: 'open' }
  | { type: 'auth' }
  | { type: 'sent'; msg: ClientMessage }

/**
 * One connection to one server: owns the state, gamedata loading (with the
 * message queue while loading), and scene rebuilding. Emits coarse events.
 */
export class Session {
  readonly server: ServerInfo
  /**
   * The account this connection is for: its token logs in when the socket
   * opens. None while an account is being added, until the login says who
   * (`login_success`), from which point the connection is that account's, so
   * the account's lobby follows this one instead of opening a second.
   */
  username: string | null
  /**
   * A password or token login is awaiting its server reply.
   */
  loggingIn = false
  savedLoginRejected = false
  private loginWork: LoginWork | null = null
  private nextLoginCheck = 0
  private closing = false
  get settlingLogin(): boolean {
    return this.loggingIn || (this.loginWork !== null && this.loginWork.phase !== 'late-cookie')
  }
  readonly conn: Connection
  state: GameState = initialState()
  gamedata: Gamedata | null = null
  scene: Scene = emptyScene()
  private listeners = new Set<(e: SessionEvent) => void>()
  private queue: ServerMessage[] = []
  private queueBytes = 0
  private replayingLoad = false
  /** A loading failure waiting for the socket close callback. */
  private loadFailure: string | null = null
  private loadingVersion: string | null = null
  /** Ends the gamedata load in flight: pulled when a newer version supersedes it or the session closes, so it stops fetching and decoding too. */
  private loadAbort: AbortController | null = null
  /**
   * A load that makes no progress for this long is given up as stalled. The messages the load holds back
   * (`queue`) are every one the game sends meanwhile, and none can be dropped (a map delta left out is a
   * level drawn wrong). The stall timer handles slow loads; count and estimated
   * byte limits below independently bound retained messages even while loading progresses.
   */
  static readonly LOAD_STALL_MS = 30_000
  static readonly LOAD_QUEUE_MESSAGES = 8192
  /** Twice serialized character count plus per-message overhead; an estimate, not a heap measurement. */
  static readonly LOAD_QUEUE_BYTES = 32 * 1024 * 1024
  /** A gamedata fetch is in flight; a `gamedata` event with `ready` or `error` ends it. */
  get loading(): boolean {
    return this.loadingVersion !== null
  }
  private projectileTime = 0
  private pacedActionReadyAt = 0
  private pacedActionPending: PacedAction | null = null
  get awaitingPacedAction(): boolean {
    return this.pacedActionPending !== null
  }
  private explore: { lastStepAt?: number; ending?: boolean } | null = null
  private exploreStep: Scene['exploreStep']
  /** Arrival time of the latest scene update, in performance.now() milliseconds. */
  sceneChangedAt = 0
  private lastSceneRev = { map: -1, player: -1 }
  diagnostics: string[] = []
  closed = false
  private unwatchEngines: (() => void) | null = null
  /** a `probe` waiting on its answer */
  private probing: { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null
  /**
   * The `get_rc`s sent and not yet answered, oldest first: a server answers
   * each, in order, naming the game (ws_handler.py `get_rc`). One given up on
   * keeps its place with no one to tell, so its late answer is not taken for
   * a newer question's (a save read back, getting the file from before it).
   */
  private rcAsks: { gameId: string; answer: ((contents: string | null) => void) | null }[] = []

  /** `conn`: a connection made elsewhere (the e2e harness's in-process engine); by default the server's own. */
  constructor(server: ServerInfo, username: string | null = null, conn?: Connection, private readonly inputTime = () => performance.now()) {
    this.server = server
    this.username = username
    const onDiagnostic = (t: string, d?: unknown) => this.diag(t + (d ? ' ' + safeString(d) : ''))
    this.conn =
      conn ??
      (server.offline
        ? new LocalWasmConnection({
            channels: profile => engines.channels(profile),
            prepare: (channel, profile) => engines.prepare(channel, profile),
            engineBase: (c) => engines.engineBase(c),
            gamedataBase: gamedataBaseFor(server),
            saves: browserSaveBook(),
            rcs: browserRcBook(),
            onDiagnostic,
          })
        : new RemoteConnection({
            url: server.ws,
            gamedataBase: gamedataBaseFor(server),
            WebSocket: window.WebSocket as never,
            onDiagnostic,
          }))
    this.conn.onMessage((m) => this.handle(m))
    // a build that finished downloading is a game the lobby offers
    if (this.conn instanceof LocalWasmConnection) {
      const conn = this.conn
      this.unwatchEngines = engines.onChange(() => conn.channelsChanged())
      keepSaves()
    }
    this.conn.onOpen(() => {
      const who = this.username
      if (this.closing) return
      if (who && !server.offline && getToken(server.id, who)) {
        this.loggingIn = true
        this.withLoginLock(who, work => {
          const token = getToken(server.id, who)
          if (token) this.tryTokenLogin(work, token)
          else {
            this.loggingIn = false
            this.finishLoginWork()
          }
          if (!this.closed && !this.closing) this.emit({ type: 'open' })
        })
        return
      }
      if (who && server.offline) this.send(cm.tokenLogin('offline:' + who))
      this.emit({ type: 'open' })
    })
    this.conn.onClose((r) => {
      this.closed = true
      this.loggingIn = false
      this.finishLoginWork()
      this.endProbe(false)
      for (const a of this.rcAsks.splice(0)) a.answer?.(null)
      // a load for a connection that is gone: stop it, and let the messages it was holding go with it
      this.cancelLoad()
      this.queue = []
      this.queueBytes = 0
      const reason = this.loadFailure || r.reason || closeWord(r.code)
      this.loadFailure = null
      this.emit({ type: 'closed', reason })
    })
  }

  on(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(e: SessionEvent) {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch (err) {
        this.diag('listener error: ' + safeString(err))
      }
    }
  }

  diag(text: string) {
    this.diagnostics.push(text)
    if (this.diagnostics.length > 100) this.diagnostics.shift()
  }

  /**
   * Polished Crawl's own: a key the player sends may be held back while the spell
   * bar looks the spell list up (spell-bar.ts `SpellBook`), and is sent once
   * the look is done; true when it was held. `own` is the look's, never held.
   */
  hold: ((msg: ClientMessage) => boolean) | null = null
  /** what the server sends may be the same look's, kept from the state and the screen: true when it was */
  intercept: ((m: ServerMessage) => boolean) | null = null

  /** Returns false when a paced press is discarded. */
  send(msg: ClientMessage, own = false): false | void {
    if (!own && this.hold?.(msg)) return
    const action = pacedDungeonAction(msg)
    const paced = action && this.playing && !this.watching && deriveMode(this.state) === 'command'
    if (paced && !this.acceptPacedAction(action, msg)) return false
    if (msg.msg === 'login' || msg.msg === 'token_login') this.loggingIn = true
    if (msg.msg === 'login') this.savedLoginRejected = false
    if (['key', 'input', 'text_input', 'click_cell', 'inv_item_action', 'inv_item_describe', 'main_menu_action'].includes(msg.msg)) {
      if (!paced && this.pacedActionPending?.walk) this.pacedActionPending.walk.blocked = true
      const { inputMode, uiState, menus, ui, messages } = this.state
      // WebTiles has no auto-explore mode. Recognize the stock command in its
      // gameplay contexts and use it only to time subsequent confirmed steps.
      const explore = action === 'explore' && this.playing && !this.loading && !menus.length && !ui.length && !messages.more
        && (uiState === UiState.VIEW_MAP || uiState === UiState.NORMAL && inputMode === MouseMode.COMMAND)
      this.explore = explore ? {} : null
    }
    this.conn.send(msg)
    this.emit({ type: 'sent', msg })
  }

  private acceptPacedAction(action: NonNullable<ReturnType<typeof pacedDungeonAction>>, msg: ClientMessage): boolean {
    const now = this.inputTime(), pending = this.pacedActionPending
    const { inputMode, player } = this.state
    if (this.loading) return false
    if (action === 'move' && pending?.interruptible && inputMode === MouseMode.NORMAL && player.turn > pending.turn) {
      // Let one compass input interrupt a run Crawl has confirmed is in progress.
      pending.interruptible = false
      return true
    }
    if (now < this.pacedActionReadyAt) return false

    const walk = pending?.walk
    if (pending && !walk) return false
    const moveKey = action === 'move' ? msg.msg === 'input' ? msg.text : String.fromCharCode(Number(msg.keycode)) : undefined
    const dir = typeof moveKey === 'string' ? MOVE_KEYS.indexOf(moveKey) : -1
    if (walk && (dir !== walk.dir || walk.blocked || walk.level !== this.scene.levelKey || walk.count >= MAX_STEPS_IN_FLIGHT)) return false
    const end = dir >= 0 ? this.clearWalkCell(dir as Dir8, walk?.end ?? player.pos) : undefined
    if (walk) {
      if (!end) return false
      // Rate-limit ordinary walking and bound the outstanding keys. Check
      // ahead only to decide admission; Crawl still owns every position.
      walk.end = end
      walk.count++
    } else {
      if (inputMode !== MouseMode.COMMAND) return false
      const interruptible = action === 'run' || action === 'rest' || action === 'explore'
      this.pacedActionPending = { turn: player.turn, interruptible,
        ...(end ? { walk: { dir: dir as Dir8, end, count: 1, level: this.scene.levelKey, blocked: false } } : {}) }
    }
    this.pacedActionReadyAt = now + (action === 'move' || action === 'run' ? PACED_MOVEMENT_INTERVAL_MS : PACED_ACTION_INTERVAL_MS)
    return true
  }

  private clearWalkCell(dir: Dir8, from: { x: number; y: number }) {
    const scene = this.scene, cell = cellAhead(scene, dir, from)
    if (!scene.playerOnLevel || cell?.visibility !== 'visible' || cell.kind !== 'floor' || cell.occluder || cell.feature
      || cell.flags.water || cell.flags.lava || cell.flags.excluded || cell.cloud !== undefined
      || this.state.player.status.some(s => s.light === 'Conf' || s.light === 'Held')) return
    if (scene.billboards.some(b => b.x === cell.x && b.y === cell.y && b.kind !== 'player'
      || isThreat(b) && scene.cells.get(cellKey(b.x, b.y))?.visibility === 'visible')) return
    return { x: cell.x, y: cell.y }
  }

  /** A game on this device saves where it stands, as a server's would were its socket to go now (@orbrun/offline). */
  checkpoint() {
    if (this.conn instanceof LocalWasmConnection && this.playing) this.conn.checkpoint()
  }

  close() {
    this.closing = true
    this.finishLoginWork()
    this.unwatchEngines?.()
    this.conn.close()
  }

  /**
   * Open the connection again after it dropped, as this same session: the
   * account is the same and every screen following it stays attached, so a
   * drop can be ridden out in place rather than by starting over. The game is
   * not carried over — a WebTiles server stops the game whose socket went,
   * which saves it (ws_handler.py `on_close`) — so the state starts blank and
   * the caller says what to do once the socket is up (a `play` on the same
   * game picks the save up). The gamedata is kept: the same server on the same
   * version wants the same tiles. Answers whether anything was reopened;
   * nothing is while the connection is still up.
   */
  reconnect(): boolean {
    if (!this.closed || this.loadFailure || !this.conn.reopen) return false
    this.state = initialState()
    this.scene = emptyScene()
    this.projectileTime = 0
    this.pacedActionPending = null
    this.pacedActionReadyAt = 0
    this.explore = null
    this.exploreStep = undefined
    this.lastSceneRev = { map: -1, player: -1 }
    this.queue = []
    this.queueBytes = 0
    this.closed = false
    this.closing = false
    this.conn.reopen()
    return true
  }

  /** Renew on a visible, authenticated connection without opening a new socket. */
  refreshLogin(now = Date.now()) {
    const who = this.state.lobby.username
    if (!who || !this.conn.open || this.closing || this.server.offline || this.loginWork || now < this.nextLoginCheck) return
    this.nextLoginCheck = now + LOGIN_CHECK_MS
    const renewalDue = () => {
      const record = savedLogin(this.server.id, who)
      return record?.until !== undefined && now >= (record.renewAfter ?? record.until - LOGIN_RENEWAL_LEAD_MS) ? record : null
    }
    if (!renewalDue()) return
    this.withLoginLock(who, work => {
      const record = renewalDue()
      if (record) this.requestLoginCookie(work, record.token)
      else this.finishLoginWork()
    })
  }

  /** Only one tab at a time can exchange an account's token for a replacement. */
  private withLoginLock(username: string, start: (work: LoginWork) => void) {
    const work: LoginWork = { username, controller: new AbortController(), phase: 'lock', previous: null, retried: false }
    this.loginWork = work
    const locks = window.navigator?.locks
    if (!locks) return start(work)
    // A suspended tab can hold a browser lock until its socket close is
    // delivered. Let the visible tab's normal reconnect backoff run meanwhile.
    if (this.loggingIn) work.timer = setTimeout(() => this.close(), LOGIN_REPLY_MS)
    const name = 'orbrun.login/' + this.server.id + '/' + username.toLowerCase()
    void locks.request(name, { signal: work.controller.signal }, () => new Promise<void>(resolve => {
      if (this.loginWork !== work) return resolve()
      work.release = resolve
      start(work)
    })).catch(() => {
      if (this.loginWork === work && work.phase === 'lock') start(work)
    })
  }

  private tryTokenLogin(work: LoginWork, token: string) {
    clearTimeout(work.timer)
    work.phase = 'login'
    work.previous = token
    work.timer = setTimeout(() => this.close(), LOGIN_REPLY_MS)
    this.send(cm.tokenLogin(token))
  }

  private requestLoginCookie(work: LoginWork, previous: string | null) {
    clearTimeout(work.timer)
    work.phase = 'cookie'
    work.previous = previous
    work.timer = setTimeout(() => {
      // The connection is already authenticated. Release the other tabs and
      // keep the request context in case this server's reply arrives late.
      work.phase = 'late-cookie'
      this.releaseLoginLock(work)
      this.emit({ type: 'auth' })
    }, LOGIN_REPLY_MS)
    this.send(cm.setLoginCookie())
  }

  private releaseLoginLock(work: LoginWork) {
    clearTimeout(work.timer)
    if (work.release) work.release()
    else work.controller.abort()
  }

  private finishLoginWork() {
    const work = this.loginWork
    this.loginWork = null
    if (work) this.releaseLoginLock(work)
  }

  /**
   * Ask the server something only a live socket can answer, and say whether
   * it did within `ms`. `get_rc` is answered by the socket's own handler,
   * game or no game (ws_handler.py `message_handlers`), without the game ever
   * seeing it, so it tells a socket that outlived a sleep from one the
   * browser has not yet noticed is gone. It needs a login (the rc file is the
   * account's) and a game id the server knows; with either missing, or no
   * socket, the answer is no at once.
   */
  probe(gameId: string | null, ms: number): Promise<boolean> {
    if (this.probing) {
      // one already out: the same answer does for both
      const first = this.probing
      return new Promise((resolve) => {
        const was = first.resolve
        first.resolve = (ok) => {
          was(ok)
          resolve(ok)
        }
      })
    }
    if (!this.conn.open || !this.state.lobby.username || !gameId) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.probing = { resolve, timer: setTimeout(() => this.endProbe(false), ms) }
      this.askRc(gameId, (contents) => this.endProbe(contents !== null))
    })
  }

  /**
   * The account's rc file for `gameId` (the game its lobby's `(edit rc)`
   * names, GameLink `rc`), or null when there is no answer within `ms`: no
   * login, no socket, a game the server does not know. A server with no file
   * yet answers empty. The file never reaches the state.
   */
  readRc(gameId: string, ms: number): Promise<string | null> {
    if (!this.conn.open || !this.state.lobby.username) return Promise.resolve(null)
    return new Promise((resolve) => {
      const ask = this.askRc(gameId, (contents) => {
        clearTimeout(timer)
        resolve(contents)
      })
      const timer = setTimeout(() => {
        ask.answer = null
        resolve(null)
      }, ms)
    })
  }

  /** Save the account's rc file for `gameId`. A server says nothing back, whether it wrote it or not: read it back to know. */
  writeRc(gameId: string, contents: string) {
    this.send(cm.setRc(gameId, contents))
  }

  private askRc(gameId: string, answer: (contents: string | null) => void) {
    const ask = { gameId, answer: answer as ((contents: string | null) => void) | null }
    this.rcAsks.push(ask)
    this.send(cm.getRc(gameId))
    return ask
  }

  private endProbe(ok: boolean) {
    const p = this.probing
    if (!p) return
    this.probing = null
    clearTimeout(p.timer)
    p.resolve(ok)
  }

  private handle(m: ServerMessage) {
    if (this.closed || this.closing || this.loadFailure) return
    // an answer is its question's (a probe, or the rc editor), and a load in progress must not hold it
    if (m.msg === 'rcfile_contents' && this.rcAsks.length) {
      const at = this.rcAsks.findIndex((a) => a.gameId === m.game_id)
      const [ask] = this.rcAsks.splice(at < 0 ? 0 : at, 1)
      ask.answer?.(typeof m.contents === 'string' ? m.contents : '')
      return
    }
    if (this.intercept?.(m)) return
    if (this.handleLogin(m)) return
    if (m.msg === 'game_client') {
      const version = m.version as string
      // The reset belongs after all earlier deltas, including lobby and watch
      // changes that survive it. No intermediate scene needs the outgoing art.
      this.drainLoadQueue()
      if (this.closed || this.closing) return
      if (this.loadingVersion !== version) this.cancelLoad()
      this.explore = null
      this.exploreStep = undefined
      this.apply(m)
      // a new game on the version already loaded, or already loading, needs no fetch
      if (!this.closing && !this.closed && this.gamedata?.version !== version && this.loadingVersion !== version) this.startLoad(version)
      return
    }
    if (this.loadingVersion) {
      if (this.queue.length >= Session.LOAD_QUEUE_MESSAGES) return this.failLoad()
      let bytes: number
      try {
        bytes = JSON.stringify(m).length * 2 + 64
      } catch {
        return this.failLoad()
      }
      if (this.queueBytes + bytes > Session.LOAD_QUEUE_BYTES) return this.failLoad()
      this.queue.push(m)
      this.queueBytes += bytes
      return
    }
    this.apply(m)
  }

  /** Return true when a newer token is being tried in place of a rejected one. */
  private handleLogin(m: ServerMessage): boolean {
    const work = this.loginWork
    const serverId = this.server.id
    if (m.msg === 'login_success') {
      this.loggingIn = false
      this.savedLoginRejected = false
      this.username = (m.username as string) || this.username
      if (this.username && !this.server.offline) {
        const who = this.username
        if (work?.phase === 'login') {
          work.username = who
          this.requestLoginCookie(work, work.previous)
        } else {
          this.withLoginLock(who, next => this.requestLoginCookie(next, savedLogin(serverId, who)?.token ?? null))
        }
      }
    } else if (m.msg === 'login_fail') {
      if (work?.phase === 'login') {
        replaceToken(serverId, work.username, work.previous, null)
        const newer = getToken(serverId, work.username)
        if (newer && !work.retried) {
          work.retried = true
          this.tryTokenLogin(work, newer)
          return true
        }
        this.finishLoginWork()
        this.savedLoginRejected = true
      }
      this.loggingIn = false
    } else if (m.msg === 'login_cookie' && work && (work.phase === 'cookie' || work.phase === 'late-cookie')) {
      const cookie = typeof m.cookie === 'string' && m.cookie ? m.cookie : null
      if (cookie) {
        const saved = replaceToken(serverId, work.username, work.previous, cookie, m.expires as number)
        const revoke = saved ? work.previous : cookie
        if (revoke && (!saved || revoke !== cookie)) this.send(cm.forgetLoginCookie(revoke))
      }
      this.finishLoginWork()
      this.emit({ type: 'auth' })
    } else if (m.msg === 'logout') {
      this.loggingIn = false
      this.finishLoginWork()
      const who = this.state.lobby.username || this.username
      if (who) setToken(serverId, who, null)
    } else if (m.msg === 'auth_error' && work?.phase !== 'login') {
      this.loggingIn = false
    }
    return false
  }

  /** A failed load or lost authoritative delta requires a fresh session, never a partial queue replay. */
  private failLoad(reason = 'gamedata message queue exceeded its resource limit; reconnect to reload the game') {
    this.loadFailure = reason
    this.closed = true
    this.loggingIn = false
    this.cancelLoad(new Error(reason))
    this.queue = []
    this.queueBytes = 0
    this.gamedata?.dispose()
    this.gamedata = null
    this.state = initialState()
    this.scene = emptyScene()
    this.projectileTime = 0
    this.lastSceneRev = { map: -1, player: -1 }
    this.diag(reason)
    this.emit({ type: 'gamedata', status: 'error', detail: reason })
    this.close()
  }

  private apply(m: ServerMessage) {
    if (m.msg === 'delay' && typeof m.t === 'number' && Number.isFinite(m.t)) this.projectileTime += Math.max(0, Math.min(1000, m.t)) / 1000
    if (m.msg === 'game_client' || m.msg === 'go_lobby') this.projectileTime = 0
    if (m.msg === 'game_client' || m.msg === 'go_lobby' || m.msg === 'game_ended') {
      this.pacedActionPending = null
      this.pacedActionReadyAt = 0
    } else if (this.pacedActionPending && m.msg === 'input_mode' && m.mode === MouseMode.COMMAND
      && (this.state.inputMode !== MouseMode.COMMAND || this.state.player.turn > this.pacedActionPending.turn)) {
      const pending = this.pacedActionPending
      if (pending.walk && --pending.walk.count > 0) pending.turn = this.state.player.turn
      else {
        this.pacedActionPending = null
        // Network time counts towards the cadence. Reserve a short redraw
        // window after serial actions, including refusals that spend no turn.
        if (!pending.walk) this.pacedActionReadyAt = Math.max(this.pacedActionReadyAt, this.inputTime() + ACTION_REDRAW_MS)
      }
    }
    const previous = this.state.player.pos
    reduce(this.state, m)
    // Buffered steps can be consumed by a prompt. Its command-ready reply
    // finishes the interruption as a whole, rather than owing one per key.
    if (this.pacedActionPending?.walk && deriveMode(this.state) !== 'command') this.pacedActionPending.walk = undefined
    if (m.msg === 'map' || m.msg === 'player' || m.msg === 'game_client' || m.msg === 'go_lobby') {
      this.sceneChangedAt = performance.now()
    }
    if (m.msg === 'player') {
      const { x, y } = this.state.player.pos
      if (x !== previous.x || y !== previous.y) {
        const at = this.sceneChangedAt
        this.exploreStep = this.explore ? {
          interval: this.explore.lastStepAt === undefined ? undefined : (at - this.explore.lastStepAt) / 1000,
          batched: !!this.exploreStep || previous.x !== this.scene.player.x || previous.y !== this.scene.player.y,
        } : undefined
        if (this.explore) this.explore.lastStepAt = at
      }
    }
    // Crawl can announce the command prompt before publishing its last
    // player/map redraw. Retain the run through that redraw.
    if (this.explore && m.msg === 'input_mode' && m.mode === MouseMode.COMMAND) {
      this.explore.ending = true
    } else if (m.msg === 'input_mode' && m.mode !== MouseMode.NORMAL || m.msg === 'map' && this.explore?.ending
      || m.msg === 'go_lobby' || m.msg === 'game_ended') {
      this.explore = null
    }
    this.emit({ type: 'state', msg: m })
    // A single WebSocket batch can contain a projectile's entire path and
    // its removal. Publish confirmed effect frames before another delta can
    // overwrite them. Publish clear frames too to preserve consecutive casts;
    // ordinary map updates remain frame-batched.
    const ranges = this.gamedata?.ranges
    if (!this.replayingLoad && m.msg === 'map' && ranges && Array.isArray(m.cells) && m.cells.some(cell =>
      Array.isArray(cell?.t?.ov) && (cell.t.ov.some((tile: unknown) => typeof tile === 'number' && tile >= ranges.featMax && tile < ranges.mainMax)
        || this.scene.billboards.some(b => b.kind === 'projectile')))) this.flushScene()
  }

  private cancelLoad(reason?: Error) {
    this.loadAbort?.abort(reason)
    this.loadAbort = null
    this.loadingVersion = null
  }

  private drainLoadQueue() {
    const queued = this.queue
    this.queue = []
    this.queueBytes = 0
    this.replayingLoad = true
    try {
      for (const message of queued) {
        if (this.closing || this.closed) break
        this.apply(message)
      }
    } finally {
      this.replayingLoad = false
    }
  }

  private async startLoad(version: string) {
    const abort = (this.loadAbort = new AbortController())
    const current = () => this.loadAbort === abort && !this.closed && !this.closing
    let stall: ReturnType<typeof setTimeout> | undefined
    const watch = () => {
      clearTimeout(stall)
      stall = setTimeout(() => abort.abort(new Error(`no progress in ${Session.LOAD_STALL_MS / 1000}s`)), Session.LOAD_STALL_MS)
    }
    watch()
    this.loadingVersion = version
    this.emit({ type: 'gamedata', status: 'loading', done: 0, total: 1 })
    try {
      const gd = await loadGamedata({
        base: this.conn.gamedataBase,
        version,
        io: browserIo(),
        signal: abort.signal,
        onProgress: (done, total, what) => {
          if (current()) {
            watch()
            this.emit({ type: 'gamedata', status: 'loading', detail: what, done, total })
          }
        },
      })
      if (!current()) {
        // landed anyway (the abort came after the last byte): nobody will draw with it
        gd.dispose()
        return
      }
      this.gamedata?.dispose()
      this.gamedata = gd
      this.emit({ type: 'gamedata', status: 'ready' })
    } catch (e) {
      if (!current()) return
      this.failLoad('gamedata load failed: ' + safeString(e))
    } finally {
      clearTimeout(stall)
      if (current()) {
        this.loadAbort = null
        this.loadingVersion = null
        this.drainLoadQueue()
        this.flushScene()
      }
    }
  }

  /** Rebuild the scene if anything relevant changed. Call once per frame. */
  flushScene(): boolean {
    if (!this.gamedata || this.loading || this.replayingLoad) return false
    const r = this.state.rev
    if (r.map === this.lastSceneRev.map && r.player === this.lastSceneRev.player) return false
    this.lastSceneRev = { map: r.map, player: r.player }
    // only the cells the messages touched are built again; the rest of the level stands as it was
    this.scene = buildScene(this.state, this.gamedata, { previous: this.scene, dirty: { cells: this.state.dirtyCells, mapCleared: this.state.mapCleared } })
    this.scene.projectileTime = this.projectileTime
    this.scene.exploreStep = this.exploreStep
    this.exploreStep = undefined
    this.state.dirtyCells.clear()
    this.state.mapCleared = false
    this.emit({ type: 'scene', scene: this.scene })
    return true
  }

  get playing(): boolean {
    return this.state.phase === 'playing'
  }
  get watching(): boolean {
    return this.state.phase === 'watching' || !!this.state.watching
  }
}

function safeString(x: unknown): string {
  if (x instanceof Error) return x.message
  try {
    return typeof x === 'string' ? x : JSON.stringify(x)
  } catch {
    return String(x)
  }
}
