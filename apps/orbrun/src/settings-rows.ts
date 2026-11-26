import { BUMP_SPEED, bumpTiming } from '@orbrun/scene'
import { BUMP_STRENGTH, BURST_VARIATION, PARTICLE_AMOUNT, PARTICLE_SCALE, VISIBILITY_FADE_DURATION } from '@orbrun/render-2.5d'
import { DUNGEON_ZOOM, DUNGEON_TILT } from '@orbrun/render-2.5d/projection'
import { defaultSettings, getSettings, saveSettings, type Settings } from './settings'
import { isPhone } from './grid/host'
import { LAYOUT_PRESETS } from './grid/layout'
import { MINIMAP_ALIGNMENTS, MINIMAP_SIZES } from './minimap'

/**
 * Polished Crawl's own settings, one row each: what it is called, which key it sets,
 * the values it cycles through (in the order left and right walk them) and
 * how a value reads. The same list draws the settings scroll on the front
 * end's map (lobby.ts) and the settings menu in a game (main.ts), so the two
 * never disagree.
 *
 * A row may depend on the other settings: its hint can read differently
 * under them and it can be off when a related setting disables it.
 * `rowHint` and `rowOff` resolve those; consumers redraw every row after any
 * change, since one row's change can move another's.
 */
/**
 * The groups the settings screen is laid out in, in order (the plan's "one
 * settings destination"), each with the line it prints under its tab: the
 * settings panel draws one group at a time, the way a game's options screen
 * has a tab per kind of setting, so no group is ever a scroll long.
 */
const SETTING_GROUPS = [
  ['View', 'Dungeon tilt, zoom, animation and movement.'],
  ['Combat', 'Body impact, blood and material bursts.'],
  ['Audio', 'Sound effects, volume and sound packs kept on this device.'],
  ['Controls', 'What the keys, the d-pad and the sticks do.'],
  ['Interface', 'What the HUD shows around the view, and how big it is.'],
] as const
export type SettingGroup = (typeof SETTING_GROUPS)[number][0]

export interface SettingRow<K extends keyof Settings = keyof Settings> {
  label: string
  group: SettingGroup
  section?: string
  /** the key this row sets */
  key: K
  values: readonly Settings[K][]
  fmt(v: Settings[K], settings?: Settings): string
  /** what the scroll says when the player stands on it (the front end's message line), or what it says under the current settings */
  hint: string | ((s: Settings) => string)
  /**
   * When the row does nothing under the current settings. Left and right
   * leave it alone and it is drawn dim, the way the game's menus draw an
   * item that cannot be taken; its value still reads, so the player sees
   * what it will be once it applies.
   */
  off?(s: Settings): boolean
  visible?(s: Settings): boolean
  /** Keep cycling through values with the arrows when the row has a slider. */
  wrap?: boolean
}

function row<K extends keyof Settings>(group: SettingGroup, label: string, key: SettingRow<K>['key'], values: readonly Settings[K][], hint: SettingRow<K>['hint'], fmt: SettingRow<K>['fmt'] = String, off?: (s: Settings) => boolean): SettingRow<K> {
  return { group, label, key, values, fmt, hint, off }
}

function sectionRow<K extends keyof Settings>(group: SettingGroup, section: string, label: string, key: K, values: readonly Settings[K][],
  hint: string, fmt: (v: Settings[K]) => string, off?: (s: Settings) => boolean): SettingRow<K> {
  return { ...row(group, label, key, values, hint, fmt, off), section }
}

function interfaceRow<K extends keyof Settings>(section: string, label: string, key: K, values: readonly Settings[K][],
  hint: SettingRow<K>['hint'], fmt: SettingRow<K>['fmt'], off?: (s: Settings) => boolean): SettingRow<K> {
  return { ...row('Interface', label, key, values, hint, fmt, off), section, wrap: true }
}

/** What the scroll says on `r` under `s`. */
export function rowHint(r: SettingRow, s: Settings = getSettings()): string {
  return typeof r.hint === 'function' ? r.hint(s) : r.hint
}

/** Whether `r` does nothing under `s`. */
export function rowOff(r: SettingRow, s: Settings = getSettings()): boolean {
  return r.visible?.(s) === false || (r.off?.(s) ?? false)
}

