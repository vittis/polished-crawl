// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initialState, type GameState, type LobbyEntry } from '@orbrun/webtiles'
import { FrontEnd, navDir, exitReasonMessage, type Intent } from '../src/menu'
import { RELEASE_ID } from '../src/release'
import * as servers from '../src/servers'
import { engines } from '../src/engines'
import { settingsPanel } from '../src/settings-panel'
import { GamepadInput } from '../src/gamepad'
import type { Session } from '../src/session'
import { findServer, getChosenAccount, OFFLINE_SERVER, setOnlineAccount, setGames, setLast, setToken, type Account, type ServerInfo } from '../src/servers'


// Playback/visibility is covered by menu-backdrop.test and real-browser checks.
// Keep DOM/session tests from asking happy-dom's media loader for localhost assets.
vi.mock('../src/menu-backdrop', () => ({ MenuBackdrop: class {
  el = document.createElement('div')
  constructor(host: HTMLElement) { host.prepend(this.el) }
  cover() {} destroy() { this.el.remove() }
} }))

// happy-dom's localStorage has no working methods; give servers.ts a plain one
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
})

const cdi = findServer('cdi')!
const crg = findServer('crg')!
const orbrun: Account = { serverId: 'cdi', username: 'orbrun' }
const roguelikes: Account = { serverId: 'crg', username: 'orbrun' }

/** A connection that says what a lobby says, without a socket. */
function fakeSession(server: ServerInfo, username: string | null, lobby: Partial<GameState['lobby']> = {}, open = true): Session {
  const state = initialState()
  Object.assign(state.lobby, lobby)
  const listeners: ((e: unknown) => void)[] = []
  const s = {
    server,
    username,
    closed: false,
    conn: { open },
    state,
    send: vi.fn(),
    on: (fn: (e: unknown) => void) => {
      listeners.push(fn)
      return () => listeners.splice(listeners.indexOf(fn), 1)
    },
    emit: (e: unknown) => listeners.forEach((fn) => fn(e)),
  }
  return s as unknown as Session
}

function playing(username: string, more: Partial<LobbyEntry> = {}): LobbyEntry {
  return { id: username.length, username, game_id: 'dcss-web-trunk', char: 'MiBe', xl: '12', place: 'Lair:3', ...more } as LobbyEntry
}

/** The focus id of a player's roster row: the row stands for the lobby entry, not the name. */
function at(username: string): string {
  return 'watch:' + playing(username).id
}

interface Made {
  screen: FrontEnd
  connect: ReturnType<typeof vi.fn>
  watch: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
  page: ReturnType<typeof vi.fn>
  at: ReturnType<typeof vi.fn>
}

const made: FrontEnd[] = []

/**
 * The home screen reads `<player>.where` from the server in the background (menu.ts `readWhereis`). Nothing
 * here is talking to a server, so it answers 404 by default: the screen is the one drawn without it. Tests
 * about the file stub `fetch` themselves.
 */
beforeEach(() => {
  servers.leaveOffline()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
})

