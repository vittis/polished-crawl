import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initialState, reduce, type Monster } from '@orbrun/webtiles'
import type { Gamedata } from '@orbrun/gamedata'
import { fixtureGamedata, fixtureState } from './recording'
import { cellKey, emptyScene, type Scene } from '@orbrun/scene'
import { buildScene, enumMismatches, missingTileNames, classifyFeature, stanceFor, standsFree, gateFaces, isScenery, isVegetation, isExcludedFromList, monsterGroups, monsterSort, itemTileName } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('gamedata loader', () => {
  let gd: Gamedata
  beforeAll(async () => {
    gd = await fixtureGamedata()
  })
  it('loads tile modules with increasing ranges', () => {
    const r = gd.ranges
    expect(r.floorMax).toBeGreaterThan(0)
    expect(r.wallMax).toBeGreaterThan(r.floorMax)
    expect(r.featMax).toBeGreaterThan(r.wallMax)
    expect(r.mainMax).toBeGreaterThan(r.featMax)
    expect(r.playerMax).toBeGreaterThan(r.mainMax)
    expect(r.firstTransparent).toBeGreaterThan(r.floorMax)
    expect(r.firstTransparent).toBeLessThan(r.wallMax)
  })
  it('resolves names and tile rects', () => {
    const down = gd.dngn.id('DNGN_STONE_STAIRS_DOWN')
    expect(down).toBeDefined()
    expect(gd.dngn.name(down!)).toBe('DNGN_STONE_STAIRS_DOWN')
    const rect = gd.tile(down!)
    expect(rect?.atlas).toBe('feat')
    expect(rect?.w).toBeGreaterThan(0)
    const floorVar = gd.dngn.id('FLOOR_GREY_DIRT_3')!
    expect(gd.dngn.baseName(floorVar)).toBe('FLOOR_GREY_DIRT')
  })
  it('names the first tile of a module, not the previous module sentinel', () => {
    // TILE_WALL_MAX and DNGN_TREE share an id; the tree is the tile
    const tree = gd.dngn.id('DNGN_TREE')!
    expect(tree).toBe(gd.ranges.wallMax)
    expect(gd.dngn.name(tree)).toBe('DNGN_TREE')
    expect(gd.dngn.baseName(gd.dngn.id('DNGN_TREE_3')!)).toBe('DNGN_TREE')
    expect(gd.dngn.name(gd.ranges.floorMax)).not.toMatch(/_MAX$/)
    expect(gd.main.name(gd.ranges.featMax)).toBe('UNRAND_AIR')
  })
  it('decodes flag words from the server enums', () => {
    const fg = gd.fg([531768, 268435456])
    expect(fg.value).toBe(531768 & 0xffff)
    expect(fg.FLYING).toBe(true)
    expect(fg.S_UNDER).toBe(false)
    const bg = gd.bg(947)
    expect(bg.value).toBe(947)
    expect(bg.UNSEEN).toBe(false)
  })
})