/**
 * The message pane's lines on Auto: MESSAGE_LINES_PHONE on a phone, whose
 * view has the fewest rows to give; elsewhere what the game's server asks
 * for (game.js `handle_set_layout`: the rc's `msg_webtiles_height`, else
 * crawl's own 6), as WebTiles shows it.
 */
const MESSAGE_LINES_PHONE = 4
const MESSAGE_LINES_CRAWL = 6
/** The message lines `s` asks for: its own, or Auto's for this device and the `server`'s layout. */
export function messageLinesOf(s: Settings, server: number, phone = s.layoutPreset === 'Auto' ? isPhone() : s.layoutPreset === 'Phone portrait' || s.layoutPreset === 'Phone landscape'): number {
  return s.messageLines || (phone ? MESSAGE_LINES_PHONE : server)
}
/** what the game's server last asked for (`setAutoMessageLines`), which the row's Auto reads off a phone */
let serverMessageLines = MESSAGE_LINES_CRAWL
export function setAutoMessageLines(n: number | null): void {
  serverMessageLines = n && n > 0 ? n : MESSAGE_LINES_CRAWL
}

/**
 * The message lines row's first stop and default: 4 lines on a phone, else
 * as many as the server's `layout` asks for (`messageLinesOf`). Saved as 0.
 */
export const MESSAGE_LINES_AUTO = 0
/**
 * Message lines, the message pane's rows of messages (the `--more--` row
 * is one more under them): Auto, then every count from 2 to MESSAGE_LINES_MAX. Unlike
 * `msg_webtiles_height`, a count under crawl's own window is taken too;
 * crawl still stops on a `--more--` by its window, and what scrolls off
 * before then is read back by scrolling the log. The view keeps its least
 * rows whatever the count (console.ts `gameSplit`).
 */
const MESSAGE_LINES_MIN = 2
export const MESSAGE_LINES_MAX = 20
export const MESSAGE_LINES: readonly number[] = [MESSAGE_LINES_AUTO, ...Array.from({ length: MESSAGE_LINES_MAX - MESSAGE_LINES_MIN + 1 }, (_, i) => MESSAGE_LINES_MIN + i)]

// Five percentage points per step; integer construction avoids floating drift.
const percentSteps = (min: number, max: number, step = 5) => Array.from({ length: (max - min) / step + 1 }, (_, i) => (min + i * step) / 100)
const durationSteps = ({ min, max }: { min: number; max: number }) => {
  const first = Math.round(min * 1000), last = Math.round(max * 1000)
  return Array.from({ length: (last - first) / 10 + 1 }, (_, i) => (first + i * 10) / 1000)
}
const milliseconds = (value: number) => Math.round(value * 1000) + ' ms'
const combatSteps = ({ min, max }: { min: number; max: number }) => percentSteps(min * 100, max * 100)
const deathDurationSteps = [...new Set([...combatSteps(PARTICLE_SCALE), defaultSettings.deathEffectDuration])].sort((a, b) => a - b)
// Steps above 2× are slightly wider so every stop has a distinct millisecond readout.
const combatSpeedSteps = [...percentSteps(BUMP_SPEED.min * 100, 200), ...percentSteps(210, BUMP_SPEED.max * 100, 10)]
  .map(speed => speed === 1.15 ? defaultSettings.meleeBumpSpeed : speed).reverse()
const percent = (value: number) => Math.round(value * 100) + '%'
const multiplier = (value: number) => Number(value.toFixed(2)) + '×'
const amount = (value: number) => value === 0 ? 'Off' : multiplier(value)
const sprayPattern = (value: number) => value === 0 ? 'Forward' : value === 1 ? 'All around' : percent(value) + ' around'
const sprayPatternHint = 'Forward sprays away from the attacker. All around is 360°.'