afterEach(() => {
  for (const s of made.splice(0)) s.destroy()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** The front end on a screen, with no session up unless `session` gives one. */
function make(session?: (server: ServerInfo, username: string | null) => Session | null, padConnected = false, ping?: (server: ServerInfo) => Promise<number | null>): Made {
  const host = document.createElement('div')
  document.body.append(host)
  const connect = vi.fn((server: ServerInfo, username: string | null, _intent?: Intent) => session?.(server, username) ?? fakeSession(server, username))
  const watch = vi.fn()
  const play = vi.fn()
  const logout = vi.fn()
  const page = vi.fn()
  const at = vi.fn()
  const screen = new FrontEnd(host, { connect, session: (s, u) => session?.(s, u) ?? null, logout, play, watch, at, page, padConnected: () => padConnected, ping })
  made.push(screen)
  return { screen, connect, watch, play, logout, page, at }
}

function makePlay(...args: Parameters<typeof make>): Made {
  const made = make(...args)
  made.screen.open({ kind: 'menu', path: 'play' })
  return made
}

/** The rows of the screen's list: the label of each item, in order (the roster's rows by player). */
function labels(screen: FrontEnd): string[] {
  return Array.from(screen.root.querySelectorAll('.menu .item .label, table.roster tr.game td.col-user')).map((el) => el.textContent ?? '')
}

function sub(screen: FrontEnd, label: string): string | null {
  const item = Array.from(screen.root.querySelectorAll('.menu .item')).find((el) => el.querySelector('.label')?.textContent === label)
  return item?.querySelector('.sub:not([hidden]), .val .v')?.textContent ?? null
}

/** The compact identity, with a status only when there is a problem. */
function conn(screen: FrontEnd): string | null {
  const item = screen.root.querySelector('.signed-in span')
  return item && !item.parentElement?.hidden ? item.textContent : null
}

function pick(screen: FrontEnd, label: string) {
  const items = Array.from(screen.root.querySelectorAll('.menu .item, table.roster tr.game'))
  if ((label === 'What’s new' || label === 'About & credits') && screen.view === 'home') { screen.root.querySelector<HTMLButtonElement>(`[data-focus="${label === 'What’s new' ? 'news' : 'about'}"]`)!.click(); return }
  const item = items.find((el) => el.querySelector('.label')?.textContent === label) ?? items.find((el) => el.querySelector('td.col-user')?.textContent === label)
  if (!item) throw new Error(`no row "${label}" on the screen; there is ${JSON.stringify(labels(screen))}`)
  ;(item as HTMLElement).click()
}

/** the rows of the dialog on show (the exit report), which stands over a screen with rows of its own */
function dialogLabels(screen: FrontEnd): string[] {
  return Array.from(screen.root.querySelectorAll('.dialog-over .menu .item .label')).map((el) => el.textContent ?? '')
}

function focused(screen: FrontEnd): string | undefined {
  return (screen.root.querySelector('.focused') as HTMLElement | null)?.dataset.focus
}

function press(screen: FrontEnd, key: string, target?: EventTarget) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  if (target) Object.defineProperty(ev, 'target', { value: target })
  return screen.key(ev)
}

function pad(screen: FrontEnd, button: 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'START') {
  screen.pad({ type: 'press', button, t: 0 })
}

describe('the front end: the home screen', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
  })

  it('navigates the front menu with an Android d-pad reported without a mapping flag', () => {
    const { screen } = make(undefined, true)
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
    const controller = { id: 'Odin Controller', index: 0, mapping: '', axes: [0, 0, 0, 0], buttons } as unknown as Gamepad
    vi.stubGlobal('navigator', { getGamepads: () => [controller] })
    const input = new GamepadInput()
    input.on((ev) => screen.pad(ev))
    input.poll(0)
    const initial = focused(screen)
    buttons[13] = { pressed: true, touched: true, value: 1 }
    input.poll(16)
    const next = focused(screen)
    expect(next).toBeDefined()
    expect(next).not.toBe(initial)
    input.poll(400)
    expect(focused(screen)).not.toBe(next)
    buttons[13] = { pressed: false, touched: false, value: 0 }
    input.poll(416)
    buttons[12] = { pressed: true, touched: true, value: 1 }
    input.poll(432)
    expect(focused(screen)).toBe(next)
  })

  it('offers no first-person room controls on keyboard, pad or touch', () => {
    const legend = (screen: FrontEnd) => screen.root.querySelector('.legend .menu-prompt')?.getAttribute('aria-label') ?? null
    const pointer = (fine: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: fine && q === '(pointer: fine)' }))
    pointer(true)
    expect(legend(make(undefined, true).screen)).toBeNull()
    expect(legend(make().screen)).toBeNull()
    pointer(false)
    expect(legend(make().screen)).toBeNull()
  })

  it('Launching from Play leaves the screen standing until the game comes, rather than sliding it in again', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    const { screen, connect } = makePlay(() => s)
    const frame = screen.root.querySelector('.polished-home')
    const menu = screen.root.querySelector('.menu')
    pick(screen, 'Play DCSS 0.34')
    expect(connect).toHaveBeenCalledWith(cdi, 'orbrun', { kind: 'play', gameId: 'dcss-web-0.34' })
    expect(screen.view).toBe('play')
    expect(screen.root.querySelector('.polished-home')).toBe(frame)
    expect(screen.root.querySelector('.menu')).toBe(menu)
    expect(focused(screen)).toBe('play:dcss-web-0.34')
    // the lobby's news lands meanwhile: the screen is drawn again in place, not as a new one
    s.state.lobby.entries = new Map([[1, playing('alice')]])
    screen.refresh()
    expect(focused(screen)).toBe('play:dcss-web-0.34')
    expect(screen.root.querySelector('.polished-home')).toBe(frame)
  })

  it('keeps the four root actions and opens the server versions in Play', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    localStorage.setItem('orbrun.last', JSON.stringify({ serverId: 'cdi', username: 'orbrun', gameId: 'dcss-web-trunk' }))
    const s = fakeSession(cdi, 'orbrun', {
      username: 'orbrun',
      complete: true,
      games: [
        { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-web-trunk', label: 'DCSS trunk', save: 'orbrun, a level 9 Minotaur Berserker of Trog' },
      ],
      entries: new Map([[1, playing('alice')]]),
    })
    const { screen } = make(() => s)
    expect(labels(screen)).toEqual(['Play', 'Play Offline', 'Watch', 'Settings'])
    expect(sub(screen, 'Play')).toBe('Continue DCSS trunk · XL9 MiBe')
    expect(sub(screen, 'Watch')).toBe('1 playing')
    expect(screen.root.querySelector<HTMLElement>('.account-bar')?.hidden).toBe(false)
    pick(screen, 'Play')
    expect(screen.view).toBe('play')
    expect(labels(screen)).toEqual(['Back', 'Play DCSS 0.34', 'Continue DCSS trunk', 'Morgues'])
    expect(sub(screen, 'Continue DCSS trunk')).toBe('a level 9 Minotaur Berserker of Trog')
    expect(conn(screen)).toBe('orbrun')
    expect(focused(screen)).toBe('play:dcss-web-0.34')
    pad(screen, 'B')
    expect(screen.view).toBe('home')
    expect(focused(screen)).toBe('play')
    s.state.lobby.games.push({ id: 'dcss-web-0.33', label: 'DCSS 0.33', save: 'orbrun, a level 12 Djinni Necromancer' })
    screen.refresh()
    expect(sub(screen, 'Play')).toBe('2 games in progress')
  })

  it('shows how the last game ended in a dialog over the front, as the official lobby’s exit dialog, until closed', () => {
    // another client took over the account: the server hung this game up, crawl saved, and game_ended said so
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    s.state.exit = { reason: 'disconnect', message: 'Game saved, see you later!\n', dump: 'https://crawl.dcss.io/morgue/orbrun/orbrun' }
    const { screen } = makePlay(() => s)
    // the report is a dialog laid over the front, which stands behind it with its rows and its cursor put by
    expect(screen.view).toBe('exit')
    const dialog = screen.root.querySelector('.frame.dialog-over.exit-list')!
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('h1')?.textContent).toBe('Disconnected')
    expect(screen.root.querySelector('.polished-title')?.getAttribute('aria-label')).toBe('Polished Crawl')
    expect(labels(screen)).toContain('Play DCSS 0.34')
    const report = screen.root.querySelector('.exit-report')!
    expect(report.querySelector('p')?.textContent).toBe('You have been disconnected.')
    expect(report.querySelector('pre')?.textContent).toBe('Game saved, see you later!')
    // the morgue file is a row, read here rather than in a tab
    expect(report.querySelector('a')).toBeNull()
    expect(dialogLabels(screen)).toEqual(['Close', 'Morgue file'])
    expect(focused(screen)).toBe('exit:close')
    // the cursor reaches the row, and Escape (B) closes the report from anywhere on it
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('exit:dump')
    press(screen, 'Escape')
    expect(s.state.exit).toBeNull()
    expect(screen.view).toBe('play')
    expect(screen.root.querySelector('.exit-report')).toBeNull()
    expect(labels(screen)).toContain('Play DCSS 0.34')
    // Close does the same
    s.state.exit = { reason: 'crash', dump: 'https://crawl.dcss.io/morgue/orbrun/crash' }
    screen.showHome()
    expect(screen.view).toBe('exit')
    expect(screen.root.querySelector('.dialog-over h1')?.textContent).toBe('Your game crashed')
    expect(dialogLabels(screen)).toEqual(['Close', 'Crash log'])
    ;(screen.root.querySelector('[data-focus="exit:close"]') as HTMLButtonElement).click()
    expect(s.state.exit).toBeNull()
    expect(screen.view).toBe('play')
    // a plain save with nothing to say shows nothing, as client.js go_lobby skips normal exits
    s.state.exit = { reason: 'saved' }
    screen.showHome()
    expect(screen.view).toBe('play')
    expect(s.state.exit).toBeNull()
    expect(screen.root.querySelector('.exit-report')).toBeNull()
  })

  it('reads the morgue file here through the shell’s proxy, and falls back to a link when it cannot', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    // the server hands the file as a path of its own, less the `.txt`, as CDI does
    s.state.exit = { reason: 'dead', message: 'You die...\n', dump: '/crawl/morgue/orbrun/morgue-orbrun-20260910-120000' }
    const fetched = vi.fn(async (_url: string) => new Response(' Dungeon Crawl Stone Soup version 0.34\n\n123 orbrun the Vexing (level 1, 0/12 HPs)\n', { status: 200 }))
    vi.stubGlobal('fetch', fetched)
    try {
      const { screen } = makePlay(() => s)
      expect(screen.view).toBe('exit')
      pick(screen, 'Morgue file')
      expect(screen.view).toBe('doc')
      expect(screen.root.querySelector('.head .place')?.textContent).toBe('Morgue file')
      expect(fetched).toHaveBeenCalledWith('/morgue-proxy/crawl.dcss.io/crawl/morgue/orbrun/morgue-orbrun-20260910-120000.txt')
      expect(screen.root.querySelector('.doc-scroll')?.textContent).toBe('Loading…')
      // read as a morgue (morgue-text.ts), not as one long line of text
      await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .morgue')?.textContent).toContain('orbrun the Vexing'))
      // no link out while it reads here
      expect(screen.root.querySelector('.about-links')).toBeNull()
      // Back returns to the report, with the game's end still on show
      pad(screen, 'B')
      expect(screen.view).toBe('exit')
      expect(s.state.exit).not.toBeNull()
      expect(focused(screen)).toBe('exit:dump')

      // a file the server will not give: the words say so, and the link out stands in
      fetched.mockImplementation(async () => new Response('gone', { status: 404 }))
      pad(screen, 'A')
      expect(screen.view).toBe('doc')
      await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .doc-failed')?.textContent).toBe('Could not read it here (HTTP 404).'))
      const link = screen.root.querySelector<HTMLAnchorElement>('.about-links a')!
      expect(link.href).toBe('https://crawl.dcss.io/crawl/morgue/orbrun/morgue-orbrun-20260910-120000.txt')
      expect(link.target).toBe('_blank')
      expect(focused(screen)).toBe('link:0')
      press(screen, 'Escape')
      expect(screen.view).toBe('exit')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('names the account’s own game from the roster when the server’s links keep the save to themselves', () => {
    // CDI (2026-09-09) sends plain links for every game even with a save waiting; the roster still lists a game of
    // yours that is open on the server, with the character, so that version reads Continue and says who
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', {
      username: 'orbrun',
      complete: true,
      games: [
        { id: 'dcss-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-git', label: 'DCSS trunk' },
      ],
      entries: new Map([[1, playing('alice')], [2, playing('Orbrun', { game_id: 'dcss-git', char: 'VSIE', xl: '2', place: 'D:2', title: 'Chiller' })]]),
    })
    const { screen } = make(() => s)
    // trunk is the one with a game waiting, and it still sits under 0.34 rather than jumping the list
    expect(sub(screen, 'Play')).toBe('Continue DCSS trunk · XL2 VSIE')
    pick(screen, 'Play')
    expect(labels(screen).slice(1, 3)).toEqual(['Play DCSS 0.34', 'Continue DCSS trunk'])
    expect(sub(screen, 'Continue DCSS trunk')).toBe('Orbrun the Chiller, VSIE XL2')
    // Play on such a server is not surely a new game, and its hint does not promise one
    expect(focused(screen)).toBe('play:dcss-0.34')
    press(screen, 'ArrowDown')
    // the roster line goes (the server stopped the process, or the game was played out and died in another
    // browser): with nothing live to go on the row stops naming a character and stops promising a game
    s.state.lobby.entries = new Map([[1, playing('alice')]])
    screen.refresh()
    expect(labels(screen).slice(1, 3)).toEqual(['Play DCSS 0.34', 'Play DCSS trunk'])
    expect(sub(screen, 'Play DCSS trunk')).toBeNull()
  })

  it('asks the server what is waiting: `.where` turns one version’s row into Continue and leaves the other alone', async () => {
    // crawl.dcss.io publishes no save info over the socket, but crawl writes <player>.where into the morgue
    // directory on every save and every death (chardump.cc whereis_record). This is the real file, for a trunk
    // game saved in D:2 — so trunk continues and 0.34, which the file says nothing about, does not pretend to.
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const where =
      'v=0.35-a0:vlong=0.35-a0-1015-gbe08bfc2e8:tiles=1:name=orbrun:race=Minotaur:cls=Fighter:char=MiFi:xl=3:' +
      'title=Covered:place=D::2:br=D:lvl=2:hp=30:mhp=33:turn=1084:status=saved\n'
    const fetched = vi.fn(async (url: string) => new Response(url.endsWith('/crawl/morgue/orbrun/orbrun.where') ? where : '', { status: url.endsWith('/crawl/morgue/orbrun/orbrun.where') ? 200 : 404 }))
    vi.stubGlobal('fetch', fetched)
    const s = fakeSession(cdi, 'orbrun', {
      username: 'orbrun',
      complete: true,
      games: [
        { id: 'dcss-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-git', label: 'DCSS trunk' },
      ],
      entries: new Map([[1, playing('alice')]]),
    })
    const { screen } = make(() => s)
    // drawn before the file lands, and redrawn when it does
    expect(sub(screen, 'Play')).toBeNull()
    await vi.waitFor(() => expect(sub(screen, 'Play')).toBe('Continue DCSS trunk · XL3 MiFi'))
    pick(screen, 'Play')
    expect(labels(screen).slice(1, 3)).toEqual(['Play DCSS 0.34', 'Continue DCSS trunk'])
    expect(fetched).toHaveBeenCalledWith('/morgue-proxy/crawl.dcss.io/crawl/morgue/orbrun/orbrun.where', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(sub(screen, 'Continue DCSS trunk')).toBe('orbrun the Covered, Minotaur Fighter XL3')
    expect(sub(screen, 'Play DCSS 0.34')).toBeNull()
    press(screen, 'ArrowDown')
    // the character walked into a hobgoblin in another browser: the same file says so, and the row lets go
    screen.attach(s)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(where.replace('status=saved', 'status=dead'), { status: 200 })))
    screen.refresh()
    await vi.waitFor(() => expect(labels(screen).slice(1, 3)).toEqual(['Play DCSS 0.34', 'Play DCSS trunk']))
  })

  it('hides credentials while a saved login is pending and restores the prefilled form if it fails', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    setToken('cdi', 'orbrun', 'tok')
    const s = fakeSession(cdi, 'orbrun', { games: [{ id: 'dcss-git', label: 'DCSS trunk' }] })
    ;(s as { loggingIn: boolean }).loggingIn = true
    const { screen } = makePlay(() => s)
    expect(labels(screen)).not.toContain('Log in')
    expect(labels(screen)).toContain('Play DCSS trunk')
    const form = screen.root.querySelector<HTMLFormElement>('.inline-login')!
    expect(form.hidden).toBe(true)
    expect(screen.root.querySelector('.auth-status')?.textContent).toContain('Signing you back in')
    setToken('cdi', 'orbrun', null)
    s.loggingIn = false
    s.savedLoginRejected = true
    s.state.lobby.loginFailed = 'Login failed.'
    screen.refresh()
    expect(form.hidden).toBe(false)
    expect(form.querySelector<HTMLInputElement>('[name=username]')?.value).toBe('orbrun')
    expect(screen.root.querySelector('.auth-status')?.textContent).toBe('')
  })

  it('lets a `.where` that lands after destroy go: no redraw, and no session followed on behalf of a screen that is gone', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const where = 'v=0.35-a0:vlong=0.35-a0-1015-gbe08bfc2e8:tiles=1:name=orbrun:race=Minotaur:cls=Fighter:char=MiFi:xl=3:title=Covered:place=D::2:br=D:lvl=2:hp=30:mhp=33:turn=1084:status=saved\n'
    let land: (() => void) | null = null
    const fetched = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      land = () => resolve(new Response(where, { status: 200 }))
      init?.signal?.addEventListener('abort', () => reject(new DOMException('gone', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetched)
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun', complete: true, games: [{ id: 'dcss-git', label: 'DCSS trunk' }] })
    const sessions = vi.fn(() => s)
    const { screen } = makePlay(sessions)
    await vi.waitFor(() => expect(fetched).toHaveBeenCalled())
    const signal = (fetched.mock.calls[0] as unknown as [string, RequestInit])[1].signal!
    expect(labels(screen)).toContain('Play DCSS trunk')
    screen.destroy()
    expect(screen.root.isConnected).toBe(false)
    // the fetch in flight is called off with the screen
    expect(signal.aborted).toBe(true)
    const asked = sessions.mock.calls.length
    const left = screen.root.innerHTML
    // and one that resolves regardless (the bytes were already in) changes nothing: the row would have read Continue
    land!()
    await new Promise((r) => setTimeout(r, 0))
    screen.refresh()
    expect(sessions.mock.calls.length).toBe(asked)
    expect(screen.root.innerHTML).toBe(left)
  })

  it('never speaks a save this device only remembers: the same account plays from any browser', () => {
    // a character can be walked into a hobgoblin from another browser at any moment; the server publishes no
    // save info to contradict it, so a Continue built from this device's memory would name someone dead
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    localStorage.setItem('orbrun.last', JSON.stringify({ serverId: 'cdi', gameId: 'dcss-git', username: 'orbrun' }))
    localStorage.setItem('orbrun.characters', JSON.stringify({ cdi: { 'dcss-git': { name: 'orbrun', title: 'the Chiller', species: 'Vine Stalker', xl: 2, place: 'Dungeon', depth: 2 } } }))
    const s = fakeSession(cdi, 'orbrun', {
      username: 'orbrun',
      complete: true,
      games: [
        { id: 'dcss-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-git', label: 'DCSS trunk' },
      ],
      entries: new Map([[1, playing('alice')]]),
    })
    const { screen } = makePlay(() => s)
    expect(labels(screen).slice(1, 3)).toEqual(['Play DCSS 0.34', 'Play DCSS trunk'])
    expect(sub(screen, 'Play DCSS trunk')).toBeNull()
    press(screen, 'ArrowDown')
  })

  it('scrolls a document with up and down, the d-pad and the right stick, while Back keeps the cursor', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    s.state.exit = { reason: 'dead', message: 'You die...\n', dump: '/crawl/morgue/orbrun/morgue-orbrun-20260910-120000' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('orbrun the Vexing\n'.repeat(200), { status: 200 })))
    try {
      const { screen } = makePlay(() => s)
      pick(screen, 'Morgue file')
      await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .morgue')).not.toBeNull())
      const scroller = screen.root.querySelector('.doc-scroll') as HTMLElement
      Object.defineProperty(scroller, 'clientHeight', { value: 500 })
      scroller.scrollTop = 0
      expect(press(screen, 'ArrowDown')).toBe(true)
      expect(scroller.scrollTop).toBe(100)
      screen.pad({ type: 'dir', source: 'dpad', dir: 4 })
      expect(scroller.scrollTop).toBe(200)
      screen.pad({ type: 'pan', dx: 0, dy: 5 })
      expect(scroller.scrollTop).toBe(260)
      press(screen, 'ArrowUp')
      expect(scroller.scrollTop).toBe(160)
      press(screen, 'PageDown')
      expect(scroller.scrollTop).toBe(612)
      press(screen, 'Home')
      expect(scroller.scrollTop).toBe(0)
      // the cursor stays where it stood, on Copy beside Back: up and down are the document's
      expect(focused(screen)).toBe('doc:copy')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('opens What’s new at its own address and clears its unread indicator', () => {
    localStorage.setItem('polished-crawl.newsSeen', '0.1.0')
    const { screen } = make()
    expect(screen.root.querySelector('[data-focus="news"].unread')).not.toBeNull()
    screen.open({ kind: 'menu', path: 'whats-new' })
    expect(screen.root.querySelector('dialog[open]')).not.toBeNull()
    expect(screen.root.querySelector('.doc.news .release.latest.fresh .ver')?.textContent).toBe(RELEASE_ID)
    press(screen, 'Escape')
    expect(screen.root.querySelector('[data-focus="news"].unread')).toBeNull()
  })

  it('a dropped connection the app is retrying says so, one it is not says why it closed', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun' })
    const { screen } = make(() => s)
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'closed', reason: 'the connection dropped' })
    expect(screen.root.querySelector('.error')?.textContent).toBe('Connection closed: the connection dropped')
    const host = document.createElement('div')
    document.body.append(host)
    const retrying = new FrontEnd(host, { connect: () => s, session: () => s, retrying: () => true, logout: () => {}, play: () => {}, watch: () => {}, at: () => {} })
    made.push(retrying)
    retrying.showHome()
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'closed', reason: 'the connection dropped' })
    expect(retrying.root.querySelector('.error')?.textContent).toBe('Connection lost. Reconnecting…')
  })

  it('X opens the settings, Y does nothing on the front, and the controls sit only in the settings', () => {
    const { screen } = make()
    while (focused(screen) !== 'settings') press(screen, 'ArrowDown')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('settings')
    pad(screen, 'Y')
    expect(screen.view).toBe('home')
    pad(screen, 'X')
    expect(screen.view).toBe('settings')
    pick(screen, 'Controls')
    pick(screen, 'Gamepad controls')
    expect(screen.view).toBe('controls')
    pad(screen, 'B')
    expect(screen.view).toBe('settings-group')
  })

  it('never announces the controller in the footer', () => {
    expect(make(undefined, true).screen.root.querySelector('.pad-note')).toBeNull()
  })

  it('leaves the screen alone while it would read the same, and keeps the cursor where it stands on a redraw', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', {}, false)
    const { screen } = make(() => s)
    const before = screen.root.querySelector('.menu')
    while (focused(screen) !== 'settings') press(screen, 'ArrowDown')
    screen.refresh()
    expect(screen.root.querySelector('.menu')).toBe(before)
    // the login lands: the line changes, the screen is drawn again in place, the cursor stays on Settings
    ;(s.conn as { open: boolean }).open = true
    s.state.lobby.username = 'orbrun'
    screen.refresh()
    expect(screen.root.querySelector('.menu')).toBe(before)
    expect(conn(screen)).toBe('orbrun')
    expect(focused(screen)).toBe('settings')
    expect(screen.root.querySelector('.menu')).toBe(before)
  })

  it('words a game’s end as client.js exit_reason_message does', () => {
    expect(exitReasonMessage('saved', null)).toBeNull()
    expect(exitReasonMessage('dead', null)).toBeNull()
    expect(exitReasonMessage('disconnect', null)).toBe('You have been disconnected.')
    expect(exitReasonMessage('crash', null)).toBe('Unfortunately your game crashed.')
    expect(exitReasonMessage('weird', null)).toBe('Unfortunately your game ended unexpectedly. (weird)')
    expect(exitReasonMessage('unknown', null)).toBe('Unfortunately your game ended unexpectedly.')
    expect(exitReasonMessage('dead', 'alice')).toBeNull()
    expect(exitReasonMessage('saved', 'alice')).toBe('alice stopped playing (saved).')
    expect(exitReasonMessage('crash', 'Chris')).toBe("Chris' game crashed.")
    expect(exitReasonMessage('disconnect', 'alice')).toBe('alice has been disconnected.')
  })
})