describe('classification', () => {
  it('needs two of three signals', () => {
    expect(classifyFeature('DNGN_STONE_STAIRS_DOWN', '>', 13)).toEqual({ type: 'stairs', dir: 'down' })
    expect(classifyFeature('DNGN_STONE_STAIRS_DOWN', '.', 1)?.type).toBe('stairs')
    expect(classifyFeature('DNGN_CLOSED_DOOR', '+', 5)).toEqual({ type: 'door', state: 'closed' })
    expect(classifyFeature('DNGN_ENTER_SHOP', undefined, 15)?.type).toBe('shop')
    expect(classifyFeature('DNGN_ALTAR_ZIN', '_', 15)).toEqual({ type: 'altar', god: 'zin' })
    expect(classifyFeature('DNGN_ENTER_LAIR', '>', 14)).toEqual({ type: 'portal' })
  })
  /**
   * Doors side by side wear crawl's gate art, and a spell aimed through them
   * draws its path over their glyph (`*`), leaving the name and the minimap's
   * door to say what they are. A gate is no portal.
   */
  it('reads the pieces of a gate as doors, on a spell\'s path too', () => {
    for (const [name, state] of [
      ['DNGN_GATE_OPEN_LEFT', 'open'],
      ['DNGN_VGATE_OPEN_MIDDLE_CRYPT', 'open'],
      ['DNGN_GATE_BROKEN_CLEAR_RIGHT', 'open'],
      ['DNGN_BROKEN_DOOR', 'open'],
      ['DNGN_GATE_CLOSED_MIDDLE', 'closed'],
      ['DNGN_VGATE_RUNED_UP', 'runed'],
      ['DNGN_GATE_SEALED_CLEAR_LEFT', 'sealed'],
    ] as const) {
      expect(classifyFeature(name, '*', 5)).toEqual({ type: 'door', state })
      expect(classifyFeature(name, state === 'open' ? "'" : '+', 5)?.type).toBe('door')
    }
  })
  it('the D:1 start square is the dungeon exit, an up stair, not a portal', () => {
    // under the player the glyph is `@`, so only the name and the minimap category vote (tileweb.cc _send_cell)
    const fx = JSON.parse(readFileSync(join(here, 'fixtures', 'cdi-git-newgame-d1-cell.json'), 'utf8'))
    expect(fx.cell.g).toBe('@')
    expect(fx.cell.mf).toBe(12) // MF_STAIR_UP
    expect(classifyFeature(fx.bgName, fx.cell.g, fx.cell.mf)).toEqual({ type: 'stairs', dir: 'up', exit: true })
    // seen from a distance the glyph is `<` (feature-data.h DCHAR_STAIRS_UP)
    expect(classifyFeature('DNGN_EXIT_DUNGEON', '<', 12)).toEqual({ type: 'stairs', dir: 'up', exit: true })
    // branch exits (feature-data.h BRANCH_EXIT: DCHAR_STAIRS_UP, MF_STAIR_UP) are up stairs underfoot too
    expect(classifyFeature('DNGN_EXIT_LAIR', '@', 12)).toEqual({ type: 'stairs', dir: 'up' })
    expect(classifyFeature('DNGN_EXIT_LAIR', '<', 12)).toEqual({ type: 'stairs', dir: 'up' })
    // portal exits (PORTAL_EXIT: DCHAR_ARCH, MF_PORTAL) stay portals
    expect(classifyFeature('DNGN_EXIT_ABYSS', '@', 23)).toEqual({ type: 'portal' })
  })
  it('chooses stances', () => {
    // a way up stands; a way down lies in the floor, a block like a corpse
    expect(stanceFor('DNGN_STONE_STAIRS_DOWN', { type: 'stairs', dir: 'down' })).toBe('lying')
    expect(stanceFor('DNGN_STONE_STAIRS_DOWN_I', undefined)).toBe('lying')
    expect(stanceFor('DNGN_ENTER_LAIR', { type: 'stairs', dir: 'down', branch: true })).toBe('lying')
    expect(stanceFor('DNGN_STONE_STAIRS_UP_I', undefined)).toBe('upright')
    expect(stanceFor('DNGN_EXIT_DUNGEON', { type: 'stairs', dir: 'up', exit: true })).toBe('upright')
    expect(stanceFor('DNGN_ESCAPE_HATCH_DOWN', { type: 'hatch', dir: 'down' })).toBe('lying')
    expect(stanceFor('DNGN_ESCAPE_HATCH_UP', { type: 'hatch', dir: 'up' })).toBe('upright')
    expect(stanceFor('DNGN_ESCAPE_HATCH_DOWN', undefined)).toBe('lying')
    // what the player steps on or uses lies as a block too: traps (a shaft among them) and transporters
    expect(stanceFor('DNGN_TRAP_SHAFT', { type: 'hatch', dir: 'down' })).toBe('lying')
    expect(stanceFor('DNGN_TRAP_SHAFT', undefined)).toBe('lying')
    expect(stanceFor('DNGN_TRAP_ARROW', { type: 'trap' })).toBe('lying')
    expect(stanceFor('DNGN_TRAP_WEB', undefined)).toBe('lying')
    expect(stanceFor('DNGN_TRANSPORTER', { type: 'transporter' })).toBe('lying')
    expect(stanceFor('DNGN_TELEPORTER', undefined)).toBe('lying')
    // a landing is where a transporter puts you, and decorations are the floor's own
    expect(stanceFor('DNGN_TRANSPORTER_LANDING', undefined)).toBe('decal')
    expect(stanceFor('DNGN_DECORATIVE_FLOOR', undefined)).toBe('decal')
    expect(stanceFor('DNGN_ALTAR_ZIN', { type: 'altar' })).toBe('upright')
    expect(stanceFor('DNGN_GRANITE_STATUE', undefined)).toBe('upright')
    expect(stanceFor('DNGN_TREE', undefined)).toBe('upright')
    expect(stanceFor('DNGN_MANGROVE', undefined)).toBe('upright')
    // the standards a decorative floor plants (orcish, infernal, caliginous) are flags on poles
    expect(stanceFor('DNGN_ENSIGN_BEOGH', undefined)).toBe('upright')
    expect(stanceFor('DNGN_ENSIGN_GEHENNA', undefined)).toBe('upright')
    expect(stanceFor('DNGN_ENSIGN_DARK', undefined)).toBe('upright')
  })
  it('tells a feature that stands on the dungeon from one built into it', () => {
    // what stands in its cell: turned upright over a turning map
    expect(standsFree('DNGN_GRANITE_STATUE', undefined)).toBe(true)
    expect(standsFree('DNGN_ALTAR_ZIN', { type: 'altar' })).toBe(true)
    expect(standsFree('DNGN_BLUE_FOUNTAIN', { type: 'fountain', kind: 'blue' })).toBe(true)
    expect(standsFree('DNGN_TREE', undefined)).toBe(true)
    expect(standsFree('DNGN_ENSIGN_DARK', undefined)).toBe(true)
    // built in: doors and gates in any state, Zot's wall-bedded runelights,
    // and the stairs and hatches cut into the floor
    expect(standsFree('DNGN_CLOSED_DOOR', { type: 'door', state: 'closed' })).toBe(false)
    expect(standsFree('DNGN_OPEN_DOOR', { type: 'door', state: 'open' })).toBe(false)
    expect(standsFree('DNGN_GATE_RUNED_LEFT', { type: 'door', state: 'runed' })).toBe(false)
    expect(standsFree('DNGN_RUNELIGHT', undefined)).toBe(false)
    expect(standsFree('DNGN_STONE_STAIRS_DOWN', { type: 'stairs', dir: 'down' })).toBe(false)
    expect(standsFree('DNGN_ESCAPE_HATCH_UP', { type: 'hatch', dir: 'up' })).toBe(false)
    expect(standsFree('DNGN_ENTER_LAIR', { type: 'stairs', dir: 'down', branch: true })).toBe(false)
    // what lies on the floor stays lying: it is ground, not a thing in the cell
    expect(standsFree('DNGN_TRAP_ARROW', { type: 'trap' })).toBe(false)
    expect(standsFree('DNGN_TRAP_SHAFT', undefined)).toBe(false)
  })
  it('treats piles of debris and other stationary rubble as scenery', () => {
    expect(isScenery('pile of debris')).toBe(true)
    expect(isScenery('briar patch')).toBe(true)
    expect(isScenery('bush')).toBe(true)
    expect(isVegetation('pile of debris')).toBe(false)
    expect(isScenery('orc warrior')).toBe(false)
    expect(isScenery('orb of destruction')).toBe(false)
  })
})

