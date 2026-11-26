import { editTouchLayout } from './touch-layout-editor'
import { loadShortcuts, saveShortcuts } from './touch-shortcuts'
import { previewTouchShortcut } from './hud'
import { cm, gameLinkRows, gameLinkVersion, gameVersionRows, type GameLink, type GameState, type LobbyEntry } from '@orbrun/webtiles'
import { settingsPanel } from './settings-panel'
import { isSettingsSliderKey } from './keys'
import { trackPlayerEvent } from './analytics'
import { settingGroups, type SettingGroup } from './settings-rows'
import { controlsSheet } from './controls-sheet'
import { h, replace } from './dom'
import { activateMenuRow, FocusNav, type Focusable } from './focus'
import { MenuBackdrop } from './menu-backdrop'
import { HomeView, continueHint, homeGame, type HomeRow, type MainPage } from './menu-home'
import { installFullscreenButton } from './fullscreen'
import { MenuModal } from './menu-modal'
import about from '../../../ABOUT.md?raw'
import { renderMarkdown } from './markdown'
import { addServer, customServersAllowed, enterOffline, removeServer, openPage, characterOf, describeCharacter, describePlace, findServer, getChosenAccount, getDeviceAccount, getGames, getHomeServer, getLast, getMorgueDir, getOnlineAccount, listServers, loginState, OFFLINE_SERVER, leaveOffline, offlineOffered, offlineRuns, morgueUrlFor, sameAccount, savedLogin, setOnlineAccount, setHomeServer, setLast, setLoginServer, setMorgueDir, type Account, type LastCharacter, type MenuRoute, type Route, type ServerInfo } from './servers'
import { morgueDirGuesses, parseWhereis, saveWaiting, whereisUrl, type Whereis } from './whereis'
import { deviceDump, deviceMorgues, morgueDate, morgueStamp, parseMorgue, serverMorgue, serverMorgueHead, serverMorgues, type MorgueSummary } from './morgues'
import { morgueHtml } from './morgue-text'
import { MORGUES_PATH, RC_PATH, VERSIONS_PATH } from './site'
import type { Session } from './session'
import { browserRcBook, browserSaveBook, CHANNEL_NAMES, buildOf, profileSaveDir } from '@orbrun/offline'
import { engines, updateApp } from './engines'
import type { PadEvent, PadKind } from './gamepad'
import { Osk, oskPrompts } from './osk'
import { glyph, glyphName, type GlyphName } from './glyphs'
import { canQuit, quit } from './quit'
import { changelog, markNewsSeen, newsDoc, newsSeen, newsUnread } from './news'

/** What to do once a fresh connection is up: rejoin a game or a spectate. */
export type Intent = { kind: 'play'; gameId: string } | { kind: 'watch'; username: string }

/**
 * The front end's screens. Play, Watch and Settings are the sections the
 * shoulder buttons walk. Play also opens versions, RC files and morgues.
 */
export type View = MainPage | 'watch' | 'settings' | 'settings-group' | 'controls' | 'versions' | 'morgues' | 'rc' | 'servers' | 'add-server' | 'login' | 'register' | 'exit' | 'doc'

const SECTIONS: View[] = ['home', 'watch', 'settings']

function isMainPage(view: View): view is MainPage {
  return view === 'home' || view === 'play' || view === 'offline'
}

/** the way off a screen (`data-focus`) */
const BACK = 'back'

function cantRunOffline(): { sub: string; hint: string } {
  return { sub: 'Offline storage unavailable', hint: 'Open this site in a browser with service workers, IndexedDB and Web Locks enabled.' }
}

/** how long a server has to answer for an rc file before the editor says it did not */
const RC_MS = 10_000


/**
 * The rc file on show (showRc): whose, and which. A server keeps one file per
 * account and rc directory, named by the first game that reads it (GameLink
 * `rc`); a player on this device has one for every game (`gameId` null).
 */
interface RcEdit {
  account: Account
  gameId: string | null
  /** Restore focus to the action that opened the editor. */
  from: () => void
  text: HTMLTextAreaElement
  /** the file as the server has it, once read; the text differs from it when there is something to save */
  saved: string | null
  state: 'reading' | 'failed' | 'ready' | 'saving'
  /** a read is out, or has been: a screen redrawn meanwhile does not ask again */
  asked: boolean
  /** what the last read or save came to, over the rows */
  note: { text: string; error?: boolean } | null
  /** Back was pressed once with changes unsaved: once more leaves without them */
  leaving: boolean
}

/**
 * An account's Morgues (showMorgues): what has been read of them. A server's
 * are listed, then each row's head is read, newest first, a few at a time;
 * this device's are read whole at once.
 */
interface MorgueBook {
  account: Account
  /** `unlisted`: the server lists no morgue directory for the account that the proxy can read */
  state: 'listing' | 'reading' | 'ready' | 'none' | 'unlisted' | 'failed'
  /** the morgue directory on the server they are in */
  dir: string | null
  /** every game, newest first, with its head once read (and its whole text, on this device) */
  games: { file: string; summary: MorgueSummary | null; text?: string }[]
  /** how many older ones there are than the newest MORGUES_SHOWN */
  more: number
  sort: 'date' | 'score'
  aborter: AbortController
}

/** how many of an account's games Morgues lists: the newest */
const MORGUES_SHOWN = 500
/** how many heads are read at once */
const MORGUE_READERS = 4

/**
 * Put text on the clipboard: the Clipboard API, and where a browser refuses it (an older one, a page not served
 * securely) the selection of a box of it, as pages did before. False when neither would.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // and the old way
  }
  const box = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0;pointer-events:none' })
  box.value = text
  document.body.append(box)
  box.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  box.remove()
  return ok
}

/** A text file read through the shell's proxy; a status that is not success is the failure's words. */
async function fetchText(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

export type NavDir = 'up' | 'down' | 'left' | 'right'

const ARROW_DIRS: Record<string, NavDir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
/** the four vim keys the game moves with, minus the diagonals: the screens are a row / column grid */
const VIM_DIRS: Record<string, NavDir> = { k: 'up', j: 'down', h: 'left', l: 'right' }

/**
 * Where a key moves the cursor, or null when it is not a movement key. The
 * arrows work everywhere except that left and right are left to a text field,
 * so the caret can be moved; the vim keys (k up, j down, h left, l right, as
 * in the game) are letters, so a text field takes them all. Ctrl / Alt / Meta
 * combos are never movement.
 */
export function navDir(ev: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>, inInput: boolean): NavDir | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null
  const arrow = ARROW_DIRS[ev.key]
  if (arrow) return inInput && (arrow === 'left' || arrow === 'right') ? null : arrow
  if (inInput || ev.key.length !== 1) return null
  return VIM_DIRS[ev.key.toLowerCase()] ?? null
}

export interface FrontHooks {
  installPromotion?: HTMLElement
  /** whether a controller is connected: the message line then says which button opens the keyboard on a text field */
  padConnected?(): boolean
  /** which pad, for the controls sheet's glyphs */
  padKind?(): PadKind
  /** a session on `server` for `username` (none while an account is being added, or spectating without one); an open one is reused */
  connect(server: ServerInfo, username: string | null, intent?: Intent): Session
  /** the session on `server` for `username` that is up, or opening (the warm connection), if any */
  session?(server: ServerInfo, username: string | null): Session | null
  /** whether a connection that just closed will be opened again on its own (asked as the close lands) */
  retrying?(): boolean
  /** whether a connection that just closed was closed by the browser keeping the page for Back, and is reopened as it comes back: nothing to say */
  parked?(): boolean
  /**
   * The chosen account's connection again, when another has taken its place (the login of an account being
   * added opens one of its own): asked as its screens, home and Accounts, come back up
   */
  warm?(): void
  /** forget the login of `account` (its token and the server's cookie) and close its session */
  logout(account: Account, token: string | null): void
  play(session: Session, gameId: string): void
  watch(session: Session, username: string): void
  /** the screen on show is `r` now: the address bar says so, the connection stays */
  at(r: Route): void
  /** leave the app for one of the site's pages (site.ts), About & credits; servers.ts openPage when not given */
  page?(path: string): void
  /** a server's round trip in milliseconds for the server list, or null when it did not answer (ping.ts) */
  ping?(server: ServerInfo): Promise<number | null>
}

/** One line of a menu: what it says, what it does, what the message line says while the cursor is on it. */
interface Row extends HomeRow {
  /** filled in after the row is drawn, at the end of its note (a server's ping) */
  late?: HTMLElement
  hint?: string
  /** small print after the hint, fainter than it: which build an offline game plays */
  fine?: string
  /** a text field: the row is the prompt, X (or a click) types into it */
  input?: HTMLInputElement
  /** a file's worth of text (the rc file): the row is the box, Enter or A goes in to edit it and Esc or B comes out */
  text?: HTMLTextAreaElement
  /** the way in: where the cursor starts on this screen. It reads like every other row — the cursor is the only thing that lights up. */
  main?: boolean
  /** a group starts here: a little air above */
  gap?: boolean
  /** something here not yet seen (What's new since this release): a dot after the label */
  dot?: boolean
  /**
   * A small button in a row of them, rather than a line of its own: the
   * utilities under the way in, were they ever chips again.
   * Neighbouring chips share one focus row, so left and right walk them and a
   * pad reaches the bottom of the menu in two presses.
   */
  chip?: boolean
}

/**
 * The front end owns session actions and secondary screens. Each screen remembers
 * focus so the player can return to the control they used to open it.
 */
export class FrontEnd {
  root: HTMLElement
  private hooks: FrontHooks
  private nav = new FocusNav()
  private session: Session | null = null
  private unsub: (() => void) | null = null
  private unwatchEngines: () => void
  /**
   * `destroy` was called: the screen is off the page, and nothing that lands afterwards (a `.where` fetch
   * still in the air) may redraw it or follow a session on its behalf, which would keep it alive
   */
  private destroyed = false
  /** pulled on `destroy`, so the fetches in flight stop instead of finishing for a screen that is gone */
  private aborter = new AbortController()
  private _view: View = 'home'
  private mainPage: MainPage = 'home'
  private reloaded = false
  private error: string | null = null
  /** pad-driven keyboard for the login, register and add-server fields */
  private osk = new Osk(oskPrompts('Submit'), () => this.hooks.padKind?.() ?? 'generic')
  /** the silent recording behind the screens */
  private touchLayoutEditor?: HTMLDialogElement
  private media: MenuBackdrop
  private home: HomeView
  private modal: MenuModal | null = null
  private homeServer: ServerInfo | null = null
  private browsingServer: ServerInfo | null = null
  private homeServerProbe: 'idle' | 'pending' | 'done' = 'idle'
  private inlineLogin: Session | null = null
  private syncLoginForm: (() => void) | null = null
  /** what the settings screen goes back to: the screen it was opened from */
  private settingsFrom: (() => void) | null = null
  /** the settings group whose page is up (settings-rows.ts) */
  private settingsGroup: SettingGroup | null = null
  private refreshSettingsPanel: (() => void) | null = null
  /** the name last typed into the login form: a refused login keeps it, as the official form does */
  private loginName = ''
  /** the server picked for an account being added: the login and register screens are its */
  private adding: ServerInfo | null = null
  /** an account's Morgues, as read so far: kept while a morgue of them is read, so Back finds the list as it was */
  private morgues: MorgueBook | null = null
  /** the Morgues table on show, and its rows by file, each with what it read last time, so a row that reads the same is kept */
  private morgueTable: HTMLTableElement | null = null
  private morgueRows = new Map<string, { tr: HTMLTableRowElement; end: HTMLTableRowElement; sig: string }>()
  /** the rc file on show */
  private rc: RcEdit | null = null
  private versionsAccount: Account | null = null
  /** a host half typed into Add a server, kept across a redraw that says what was wrong with it */
  private serverDraft = ''
  /** the server picked to watch on without an account */
  private watchOn: ServerInfo | null = null
  /** what a screen held last time it was drawn: the same again, and it is left alone */
  private shape = new Map<View, string>()
  /** the redraw waiting for the next frame: the server's messages come in bursts, and one redraw serves them all */
  private frame = 0
  /** the message line of the screen on show */
  private msg: HTMLElement | null = null
  /** where the cursor stood on each screen when it was left: the row's id, so a list that changed still finds it */
  private marks = new Map<View, string>()
  /**
   * the roster: the rows on show by lobby entry (a player can run a game of
   * each version at once, so the name is not the key), each with its details
   * row and what it read last time, so a row that reads the same is kept
   */
  private rosterRows = new Map<number, { tr: HTMLTableRowElement; dt: HTMLTableRowElement; sig: string }>()
  /** the entries the roster shows: arrivals are held back from the table until the player asks for them (Y) */
  private rosterSeen = new Set<number>()
  private rosterTable: HTMLTableElement | null = null
  /** the rows whose details are opened (narrow screens: the extra columns as a second line) */
  private detailsOpen = new Set<number>()
  private legend: HTMLElement | null = null
  /** the document on show (a morgue file): its scroll region, which up and down move */
  private docScroller: HTMLElement | null = null
  /** what the document goes back to: the screen it was opened from */
  private docFrom: (() => void) | null = null
  /** The initial draw leaves the URL in place for the caller that opened the shell. */
  private here = JSON.stringify(getChosenAccount()?.serverId === OFFLINE_SERVER.id ? { kind: 'menu', path: 'offline' } : { kind: 'home' })

  constructor(host: HTMLElement, hooks: FrontHooks) {
    this.hooks = hooks
    this.root = h('div', { class: 'screen home' })
    host.append(this.root)
    this.root.addEventListener('focusin', this.onNativeFocus)
    this.root.addEventListener('pointerdown', () => this.root.removeAttribute('data-pad-focus'), true)
    this.media = new MenuBackdrop(this.root)
    window.addEventListener('orbrun-settings', () => this.refreshSettingsPanel?.(), { signal: this.aborter.signal })
    this.home = new HomeView({
      server: id => {
        const server = findServer(id)
        if (!server || server.offline) return
        this.homeServerProbe = 'done'
        this.inlineLogin = null
        setHomeServer(id)
        const account = getOnlineAccount()
        this.browsingServer = account?.serverId === id ? null : server
        this.showHome()
      },
      login: (name, password) => {
        const server = this.homeServer
        if (!server || !name || !password) return false
        const chosen = this.browsingServer ? null : this.chosen()
        const s = this.ensureSession(server, chosen?.account.username ?? null)
        if (!s.conn.open || s.loggingIn || s.state.lobby.username) { this.showHome(); return false }
        this.loginName = name
        this.inlineLogin = s
        s.send(cm.login(name, password))
        this.showHome()
        return true
      },
      logout: () => {
        const account = getChosenAccount()
        if (!account) return
        const token = savedLogin(account.serverId, account.username)?.token ?? null
        setOnlineAccount(null)
        this.unsub?.()
        this.unsub = null
        this.session = null
        this.hooks.logout(account, token)
        this.homeRoute('username')
      },
      register: () => { this.adding = this.homeServer; this.showRegister() },
      quit: () => this.quit(),
      about: () => this.showAbout(), news: () => this.showNews(),
    }, hooks.installPromotion)
    installFullscreenButton(this.home.el, this.aborter.signal)
    // an offline build checked for, downloading, or new is said on its game's row
    this.unwatchEngines = engines.onChange(() => {
      if (this._view === 'offline') this.showHome()
    })
    window.addEventListener('focus', () => {
      if (this._view === 'home' && offlineRuns()) void this.refreshOfflineContinue()
    }, { signal: this.aborter.signal })
    if (offlineRuns()) {
      const recheckOffline = () => {
        if (this._view === 'offline' && !document.hidden) void this.refreshOffline(false)
      }
      document.addEventListener('visibilitychange', recheckOffline, { signal: this.aborter.signal })
      navigator.serviceWorker?.addEventListener('controllerchange', recheckOffline, { signal: this.aborter.signal })
    }
    // back online: a look for new builds that found no connection goes again, on the home screen now or the next time
    // it comes up; and the home screen's word on the connection follows the network both ways
    window.addEventListener(
      'online',
      () => {
        if (this.homeServer?.offline && offlineRuns()) void this.refreshOffline()
        if (isMainPage(this._view)) this.showHome()
      },
      { signal: this.aborter.signal },
    )
    window.addEventListener('offline', () => isMainPage(this._view) && this.showHome(), { signal: this.aborter.signal })
    // onto Wi-Fi: an update held back on mobile data comes down now, or the next time this screen comes up

    this.showHome()
  }