describe('the front end: accounts and servers', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
  })

  it.each([['responding servers', 'crg'], ['no readings', 'cdi']])('chooses the initial server with %s', async (scenario, expected) => {
    const ping = async (server: ServerInfo) => scenario === 'no readings' ? null : server.id === 'crg' ? 20 : 80
    const { screen, connect } = make(undefined, false, ping)
    screen.homeRoute()
    const picker = screen.root.querySelector<HTMLSelectElement>('.account-bar select')!
    expect(picker.value).toBe('cdi')
    await vi.waitFor(() => expect(picker.value).toBe(expected))
    expect(connect.mock.lastCall?.[0].id).toBe(expected)
  })

  it('skips latency probes for a previously used server', () => {
    setLast({ serverId: 'crg' })
    const ping = vi.fn(async () => 10)
    const { screen } = make(undefined, false, ping)
    screen.homeRoute()
    expect(screen.root.querySelector<HTMLSelectElement>('.account-bar select')?.value).toBe('crg')
    expect(ping).not.toHaveBeenCalled()
  })

  it('keeps an explicit server selection made while probing, including after reopening', async () => {
    let finish!: (ms: number) => void
    const pending = new Promise<number>(resolve => { finish = resolve })
    const ping = vi.fn((server: ServerInfo) => server.id === 'crg' ? pending : Promise.resolve(null))
    const { screen, connect } = make(undefined, false, ping)
    screen.homeRoute()
    const picker = screen.root.querySelector<HTMLSelectElement>('.account-bar select')!
    picker.value = 'cao'
    picker.dispatchEvent(new Event('change'))
    finish(20)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(picker.value).toBe('cao')
    expect(connect.mock.lastCall?.[0].id).toBe('cao')
    screen.destroy()
    ping.mockClear()
    const reopened = make(undefined, false, ping).screen
    reopened.homeRoute()
    expect(reopened.root.querySelector<HTMLSelectElement>('.account-bar select')?.value).toBe('cao')
    expect(ping).not.toHaveBeenCalled()
  })

  it('routes custom server links to the public registry in production', () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('MODE', 'production')
    try {
      const { screen, at } = make()
      screen.open({ kind: 'menu', path: 'watch' })
      expect(screen.view).toBe('servers')
      expect(labels(screen)).toContain('CDI')
      expect(labels(screen)).not.toContain('Add a server')
      screen.open({ kind: 'menu', path: 'watch/add' })
      expect(screen.view).toBe('servers')
      expect(screen.root.querySelector('input[name=server]')).toBeNull()
      expect(labels(screen)).not.toContain('Add a server')
      expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'watch' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('the server list writes each ping in when it lands, and leaves a server that did not answer blank', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ping = vi.fn(async (sv: ServerInfo) => (sv.id === 'crg' ? null : 42))
    const screen = new FrontEnd(host, { connect: (sv, u) => fakeSession(sv, u), logout: () => {}, play: () => {}, watch: () => {}, at: () => {}, ping })
    made.push(screen)
    screen.open({ kind: 'menu', path: 'watch' })
    const sub = (id: string) => screen.root.querySelector(`[data-focus="server:${id}"] .sub`)?.textContent
    expect(sub('cdi')).toBe('New York, USA · crawl.dcss.io')
    await Promise.resolve()
    await Promise.resolve()
    expect(sub('cdi')).toBe('New York, USA · crawl.dcss.io · 42 ms')
    expect(sub('crg')).toBe('Oregon, USA · crawl.roguelikes.gg')
    expect(ping).toHaveBeenCalledTimes(9)
  })

  it('Add a server is a screen of its own: an address, then the list with the cursor on it', () => {
    const at = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const screen = new FrontEnd(host, { connect: (sv, u) => fakeSession(sv, u), logout: () => {}, play: () => {}, watch: () => {}, at })
    made.push(screen)
    screen.open({ kind: 'menu', path: 'watch' })
    pick(screen, 'Add a server')
    expect(screen.view).toBe('add-server')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'watch/add' })
    expect(labels(screen)).toEqual(['Back', 'Address', 'Add'])
    expect(focused(screen)).toBe('address')
    const input = () => screen.root.querySelector<HTMLInputElement>('input[name=server]')!
    // not an address: said here, with the text kept to fix
    input().value = 'not a host'
    pick(screen, 'Add')
    expect(screen.view).toBe('add-server')
    expect(screen.root.querySelector('.error')?.textContent).toBe('not a host is not an address.')
    expect(input().value).toBe('not a host')
    input().value = 'http://crawl.example.org:8080/some/page'
    pick(screen, 'Add')
    expect(screen.view).toBe('servers')
    expect(focused(screen)).toBe('server:crawl.example.org:8080')
    expect(findServer('crawl.example.org:8080')).toMatchObject({ ws: 'ws://crawl.example.org:8080/socket', http: 'http://crawl.example.org:8080', custom: true })
    // one it added comes off again; the bundled ones do not
    expect(screen.root.querySelector('[data-focus="remove:crawl.example.org:8080"]')).not.toBeNull()
    expect(screen.root.querySelector('[data-focus="remove:cdi"]')).toBeNull()
    ;(screen.root.querySelector('[data-focus="remove:crawl.example.org:8080"]') as HTMLElement).click()
    expect(findServer('crawl.example.org:8080')).toBeNull()
    // a host already listed is found, not added twice; Back from the screen is the list it came from
    pick(screen, 'Add a server')
    input().value = 'CRAWL.DCSS.IO'
    pick(screen, 'Add')
    expect(focused(screen)).toBe('server:cdi')
    expect(labels(screen).filter((l) => l === 'CDI')).toHaveLength(1)
    pick(screen, 'Add a server')
    press(screen, 'Escape')
    expect(screen.view).toBe('servers')
    expect(focused(screen)).toBe('add-server')
    // and from Watch, the same screen at an address of its own
    screen.open({ kind: 'menu', path: 'watch/add' })
    expect(screen.view).toBe('add-server')
    press(screen, 'Escape')
    expect(screen.root.querySelector('.head .place')?.textContent).toBe('Watch')
  })

  it('asks for the chosen account\'s connection again when its screens come back from a login that took its place', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const warm = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const screen = new FrontEnd(host, { connect: (sv, u) => fakeSession(sv, u), logout: () => {}, play: () => {}, watch: () => {}, at: () => {}, warm })
    made.push(screen)
    screen.showHome()
    screen.open({ kind: 'menu', path: 'login', serverId: 'crg' })
    expect(screen.view).toBe('login')
    warm.mockClear()
    press(screen, 'Escape')
    expect(screen.view).toBe('play')
    expect(warm).toHaveBeenCalled()
  })

  it('a drop on a screen that does not stand on the connection leaves nothing for the next screen to say', () => {
    const s = fakeSession(cdi, null)
    const host = document.createElement('div')
    document.body.append(host)
    const screen = new FrontEnd(host, { connect: () => s, session: () => s, retrying: () => true, logout: () => {}, play: () => {}, watch: () => {}, at: () => {} })
    made.push(screen)
    screen.watchFor(s)
    pick(screen, 'Back')
    screen.open({ kind: 'menu', path: 'watch' })
    expect(screen.view).toBe('servers')
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'closed', reason: 'the connection dropped' })
    pick(screen, 'CDI')
    expect(screen.view).toBe('watch')
    expect(screen.root.querySelector('.error')).toBeNull()
  })

  it('keeps a login draft while connecting and accepts it once the socket opens', () => {
    const s = fakeSession(crg, null, {}, false)
    const { screen } = make(server => server.id === crg.id ? s : null)
    screen.open({ kind: 'menu', path: 'login', serverId: crg.id })
    const form = screen.root.querySelector<HTMLFormElement>('form')!
    const password = form.querySelector<HTMLInputElement>('[name=password]')!
    const submit = form.querySelector<HTMLButtonElement>('[data-focus=login]')!
    form.querySelector<HTMLInputElement>('[name=username]')!.value = 'Alice'
    password.value = 'typed-password'
    expect(submit.disabled).toBe(true)
    form.requestSubmit()
    expect(s.send).not.toHaveBeenCalled()
    Object.assign(s.conn, { open: true })
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'open' })
    expect(submit.disabled).toBe(false)
    expect(password.value).toBe('typed-password')
    form.requestSubmit()
    expect(s.send).toHaveBeenCalledWith({ msg: 'login', username: 'Alice', password: 'typed-password' })
  })

  it('Start chooses a row, then submits a focused login field like Enter', () => {
    const { screen } = make()
    screen.open({ kind: 'menu', path: 'login', serverId: 'crg' })
    const name = screen.root.querySelector<HTMLInputElement>('input[name=username]')!
    name.value = 'orbrun'
    screen.root.querySelector<HTMLInputElement>('input[name=password]')!.value = 'pw'
    name.focus()
    const submit = vi.spyOn(name.form!, 'requestSubmit').mockImplementation(() => {})
    pad(screen, 'START')
    expect(submit).toHaveBeenCalledOnce()
    expect(screen.root.querySelector('.osk')).toBeNull()
  })

  it('leaves a new device online until Play Offline is selected', () => {
    const supported = vi.spyOn(servers, 'offlineRuns').mockReturnValue(true)
    const discover = vi.spyOn(engines, 'refresh').mockResolvedValue()
    try {
      const { screen } = make()
      expect(getChosenAccount()).toBeNull()
      expect(discover).not.toHaveBeenCalled()
      pick(screen, 'Play Offline')
      expect(getChosenAccount()).toEqual({ serverId: 'offline', username: 'Player' })
      expect(discover).toHaveBeenCalledOnce()
    } finally { supported.mockRestore(); discover.mockRestore() }
  })

  it('explains unavailable persistent storage and lets the player return', () => {
    const { screen } = make()
    pick(screen, 'Play Offline')
    expect(screen.root.textContent).toContain('Web Locks')
    expect(screen.view).toBe('offline')
    expect(labels(screen)).not.toContain('Settings')
    expect(labels(screen)[0]).toBe('Back')
    expect(focused(screen)).toBe('back')
    pick(screen, 'Back')
    expect(screen.view).toBe('home')
    expect(focused(screen)).toBe('offline')
    expect(getChosenAccount()).toBeNull()
  })

  it('says there is no connection to the chosen server while the device has no network, and nothing once it is back', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
      localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
      const { screen } = make((sv, u) => fakeSession(sv, u, {}, false))
      expect(sub(screen, 'Watch')).toBe('No connection')
      pick(screen, 'Play')
      expect(screen.view).toBe('home')
      // the account stays the one chosen
      expect(screen.root.querySelector<HTMLInputElement>('[name=username]')?.value).toBe('orbrun')

      onLine.mockReturnValue(true)
      const back = make((sv, u) => fakeSession(sv, u, {}, false)).screen
      expect(back.root.querySelector('.auth-status')?.textContent).toBe('Connecting…')
      expect(sub(back, 'Watch')).toBe('Connecting…')
    } finally {
      onLine.mockRestore()
    }
  })

  it('logging out clears the remembered login and closes its connection without reporting a drop', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun, roguelikes]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/orbrun': 'tok', 'crg/orbrun': 'tok' }))
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun' })
    const { screen, logout } = make((sv, u) => (sv.id === 'cdi' && u === 'orbrun' ? s : null))
    ;(screen.root.querySelector('[data-focus="logout"]') as HTMLElement).click()
    expect(logout).toHaveBeenCalledWith(orbrun, 'tok')
    expect(getChosenAccount()).toBeNull()
    expect(servers.getToken('cdi', 'orbrun')).toBeNull()
    // the close it asked for lands a moment later (an offline engine's worker winds down on its own time)
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'closed', reason: 'closed by the server' })
    expect(screen.view).toBe('home')
    expect(screen.root.querySelector('.error')).toBeNull()
  })

  it('a `/watch/cdi` address over the offline account watches on CDI, though the offline session closes as it is left', () => {
    vi.stubEnv('MODE', 'development')
    vi.spyOn(servers, 'offlineRuns').mockReturnValue(true)
    try {
      const player: Account = { serverId: 'offline', username: 'Player' }
      localStorage.setItem('orbrun.accounts', JSON.stringify([player]))
      servers.enterOffline()
      const device = fakeSession(OFFLINE_SERVER, 'Player', { username: 'Player' })
      const roster = fakeSession(cdi, null, { complete: true, entries: new Map([[1, playing('bob')]]) })
      let current: Session = device
      const { screen, connect } = make((server, username) => (current.server.id === server.id && (current.username ?? null) === username ? current : null))
      // main.ts openSession: the session it replaces closes, and an offline one says so at once, before the new one is up
      connect.mockImplementationOnce(() => {
        ;(device as { closed: boolean }).closed = true
        ;(device as unknown as { emit(e: unknown): void }).emit({ type: 'closed', reason: 'closed' })
        current = roster
        return roster
      })
      screen.watchServer(cdi)
      expect(connect).toHaveBeenCalledTimes(1)
      expect(connect).toHaveBeenCalledWith(cdi, null)
      expect(screen.view).toBe('watch')
      expect(labels(screen)).toEqual(['Back', 'bob'])
      // the roster's socket opening redraws the Watch screen of CDI, not the offline account's
      screen.refresh()
      expect(screen.view).toBe('watch')
      expect(labels(screen)).toEqual(['Back', 'bob'])
      expect(connect).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a confirmed login replaces the previously remembered login', () => {
    setOnlineAccount(orbrun)
    setToken('cdi', 'orbrun', 'old')
    const { screen } = make()
    screen.open({ kind: 'menu', path: 'login', serverId: 'crg' })
    expect(getChosenAccount()).toEqual(orbrun)
    ;(screen.root.querySelector('input[name=username]') as HTMLInputElement).value = 'Orbrun'
    ;(screen.root.querySelector('input[name=password]') as HTMLInputElement).value = 'pw'
    ;(screen.root.querySelector('form') as HTMLFormElement).requestSubmit()
    // the connection the form used answers
    const sess = (screen as unknown as { session: Session }).session
    expect(sess.send).toHaveBeenCalledWith({ msg: 'login', username: 'Orbrun', password: 'pw' })
    sess.state.lobby.username = 'Orbrun'
    ;(sess as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'login_success' } })
    expect(getChosenAccount()).toEqual({ serverId: 'crg', username: 'Orbrun' })
    expect(servers.getToken('cdi', 'orbrun')).toBeNull()
    expect(screen.view).toBe('play')
    expect(screen.root.querySelector<HTMLInputElement>('[name=username]')?.value).toBe('Orbrun')
  })

  it('sends the name without the space a phone keyboard leaves after a suggestion, and keeps it from being corrected', () => {
    fakeSession(crg, null)
    const { screen } = make()
    screen.open({ kind: 'menu', path: 'login', serverId: 'crg' })
    const user = screen.root.querySelector('input[name=username]') as HTMLInputElement
    expect([user.getAttribute('autocapitalize'), user.getAttribute('autocorrect'), user.getAttribute('spellcheck')]).toEqual(['off', 'off', 'false'])
    user.value = 'Orbrun '
    ;(screen.root.querySelector('input[name=password]') as HTMLInputElement).value = 'pw '
    ;(screen.root.querySelector('form') as HTMLFormElement).requestSubmit()
    const sess = (screen as unknown as { session: Session }).session
    // a password may end in a space
    expect(sess.send).toHaveBeenCalledWith({ msg: 'login', username: 'Orbrun', password: 'pw ' })
  })
})

