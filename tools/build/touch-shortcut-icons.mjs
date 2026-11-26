#!/usr/bin/env node
/**
 * Packs the touch editor and command deck artwork from the bundled DCSS
 * atlases. Run node tools/build/touch-shortcut-icons.mjs after editing this
 * catalogue. Ordinary app builds use the checked-in PNG and index.
 */
import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { loadGamedata } from '../../packages/gamedata/src/index.ts'
import { glyphPath } from '../../apps/orbrun/src/touch-glyphs.ts'

const data = new URL('../../apps/orbrun/data/', import.meta.url)
const source = new URL('../public/menu/gamedata/0703b2fa62e821390161d95cf52f9da1183761d4/', data)
const commands = JSON.parse(await readFile(new URL('commands.json', data), 'utf8'))
const gd = await loadGamedata({
  base: 'fixture://menu', version: 'touch-icons', skipImages: true,
  io: { fetchText: url => readFile(new URL(url.split('/').at(-1), source), 'utf8') },
})

// A DCSS tile or an existing touch glyph (@), with an optional pixel badge.
// Corresponding actions keep the same base art across command modes.
const art = {
  gear: 'CMD_DISPLAY_INVENTORY',
  escape: 'PROMPT_NO',
  find: 'CMD_LOOKUP_HELP',
  'level-items': 'CMD_KNOWN_ITEMS +list',
  interact: 'PROMPT_YES',
  descend: 'DNGN_STONE_STAIRS_DOWN +down',
  spells: 'BOOK_12',
  abilities: 'CMD_USE_ABILITY',
  evocables: 'MISC_BOX_OF_BEASTS',
  quiver: 'MI_BOOMERANG',
  'no-hold': '@space',
  fallback: '@action',

  CMD_GO_UPSTAIRS: 'DNGN_STONE_STAIRS_UP',
  CMD_GO_DOWNSTAIRS: 'DNGN_STONE_STAIRS_DOWN',
  CMD_FIX_WAYPOINT: 'CMD_MAP_ADD_WAYPOINT',
  CMD_CLEAR_MAP: 'CMD_DISPLAY_MAP +cross',
  CMD_ANNOTATE_LEVEL: 'CMD_DISPLAY_MAP +pen',
  CMD_EXPLORE_MODE: 'CMD_EXPLORE +spark',
  CMD_AUTOFIRE: 'WPN_ARBALEST +target',
  CMD_PRIMARY_ATTACK: 'WPN_HALBERD',
  CMD_OPEN_DOOR: 'DNGN_OPEN_DOOR',
  CMD_CLOSE_DOOR: 'DNGN_CLOSED_DOOR',
  CMD_SHOUT: '@shout',
  CMD_REPEAT_CMD: '@swap +plus',
  CMD_PREV_CMD_AGAIN: '@swap',
  CMD_TOGGLE_AUTOPICKUP: 'CMD_DISPLAY_INVENTORY +swap',
  CMD_IGNORE_INVISIBLE: 'INVISIBILITY +cross',
  CMD_FULL_VIEW: 'MONS_GLASS_EYE',
  CMD_LOOK_AROUND: 'MONS_GLASS_EYE +target',
  CMD_PICKUP: 'GOLD03 +up',
  CMD_DROP_LAST: 'CMD_DROP +back',
  CMD_WIELD_WEAPON: 'WPN_LONG_SWORD',
  CMD_WEAPON_SWAP: 'WPN_DAGGER +swap',
  CMD_EQUIP: 'CMD_DISPLAY_INVENTORY +plus',
  CMD_UNEQUIP: 'CMD_DISPLAY_INVENTORY +minus',
  CMD_WEAR_ARMOUR: 'ARM_LEATHER_ARMOUR +plus',
  CMD_REMOVE_ARMOUR: 'ARM_LEATHER_ARMOUR +minus',
  CMD_WEAR_JEWELLERY: 'RING_PROTECTION +plus',
  CMD_REMOVE_JEWELLERY: 'RING_PROTECTION +minus',
  CMD_QUAFF: 'POTION_OFFSET_22',
  CMD_READ: 'UNSEEN_SCROLL',
  CMD_EVOKE: 'WAND_OFFSET',
  CMD_QUIVER_ITEM: 'MI_BOOMERANG +plus',
  CMD_CYCLE_QUIVER_FORWARD: 'MI_BOOMERANG +next',
  CMD_CYCLE_QUIVER_BACKWARD: 'MI_BOOMERANG +back',
  CMD_SWAP_QUIVER_RECENT: 'MI_BOOMERANG +swap',
  CMD_INSCRIBE_ITEM: 'UNSEEN_SCROLL +pen',
  CMD_ADJUST_INVENTORY: 'CMD_DISPLAY_INVENTORY +pen',
  CMD_LIST_ARMOUR: 'ARM_PLATE_ARMOUR +list',
  CMD_LIST_JEWELLERY: 'AMU_GUARDIAN_SPIRIT +list',
  CMD_LIST_GOLD: 'GOLD03',
  CMD_DISPLAY_KNOWN_OBJECTS: 'CMD_KNOWN_ITEMS',
  CMD_DISPLAY_RUNES: 'RUNE_VAULTS',
  CMD_INSPECT_FLOOR: 'DNGN_TRAP_PLATE +target',
  CMD_FIRE: 'WPN_SHORTBOW',
  CMD_FIRE_ITEM_NO_QUIVER: 'MI_JAVELIN',
  CMD_FORCE_CAST_SPELL: 'CMD_CAST_SPELL +spark',
  CMD_DISPLAY_SPELLS: 'BOOK_12 +list',
  CMD_EXPERIENCE_CHECK: 'BOOK_MANUAL',
  CMD_SHOW_TERRAIN: 'DNGN_STONE_STAIRS_DOWN +target',
  CMD_READ_MESSAGES: 'CMD_REPLAY_MESSAGES +list',
  CMD_MAKE_NOTE: '@inscribe',
  CMD_SAVE_GAME: 'CMD_SAVE_GAME_NOW +next',
  CMD_QUIT: 'PROMPT_NO +cross',
  CMD_MACRO_MENU: 'CMD_KEYBOARD',
  CMD_MACRO_ADD: 'CMD_KEYBOARD +plus',
  CMD_REDRAW_SCREEN: '@panes +swap',
  CMD_WIZARD: 'WAND_PARALYSIS +spark',

  CMD_MAP_HELP: 'CMD_DISPLAY_COMMANDS',
  CMD_MAP_EXIT_MAP: 'CMD_DISPLAY_MAP +next',
  CMD_MAP_FIND_STASH: 'CMD_SEARCH_STASHES +target',
  CMD_MAP_FIND_STASH_REVERSE: 'CMD_MAP_FIND_STASH +back',
  CMD_MAP_EXCLUDE_RADIUS: 'CMD_MAP_EXCLUDE_AREA +target',
  CMD_MAP_ANNOTATE_LEVEL: 'CMD_DISPLAY_MAP +pen',
  CMD_MAP_EXPLORE: 'CMD_EXPLORE +target',
  CMD_MAP_DESCRIBE: 'CMD_LOOKUP_HELP +target',
  CMD_MAP_TOGGLE_TITLE: 'CMD_DISPLAY_MAP +list',
  CMD_MAP_SCROLL_UP: 'CMD_DISPLAY_MAP +up',
  CMD_MAP_SCROLL_DOWN: 'CMD_DISPLAY_MAP +down',
  CMD_MAP_ZOOM_IN: '@zoom-in',
  CMD_MAP_ZOOM_OUT: '@zoom-out',
  CMD_MAP_CLEAR_MAP: 'CMD_DISPLAY_MAP +cross',
  CMD_MAP_FORGET: 'CMD_DISPLAY_MAP +minus',
  CMD_MAP_UNFORGET: 'CMD_DISPLAY_MAP +plus',

  CMD_TARGET_HELP: 'CMD_DISPLAY_COMMANDS',
  CMD_TARGET_CANCEL: 'PROMPT_NO',
  CMD_TARGET_SELECT: '@target',
  CMD_TARGET_SELECT_ENDPOINT: '@target +stop',
  CMD_TARGET_SELECT_FORCE: '@target +spark',
  CMD_TARGET_SELECT_FORCE_ENDPOINT: '@target +force-stop',
  CMD_TARGET_SELECT_ACTION: 'MI_BOOMERANG +target',
  CMD_TARGET_CYCLE_FORWARD: '@target +next',
  CMD_TARGET_CYCLE_BACK: '@target +back',
  CMD_TARGET_OBJ_CYCLE_FORWARD: 'CMD_KNOWN_ITEMS +next',
  CMD_TARGET_OBJ_CYCLE_BACK: 'CMD_KNOWN_ITEMS +back',
  CMD_TARGET_CYCLE_QUIVER_FORWARD: 'MI_BOOMERANG +next',
  CMD_TARGET_CYCLE_QUIVER_BACKWARD: 'MI_BOOMERANG +back',
  CMD_TARGET_DESCRIBE: 'CMD_LOOKUP_HELP +target',
  CMD_TARGET_FULL_DESCRIBE: 'CMD_LOOKUP_HELP +list',
  CMD_TARGET_TOGGLE_BEAM: 'MAGIC_DART +target',
  CMD_TARGET_CYCLE_BEAM: 'MAGIC_DART +swap',
  CMD_TARGET_EXCLUDE: 'CMD_MAP_EXCLUDE_AREA',
  CMD_TARGET_GET: 'GOLD03 +up',
  CMD_TARGET_FIND_YOU: 'CMD_MAP_FIND_YOU',
  CMD_TARGET_FIND_UPSTAIR: 'CMD_MAP_FIND_UPSTAIR',
  CMD_TARGET_FIND_DOWNSTAIR: 'CMD_MAP_FIND_DOWNSTAIR',
  CMD_TARGET_FIND_PORTAL: 'CMD_MAP_FIND_PORTAL',
  CMD_TARGET_FIND_TRAP: 'CMD_MAP_FIND_TRAP',
  CMD_TARGET_FIND_ALTAR: 'CMD_MAP_FIND_ALTAR',

  CMD_MENU_HELP: 'CMD_DISPLAY_COMMANDS',
  CMD_MENU_EXIT: 'PROMPT_NO',
  CMD_MENU_SELECT: 'PROMPT_YES',
  CMD_MENU_PAGE_UP: '@panes +up',
  CMD_MENU_PAGE_DOWN: '@panes +down',
  CMD_MENU_SCROLL_TO_TOP: '@sort +up',
  CMD_MENU_SCROLL_TO_END: '@sort +down',
  CMD_MENU_SEARCH: '@filter',
  CMD_MENU_CYCLE_MODE: '@panes +next',
  CMD_MENU_CYCLE_HEADERS: '@all',
  CMD_MENU_EXAMINE: 'CMD_LOOKUP_HELP +list',
  CMD_MENU_INVERT_SELECTION: '@toggle +swap',
  CMD_MENU_CLEAR_SELECTION: '@all +cross',
  CMD_MENU_TOGGLE_SELECTED: '@toggle',
}

