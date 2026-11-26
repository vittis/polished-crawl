// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  addServer, characterOf, customServersAllowed, describeCharacter, describePlace,
  enterOffline, findServer, gameTitle, getChosenAccount, getDeviceAccount, getGames,
  getOnlineAccount, getToken, leaveOffline, listServers, onlineAccountChanged, replaceToken, setGames,
  setLast, setOnlineAccount, setToken,
} from '../src/servers'
import { gameLinkRows } from '@orbrun/webtiles'

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

beforeEach(() => {
  leaveOffline()
  store.clear()
})
afterEach(() => vi.unstubAllEnvs())

const cdi = { serverId: 'cdi', username: 'Alice' }
const crg = { serverId: 'crg', username: 'Bob' }
const local = { serverId: 'offline', username: 'Ada' }

describe('hosted server policy', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('PROD', true)
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_PREVIEW_SHA', '')
  })

  it('offers local play and limits the production server list to bundled HTTPS servers', () => {
    expect(customServersAllowed()).toBe(false)
    expect(findServer('offline')?.offline).toBe(true)
    expect(addServer('https://crawl.dcss.io/')).toEqual(findServer('cdi'))
    expect(() => addServer('https://crawl.example.org')).toThrow('public server list')
    expect(listServers().every(s => s.ws.startsWith('wss://'))).toBe(true)
    expect(listServers().some(s => s.offline)).toBe(false)
  })
})

describe('one online login and one device profile', () => {
  it('opens the default local profile without replacing the remembered online login', () => {
    setOnlineAccount(cdi)
    setToken(cdi.serverId, cdi.username, 'current')
    enterOffline()
    expect(getChosenAccount()).toEqual({ serverId: 'offline', username: 'Player' })
    leaveOffline()
    expect(getChosenAccount()).toEqual(cdi)
    expect(getToken(cdi.serverId, cdi.username)).toBe('current')
  })

  it('keeps the selected online login and reuses the last active local save and RC namespace', () => {
    const oldProfile = { serverId: 'offline', username: 'Sam' }
    store.set('orbrun.accounts', JSON.stringify([cdi, crg, oldProfile, local]))
    store.set('orbrun.account', JSON.stringify(cdi))
    store.set('orbrun.accountUsed', JSON.stringify({ 'crg/bob': 500, 'offline/sam': 100, 'offline/ada': 200 }))
    store.set('orbrun.offline.rc:ada', '# Ada’s settings')
    setToken('cdi', 'Alice', 'current')
    setToken('crg', 'Bob', 'previous')
    expect(getOnlineAccount()).toEqual(cdi)
    expect(getDeviceAccount()).toEqual(local)
    expect(getToken('cdi', 'Alice')).toBe('current')
    expect(getToken('crg', 'Bob')).toBeNull()
    expect(store.get('orbrun.offline.rc:ada')).toBe('# Ada’s settings')
  })

  it('keeps a legacy token keyed by server with its last played username', () => {
    setLast(cdi)
    store.set('orbrun.tokens', JSON.stringify({ cdi: 'legacy' }))
    expect(getOnlineAccount()).toEqual(cdi)
    expect(getToken('cdi', 'Alice')).toBe('legacy')
  })

  it('forgets the previous login on replacement and does not fall back after logout', () => {
    setOnlineAccount(cdi)
    setToken('cdi', 'Alice', 'previous')
    setOnlineAccount(crg)
    setToken('crg', 'Bob', 'current')
    expect(getOnlineAccount()).toEqual(crg)
    expect(getToken('cdi', 'Alice')).toBeNull()
    expect(replaceToken('cdi', 'Alice', null, 'late-reply')).toBe(false)
    expect(onlineAccountChanged(new StorageEvent('storage', { key: 'orbrun.account' }), cdi)).toBe(true)
    expect(onlineAccountChanged(new StorageEvent('storage', { key: 'orbrun.account' }), crg)).toBe(false)
    expect(onlineAccountChanged(new StorageEvent('storage', { key: 'orbrun.account' }), local)).toBe(false)
    setOnlineAccount(null)
    expect(getOnlineAccount()).toBeNull()
    expect(getToken('crg', 'Bob')).toBeNull()
  })
})

/**
 * The home screen's 'Play 0.34' and 'Play trunk' entries come from the game
 * list the server's lobby sent last time (`set_game_links`), kept per server
 * so they are there before the connection is up.
 */