describe('the front end: Play and Watch', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
  })

  function loggedIn(entries: LobbyEntry[] = [playing('alice')]): Session {
    return fakeSession(cdi, 'orbrun', {
      username: 'orbrun',
      complete: true,
      games: [
        { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-web-trunk', label: 'DCSS trunk', save: 'orbrun, a level 9 Minotaur Berserker of Trog' },
      ],
      entries: new Map(entries.map((e) => [e.id, e])),
    })
  }

  it('Play lists each version once, with its save, and launches it directly', () => {
    const s = loggedIn()
    const { screen, connect } = makePlay(() => s)
    expect(screen.view).toBe('play')
    expect(labels(screen)).toEqual(['Back', 'Play DCSS 0.34', 'Continue DCSS trunk', 'Morgues'])
    expect(focused(screen)).toBe('play:dcss-web-0.34')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('play:dcss-web-trunk')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('play:dcss-web-trunk')
    pad(screen, 'A')
    expect(connect).toHaveBeenLastCalledWith(cdi, 'orbrun', { kind: 'play', gameId: 'dcss-web-trunk' })
    pick(screen, 'Play DCSS 0.34')
    expect(connect).toHaveBeenLastCalledWith(cdi, 'orbrun', { kind: 'play', gameId: 'dcss-web-0.34' })
  })

  it('tells the address bar where it stands: lobby is the Watch screen, home is home', () => {
    const s = loggedIn()
    const at = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const screen = new FrontEnd(host, { connect: () => s, session: () => s, logout: () => {}, play: () => {}, watch: () => {}, at, padConnected: () => false })
    made.push(screen)
    // the home screen it starts on is the caller's address already
    expect(at).not.toHaveBeenCalled()
    pick(screen, 'Watch')
    expect(screen.view).toBe('watch')
    expect(at).toHaveBeenLastCalledWith({ kind: 'lobby', serverId: 'cdi', account: orbrun })
    // redraws of the roster do not say it again
    at.mockClear()
    screen.refresh()
    expect(at).not.toHaveBeenCalled()
    press(screen, 'Escape')
    expect(screen.view).toBe('home')
    expect(at).toHaveBeenLastCalledWith({ kind: 'home' })
    // after a spectate: the roster; after a game: home
    screen.watchFor(s)
    expect(screen.view).toBe('watch')
    expect(at).toHaveBeenLastCalledWith({ kind: 'lobby', serverId: 'cdi', account: orbrun })
    screen.attach(s)
    expect(screen.view).toBe('play')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'play' })
  })

  it('gives every menu screen an address, and opens each from it', () => {
    const s = loggedIn()
    const at = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const screen = new FrontEnd(host, { connect: () => s, session: () => s, logout: () => {}, play: () => {}, watch: () => {}, at, padConnected: () => false })
    made.push(screen)
    const walk: [string, string, () => void][] = [
      ['settings', 'settings', () => pick(screen, 'Settings')],
      ['settings/view', 'settings-group', () => pick(screen, 'View')],
      ['watch', 'servers', () => screen.showServers()],
    ]
    for (const [path, view, go] of walk) {
      go()
      expect(screen.view).toBe(view)
      expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path })
    }
    // and back again: each address opens its screen, and says nothing new
    for (const [path, view] of walk) {
      at.mockClear()
      screen.open({ kind: 'menu', path })
      expect(screen.view).toBe(view)
      expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path })
    }
    screen.open({ kind: 'menu', path: 'settings/controls/gamepad' })
    expect(screen.view).toBe('controls')
    // the View tab's address from when it was Camera still opens it, at its new address
    at.mockClear()
    screen.open({ kind: 'menu', path: 'settings/camera' })
    expect(screen.view).toBe('settings-group')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'settings/view' })
    screen.open({ kind: 'menu', path: 'login', serverId: 'crg', username: 'someone' })
    expect(screen.view).toBe('login')
    expect((screen.root.querySelector('input[name=username]') as HTMLInputElement).value).toBe('someone')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'login', serverId: 'crg' })
    screen.open({ kind: 'menu', path: 'register', serverId: 'crg' })
    expect(screen.view).toBe('register')
    // Back from the register form is the login it is a row of
    press(screen, 'Escape')
    expect(screen.view).toBe('login')
    // a settings group it does not know is the settings
    screen.open({ kind: 'menu', path: 'settings/nowhere' })
    expect(screen.view).toBe('settings')
  })

  it('adds arriving versions in Play without stealing focus', async () => {
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun' })
    const { screen } = makePlay(() => s)
    expect(screen.view).toBe('play')
    expect(labels(screen)).toEqual(['Back', 'Morgues'])
    expect(screen.root.textContent).toContain('Loading game versions…')
    expect(focused(screen)).toBe('morgues')
    s.state.lobby.complete = true
    s.state.lobby.games = [
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'dcss-web-trunk', label: 'DCSS trunk' },
    ]
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'set_game_links' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(labels(screen)).toEqual(['Back', 'Play DCSS 0.34', 'Play DCSS trunk', 'Morgues'])
    expect(focused(screen)).toBe('morgues')
    expect(screen.root.textContent).not.toContain('Loading game versions…')
  })

  it('offers older versions and modes through the Versions & modes shortcut', () => {
    const s = loggedIn()
    localStorage.setItem('orbrun.last', JSON.stringify({ serverId: 'cdi', gameId: 'dcss-web-0.33' }))
    s.state.lobby.games.push(
      { id: 'sprint-web-0.34', label: 'Sprint 0.34' },
      { id: 'dcss-web-0.32', label: 'DCSS 0.32' },
      { id: 'dcss-web-0.33', label: 'DCSS 0.33', save: 'orbrun, a level 5 Gargoyle Fighter' },
      { id: 'tut-web-trunk', label: 'Tutorial trunk' },
      { id: 'zd-0.17', label: 'Zot Defence 0.17' },
      { id: 'other-game', label: 'Other game', save: 'slot full', disabled: true },
    )
    const { screen, connect } = makePlay(() => s)
    expect(labels(screen)).not.toContain('Continue DCSS 0.33')
    pick(screen, 'More versions & modes')
    expect(screen.view).toBe('versions')
    expect(labels(screen)).toContain('DCSS 0.33')
    expect(labels(screen)).toContain('Zot Defence 0.17')
    expect(labels(screen)).not.toContain('Other game')
    expect(sub(screen, 'DCSS 0.33')).toBe('a level 5 Gargoyle Fighter')
    expect(focused(screen)).toBe('play:dcss-web-trunk')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('play:tut-web-trunk')
    pad(screen, 'A')
    expect(connect).toHaveBeenLastCalledWith(cdi, 'orbrun', { kind: 'play', gameId: 'tut-web-trunk' })
    pick(screen, 'More versions & modes')
    pick(screen, 'DCSS 0.33')
    expect(connect).toHaveBeenLastCalledWith(cdi, 'orbrun', { kind: 'play', gameId: 'dcss-web-0.33' })
    expect(screen.view).toBe('play')
    expect(labels(screen)).not.toContain('Continue DCSS 0.33')
  })

  it('opens versions directly for the remembered account', () => {
    const s = loggedIn()
    const { screen, at } = make(() => s)
    screen.open({ kind: 'menu', path: 'versions', serverId: 'cdi', username: 'orbrun' })
    expect(screen.view).toBe('versions')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'versions', serverId: 'cdi', username: 'orbrun' })
    // A stale account link returns to Play.
    screen.open({ kind: 'menu', path: 'versions', serverId: 'cdi', username: 'stranger' })
    expect(screen.view).toBe('play')
  })

  it('Watch is the roster, by player, and a row picked spectates them', () => {
    const s = loggedIn([playing('bob'), playing('alice', { god: 'Trog', turn: '12143', spectator_count: 1 })])
    const { screen, watch } = make(() => s)
    pick(screen, 'Watch')
    expect(screen.view).toBe('watch')
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob'])
    expect(focused(screen)).toBe(at('alice'))
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('You see here alice (MiBe, XL12, Lair:3), a worshipper of Trog, turn 12143, 1 watching.')
    pad(screen, 'A')
    expect(watch).toHaveBeenCalledWith(s, 'alice')
  })

  it('draws the roster once a frame however many messages the server sends', async () => {
    const s = loggedIn([])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    const draws = vi.spyOn(screen, 'refresh')
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      const id = name.length + name.charCodeAt(0)
      s.state.lobby.entries.set(id, { ...playing(name), id })
      ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    }
    expect(draws).toHaveBeenCalledTimes(0)
    await new Promise((r) => requestAnimationFrame(r))
    expect(draws).toHaveBeenCalledTimes(1)
    // the first draw of the table shows whoever is there
    expect(screen.root.querySelectorAll('table.roster tr.game').length).toBe(5)
  })

  it('holds arrivals back until Y, and lets departures go at once, so rows never move under the cursor', async () => {
    const s = loggedIn([playing('bob'), playing('dave')])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe(at('dave'))
    s.state.lobby.entries.set(99, { ...playing('alice'), id: 99 })
    s.state.lobby.entries.delete(playing('bob').id)
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(labels(screen)).toEqual(['Back', 'dave'])
    expect(screen.root.querySelector('.held')?.textContent).toBe('1 new · press Y to bring them in')
    expect(focused(screen)).toBe(at('dave'))
    pad(screen, 'Y')
    expect(labels(screen)).toEqual(['Back', 'alice', 'dave'])
    expect(screen.root.querySelector('.held')?.textContent).toBe('')
    expect(focused(screen)).toBe(at('dave'))
  })

  it('a player in a game of each version has a row for each', () => {
    const s = loggedIn([playing('bob'), { ...playing('bob'), id: 77, game_id: 'dcss-web-0.34', char: 'DsFi' }])
    const { screen, watch } = make(() => s)
    pick(screen, 'Watch')
    expect(labels(screen)).toEqual(['Back', 'bob', 'bob'])
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('watch:77')
    pad(screen, 'A')
    expect(watch).toHaveBeenCalledWith(s, 'bob')
  })

  it('the arrivals come in on the keyboard’s Y and on a press of the line that counts them, and the line goes when there are none', async () => {
    const s = loggedIn([playing('bob')])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    const held = screen.root.querySelector('.held') as HTMLButtonElement
    expect(held.hidden).toBe(true)
    s.state.lobby.entries.set(99, { ...playing('alice'), id: 99 })
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(held.hidden).toBe(false)
    expect(press(screen, 'y')).toBe(true)
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob'])
    expect(held.hidden).toBe(true)
    s.state.lobby.entries.set(98, { ...playing('carol'), id: 98 })
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob'])
    held.click()
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob', 'carol'])
  })

  it('right opens a row’s details and left closes them', () => {
    const s = loggedIn([playing('alice', { god: 'Trog' })])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    const tr = screen.root.querySelector('tr.game') as HTMLElement
    const dt = tr.nextElementSibling as HTMLElement
    expect(dt.classList.contains('details')).toBe(true)
    expect(dt.hidden).toBe(true)
    press(screen, 'ArrowRight')
    expect(tr.classList.contains('open')).toBe(true)
    expect(dt.hidden).toBe(false)
    expect(dt.querySelector('td.details')?.textContent).toContain('God Trog')
    press(screen, 'ArrowLeft')
    expect(tr.classList.contains('open')).toBe(false)
    expect(dt.hidden).toBe(true)
  })

  it('the shoulders walk Play, Watch and Settings, and Back comes home from each', () => {
    const s = loggedIn()
    const { screen } = make(() => s)
    pad(screen, 'RB')
    expect(screen.view).toBe('watch')
    pad(screen, 'RB')
    expect(screen.view).toBe('settings')
    pad(screen, 'RB')
    expect(screen.view).toBe('home')
    pad(screen, 'LB')
    expect(screen.view).toBe('settings')
    pad(screen, 'B')
    expect(screen.view).toBe('home')
    screen.open({ kind: 'menu', path: 'versions', serverId: 'cdi', username: 'orbrun' })
    pad(screen, 'RB')
    expect(screen.view).toBe('versions')
  })
})