const badges = {
  plus:       ['..#..', '..#..', '#####', '..#..', '..#..'],
  minus:      ['.....', '.....', '#####', '.....', '.....'],
  cross:      ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  pen:        ['....#', '...##', '..##.', '.##..', '##...'],
  up:         ['..#..', '.###.', '#####', '..#..', '..#..'],
  down:       ['..#..', '..#..', '#####', '.###.', '..#..'],
  next:       ['.#...', '..#..', '...#.', '..#..', '.#...'],
  back:       ['...#.', '..#..', '.#...', '..#..', '...#.'],
  spark:      ['..#..', '.##..', '#####', '..##.', '..#..'],
  target:     ['#...#', '.....', '..#..', '.....', '#...#'],
  swap:       ['...#.', '#####', '.....', '#####', '.#...'],
  list:       ['#.###', '.....', '#.###', '.....', '#.###'],
  stop:       ['#####', '#...#', '#...#', '#...#', '#####'],
  'force-stop': ['#####', '#.#.#', '#####', '#.#.#', '#####'],
}
const size = 26
const columns = 12
const paths = gd.atlasNames().map(name => [name, new URL(name + '.png', source)])
const atlases = Object.fromEntries(await Promise.all(paths.map(async ([name, url]) => [name, await readFile(url)])))
const rgba = { r: 0, g: 0, b: 0, alpha: 0 }