  destroy() {
    this.destroyed = true
    this.touchLayoutEditor?.close()
    this.aborter.abort()
    this.unsub?.()
    this.unwatchEngines()
    if (this.frame) cancelAnimationFrame(this.frame)
    this.osk.detach()
    this.modal?.destroy(false)
    this.media.destroy()
    this.root.remove()
  }

  get view(): View {
    return this._view
  }

  /** Whether B goes anywhere: every screen but the bare home screen (back.ts lets Android's back leave the app there). */
  get goesBack(): boolean {
    return !!this.modal || this._view !== 'home' || this.osk.visible
  }

  // ------------------------------------------------------------------ input

  /** The element the cursor is on. */
  private get focused(): HTMLElement | null {
    const el = this.nav.current()?.el
    return el?.querySelector<HTMLInputElement>('input:not([type="range"])') ?? el ?? null
  }

  /**
   * A pad event, by precedence: a dialog the server put up takes any press;
   * the on-screen keyboard takes everything while it is open; then the
   * screen: the stick and d-pad move the cursor, A chooses, B goes back, X types, Y
   * brings the roster's arrivals in, the shoulders walk the sections, and
   * Start confirms like Enter.
   */
  pad(ev: PadEvent) {
    if (this.touchLayoutEditor?.open) {
      if (ev.type === 'press' && ev.button === 'B') this.touchLayoutEditor.close()
      return
    }
    if (ev.type === 'press' || (ev.type === 'dir' && ev.dir !== null)) {
      this.root.toggleAttribute('data-pad-focus', !ev.touch)
    }
    if (this.modal) return this.modal.pad(ev)
    if (ev.type === 'pan') {
      // a document takes the right stick as its scroll; other screens leave the scenery fixed
      if (this.docScroller) this.scrollDoc(ev.dy * 12)
      else if (this._view === 'rc' && this.rc) this.rc.text.scrollTop += ev.dy * 12
      return
    }
    if (this.osk.visible) {
      if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.osk.op('move', ev.dir)
      else if (ev.type === 'press') {
        if (ev.button === 'A') this.osk.op('type')
        else if (ev.button === 'B' || ev.button === 'SELECT') this.osk.op('cancel')
        else if (ev.button === 'X') this.osk.op('backspace')
        else if (ev.button === 'Y' || ev.button === 'START') this.osk.op('submit')
        else if (ev.button === 'LB') this.osk.op('shift')
        else if (ev.button === 'RB') this.osk.op('space')
      }
      return
    }
    if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.dir(ev.dir)
    else if (ev.type === 'press') {
      if (ev.button === 'A') this.activate(true)
      else if (ev.button === 'B') this.back()
      else if (ev.button === 'X') {
        // nothing to type into on the front screen: X is the settings there, as it opens the keyboard everywhere else
        if (this._view === 'home') this.showSettings(() => this.showHome())
        else this.openOsk()
      } else if (ev.button === 'Y') {
        if (!this.resetSettingRow()) this.takeArrivals()
      }
      else if (ev.button === 'LB') this.section(-1)
      else if (ev.button === 'RB') this.section(1)
      else if (ev.button === 'START') this.confirm()
    }
  }

  private dir(d: number) {
    if (d === 0 || d === 7 || d === 1) this.up('up')
    else if (d === 4 || d === 3 || d === 5) this.up('down')
    else if (d === 2) this.side(1)
    else if (d === 6) this.side(-1)
  }

  /** Up or down: a document scrolls, otherwise the cursor moves (What's new's releases are rows). */
  private up(dir: 'up' | 'down') {
    if (this.docScroller) this.scrollDoc(dir === 'up' ? -this.docStep() : this.docStep())
    else this.nav.move(dir)
  }

  /** one press of up or down on a document: a fifth of what is in view, never less than a line or two */
  private docStep(): number {
    return Math.max(48, Math.round((this.docScroller?.clientHeight ?? 0) / 5))
  }

  private scrollDoc(by: number) {
    const el = this.docScroller
    if (!el) return
    el.scrollTop = Math.max(0, el.scrollTop + by)
  }

  /** Native Tab, pointer and assistive-technology focus share the pad's cursor. */
  private onNativeFocus = (ev: FocusEvent) => {
    const target = ev.target as HTMLElement
    if (target.matches('.account-bar :is(input, select)')) this.homeServerProbe = 'done'
    const at = this.navItems.findIndex((f) => f.el === target || f.el.contains(target))
    if (at >= 0 && this.nav.current() !== this.navItems[at]) this.nav.focus(at)
  }

  /** Make non-native rows tabbable, and give pad moves real browser focus. */
  private prepareFocus(items: Focusable[]) {
    for (const f of items) {
      const input = f.el.querySelector<HTMLInputElement>('input:not([type="range"])')
      const target = input ?? f.el
      if (target.tabIndex < 0) target.tabIndex = 0
      const onFocus = f.onFocus
      f.onFocus = () => {
        onFocus?.()
        // a box being typed in keeps the caret: the row it stands in is the cursor's already
        if (!target.contains(document.activeElement)) target.focus({ preventScroll: true })
      }
    }
    this.navItems = items
  }

  /** Keyboard. Returns true when the key was taken. */
  key(ev: KeyboardEvent): boolean {
    if (this.touchLayoutEditor?.open) return false
    this.root.removeAttribute('data-pad-focus')
    if (this.modal) return this.modal.key(ev)
    if (this.osk.visible) {
      if (ev.key === 'Escape') {
        this.osk.detach()
        return true
      }
      return false
    }
    const target = ev.target as HTMLElement | null
    // Ctrl+S (⌘S) saves the rc file, in the box or out of it, rather than the page
    if (this._view === 'rc' && (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 's') {
      ev.preventDefault()
      void this.saveRc()
      return true
    }
    // in the box, every key is the text's but the one out of it
    if (target instanceof HTMLTextAreaElement) {
      if (ev.key !== 'Escape') return false
      this.stopEditing()
      ev.preventDefault()
      return true
    }
    // Browser shortcuts (including modified Enter on a link) belong to the browser.
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.key === 'Tab') return false
    if (isSettingsSliderKey(ev)) return false
    if ((target instanceof HTMLInputElement || target instanceof HTMLSelectElement) &&
        (isMainPage(this._view) || target.closest('.menu-replay-controls'))) return false
    if (ev.key === 'Backspace' && this.resetSettingRow()) {
      ev.preventDefault()
      return true
    }
    const inInput = target instanceof HTMLInputElement
    const dir = navDir(ev, inInput)
    if (dir) {
      if (dir === 'up' || dir === 'down') this.up(dir)
      else this.side(dir === 'right' ? 1 : -1)
      ev.preventDefault()
      return true
    }
    // Native buttons and links handle Enter/Space themselves, exactly once.
    if ((ev.key === 'Enter' || ev.key === ' ') && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) return false
    if (ev.key === 'Enter' || (ev.key === ' ' && !inInput)) {
      if (inInput && (target as HTMLInputElement).form) (target as HTMLInputElement).form!.requestSubmit()
      else this.activate()
      ev.preventDefault()
      return true
    }
    if (ev.key === 'Escape') {
      this.back()
      return true
    }
    if ((ev.key === 'y' || ev.key === 'Y') && !inInput && this._view === 'watch') {
      this.takeArrivals()
      return true
    }
    if (ev.key === 'PageUp' || ev.key === 'PageDown') {
      if (inInput) return false
      // a document pages; elsewhere the keys walk the sections as the shoulders do
      if (this.docScroller) this.scrollDoc((ev.key === 'PageUp' ? -1 : 1) * Math.max(48, this.docScroller.clientHeight - 48))
      else this.section(ev.key === 'PageUp' ? -1 : 1)
      ev.preventDefault()
      return true
    }
    if ((ev.key === 'Home' || ev.key === 'End') && this.docScroller && !inInput) {
      this.docScroller.scrollTop = ev.key === 'Home' ? 0 : this.docScroller.scrollHeight
      ev.preventDefault()
      return true
    }
    return false
  }

  private resetSettingRow(): boolean {
    const reset = this.nav.current()?.el.querySelector<HTMLButtonElement>('.setting-reset')
    reset?.click()
    return !!reset
  }

  /** Left or right: a setting turns, a roster row opens or closes its details, otherwise the cursor moves along the row. */
  private side(d: number) {
    const cur = this.nav.current()
    if (!cur) return
    const id = cur.id ?? ''
    if (cur.el.dataset.hotkey !== undefined && cur.el.classList.contains('row')) {
      cur.el.dispatchEvent(new CustomEvent('adjust', { detail: d }))
      this.say(cur.el.dataset.hint)
      return
    }
    if (id.startsWith('watch:')) {
      this.details(Number(id.slice(6)), d > 0)
      return
    }
    this.nav.move(d > 0 ? 'right' : 'left')
  }

  /** Choose the row under the cursor. A box of text is gone into: with the on-screen keyboard from a pad, straight to its caret from a keyboard. */
  private activate(fromPad = false) {
    const cur = this.nav.current()
    if (!cur) return
    const text = cur.el.querySelector('textarea')
    if (text) {
      if (fromPad) this.typeText(text)
      else this.editText(text)
    } else if (cur.el instanceof HTMLInputElement || cur.el instanceof HTMLTextAreaElement) this.openOsk()
    else cur.activate()
  }

  /** Start is Enter: submit a focused form rather than opening its keyboard. */
  private confirm() {
    const el = this.focused
    if (el instanceof HTMLTextAreaElement) {
      el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else if (el instanceof HTMLInputElement && el.form) el.form.requestSubmit()
    else this.activate(true)
  }

  /** Open the on-screen keyboard on the focused field, if the focus is on one. */
  private openOsk() {
    const text = this.nav.current()?.el.querySelector('textarea')
    if (text) return this.typeText(text)
    const el = this.focused
    if (!(el instanceof HTMLInputElement)) return
    const input = el
    this.osk.attach(
      {
        input,
        submit: () => {
          this.osk.detach()
          if (input.form) input.form.requestSubmit()
          else this.nav.move('down')
        },
        cancel: () => this.osk.detach(),
      },
      this.root,
    )
  }

  /** Into a box of text from a keyboard: the caret goes in, and the keys are the text's until Esc. */
  private editText(text: HTMLTextAreaElement) {
    if (text.readOnly) return
    text.focus({ preventScroll: true })
  }

  /** Into a box of text from a pad: the on-screen keyboard, with a key for a new line; Y or B comes back out. */
  private typeText(text: HTMLTextAreaElement) {
    if (text.readOnly) return
    this.osk.attach({ input: text, extras: [{ ch: '\n', label: 'New line' }], submit: () => this.stopEditing(), cancel: () => this.stopEditing() }, this.root)
  }

  /** Out of the box: the cursor is on its row again, and up and down move it. */
  private stopEditing() {
    this.osk.detach()
    const cur = this.nav.current()
    if (!cur) return
    if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur()
    cur.el.focus({ preventScroll: true })
  }

  /** The next or previous section: Play (the home screen), Watch, Settings. Inert off the sections and in a flow. */
  private section(d: number) {
    const v: View = this._view === 'play' ? 'home'
      : this._view === 'controls' || this._view === 'settings-group' ? 'settings' : this._view
    const i = SECTIONS.indexOf(v)
    if (i < 0) return
    const next = SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length]
    if (next === 'home') this.homeRoute()
    else if (next === 'watch') this.showWatch()
    else this.showSettings(() => this.homeRoute('settings'))
  }

  private back() {
    if (this.modal) return this.closeModal()
    this.osk.detach()
    const v = this._view
    if (v === 'home') return
    if (v === 'play' || v === 'offline') return this.homeRoute(v)
    if (v === 'settings') {
      const from = this.settingsFrom
      this.settingsFrom = null
      if (from) from()
      else this.showHome()
    } else if (v === 'controls') this.showSettingsGroup('Controls')
    else if (v === 'settings-group') this.showSettings(this.settingsFrom ?? undefined)
    else if (v === 'doc') {
      const from = this.docFrom
      this.docFrom = null
      if (from) from()
      else this.showHome()
    } else if (v === 'watch') this.homeRoute('watch')
    else if (v === 'versions') this.showHome('versions')
    else if (v === 'morgues') {
      this.leaveMorgues()
      this.showHome('morgues')
    } else if (v === 'rc') this.leaveRc()
    else if (v === 'exit') {
      // the screen behind the dialog is still the one to show: it is drawn again as it was (the shape it was
      // drawn from is kept, so it comes back as a redraw and does not play its way in a second time)
      if (this.session) this.session.state.exit = null
      this.showHome()
    } else if (v === 'servers') this.homeRoute('watch')
    else if (v === 'add-server') {
      this.serverDraft = ''
      this.showServers('add-server')
    } else if (v === 'login') this.cancelAuth()
    else if (v === 'register') this.showLogin()
  }

  /**
   * Redraw the screen on show without moving the cursor: the home screen (the
   * account's login, the game list, the notices) and the roster.
   * Called on every message of the connection, so each is guarded: nothing is
   * redrawn while it would read the same.
   */
  refresh() {
    if (this.destroyed) return
    if (isMainPage(this._view)) this.showHome()
    else if (this._view === 'watch') this.showWatch()
    else if (this._view === 'versions' && this.versionsAccount) this.showVersions(this.versionsAccount)
    else if (this._view === 'morgues' && this.morgues) this.showMorgues(this.morgues.account)
    else if (this._view === 'rc' && this.rc) this.showRc(this.rc.account, this.rc.gameId)
  }