describe('the front end: the rc file', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
  })

  /** A session on CDI whose server keeps rc files: `files` by the game that names each, as ws_handler.py does. */
  function withRc(files: Record<string, string>, keeps = true) {
    const s = fakeSession(cdi, 'orbrun', {
      username: 'orbrun',
      complete: true,
      games: [
        { id: 'dcss-web-trunk', label: 'DCSS trunk', rc: 'dcss-web-trunk' },
        { id: 'sprint-web-trunk', label: 'Sprint trunk', rc: 'dcss-web-trunk' },
        { id: 'dcss-web-0.34', label: 'DCSS 0.34', rc: 'dcss-web-0.34' },
        { id: 'sprint-web-0.34', label: 'Sprint 0.34', rc: 'dcss-web-0.34' },
        { id: 'tut-web-0.34', label: 'Tutorial 0.34', rc: 'dcss-web-0.34' },
      ],
    })
    const readRc = vi.fn(async (id: string) => files[id] ?? '')
    const writeRc = vi.fn((id: string, text: string) => {
      if (keeps) files[id] = text
    })
    Object.assign(s, { readRc, writeRc })
    return { s, readRc, writeRc }
  }

  const settle = () => new Promise((r) => setTimeout(r, 0))
  const box = (screen: FrontEnd) => screen.root.querySelector('textarea.rc-text') as HTMLTextAreaElement
  const note = (screen: FrontEnd) => screen.root.querySelector('.brand > .hint:not(.rc-scope), .brand > .error')?.textContent ?? null

  function type(t: HTMLTextAreaElement, text: string) {
    t.value += text
    t.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('edits from Play on the selected server, saves its version only, and returns to the same link', async () => {
    const files = { 'dcss-web-0.34': 'show_more = true\n', 'dcss-web-trunk': 'show_more = true\n' }
    const { s, readRc, writeRc } = withRc(files)
    const other = fakeSession(crg, 'orbrun', { username: 'orbrun', games: s.state.lobby.games })
    const otherRead = vi.fn()
    const otherWrite = vi.fn()
    Object.assign(other, { readRc: otherRead, writeRc: otherWrite })
    const { screen, play } = makePlay(server => server.id === cdi.id ? s : other)
    setOnlineAccount(orbrun)
    screen.showHome()
    const link = () => screen.root.querySelector<HTMLElement>('[data-focus="rc:dcss-web-0.34"]')!
    expect(link().closest('.command-line')?.textContent).toContain('Play DCSS 0.34')
    link().click()
    await settle()
    expect(readRc).toHaveBeenCalledWith('dcss-web-0.34', expect.any(Number))
    type(box(screen), 'autofight_stop = 60\n')
    pick(screen, 'Save')
    await settle()
    expect(writeRc).toHaveBeenCalledWith('dcss-web-0.34', 'show_more = true\nautofight_stop = 60\n')
    expect(files['dcss-web-trunk']).toBe('show_more = true\n')
    expect(otherRead).not.toHaveBeenCalled()
    expect(otherWrite).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
    pick(screen, 'Back')
    expect(screen.view).toBe('play')
    expect(focused(screen)).toBe('rc:dcss-web-0.34')
    // Reopening reads current server contents, including edits made in WebTiles.
    files['dcss-web-0.34'] = 'autofight_stop = 70\n'
    link().click()
    await settle()
    expect(box(screen).value).toBe(files['dcss-web-0.34'])
    type(box(screen), '# unsaved\n')
    pick(screen, 'Back')
    expect(screen.view).toBe('rc')
    pick(screen, 'Back, without saving?')
    expect(screen.view).toBe('play')
    expect(focused(screen)).toBe('rc:dcss-web-0.34')
  })

  it('offers editing in Play only after login and only for files the server advertises', () => {
    const { s, readRc } = withRc({})
    s.state.lobby.username = null
    setToken(cdi.id, 'orbrun', 'pending-login')
    const { screen } = makePlay(() => s)
    setOnlineAccount(orbrun)
    screen.showHome()
    expect(screen.root.querySelector('[data-focus^="rc:"]')).toBeNull()
    s.state.lobby.username = 'orbrun'
    screen.refresh()
    expect(screen.root.querySelector('[data-focus="rc:dcss-web-0.34"]')).not.toBeNull()
    s.state.lobby.games = s.state.lobby.games.map(({ rc: _rc, ...game }) => game)
    screen.refresh()
    expect(screen.root.querySelector('[data-focus^="rc:"]')).toBeNull()
    expect(readRc).not.toHaveBeenCalled()
  })

  it('stands beside each release in Versions & modes, and opens the file the lobby names, with who else reads it', async () => {
    const { s, readRc } = withRc({ 'dcss-web-0.34': 'autopickup = $?!+"/%\n' })
    const { screen, at } = makePlay(() => s)
    pick(screen, 'More versions & modes')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('rc:dcss-web-trunk')
    ;(screen.root.querySelector('[data-focus="rc:dcss-web-0.34"]') as HTMLElement).click()
    expect(screen.view).toBe('rc')
    expect(readRc).toHaveBeenCalledWith('dcss-web-0.34', expect.any(Number))
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'rc', serverId: 'cdi', username: 'orbrun', gameId: 'dcss-web-0.34' })
    expect(screen.root.querySelector('.lede')?.textContent).toBe('orbrun on CDI · DCSS 0.34 · Sprint 0.34 and Tutorial 0.34 read it too')
    expect(sub(screen, 'Save')).toBe('reading…')
    await settle()
    expect(box(screen).value).toBe('autopickup = $?!+"/%\n')
    expect(box(screen).readOnly).toBe(false)
    expect(sub(screen, 'Save')).toBe('no changes')
    expect(focused(screen)).toBe('rc:text')
    // the guide for the release's own options
    expect((screen.root.querySelector('[data-focus="rc:guide"]') as HTMLAnchorElement).href).toBe('https://github.com/crawl/crawl/blob/stone_soup-0.34/crawl-ref/docs/options_guide.txt')
  })

  it('goes into the box on Enter and out on Esc, saves on Ctrl+S, and only calls it saved once it reads back', async () => {
    const files = { 'dcss-web-0.34': 'autopickup = $?!+"/%\n' }
    const { s, writeRc, readRc } = withRc(files)
    const { screen } = make(() => s)
    screen.open({ kind: 'menu', path: 'rc', serverId: 'cdi', username: 'orbrun', gameId: 'dcss-web-0.34' })
    await settle()
    const t = box(screen)
    // on the box, the arrows are the cursor's
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('rc:save')
    press(screen, 'ArrowUp')
    expect(focused(screen)).toBe('rc:text')
    press(screen, 'Enter')
    expect(document.activeElement).toBe(t)
    // in it, every key is the text's
    expect(press(screen, 'ArrowDown', t)).toBe(false)
    expect(press(screen, 'j', t)).toBe(false)
    expect(press(screen, 'Enter', t)).toBe(false)
    type(t, 'autopickup_exceptions += <useless_item\n')
    expect(sub(screen, 'Save')).toBe('unsaved changes')
    const ev = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'target', { value: t })
    expect(screen.key(ev)).toBe(true)
    expect(ev.defaultPrevented).toBe(true)
    expect(writeRc).toHaveBeenCalledWith('dcss-web-0.34', 'autopickup = $?!+"/%\nautopickup_exceptions += <useless_item\n')
    expect(sub(screen, 'Save')).toBe('saving…')
    await settle()
    // read back, the same
    expect(readRc).toHaveBeenCalledTimes(2)
    expect(sub(screen, 'Save')).toBe('no changes')
    expect(note(screen)).toBe('Saved on crawl.dcss.io. It counts from the next game you start or continue.')
    // the caret stayed in the box across the redraw
    expect(document.activeElement).toBe(box(screen))
    expect(press(screen, 'Escape', t)).toBe(true)
    expect(document.activeElement).not.toBe(t)
    expect(focused(screen)).toBe('rc:text')
    expect(screen.view).toBe('rc')
  })

  it('says so when the server does not keep a save, and keeps the text', async () => {
    const { s } = withRc({ 'dcss-web-0.34': '' }, false)
    const { screen } = make(() => s)
    screen.open({ kind: 'menu', path: 'rc', serverId: 'cdi', username: 'orbrun', gameId: 'dcss-web-0.34' })
    await settle()
    type(box(screen), 'show_more = false\n')
    pick(screen, 'Save')
    await settle()
    expect(note(screen)).toBe('crawl.dcss.io did not keep it. Your text is still here: try Save again.')
    expect(box(screen).value).toBe('show_more = false\n')
    expect(sub(screen, 'Save')).toBe('unsaved changes')
  })

  it('asks for a second Back before it drops changes, and comes back to the rc link it was opened from', async () => {
    const { s } = withRc({ 'dcss-web-0.34': 'a = b\n' })
    const { screen } = makePlay(() => s)
    pick(screen, 'More versions & modes')
    ;(screen.root.querySelector('[data-focus="rc:dcss-web-0.34"]') as HTMLElement).click()
    await settle()
    type(box(screen), 'c = d\n')
    pad(screen, 'B')
    expect(screen.view).toBe('rc')
    expect(labels(screen)[0]).toBe('Back, without saving?')
    pad(screen, 'B')
    expect(screen.view).toBe('versions')
    expect(focused(screen)).toBe('rc:dcss-web-0.34')
    // nothing changed: one Back
    ;(screen.root.querySelector('[data-focus="rc:dcss-web-0.34"]') as HTMLElement).click()
    await settle()
    expect(box(screen).value).toBe('a = b\n')
    pad(screen, 'B')
    expect(screen.view).toBe('versions')
  })

  it('types from a pad with the on-screen keyboard, a new line and all, and Y comes back out', async () => {
    const { s } = withRc({ 'dcss-web-0.34': '' })
    const { screen } = make(() => s, true)
    screen.open({ kind: 'menu', path: 'rc', serverId: 'cdi', username: 'orbrun', gameId: 'dcss-web-0.34' })
    await settle()
    pad(screen, 'A')
    expect(screen.root.querySelector('.osk')).not.toBeNull()
    expect(screen.root.querySelector('.osk .extra')?.textContent).toContain('New line')
    // the extras row is the first: its New line is where the keyboard starts
    pad(screen, 'A')
    expect(box(screen).value).toBe('\n')
    pad(screen, 'Y')
    expect(screen.root.querySelector('.osk')).toBeNull()
    expect(focused(screen)).toBe('rc:text')
    expect(sub(screen, 'Save')).toBe('unsaved changes')
  })

  it('puts the file back as the server has it on (revert)', async () => {
    const { s } = withRc({ 'dcss-web-0.34': 'a = b\n' })
    const { screen } = make(() => s)
    screen.open({ kind: 'menu', path: 'rc', serverId: 'cdi', username: 'orbrun', gameId: 'dcss-web-0.34' })
    await settle()
    type(box(screen), 'oops')
    pick(screen, '(revert)')
    await settle()
    expect(box(screen).value).toBe('a = b\n')
    expect(sub(screen, 'Save')).toBe('no changes')
  })

  it('says it could not read the file, and offers to try again', async () => {
    const { s, readRc } = withRc({})
    readRc.mockResolvedValueOnce(null as unknown as string)
    const { screen } = make(() => s)
    screen.open({ kind: 'menu', path: 'rc', serverId: 'cdi', username: 'orbrun', gameId: 'dcss-web-0.34' })
    await settle()
    expect(note(screen)).toBe('No answer from crawl.dcss.io: your rc file could not be read.')
    expect(box(screen).readOnly).toBe(true)
    expect(sub(screen, 'Save')).toBe('not read')
    pick(screen, '(try again)')
    await settle()
    expect(box(screen).readOnly).toBe(false)
    expect(note(screen)).toBeNull()
  })

  it('edits the same local rc beside Stable and Trunk, retaining the migrated profile', async () => {
    vi.spyOn(servers, 'offlineRuns').mockReturnValue(true)
    vi.spyOn(engines, 'refresh').mockResolvedValue()
    const ada = { serverId: 'offline', username: 'Ada' }
    localStorage.setItem('orbrun.accounts', JSON.stringify([ada]))
    localStorage.setItem('orbrun.offline.rc:ada', '# Existing settings\n')
    const offline = fakeSession(OFFLINE_SERVER, 'Ada', { username: 'Ada', complete: true, games: [
      { id: 'offline-0.34', label: 'DCSS 0.34' }, { id: 'offline-trunk', label: 'DCSS trunk' },
    ] })
    const { screen, at } = make(server => server.offline ? offline : null)
    pick(screen, 'Play Offline')
    expect(focused(screen)).toBe('play:offline-0.34')
    const edit = (gameId: string) => screen.root.querySelector<HTMLButtonElement>(`[data-focus="rc:${gameId}"]`)!.click()
    edit('offline-0.34')
    await settle()
    expect(box(screen).value).toBe('# Existing settings\n')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'rc', serverId: 'offline' })
    expect(screen.root.querySelector('.lede')?.textContent).toContain('Stable and Trunk')
    type(box(screen), 'show_more = false')
    pick(screen, 'Save')
    pad(screen, 'B')
    expect(focused(screen)).toBe('rc:offline-0.34')
    edit('offline-trunk')
    await settle()
    expect(box(screen).value).toBe('# Existing settings\nshow_more = false')
  })

  it('opens from its address only for an account on this device', () => {
    const { s } = withRc({})
    const { screen } = make(() => s)
    screen.open({ kind: 'menu', path: 'rc', serverId: 'cdi', username: 'stranger', gameId: 'dcss-web-0.34' })
    expect(screen.view).toBe('home')
  })
})