async function tile(name) {
  if (name.startsWith('@')) {
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><path fill="#d7c58b" d="${glyphPath(name.slice(1))}"/></svg>`
    return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer()
  }
  const id = ['gui', 'main', 'dngn', 'player', 'icons'].map(layer => gd[layer].id(name)).find(id => id !== undefined)
  const rect = gd.tile(id)
  if (!rect?.w || !rect.h) throw new Error('No tile for ' + name)
  // Crop the native command button frame. Centre item sprites in the same square.
  const framed = /^(CMD|PROMPT)_/.test(name)
  const left = Math.floor(framed ? rect.ox - 3 : (size - rect.w) / 2)
  const top = Math.floor(framed ? rect.oy - 3 : (size - rect.h) / 2)
  const x = Math.max(0, -left)
  const y = Math.max(0, -top)
  const width = Math.min(rect.w - x, size - Math.max(0, left))
  const height = Math.min(rect.h - y, size - Math.max(0, top))
  const pixels = await sharp(atlases[rect.atlas]).ensureAlpha()
    .extract({ left: rect.sx + x, top: rect.sy + y, width, height }).raw().toBuffer()
  const output = Buffer.alloc(size * size * 4)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const from = (row * width + col) * 4
      if (framed && !pixels[from] && !pixels[from + 1] && !pixels[from + 2]) continue
      const to = ((row + Math.max(0, top)) * size + col + Math.max(0, left)) * 4
      pixels.copy(output, to, from, from + 4)
    }
  }
  return output
}

function addBadge(pixels, id) {
  const pattern = badges[id]
  const ink = id === 'minus' || id === 'cross' ? [247, 133, 113, 255] : [247, 214, 133, 255]
  const backing = [38, 30, 24, 255]
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      if ((x === 0 || x === 6) && (y === 0 || y === 6)) continue
      const index = ((size - 7 + y) * size + size - 7 + x) * 4
      const mark = pattern[y - 1]?.[x - 1] === '#'
      pixels.set(mark ? ink : backing, index)
    }
  }
}

const specs = { ...art, ...Object.fromEntries(commands.map(({ id }) => [id, art[id] ?? id])) }
const pixels = new Map()
const icons = {}
const images = []
for (const [id, spec] of Object.entries(specs)) {
  const [name, badge] = spec.split(' +')
  if (!pixels.has(name)) pixels.set(name, await tile(name))
  const icon = Buffer.from(pixels.get(name))
  if (badge) addBadge(icon, badge)
  if (!icon.some((byte, i) => i % 4 === 3 && byte > 0)) throw new Error('Empty shortcut icon for ' + id)
  const previous = images.findIndex(image => image.input.equals(icon))
  if (previous !== -1) {
    icons[id] = previous
    continue
  }
  const index = icons[id] = images.length
  images.push({ input: icon, raw: { width: size, height: size, channels: 4 }, left: index % columns * size, top: Math.floor(index / columns) * size })
}
const rows = Math.ceil(images.length / columns)
await sharp({ create: { width: columns * size, height: rows * size, channels: 4, background: rgba } })
  .composite(images).png().toFile(new URL('touch-shortcut-icons.png', data).pathname)
await writeFile(new URL('touch-shortcut-icons.json', data), JSON.stringify({ columns, rows, icons }, null, 2) + '\n')
console.log(`${Object.keys(icons).length} actions, ${images.length} different icons`)