const widthSteps = Array.from({ length: 101 }, (_, i) => i)
const widthValue = (v: number) => v === 0 ? 'Auto' : v + '%'
export const TOUCH_SIZE_ROWS = [
  interfaceRow('Layout & scale', 'Movement width', 'touchMovementWidth', widthSteps,
    'Size the movement pad. In portrait the two width values divide the available button space proportionally.', widthValue),
  interfaceRow('Layout & scale', 'Actions width', 'touchActionsWidth', widthSteps,
    'Size the action buttons. In landscape each group grows independently while space permits.', widthValue),
  interfaceRow('Layout & scale', 'Touch control height', 'touchControlHeight', percentSteps(100, 200, 1),
    'Make the compass and action buttons taller. Short viewports limit their height to leave room for the dungeon.', percent),
] as const

/** Every row, whatever is offered; `SETTING_ROWS` is what the player sees. */
export const ALL_SETTING_ROWS: readonly SettingRow[] = [
  // View
  sectionRow('View', 'Camera & display', 'Dungeon tilt', 'depthTilt', Array.from({ length: (DUNGEON_TILT.max - DUNGEON_TILT.min) / 5 + 1 }, (_, i) => DUNGEON_TILT.min + i * 5), 'Lower angles show taller walls. Higher angles show more floor.', v => v + '°'),
  sectionRow('View', 'Camera & display', 'Dungeon zoom', 'depthZoom', Array.from({ length: (DUNGEON_ZOOM.max - DUNGEON_ZOOM.min) * 20 + 1 }, (_, i) => (DUNGEON_ZOOM.min * 100 + i * 5) / 100), 'Zoom in for larger tiles and a closer view of the dungeon.', percent),
  sectionRow('View', 'Camera & display', 'Corridor cutaways', 'depthCorridorCutaway', [true, false], 'Lower walls in narrow corridors.', v => v ? 'On' : 'Off'),
  sectionRow('View', 'Camera & display', 'FPS counter', 'depthShowFps', [false, true], 'Show frames per second in the dungeon.', v => v ? 'On' : 'Off'),
  sectionRow('View', 'World animation', 'Line of sight fade', 'depthLosFade', [true, false], 'Fade terrain as it enters or leaves sight.', v => v ? 'On' : 'Off'),
  {
    ...sectionRow('View', 'World animation', 'Line of sight fade time', 'depthLosFadeDuration', durationSteps(VISIBILITY_FADE_DURATION), 'Time for terrain to fade as it enters or leaves sight.', milliseconds),
    visible: s => s.depthLosFade,
  },
  sectionRow('View', 'World animation', 'Idle intensity', 'depthIdleIntensity', percentSteps(0, 200), 'How much creatures breathe, sway, or hover while idle.', v => v === 0 ? 'Off' : percent(v)),
  sectionRow('View', 'World animation', 'Foliage sway', 'depthFoliageSway', percentSteps(0, 200), 'How much trees and plants sway.', v => v === 0 ? 'Off' : percent(v)),
  sectionRow('View', 'World animation', 'Liquid motion', 'liquidMotion', percentSteps(0, 200), 'How strongly water, lava, and bogs ripple.', v => v === 0 ? 'Off' : percent(v)),
  sectionRow('View', 'Movement', 'Dungeon movement', 'depthMovement', [true, false], 'Animate travel with creature-specific hops, slithers and glides.', v => v ? 'Animated' : 'Instant'),
  sectionRow('View', 'Movement', 'Dungeon move duration', 'depthMovementDuration', durationSteps({ min: 0.04, max: 0.25 }), 'Time per move. Shorter values make travel feel snappier.', milliseconds, s => !s.depthMovement),
  sectionRow('View', 'Movement', 'Dungeon move easing', 'depthMovementEasing', ['ease-out', 'smooth', 'linear'], 'Snappy starts fast. Smooth eases in and out. Linear keeps a constant speed.', v => ({ 'ease-out': 'Snappy', smooth: 'Smooth', linear: 'Linear' })[v], s => !s.depthMovement),
  sectionRow('View', 'Movement', 'Move hop height', 'depthMovementHopHeight', percentSteps(0, 200), 'Height of steps and hops. Flying creatures keep their hover.', v => v === 0 ? 'Off' : percent(v), s => !s.depthMovement),
  sectionRow('View', 'Movement', 'Move squash', 'depthMovementSquash', percentSteps(0, 200), 'How much creatures squash and stretch as they move.', v => v === 0 ? 'Off' : percent(v), s => !s.depthMovement),
  sectionRow('View', 'Movement', 'Move sway', 'depthMovementSway', percentSteps(0, 200), 'How much creatures sway or lean as they move.', v => v === 0 ? 'Off' : percent(v), s => !s.depthMovement),
  sectionRow('View', 'Player cues', 'MORE icon', 'showMoreCue', [true, false], 'Show an exclamation mark above your character when the message log waits for confirmation.', v => v ? 'On' : 'Off'),
  sectionRow('View', 'Player cues', 'Level-up animation', 'showLevelUpAnimation', [true, false], 'Play an overhead celebration when your character gains an experience level.', v => v ? 'On' : 'Off'),
  // Combat
  sectionRow('Combat', 'Melee motion', 'Lunge & recoil strength', 'meleeBumpStrength', combatSteps(BUMP_STRENGTH), 'How much the attacker lunges and the target flinches.', amount),
  sectionRow('Combat', 'Melee motion', 'Melee motion time', 'meleeBumpSpeed', combatSpeedSteps, 'Time for the full lunge and recovery. Shorter feels faster.', v => Math.round(bumpTiming(v).duration * 1000) + ' ms', s => s.meleeBumpStrength === 0),
  sectionRow('Combat', 'Melee motion', 'Impact snap', 'meleeBumpSnap', percentSteps(0, 100), 'How sharply the target reacts. At 0% it eases in. At 100% it snaps into place and holds briefly.', percent, s => s.meleeBumpStrength === 0),
  sectionRow('Combat', 'Hit particles', 'Hit particle amount', 'hitGore', combatSteps(PARTICLE_AMOUNT), 'How much blood, debris, or elemental spray a hit produces.', amount),
  sectionRow('Combat', 'Hit particles', 'Hit spray pattern', 'hitSprayOutward', percentSteps(0, 100), sprayPatternHint, sprayPattern, s => s.hitGore === 0),
  sectionRow('Combat', 'Hit particles', 'Hit spray reach', 'hitSprayReach', combatSteps(PARTICLE_SCALE), 'How far particles travel from a hit.', multiplier, s => s.hitGore === 0),
  sectionRow('Combat', 'Death particles', 'Death particle amount', 'deathGore', combatSteps(PARTICLE_AMOUNT), 'How much debris and floor splatter a kill produces.', amount),
  sectionRow('Combat', 'Death particles', 'Death spray pattern', 'deathSprayOutward', percentSteps(0, 100), sprayPatternHint, sprayPattern, s => s.deathGore === 0),
  sectionRow('Combat', 'Death particles', 'Death spray reach', 'deathSprayReach', combatSteps(PARTICLE_SCALE), 'How far particles travel from a defeated creature.', multiplier, s => s.deathGore === 0),
  sectionRow('Combat', 'Death particles', 'Death debris lifetime', 'deathEffectDuration', deathDurationSteps, 'At 3 s each death effect uses its original lifetime. At 6 s all death debris lasts twice as long.', v => Number((3 * v).toFixed(2)) + ' s', s => s.deathGore === 0),
  sectionRow('Combat', 'Shared', 'Burst variation', 'combatVfxVariation', combatSteps(BURST_VARIATION), 'How much particle count, size, speed, and spread vary. Above 100%, extreme bursts become more common.', percent, s => s.hitGore === 0 && s.deathGore === 0),
  row('Audio', 'Sound effects', 'audioEnabled', [false, true], 'Enable sounds for confirmed game messages. Download OSP or import a pack below. Audio pauses in background tabs.', v => v ? 'On' : 'Off'),
  row('Audio', 'Master volume', 'masterVolume', percentSteps(0, 100), 'Overall audio volume. Zero mutes playback.', v => Math.round(v * 100) + '%'),
  row('Audio', 'Effects volume', 'effectsVolume', percentSteps(0, 100), 'Sound effect volume, relative to master volume.', v => Math.round(v * 100) + '%'),
  row('Audio', 'Effect playback', 'singleSoundChannel', [true, false], 'Single replaces the previous effect; Layered allows up to eight simultaneous effects.', v => v ? 'Single' : 'Layered'),
  // Controls
  row('Controls', 'Hints', 'hints', ['adaptive', 'contextual', 'off'], 'Gamepad prompts in the corner of the view for what is in front of you. Adaptive also teaches the controls until used, across all runs, on a gamepad or a touch screen. Contextual only skips the teaching. Off hides gameplay hints; menu and targeting controls remain.', (v) => ({ adaptive: 'Adaptive', contextual: 'Contextual only', off: 'Off' })[v]),
  // Interface
  interfaceRow('Layout & scale', 'Layout', 'layoutPreset', LAYOUT_PRESETS, s => ({
    Auto: 'Choose a layout from the current input device, screen and viewport.',
    'Phone portrait': 'Compact touch controls with stats below the dungeon and the minimap at the upper left.',
    'Phone landscape': 'Compact touch controls split across the sides, with stats and the minimap on the right.',
    'Tablet portrait': 'A stacked touch layout with larger HUD text and more room for the minimap.',
    'Tablet landscape': 'Split touch controls with larger HUD text and a wider sidebar for stats, monsters and chat.',
    Desktop: 'A keyboard and controller layout with the classic corner panels and no touch compass.',
  })[s.layoutPreset], String),
  interfaceRow('Layout & scale', 'UI scale', 'uiScale', [1, 1.15, 1.3, 1.5, 0.85], 'The size of the HUD, menus and messages.', percent),
  ...TOUCH_SIZE_ROWS,
  interfaceRow('Layout & scale', 'Hide Edit touch layout button', 'hideEditTouchLayout', [false, true], 'Hide the grid button that opens the touch layout editor during play.', v => v ? 'On' : 'Off'),
  interfaceRow('HUD', 'Action panel', 'showActionPanel', [true, false], 'Show the shortcut panel with the game menu, wands and other usable items.', v => v ? 'On' : 'Off'),
  interfaceRow('HUD', 'Character panel scale', 'characterPanelScale', [0.6, 0.7, 0.8, 0.9, 1], 'Shrink the corner stats panel, including its bars and portrait.', percent),
  interfaceRow('HUD', 'Character portrait', 'showCharacterPortrait', [false, true], 'Show your character sprite beside the stats in the corner.', v => v ? 'On' : 'Off'),
  interfaceRow('HUD', 'Nearby monsters', 'showNearbyMonsters', [true, false], 'Show nearby monsters. Click or tap a portrait to inspect it.', v => v ? 'On' : 'Off'),
  interfaceRow('Minimap', 'Minimap', 'showMinimap', [false, true], 'Show the explored level during play. Tap the minimap to open the full level map.', v => v ? 'On' : 'Off'),
  interfaceRow('Minimap', 'Minimap size', 'minimapSize', MINIMAP_SIZES, 'Resize the overview. Every size shows the whole explored level.', String, s => !s.showMinimap),
  interfaceRow('Minimap', 'Minimap alignment', 'minimapAlignment', MINIMAP_ALIGNMENTS, 'Align the minimap in desktop and touch landscape layouts. Touch portrait keeps it at the left edge.', String, s => !s.showMinimap),
  interfaceRow('Minimap', 'Minimap outer outline', 'minimapOutline', [false, true], 'Draw a border around the minimap. The viewport frame always marks the visible dungeon.', v => v ? 'On' : 'Off', s => !s.showMinimap),
  interfaceRow('Minimap', 'Minimap background opacity', 'minimapBackgroundOpacity', percentSteps(0, 100), 'Adjust the shading behind the minimap. Terrain and markers stay visible at every setting.', percent, s => !s.showMinimap),
  interfaceRow('Messages', 'Message lines', 'messageLines', MESSAGE_LINES, 'Choose the message log length. Auto uses 4 lines for phone layouts and the server setting (msg_webtiles_height) elsewhere. Short and touch layouts can fit fewer lines.',
    (v, s = getSettings()) => v === 0 ? `Auto (${messageLinesOf({ ...s, messageLines: 0 }, serverMessageLines)} lines)` : `${v} lines`),
]