describe('the front end: an account and its morgues', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
  })

  /** A morgue as crawl writes one: its head (hiscores.cc `hiscore_line`, verbose), the overview's title, and its notes. */
  const written = (version: string, lines: string[]) =>
    [` Dungeon Crawl Stone Soup version ${version} (webtiles) character file.`, '', 'Game seed: 27', '', ...lines.map((l, i) => (i ? '             ' + l : l)), '', 'orbrun the Covert (Vine Stalker Enchanter)          Turns: 2296, Time: 00:20:19', '',
      'Notes', 'Turn   | Place    | Note', '-------+----------+-------------------------------------------', '     0 | D:1      | orbrun began the quest for the Orb.', ''].join('\n')
  /** the test account's games on CDI, by file */
  const MORGUES: Record<string, string> = {
    'morgue-orbrun-20260914-190808.txt': written('0.34.1-4-g0e95e087e2', ['0 orbrun the Cudgeller (level 1, 20/20 HPs)', 'Began as a Gnoll Reaver on Sept 10, 2026.', 'Quit the game on level 1 of the Dungeon on Sept 14, 2026.', 'The game lasted 00:00:34 (30 turns).']),
    'morgue-orbrun-20260915-155745.txt': written('0.35-a0-1027-gfe65402f27', ['545 orbrun the Covert (level 7, 0/33 HPs)', 'Began as a Vine Stalker Enchanter on Sept 15, 2026.', 'Slain by a gnoll', '... wielding a +0 halberd of entangling', ' (1 damage)', '... on level 4 of the Dungeon.', 'The game lasted 00:20:18 (2296 turns).']),
    'morgue-orbrun-20260916-000707.txt': written('0.35-a0-1027-gfe65402f27', ['53 orbrun the Sneak (level 3, -4/16 HPs)', 'Began as a Vine Stalker Enchanter on Sept 15, 2026.', 'Slain by Natasha (6 damage)', '... on level 2 of the Dungeon on Sept 16, 2026.', 'The game lasted 00:07:16 (1202 turns).']),
    'morgue-orbrun-20260916-191307.txt': written('0.35-a0-1032-g9c70569048', ['1705 orbrun the Protected (level 8, 0/71 HPs)', 'Began as a Minotaur Fighter on Sept 16, 2026.', "Succumbed to a scorpion's poison", '... on level 6 of the Dungeon.', 'The game lasted 00:17:19 (5191 turns).']),
  }
  const morgue = (f: string) => MORGUES[f]
  const FILES = ['morgue-orbrun-20260914-190808.txt', 'morgue-orbrun-20260915-155745.txt', 'morgue-orbrun-20260916-191307.txt']

  /** CDI as the proxy has it: the account's morgue directory, listed, and its files, a head at a time */
  function cdiMorgues(files = FILES) {
    const fetched = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/morgue-proxy/crawl.dcss.io/crawl/morgue/orbrun/') return new Response(files.join('\n'))
      const f = files.find((x) => url === '/morgue-proxy/crawl.dcss.io/crawl/morgue/orbrun/' + x)
      if (!f) return new Response('', { status: 404 })
      const range = new Headers(init?.headers).get('Range')
      return new Response(range ? morgue(f).slice(0, 2048) : morgue(f), { status: range ? 206 : 200 })
    })
    vi.stubGlobal('fetch', fetched)
    return fetched
  }

  const scores = (screen: FrontEnd) => Array.from(screen.root.querySelectorAll('table.morgues tr.game td.col-user')).map((el) => el.textContent)
  const endings = (screen: FrontEnd) => Array.from(screen.root.querySelectorAll('table.morgues tr.ending')).map((el) => el.textContent)

  it('lists every game the account has finished on its server, newest first, in the lobby’s columns', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const fetched = cdiMorgues()
    const { screen, at } = make()
    screen.showMorgues(orbrun)
    expect(screen.view).toBe('morgues')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'morgues', serverId: 'cdi', username: 'orbrun' })
    expect(screen.root.querySelector('.head .place')?.textContent).toBe('Morgues · CDI')
    await vi.waitFor(() => expect(scores(screen)).toEqual(['1705', '545', '0']))
    expect(screen.root.querySelector('.head .lede')?.textContent).toBe('orbrun · 3 games')
    const first = Array.from(screen.root.querySelectorAll('table.morgues tr.game')[0].querySelectorAll('td')).map((td) => td.textContent)
    expect(first).toEqual(['1705', 'MiFi', '8', 'D:6', 'Succumbed to a scorpion\'s poison', '5191', 'trunk', expect.stringMatching(/^Sep 16/)])
    expect(endings(screen)).toEqual(["Succumbed to a scorpion's poison", 'Slain by a gnoll', 'Quit the game'])
    // each head is read with a Range, and no more than once
    expect(fetched.mock.calls.filter(([u]) => u.endsWith('.txt')).every(([, init]) => new Headers(init?.headers).get('Range') === 'bytes=0-2047')).toBe(true)
    // the cursor stands on the newest game once there are games, and says it
    await vi.waitFor(() => expect(focused(screen)).toBe('morgue:20260916-191307'))
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('1705 points: the Protected, Minotaur Fighter, XL8. Succumbed to a scorpion\'s poison on D:6, Sep 16, turn 5191.')
  })

  it('puts the best first beside Back, the account’s high scores, and back again', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    cdiMorgues(['morgue-orbrun-20260914-190808.txt', 'morgue-orbrun-20260915-155745.txt', 'morgue-orbrun-20260916-000707.txt'])
    const { screen } = make()
    screen.showMorgues(orbrun)
    await vi.waitFor(() => expect(scores(screen)).toEqual(['53', '545', '0']))
    // the button names the order on show; pressed, it is the other
    pick(screen, '(newest first)')
    expect(scores(screen)).toEqual(['545', '53', '0'])
    expect(labels(screen)).toContain('(best first)')
    expect(focused(screen)).toBe('morgues:sort')
    pick(screen, '(best first)')
    expect(scores(screen)).toEqual(['53', '545', '0'])
    expect(labels(screen)).toContain('(newest first)')
  })

  it('reads a morgue here, with its own address, and Back finds the list as it was', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    cdiMorgues()
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun' })
    const { screen, at } = makePlay(() => s)
    pick(screen, 'Morgues')
    await vi.waitFor(() => expect(scores(screen)).toEqual(['1705', '545', '0']))
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('morgue:20260915-155745')
    pad(screen, 'A')
    expect(screen.view).toBe('doc')
    expect(at).toHaveBeenLastCalledWith({ kind: 'menu', path: 'morgues', serverId: 'cdi', username: 'orbrun', morgue: '20260915-155745' })
    expect(screen.root.querySelector('.head .lede')?.textContent).toBe('545 · VSEn · Slain by a gnoll on D:4')
    await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .morgue .notes')).not.toBeNull())
    // Copy, top right beside Back, takes the file as crawl wrote it
    const writeText = vi.fn(async () => {})
    const clipboard = vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard)
    expect(focused(screen)).toBe('doc:copy')
    pad(screen, 'A')
    await vi.waitFor(() => expect(labels(screen)).toContain('(copied)'))
    expect(writeText).toHaveBeenCalledWith(morgue('morgue-orbrun-20260915-155745.txt'))
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('Copied: paste it anywhere.')
    clipboard.mockRestore()
    pad(screen, 'B')
    expect(screen.view).toBe('morgues')
    expect(focused(screen)).toBe('morgue:20260915-155745')
    pad(screen, 'B')
    expect(screen.view).toBe('play')
    expect(focused(screen)).toBe('morgues')
  })

  it('opens a morgue from its address, the line under the title from the file itself', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    cdiMorgues()
    const { screen } = make()
    screen.open({ kind: 'menu', path: 'morgues', serverId: 'cdi', username: 'orbrun', morgue: '20260916-191307' })
    expect(screen.view).toBe('doc')
    await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .morgue')).not.toBeNull())
    expect(screen.root.querySelector('.head .lede')?.textContent).toBe("1705 · MiFi · Succumbed to a scorpion's poison on D:6")

  })

  it('says so when a server lists no morgues where Polished Crawl can read them', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([roguelikes]))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const { screen } = make()
    screen.showMorgues(roguelikes)
    await vi.waitFor(() => expect(screen.root.querySelector('.hint.empty')?.textContent).toBe('CRG does not list orbrun’s morgues where Polished Crawl can read them.'.replace('’', "'")))
    expect(scores(screen)).toEqual([])
  })

  it('reads an offline account’s morgues from this device, and the one a game just left from the report of its end', async () => {
    vi.stubEnv('MODE', 'development')
    vi.spyOn(servers, 'offlineRuns').mockReturnValue(true)
    // the morgue this device's engine wrote as Ada quit
    const quit = written('0.34.1-4-g0e95e087e2', ['0 Ada the Shield-Bearer (level 1, 19/19 HPs)', 'Began as a Minotaur Fighter on Oct 25, 2026.', 'Quit the game on level 1 of the Dungeon.', 'The game lasted 00:00:00 (0 turns).'])
    const files: Record<string, Int8Array> = {
      '/crawl-0.34~ada/morgue/morgue-Ada-20261025-161159.txt': new Int8Array(new TextEncoder().encode(quit)),
    }
    const req = <T,>(result: T) => {
      const r = { result } as { result: T; onsuccess?: () => void }
      queueMicrotask(() => r.onsuccess?.())
      return r
    }
    vi.stubGlobal('indexedDB', {
      databases: async () => [{ name: '/crawl-0.34~ada' }],
      open: () => req({ objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => ({ getAllKeys: () => req(Object.keys(files)), get: (k: string) => req(files[k] ? { contents: files[k] } : undefined) }) }), close() {} }),
    })
    try {
      const ada: Account = { serverId: 'offline', username: 'Ada' }
      localStorage.setItem('orbrun.accounts', JSON.stringify([ada]))
      servers.enterOffline()
      const s = fakeSession(OFFLINE_SERVER, 'Ada', { username: 'Ada', complete: true, games: [{ id: 'offline-0.34', label: 'DCSS 0.34' }] })
      s.state.exit = { reason: 'quit', message: '       0 Ada the Shield-Bearer (level 1, 19/19 HPs)\n             Quit the game on level 1 of the Dungeon.\n', dump: '/crawl-0.34~ada/morgue/morgue-Ada-20261025-161159' }
      const { screen } = make(() => s)
      expect(screen.view).toBe('exit')
      pick(screen, 'Morgue file')
      expect(screen.root.querySelector('.head .lede')?.textContent).toBe('Kept on this device.')
      await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .morgue')?.textContent).toContain('Ada the Shield-Bearer'))
      expect(screen.root.querySelector('.about-links')).toBeNull()
      screen.showMorgues(ada)
      expect(screen.root.querySelector('.head .place')?.textContent).toBe('Morgues · Ada')
      await vi.waitFor(() => expect(scores(screen)).toEqual(['0']))
      expect(endings(screen)).toEqual(['Quit the game'])
    } finally {
      vi.unstubAllEnvs()
    }
  })

})