describe('scene composition from WebTiles cells', () => {
  let gd: Gamedata
  beforeAll(async () => {
    gd = await fixtureGamedata()
  })
  function floorCell() {
    const bg = gd.dngn.id('FLOOR_GREY_DIRT')!
    return { x: 1, y: 1, g: '.', t: { bg, flv: { f: bg, s: 3 } } }
  }

  it('preserves the liquid material when the minimap reports generic water', () => {
    const state = initialState()
    const cells = ['DNGN_SHALLOW_WATER', 'DNGN_LAVA', 'DNGN_TOXIC_BOG', 'FLOOR_GREY_DIRT'].map((name, x) =>
      ({ x, y: 1, mf: gd.enums.MF_WATER, t: { bg: gd.dngn.id(name), liquefied: x === 3 } }))
    reduce(state, { msg: 'map', cells })
    const scene = buildScene(state, gd)
    expect(cells.map(({ x, y }) => scene.cells.get(cellKey(x, y))?.life?.motion)).toEqual(['water', 'lava', 'bog', 'bog'])
  })

  it('uses stable plain masonry beneath torch frames and clears it when the wall changes', () => {
    const state = initialState(), key = cellKey(1, 0)
    let previous = emptyScene()
    for (const family of [2, 4, 6]) for (let frame = 0; frame < 4; frame++) {
      const name = `WALL_BRICK_DARK_${family}`
      const decorated = gd.dngn.id(`${name}_TORCH${frame ? `_${frame}` : ''}`)!
      expect(decorated).toBeDefined()
      reduce(state, { msg: 'map', cells: [{ x: 1, y: 0, mf: gd.enums.MF_WALL, g: '#', t: { bg: decorated } }] })
      previous = buildScene(state, gd, { previous, dirty: { cells: state.dirtyCells, mapCleared: state.mapCleared } })
      expect(previous.cells.get(key)).toMatchObject({ kind: 'wall', wallTile: decorated, wallMaterialTile: gd.dngn.id(name) })
      state.dirtyCells.clear(); state.mapCleared = false
    }
    const plain = gd.dngn.id('WALL_BRICK_DARK_2')!
    reduce(state, { msg: 'map', cells: [{ x: 1, y: 0, t: { bg: plain } }] })
    previous = buildScene(state, gd, { previous, dirty: { cells: state.dirtyCells, mapCleared: state.mapCleared } })
    expect(previous.cells.get(key)?.wallTile).toBe(plain)
    expect(previous.cells.get(key)?.wallMaterialTile).toBeUndefined()
  })
  it('stands a tree upright rather than laying it on the floor', () => {
    const st = initialState(), floor = floorCell()
    const tree = gd.dngn.id('DNGN_TREE_2')!
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, g: '\u2663', t: { ...floor.t, bg: tree } })
    const cell = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    expect(cell.kind).toBe('feature')
    expect(cell.featureTile).toBe(tree)
    expect(cell.stance).toBe('upright')
    expect(cell.label).toBe('tree')
  })
  it('builds a wall dressed in feature art as a wall, not a picture on the floor', () => {
    const st = initialState(), floor = floorCell()
    for (const name of ['STONE_SMOOTH_WALL_BEOGH', 'DNGN_DIMENSION_EDGE']) {
      const art = gd.dngn.id(name)!
      st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, mf: gd.enums.MF_WALL as number, g: '#', t: { ...floor.t, bg: art } })
      const wall = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
      expect(wall.kind, name).toBe('wall')
      expect(wall.occluder, name).toBe(true)
      expect(wall.wallTile, name).toBe(art)
    }
    // feature art on a decorative floor (Bailey's orcish standard, sent with the fountain glyph) stands in the room
    const ensign = gd.dngn.id('DNGN_ENSIGN_BEOGH')!
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, g: '\u2320', t: { ...floor.t, bg: ensign } })
    const standard = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    expect(standard.kind).toBe('feature')
    expect(standard.stance).toBe('upright')
  })
  it('stands ruined columns and similar wall-category props on the floor without a masonry block', () => {
    const st = initialState(), floor = floorCell()
    for (const name of ['DNGN_CRUMBLED_COLUMN', 'DNGN_CRUMBLED_COLUMN_1', 'DNGN_CRUMBLED_COLUMN_5',
      'DEPTHS_COLUMN', 'DEPTHS_CRUMBLED_COLUMN', 'DNGN_GRANITE_STATUE', 'DNGN_STATUE_IRON',
      'DNGN_ORCISH_IDOL', 'DNGN_GRAVESTONE', 'DNGN_NECROPOLIS_GRAVESTONE', 'DNGN_ZONGULDROK_SHRINE', 'DNGN_TREE']) {
      const art = gd.dngn.id(name)!
      expect(art, name).toBeDefined()
      for (const mf of [gd.enums.MF_WALL, gd.enums.MF_MAP_WALL] as number[]) {
        st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, mf, g: '#', t: { ...floor.t, bg: art } })
        const prop = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
        expect(prop.kind, name).toBe('feature')
        expect(prop.occluder, name).toBe(false)
        expect(prop.floorTile, name).toBe(floor.t!.flv?.f ?? art)
        expect(prop.featureTile, name).toBe(art)
        expect(prop.wallTile, name).toBeUndefined()
        expect(prop.stance, name).toBe('upright')
        expect(prop.freestanding, name).toBe(true)
      }
    }
  })
  it('gives an open door in a north–south gate the horizontal pieces its faces show, as a closed one has', () => {
    const st = initialState(), floor = floorCell()
    const up = gd.dngn.id('DNGN_VGATE_OPEN_UP')!
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, g: "'", t: { ...floor.t, bg: up } })
    const cell = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    expect(cell.occluder).toBe(false)
    expect(cell.featureTile).toBe(up)
    expect(cell.faceTiles).toEqual({ w: gd.dngn.id('DNGN_GATE_OPEN_LEFT'), e: gd.dngn.id('DNGN_GATE_OPEN_RIGHT') })
  })
  it('keeps shoreline overlays and identifies projected wall shadows', () => {
    const st = initialState(), floor = floorCell()
    const water = gd.dngn.id('DNGN_SHALLOW_WATER')!
    const shore = gd.dngn.id('SHORE_N')!
    const wave = gd.dngn.id('DNGN_WAVE_N')!
    const murky = gd.dngn.id('MURKY_WAVE_NW')!
    const deep = gd.dngn.id('WAVE_DEEP_N')!
    const ink = gd.dngn.id('WAVE_INK_FULL')!
    const shadow = gd.dngn.id('DNGN_WALL_SHADOW')!
    // the runs stand in dc-floor.txt order, with the colour variations of the
    // shallow border between its base tiles and the murky set
    expect(murky).toBeGreaterThan(wave + 8)
    const green = wave + 8
    // the shoals water tiles sit between the murky borders and the deep waves: floors, not shorelines
    const shoals = gd.dngn.id('SHOALS_SHALLOW_WATER')!
    const ov = [shore, wave, green, murky, shoals, deep, ink, shadow]
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, t: { ...floor.t, bg: water, ov } })
    const cell = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    for (const o of ov) expect(cell.overlays).toContain(o)
    expect(cell.wallShadows).toEqual([shadow])
  })
  it('keeps travel exclusions on floors and wall faces', () => {
    const st = initialState(), floor = floorCell()
    const excl = gd.dngn.id('TRAVEL_EXCLUSION_BG')!
    const centre = gd.dngn.id('TRAVEL_EXCLUSION_CENTRE_BG')!
    const wall = { x: 2, y: 1, g: '#', t: { bg: gd.dngn.id('WALL_BRICK_DARK_2')! } }
    // enums.js bg_flags: TRAV_EXCL 0x00400000, EXCL_CTR 0x00800000
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, t: { ...floor.t, bg: gd.bg(floor.t!.bg).value | 0x00800000 } })
    st.map.cells.set(cellKey(wall.x, wall.y), { ...wall, t: { ...wall.t, bg: gd.bg(wall.t!.bg).value | 0x00400000 } })
    const scene = buildScene(st, gd)
    const f = scene.cells.get(cellKey(floor.x, floor.y))!
    expect(f.overlays).toContain(centre)
    const w = scene.cells.get(cellKey(wall.x, wall.y))!
    expect(w.wallOverlays).toContain(excl)
  })
  it('preserves the targeter landing overlay', () => {
    const st = initialState(), floor = floorCell()
    const landing = gd.dngn.id('LANDING')!
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, t: { ...floor.t, ov: [landing] } })
    const f = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    expect(f.overlays).toContain(landing)
  })
  it('names a shop by its wares, the only thing the tile says about it (tilepick.cc tileidx_shop)', () => {
    const st = initialState(), floor = floorCell()
    const shop = gd.dngn.id('SHOP_WEAPONS')
    expect(shop).toBeDefined()
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, mf: 15, t: { ...floor.t, bg: shop } })
    const cell = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    expect(cell.feature).toEqual({ type: 'shop' })
    // the shopkeeper's own name (shopping.cc `shop_name`) is never sent per square
    expect(cell.label).toBe('weapon shop')
  })
  it('composes travel arrows, blood variants and wall shadows with ordinary floor overlays', () => {
    const state = initialState(), floor = floorCell()
    const shadow = gd.dngn.id('DNGN_WALL_SHADOW')!
    const dark = gd.dngn.id('DNGN_WALL_SHADOW_DARK')!
    const ordinary = gd.dngn.id('SHORE_N')!
    const from = gd.icons.id('TRAVEL_PATH_FROM')!
    const to = gd.icons.id('TRAVEL_PATH_TO')!
    reduce(state, { msg: 'map', cells: [
      { ...floor, t: { ...floor.t, travel_trail: 0x82, bloody: true, ov: [shadow + 6, dark, ordinary] } },
      { ...floor, x: 2 },
    ] })
    const scene = buildScene(state, gd)
    const decorated = scene.cells.get(cellKey(1, 1))!
    expect(decorated.icons).toEqual(expect.arrayContaining([from + 1, to + 7]))
    expect(decorated.trail).toEqual({ from: 5, to: 7, fromTile: from + 1, toTile: to + 7 })
    expect(decorated.overlays).toEqual(expect.arrayContaining([gd.dngn.id('BLOOD')! + 3, shadow + 6, dark, ordinary]))
    expect(decorated.wallShadows).toEqual([shadow + 6, dark])
    const plain = scene.cells.get(cellKey(2, 1))!
    expect(plain.trail).toBeUndefined()
    expect(plain.icons ?? []).toEqual([])
  })

  it('identifies the server cursor separately from other cell badges', () => {
    const st = initialState()
    const floor = gd.dngn.id('FLOOR_NORMAL') ?? 1
    for (const [flag, name] of [[0x00180000, 'CURSOR'], [0x00080000, 'CURSOR2'], [0x00100000, 'CURSOR3'], [0x00280000, 'TUTORIAL_CURSOR']] as const) {
      st.map.cells.set(cellKey(1, 1), { x: 1, y: 1, g: '.', t: { bg: floor + flag, travel_trail: 1 } })
      const cell = buildScene(st, gd).cells.get(cellKey(1, 1))!
      expect(cell.cursorTile).toBe(gd.icons.id(name))
      expect(cell.icons).toContain(cell.cursorTile)
      expect(cell.icons).toContain(gd.icons.id('TRAVEL_PATH_FROM'))
    }
    st.map.cells.set(cellKey(1, 1), { x: 1, y: 1, g: '.', t: { bg: floor, travel_trail: 1 } })
    expect(buildScene(st, gd).cells.get(cellKey(1, 1))!.cursorTile).toBeUndefined()
  })

  it('draws no decoration by a name the server does not publish', () => {
    // the guard that would have caught SOMETHING_UNDER: a renamed tile stops
    // being drawn silently, so every name in the tables is checked at load
    expect(missingTileNames(gd)).toEqual([])
  })

  it('finds the client constants in step with a real enums.js', () => {
    // enums.js lists no PAGED_INVENTORY, which menu.h has: no warning for that
    expect(enumMismatches(gd)).toEqual([])
    const menu_flag = { ...(gd.enums.menu_flag as Record<string, number>), PAGED_INVENTORY: 0x100000 }
    expect(enumMismatches({ ...gd, enums: { ...gd.enums, menu_flag } } as Gamedata)).toEqual(['enums.js menu_flag.PAGED_INVENTORY = 1048576, client assumes 2097152'])
  })

  it('badges an item over a pile and keeps corpses on the floor', () => {
    const state = initialState(), floor = floorCell()
    const gold = gd.main.id('GOLD05')!
    const corpse = gd.main.id('CORPSE_BLACK_MAMBA')!
    reduce(state, { msg: 'map', cells: [
      { ...floor, t: { ...floor.t, fg: gold | 0x00040000 } }, // S_UNDER
      { ...floor, x: 2, t: { ...floor.t, fg: corpse } },
    ] })
    const items = buildScene(state, gd).billboards.filter(b => b.kind === 'item')
    const pile = items.find(item => item.tile === gold)!
    const under = gd.icons.id('ITEM_STACK_1') ?? gd.icons.id('SOMETHING_UNDER')
    expect(under).toBeDefined()
    expect(pile.lying).toBeUndefined()
    expect(pile.statusIcons).toEqual(expect.arrayContaining([expect.objectContaining({ tile: under })]))
    expect(items.find(item => item.tile === corpse)?.lying).toBe(true)
  })

  it('marks the net and the web as whole-cell badges and every corner badge as not', () => {
    const st = fixtureState()
    const me = st.map.cells.get(cellKey(st.player.pos.x, st.player.pos.y))!
    // enums.js fg_flags: NET 0x00800000 and WEB 0x01000000 in the first word, POISON [0, 0x08000000] in the second (0.34)
    const fg = [gd.fg(me.t!.fg!).value | 0x00800000 | 0x01000000, 0x08000000]
    st.map.cells.set(cellKey(me.x, me.y), { ...me, t: { ...me.t, fg } })
    const player = buildScene(st, gd).billboards.find((b) => b.kind === 'player')!
    const full = (player.statusIcons || []).filter((i) => i.full).map((i) => i.tile)
    expect(full).toEqual([gd.icons.id('TRAP_NET'), gd.icons.id('TRAP_WEB')])
    const corner = (player.statusIcons || []).filter((i) => !i.full).map((i) => i.tile)
    expect(corner).toContain(gd.icons.id('POISON'))
  })

  it('retains each native damage icon and server wound level independently of status badges', () => {
    const state = initialState(), floor = floorCell(), goblin = gd.player.id('MONS_GOBLIN')!
    const damage = [
      [0x40000000, 0, 'LIGHTLY_DAMAGED'],
      [0x80000000, 0, 'MODERATELY_DAMAGED'],
      [0xc0000000, 0, 'HEAVILY_DAMAGED'],
      [0, 1, 'SEVERELY_DAMAGED'],
      [0xc0000000, 1, 'ALMOST_DEAD'],
    ] as const
    reduce(state, { msg: 'map', cells: damage.map(([lo, hi], x) => ({
      ...floor, x, mon: { id: x + 1, name: 'goblin', att: x % 2 === 0 ? 0 : 4 },
      t: { ...floor.t, fg: [goblin | lo, hi | 0x08000000] }, // MDAM and POISON
    })) })
    const monsters = buildScene(state, gd).billboards.filter(b => b.kind === 'monster')
    expect(monsters).toHaveLength(damage.length)
    for (const [x, [, , level]] of damage.entries()) {
      const monster = monsters.find(b => b.x === x)!
      expect(monster.damage).toBe(level.toLowerCase())
      expect(monster.damageTile).toBe(gd.icons.id(`MDAM_${level}`))
      expect(monster.statusIcons).not.toContainEqual(expect.objectContaining({ tile: monster.damageTile }))
      expect(monster.statusIcons).toContainEqual(expect.objectContaining({ tile: gd.icons.id('POISON') }))
      expect(monster.statusIcons?.find(badge => badge.tile === gd.icons.id('POISON'))?.at).toBeUndefined()
    }
  })
})

