// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { bumpTiming } from '@orbrun/scene'
import { defaultSettings, getSettings, saveSettings } from '../src/settings'
import { settingsPanel } from '../src/settings-panel'
import { adjustSetting, ALL_SETTING_ROWS, groupAtDefaults, resetGroup, settingGroups, MESSAGE_LINES_AUTO, rowHint, rowOff, SETTING_ROWS, settingValue, messageLinesOf, setAutoMessageLines } from '../src/settings-rows'

// happy-dom's localStorage has no working methods; give settings.ts a plain one
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
})

/** Any row, offered or not; `SETTING_ROWS` is what the player sees. */
const row = (label: string) => ALL_SETTING_ROWS.find((r) => r.label === label)!

describe('what is written down', () => {
  beforeEach(() => store.clear())

  it('round-trips every offered setting value without normalization changing it', () => {
    for (const row of ALL_SETTING_ROWS) {
      for (const value of row.values) {
        saveSettings({ ...defaultSettings, [row.key]: value })
        expect(getSettings()[row.key], `${row.key}=${value}`).toBe(value)
      }
    }
  })

})

describe('Dungeon presentation', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it.each([
    ['Dungeon tilt', 'depthTilt', 35, 40, 30, 42.5, 45, 40],
    ['Dungeon zoom', 'depthZoom', 1, 1.05, 0.95, 1.12, 1.15, 1.1],
  ] as const)('adjusts %s in fine steps and preserves custom saved values until adjusted', (label, key, initial, next, previous, custom, above, below) => {
    const setting = row(label)
    const onchange = vi.fn()
    const panel = settingsPanel('View', { onchange })
    const control = panel.rows.find(r => r.dataset.focus === `setting:${label}`)!
    control.querySelector<HTMLElement>('.arrow:last-child')!.click()
    expect(getSettings()[key]).toBe(next)
    expect(control.querySelector('.val')!.textContent).toBe(settingValue(setting))
    expect(onchange).toHaveBeenCalledTimes(1)
    control.querySelector<HTMLElement>('.arrow:first-child')!.click()
    expect(getSettings()[key]).toBe(initial)
    control.dispatchEvent(new CustomEvent('adjust', { detail: -1 }))
    expect(getSettings()[key]).toBe(previous)
    for (const [direction, expected] of [[1, above], [-1, below]]) {
      saveSettings({ ...getSettings(), [key]: custom })
      expect(getSettings()[key]).toBe(custom)
      adjustSetting(setting, direction)
      expect(getSettings()[key]).toBe(expected)
    }
    resetGroup('View')
    expect(getSettings()[key]).toBe(initial)
  })

  it('persists movement options, gates gesture controls during instant movement, and resets the View defaults', () => {
    saveSettings({ ...defaultSettings })
    expect(settingValue(row('Dungeon move duration'))).toBe('140 ms')
    expect(settingValue(row('Dungeon move easing'))).toBe('Snappy')
    adjustSetting(row('Dungeon move duration'), 1)
    adjustSetting(row('Dungeon move easing'), 1)
    expect(getSettings()).toMatchObject({ depthMovementDuration: 0.15, depthMovementEasing: 'smooth' })
    const gestures = ['Move hop height', 'Move squash', 'Move sway']
    for (const label of gestures) adjustSetting(row(label), -1)
    expect(getSettings()).toMatchObject({ depthMovementHopHeight: 0.35, depthMovementSquash: 0.55, depthMovementSway: 0.95 })
    adjustSetting(row('Dungeon movement'), 1)
    expect(getSettings().depthMovement).toBe(false)
    expect(rowOff(row('Dungeon move duration'))).toBe(true)
    for (const label of gestures) expect(rowOff(row(label))).toBe(true)
    resetGroup('View')
    expect(getSettings()).toMatchObject({ depthMovement: true, depthMovementDuration: 0.14, depthMovementEasing: 'ease-out',
      depthMovementHopHeight: 0.4, depthMovementSquash: 0.6, depthMovementSway: 1 })
  })
})