describe('the front end: settings and marks', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
  })

  it('uses the shared front-end controls without changing the in-game settings panel', () => {
    const { screen } = make()
    pick(screen, 'Settings')
    pick(screen, 'View')
    expect(screen.root.querySelector('.menu-actions [data-focus="back"]')).not.toBeNull()
    const row = screen.root.querySelector<HTMLElement>('[data-focus="setting:Dungeon movement"]')!
    expect(row.classList.contains('item')).toBe(true)
    expect(row.querySelector('.marker')?.getAttribute('aria-hidden')).toBe('true')
    row.querySelector<HTMLElement>('.arrow:last-child')!.click()
    expect(focused(screen)).toBe('setting:Dungeon movement')
    expect(row.querySelector('.val')?.textContent).toBe('Instant')
    // The same setting changes once, not once for the arrow and again for the row.
    expect(JSON.parse(localStorage.getItem('orbrun.settings')!).depthMovement).toBe(false)
    const inGame = settingsPanel('View')
    expect(inGame.el.querySelector('.front-setting, .item, .marker')).toBeNull()
    expect(inGame.el.querySelector('.hotkey')).not.toBeNull()
  })

  it('turns a setting on h and l, and the value reads at once', () => {
    const { screen } = make()
    pick(screen, 'Settings')
    expect(screen.view).toBe('settings')
    // a row per group, each its own page; the Gamepad controls sheet is on the Controls page
    expect(labels(screen)).toEqual(['Back', 'View', 'Combat', 'Audio', 'Controls', 'Interface'])
    expect(focused(screen)).toBe('settings:View')
    pick(screen, 'View')
    expect(screen.view).toBe('settings-group')
    const value = (label: string) => (Array.from(screen.root.querySelectorAll('li.row')).find((r) => r.querySelector('.label')?.textContent === label)?.querySelector('.val') as HTMLElement).textContent
    while (focused(screen) !== 'setting:2.5D perspective') press(screen, 'j')
    expect(value('2.5D perspective')).toBe('On')
    expect(value('Dungeon tilt')).toBe('35°')
    while (focused(screen) !== 'setting:Dungeon tilt') press(screen, 'j')
    press(screen, 'l')
    expect(value('Dungeon tilt')).toBe('40°')
    press(screen, 'h')
    expect(value('Dungeon tilt')).toBe('35°')
    // back at the default, so it is not written down at all: a default we move later moves for this player too
    expect('depthTilt' in JSON.parse(localStorage.getItem('orbrun.settings')!)).toBe(false)
    const tilt = screen.root.querySelector<HTMLElement>('[data-focus="setting:Dungeon tilt"]')
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe(tilt?.dataset.hint)
    // the page's Back is the settings again, on the group it was opened from
    pad(screen, 'B')
    expect(screen.view).toBe('settings')
    expect(focused(screen)).toBe('settings:View')
    pick(screen, 'Controls')
    pick(screen, 'Gamepad controls')
    expect(screen.view).toBe('controls')
    // the pad in two halves, left and right
    expect(screen.root.querySelectorAll('.bindings-sheet .sides table')).toHaveLength(2)
    pad(screen, 'B')
    expect(screen.view).toBe('settings-group')
    expect(focused(screen)).toBe('gamepad-controls')
  })

  it('leaves the letters to a text field, and reads the four vim keys as directions and nothing else', () => {
    const { screen } = make()
    screen.open({ kind: 'menu', path: 'watch' })
    pick(screen, 'Add a server')
    const input = screen.root.querySelector('input') as HTMLInputElement
    expect(press(screen, 'j', input)).toBe(false)
    expect(press(screen, 'ArrowDown', input)).toBe(true)
    expect(press(screen, 'ArrowLeft', input)).toBe(false)
    expect(navDir({ key: 'k', ctrlKey: false, altKey: false, metaKey: false }, false)).toBe('up')
    expect(navDir({ key: 'x', ctrlKey: false, altKey: false, metaKey: false }, false)).toBe(null)
    expect(navDir({ key: 'k', ctrlKey: true, altKey: false, metaKey: false }, false)).toBe(null)
  })

  it('lands on Settings again when the settings are left, and opens them again on the row they were left on', () => {
    const { screen } = make()
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('settings')
    pad(screen, 'A')
    expect(screen.view).toBe('settings')
    for (let i = 0; i < 8 && focused(screen) !== 'settings:Interface'; i++) press(screen, 'ArrowDown')
    const row = focused(screen)
    expect(row).toBe('settings:Interface')
    pad(screen, 'B')
    expect(screen.view).toBe('home')
    expect(focused(screen)).toBe('settings')
    pad(screen, 'A')
    expect(focused(screen)).toBe(row)
  })

  it('comes back to the Watch row it left when the settings are opened from the roster', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([orbrun]))
    localStorage.setItem('orbrun.account', JSON.stringify(orbrun))
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun', complete: true, entries: new Map([[1, playing('alice')], [2, playing('bob')]]) })
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe(at('bob'))
    screen.showSettings()
    expect(screen.view).toBe('settings')
    pad(screen, 'B')
    expect(screen.view).toBe('watch')
    expect(focused(screen)).toBe(at('bob'))
  })
})

