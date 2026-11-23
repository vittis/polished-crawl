/** Local server-message fixture exercising real GameScreen renderer swaps and input. */
import '../src/styles.css'
import { GameScreen } from '../src/game'
import { Render25d } from '@orbrun/render-2.5d'
import { Render2d } from '@orbrun/render-2d'
import { browserIo, loadGamedata } from '@orbrun/gamedata'
import { initialState, reduce, MouseMode, UiState, type ClientMessage, type ServerMessage } from '@orbrun/webtiles'
import { GamepadInput, type PadEvent } from '../src/gamepad'
import type { MapRenderer, SceneCursor } from '@orbrun/scene'
import { defaultSettings, getSettings, saveSettings } from '../src/settings'
import { settingsPanel } from '../src/settings-panel'
import type { Session, SessionEvent } from '../src/session'
import { antechamberScene } from '../src/room/scene'
import { loadRoomTiles } from '../src/room/tiles'

const query = new URLSearchParams(location.search)
const withNearby = query.has('nearby-monsters')
const withActionPanel = query.has('action-panel')
const spectating = query.has('spectating')
const mobileHud = query.has('mobile-hud')
const withSpells = mobileHud && query.has('spells')
const gamedata = withActionPanel || withNearby || mobileHud || spectating
  ? await loadGamedata({ base: '/menu', version: '0703b2fa62e821390161d95cf52f9da1183761d4', io: browserIo() })
  : null