describe('Hints', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is one row for gamepad and keyboard, adaptive by default, then contextual, then off', () => {
    const hints = row('Hints')
    expect(defaultSettings.hints).toBe('adaptive')
    expect(SETTING_ROWS).toContain(hints)
    expect(hints.group).toBe('Controls')
    expect(settingValue(hints)).toBe('Adaptive')
    expect(rowOff(hints)).toBe(false)
    expect(adjustSetting(hints, 1)).toBe('Contextual only')
    expect(getSettings().hints).toBe('contextual')
    expect(adjustSetting(hints, 1)).toBe('Off')
    expect(getSettings().hints).toBe('off')
    expect(adjustSetting(hints, 1)).toBe('Adaptive')
  })
})

describe('Minimap size', () => {
  it('cycles the full-level display sizes and remembers the selection', () => {
    saveSettings({ ...defaultSettings })
    const size = row('Minimap size')
    expect(settingValue(size)).toBe('Medium')
    expect(adjustSetting(size, 1)).toBe('Large')
    expect(adjustSetting(size, 1)).toBe('Small')
    expect(getSettings().minimapSize).toBe('Small')
  })
})

describe('Message lines', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is an Interface row, Auto by default (the server\'s layout), any other stop reading as lines', () => {
    const lines = row('Message lines')
    expect(SETTING_ROWS).toContain(lines)
    expect(lines.group).toBe('Interface')
    expect(defaultSettings.messageLines).toBe(MESSAGE_LINES_AUTO)
    expect(settingValue(lines)).toBe('Auto (6 lines)')
    saveSettings({ ...defaultSettings, messageLines: 4 })
    expect(settingValue(lines)).toBe('4 lines')
    expect(rowOff(lines)).toBe(false)
    expect(rowHint(lines)).toMatch(/msg_webtiles_height/)
  })

  it('right from Auto is the fewest lines, left the most; then a line a step', () => {
    const lines = row('Message lines')
    expect(adjustSetting(lines, 1)).toBe('2 lines')
    expect(adjustSetting(lines, -1)).toBe('Auto (6 lines)')
    expect(adjustSetting(lines, -1)).toBe('20 lines')
    saveSettings({ ...defaultSettings, messageLines: 6 })
    expect(adjustSetting(lines, 1)).toBe('7 lines')
    expect(adjustSetting(lines, -1)).toBe('6 lines')
    expect(adjustSetting(lines, -1)).toBe('5 lines')
    expect(getSettings().messageLines).toBe(5)
  })

  it('reads Auto with what the game\'s server asks for, and crawl\'s 6 again once the game is gone', () => {
    const lines = row('Message lines')
    setAutoMessageLines(9)
    expect(settingValue(lines)).toBe('Auto (9 lines)')
    setAutoMessageLines(null)
    expect(settingValue(lines)).toBe('Auto (6 lines)')
  })
})

describe('Responsive supporting views', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))
  afterEach(() => vi.unstubAllGlobals())

  /** a phone to grid/host.ts `isPhone`: a finger for a pointer, a short side under 600px */
  const phone = (held: 'upright' | 'sideways') => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }))
    vi.stubGlobal('screen', { width: 390, height: 844 })
    vi.stubGlobal('innerWidth', held === 'upright' ? 390 : 844)
    vi.stubGlobal('innerHeight', held === 'upright' ? 844 : 390)
  }

  it('Message lines on Auto is 4 on a phone, whatever the server asks; a chosen count anywhere', () => {
    expect(messageLinesOf(defaultSettings, 9, true)).toBe(4)
    expect(messageLinesOf(defaultSettings, 9, false)).toBe(9)
    expect(messageLinesOf({ ...defaultSettings, messageLines: 8 }, 9, true)).toBe(8)
    setAutoMessageLines(9)
    phone('sideways')
    expect(settingValue(row('Message lines'))).toBe('Auto (4 lines)')
    expect(settingValue(row('Message lines'), { ...defaultSettings, layoutPreset: 'Tablet landscape' })).toBe('Auto (9 lines)')
    setAutoMessageLines(null)
  })

  it('stores a centered minimap preference independently of orientation', () => {
    expect(settingValue(row('Minimap alignment'))).toBe('Center')
    phone('sideways')
    expect(settingValue(row('Minimap alignment'))).toBe('Center')
    phone('upright')
    expect(settingValue(row('Minimap'))).toBe('On')
    expect(settingValue(row('Minimap alignment'))).toBe('Center')
    expect(rowOff(row('Minimap'))).toBe(false)
    expect(rowOff(row('Minimap size'))).toBe(false)
    expect(adjustSetting(row('Minimap alignment'), 1)).toBe('Right')
    expect(getSettings().minimapAlignment).toBe('Right')
    expect(adjustSetting(row('Minimap'), 1)).toBe('Off')
    expect(getSettings().showMinimap).toBe(false)
    expect(rowOff(row('Minimap background opacity'))).toBe(true)
    adjustSetting(row('Minimap'), 1)
    expect(adjustSetting(row('Minimap background opacity'), 1)).toBe('5%')
  })
})