  /** A redraw on the next frame: a burst of messages (the roster on arrival) is drawn once. */
  private schedule() {
    if (this.frame || this.destroyed) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.refresh()
    })
  }

  // ------------------------------------------------------------------ screens

  /** Leave the screen on show: remember the row the cursor was on, put the keyboard away. */
  private setView(v: View, cls: string) {
    this.touchLayoutEditor?.close()
    this.syncLoginForm = null
    this.refreshSettingsPanel = null
    if (this.modal && !isMainPage(v)) this.closeModal(false)
    const cur = this.nav.current()
    if (cur) this.marks.set(this._view, cur.id ?? cur.label)
    this.osk.detach()
    this.docScroller = null
    if (v !== this._view) this.shape.delete(v)
    this._view = v
    this.root.className = 'screen home polished-shell ' + cls
    this.media.cover(!!this.modal || (!isMainPage(v) && !['settings', 'settings-group', 'controls'].includes(v)))
    if (v !== 'watch') {
      this.rosterRows.clear()
      this.rosterSeen.clear()
      this.rosterTable = null
    }
    if (v !== 'rc') this.rc = null
    if (v !== 'morgues') {
      this.morgueRows.clear()
      this.morgueTable = null
    }
  }

  /** Put the screen on show in the address bar, unless it is there already; `force` says it again whatever it said last. */
  private at(r: Route, force = false) {
    const key = JSON.stringify(r)
    if (!force && key === this.here) return
    this.here = key
    this.hooks.at(r)
  }

  /**
   * Open the screen an address names (parseRoute): a reload, a link, Back or
   * Forward. A name it does not know is the nearest screen that it does.
   */
  open(r: MenuRoute) {
    if (this.modal) this.closeModal(false)
    const [root, sub, leaf] = r.path.split('/')
    if (root === 'play') return this.showPlay()
    if (root === 'offline' && offlineOffered()) return this.showOffline()
    if (root === 'login' || root === 'register') {
      const server = r.serverId ? findServer(r.serverId) : null
      if (!server || server.offline) return this.showHome()
      leaveOffline()
      this.mainPage = 'play'
      this.browsingServer = null
      const account = getOnlineAccount()
      this.adding = account && server.id === account.serverId &&
        (!r.username || sameAccount(account, { serverId: server.id, username: r.username })) && root === 'login' ? null : server
      this.loginName = r.username ?? ''
      if (root === 'register') this.showRegister()
      else this.showLogin()
      return
    }
    if (root === VERSIONS_PATH || root === RC_PATH || root === MORGUES_PATH) {
      const offline = r.serverId === OFFLINE_SERVER.id
      const account = offline && offlineOffered() ? getDeviceAccount() : getOnlineAccount()
      if (!account || account.serverId !== r.serverId ||
        (r.username && !sameAccount(account, { serverId: account.serverId, username: r.username }))) return this.showHome()
      if (offline) enterOffline()
      else leaveOffline()
      this.mainPage = offline ? 'offline' : 'play'
      this.browsingServer = null
      if (root === VERSIONS_PATH) return this.showVersions(account)
      if (root === RC_PATH) return this.showRc(account, r.gameId ?? null)
      return r.morgue ? this.showMorgue(account, r.morgue) : this.showMorgues(account)
    }
    if (root === 'settings') {
      // `camera` is the View tab's address from before it was named so (2026-10-17)
      const named = sub === 'camera' ? 'view' : sub
      const group = settingGroups().find((g) => g.group.toLowerCase() === named)?.group
      if (group === 'Controls' && leaf === 'gamepad') this.showControls()
      else if (group) this.showSettingsGroup(group)
      else this.showSettings(() => this.homeRoute('settings'))
    } else if (root === 'whats-new' || root === 'about' && sub === 'new') this.showNews()
    else if (root === 'about') this.showAbout()
    else if (root === 'watch') {
      if (sub === 'add') this.showAddServer()
      else this.showServers()
    } else this.showHome()
  }

  /** The screen's frame in the safe area, over the room; the room stays where it is. */
  private screen(cls: string, content: (HTMLElement | null)[]) {
    const keep: HTMLElement[] = [this.media.el]
    for (const child of Array.from(this.root.children)) if (!keep.includes(child as HTMLElement)) child.remove()
    for (const el of keep) if (el.parentNode !== this.root) this.root.append(el)
    // the first screen of a visit has no screen before it to move in from: it is simply there
    const first = !this.arrived
    this.arrived = true
    this.root.append(h('div', { class: 'frame menu-frame ' + cls + (first ? ' still' : '') }, ...content))
  }

  /** a screen has been drawn this visit (`screen`) */
  private arrived = false

  /** The heading and descriptive line for a secondary screen. */
  private head(title: string, lede: string | null): HTMLElement {
    return h('div', { class: 'head' }, h('h1', { class: 'place' }, title), lede ? h('div', { class: 'lede' }, lede) : null)
  }

  /** The message line: what the row under the cursor is, said the way the game says what is underfoot. */
  private say(text: string | undefined, fine?: string) {
    const m = this.msg
    if (!m) return
    const t = (text ?? '') + (fine ? '\n' + fine : '')
    if (m.dataset.said === t) return
    // a redraw (the roster's count changing under the cursor, a download's small print counting up) hands a
    // fresh line the same words: they stand as they were, without playing the fade-in again
    const same = (text ?? '') === this.said
    this.said = text ?? ''
    m.dataset.said = t
    replace(m, text ?? '', ...(fine ? [h('span', { class: 'fine' }, fine)] : []))
    m.classList.remove('said')
    if (t && !same) {
      void m.offsetWidth
      m.classList.add('said')
    }
  }

  /** the words the message line last said, kept across redraws so they do not fade in twice */
  private said = ''

  private rows: Row[] = []

  /** A row as a button: the marker in the margin, the label, the note on the right. */
  private item(r: Row): HTMLElement {
    return h(
      'button',
      { type: 'button', class: 'item' + (r.main ? ' main' : '') + (r.off ? ' off' : '') + (r.gap && !r.chip ? ' gap' : '') + (r.chip ? ' chip' : ''), dataset: { focus: r.id, marker: r.marker ?? '' }, onclick: () => this.click(r) },
      h('span', { class: 'marker' }),
      h('span', { class: 'label' }, r.label, r.dot ? h('span', { class: 'dot', role: 'img', 'aria-label': 'new' }) : null),
      r.sub ? h('span', { class: 'sub' }, r.sub, r.late ?? null) : null,
    )
  }

  private click(r: Row) {
    const at = this.navItems.findIndex((f) => f.id === r.id)
    if (at >= 0) this.nav.focus(at)
    r.fn?.()
  }

  private navItems: Focusable[] = []

  /**
   * Draw a list screen: the head, the notices, the rows with whatever stands
   * beside them, the message line, and anything under (the roster). The
   * cursor starts on the row the screen was left on, else where the caller
   * says, else the first row past Back.
   */
  private list(opts: { cls: string; title: string; lede?: string | null; rows: Row[]; notices?: HTMLElement[]; below?: HTMLElement[]; extra?: Focusable[]; wrap?: (list: HTMLElement) => HTMLElement; focus?: string; over?: boolean }): HTMLElement {
    this.rows = opts.rows
    const items: Focusable[] = []
    const list = h('nav', { class: 'menu menu-actions', 'aria-label': opts.title })
    /** the row of chips being filled, and the focus row they share */
    let chips: { el: HTMLElement; row: number; n: number } | null = null
    opts.rows.forEach((r, i) => {
      if (r.chip) {
        // a run of chips is one line on screen and one row under the cursor: left and right walk it
        if (!chips) {
          const el = h('div', { class: 'chips' + (r.gap ? ' gap' : '') })
          list.append(el)
          chips = { el, row: i, n: 0 }
        }
        const el = this.item(r)
        chips.el.append(el)
        items.push({ id: r.id, label: r.label, el, row: chips.row, col: chips.n++, activate: () => r.fn?.(), onFocus: () => this.onRow(r, el) })
        return
      }
      chips = null
      if (r.text) {
        const box = h('div', { class: 'item text-item' + (r.gap ? ' gap' : ''), dataset: { focus: r.id }, 'aria-label': r.label }, r.text)
        list.append(box)
        items.push({ id: r.id, label: r.label, el: box, row: i, activate: () => this.editText(r.text!), onFocus: () => this.onRow(r, box) })
        return
      }
      if (r.input) {
        const field = h('label', { class: 'item field-item' + (r.gap ? ' gap' : ''), dataset: { focus: r.id } }, h('span', { class: 'marker' }), h('span', { class: 'label' }, r.label), r.input)
        r.input.dataset.focus = r.id
        list.append(field)
        items.push({ id: r.id, label: r.label, el: field, row: i, activate: () => this.openOsk(), onFocus: () => this.onRow(r, field) })
        return
      }
      const el = this.item(r)
      const line = h('div', { class: 'line' }, el, ...(r.also ?? []).map((a) => a.href
        ? h('a', { class: 'item beside', href: a.href, target: '_blank', rel: 'noopener noreferrer', title: a.title ?? '', dataset: { focus: a.id } }, h('span', { class: 'label' }, a.label))
        : h('button', { type: 'button', class: 'item beside', title: a.title ?? '', 'aria-label': a.ariaLabel, dataset: { focus: a.id }, onclick: a.fn }, h('span', { class: 'label' }, a.label))))
      list.append(line)
      items.push({ id: r.id, label: r.label, el, row: i, col: 0, activate: () => r.fn?.(), onFocus: () => this.onRow(r, el) })
      r.also?.forEach((a, k) => {
        const bel = line.children[k + 1] as HTMLElement
        items.push({ id: a.id, label: a.label, el: bel, row: i, col: k + 1, activate: a.href ? () => bel.click() : () => a.fn?.(), onFocus: () => this.say(a.title) })
      })
    })
    const body = opts.wrap ? opts.wrap(list) : list
    const error = this.error ? h('div', { class: 'error' }, this.error) : null
    this.error = null
    this.msg = h('div', { class: 'menu-msg', 'aria-live': 'polite' })
    this.legend = h('div', { class: 'legend', 'aria-label': 'Menu controls' })
    this.updateInputHints()
    const brand = h('div', { class: 'brand' }, this.head(opts.title, opts.lede ?? null), error, ...(opts.notices ?? []), body, ...(opts.below ?? []), this.msg, this.legend)
    const all = [...items, ...(opts.extra ?? [])]
    // a dialog (the exit report) is laid over the screen that is already up, which keeps its place behind it;
    // the next screen drawn clears both, as it clears everything but the room
    if (opts.over) {
      // the cursor is the dialog's while it is up: the row it stood on behind keeps its place, not its bar
      for (const lit of Array.from(this.root.querySelectorAll('.focused'))) lit.classList.remove('focused')
      this.root.append(h('div', { class: 'frame menu-frame dialog-over ' + opts.cls }, h('div', { class: 'dialog-card' }, brand)))
    } else this.screen(opts.cls, [brand])
    this.prepareFocus(all)
    // Back is never where the cursor lands on its own: a screen drawn before its rows arrived
    // (Play while connecting) stood on Back, and the redraw that brings the rows must not stay there
    const want = opts.focus ?? this.marks.get(this._view)
    let at = want && want !== BACK ? all.findIndex((f) => f.id === want) : -1
    if (at < 0) at = all.findIndex((f) => f.id !== BACK)
    this.nav.set(all, this._view, { wrap: true, keepColumn: true }, at < 0 ? 0 : at, true)
    const cur = this.nav.current()
    if (cur) {
      if (cur.el instanceof HTMLInputElement) cur.el.focus()
      cur.onFocus?.()
      // a row asked for by name (a server just added, at the foot of a long list) is brought into view
      if (opts.focus && cur.id === opts.focus) cur.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
    return brand
  }

  /** Menu hints are refreshed by the same lifecycle as gameplay hints. */
  updateInputHints() {
    if (this.legend) replace(this.legend)
  }

  /** The cursor landed on a row: say what it is, unless the row says it already, and give a field the caret. */
  private onRow(r: Row, el: HTMLElement) {
    this.say(r.hint === r.sub ? '' : r.hint, r.fine)
    if (r.input) r.input.focus()
    // a field elsewhere lets go of the caret; the row's own box (clicked into) keeps it
    else if ((document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) && !el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }

  /** The chosen account, and its server, when both are known. */
  private chosen(): { account: Account; server: ServerInfo } | null {
    const account = getChosenAccount()
    const server = account ? findServer(account.serverId) : null
    return account && server ? { account, server } : null
  }

  /** The session up (or opening) on `server` for `username`, if any: the warm connection, followed from here on. */
  private sessionOn(server: ServerInfo | null, username: string | null): Session | null {
    if (!server) return null
    const s = this.hooks.session?.(server, username) ?? null
    if (s && s !== this.session) this.follow(s)
    return s ?? (this.session && !this.session.closed && this.session.server.id === server.id && (this.session.username ?? null) === username ? this.session : null)
  }

  /** The games a server offers: the live list, or the one kept from last time. */
  private games(server: ServerInfo, s: Session | null): GameLink[] | null {
    const lobby = s?.conn.open ? s.state.lobby : null
    return lobby?.games.length ? lobby.games : getGames(server.id)
  }

  /**
   * Who waits in a game, when the server is the one saying so, in the order the answers are worth: the lobby's
   * own word (game_links.html save_info, "orbruntest, a level 3 Minotaur Berserker of Trog", less the
   * account's name at its head); the roster, when the account's own game is still open on the server (a socket
   * that dropped, another tab); and `<player>.where`, which crawl rewrites on every save and every death
   * (whereis.ts). Null otherwise, and the row reads Play.
   *
   * What this device saw there last is deliberately not a source. An account is one account everywhere: a save
   * this browser remembers can have been played out and died in another, and the WebTiles socket cannot be
   * asked (CDI keeps its save info to itself, checked again 2026-09-12), so remembering it here would promise
   * a character who is gone. The `.where` file is the same question asked of the server instead.
   */
  private saveOf(g: GameLink, version: string | null, who: string | null, s: Session | null, where: Whereis | null): { sub: string; hint: string; character?: LastCharacter } | null {
    const stairs = (c: LastCharacter) => 'Down the stairs to your game.' + (describePlace(c) ? ` ${describePlace(c)} lies below.` : '')
    if (g.save && g.save !== 'playing' && g.save !== 'slot full') {
      return { sub: who && g.save.startsWith(who + ', ') ? g.save.slice(who.length + 2) : g.save, hint: 'Down the stairs to your game.' }
    }
    const open = this.ownGame(s, who, g.id)
    if (open) {
      const live = characterOf(open)
      return { sub: describeCharacter(live), character: live, hint: 'Down the stairs to your game, still open on the server.' + (describePlace(live) ? ` ${describePlace(live)} lies below.` : '') }
    }
    // one `.where` per player, rewritten by whichever game ran last: it answers for its own version and says
    // nothing about any other, so a row of a different version is left unanswered rather than guessed at
    if (where && version && where.version === version && saveWaiting(where)) return { sub: describeCharacter(where.character), character: where.character, hint: stairs(where.character) }
    return null
  }

  private onlineContinue(s: Session, who: string): string | null {
    const games = s.state.lobby.games.filter(g => !g.disabled && g.save !== 'slot full')
    if (!games.length) return null
    const where = this.whereFor(s.server, who)
    const version = where?.version ?? null
    // One .where describes one game. Use the plain game for that version, as in Versions & modes.
    const whereGame = version && gameVersionRows(games).find(row => row.version === version)?.game
    return continueHint(games.flatMap(game => {
      const save = this.saveOf(game, game === whereGame ? version : null, who, s, where)
      return save ? [{ label: game.label, ...save }] : []
    }))
  }

  /**
   * What the server says is waiting in an account's save (`<player>.where`, whereis.ts), read in the
   * background: the screen draws without it and is redrawn when it lands. Asked again no more than once a
   * minute while the home screen stands, so a character killed in another browser stops being offered here
   * without waiting for a reload, and dropped outright on the way back from a game (`attach`).
   */
  private whereis = new Map<string, Whereis | null>()
  /** a game's connection dropped and brought the player here (main.ts `scheduleRetry`): said until the next game */
  private lost = false
  private asked = new Map<string, number>()
  private static readonly WHEREIS_MS = 60_000

  private whereFor(server: ServerInfo, who: string | null): Whereis | null {
    // a profile's saves are on this device, and the game links say what is in them (@orbrun/offline SaveBook)
    if (!who || server.offline) return null
    const key = server.id + '/' + who.toLowerCase()
    const at = this.asked.get(key)
    if (at === undefined || Date.now() - at > FrontEnd.WHEREIS_MS) {
      this.asked.set(key, Date.now())
      void this.readWhereis(server, who, key)
    }
    return this.whereis.get(key) ?? null
  }

  /**
   * Fetch the `.where` from the morgue directory `game_ended` named, or from the layouts dgamelaunch-config
   * ships with until one answers. A server that answers none of them is remembered as such ('' in
   * `setMorgueDir`), so the tries are made once and not on every redraw; a directory already known is trusted
   * through a failure, which is more likely the network than a server that moved its morgues.
   */
  private async readWhereis(server: ServerInfo, who: string, key: string) {
    const known = getMorgueDir(server.id, who)
    if (known === '') return
    for (const dir of known ? [known] : morgueDirGuesses(who)) {
      const url = whereisUrl(server, dir)
      if (!url) continue
      let text: string
      try {
        const r = await fetch(url, { signal: this.aborter.signal })
        if (!r.ok) continue
        text = await r.text()
      } catch {
        // no network (the line that just dropped a game, say) is no answer: the next redraw asks again
        this.asked.delete(key)
        return
      }
      // landed for a screen that is gone (the abort came between the bytes and here): it is nobody's news
      if (this.destroyed) return
      const w = parseWhereis(text)
      if (!w) continue
      if (!known) setMorgueDir(server.id, who, dir)
      const before = this.whereis.get(key)
      this.whereis.set(key, w)
      // a redraw only when the screen would read differently: this runs again every minute
      if (!before || before.status !== w.status || before.version !== w.version || describeCharacter(before.character) !== describeCharacter(w.character)) this.refresh()
      return
    }
    if (!known) setMorgueDir(server.id, who, '')
  }

  /** The roster's line for the account's own game `gameId`, when the server lists one: a game of theirs still running there. */
  private ownGame(s: Session | null, who: string | null, gameId: string): LobbyEntry | null {
    if (!who || !s?.conn.open) return null
    const name = who.toLowerCase()
    for (const e of s.state.lobby.entries.values()) if (e.game_id === gameId && e.username.toLowerCase() === name) return e
    return null
  }

  /** Draw the main menu or the selected Play submenu using the persistent shell. */
  showHome(homeFocus?: string) {
    queueMicrotask(updateApp)
    this.adding = null
    this.watchOn = null
    const chosen = this.browsingServer ? null : this.chosen()
    if (chosen && (!chosen.server.offline || offlineRuns())) this.hooks.warm?.()
    this.homeServer = chosen?.server ?? this.browsingServer ?? getHomeServer() ?? listServers()[0]
    const server = this.homeServer
    const page = server.offline ? 'offline' : this.mainPage === 'play' ? 'play' : 'home'
    const entering = this._view !== page || !this.home.el.isConnected
    this.mainPage = page
    if (homeFocus) this.marks.set(page, homeFocus)
    if (entering && page === 'home') {
      this.offlineContinue = null
      if (offlineRuns()) void this.refreshOfflineContinue()
    }
    const profile = server.offline && offlineRuns() ? chosen?.account.username ?? null : null
    if (this.offlineProfile !== profile) {
      this.offlineProfile = profile
      this.unidentifiedSlots = []
      if (profile) void this.refreshOffline()
    }
    // A disconnected anonymous lobby stays owned by main.ts's reconnect backoff.
    const s = server.offline && !offlineRuns() ? null : chosen ? this.sessionOn(chosen.server, chosen.account.username) ?? (this.session?.server.id === server.id && this.session.username === chosen.account.username ? this.session : null)
      : this.session?.server.id === server.id && !this.session.username ? this.session : this.ensureSession(server, null)
    const st: GameState | null = s?.state ?? null
    const lobby = st?.lobby ?? null
    const open = !!s?.conn.open
    const loggedIn = open && lobby ? lobby.username || null : null
    const restoring = !!chosen && !loggedIn && (!open || !!s?.loggingIn && this.inlineLogin !== s)
    const rows: Row[] = []
    const notices: HTMLElement[] = []
    const extra: Focusable[] = []
    /** how the last game ended, when there is something to say about it: a dialog over this screen */
    let report: { s: Session; exit: NonNullable<GameState['exit']>; why: string | null; words: string } | null = null
    if (chosen && page !== 'home') {
      const { account, server } = chosen
      const login = loginState(account, loggedIn, !!s?.loggingIn)
      const games = this.games(server, s)
      const links = games?.length ? gameLinkRows(games) : null
      // each row with the version it belongs to, as `gameLinkRows` grouped them: what a `.where` line answers for
      const offered = [
        ...(links?.latest ?? []).map((game) => ({ game, version: links!.latestVersion })),
        ...(links?.trunk ?? []).map((game) => ({ game, version: 'trunk' })),
        ...(links?.other ?? []).map((game) => ({ game, version: null })),
      ].filter(({ game }) => !game.disabled && (server.offline || homeGame(game)))
      if (login !== 'out' && !(this.inlineLogin === s && s?.loggingIn)) {
        const who = loggedIn ?? account.username
        const where = this.whereFor(server, who)
        // One row per version, in the lobby's own order: the latest release leads, always, then trunk. The row
        // under the cursor is the same one every time the screen comes up, whatever was played last and whatever
        // the server says is waiting — a front screen that reshuffles itself is one you have to read before
        // pressing.
        const ordered = offered.map(({ game, version }) => ({ game, save: this.saveOf(game, version, who, s, where) }))
        const primary = ordered[0]
        const stuck = server.offline && !offlineRuns()
        for (const { game: g, save } of ordered) {
          rows.push({
            id: 'play:' + g.id, label: `${save ? 'Continue' : 'Play'} ${g.label}`,
            sub: stuck ? cantRunOffline().sub : save?.sub ?? (g.save ? `[${g.save}]` : null), marker: '>', main: g === primary?.game, off: stuck,
            hint: stuck
              ? cantRunOffline().hint
              : server.offline
              ? (save?.hint ?? `A new character in ${g.label}, on this device.`)
              : (save?.hint ?? `A new game of ${g.label} on ${server.host}.`),
            fn: () => this.chooseGame(account, g.id),
            also: server.offline ? [{
              id: 'rc:' + g.id, label: '(edit rc)', ariaLabel: `Edit rc for ${g.label}`,
              title: 'Edit the shared rc file for Stable and Trunk on this device.',
              fn: () => this.showRc(account, null, () => this.showHome('rc:' + g.id)),
            }] : loggedIn && g.rc ? [{
              id: 'rc:' + g.id, label: '(edit rc)',
              title: `Edit your ${g.label} rc file on ${server.host}${sharedRc(games ?? [], g.rc, ' — ')}. Shared with WebTiles on this server.`,
              fn: () => this.showRc(account, g.rc!, () => this.showHome('rc:' + g.id)),
            }] : undefined,
          })
        }
        if (!server.offline && !ordered.length && !restoring) notices.push(h('div', { class: 'hint' }, lobby?.complete ? 'No games offered by this server.' : 'Loading game versions…'))
      }
      if (!server.offline && loggedIn && games?.some(g => !g.disabled && !offered.some(row => row.game === g))) {
        rows.push({ id: 'versions', label: 'More versions & modes', marker: '>', fn: () => this.showVersions(account) })
      }
      // the server's notices (client.html #account_restricted, #stale_processes_message, #force_terminate)
      if (lobby?.accountHold) notices.push(h('div', { class: 'notice' }, 'This account is being held for administrator approval. Until approved, community features and some game modes may be restricted, and games will not be visible to other players.'))
      // client.js lets any key cancel the purge and keep the old game; here the old game is nearly always this
      // player's own dropped one, and a stray press would leave Continue stuck, so no key cancels it
      if (lobby?.staleProcesses) notices.push(h('div', { class: 'notice' }, `Closing your last session on ${server.host}. Your game starts in about ${lobby.staleProcesses.timeout || 10} seconds.`))
      else if (this.lost) notices.push(h('div', { class: 'notice' }, 'Connection lost. Your game is saved: Continue picks it up.'))
      // a socket can outlive the network by a while (a half-open one after a sleep): the network is what is said
      else if (!server.offline && deviceOffline()) notices.push(h('div', { class: 'notice' }, `No connection to ${server.host}.`))
      if (s && lobby?.forceTerminate) {
        const answer = (yes: boolean) => {
          s.send(cm.forceTerminate(yes))
          lobby.forceTerminate = false
          this.shape.delete(page)
          this.showHome()
        }
        const yes = h('button', { type: 'button', class: 'item small', dataset: { focus: 'terminate:yes' }, onclick: () => answer(true) }, h('span', { class: 'marker' }), h('span', { class: 'label' }, 'Yes'))
        const no = h('button', { type: 'button', class: 'item small', dataset: { focus: 'terminate:no' }, onclick: () => answer(false) }, h('span', { class: 'marker' }), h('span', { class: 'label' }, 'No'))
        notices.push(h('div', { class: 'notice dialog' }, `Couldn't stop one of your stale ${lobby.staleProcesses?.game || 'game'} processes gracefully. Force its termination? [yn]`, h('div', { class: 'actions' }, yes, no)))
        extra.push({ id: 'terminate:yes', label: 'Yes', el: yes, row: 100, col: 0, activate: () => answer(true) }, { id: 'terminate:no', label: 'No', el: no, row: 100, col: 1, activate: () => answer(false) })
      }
      // how the last game ended (client.html #exit_game): a dialog over this screen, put up once it is drawn,
      // until closed; a saved game says nothing unless the server had words
      if (s && st?.exit && st.exit.reason) {
        const exit = st.exit
        const why = exitReasonMessage(exit.reason, exit.watched ?? null)
        const words = (exit.message ?? '').replace(/\s+$/, '')
        if (exit.watched || why || words) report = { s, exit, why, words }
        else s.state.exit = null
      }
    }
    if (server.offline) {
      this.offlineDownloads(rows, notices)
      if (profile && !rows.some(row => row.id.startsWith('play:'))) {
        rows.push({ id: 'rc', label: 'Edit rc', marker: '?', fn: () => this.showRc(getDeviceAccount(), null) })
      }
    } else if (page === 'home') {
      rows.push({
        id: 'play', label: 'Play', marker: '>', reserveSub: true,
        sub: loggedIn && s ? this.onlineContinue(s, loggedIn) : restoring || s?.loggingIn ? null : 'Log in to play',
        fn: () => {
          if (s?.conn.open && s.state.lobby.username) return this.showPlay()
          trackPlayerEvent('play_clicked')
          this.home.focusLogin()
        },
      })
      if (offlineOffered()) rows.push({ id: 'offline', label: 'Play Offline', marker: '>', sub: this.offlineContinue, reserveSub: true, fn: () => this.showOffline() })
      const status = deviceOffline() ? 'No connection'
        : open ? (lobby?.complete ? `${lobby.entries.size} playing` : 'Loading…')
        : this.hooks.retrying?.() ? 'Reconnecting…' : s?.closed ? 'Disconnected' : 'Connecting…'
      rows.push({ id: 'watch', label: 'Watch', sub: status, reserveSub: true, marker: '{', fn: () => {
        if (!chosen) this.watchOn = server
        this.showWatch()
      } })
      rows.push({ id: 'settings', label: 'Settings', marker: '?', fn: () => this.showSettings(() => this.homeRoute('settings')) })
    }
    if (page !== 'home') {
      if (chosen && (profile || (loggedIn && !server.offline))) rows.push({
        id: 'morgues', label: 'Morgues', marker: '?', fn: () => this.showMorgues(chosen.account),
      })
      rows.unshift({ id: BACK, label: 'Back', marker: '<', fn: () => this.homeRoute(page) })
    }
    if (page === 'play' && !loggedIn && !restoring && !s?.loggingIn && open) {
      notices.push(h('div', { class: 'hint' }, 'Log in to play.'))
    }
    if (this.error) { notices.push(h('div', { class: 'error' }, this.error)); this.error = null }
    if (entering) {
      this.setView(page, 'polished')
      for (const child of Array.from(this.root.children)) if (child !== this.media.el && child !== this.home.el) child.remove()
      if (!this.home.el.isConnected) this.root.append(this.home.el)
      this.home.resetScroll()
    }
    if (!this.modal) this.at(page === 'home' ? { kind: 'home' } : { kind: 'menu', path: page })
    this.msg = null
    this.rows = rows
    const all = this.home.update({ page, quit: page === 'home' && canQuit(), servers: listServers(), server, username: loggedIn, remembered: chosen?.account.username ?? '', busy: !open || !!s?.loggingIn, restoring,
      authStatus: server.offline || loggedIn ? '' : restoring && open ? `Signing you back in as ${chosen.account.username}…` : loginFeedback(s), rows, notices, unread: newsUnread() })
    // Unchanged notices keep their nodes; controller targets must follow those same live buttons.
    for (const item of extra) item.el = this.home.el.querySelector<HTMLElement>(`[data-focus="${item.id}"]`) ?? item.el
    if (!this.modal) {
      const first = rows.find(row => !row.off && row.id !== BACK)?.id
      const focus = this.marks.get(page) ?? first ?? (page === 'play' && !restoring ? 'username' : BACK)
      this.prepareFocus([...all, ...extra])
      this.nav.set(this.navItems, page, { wrap: true, keepColumn: true }, Math.max(0, all.findIndex(f => f.id === focus)), !!homeFocus)
      if (entering || homeFocus) this.nav.current()?.onFocus?.()
    }
    this.media.cover(!!this.modal)
    if (report) this.showExit(report.s, report.exit, report.why, report.words)
  }

  /**
   * How the last game ended, as the official lobby's exit dialog (client.html
   * #exit_game): the reason, the game's parting words, and its morgue file or
   * character dump. It stands over the home screen rather than in its place,
   * so a report that lands a moment after the game was left (the server stops
   * the process before it answers, so `game_ended` follows its `go_lobby`)
   * arrives as a dialog on a screen that is already there, instead of
   * replacing the front the player was just shown. Close, Escape or B put it
   * away.
   */
  private showExit(s: Session, exit: NonNullable<GameState['exit']>, why: string | null, words: string) {
    this.setView('exit', 'exit')
    const close = () => {
      s.state.exit = null
      this.showHome()
    }
    const parts: HTMLElement[] = []
    if (why) parts.push(h('p', { class: 'exit-why' }, why))
    if (words) parts.push(exit.reason === 'start_failed'
      ? h('p', { class: 'exit-why' }, words)
      : h('pre', { class: 'exit-message' }, words))
    const rows: Row[] = [{ id: 'exit:close', label: 'Close', marker: '<', hint: 'Back to the front.', fn: close }]
    if (exit.dump) {
      const dump = exit.dump
      const text = exit.reason === 'saved' ? 'Character dump' : exit.reason === 'crash' ? 'Crash log' : 'Morgue file'
      // a game on this device names a file in its save directory (@orbrun/offline), not an address
      const device = !!s.server.offline
      const url = device ? null : morgueUrlFor(s.server, dump)
      let href = dump + '.txt'
      try {
        href = new URL(href, s.server.http).href
      } catch {
        // an address the browser cannot resolve is handed over as it came
      }
      const read = () => (device ? deviceDump(dump).then((t) => t ?? Promise.reject(new Error('it is not on this device'))) : url ? fetchText(url) : Promise.reject(new Error('not a URL the proxy carries')))
      // the file as it came, once it has, for Copy
      let came: string | null = null
      rows.push({
        id: 'exit:dump', label: text, marker: '?', hint: `Read the ${text.toLowerCase()} here.`,
        fn: () => this.showDoc({
          title: text, lede: device ? 'Kept on this device.' : `${s.server.name} keeps it; it reads here.`, links: device ? undefined : [{ label: 'Open in a new tab', href }],
          // the report is still the session's, so the front screen puts the dialog back up with it
          from: () => this.showHome(),
          // a crash log is crawl's backtrace, not its console: it reads as it came
          body: () => read().then((t) => ((came = t), exit.reason === 'crash' ? h('pre', { class: 'doc-text' }, t) : morgueDoc(t))),
          copy: () => came,
        }),
      })
    }
    this.list({
      cls: 'exit-list', title: exitTitle(exit.reason, exit.watched ?? null),
      rows,
      // the words first, then the way out of them: the report reads under the title, over the rows
      notices: [h('div', { class: 'exit-report' }, ...parts)],
      over: true,
    })
  }

  /**
   * A document to read on a screen of its own: a morgue file. It scrolls in a region under the head, with up and down (the
   * d-pad, the arrows, the right stick, PageUp and PageDown), so the
   * message line and Back keep their place. A body that arrives later shows
   * "Loading…" until it does; one that fails says so, with the document's
   * link out as the way to it, when it has one.
   */
  private showDoc(opts: { title: string; lede?: string; body: () => HTMLElement | Promise<HTMLElement>; from: () => void; links?: { label: string; href: string }[]; failed?: string; copy?: () => string | null }) {
    const cls = 'doc-list'
    this.setView('doc', cls)
    this.docFrom = opts.from
    // nothing to copy from a document that would not read: its link out is the way to it
    const copy = opts.failed ? undefined : opts.copy
    // a document that can be taken away (a morgue, to paste anywhere) has its Copy beside Back, at the top right
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back.', fn: () => this.back(), ...(copy ? { also: [{ id: 'doc:copy', label: '(copy)', title: `Copy the ${opts.title.toLowerCase()} as crawl wrote it, to paste anywhere.`, fn: () => void this.copyDoc(copy) }] } : {}) }]
    const extra: Focusable[] = []
    const below: HTMLElement[] = []
    const scroller = h('div', { class: 'doc-scroll' })
    let content: HTMLElement | Promise<HTMLElement>
    try {
      content = opts.body()
    } catch (e) {
      content = Promise.reject(e)
    }
    if (content instanceof Promise) {
      scroller.append(h('p', { class: 'doc-wait' }, 'Loading…'))
      content.then(
        (el) => {
          if (this.docScroller !== scroller) return
          replace(scroller, el)
        },
        (e: unknown) => {
          if (this.docScroller !== scroller) return
          const why = e instanceof Error ? e.message : String(e)
          this.showDoc({ ...opts, body: () => h('p', { class: 'doc-failed' }, `Could not read it here (${why}).`), failed: why })
        },
      )
    } else scroller.append(content)
    below.push(scroller)
    // the way out, only once reading here has failed: what reads here needs no tab
    if (opts.links?.length && opts.failed) {
      const links = h('nav', { class: 'about-links', 'aria-label': opts.title })
      opts.links.forEach(({ label, href }, i) => {
        // a door out of the room: `+`, as the game marks one
        const el = h('a', { class: 'item', href, target: '_blank', rel: 'noopener noreferrer', dataset: { focus: 'link:' + i, marker: '+' } }, h('span', { class: 'marker', 'aria-hidden': 'true' }), h('span', { class: 'label' }, label), h('span', { class: 'sub', 'aria-hidden': 'true' }, '↗'))
        links.append(el)
        extra.push({ id: 'link:' + i, label, el, row: i + 1, activate: () => el.click(), onFocus: () => this.say('Opens in a new tab. Your game stays here.') })
      })
      below.push(links)
    }
    this.list({ cls, title: opts.title, lede: opts.lede ?? (this.hooks.padConnected?.() ? 'Up and down scroll it; so does the right stick.' : 'Up and down scroll it.'), rows, below, extra, focus: BACK })
    // a document with no rows of its own leaves the cursor on Back: the document, not the cursor, is what up and down move
    this.docScroller = scroller
  }

  /** Copy the document on show, as it came: said on the message line, and on the button once it is done. */
  private async copyDoc(text: () => string | null) {
    const t = text()
    if (t === null) return this.say('Still reading it: a moment, then copy it.')
    const ok = await copyText(t)
    if (this._view !== 'doc') return
    const label = this.root.querySelector('[data-focus="doc:copy"] .label')
    if (ok && label) label.textContent = '(copied)'
    this.say(ok ? 'Copied: paste it anywhere.' : 'This browser would not copy it. Open it in a new tab, and copy it there.')
  }

  /** the release What's new was last read under before this visit to the front: every release since reads as New until the page is left for good */
  private newsSince: string | null | undefined = undefined

  /**
   * What's new: the changelog, as the site's page has it, in a place of the
   * dungeon of its own. Opening it is reading it: the dot on its row goes, and
   * what came out since it was last read stays marked New while the front is up.
   */
  showNews() {
    if (this.newsSince === undefined) this.newsSince = newsSeen()
    markNewsSeen()
    this.openModal('What’s new', newsDoc(changelog, this.newsSince), 'whats-new')
  }

  private showAbout() {
    const doc = renderMarkdown(about, { dropTitle: true })
    doc.firstElementChild?.after(h('p', null, h('a', { href: '/about/install' }, 'Install Polished Crawl')))
    this.openModal('About & credits', doc, 'about')
  }

  private openModal(title: string, content: HTMLElement, path: string) {
    if (this.modal) this.closeModal(false)
    if (!isMainPage(this._view)) this.showHome()
    this.modal = new MenuModal(this.root, title, content, () => this.closeModal())
    this.media.cover(true)
    this.at({ kind: 'menu', path })
  }

  private closeModal(route = true) {
    this.modal?.destroy()
    this.modal = null
    this.media.cover(!isMainPage(this._view))
    if (route) this.showHome()
  }

  // ------------------------------------------------------------------ watch

  /**
   * Watch: the roster of games running (client.html #player_list), a table
   * in the console face, by player name. A row is a game to spectate (A);
   * right opens its details on a narrow screen. Arrivals after the table is
   * up are held back and counted on the line under it, and come in on Y
   * or on coming back to the screen: rows never move under the cursor.
   * Someone who stops playing leaves at once.
   */
  showWatch() {
    const current = this.chosen()
    const chosen = this.watchOn || current?.server.offline ? null : current
    const server = this.watchOn ?? chosen?.server ?? null
    if (!server) return this.showServers()
    const username = chosen?.account.username ?? null
    const s = this.sessionOn(server, username) ?? this.ensureSession(server, username)
    const open = !!s.conn.open
    const lobby = s.state.lobby
    const all = Array.from(lobby.entries.values()).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }) || a.id - b.id).slice(0, 200)
    const first = this._view !== 'watch' || !this.rosterTable
    if (first) {
      // the address bar says `lobby`, the official client's name for this roster, so Back out of a spectate lands here
      this.at({ kind: 'lobby', serverId: server.id, account: chosen?.account ?? null }, true)
      this.rosterSeen = new Set(all.map((e) => e.id))
      this.rosterRows.clear()
      this.detailsOpen.clear()
    }
    // whoever is gone is gone; whoever arrived waits, once the roster has loaded and has rows under the cursor to keep still
    for (const id of [...this.rosterSeen]) if (!all.some((e) => e.id === id)) this.rosterSeen.delete(id)
    if (!lobby.complete || this.rosterSeen.size === 0) for (const e of all) this.rosterSeen.add(e.id)
    const shown = all.filter((e) => this.rosterSeen.has(e.id))
    const held = all.length - shown.length
    const lede = `${server.host}${username ? ' · ' + username : ''} · ${!open ? 'connecting…' : lobby.complete ? `${all.length} playing` : 'loading…'}`
    if (first) {
      this.setView('watch', 'watch')
      const table = h('table', { class: 'roster' }, h('thead', null, h('tr', null, ...ROSTER_COLS.map((c) => h('th', { class: 'col-' + c.cls + (c.extra ? ' extra' : '') }, c.head)))), h('tbody'))
      this.rosterTable = table
      const rows: Row[] = [
        { id: BACK, label: 'Back', marker: '<', hint: 'Back to the front.', fn: () => this.back() },
      ]
      // the table scrolls in a region of its own, so the head above and the message line and legend under it stay put
      const scroller = h('div', { class: 'roster-scroll' }, table)
      const held_ = h('button', { type: 'button', class: 'held', tabindex: -1, hidden: true, onclick: () => this.takeArrivals() })
      const empty = h('div', { class: 'hint empty' })
      this.list({ cls: 'watch-list', title: `Watch · ${server.name}`, lede, rows, below: [scroller, held_, empty], extra: [], focus: this.marks.get('watch') })
    } else {
      const ledeEl = this.root.querySelector('.head .lede')
      if (ledeEl && ledeEl.textContent !== lede) ledeEl.textContent = lede
    }
    const table = this.rosterTable!
    const body = table.tBodies[0]
    // rows: reused where they read the same, in order
    const keep = new Set<number>()
    let before: Element | null = body.firstElementChild
    for (const e of shown) {
      keep.add(e.id)
      const sig = ROSTER_COLS.map((c) => rosterCell(c.key, e[c.key])).join('\x1f')
      let r = this.rosterRows.get(e.id)
      if (!r || r.sig !== sig) {
        const [tr, dt] = this.rosterRow(e, s)
        if (r) {
          // the row may be the very place the walk stands on: stand on its replacement, not a detached node
          if (before === r.tr) before = tr
          r.tr.replaceWith(tr)
          r.dt.replaceWith(dt)
        }
        r = { tr, dt, sig }
        this.rosterRows.set(e.id, r)
      }
      const open = this.detailsOpen.has(e.id)
      r.tr.hidden = false
      r.dt.hidden = !open
      r.tr.classList.toggle('open', open)
      if (r.tr.parentNode !== body || r.tr !== before) body.insertBefore(r.tr, before)
      if (r.dt !== r.tr.nextElementSibling) body.insertBefore(r.dt, r.tr.nextElementSibling)
      before = r.dt.nextElementSibling
    }
    for (const [id, r] of this.rosterRows) {
      if (keep.has(id)) continue
      r.tr.remove()
      r.dt.remove()
      this.rosterRows.delete(id)
      this.detailsOpen.delete(id)
    }
    const heldEl = this.root.querySelector<HTMLElement>('.held')
    if (heldEl) {
      heldEl.textContent = held ? `${held} new · press Y to bring them in` : ''
      heldEl.hidden = !held
    }
    const emptyEl = this.root.querySelector('.hint.empty')
    if (emptyEl) emptyEl.textContent = !open ? `Connecting to ${server.host}…` : !lobby.complete ? 'Loading games…' : !all.length ? 'Nobody is playing right now.' : ''
    // the cursor: the rows past Back are the players
    const items: Focusable[] = [...this.navItems.filter((f) => !f.id?.startsWith('watch:'))]
    shown.forEach((e, i) => {
      const r = this.rosterRows.get(e.id)!
      items.push({ id: 'watch:' + e.id, label: e.username, el: r.tr, row: 10 + i, activate: () => this.hooks.watch(s, e.username), onFocus: () => this.say(rosterHere(e)) })
    })
    // The Back row is already prepared; only roster rows are new.
    this.prepareFocus(items.filter((f) => f.id?.startsWith('watch:')))
    this.navItems = items
    const cur = this.nav.current()
    const want = first ? this.marks.get('watch') : cur?.id
    let at = want ? items.findIndex((f) => f.id === want) : -1
    if (at < 0) at = items.findIndex((f) => f.id?.startsWith('watch:'))
    if (at < 0) at = items.findIndex((f) => f.id !== BACK)
    this.nav.set(items, 'watch', { wrap: true }, at < 0 ? 0 : at, first)
    if (first) this.nav.current()?.onFocus?.()
  }

  /**
   * A roster entry's rows: the game, and under it its details: the extra
   * columns, each a span the width shows only while its column is hidden
   * (styles.css), in the order the columns go as the screen narrows.
   */
  private rosterRow(e: LobbyEntry, s: Session): [HTMLTableRowElement, HTMLTableRowElement] {
    const tr = h('tr', { class: 'game' + (e.idle_time ? ' idle' : ''), dataset: { focus: 'watch:' + e.id }, onclick: () => this.hooks.watch(s, e.username) }, ...ROSTER_COLS.map((c) => h('td', { class: 'col-' + c.cls + (c.extra ? ' extra' : '') }, rosterCell(c.key, e[c.key]))))
    const details = DETAILS_ORDER.map((cls) => ROSTER_COLS.find((c) => c.cls === cls)!)
      .map((c) => [c, rosterCell(c.key, e[c.key])] as const)
      .filter(([, v]) => v)
      .map(([c, v]) => h('span', { class: 'd col-' + c.cls }, `${c.head} ${v}`))
    const dt = h('tr', { class: 'details', hidden: true, onclick: () => this.hooks.watch(s, e.username) }, h('td', { class: 'details', colspan: ROSTER_COLS.filter((c) => !c.extra).length }, ...details))
    return [tr, dt]
  }

  /** Right on a roster row opens its details (the extra columns as a line under it on a narrow screen); left closes them. */
  private details(id: number, open: boolean) {
    if (open) this.detailsOpen.add(id)
    else this.detailsOpen.delete(id)
    const r = this.rosterRows.get(id)
    if (!r) return
    r.tr.classList.toggle('open', open)
    r.dt.hidden = !open || r.tr.hidden
    if (open && !r.dt.hidden) r.dt.scrollIntoView({ block: 'nearest' })
  }

  /** Y on the roster (or the line that counts them): the arrivals held back come into the table. */
  private takeArrivals() {
    if (this._view !== 'watch' || !this.session) return
    for (const e of this.session.state.lobby.entries.values()) this.rosterSeen.add(e.id)
    this.showWatch()
  }

  // ------------------------------------------------------------------ settings

  /**
   * Polished Crawl's settings: a row per group (settings-rows.ts), each opening its
   * own page under a Back; the Controls page leads on to the Gamepad controls
   * sheet, what every button does. The pause menu opens the same pages over the
   * game (overlays.ts), so a setting is in the same place in both.
   */
  showSettings(from?: () => void) {
    if (this._view === 'settings') return
    const back = from ?? (this._view === 'watch' ? () => this.showWatch() : this._view === 'controls' || this._view === 'settings-group' ? this.settingsFrom ?? (() => this.showHome()) : () => this.showHome())
    this.settingsFrom = back
    this.setView('settings', 'settings')
    this.at({ kind: 'menu', path: 'settings' })
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back to where you were.', fn: () => this.back() },
      ...settingGroups().map((g) => ({ id: 'settings:' + g.group, label: g.group, sub: g.hint, marker: '>', hint: g.hint, fn: () => this.showSettingsGroup(g.group) })),
    ]
    this.list({ cls: 'settings-list', title: 'Settings', lede: 'They are kept on this device.', rows })
  }

  private editTouchLayout() {
    if (this.touchLayoutEditor?.open) return this.touchLayoutEditor
    const editor = editTouchLayout(this.root, loadShortcuts(), previewTouchShortcut, () => undefined, saveShortcuts)
    window.addEventListener('resize', editor.refreshSize)
    this.touchLayoutEditor = editor.dialog
    editor.dialog.addEventListener('close', () => {
      window.removeEventListener('resize', editor.refreshSize)
      if (this.touchLayoutEditor === editor.dialog) this.touchLayoutEditor = undefined
    }, { once: true })
    return editor.dialog
  }

  /**
   * One group's settings (settings-panel.ts), the page the group's row opens:
   * its rows under a Back, as the Gamepad controls sheet stands under one. Left and
   * right turn a setting (A turns it on), the message line says what it does.
   */
  private showSettingsGroup(group: SettingGroup) {
    if (this._view === 'settings-group' && this.settingsGroup === group) return
    this.settingsGroup = group
    this.setView('settings-group', 'settings')
    this.at({ kind: 'menu', path: 'settings/' + group.toLowerCase() })
    const panel = settingsPanel(group, { controls: () => this.showControls(), editTouchLayout: () => this.editTouchLayout() })
    this.refreshSettingsPanel = panel.refresh
    // Only the front-end instance gets the title-screen treatment; the pause
    // menu keeps its compact in-game rows and hotkeys.
    for (const el of panel.rows) {
      el.classList.add('item', 'front-setting')
      el.prepend(h('span', { class: 'marker', 'aria-hidden': 'true' }))
      // Focus updates the hint and can resize this scroll region. Defer row
      // focus until click so the pressed label cannot move before mouseup.
      el.addEventListener('mousedown', ev => {
        if (ev.button === 0 && !(ev.target as Element).closest('button, a, input, textarea, select')) ev.preventDefault()
      })
      // Arrow clicks stop bubbling, so share their row's cursor in capture.
      el.addEventListener('click', ev => {
        if (!(ev.target as Element).closest('.setting-slider, .setting-reset')) el.focus({ preventScroll: true })
      }, { capture: true })
    }
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back to the settings.', fn: () => this.back() }]
    const extra: Focusable[] = panel.rows.map((el, i) => ({
      id: el.dataset.focus ?? 'setting:' + i,
      label: (el.querySelector('.label') as HTMLElement | null)?.textContent ?? '',
      el,
      row: 10 + i,
      activate: () => activateMenuRow(el),
      onFocus: () => this.say(el.dataset.hint),
    }))
    // like the roster, the settings scroll in a region of their own under the head and the rows, so the message line keeps its place
    const scroller = h('div', { class: 'settings-scroll' }, panel.el)
    const hint = settingGroups().find((g) => g.group === group)?.hint ?? ''
    this.list({ cls: 'settings-list', title: group, lede: hint, rows, below: [scroller], extra })
  }

  /** The gamepad sheet (controls-sheet.ts), as the pause menu shows it; a row of the Controls page. */
  private showControls() {
    if (this._view === 'controls') return
    this.setView('controls', 'controls')
    this.at({ kind: 'menu', path: 'settings/controls/gamepad' })
    const sheet = h('div', { class: 'bindings-sheet ours' }, controlsSheet(this.hooks.padKind?.() ?? 'generic'))
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back to the controls.', fn: () => this.back() }]
    this.list({ cls: 'controls-list', title: 'Gamepad controls', lede: 'What every button does, on each layer.', rows, below: [sheet] })
  }

  // ------------------------------------------------------------------ accounts, servers, login

  private showPlay() {
    if (this._view === 'home') this.marks.delete('play')
    leaveOffline()
    this.mainPage = 'play'
    this.showHome()
    void this.chooseInitialServer()
  }

  private showOffline() {
    if (this._view === 'home') this.marks.delete('offline')
    enterOffline()
    this.mainPage = 'offline'
    this.browsingServer = null
    this.showHome()
  }

  private offlineProfile: string | null = null
  private unidentifiedSlots: string[] = []
  private offlineContinue: string | null = null
  private offlineContinueCheck = 0

  private async refreshOfflineContinue() {
    const check = ++this.offlineContinueCheck
    let hint: string | null = null
    try {
      const { username } = getDeviceAccount()
      const saves = browserSaveBook()
      const games = await Promise.all((await engines.channels(username)).map(async ({ label, saveDir }) => ({
        label, sub: await saves.info(profileSaveDir(saveDir, username)),
      })))
      hint = continueHint(games.flatMap(({ label, sub }) => sub ? [{ label, sub }] : []))
    } catch { /* A storage check can fail while the online menu is usable. */ }
    if (this.destroyed || this._view !== 'home' || check !== this.offlineContinueCheck || hint === this.offlineContinue) return
    this.offlineContinue = hint
    this.showHome()
  }

  private offlineDownloads(rows: Row[], notices: HTMLElement[]) {
    if (!offlineRuns()) {
      notices.push(h('div', { class: 'notice' }, cantRunOffline().hint))
      return
    }
    for (const slot of this.unidentifiedSlots) {
      notices.push(h('div', { class: 'notice' }, `The original engine for your ${slot} character is unknown. Its save is preserved on this device.`))
    }
    let shellUnavailable = false
    for (const channel of CHANNEL_NAMES) {
      const name = channel === 'stable' ? 'Stable' : 'Trunk'
      const { installed, info, ready, engineReady, bytes, error, progress } = engines.offer(channel)
      const update = installed && info && buildOf(info) !== buildOf(installed)
      if (installed) {
        const state = ready ? 'Ready offline' : engineReady ? 'Installed' : 'Installation needs repair'
        notices.push(h('div', { class: 'hint' }, `${name} · ${state} · ${installed.version}`))
        shellUnavailable ||= engineReady && !ready
      }
      if (engineReady && !update) continue
      const action = update ? 'Update' : installed ? 'Repair' : 'Install'
      const size = (bytes / 1048576).toFixed(1)
      const detail = info ? `${info.version} · ${size} MiB` : 'Checking availability…'
      rows.push({
        id: 'install:' + channel, marker: '+', label: action + ' ' + name,
        sub: progress === undefined ? error ?? detail : progress === 0 ? 'Preparing…' : `Downloading ${progress}%`,
        off: progress !== undefined,
        fn: () => void (info ? engines.install(channel) : this.refreshOffline()),
      })
    }
    if (shellUnavailable) notices.push(h('div', { class: 'hint' }, 'Offline access is unavailable. Try continuing again or reconnect to refresh the app.'))
  }

  private async refreshOffline(downloads = true) {
    const profile = this.offlineProfile
    try {
      await (downloads ? engines.refresh() : engines.refreshLocal())
      const unknown = profile ? await engines.unidentifiedSlots(profile) : []
      if (profile === this.offlineProfile) {
        this.unidentifiedSlots = unknown
        if (this._view === 'offline') this.showHome()
      }
    } catch (error) {
      if (this.homeServer?.offline) {
        this.error = error instanceof Error ? error.message : 'Offline storage is unavailable.'
        if (this._view === 'offline') this.showHome()
      }
    }
  }

  /** Server versions and variants beyond the main Play rows. */
  private showVersions(a: Account, focus?: string) {
    const server = findServer(a.serverId)
    if (!server || server.offline) return this.showHome()
    const again = this._view === 'versions'
    this.versionsAccount = a
    const s = this.ensureSession(server, a.username)
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back to Play.', fn: () => this.back() }]
    const lobby = s?.conn.open ? s.state.lobby : null
    const who = (lobby?.username || null) ?? a.username
    const where = this.whereFor(server, who)
    const games = this.games(server, s)
    const versions = games?.length ? gameVersionRows(games) : null
    for (const { version, game, modes } of versions ?? []) {
      // a `.where` answers for its version's plain game only, never for a mode of it
      const save = this.saveOf(game, version, who, s, where)
      rows.push({
        id: 'play:' + game.id, label: game.label, sub: save?.sub ?? null, marker: '>',
        hint: save?.hint ?? `A new game of ${game.label} on ${server.host}.`,
        fn: () => this.chooseGame(a, game.id),
        also: [
          // the release's rc file, as the lobby offers it beside the game (game_links.html `(edit rc)`): first, so it
          // stands in the same column on every row, however many modes follow
          ...(game.rc ? [{ id: 'rc:' + game.rc, label: '(edit rc)', title: `Your rc file for ${game.label}: the options crawl starts with${sharedRc(games ?? [], game.rc, ' — ')}.`, fn: () => this.showRc(a, game.rc!, () => this.showVersions(a, 'rc:' + game.rc)) }] : []),
          ...modes.map((m) => {
            const saved = !!m.save && m.save !== 'playing' && m.save !== 'slot full'
            return { id: 'play:' + m.id, label: `(${saved ? 'continue ' : ''}${modeName(m)})`, title: saved ? `Continue ${m.label}: ${m.save}.` : `A new game of ${m.label} on ${server.host}.`, fn: () => this.chooseGame(a, m.id) }
          }),
        ],
      })
    }
    // a server sends its games only to a login (ws_handler.py `send_lobby_html`)
    if (!versions) {
      const [label, hint] = !s?.conn.open ? ['Connecting…', `Connecting to ${server.host}.`]
        : loginState(a, lobby?.username || null, !!s.loggingIn) === 'out' ? ['Log in to see them', `${server.host} shows its versions once you are logged in.`]
        : lobby?.complete && lobby.username ? ['No games offered', `${server.host} offers no games.`]
        : ['Loading versions…', `${server.host} is sending its versions.`]
      rows.push({ id: 'versions:wait', label, off: true, hint })
    }
    const shape = JSON.stringify(rows.map(r => [r.id, r.label, r.sub, r.also?.map(m => m.label)]))
    if (again && !focus && this.shape.get('versions') === shape && !this.error) return
    this.setView('versions', 'versions-list')
    this.at({ kind: 'menu', path: VERSIONS_PATH, serverId: server.id, username: a.username })
    this.shape.set('versions', shape)
    this.list({ cls: 'versions-list' + (again ? ' still' : ''), title: 'Versions & modes', lede: server.name, rows,
      focus: focus ?? (again ? this.nav.current()?.id : rows[1]?.id) })
  }

  /**
   * An account's Morgues: every game it has finished, one row each in the
   * lobby's columns (Score, Char, XL, and the Place it ended), newest first or
   * best first, with how it ended beside it on a wide screen and under it on a
   * narrow one. A row opens its morgue (showMorgue).
   */
  showMorgues(a: Account, focus?: string) {
    const server = findServer(a.serverId)
    if (!server) return this.showHome()
    let book = this.morgues
    if (!book || !sameAccount(book.account, a)) {
      book?.aborter.abort()
      book = this.morgues = { account: a, state: 'listing', dir: null, games: [], more: 0, sort: 'date', aborter: new AbortController() }
      void this.readMorgues(book, server)
    }
    const sorted = book.sort === 'score' ? [...book.games].sort((x, y) => (y.summary?.score ?? -1) - (x.summary?.score ?? -1)) : book.games
    const n = book.games.length + book.more
    const where = server.offline ? 'this device' : server.name
    const lede = `${a.username} · ` + (book.state === 'listing' ? `looking on ${where}…` : `${n} ${n === 1 ? 'game' : 'games'}`)
    const first = this._view !== 'morgues' || !this.morgueTable
    if (first) {
      this.setView('morgues', 'watch morgues')
      this.at({ kind: 'menu', path: MORGUES_PATH, serverId: server.id, ...(!server.offline ? { username: a.username } : {}) })
      const table = h('table', { class: 'roster morgues' }, h('thead', null, h('tr', null, ...MORGUE_COLS.map((c) => h('th', { class: 'col-' + c.cls + (c.extra ? ' extra' : '') }, c.head)))), h('tbody'))
      this.morgueTable = table
      // the order on show, as the button says it; pressed, the other
      const order = book.sort === 'score' ? '(best first)' : '(newest first)'
      const rows: Row[] = [
        {
          id: BACK, label: 'Back', marker: '<', hint: 'Back to Play.', fn: () => this.back(),
          also: [{ id: 'morgues:sort', label: order, title: book.sort === 'score' ? 'The best scores first: the high scores. Press for the newest first.' : 'The newest games first. Press for the best scores first: the high scores.', fn: () => this.sortMorgues() }],
        },
      ]
      const scroller = h('div', { class: 'roster-scroll' }, table)
      const empty = h('div', { class: 'hint empty' })
      this.list({ cls: 'watch-list morgues-list', title: `Morgues · ${server.offline ? a.username : server.name}`, lede, rows, below: [scroller, empty], focus: focus ?? this.marks.get('morgues') })
    } else {
      const ledeEl = this.root.querySelector('.head .lede')
      if (ledeEl && ledeEl.textContent !== lede) ledeEl.textContent = lede
    }
    const body = this.morgueTable!.tBodies[0]
    const keep = new Set<string>()
    let before: Element | null = body.firstElementChild
    for (const g of sorted) {
      keep.add(g.file)
      const sig = JSON.stringify(g.summary)
      let r = this.morgueRows.get(g.file)
      if (!r || r.sig !== sig) {
        const [tr, end] = this.morgueRow(a, g.file, g.summary)
        if (r) {
          if (before === r.tr) before = tr
          r.tr.replaceWith(tr)
          r.end.replaceWith(end)
        }
        r = { tr, end, sig }
        this.morgueRows.set(g.file, r)
      }
      if (r.tr.parentNode !== body || r.tr !== before) body.insertBefore(r.tr, before)
      if (r.end !== r.tr.nextElementSibling) body.insertBefore(r.end, r.tr.nextElementSibling)
      before = r.end.nextElementSibling
    }
    for (const [file, r] of this.morgueRows) {
      if (keep.has(file)) continue
      r.tr.remove()
      r.end.remove()
      this.morgueRows.delete(file)
    }
    const emptyEl = this.root.querySelector('.hint.empty')
    if (emptyEl) {
      const read = book.games.filter((g) => g.summary).length
      emptyEl.textContent =
        book.state === 'listing' ? `Looking for ${a.username}'s morgues on ${where}…`
        : book.state === 'reading' ? `Reading ${read} of ${book.games.length}…`
        : book.state === 'none' ? (server.offline ? `${a.username} has not finished a game on this device yet.` : `${server.name} has no morgues for ${a.username} yet.`)
        : book.state === 'unlisted' ? `${server.name} does not list ${a.username}'s morgues where Polished Crawl can read them.`
        : book.state === 'failed' ? `Could not read the morgues from ${where}.`
        : book.more ? `The newest ${book.games.length}; ${book.more} older ${book.more === 1 ? 'game is' : 'games are'} on ${server.name}.`
        : ''
    }
    // the cursor: the rows past Back are the games. Until there were any it stood where the screen put it (the sort,
    // the first thing past Back); the first rows to arrive take it, unless it was put somewhere on purpose
    const arrived = !this.navItems.some((f) => f.id?.startsWith('morgue:')) && !focus
    const items: Focusable[] = [...this.navItems.filter((f) => !f.id?.startsWith('morgue:'))]
    sorted.forEach((g, i) => {
      const r = this.morgueRows.get(g.file)!
      const stamp = morgueStamp(g.file) ?? g.file
      items.push({ id: 'morgue:' + stamp, label: g.file, el: r.tr, row: 10 + i, activate: () => this.showMorgue(a, stamp), onFocus: () => this.say(morgueHere(g.summary, stamp)) })
    })
    this.prepareFocus(items.filter((f) => f.id?.startsWith('morgue:')))
    this.navItems = items
    const cur = this.nav.current()
    const want = first ? (focus ?? this.marks.get('morgues')) : arrived && cur?.id === 'morgues:sort' ? undefined : cur?.id
    let at = want ? items.findIndex((f) => f.id === want) : -1
    if (at < 0 && (first || arrived)) at = items.findIndex((f) => f.id?.startsWith('morgue:'))
    if (at < 0) at = items.findIndex((f) => f.id === cur?.id)
    if (at < 0) at = 0
    this.nav.set(items, 'morgues', { wrap: true, keepColumn: true }, at, first || arrived)
    if (first || arrived) {
      this.nav.current()?.onFocus?.()
      if (focus) this.nav.current()?.el.scrollIntoView?.({ block: 'nearest' })
    }
  }

  /** Newest first, or best first: the account's high scores. */
  private sortMorgues() {
    const book = this.morgues
    if (!book) return
    book.sort = book.sort === 'score' ? 'date' : 'score'
    this.morgueTable = null
    this.showMorgues(book.account, 'morgues:sort')
  }

  /** Leave Morgues for good: the reading stops, and the next visit lists them afresh. */
  private leaveMorgues() {
    this.morgues?.aborter.abort()
    this.morgues = null
  }

  /** A game's rows in Morgues: the lobby's columns, and under them (a narrow screen) how it ended. */
  private morgueRow(a: Account, file: string, m: MorgueSummary | null): [HTMLTableRowElement, HTMLTableRowElement] {
    const stamp = morgueStamp(file) ?? file
    const open = () => this.showMorgue(a, stamp)
    const date = morgueDate(stamp)
    const cells: Record<string, string> = m
      ? { score: m.score === null ? '?' : String(m.score) + (m.wiz ? '*' : ''), char: m.char, xl: m.xl === null ? '' : String(m.xl), place: m.place, end: m.end, turns: m.turns === null ? '' : String(m.turns), version: m.version ?? '', date }
      : { score: '…', char: '', xl: '', place: '', end: '', turns: '', version: '', date }
    const tr = h('tr', { class: 'game', dataset: { focus: 'morgue:' + stamp }, onclick: open }, ...MORGUE_COLS.map((c) => h('td', { class: 'col-' + c.cls + (c.extra ? ' extra' : '') }, cells[c.key])))
    const end = h('tr', { class: 'ending', onclick: open }, h('td', { colspan: MORGUE_COLS.filter((c) => !c.extra).length }, m ? m.end + (m.wiz ? ' · wizard mode' : '') : 'Reading…'))
    return [tr, end]
  }

  /**
   * Read an account's morgues into its book: this device's whole, a server's
   * listed and then their heads, MORGUE_READERS at a time, newest first, the
   * screen redrawn (once a frame) as each lands.
   */
  private async readMorgues(book: MorgueBook, server: ServerInfo) {
    const signal = book.aborter.signal
    const live = () => this.morgues === book && !signal.aborted && !this.destroyed
    const redraw = () => {
      if (live() && this._view === 'morgues') this.schedule()
    }
    try {
      if (server.offline) {
        const all = await deviceMorgues(book.account.username)
        if (!live()) return
        book.games = all.map((m) => ({ file: m.summary.file, summary: m.summary, text: m.text }))
        book.state = book.games.length ? 'ready' : 'none'
        return redraw()
      }
      const listed = await serverMorgues(server, book.account.username, signal)
      if (!live()) return
      if (!listed) {
        book.state = 'unlisted'
        return redraw()
      }
      book.dir = listed.dir
      const files = listed.files.slice(0, MORGUES_SHOWN)
      book.more = listed.files.length - files.length
      book.games = files.map((file) => ({ file, summary: null }))
      book.state = files.length ? 'reading' : 'none'
      redraw()
      let next = 0
      const reader = async () => {
        while (next < book.games.length && live()) {
          const g = book.games[next++]
          try {
            g.summary = await serverMorgueHead(server, listed.dir, g.file, signal)
          } catch {
            if (!live()) return
            // a file that would not read is still a game: its row says when, and opens it to try again
            g.summary = parseMorgue(g.file, '')
          }
          redraw()
        }
      }
      await Promise.all(Array.from({ length: MORGUE_READERS }, reader))
      if (!live()) return
      book.state = 'ready'
      redraw()
    } catch {
      if (!live()) return
      book.state = 'failed'
      redraw()
    }
  }

  /** One of an account's morgues, read here, by when its game ended. */
  showMorgue(a: Account, stamp: string) {
    const server = findServer(a.serverId)
    if (!server) return this.showHome()
    const book = this.morgues && sameAccount(this.morgues.account, a) ? this.morgues : null
    const game = book?.games.find((g) => morgueStamp(g.file) === stamp) ?? null
    const m = game?.summary ?? null
    const said = (m: MorgueSummary | null) => (m?.score != null ? [String(m.score), m.char, m.end + (m.place ? ' on ' + m.place : '')].filter(Boolean).join(' · ') : null)
    const lede = said(m) ?? `${a.username} · ${morgueDate(stamp)}`
    let href: string | undefined
    try {
      if (!server.offline && book?.dir && game) href = new URL(book.dir + game.file, server.http).href
    } catch {
      // an address the browser cannot resolve has no link out
    }
    // the file as it came, once it has, for Copy
    let came: string | null = null
    this.showDoc({
      title: 'Morgue file', lede,
      links: href ? [{ label: 'Open in a new tab', href }] : undefined,
      from: () => this.showMorgues(a, 'morgue:' + stamp),
      copy: () => came,
      body: () =>
        this.morgueText(a, server, stamp, game).then((t) => {
          came = t
          // opened by its address, before the list read its head: the file itself says what the line under the title does
          const head = !m && said(parseMorgue(`morgue-${a.username}-${stamp}.txt`, t))
          const el = head ? this.root.querySelector('.doc-list .head .lede') : null
          if (el && head) el.textContent = head
          return morgueDoc(t)
        }),
    })
    this.at({ kind: 'menu', path: MORGUES_PATH, serverId: server.id, ...(!server.offline ? { username: a.username } : {}), morgue: stamp })
  }

  /** A morgue's text: from the list's book where it has it, else found again by when it ended. */
  private async morgueText(a: Account, server: ServerInfo, stamp: string, game: MorgueBook['games'][number] | null): Promise<string> {
    if (game?.text) return game.text
    const signal = this.aborter.signal
    if (server.offline) {
      const found = (await deviceMorgues(a.username)).find((m) => m.summary.stamp === stamp)
      if (!found) throw new Error('it is not on this device')
      return found.text
    }
    const book = this.morgues && sameAccount(this.morgues.account, a) ? this.morgues : null
    const listed = book?.dir && game ? { dir: book.dir, files: [game.file] } : await serverMorgues(server, a.username, signal)
    const file = listed?.files.find((f) => morgueStamp(f) === stamp)
    if (!listed || !file) throw new Error(`${server.name} has no such morgue`)
    return serverMorgue(server, listed.dir, file, signal)
  }

  /**
   * An account's rc file (client.js `edit_rc`): the options crawl starts
   * with, as text to edit and save back. On a server it is the file of one
   * rc directory, which several games read (its Sprint, tutorial…); on this
   * device, one file for every game the player plays (@orbrun/offline
   * RcBook). A save is read back before it is called saved: a server says
   * nothing after `set_rc`. The local editor uses the engine's RC storage.
   */
  showRc(a: Account, gameId: string | null, from = () => this.showHome(gameId ? 'rc:' + gameId : 'rc')) {
    const server = findServer(a.serverId)
    if (!server || (!server.offline && !gameId)) return this.showHome()
    const again = this._view === 'rc' && !!this.rc && sameAccount(this.rc.account, a) && this.rc.gameId === gameId
    if (!again) {
      const text = h('textarea', { class: 'rc-text', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', rows: 14, 'aria-label': 'rc file' })
      text.readOnly = true
      text.addEventListener('input', () => this.rcMarks())
      this.rc = { account: a, gameId, from, text, saved: null, state: 'reading', asked: false, note: null, leaving: false }
    }
    const rc = this.rc!
    const s = server.offline ? null : this.ensureSession(server, a.username)
    const loggedIn = !!s?.conn.open && !!s.state.lobby.username
    if ((server.offline || loggedIn) && !rc.asked) void this.readRc()
    const games = server.offline ? [] : (this.games(server, s) ?? [])
    const game = games.find((g) => g.id === gameId)
    const where = server.offline ? 'this device' : server.host
    const notices: HTMLElement[] = []
    if (rc.note) notices.push(h('div', { class: rc.note.error ? 'error' : 'hint' }, rc.note.text))
    else if (rc.state === 'reading') notices.push(h('div', { class: 'hint' }, server.offline ? 'Reading your rc file…'
      : !s?.conn.open ? 'Connecting…' : loggedIn || s.loggingIn ? `Reading your rc file from ${where}…` : `Log in to ${server.host} to read your rc file.`))
    if (!server.offline) notices.push(h('div', { class: 'hint rc-scope' }, 'Shared with WebTiles for this account and version on this server. Other servers keep separate rc files.'))
    const editHint = this.hooks.padConnected?.() ? 'A to type, Y when done. Use the right stick to scroll.'
      : window.matchMedia('(pointer: coarse)').matches ? 'Tap the text to edit. Tap Save to keep your changes.'
      : 'Enter to edit, Esc when done, Ctrl+S to save.'
    const version = server.offline ? null : game ? gameLinkVersion(game) : null
    const guide = `https://github.com/crawl/crawl/blob/${version && version !== 'trunk' ? 'stone_soup-' + version : 'master'}/crawl-ref/docs/options_guide.txt`
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back to Play.', fn: () => this.back() },
      { id: 'rc:text', label: 'rc file', text: rc.text, hint: editHint },
      {
        id: 'rc:save', label: 'Save', sub: rcWord(rc), hint: server.offline ? 'Keep it on this device. It counts from the next game you start or continue.' : `Save it on ${server.host}. It counts from the next game you start or continue.`,
        fn: () => void this.saveRc(),
        also: [
          { id: 'rc:revert', label: rc.state === 'failed' ? '(try again)' : '(revert)', title: rc.state === 'failed' ? `Ask ${where} for the file again.` : `Put back the file as ${where} has it, and lose what was not saved.`, fn: () => void this.readRc(true) },
          { id: 'rc:guide', label: '(options guide)', title: 'Every option crawl reads, in its own guide. Opens in a new tab.', href: guide },
        ],
      },
    ]
    const shape = JSON.stringify([rows.map((r) => [r.id, r.label, r.sub, r.hint, r.also?.map((m) => m.label)]), notices.map((n) => n.textContent), rc.state])
    if (again && this.shape.get('rc') === shape && !this.error) return
    // a redraw while typing: the box is the same element, and the caret goes back where it was
    const typing = document.activeElement === rc.text
    const [start, end] = [rc.text.selectionStart, rc.text.selectionEnd]
    const scroll = rc.text.scrollTop
    this.setView('rc', 'rc-list')
    this.at({ kind: 'menu', path: RC_PATH, serverId: server.id, ...(!server.offline ? { username: a.username, gameId: gameId! } : {}) })
    this.shape.set('rc', shape)
    rc.text.readOnly = rc.state === 'reading' || rc.state === 'failed'
    const lede = server.offline ? 'Shared by Stable and Trunk on this device' : `${a.username} on ${server.name}${game ? ' · ' + game.label : ''}${sharedRc(games, gameId!, ' · ')}`
    this.list({ cls: 'rc-list' + (again ? ' still' : ''), title: 'rc file', lede, rows, notices, focus: again ? this.nav.current()?.id : 'rc:text' })
    rc.text.scrollTop = scroll
    if (typing) {
      rc.text.focus({ preventScroll: true })
      rc.text.setSelectionRange(start, end)
    }
    this.rcMarks()
  }

  /** What changed in the box, said without drawing the screen again (the caret stays put): Save's word, and Back's. */
  private rcMarks() {
    const rc = this.rc
    if (!rc || this._view !== 'rc') return
    const dirty = rc.saved !== null && rc.text.value !== rc.saved
    if (!dirty) rc.leaving = false
    const sub = this.root.querySelector('[data-focus="rc:save"] .sub')
    if (sub) sub.textContent = rcWord(rc)
    const back = this.root.querySelector(`[data-focus="${BACK}"] .label`)
    if (back) back.textContent = rc.leaving ? 'Back, without saving?' : 'Back'
  }

  /** Ask for the file; `revert` puts it in the box over what was typed. */
  private async readRc(revert = false) {
    const rc = this.rc
    const server = rc ? findServer(rc.account.serverId) : null
    if (!rc || !server || rc.state === 'saving' || (rc.state === 'reading' && rc.asked)) return
    rc.asked = true
    rc.state = 'reading'
    rc.note = null
    if (revert) this.showRc(rc.account, rc.gameId)
    // Yield before drawing the result, including when local storage reads synchronously.
    const contents = await (server.offline ? Promise.resolve().then(() => browserRcBook().read(rc.account.username)).catch(() => null)
      : this.ensureSession(server, rc.account.username).readRc(rc.gameId!, RC_MS))
    if (this.rc !== rc) return
    if (contents === null) {
      rc.state = rc.saved === null ? 'failed' : 'ready'
      rc.note = { text: `No answer from ${server.offline ? 'this device' : server.host}: your rc file could not be read.`, error: true }
    } else {
      // the first read fills the box; a later one (revert) replaces what was typed
      rc.saved = contents
      rc.text.value = contents
      rc.state = 'ready'
    }
    this.showRc(rc.account, rc.gameId)
  }

  /** Save the box, then read it back: only a file that reads back the same is called saved. */
  private async saveRc() {
    const rc = this.rc
    const server = rc ? findServer(rc.account.serverId) : null
    if (!rc || !server || rc.state !== 'ready') return
    const where = server.offline ? 'this device' : server.host
    if (rc.text.value === rc.saved) {
      rc.note = { text: `Nothing to save: this is the file as ${where} has it.` }
      return this.showRc(rc.account, rc.gameId)
    }
    const text = rc.text.value
    let back: string | null = null
    if (server.offline) {
      try {
        browserRcBook().write(rc.account.username, text)
        back = text
      } catch { /* Keep the draft so the player can retry. */ }
    } else {
      const s = this.ensureSession(server, rc.account.username)
      rc.state = 'saving'
      rc.note = null
      this.showRc(rc.account, rc.gameId)
      s.writeRc(rc.gameId!, text)
      back = await s.readRc(rc.gameId!, RC_MS)
    }
    if (this.rc !== rc) return
    rc.state = 'ready'
    if (back === text) {
      rc.saved = text
      rc.leaving = false
      rc.note = { text: `Saved${server.offline ? '' : ' on ' + server.host}. It counts from the next game you start or continue.` }
    } else rc.note = { text: server.offline ? 'This device could not save your rc file. Your draft is still here.'
      : back === null ? `No answer from ${where}. Your text is still here: try Save again.` : `${where} did not keep it. Your text is still here: try Save again.`, error: true }
    this.showRc(rc.account, rc.gameId)
  }

  /** Back out of the rc file, to where it was opened from; changes not saved ask for a second Back first. */
  private leaveRc() {
    const rc = this.rc
    if (!rc) return this.showHome()
    if (rc.saved !== null && rc.text.value !== rc.saved && !rc.leaving) {
      rc.leaving = true
      this.rcMarks()
      this.say('Your changes are not saved. Back again leaves without them; Save keeps them.')
      return
    }
    this.rc = null
    rc.from()
  }

  /** Close the window, from the home screen's footer; a browser that refuses says so where the errors go. */
  private quit() {
    quit(() => {
      this.error = 'This browser would not close the window. Leave full screen with F11, or close it the way you opened it — on a Deck, the Steam button, then Exit.'
      this.showHome()
    })
  }

  /** Pick a server to spectate on, including while signed out. */
  showServers(focus?: string) {
    this.adding = null
    this.watchOn = null
    this.setView('servers', 'servers-list')
    this.at({ kind: 'menu', path: 'watch' })
    const account = getOnlineAccount()
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back to Play.', fn: () => this.back() }]
    for (const sv of listServers()) {
      const also: NonNullable<Row['also']> = []
      if (sv.custom && sv.id !== account?.serverId) also.push({
        id: 'remove:' + sv.id,
        label: '(remove)',
        title: `Take ${sv.host} off the list.`,
        fn: () => {
          if (this.browsingServer?.id === sv.id) this.browsingServer = null
          removeServer(sv.id)
          this.showServers('add-server')
        },
      })
      rows.push({
        id: 'server:' + sv.id,
        label: sv.name,
        sub: sv.custom ? 'added on this device' : serverWhere(sv),
        late: this.pingNote(sv),
        marker: '{',
        hint: `Watch who is playing on ${sv.host}.`,
        also,
        fn: () => this.watchServer(sv),
      })
    }
    if (customServersAllowed()) rows.push({ id: 'add-server', label: 'Add a server', marker: '+', gap: true, fn: () => this.showAddServer() })
    this.list({ cls: 'servers-list', title: 'Watch', lede: 'Choose a server.', rows, focus: focus ?? this.marks.get('servers') })
  }

  /**
   * Add a server: its host or the address of its page, then Add. It lands on
   * the list with the cursor on it (one already there is simply found), and
   * what was wrong with an address that is not one is said here, with the
   * text kept to fix.
   */
  private showAddServer() {
    if (!customServersAllowed()) return this.showServers()
    this.setView('add-server', 'add-server-form')
    this.at({ kind: 'menu', path: 'watch/add' })
    const input = h('input', { type: 'text', name: 'server', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'crawl.example.org', size: 28, value: this.serverDraft })
    let form: HTMLFormElement
    const typing = this.hooks.padConnected?.() ? ' Press X to type.' : ''
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back to the servers.', fn: () => this.back() },
      { id: 'address', label: 'Address', input, hint: 'Its host, or the address of its page: crawl.example.org, or http://crawl.example.org:8080.' + typing },
      { id: 'add', label: 'Add', sub: 'to the server list', marker: '+', main: true, hint: 'Add it to the list, to log in or watch there.', fn: () => form.requestSubmit() },
    ]
    this.list({
      cls: 'add-server-form',
      title: 'Add a server',
      rows,
      focus: 'address',
      wrap: (list) => {
        form = h(
          'form',
          {
            class: 'form',
            onsubmit: (ev: Event) => {
              ev.preventDefault()
              this.serverDraft = input.value
              let sv: ServerInfo
              try {
                sv = addServer(input.value)
              } catch (e) {
                this.error = e instanceof Error ? e.message : String(e)
                this.showAddServer()
                return
              }
              this.serverDraft = ''
              this.showServers('server:' + sv.id)
            },
          },
          list,
        )
        return form
      },
    })
  }

  /**
   * A server's ping at the end of its note, written in when it lands (the row
   * is not redrawn, so a host half typed into Add a server stays). No answer
   * leaves it blank: whether a server is up is not this line's to say.
   */
  private pingNote(sv: ServerInfo): HTMLElement | undefined {
    if (!this.hooks.ping) return undefined
    const el = h('span', { class: 'ping' })
    void this.hooks.ping(sv).then((ms) => {
      if (this.destroyed || ms === null) return
      el.textContent = ` · ${ms} ms`
    })
    return el
  }

  private chooseGame(account: Account, gameId: string) {
    trackPlayerEvent('play_clicked')
    this.connectTo(account, { kind: 'play', gameId })
  }

  /**
   * Open a session for `account` and show the home screen, its server's
   * lobby. With an `intent` (Continue, Play, a `/play`/`/watch` address
   * on reload) the game or spectate starts on its own once the login is
   * through, and the screen stays up meanwhile. `played` (the way back from
   * a game) forgets what the server said was waiting; a switch of account
   * keeps it.
   */
  connectTo(account: Account, intent?: Intent, played = true) {
    if (intent) this.lost = false
    const server = findServer(account.serverId)
    if (!server) return this.showHome()
    // a game here would crash at start: the home screen says why instead (a reload of #play too)
    if (server.offline && !offlineRuns()) intent = undefined
    const session = this.hooks.connect(server, account.username, intent)
    const last = getLast()
    if (!last || last.serverId !== server.id) setLast({ serverId: server.id, username: account.username })
    // Play or Continue pressed on the home screen of the session already followed: the game comes when the server
    // answers, and until then the screen stands where it is (redrawn in place if its lines changed) rather than
    // being torn down and slid in again as a new one
    if (session === this.session && (this._view === 'play' || this._view === 'offline')) return this.showHome()
    this.attach(session, played)
  }

  /** A game's connection dropped on its way here: the home screen says so, and that the game is saved. */
  dropped() {
    this.lost = true
    this.shape.delete('home')
    if (isMainPage(this._view)) this.showHome()
  }

  /** Follow an already open session and show the home screen: after a death, a save, or a reload. */
  attach(session: Session, played = true, page: MainPage = session.server.offline ? 'offline' : 'play') {
    if (session.server.offline) enterOffline()
    else leaveOffline()
    this.mainPage = page
    if (session.username) this.browsingServer = null
    // a game was played: whatever the server said was waiting before it is stale now
    if (played) {
      this.asked.clear()
      this.whereis.clear()
    }
    this.follow(session)
    this.at(this.mainPage === 'home' ? { kind: 'home' } : { kind: 'menu', path: this.mainPage }, true)
    this.showHome()
  }

  /** Follow an already open session and show the Watch screen: after a spectate ended, or Back to `/watch/<server>`. */
  watchFor(session: Session) {
    // a spectate with no account was picked from that server's roster, not the chosen account's
    this.watchOn = session.username ? null : session.server
    this.follow(session)
    this.showWatch()
  }

  /** The Watch screen of `server` with no account: a `cdi/lobby` address. */
  watchServer(server: ServerInfo) {
    this.watchOn = server
    this.showWatch()
  }

  /** A session on `server` for `username` to log in to, register on, or watch from: the warm one, or a fresh one. */
  private ensureSession(server: ServerInfo, username: string | null): Session {
    const s = this.hooks.session?.(server, username) ?? this.session
    if (s && !s.closed && s.server.id === server.id && (s.username ?? null) === username) {
      if (s !== this.session) this.follow(s)
      return s
    }
    // the session left behind is closed by the connect, which is no drop for this screen to say or redraw for: a
    // redraw then would be of the screen this one is leaving (the home screen under a `/watch/cdi` address)
    this.unsub?.()
    this.unsub = null
    const n = this.hooks.connect(server, username)
    this.follow(n)
    return n
  }

  /** Follow a session's events without changing the screen. */
  private follow(session: Session) {
    this.unsub?.()
    if (session !== this.inlineLogin) this.inlineLogin = null
    this.session = session
    this.unsub = session.on((e) => {
      // every message redraws what changed, once a frame however many came
      if ((e.type === 'state' || e.type === 'open') && (isMainPage(this._view) || this._view === 'watch' || this._view === 'versions' || this._view === 'rc')) this.schedule()
      if (e.type === 'state' && e.msg.msg === 'login_success' && (this._view === 'login' || this._view === 'register' || this.inlineLogin === session)) {
        this.inlineLogin = null
        this.loggedIn(session)
      }
      if (e.type === 'state' && (e.msg.msg === 'login_fail' || e.msg.msg === 'auth_error')) this.inlineLogin = null
      if (e.type === 'open' || (e.type === 'state' && (e.msg.msg === 'login_fail' || e.msg.msg === 'auth_error'))) this.syncLoginForm?.()
      if (e.type === 'state' && e.msg.msg === 'register_fail' && this._view === 'register') this.showRegister()
      if (e.type === 'state' && e.msg.msg === 'reload_url' && !this.reloaded) {
        this.reloaded = true
        window.location.reload()
      }
      if (e.type === 'closed') {
        this.inlineLogin = null
        // a drop the app is already retrying says so; one it is not (the server closed it) says why. Only a screen
        // that stands on the connection says it: one that does not (the server list, the settings) is not redrawn,
        // so the words would wait there and turn up on the next screen, long after the connection was back
        const says = !this.hooks.parked?.() && (this._view === 'login' || this._view === 'register' || isMainPage(this._view) || this._view === 'watch' || this._view === 'versions' || this._view === 'rc')
        // with no network at all, the home screen's notice says so for as long as it lasts
        if (says && !(this._view === 'home' && deviceOffline())) this.error = this.hooks.retrying?.() ? 'Connection lost. Reconnecting…' : 'Connection closed: ' + e.reason
        if (this._view === 'login' || this._view === 'register') this.showPlay()
        else if (says) {
          this.shape.delete(this._view)
          this.refresh()
        }
      }
    })
  }

  /** Browser Back to the bare home closes its document without destroying form state. */
  homeRoute(focus?: string) {
    if (!focus && (this._view === 'play' || this._view === 'offline')) focus = this._view
    leaveOffline()
    this.mainPage = 'home'
    this.closeModal(false)
    this.showHome(focus)
    void this.chooseInitialServer()
  }

  private async chooseInitialServer() {
    const ping = this.hooks.ping
    if (this.homeServerProbe !== 'idle' || !ping || deviceOffline() || getChosenAccount() || getHomeServer()) return
    this.homeServerProbe = 'pending'
    const servers = listServers()
    const readings = await Promise.all(servers.map(server => ping(server).catch(() => null)))
    if (this.homeServerProbe !== 'pending') return
    this.homeServerProbe = 'done'
    if (this.destroyed || (this._view !== 'home' && this._view !== 'play') || this.modal || getChosenAccount() || getHomeServer()) return
    let fastest: ServerInfo | undefined
    let lowest = Infinity
    for (const [index, ms] of readings.entries()) {
      if (ms === null || ms >= lowest) continue
      lowest = ms
      fastest = servers[index]
    }
    if (fastest) {
      setHomeServer(fastest.id)
      this.showHome()
    }
  }

  /** Through Log in or Register (client.js logged_in): the account is kept, chosen, and its screen comes up. */
  private loggedIn(session: Session) {
    const username = session.state.lobby.username
    if (!username) return
    const account: Account = { serverId: session.server.id, username }
    setOnlineAccount(account)
    setLoginServer(account.serverId)
    setLast({ serverId: account.serverId, username })
    this.adding = null
    this.loginName = ''
    this.attach(session, true, this.mainPage)
  }

  private cancelAuth() {
    this.loginName = ''
    this.showPlay()
  }

  showLogin() {
    const chosen = this.adding ? null : this.chosen()
    const server = this.adding ?? chosen?.server ?? null
    if (!server) return this.showHome()
    const s = this.ensureSession(server, chosen?.account.username ?? null)
    if (!this.loginName && chosen) this.loginName = chosen.account.username
    this.setView('login', 'login')
    this.at({ kind: 'menu', path: 'login', serverId: server.id, ...(chosen ? { username: chosen.account.username } : {}) })
    // a phone keyboard capitalises, corrects and leaves a space after a suggestion; the server takes the name as sent
    const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', required: true, pattern: '.*\\S.*', placeholder: 'name', size: 20, value: this.loginName })
    const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true, placeholder: 'password', size: 20 })
    const status = h('div', { role: 'status' })
    let form: HTMLFormElement
    const typing = this.hooks.padConnected?.() ? ' Press X to type.' : ''
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back without logging in.', fn: () => this.back() },
      { id: 'username', label: 'Name', input: user, hint: `Your name on ${s.server.host}.` + typing },
      { id: 'password', label: 'Password', input: pass, hint: 'It is sent to the server once; only a login token is kept on this device.' + typing },
      { id: 'login', label: 'Log in', sub: s.server.name, marker: '\\', main: true, hint: `Log in to ${s.server.host}.`, fn: () => form.requestSubmit() },
    ]
    if (this.adding) rows.push({ id: 'register', label: 'Register', sub: 'a new account', marker: '+', gap: true, hint: 'A new account on this server.', fn: () => this.showRegister() })
    this.list({
      cls: 'login-form',
      title: 'Log in',
      lede: s.server.name,
      rows,
      notices: [status],
      focus: this.loginName ? 'password' : 'username',
      wrap: (list) => {
        form = h(
          'form',
          {
            class: 'form',
            onsubmit: (ev: Event) => {
              ev.preventDefault()
              if (!s.conn.open || s.loggingIn) return
              const name = user.value.trim()
              this.loginName = name
              s.send(cm.login(name, pass.value))
              pass.value = ''
              this.syncLoginForm?.()
            },
          },
          list,
        )
        return form
      },
    })
    const submit = form!.querySelector<HTMLButtonElement>('button[data-focus="login"]')!
    this.syncLoginForm = () => {
      submit.disabled = !s.conn.open || s.loggingIn
      status.textContent = loginFeedback(s)
    }
    this.syncLoginForm()
  }

  /** The lobby page's register dialog (client.html #reg_link), off the login of an account being added. */
  showRegister() {
    const server = this.adding ?? this.chosen()?.server ?? null
    if (!server) return this.showHome()
    const s = this.ensureSession(server, this.adding ? null : (this.chosen()?.account.username ?? null))
    this.setView('register', 'register-form')
    this.at({ kind: 'menu', path: 'register', serverId: server.id })
    const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'name', size: 20 })
    const pass = h('input', { type: 'password', placeholder: 'password', size: 20 })
    const pass2 = h('input', { type: 'password', placeholder: 'repeat password', size: 20 })
    const email = h('input', { type: 'email', placeholder: 'email (optional)', size: 20 })
    let form: HTMLFormElement
    const typing = this.hooks.padConnected?.() ? ' Press X to type.' : ''
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back to the login.', fn: () => this.back() },
      { id: 'username', label: 'Name', input: user, hint: `What your name will be on ${s.server.host}.` + typing },
      { id: 'password', label: 'Password', input: pass, hint: 'Choose a password. It is sent to the server once; only a login token is kept on this device.' + typing },
      { id: 'password2', label: 'Repeat', input: pass2, hint: 'Enter it again.' + typing },
      { id: 'email', label: 'Email', input: email, hint: 'Optional; the server uses it to reset a lost password.' + typing },
      { id: 'register', label: 'Register', sub: s.server.name, marker: '\\', main: true, hint: `Register on ${s.server.host}.`, fn: () => form.requestSubmit() },
    ]
    if (s.state.lobby.registerFailed) this.error = s.state.lobby.registerFailed
    this.list({
      cls: 'register-form',
      title: 'Register',
      lede: `A new account on ${s.server.name}`,
      rows,
      focus: 'username',
      wrap: (list) => {
        form = h(
          'form',
          {
            class: 'form',
            onsubmit: (ev: Event) => {
              ev.preventDefault()
              if (pass.value !== pass2.value) {
                this.error = 'Passwords do not match.'
                this.showRegister()
                return
              }
              const name = user.value.trim()
              s.send(cm.register(name, pass.value, email.value))
            },
          },
          list,
        )
        return form
      },
    })
  }
}