const roomData = mobileHud ? gamedata : null
const roomTiles = roomData ? null : await loadRoomTiles()
const tiles = roomData ?? roomTiles!
const { scene } = antechamberScene(roomData ? {
  id: name => roomData.dngn.id(name) ?? roomData.main.id(name) ?? roomData.player.id(name),
  tileCount: id => roomData.tileCount(id),
} : roomTiles!)
scene.playerOnLevel = true
scene.player = { x: 11, y: 5 }
const doll = roomData ? (withSpells ? ['BASE_HUMAN', 'BODY_ROBE_BLUE', 'HAND1_STAFF_MAGE'] : ['BASE_COGLIN', 'HAND1_LONG_SWORD_SLANT', 'HAND1_MIRROR_DAGGER']).flatMap(name => {
  const tile = roomData.player.id(name)
  return tile === undefined ? [] : [{ tile }]
}) : undefined
scene.billboards.push({ kind: 'player', x: 11, y: 5, tile: doll?.[0]?.tile ?? 4519, layers: doll, height: 0.7 })
const state = initialState()
state.phase = 'playing'; state.inputMode = MouseMode.COMMAND; state.uiState = UiState.NORMAL
if (spectating) reduce(state, { msg: 'watching_started', username: 'fixture-spectator' })
Object.assign(state.player, { received: true, name: 'Map lifecycle', species: 'Formicid', pos: scene.player, hp: 30, hp_max: 30, mp: 6, mp_max: 6, xl: 3, place: 'Dungeon', depth: 1 })
state.map.viewCenter = scene.player; state.map.playerOnLevel = true
const monsters = mobileHud ? [
  { x: 12, y: 3, mon: { id: 1, name: 'goblin', plural: 'goblins', att: 0 } },
  { x: 13, y: 5, mon: { id: 2, name: 'bat', plural: 'bats', att: 0 } },
] : (withNearby ? [11, 12] : [11]).map((x, i) => ({ x, y: 3, mon: { id: i + 1, name: 'goblin', plural: 'goblins', att: 0 } }))
reduce(state, { msg: 'map', cells: monsters })
for (const { x, y, mon } of monsters) {
  const tile = roomData?.player.id('MONS_' + mon.name.toUpperCase()) ?? (withNearby ? 7209 : 7189)
  scene.billboards.push({ kind: 'monster', name: mon.name, ref: mon, x, y, tile, height: 0.5 })
}
if (mobileHud) {
  document.getElementById('controls')!.hidden = true
  reduce(state, {
    msg: 'player', name: 'Mara', title: 'the Slasher', species: 'Coglin',
    hp: 23, hp_max: 28, real_hp_max: 28, poison_survival: 23, mp: 2, mp_max: 3,
    ac: 4, ev: 12, sh: 0, str: 14, int: 7, dex: 17, str_max: 14, int_max: 7, dex_max: 17,
    xl: 3, progress: 27, place: 'Dungeon', depth: 2, turn: 381,
    weapon_index: 0, offhand_weapon: true, offhand_index: 5,
    quiver_desc: 'Throw: <lightgreen>3 throwing nets</lightgreen>', quiver_item: 8,
    inv: {
      0: { name: '+0 long sword {Hideko}', quantity: 1 },
      5: { name: '+0 dagger {Yejun}', quantity: 1 },
      8: { name: 'throwing nets', quantity: 3, tile: gamedata!.main.id('MI_THROWING_NET') },
    },
  })
  reduce(state, { msg: 'msgs', messages: [
    { text: 'You climb downwards.' },
    { text: '<lightred>You encounter a goblin.</lightred>', turn: 380 },
    { text: 'The goblin shouts!', turn: 381 },
    { text: '<lightred>A bat comes into view.</lightred>', turn: 381 },
  ] })
  if (withSpells) reduce(state, {
    msg: 'player', title: 'the Magician', species: 'Human', mp: 5, mp_max: 8, ac: 2, int: 18,
    weapon_index: 0, offhand_weapon: false, quiver_item: -1, quiver_desc: 'Cast: <lightmagenta>Magic Dart</lightmagenta>',
    inv: { 0: { name: '+0 staff', quantity: 1 } },
  })
  state.player.received = false
}
if (withActionPanel) {
  reduce(state, { msg: 'options', options: { action_panel_show: false } })
  reduce(state, { msg: 'player', inv: { 0: { name: 'potion of curing', quantity: 2, action_panel_order: 0, action_verb: 'Quaff', tile: gamedata?.main.id('POTION_CURING') } } })
}
const listeners = new Set<(e: SessionEvent) => void>(), sent: unknown[] = []
const fixtureSession = { state, scene, gamedata: mobileHud ? null : gamedata, loading: mobileHud,
  get watching() { return state.phase === 'watching' || !!state.watching },
  playing: withSpells,
  hold: null as Session['hold'], intercept: null as Session['intercept'],
  server: { offline: false }, conn: {}, closed: false, diagnostics: [],
  on: (fn: (e: SessionEvent) => void) => { listeners.add(fn); return () => listeners.delete(fn) },
  flushScene: () => false,
  send: (msg: ClientMessage, own = false) => { if (own || !fixtureSession.hold?.(msg)) sent.push(msg) },
  deviceRc: () => null,
}
const session = fixtureSession as unknown as Session
let settings = { ...getSettings(), hints: 'off' as const }, active: MapRenderer, created = 0, destroyed = 0
let presentation = 'dungeon', cursor: SceneCursor | null = null
let appliedDungeonOptions: Parameters<Render25d['setOptions']>[0] | null = null
const gamepad = new GamepadInput()
const screen = new GameScreen(document.getElementById('app')!, session, {
  gamepad,
  settings: () => (settings = { ...getSettings(), hints: 'off' }), onSystem: () => {},
  settingsPanel: (group, back, controls) => settingsPanel(group, { back, controls, onchange: () => screen.applySettings() }),
  renderer: mode => {
    presentation = mode
    appliedDungeonOptions = null
    if (mode === 'flat-map') active = new Render2d()
    else {
      const options = {
        tilt: settings.depthTilt, zoom: settings.depthZoom,
        movement: settings.depthMovement, movementDuration: settings.depthMovementDuration, movementEasing: settings.depthMovementEasing,
        movementHopHeight: settings.depthMovementHopHeight, movementSquash: settings.depthMovementSquash, movementSway: settings.depthMovementSway,
      }
      const dungeon = new Render25d(options)
      appliedDungeonOptions = { ...options }
      const setOptions = dungeon.setOptions.bind(dungeon)
      dungeon.setOptions = options => {
        setOptions(options)
        appliedDungeonOptions = { ...appliedDungeonOptions, ...options }
      }
      active = dungeon
    }
    active.setTiles(tiles); created++
    const destroy = active.destroy.bind(active), setCursor = active.setCursor.bind(active)
    active.destroy = () => { destroyed++; destroy() }
    active.setCursor = c => { cursor = c; setCursor(c) }
    return active
  },
})
if (!mobileHud) (screen as unknown as { hideLoading(): void }).hideLoading()
const stopPad = gamepad.on(event => screen.pad(event))
const pollPad = mobileHud ? setInterval(() => {
  if (gamepad.virtualHeld) gamepad.poll(performance.now())
}, 16) : undefined
const send = (msg: ServerMessage) => {
  if (fixtureSession.intercept?.(msg)) return
  reduce(state, msg)
  for (const fn of listeners) fn({ type: 'state', msg })
}
const pad = (event: PadEvent) => screen.pad(event)
const snapshot = () => ({ sent: [...sent], presentation })
const ready = () => {
  fixtureSession.gamedata = gamedata
  fixtureSession.loading = false
  for (const fn of listeners) fn({ type: 'gamedata', status: 'ready' })
  send({ msg: 'player' })
}
const showSpellbook = () => {
  const spells = [
    ['Foxfire', 'FOXFIRE', 'Conjuration/Fire', '4%', 1],
    ['Magic Dart', 'MAGIC_DART', 'Conjuration', '3%', 1],
    ['Blink', 'BLINK', 'Translocation', '8%', 2],
    ['Flame Wave', 'FLAME_WAVE', 'Conjuration/Fire', '27%', 4],
    ['Fireball', 'FIREBALL', 'Conjuration/Fire', '40%', 5],
    ['Slow', 'SLOW', 'Hexes', '7%', 1],
    ['Summon Small Mammal', 'SUMMON_SMALL_MAMMAL', 'Summonings', '4%', 1],
    ['Iron Shot', 'IRON_SHOT', 'Conjuration/Earth', '80%', 6],
  ] as const
  send({ msg: 'input_mode', mode: MouseMode.NORMAL })
  send({ msg: 'menu', tag: 'spell', flags: 2, title: { text: 'Your spells (describe)' }, total_items: spells.length,
    items: spells.map(([name, art, schools, fail, level], i) => ({
      text: ` ${String.fromCharCode(97 + i)} - ${name.padEnd(32)}${schools.padEnd(26)}${fail.padEnd(9)}${level}`,
      hotkeys: [97 + i], quantity: 1, tiles: [{ t: gamedata?.gui.id(art), tex: 5 }],
    })),
  })
}
declare global { interface Window { __orbrunMapLifecycle: { receive: typeof send; pad: typeof pad; snapshot: typeof snapshot; ready: typeof ready; showSpellbook: typeof showSpellbook } } }
window.__orbrunMapLifecycle = { receive: send, pad, snapshot, ready, showSpellbook }
document.getElementById('map')!.onclick = () => {
  send({ msg: 'ui_state', state: UiState.VIEW_MAP })
  send({ msg: 'cursor', id: 2, loc: { x: 13, y: 7 } })
}
document.getElementById('overview')!.onclick = () => {
  ;(screen as unknown as { mapHold: { begin(now: number): void } }).mapHold.begin(performance.now())
  send({ msg: 'ui_state', state: UiState.NORMAL })
  send({ msg: 'ui-push', type: 'formatted-scroller', title: 'Dungeon overview', text: 'Dungeon:1\nStairs and branches' })
}
document.getElementById('close')!.onclick = () => {
  send({ msg: 'ui-pop' }); send({ msg: 'cursor', id: 2 }); send({ msg: 'cursor', id: 0 })
  send({ msg: 'input_mode', mode: MouseMode.COMMAND }); send({ msg: 'ui_state', state: UiState.NORMAL })
}
document.getElementById('target')!.onclick = () => {
  send({ msg: 'input_mode', mode: MouseMode.TARGET }); send({ msg: 'cursor', id: 0, loc: { x: 11, y: 3 } })
}
document.getElementById('settings')!.onclick = () => { saveSettings({ ...settings, depthTilt: settings.depthTilt === 65 ? defaultSettings.depthTilt : 65, depthZoom: settings.depthZoom === 1 ? 1.2 : 1 }); screen.applySettings() }
const timer = setInterval(() => { document.getElementById('result')!.textContent = JSON.stringify({ presentation, appliedDungeonOptions, renderer: active.constructor.name, cursor, created, destroyed, canvases: document.querySelectorAll('canvas.view').length, tilt: settings.depthTilt, zoom: settings.depthZoom, sent: sent.slice(-8) }) }, 100)
window.addEventListener('pagehide', () => { clearInterval(timer); clearInterval(pollPad); stopPad(); screen.destroy() }, { once: true })