describe('monster list grouping (monster_list.js)', () => {
  const mon = (name: string, att: number, avghp: number, type: number, extra: Partial<Monster> = {}): Monster => ({ name, plural: name + 's', att, type, typedata: { avghp }, ...extra })
  const sceneWith = (mons: { x: number; y: number; m: Monster; visible?: boolean }[]): Scene => {
    const scene = emptyScene()
    scene.playerOnLevel = true
    for (const { x, y, m, visible } of mons) {
      scene.cells.set(cellKey(x, y), { x, y, kind: 'floor', visibility: visible === false ? 'remembered' : 'visible', occluder: false, floorTile: 1, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } })
      scene.billboards.push({ x, y, tile: 1, kind: 'monster', height: 1, name: m.name, ref: m })
    }
    return scene
  }

  it('sorts as monster_info::less_than: attitude, average hp desc, type desc, name', () => {
    const rat = mon('rat', 0, 5, 10)
    const ogre = mon('ogre', 0, 40, 50)
    const friend = mon('ally', 4, 60, 70)
    expect(monsterSort(ogre, rat)).toBe(-1)
    expect(monsterSort(rat, friend)).toBe(-1)
    expect(monsterSort(rat, mon('rat', 0, 5, 10))).toBe(0)
    // named monsters (with a client id) never combine, and come before unnamed ones of the same kind
    expect(monsterSort(mon('rat', 0, 5, 10, { clientid: 1 }), mon('rat', 0, 5, 10, { clientid: 2 }))).toBe(-1)
    expect(monsterSort(rat, mon('rat', 0, 5, 10, { clientid: 1 }))).toBe(1)
  })

  it('groups equal monsters into one row and leaves out no-experience monsters', () => {
    const scene = sceneWith([
      { x: 1, y: 1, m: mon('jackal', 0, 8, 20) },
      { x: 2, y: 1, m: mon('jackal', 0, 8, 20) },
      { x: 3, y: 1, m: mon('ogre', 0, 40, 50) },
      { x: 4, y: 1, m: mon('plant', 0, 10, 60, { typedata: { avghp: 10, no_exp: true } }) },
      { x: 5, y: 1, m: mon('kraken tentacle', 0, 10, 61, { typedata: { avghp: 10, no_exp: true } }) },
      { x: 6, y: 1, m: mon('bat', 0, 3, 5), visible: false },
    ])
    const groups = monsterGroups(scene)
    expect(groups.map((g) => g.map((b) => b.name))).toEqual([['ogre'], ['kraken tentacle'], ['jackal', 'jackal']])
    expect(isExcludedFromList(mon('plant', 0, 1, 1, { typedata: { no_exp: true } }))).toBe(true)
    expect(isExcludedFromList(mon('active ballistomycete', 0, 1, 1, { typedata: { no_exp: true } }))).toBe(false)
  })
})