// ---------------------------------------------------------------- the roster

/**
 * The roster's columns (client.html #player_list, in its order). The four
 * that always stand say who and where; the rest are `extra`: shown on a wide
 * screen, and on a narrow one as the details line a row opens (right).
 */
interface RosterCol {
  key: keyof LobbyEntry & string
  head: string
  cls: string
  extra?: boolean
}
/** A morgue (or a character dump) to read: morgue-text.ts sets it out. */
function morgueDoc(text: string): HTMLElement {
  return h('div', { class: 'morgue', html: morgueHtml(text) })
}

interface MorgueCol {
  key: string
  head: string
  cls: string
  /** a column a narrow screen leaves out: how it ended goes under the row instead */
  extra?: boolean
}

/** Morgues' columns, the lobby's where they mean the same: the score where the roster has the player, who stands first with the cursor */
const MORGUE_COLS: MorgueCol[] = [
  { key: 'score', head: 'Score', cls: 'user' },
  { key: 'char', head: 'Char', cls: 'char' },
  { key: 'xl', head: 'XL', cls: 'xl' },
  { key: 'place', head: 'Place', cls: 'place' },
  { key: 'end', head: 'How it ended', cls: 'milestone', extra: true },
  { key: 'turns', head: 'Turns', cls: 'turn', extra: true },
  { key: 'version', head: 'Version', cls: 'game', extra: true },
  { key: 'date', head: 'Date', cls: 'date' },
]