it('exposes every offered setting in exactly one group', () => {
  const keys = settingGroups().flatMap(group => group.rows.map(row => row.key))
  expect(keys.sort()).toEqual(SETTING_ROWS.map(row => row.key).sort())
})

describe('settings: reset a page to its defaults', () => {
  beforeEach(() => store.clear())

  it("puts back only the page's own settings, and leaves the rest as they were", () => {
    saveSettings({ ...defaultSettings, depthTilt: 45, depthZoom: 1.4, uiScale: 1.3, messageLines: 8 })
    expect(groupAtDefaults('View')).toBe(false)
    resetGroup('View')
    const s = getSettings()
    expect(s.depthTilt).toBe(defaultSettings.depthTilt)
    expect(s.depthZoom).toBe(defaultSettings.depthZoom)
    expect(groupAtDefaults('View')).toBe(true)
    expect(s.uiScale).toBe(1.3)
    expect(s.messageLines).toBe(8)
    resetGroup('Interface')
    expect(getSettings().uiScale).toBe(defaultSettings.uiScale)
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe(String(defaultSettings.uiScale))
  })

  it('offers reset on every group and enables it when a value differs from its default', () => {
    const onchange = () => void changes++
    let changes = 0
    for (const { group } of settingGroups()) {
      const panel = settingsPanel(group, { onchange, back: () => {} })
      const ids = panel.rows.map((r) => r.dataset.focus)
      const reset = panel.rows[ids.indexOf('settings-reset')]
      expect(reset.classList.contains('off')).toBe(true)
      reset.click()
      expect(changes).toBe(0)
    }
    saveSettings({ ...defaultSettings, hints: 'off' })
    const panel = settingsPanel('Controls', { onchange })
    const reset = panel.rows.find((r) => r.dataset.focus === 'settings-reset')!
    expect(reset.classList.contains('off')).toBe(false)
    reset.click()
    expect(getSettings().hints).toBe('adaptive')
    expect(changes).toBe(1)
    expect(reset.classList.contains('off')).toBe(true)
  })
})

describe('Dungeon-only settings migration', () => {
  beforeEach(() => store.clear())
  it('offers Dungeon settings immediately with no projection or first-person controls', () => {
    expect(getSettings()).toEqual(defaultSettings)
    for (const label of ['Projection', 'Hands', 'Field of view', 'Camera height', 'Camera angle', 'Nearby', 'Predictive movement', 'Keyboard left/right', 'Gamepad left/right', 'Swipe to turn', 'Look sensitivity', 'Invert look']) expect(SETTING_ROWS.some(r => r.label === label)).toBe(false)
    for (const label of ['Dungeon tilt', 'Dungeon zoom']) expect(rowOff(row(label))).toBe(false)
  })
})


