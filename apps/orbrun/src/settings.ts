import { MINIMAP_ALIGNMENTS, MINIMAP_SIZES, type MinimapAlignment, type MinimapSize } from './minimap'
import { DUNGEON_ZOOM, DUNGEON_TILT } from '@orbrun/render-2.5d/projection'
import { BUMP_STRENGTH, BURST_VARIATION, LIGHT_INTENSITY, PARTICLE_AMOUNT, PARTICLE_SCALE, VISIBILITY_FADE_DURATION } from '@orbrun/render-2.5d'
import { BUMP_SPEED, DEFAULT_MINIBAR_APPEARANCE, bumpTiming, type MinibarPosition, type MinibarStyle } from '@orbrun/scene'
import { LAYOUT_PRESETS, type LayoutPreset } from './grid/layout'
import type { HintMode } from './gamepad-hints'

export interface Settings {
  audioEnabled: boolean
  masterVolume: number
  effectsVolume: number
  singleSoundChannel: boolean
  depthShowFps: boolean
  depthPerspective: boolean
  depthTilt: number
  depthZoom: number
  pinchToZoom: boolean
  depthCorridorCutaway: boolean
  depthLighting: boolean
  depthLightIntensity: number
  depthLightAnimation: boolean
  depthLosFade: boolean
  /** Seconds per terrain visibility transition. */
  depthLosFadeDuration: number
  depthIdleIntensity: number
  depthFoliageSway: number
  liquidMotion: number
  depthMovement: boolean
  /** Seconds per confirmed move in Dungeon. */
  depthMovementDuration: number
  depthMovementEasing: 'ease-out' | 'smooth' | 'linear'
  depthMovementHopHeight: number
  depthMovementSquash: number
  depthMovementSway: number
  minibarStyle: MinibarStyle
  minibarPosition: MinibarPosition
  showMoreCue: boolean
  showLevelUpAnimation: boolean
  meleeBumpStrength: number
  meleeBumpSpeed: number
  meleeBumpSnap: number
  hitGore: number
  deathGore: number
  hitSprayOutward: number
  hitSprayReach: number
  deathSprayOutward: number
  deathSprayReach: number
  deathEffectDuration: number
  combatVfxVariation: number
  uiScale: number
  layoutPreset: LayoutPreset
  swapTouchControls: boolean
  hideEditTouchLayout: boolean
  showActionPanel: boolean
  characterPanelScale: number
  touchMovementWidth: number
  touchActionsWidth: number
  touchControlHeight: number
  showCharacterPortrait: boolean
  showNearbyMonsters: boolean
  confirmStairs: boolean
  showMinimap: boolean
  minimapBackgroundOpacity: number
  minimapAlignment: MinimapAlignment
  minimapOutline: boolean
  minimapSize: MinimapSize
  messageLines: number
  hints: HintMode
  swipeToMove: boolean
  tapToMove: boolean
}

const HINT_MODES: readonly string[] = ['adaptive', 'contextual', 'off']

/**
 * What a saved settings object says about hints, in the one field or in the
 * two it used to be split into: `gamepadHints` (adaptive/contextual/off) and
 * `keyHints` (a boolean), merged 2026-09-09. An old pad mode carries over; a
 * keyboard opt-out alone was the older global opt-out and still means off.
 */
function hintsFrom(saved: Record<string, unknown>): HintMode {
  for (const v of [saved.hints, saved.gamepadHints]) if (typeof v === 'string' && HINT_MODES.includes(v)) return v as HintMode
  if (saved.keyHints === false) return 'off'
  return 'adaptive'
}

const SETTINGS_KEY = 'orbrun.settings'
export const defaultSettings: Settings = {
  audioEnabled: false,
  masterVolume: 0.7,
  effectsVolume: 1,
  singleSoundChannel: true,
  depthShowFps: false,
  depthPerspective: true,
  depthTilt: 35,
  depthZoom: 1,
  pinchToZoom: true,
  depthCorridorCutaway: true,
  depthLighting: false,
  depthLightIntensity: LIGHT_INTENSITY.default,
  depthLightAnimation: true,
  depthLosFade: false,
  depthLosFadeDuration: VISIBILITY_FADE_DURATION.default,
  depthIdleIntensity: 1,
  depthFoliageSway: 1,
  liquidMotion: 1,
  depthMovement: true,
  depthMovementDuration: 0.14,
  depthMovementEasing: 'ease-out',
  depthMovementHopHeight: 0.4,
  depthMovementSquash: 0.6,
  depthMovementSway: 1,
  ...DEFAULT_MINIBAR_APPEARANCE,
  showMoreCue: true,
  showLevelUpAnimation: true,
  meleeBumpStrength: 1.75,
  meleeBumpSpeed: bumpTiming().duration / 0.21,
  meleeBumpSnap: 0.7,
  hitGore: 1,
  deathGore: 0.5,
  hitSprayOutward: 1,
  hitSprayReach: 1,
  deathSprayOutward: 0.75,
  deathSprayReach: 1,
  deathEffectDuration: 4 / 3,
  combatVfxVariation: 0.6,
  uiScale: 1,
  layoutPreset: 'Auto',
  swapTouchControls: false,
  hideEditTouchLayout: false,
  showActionPanel: true,
  characterPanelScale: 1,
  touchMovementWidth: 0,
  touchActionsWidth: 0,
  touchControlHeight: 1,
  showCharacterPortrait: false,
  showNearbyMonsters: true,
  confirmStairs: false,
  showMinimap: true,
  minimapBackgroundOpacity: 0,
  minimapAlignment: 'Center',
  minimapOutline: false,
  minimapSize: 'Medium',
  messageLines: 0,
  hints: 'adaptive',
  swipeToMove: false,
  tapToMove: true,
}