/** A game in Morgues, spoken: the score, the character, how and where it ended, and when. */
function morgueHere(m: MorgueSummary | null, stamp: string): string {
  const when = morgueDate(stamp)
  if (!m || m.score === null) return m ? `A game that ended ${when}; its morgue would not read.` : `A game that ended ${when}.`
  const who = [m.title, m.began].filter(Boolean).join(', ') + (m.xl ? `, XL${m.xl}` : '') + (m.god ? `, of ${m.god}` : '')
  return `${m.score} points${m.wiz ? ' (wizard mode)' : ''}: ${who}. ${m.end}${m.place ? ' on ' + m.place : ''}, ${when}${m.turns ? `, turn ${m.turns}` : ''}.`
}

const ROSTER_COLS: RosterCol[] = [
  { key: 'username', head: 'Player', cls: 'user' },
  { key: 'char', head: 'Char', cls: 'char' },
  { key: 'xl', head: 'XL', cls: 'xl' },
  { key: 'place', head: 'Place', cls: 'place' },
  { key: 'spectator_count', head: 'Watching', cls: 'specs', extra: true },
  { key: 'game_id', head: 'Game', cls: 'game', extra: true },
  { key: 'god', head: 'God', cls: 'god', extra: true },
  { key: 'turn', head: 'Turn', cls: 'turn', extra: true },
  { key: 'dur', head: 'Time', cls: 'time', extra: true },
  { key: 'idle_time', head: 'Idle', cls: 'idle', extra: true },
  { key: 'milestone', head: 'Milestone', cls: 'milestone', extra: true },
]