describe('Polished Crawl home ownership', () => {
  beforeEach(() => { store.clear(); document.body.replaceChildren() })

  it('preserves typed credentials and native focus through lobby refresh and both document modals', () => {
    const s = fakeSession(cdi, null, { complete: false })
    const { screen } = makePlay(() => s)
    const user = screen.root.querySelector<HTMLInputElement>('[name=username]')!
    const pass = screen.root.querySelector<HTMLInputElement>('[name=password]')!
    user.value = 'typed-name'; pass.value = 'typed-password'; pass.focus()
    s.state.lobby.complete = true
    screen.refresh()
    expect(document.activeElement).toBe(pass)
    expect(screen.root.querySelector('[name=username]')).toBe(user)
    for (const path of ['about', 'whats-new']) {
      screen.open({ kind: 'menu', path })
      const dialog = screen.root.querySelector('dialog')!
      expect(dialog.open).toBe(true)
      expect(screen.root.querySelector<HTMLElement>('.polished-home')!.inert).toBe(true)
      screen.refresh()
      expect(screen.root.querySelector('dialog')).toBe(dialog)
      expect(dialog.contains(document.activeElement)).toBe(true)
      press(screen, 'Escape')
      expect(document.activeElement).toBe(pass)
      expect(pass.value).toBe('typed-password')
      expect(user.value).toBe('typed-name')
    }
  })

  it('submits compact authentication once and settles a success without resubscribing forever', () => {
    const s = fakeSession(cdi, null, { complete: true })
    const listeners = new Set<(event: unknown) => void>()
    s.on = ((fn: (event: unknown) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }) as Session['on']
    const { screen } = makePlay(() => s)
    const user = screen.root.querySelector<HTMLInputElement>('[name=username]')!
    const password = screen.root.querySelector<HTMLInputElement>('[name=password]')!
    user.value = 'Alice '; password.value = 'secret'
    for (const key of ['j', 'k', 'PageDown', 'ArrowDown']) expect(press(screen, key, user)).toBe(false)
    screen.root.querySelector<HTMLFormElement>('.inline-login')!.requestSubmit()
    expect(s.send).toHaveBeenCalledWith({ msg: 'login', username: 'Alice', password: 'secret' })
    expect(password.value).toBe('')
    s.state.lobby.username = 'Alice'
    let calls = 0
    for (const fn of listeners) {
      if (++calls > 3) throw new Error('Login subscription loop')
      fn({ type: 'state', msg: { msg: 'login_success' } })
    }
    expect(listeners.size).toBe(1)
    expect(JSON.parse(store.get('orbrun.account')!)).toMatchObject({ serverId: 'cdi', username: 'Alice' })
  })

  it('filters Descent from the Play shortcuts while preserving offered DCSS identity and stable focused row nodes', () => {
    setOnlineAccount(orbrun)
    const s = fakeSession(cdi, 'orbrun', { username: 'orbrun', complete: true, games: [
      { id: 'dcss-0.34', label: 'DCSS 0.34', rc: 'stable-rc' },
      { id: 'descent-web-trunk', label: 'Descent', save: 'orbrun, a level 4 Fighter' },
      { id: 'dcss-web-trunk', label: 'DCSS trunk', rc: 'trunk-rc' },
    ] })
    const { screen } = makePlay(() => s)
    s.readRc = vi.fn().mockResolvedValue('# rc')
    const button = screen.root.querySelector<HTMLButtonElement>('[data-focus="play:dcss-web-trunk"]')!
    button.focus()
    s.state.lobby.games[2].save = 'orbrun, a level 3 Fighter'
    screen.refresh()
    expect(button).toBe(document.activeElement)
    expect(screen.root.querySelector('[data-focus="play:dcss-web-trunk"]')).toBe(button)
    expect(button.textContent).toContain('Continue DCSS trunk')
    expect(screen.root.textContent).not.toContain('Descent')
    screen.root.querySelector<HTMLButtonElement>('[data-focus="rc:dcss-web-trunk"]')!.click()
    expect(s.readRc).toHaveBeenCalledWith('trunk-rc', expect.anything())
    s.state.lobby.entries.set(1, playing('another'))
    screen.refresh()
    expect(screen.view).toBe('rc')
  })

  it('switches servers without accepting stale login success or reusing credentials', () => {
    const sessions = new Map([['cdi', fakeSession(cdi, null)], ['crg', fakeSession(crg, null)]])
    const { screen } = makePlay(server => sessions.get(server.id) ?? null)
    const select = screen.root.querySelector<HTMLSelectElement>('[aria-label=Server]')!
    const pass = screen.root.querySelector<HTMLInputElement>('[name=password]')!
    pass.value = 'old-server-secret'
    select.value = 'crg'; select.dispatchEvent(new Event('change'))
    expect(pass.value).toBe('')
    const old = sessions.get('cdi')!
    old.state.lobby.username = 'stale'
    ;(old as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'login_success' } })
    expect(select.value).toBe('crg')
    expect(getChosenAccount()).toBeNull()
  })
})