describe('itemTileName', () => {
  it('reads the tile the server sent back as words: the class, "of" its type, sprite-set suffixes dropped', () => {
    expect(itemTileName('WPN_DAGGER')).toBe('dagger')
    expect(itemTileName('WPN_DAGGER_MAGIC')).toBe('dagger')
    expect(itemTileName('WPN_DAGGER_RANDART')).toBe('dagger')
    expect(itemTileName('WPN_GREAT_MACE')).toBe('great mace')
    expect(itemTileName('ARM_ROBE_RANDART_1')).toBe('robe')
    expect(itemTileName('MI_ARROW_STEEL_MAGIC')).toBe('steel arrow')
    expect(itemTileName('MI_DART_POISONED')).toBe('poisoned dart')
    expect(itemTileName('MI_LARGE_ROCK0')).toBe('large rock')
    expect(itemTileName('MI_THROWING_NET3')).toBe('throwing net')
    expect(itemTileName('GOLD04')).toBe('gold')
    expect(itemTileName('FOOD_RATION_2')).toBe('ration')
    expect(itemTileName('MISC_LAMP_OF_FIRE_INERT')).toBe('lamp of fire')
    expect(itemTileName('CORPSE_BAT')).toBe('bat corpse')
    expect(itemTileName('GEM_ORC_1')).toBe('gem')
    expect(itemTileName('TALISMAN_SNAKE')).toBe('talisman')
    expect(itemTileName('STAFF_OFFSET_2')).toBe('staff')
    expect(itemTileName('WAND_FLAME')).toBe('wand of flame')
    expect(itemTileName('WAND_OFFSET_3')).toBe('wand')
    expect(itemTileName('SCR_IDENTIFY')).toBe('scroll of identify')
    expect(itemTileName('SCROLL')).toBe('scroll')
    expect(itemTileName('AMU_THE_GOURMAND')).toBe('amulet of the gourmand')
    expect(itemTileName('AMU_NORMAL_OFFSET_12')).toBe('amulet')
    expect(itemTileName('RING_RANDART_OFFSET_2')).toBe('ring')
    expect(itemTileName('RING_PROTECTION_FROM_FIRE')).toBe('ring of protection from fire')
    expect(itemTileName('POTION_OFFSET_5')).toBe('potion')
    expect(itemTileName('UNSEEN_POTION')).toBe('potion')
    expect(itemTileName('BOOK_17')).toBe('book')
    expect(itemTileName('PARCHMENT_SINGLE_FIRE_HIGH')).toBe('parchment')
    expect(itemTileName('ARM_LEATHER_ARMOUR')).toBe('leather armour')
    expect(itemTileName(undefined)).toBe('')
  })
  it('names every item tile in the fixture gamedata from its base', async () => {
    const gd = await fixtureGamedata()
    for (let id = gd.ranges.featMax; id < gd.ranges.mainMax; id++) {
      const n = gd.main.baseName(id)
      if (!n) continue
      const w = itemTileName(n)
      expect(w, n).toMatch(/^[a-z][a-z0-9 ]*$/)
    }
    expect(itemTileName(gd.main.baseName(gd.main.id('WPN_DAGGER_MAGIC')!))).toBe('dagger')
  })
})