/** The extra columns in the order the width folds them into the details row: the first three go at a middling width, the rest on a narrow one. */
const DETAILS_ORDER = ['specs', 'time', 'idle', 'game', 'god', 'turn', 'milestone']

/** One column of a roster row as it reads: the value formatted as client.js formats it, nothing for none. */
function rosterCell(key: string, v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  if (key === 'dur') return formatDuration(v as LobbyEntry['dur'])
  if (key === 'idle_time') return formatIdle(v as LobbyEntry['idle_time'])
  if (key === 'spectator_count') return v ? String(v) : ''
  return String(v)
}

/** The whole row, spoken, every column whether or not the width shows it. */
function rosterHere(e: LobbyEntry): string {
  const who = [e.char, e.xl ? `XL${e.xl}` : '', e.place].filter(Boolean).join(', ')
  const facts = [
    e.god ? `a worshipper of ${e.god}` : '',
    e.turn ? `turn ${e.turn}` : '',
    e.dur ? `${formatDuration(e.dur)} played` : '',
    e.idle_time ? `idle ${formatIdle(e.idle_time)}` : '',
    e.spectator_count ? `${e.spectator_count} watching` : '',
  ].filter(Boolean)
  return `You see here ${e.username}${who ? ` (${who})` : ''}${facts.length ? ', ' + facts.join(', ') : ''}${e.milestone ? ': ' + e.milestone : '.'}`
}