/** The offered rows by group, in group order, each with its tab's line; groups with no row left out. */
export function settingGroups(rows: readonly SettingRow[] = SETTING_ROWS): { group: SettingGroup; hint: string; rows: SettingRow[] }[] {
  return SETTING_GROUPS.map(([group, hint]) => ({ group, hint, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length)
}

export const SETTING_ROWS: readonly SettingRow[] = ALL_SETTING_ROWS

/** How `r` reads right now. */
export function settingValue(r: SettingRow, s: Settings = getSettings()): string {
  return (r.fmt as (v: unknown, settings: Settings) => string)(s[r.key], s)
}

/**
 * Move `r` on by `d` steps (right is next, left is previous),
 * save, and apply what applies at once (the UI scale). Returns how the new
 * value reads; a running game applies the rest through `onchange`. A row
 * that is off under the current settings (`rowOff`) is left as it is. A
 * value that is not one of the stops (a default between two, an old saved
 * value) steps to the next stop in that direction (`offStop`).
 */
export function adjustSetting(r: SettingRow, d: number, onchange?: () => void): string {
  const s = getSettings()
  if (rowOff(r, s)) return settingValue(r, s)
  const key = r.key
  const values = r.values as readonly unknown[]
  const cur = s[key]
  const i = values.indexOf(cur)
  if (r.section && !r.wrap && typeof cur === 'number') {
    const stops = r.values as readonly number[]
    const ascending = stops[0] < stops[stops.length - 1]
    const next = stops.findIndex(v => ascending ? v > cur : v < cur)
    const above = next < 0 ? stops.length : next
    const index = i >= 0 ? i + d : above + d - (d > 0 ? 1 : 0)
    return chooseSetting(r, stops[Math.max(0, Math.min(stops.length - 1, index))], onchange)
  }
  const n = i >= 0 || typeof cur !== 'number' ? values[((((i < 0 ? 0 : i) + d) % values.length) + values.length) % values.length] : offStop(values as readonly number[], cur, d)
  return chooseSetting(r, n, onchange)
}

export function chooseSetting(r: SettingRow, value: unknown, onchange?: () => void): string {
  const s = getSettings()
  if (rowOff(r, s) || !(r.values as readonly unknown[]).includes(value)) return settingValue(r, s)
  writeSetting(r, s, value, onchange)
  return settingValue(r, s)
}

export function resetSetting(r: SettingRow, onchange?: () => void) {
  writeSetting(r, getSettings(), defaultSettings[r.key], onchange)
}

function writeSetting(r: SettingRow, s: Settings, value: unknown, onchange?: () => void) {
  if (s[r.key] === value) return
  ;(s as unknown as Record<string, unknown>)[r.key] = value
  saveSettings(s)
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale))
  onchange?.()
}