describe('cached game list', () => {
  beforeEach(() => store.clear())

  it('is empty until a lobby has sent one', () => {
    expect(getGames('cdi')).toBeNull()
  })

  it('is kept per server and splits into the lobby rows', () => {
    setGames('cdi', [
      { id: 'dcss-web-trunk', label: 'DCSS trunk' },
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'dcss-web-0.33', label: 'DCSS 0.33' },
    ])
    setGames('cao', [{ id: 'dcss-web-trunk', label: 'trunk' }])
    const rows = gameLinkRows(getGames('cdi')!)
    expect(rows.latestVersion).toBe('0.34')
    expect(rows.latest.map((g) => g.id)).toEqual(['dcss-web-0.34'])
    expect(rows.trunk.map((g) => g.id)).toEqual(['dcss-web-trunk'])
    expect(getGames('cao')).toEqual([{ id: 'dcss-web-trunk', label: 'trunk' }])
  })

  it('keeps id, label, the save the lobby reported and the rc file the game reads, nothing else', () => {
    setGames('cdi', [
      { id: 'g', label: 'G', extra: 1 } as never,
      { id: 't', label: 'T', save: 'orbruntest, a level 3 Minotaur Berserker of Trog', rc: 'g' },
      { id: 'f', label: 'F', save: 'slot full', disabled: true },
    ])
    expect(getGames('cdi')).toEqual([
      { id: 'g', label: 'G' },
      { id: 't', label: 'T', save: 'orbruntest, a level 3 Minotaur Berserker of Trog', rc: 'g' },
      { id: 'f', label: 'F', save: 'slot full', disabled: true },
    ])
  })
})

/**
 * The home screen's Continue names the character from the lobby roster's own line, the way the stats screen's
 * first lines do. The entry below is a real one, recorded from CDI on 2026-09-09 for the test account's open
 * trunk game.
 */
describe('characterOf', () => {
  const entry = { username: 'orbrun', game_id: 'dcss-git', xl: '2', char: 'VSIE', place: 'D:2', turn: '1312', title: 'Chiller' }

  it('reads the roster line the way Continue speaks a character', () => {
    const c = characterOf(entry)
    expect(c).toEqual({ name: 'orbrun', title: 'the Chiller', species: 'VSIE', god: '', xl: 2, place: 'D', depth: 2 })
    expect(describeCharacter(c)).toBe('orbrun the Chiller, VSIE XL2')
    expect(describePlace(c)).toBe('D:2')
  })

  it('says only what the line says, never what this device saw last', () => {
    // the same account plays from any browser: a character this device remembers can already be dead, and
    // borrowing their species or god would dress the live line in someone who is gone
    expect(characterOf({ ...entry, god: 'Xom' }).god).toBe('Xom')
    expect(characterOf({ username: 'orbrun', game_id: 'dcss-git' })).toEqual({ name: 'orbrun', title: '', species: '', god: '', xl: 0, place: '', depth: 0 })
  })

  it('takes a branch without a depth bare, and stands without a line the roster has not filled', () => {
    expect(characterOf({ username: 'orbrun', place: 'Zot' })).toEqual({ name: 'orbrun', title: '', species: '', god: '', xl: 0, place: 'Zot', depth: 0 })
    expect(characterOf({ username: 'orbrun', place: 'Abyss:3' })).toMatchObject({ place: 'Abyss', depth: 3 })
  })
})

describe('describeCharacter', () => {
  it('reads name, title, species and XL; the place is a line of its own', () => {
    const c = { name: 'Kai', title: 'the Severer', species: 'Mountain Dwarf', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(describeCharacter(c)).toBe('Kai the Severer, Mountain Dwarf XL12')
    expect(describePlace(c)).toBe('Snake Pit:2')
  })

  it('keeps a title that carries its own comma against the name, and a branch without depth bare', () => {
    const c = { name: 'Orbrun', title: ', Champion of Xom', species: 'Minotaur', xl: 27, place: 'Zot', depth: 0 }
    expect(describeCharacter(c)).toBe('Orbrun, Champion of Xom, Minotaur XL27')
    expect(describePlace(c)).toBe('Zot')
  })

  it('leaves out what the game has not said yet', () => {
    const c = { name: 'Orbrun', title: '', species: '', xl: 0, place: '', depth: 0 }
    expect(describeCharacter(c)).toBe('Orbrun')
    expect(describePlace(c)).toBe('')
  })
})

/** The tab's title in a game: the player and their title, the species, then the site after a dash. */
describe('gameTitle', () => {
  it('names the player, the species and the site, a dash before the site', () => {
    const c = { name: 'orbrun', title: 'the Chiller', species: 'Vine Stalker', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(gameTitle(c, 'Orbrun')).toBe('orbrun the Chiller | Vine Stalker - Orbrun')
  })

  it('names the god after the species, as the HUD does', () => {
    const c = { name: 'orbrun', title: 'the Ruinous', species: 'Deep Elf', god: 'Vehumet', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(gameTitle(c, 'Orbrun')).toBe('orbrun the Ruinous | Deep Elf of Vehumet - Orbrun')
  })

  it('leaves out what the game has not said yet', () => {
    const c = { name: 'orbrun', title: '', species: '', xl: 0, place: '', depth: 0 }
    expect(gameTitle(c, 'Orbrun')).toBe('orbrun - Orbrun')
  })
})