/**
 * client.js exit_reason_message: the line above a game's parting words when
 * the way it ended calls for one. A normal end (death, win, quit, save) says
 * nothing of its own; a watched game's end always says whose it was.
 */
/** Whether the browser says this device has no network at all: a server cannot be reached, and nothing will be until it does. */
function deviceOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function exitReasonMessage(reason: string, watched: string | null): string | null {
  const tail = reason !== 'unknown' ? ` (${reason})` : ''
  if (watched) {
    const whose = watched + "'" + (watched.endsWith('s') ? '' : 's')
    switch (reason) {
      case 'quit': case 'won': case 'bailed out': case 'dead': return null
      case 'cancel': return `${watched} quit before creating a character.`
      case 'saved': return `${watched} stopped playing (saved).`
      case 'crash': return `${whose} game crashed.`
      case 'error': return `${whose} game was terminated due to an error.`
      case 'disconnect': return `${watched} has been disconnected.`
      default: return `${whose} game ended unexpectedly.${tail}`
    }
  }
  switch (reason) {
    case 'quit': case 'won': case 'bailed out': case 'dead': case 'saved': case 'cancel': case 'start_failed': return null
    case 'crash': return 'Unfortunately your game crashed.'
    case 'error': return 'Unfortunately your game terminated due to an error.'
    case 'disconnect': return 'You have been disconnected.'
    default: return `Unfortunately your game ended unexpectedly.${tail}`
  }
}