/** Whether every row `group` offers is at its default. */
export function groupAtDefaults(group: SettingGroup, s: Settings = getSettings()): boolean {
  return SETTING_ROWS.every((r) => r.group !== group || s[r.key] === defaultSettings[r.key])
}

/**
 * Put every row `group` offers back to its default, save, and apply what
 * applies at once (the UI scale), as `adjustSetting` does.
 */
export function resetGroup(group: SettingGroup, onchange?: () => void) {
  const s = getSettings()
  for (const r of SETTING_ROWS) if (r.group === group) (s as unknown as Record<string, unknown>)[r.key] = defaultSettings[r.key]
  saveSettings(s)
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale))
  onchange?.()
}

/**
 * The stop `d` steps from `cur`, which is not itself a stop. On an ascending
 * scale (the movement durations) one step right is the first stop above and one
 * step left the first stop below, so 0.62 goes to 0.65 or 0.6 and no stop is
 * skipped; on any other scale it is the nearest stop, then the step.
 */
function offStop(values: readonly number[], cur: number, d: number): number {
  const ascending = values.every((v, k) => k === 0 || v > values[k - 1])
  if (ascending) {
    const above = values.findIndex((v) => v > cur)
    const i = d > 0 ? (above < 0 ? values.length : above) + d - 1 : (above < 0 ? values.length : above) + d
    return values[Math.max(0, Math.min(values.length - 1, i))]
  }
  let i = 0
  for (let k = 1; k < values.length; k++) if (Math.abs(values[k] - cur) < Math.abs(values[i] - cur)) i = k
  return values[((((i + d) % values.length) + values.length) % values.length)]
}