describe('Hit bump preferences', () => {
  beforeEach(() => store.clear())
  it('persists bump tuning, honors bump strength, and resets only combat', () => {
    saveSettings({ ...defaultSettings, meleeBumpStrength: 1.5, meleeBumpSnap: 0.5, meleeBumpSpeed: 0.75, depthZoom: 1.2 })
    expect(getSettings()).toMatchObject({ meleeBumpStrength: 1.5, meleeBumpSnap: 0.5, meleeBumpSpeed: 0.75 })
    expect(rowOff(row('Impact snap'), { ...defaultSettings, meleeBumpStrength: 0 })).toBe(true)
    expect(rowOff(row('Melee motion time'), { ...defaultSettings, meleeBumpStrength: 0 })).toBe(true)
    resetGroup('Combat')
    expect(getSettings()).toMatchObject({ meleeBumpStrength: 1.75, meleeBumpSnap: 0.7, depthZoom: 1.2 })
    expect(bumpTiming(getSettings().meleeBumpSpeed).duration).toBeCloseTo(0.21, 12)
  })
  it('drops retired VFX settings without losing bump tuning or unrelated preferences', () => {
    store.set('orbrun.settings', JSON.stringify({ meleeEffects: false, meleeMotion: 0, meleeWeight: 1.5, meleeTrail: 0.4,
      meleeBumpStrength: 1.5, meleeBumpSnap: 0.5, depthZoom: 1.2 }))
    const s = getSettings()
    expect(s).toMatchObject({ meleeBumpStrength: 1.5, meleeBumpSnap: 0.5, depthZoom: 1.2 })
    expect(rowOff(row('Lunge & recoil strength'), s)).toBe(false)
    for (const key of ['meleeEffects', 'meleeMotion', 'meleeWeight', 'meleeTrail']) expect(s).not.toHaveProperty(key)
    saveSettings(s)
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({ meleeBumpStrength: 1.5, meleeBumpSnap: 0.5, depthZoom: 1.2 })
    expect(settingGroups().find(g => g.group === 'Combat')!.rows.map(r => r.key)).toEqual(expect.arrayContaining(['meleeBumpStrength', 'meleeBumpSnap', 'hitGore', 'deathGore']))
  })
  it('adjusts every combat value by five points in both directions and preserves intermediate saves', () => {
    for (const setting of ALL_SETTING_ROWS.filter(r => r.group === 'Combat')) {
      const higher = setting.key === 'meleeBumpSpeed' ? -1 : 1
      saveSettings({ ...defaultSettings, [setting.key]: 0.65 })
      adjustSetting(setting, higher)
      expect(getSettings()[setting.key], setting.key).toBe(0.7)
      adjustSetting(setting, -higher)
      expect(getSettings()[setting.key], setting.key).toBe(0.65)
      saveSettings({ ...defaultSettings, [setting.key]: 0.67 })
      adjustSetting(setting, -higher)
      expect(getSettings()[setting.key], setting.key).toBe(0.65)
      saveSettings({ ...defaultSettings, [setting.key]: 0.67 })
      adjustSetting(setting, higher)
      expect(getSettings()[setting.key], setting.key).toBe(0.7)
    }
  })
  it('resets one value even when its slider is disabled by another setting', () => {
    saveSettings({ ...defaultSettings, deathGore: 0, deathEffectDuration: 1.5, hitSprayReach: 2 })
    const onchange = vi.fn()
    const panel = settingsPanel('Combat', { onchange })
    const lifetime = panel.rows.find(r => r.dataset.focus === 'setting:Death debris lifetime')!
    const slider = lifetime.querySelector<HTMLInputElement>('input')!
    const reset = lifetime.querySelector<HTMLButtonElement>('.setting-reset')!
    expect(slider.disabled).toBe(true)
    reset.click()
    expect(getSettings()).toMatchObject({ deathGore: 0, deathEffectDuration: 4 / 3, hitSprayReach: 2 })
    expect(slider.getAttribute('aria-valuetext')).toBe('4 s')
    expect(reset.getAttribute('aria-disabled')).toBe('true')
    expect(onchange).toHaveBeenCalledTimes(1)
  })
  it('clamps malformed or out-of-range bump tuning', () => {
    store.set('orbrun.settings', JSON.stringify({ meleeBumpStrength: 99, meleeBumpSnap: -1 }))
    expect(getSettings()).toMatchObject({ meleeBumpStrength: 4, meleeBumpSnap: 0 })
  })
})