/** The exit screen's name: whose game, and how it went. */
function exitTitle(reason: string, watched: string | null): string {
  const whose = watched ? `${watched}’s game` : 'Your game'
  switch (reason) {
    case 'dead': return watched ? `${watched} died` : 'You died'
    case 'won': return watched ? `${watched} won` : 'You won'
    case 'quit': return `${whose} was quit`
    case 'bailed out': return `${whose} was abandoned`
    case 'saved': return `${whose} was saved`
    case 'cancel': return 'No character made'
    case 'start_failed': return 'Could not start your offline game'
    case 'crash': return `${whose} crashed`
    case 'error': return `${whose} stopped with an error`
    case 'disconnect': return watched ? `${watched} was disconnected` : 'Disconnected'
    default: return `${whose} ended`
  }
}

/**
 * Where a server is, as the server list and the accounts both say it: where it is and its host, or for this device
 * that no connection is needed. Whether a server is up is the dot's to say, never this line's.
 */
/**
 * A server's own lobby page, beside its row, in a new tab: where it keeps what
 * only its admins say (its news, code of conduct, donations, other games),
 * which the socket never carries.
 */


/** A mode's name beside its release: "Custom seed 0.34" is (seed), "Tutorial trunk" (tutorial). */
/** What the Save row says of the file: where it stands against the one on the server. */
function rcWord(rc: RcEdit): string {
  if (rc.state === 'reading') return 'reading…'
  if (rc.state === 'saving') return 'saving…'
  if (rc.state === 'failed') return 'not read'
  return rc.text.value === rc.saved ? 'no changes' : 'unsaved changes'
}

/** The other games that read the rc file `rc` names (GameLink `rc`), as words after `lead`; nothing when there are none. */
function sharedRc(games: GameLink[], rc: string, lead: string): string {
  const also = games.filter((g) => g.rc === rc && g.id !== rc && !g.disabled).map((g) => g.label)
  if (!also.length) return ''
  return `${lead}${also.length === 1 ? also[0] + ' reads it too' : also.slice(0, -1).join(', ') + ' and ' + also.at(-1) + ' read it too'}`
}

function modeName(g: GameLink): string {
  const text = `${g.label} ${g.id}`
  if (/seed/i.test(text)) return 'seed'
  if (/\bspr(int)?\b|^spr-/i.test(text)) return 'sprint'
  if (/\btut(orial)?\b|^tut-/i.test(text)) return 'tutorial'
  if (/\bzd\b|zot ?def/i.test(text)) return 'zot defence'
  return g.label.replace(/\b(dcss|trunk|git|\d+\.\d+)\b/gi, '').trim().toLowerCase() || g.label
}

/** Where a server is, under its name on the server list. */
function serverWhere(sv: ServerInfo): string {
  return [sv.location, sv.host].filter(Boolean).join(' · ')
}

function loginFeedback(s: Session | null): string {
  if (s?.closed) return s.username ? 'Reconnecting…' : 'Disconnected'
  if (!s?.conn.open) return 'Connecting…'
  if (s.loggingIn) return 'Logging in…'
  return s.savedLoginRejected ? '' : s.state.lobby.loginFailed ?? ''
}



/** client.js: idle seconds as "42s", "7m" or "2684h"; nothing when not idle. */
function formatIdle(seconds: LobbyEntry['idle_time']): string {
  if (!seconds || seconds <= 0) return ''
  if (seconds < 120) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

/** client.js format_duration: play time in seconds as "27s", "18m" or "2h 8m". */
function formatDuration(dur: LobbyEntry['dur']): string {
  const seconds = Number(dur)
  if (!Number.isFinite(seconds) || seconds < 0) return dur ? String(dur) : ''
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const hh = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return hh ? `${hh}h ${m}m` : `${m}m`
}

