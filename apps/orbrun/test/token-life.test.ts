// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getToken, setToken, loginState, type Account } from '../src/servers'
import { Session } from '../src/session'

// happy-dom's localStorage has no working methods; give servers.ts a plain one
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
})

const DAY = 24 * 60 * 60 * 1000
const orbrun: Account = { serverId: 'cdi', username: 'orbrun' }

describe('token store', () => {
  beforeEach(() => store.clear())

  it('keeps a token with the day count the server gave, and forgets it once that has passed', () => {
    const t0 = 1_000_000
    setToken('cdi', 'orbrun', 'tok', 7, t0)
    expect(getToken('cdi', 'orbrun', t0)).toBe('tok')
    expect(getToken('cdi', 'orbrun', t0 + 7 * DAY - 1)).toBe('tok')
    expect(getToken('cdi', 'orbrun', t0 + 7 * DAY)).toBeNull()
  })

  it('keeps a token without an expiry when the server gave none', () => {
    setToken('cdi', 'orbrun', 'tok')
    expect(getToken('cdi', 'orbrun', Number.MAX_SAFE_INTEGER)).toBe('tok')
    setToken('cdi', 'orbrun', 'tok2', 0)
    expect(getToken('cdi', 'orbrun', Number.MAX_SAFE_INTEGER)).toBe('tok2')
  })

  it('reads the bare string an older build stored as a token that has not expired', () => {
    store.set('orbrun.tokens', JSON.stringify({ 'cdi/orbrun': 'old' }))
    expect(getToken('cdi', 'orbrun')).toBe('old')
    expect(loginState(orbrun, null)).toBe('pending')
  })

  it('files the name as the server spells it, and forgets on null', () => {
    setToken('cdi', 'Orbrun', 'tok', 7)
    expect(getToken('cdi', 'orbrun')).toBe('tok')
    setToken('cdi', 'orbrun', null)
    expect(getToken('cdi', 'Orbrun')).toBeNull()
    expect(loginState(orbrun, null)).toBe('out')
  })

  it('shrugs off a token store that is not an object', () => {
    store.set('orbrun.tokens', JSON.stringify('junk'))
    expect(getToken('cdi', 'orbrun')).toBeNull()
    expect(() => setToken('cdi', 'orbrun', 'tok', 7)).not.toThrow()
    expect(getToken('cdi', 'orbrun')).toBe('tok')
  })
})

/** A WebSocket that records what went out and lets the test speak for the server. */
class FakeSocket {
  static last: FakeSocket | null = null
  binaryType = ''
  readyState = 1
  sent: string[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(public url: string) {
    FakeSocket.last = this
  }
  send(s: string) {
    this.sent.push(s)
  }
  close() {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: '', wasClean: false })
  }
  open() {
    this.onopen?.({})
  }
  say(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  msgs(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { msg: string }).msg)
  }
}

const cdi = { id: 'cdi', name: 'CDI', ws: 'wss://crawl.dcss.io/socket', http: 'https://crawl.dcss.io', host: 'crawl.dcss.io' }