describe('gate faces', () => {
  it('shows each side of a row of doors the gate piece a player standing there sees', async () => {
    const gd = await fixtureGamedata()
    const id = (n: string) => gd.dngn.id('DNGN_' + n)!
    const [left, mid, right] = [id('GATE_CLOSED_LEFT'), id('GATE_CLOSED_MIDDLE'), id('GATE_CLOSED_RIGHT')]
    // east–west: from the south as drawn, from the north the ends trade places
    expect(gateFaces(gd, 'DNGN_GATE_CLOSED_LEFT')).toEqual({ n: right })
    expect(gateFaces(gd, 'DNGN_GATE_CLOSED_MIDDLE')).toBeUndefined()
    expect(gateFaces(gd, 'DNGN_GATE_CLOSED_RIGHT')).toEqual({ n: left })
    // north–south: the top-down pieces become the upright ones on either side
    expect(gateFaces(gd, 'DNGN_VGATE_CLOSED_UP')).toEqual({ w: left, e: right })
    expect(gateFaces(gd, 'DNGN_VGATE_CLOSED_MIDDLE')).toEqual({ w: mid, e: mid })
    expect(gateFaces(gd, 'DNGN_VGATE_CLOSED_DOWN')).toEqual({ w: right, e: left })
    // every set keeps to its own art: runed, clear, crypt
    expect(gateFaces(gd, 'DNGN_VGATE_RUNED_CLEAR_UP')).toEqual({ w: id('GATE_RUNED_CLEAR_LEFT'), e: id('GATE_RUNED_CLEAR_RIGHT') })
    expect(gateFaces(gd, 'DNGN_VGATE_CLOSED_DOWN_CRYPT')).toEqual({ w: id('GATE_CLOSED_RIGHT_CRYPT'), e: id('GATE_CLOSED_LEFT_CRYPT') })
    expect(gateFaces(gd, 'DNGN_CLOSED_DOOR')).toBeUndefined()
  })
})
