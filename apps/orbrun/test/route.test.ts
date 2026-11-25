// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addServer, formatRoute, openPage, parseRoute, setOnlineAccount, setRoute, type Account, type Route } from '../src/servers'

const base = 'http://localhost:5173/'

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

/**
 * The path says what and where, the fragment who: `/play/cdi/dcss-0.34#orbrun`,
 * `/watch/cdi#bob`, so a link opens the same thing on another device while
 * the page view the site counts names nobody; the front end's screens have
 * addresses of their own, and the root is the home screen.
 */
describe('routes', () => {
  const orbrun: Account = { serverId: 'cdi', username: 'orbrun' }
  const someone: Account = { serverId: 'crg', username: 'someone' }
  beforeEach(() => {
    store.clear()

  })

  it('the root is home, whatever the query says', () => {
    expect(parseRoute(base)).toEqual({ kind: 'home' })
    expect(parseRoute(base + '?server=crawl.dcss.io')).toEqual({ kind: 'home' })
  })

  it('watches on a server with no account at all, so a link to a game opens anywhere', () => {
    expect(parseRoute(base + 'watch/cdi')).toEqual({ kind: 'lobby', serverId: 'cdi', account: null })
    expect(parseRoute(base + 'watch/cdi#bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    expect(parseRoute(base + 'watch/cdi#')).toEqual({ kind: 'lobby', serverId: 'cdi', account: null })
    // the address from before, with the name in the path, still opens the spectate
    expect(parseRoute(base + 'watch/cdi/bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    // by host as well as by id, in any case
    expect(parseRoute(base + 'watch/crawl.dcss.io#bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    expect(parseRoute(base + 'Watch/CDI#bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    // as the chosen account, when it is on that server
    setOnlineAccount(orbrun)
    expect(parseRoute(base + 'watch/cdi#bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: orbrun, username: 'bob' })
    expect(parseRoute(base + 'watch/crg')).toEqual({ kind: 'lobby', serverId: 'crg', account: null })
  })

  it('uses the remembered account and asks for credentials for other online play links', () => {
    setOnlineAccount(orbrun)
    const play = { kind: 'play', account: orbrun, gameId: 'dcss-0.34' }
    for (const path of ['play/cdi/dcss-0.34', 'play/cdi/dcss-0.34#ORBRUN', 'play/cdi/orbrun/dcss-0.34']) {
      expect(parseRoute(base + path)).toEqual(play)
    }
    expect(parseRoute(base + 'play/cdi/dcss-0.34#stranger')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi', username: 'stranger' })
    expect(parseRoute(base + 'play/crg/dcss-0.34')).toEqual({ kind: 'menu', path: 'login', serverId: 'crg' })
  })

  it('uses direct play utility routes and preserves legacy links to those screens', () => {
    setOnlineAccount(orbrun)
    const paths = [
      ['versions/cdi', { path: 'versions' }],
      ['rc/cdi/dcss-0.34', { path: 'rc', gameId: 'dcss-0.34' }],
      ['morgues/cdi/20260916-191307', { path: 'morgues', morgue: '20260916-191307' }],
    ] as const
    for (const [url, screen] of paths) {
      const route = { kind: 'menu', ...screen, serverId: 'cdi', username: 'orbrun' } as const
      expect(formatRoute(route)).toBe('/' + url + '#orbrun')
      expect(parseRoute(base + url)).toEqual(route)
      expect(parseRoute(base + 'accounts/' + url + '#ORBRUN')).toEqual(route)
    }
    expect(parseRoute(base + 'rc/cdi/dcss-0.34#stranger')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi', username: 'stranger' })
    for (const path of ['accounts', 'accounts/add', 'accounts/cdi', 'accounts/offline', 'rc/cdi', 'morgues/cdi/not-a-morgue']) {
      expect(parseRoute(base + path), path).toEqual({ kind: 'home' })
    }
  })

  it.each(['play', 'settings', 'settings/view', 'settings/controls/gamepad', 'watch', 'watch/add', 'whats-new'])('round trips %s', path => {
    const route = { kind: 'menu', path } as const
    expect(parseRoute(base + path)).toEqual(route)
    expect(formatRoute(route)).toBe('/' + path)
  })

  it('ignores paths it does not know', () => {
    for (const path of ['nowhere', 'play/cdi', 'play/cdi#orbrun', 'play/cdi/orbrun/dcss-0.34/more', 'watch/nowhere.example', 'watch/cdi/bob/more', 'lobby/cdi', 'login/cdi/orbrun/more'])
      expect(parseRoute(base + path)).toEqual({ kind: 'home' })
  })

  it('opens the single local profile with or without its legacy name in the URL', () => {
    const account: Account = { serverId: 'offline', username: 'Ada' }
    store.set('orbrun.accounts', JSON.stringify([account]))
    const play: Route = { kind: 'play', account, gameId: 'offline-0.34' }
    const offline: Route = { kind: 'menu', path: 'offline' }
    expect(formatRoute(play)).toBe('/play/offline/dcss-0.34')
    expect(parseRoute(base + 'play/offline/dcss-0.34')).toEqual(play)
    expect(parseRoute(base + 'play/offline/ada/0.34')).toEqual(play)
    expect(parseRoute(base + 'play/offline/dcss-0.34#Ada')).toEqual(play)
    expect(parseRoute(base + 'play/offline/dcss-git#someone')).toEqual(offline)
    expect(parseRoute(base + 'offline')).toEqual(offline)
    expect(parseRoute(base + 'watch/offline')).toEqual({ kind: 'home' })
    expect(parseRoute(base + 'accounts/rc/offline#Ada')).toEqual({ kind: 'menu', path: 'rc', serverId: 'offline' })
    expect(parseRoute(base + 'morgues/offline/20261025-160942')).toEqual({ kind: 'menu', path: 'morgues', serverId: 'offline', morgue: '20261025-160942' })
  })

  it('round-trips names that contain URL punctuation and whitespace', () => {
    const username = 'a b/c?d#e%+'
    const account = { serverId: addServer('http://crawl.example.org:8080').id, username }
    setOnlineAccount(account)
    const routes: Route[] = [
      { kind: 'play', account, gameId: 'game/0.34' },
      { kind: 'watch', serverId: account.serverId, account, username },
      { kind: 'menu', path: 'login', serverId: account.serverId, username },
    ]
    for (const r of routes) expect(parseRoute(new URL(formatRoute(r), base).href)).toEqual(r)
  })

  /** the page view the site counts (analytics.ts) is the path alone: nobody is named in it */
  it('keeps every name out of the path', () => {
    const routes: Route[] = [
      { kind: 'play', account: orbrun, gameId: 'dcss-0.34' },
      { kind: 'watch', serverId: 'cdi', account: orbrun, username: 'someone' },
      { kind: 'menu', path: 'login', serverId: 'crg', username: 'someone' },
      { kind: 'menu', path: 'versions', serverId: 'cdi', username: 'orbrun' },
      { kind: 'menu', path: 'morgues', serverId: 'cdi', username: 'orbrun', morgue: '20260916-191307' },
    ]
    for (const r of routes) {
      const { pathname, search } = new URL(formatRoute(r), base)
      expect(pathname + search).not.toMatch(/orbrun|someone/)
    }
  })

  it('carries the query through, so the flags set at launch survive a Play', () => {
    setOnlineAccount(orbrun)
    history.replaceState(null, '', '/?fullscreen&perf')
    try {
      expect(formatRoute({ kind: 'home' })).toBe('/?fullscreen&perf')
      expect(formatRoute({ kind: 'play', account: orbrun, gameId: 'dcss-web-trunk' })).toBe('/play/cdi/dcss-web-trunk?fullscreen&perf#orbrun')
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-web-trunk' })
      expect(window.location.search).toBe('?fullscreen&perf')
      expect(window.location.pathname).toBe('/play/cdi/dcss-web-trunk')
      expect(window.location.hash).toBe('#orbrun')
    } finally {
      history.replaceState(null, '', '/')
    }
  })

  /**
   * The address bar is also the way back: opening a game leaves the screen it
   * was opened from in the history, so the browser's Back (and a handheld's
   * back gesture) returns to the Play screen it came from.
   */
  describe('history', () => {
    beforeEach(() => {
      setOnlineAccount(orbrun)
      history.replaceState(null, '', '/')
    })

    it('keeps the Play submenu in history behind a game', () => {
      const before = history.length
      setRoute({ kind: 'menu', path: 'play' })
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
      expect(window.location.pathname).toBe('/play/cdi/dcss-0.34')
      expect(history.length).toBe(before + 2)
    })

    it('rewrites the entry coming back up, so Back never returns to the game just left', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
      const deep = history.length
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      setRoute({ kind: 'home' })
      expect(window.location.pathname).toBe('/')
      expect(history.length).toBe(deep)
    })

    it('gives the tab back its own title out of a game, and leaves a game’s to the game', () => {
      document.title = 'orbrun the Chiller | Vine Stalker - Orbrun'
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
      expect(document.title).toBe('orbrun the Chiller | Vine Stalker - Orbrun')
      setRoute({ kind: 'menu', path: 'settings' })
      expect(document.title).toBe('Polished Crawl - Dungeon Crawl Stone Soup')
    })

    it('names only the app in a window of its own', () => {
      history.replaceState(null, '', '/?fullscreen')
      setRoute({ kind: 'menu', path: 'settings' })
      expect(document.title).toBe('Polished Crawl')
    })

    it('leaves for the site’s pages with the launch flags, and in a window of its own without adding to history', () => {
      const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      try {
        history.replaceState(null, '', '/?perf')
        openPage('/about/install')
        expect(assign).toHaveBeenCalledWith('/about/install?perf')
        history.replaceState(null, '', '/?fullscreen')
        openPage('/about/install')
        expect(replace).toHaveBeenCalledWith('/about/install?fullscreen')
      } finally {
        assign.mockRestore()
        replace.mockRestore()
      }
    })

    it('leaves the address alone when it already says this', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      const len = history.length
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      expect(history.length).toBe(len)
    })

    /**
     * A window of our own has no Back to serve, and Chrome refuses to close a
     * window a script did not open once its history holds more than one
     * entry — so an entry here would cost the Quit row (quit.ts).
     */
    it('adds no entry in a window of its own, so Quit can still close it', () => {
      history.replaceState(null, '', '/?fullscreen')
      try {
        const before = history.length
        setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
        setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
        expect(window.location.pathname).toBe('/play/cdi/dcss-0.34')
        expect(history.length).toBe(before)
      } finally {
        history.replaceState(null, '', '/')
      }
    })

    it('does not stack an entry per game: one spectate to the next replaces it', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      setRoute({ kind: 'watch', serverId: 'cdi', account: orbrun, username: 'someone' })
      const len = history.length
      setRoute({ kind: 'watch', serverId: 'cdi', account: orbrun, username: 'other' })
      expect(window.location.pathname + window.location.hash).toBe('/watch/cdi#other')
      expect(history.length).toBe(len)
    })
  })
})