describe('a session and its token', () => {
  beforeEach(() => {
    store.clear()
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeSocket })
  })

  it('keeps the old token until its replacement arrives', () => {
    setToken('cdi', 'orbrun', 'tok', 7)
    new Session(cdi, 'orbrun')
    const ws = FakeSocket.last!
    ws.open()
    expect(ws.msgs()).toEqual(['token_login'])
    expect(JSON.parse(ws.sent[0])).toEqual({ msg: 'token_login', cookie: 'tok' })
    expect(getToken('cdi', 'orbrun')).toBe('tok')
    ws.say({ msg: 'login_success', username: 'orbrun' })
    expect(ws.msgs()).toEqual(['token_login', 'set_login_cookie'])
    const t0 = Date.now()
    ws.say({ msg: 'login_cookie', cookie: 'orbrun%20123', expires: 7 })
    expect(getToken('cdi', 'orbrun', t0 + 6 * DAY)).toBe('orbrun%20123')
    expect(getToken('cdi', 'orbrun', t0 + 8 * DAY)).toBeNull()
  })

  it('tries the saved token again when a socket drops before the server answers', () => {
    setToken('cdi', 'orbrun', 'tok', 7)
    const s = new Session(cdi, 'orbrun')
    const first = FakeSocket.last!
    first.open()
    first.close()
    expect(s.reconnect()).toBe(true)
    const second = FakeSocket.last!
    second.open()
    expect(JSON.parse(second.sent[0])).toEqual({ msg: 'token_login', cookie: 'tok' })
    second.say({ msg: 'login_success', username: 'orbrun' })
    second.say({ msg: 'login_cookie', cookie: 'replacement', expires: 7 })
    expect(getToken('cdi', 'orbrun')).toBe('replacement')
  })

  it('gives an unanswered token login back to the reconnect flow', () => {
    vi.useFakeTimers()
    try {
      setToken('cdi', 'orbrun', 'tok', 7)
      const s = new Session(cdi, 'orbrun')
      FakeSocket.last!.open()
      vi.runOnlyPendingTimers()
      expect(s.closed).toBe(true)
      expect(getToken('cdi', 'orbrun')).toBe('tok')
    } finally {
      vi.useRealTimers()
    }
  })

  it('tries a different tab’s replacement when the server rejects the older token', () => {
    setToken('cdi', 'orbrun', 'old-token', 7)
    const s = new Session(cdi, 'orbrun')
    const ws = FakeSocket.last!
    ws.open()
    setToken('cdi', 'orbrun', 'from-other-tab', 7)
    ws.say({ msg: 'login_fail' })
    expect(getToken('cdi', 'orbrun')).toBe('from-other-tab')
    expect(JSON.parse(ws.sent[1])).toEqual({ msg: 'token_login', cookie: 'from-other-tab' })
    expect(s.state.lobby.loginFailed).toBeNull()
    ws.say({ msg: 'login_success', username: 'orbrun' })
    ws.say({ msg: 'login_cookie', cookie: 'replacement', expires: 7 })
    expect(getToken('cdi', 'orbrun')).toBe('replacement')
  })

  it('revokes a replacement that arrives after a different tab clears the saved login', () => {
    setToken('cdi', 'orbrun', 'old-token', 7)
    new Session(cdi, 'orbrun')
    const ws = FakeSocket.last!
    ws.open()
    ws.say({ msg: 'login_success', username: 'orbrun' })
    setToken('cdi', 'orbrun', null)
    ws.say({ msg: 'login_cookie', cookie: 'replacement', expires: 7 })
    expect(getToken('cdi', 'orbrun')).toBeNull()
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ msg: 'forget_login_cookie', cookie: 'replacement' })
  })

  it('renews a near-expiry token on the authenticated socket and retires the old one', () => {
    vi.useFakeTimers()
    try {
      const t0 = Date.now()
      const s = new Session(cdi, 'orbrun')
      const ws = FakeSocket.last!
      ws.open()
      ws.say({ msg: 'login_success', username: 'orbrun' })
      ws.say({ msg: 'login_cookie', cookie: 'old-token', expires: 7 })
      vi.setSystemTime(t0 + 6 * DAY)
      s.refreshLogin()
      expect(ws.msgs()).toEqual(['set_login_cookie'])
      vi.setSystemTime(t0 + 7 * DAY - 30 * 60_000)
      s.refreshLogin()
      s.refreshLogin()
      expect(ws.msgs()).toEqual(['set_login_cookie', 'set_login_cookie'])
      ws.say({ msg: 'login_cookie', cookie: 'renewed', expires: 7 })
      expect(getToken('cdi', 'orbrun')).toBe('renewed')
      expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ msg: 'forget_login_cookie', cookie: 'old-token' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens without a token login when there is none, and none when the token has expired', () => {
    setToken('cdi', 'orbrun', 'tok', 7, Date.now() - 8 * DAY)
    new Session(cdi, 'orbrun')
    const ws = FakeSocket.last!
    ws.open()
    expect(ws.msgs()).toEqual([])
    expect(getToken('cdi', 'orbrun')).toBeNull()
  })

  it('forgets the token when the server ends the login', () => {
    new Session(cdi, 'orbrun')
    const ws = FakeSocket.last!
    ws.open()
    ws.say({ msg: 'login_success', username: 'orbrun' })
    ws.say({ msg: 'login_cookie', cookie: 'orbrun%20123', expires: 7 })
    expect(getToken('cdi', 'orbrun')).toBe('orbrun%20123')
    ws.say({ msg: 'logout', reason: 'Account is disabled.' })
    expect(getToken('cdi', 'orbrun')).toBeNull()
  })

  it('drops a token the server refused', () => {
    setToken('cdi', 'orbrun', 'stale', 7)
    new Session(cdi, 'orbrun')
    const ws = FakeSocket.last!
    ws.open()
    ws.say({ msg: 'login_fail' })
    expect(getToken('cdi', 'orbrun')).toBeNull()
  })
})