/**
 * Supported preference domains match the settings UI, without snapping custom
 * values to its stops. Count and millisecond preferences use whole units.
 * Zero remains Auto for map/message sizes; -1 remains Instant for explore.
 * These bounds intentionally normalize unsupported values from older storage.
 */
type NumericSetting = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings]
const numericDomains: Record<NumericSetting, { min: number; max: number; integer?: boolean; auto?: boolean }> = {
  masterVolume: { min: 0, max: 1 },
  effectsVolume: { min: 0, max: 1 },
  depthTilt: DUNGEON_TILT,
  depthZoom: DUNGEON_ZOOM,
  depthLightIntensity: LIGHT_INTENSITY,
  depthLosFadeDuration: VISIBILITY_FADE_DURATION,
  depthMovementDuration: { min: 0.04, max: 0.25 },
  depthMovementHopHeight: { min: 0, max: 2 },
  depthMovementSquash: { min: 0, max: 2 },
  depthIdleIntensity: { min: 0, max: 2 },
  depthFoliageSway: { min: 0, max: 2 },
  liquidMotion: { min: 0, max: 2 },
  depthMovementSway: { min: 0, max: 2 },
  meleeBumpStrength: BUMP_STRENGTH,
  meleeBumpSpeed: BUMP_SPEED,
  meleeBumpSnap: { min: 0, max: 1 },
  hitGore: PARTICLE_AMOUNT,
  deathGore: PARTICLE_AMOUNT,
  hitSprayOutward: { min: 0, max: 1 },
  hitSprayReach: PARTICLE_SCALE,
  deathSprayOutward: { min: 0, max: 1 },
  deathSprayReach: PARTICLE_SCALE,
  deathEffectDuration: PARTICLE_SCALE,
  combatVfxVariation: BURST_VARIATION,
  uiScale: { min: 0.85, max: 1.5 },
  minimapBackgroundOpacity: { min: 0, max: 1 },
  characterPanelScale: { min: 0.6, max: 1 },
  touchMovementWidth: { min: 1, max: 100, integer: true, auto: true },
  touchActionsWidth: { min: 1, max: 100, integer: true, auto: true },
  touchControlHeight: { min: 1, max: 2 },
  messageLines: { min: 2, max: 20, integer: true, auto: true },
}

function normalizeSettings(value: unknown): Settings {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const s = { ...defaultSettings }
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    const value = saved[key]
    const fallback = defaultSettings[key]
    if (typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))) {
      (s as unknown as Record<string, unknown>)[key] = value
    }
  }
  if (!MINIMAP_SIZES.includes(s.minimapSize)) s.minimapSize = defaultSettings.minimapSize
  if (!LAYOUT_PRESETS.includes(s.layoutPreset)) s.layoutPreset = defaultSettings.layoutPreset
  if (!MINIMAP_ALIGNMENTS.includes(s.minimapAlignment)) s.minimapAlignment = defaultSettings.minimapAlignment
  // Preserve an explicit opt-in from the earlier three-way lighting control.
  if (saved.depthLighting === 'On') s.depthLighting = true
  // Older saves selected the outer frame and viewport rectangle together.
  if (typeof saved.minimapOutline === 'string') s.minimapOutline = saved.minimapOutline === 'Both' || saved.minimapOutline === 'Frame only'
  // Earlier versions stored a single movement share with an implicit complementary action share.
  const split = saved.touchMovementPercent
  if (saved.touchMovementWidth === undefined && saved.touchActionsWidth === undefined &&
      typeof split === 'number' && Number.isFinite(split) && split > 0) {
    s.touchMovementWidth = Math.max(30, Math.min(60, Math.round(split)))
    s.touchActionsWidth = 100 - s.touchMovementWidth
  }
  s.hints = hintsFrom(saved)
  for (const key of Object.keys(numericDomains) as NumericSetting[]) {
    const { min, max, integer, auto } = numericDomains[key]
    const value = s[key]
    s[key] = auto && value <= 0 ? 0 : Math.max(min, Math.min(max, integer ? Math.round(value) : value))
  }
  if (!['ease-out', 'smooth', 'linear'].includes(s.depthMovementEasing)) s.depthMovementEasing = defaultSettings.depthMovementEasing
  if (!['default', 'alternate'].includes(s.minibarStyle)) s.minibarStyle = defaultSettings.minibarStyle
  if (!['bottom', 'top'].includes(s.minibarPosition)) s.minibarPosition = defaultSettings.minibarPosition
  return s
}

/** Load supported preferences only; reading never changes stored data. */
export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return normalizeSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...defaultSettings }
  }
}

/** Persist normalized non-default preferences without touching accounts or saves. */
export function saveSettings(settings: Settings) {
  const s = normalizeSettings(settings)
  const out: Partial<Settings> = {}
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    if (s[key] !== defaultSettings[key]) (out as Record<string, unknown>)[key] = s[key]
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out))
  } catch {
    // Storage can be disabled or full; preferences remain best-effort.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('orbrun-settings'))
}
