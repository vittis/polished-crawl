import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, getSettings, saveSettings, type Settings } from '../src/settings'
import { dungeonOptions } from '../src/dungeon-options'

const key = 'orbrun.settings'
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('settings storage boundary', () => {
  it.each([
    [undefined, false], ['Auto', false], ['On', true], ['Off', false], [true, true], [false, false],
  ] as const)('loads saved lighting mode %s and drops the retired combat switch', (mode, enabled) => {
    store.set(key, JSON.stringify({ depthLighting: mode, depthLightAnimation: false, depthLightIntensity: 0.5, combatVisuals: 'Off' }))
    const settings = getSettings()
    expect(dungeonOptions(settings)).toMatchObject({ dynamicLighting: enabled, lightAnimation: false, lightIntensity: 0.5 })
    saveSettings(settings)
    expect(JSON.parse(store.get(key)!)).toEqual({ ...(enabled ? { depthLighting: true } : {}), depthLightAnimation: false, depthLightIntensity: 0.5 })
  })

  it('uses the new dungeon defaults while preserving explicit preferences', () => {
    expect(getSettings()).toMatchObject({ depthTilt: 35, depthZoom: 1, depthMovementDuration: 0.14, combatVfxVariation: 0.6 })
    const overrides = { depthTilt: 50, depthZoom: 1.2, depthMovementDuration: 0.1, combatVfxVariation: 0.25 }
    store.set(key, JSON.stringify(overrides))
    expect(getSettings()).toMatchObject(overrides)
    saveSettings(getSettings())
    expect(JSON.parse(store.get(key)!)).toEqual(overrides)
  })

  it('uses Alternate and Top for missing preferences and preserves stored WebTiles and Bottom choices', () => {
    const oldSettings = { depthZoom: 1.2 }
    store.set(key, JSON.stringify(oldSettings))
    expect(getSettings()).toMatchObject({ minibarStyle: 'alternate', minibarPosition: 'top', ...oldSettings })
    expect(store.get(key)).toBe(JSON.stringify(oldSettings))

    const chosen = { minibarStyle: 'default', minibarPosition: 'bottom' } as const
    saveSettings({ ...getSettings(), ...chosen })
    expect(getSettings()).toMatchObject(chosen)
    expect(JSON.parse(store.get(key)!)).toEqual({ ...oldSettings, ...chosen })
  })

  it.each(['{', 'null', '[]', '42', 'true', '"settings"'])('ignores malformed or non-object storage: %s', raw => {
    store.set(key, raw)
    expect(getSettings()).toEqual(defaultSettings)
    expect(store.get(key)).toBe(raw)
  })

  it('carries a saved width split into independently adjustable widths', () => {
    store.set(key, JSON.stringify({ touchMovementPercent: 45 }))
    const settings = getSettings()
    expect(settings).toMatchObject({ touchMovementWidth: 45, touchActionsWidth: 55 })
    saveSettings({ ...settings, touchActionsWidth: 57 })
    expect(JSON.parse(store.get(key)!)).toEqual({ touchMovementWidth: 45, touchActionsWidth: 57 })
  })

  it('handles unavailable storage and returns independent defaults', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('full') },
    })
    const settings = getSettings()
    settings.depthTilt = 65
    expect(getSettings()).toEqual(defaultSettings)
    expect(() => saveSettings(settings)).not.toThrow()
  })

  it('migrates only settings, preserves other storage bytes, and writes only supported overrides', () => {
    for (const name of ['accounts', 'account', 'tokens', 'games', 'servers', 'last', 'accountUsed', 'save', 'rc']) {
      store.set('orbrun.' + name, ' untouched bytes ' + name)
    }
    const unrelated = new Map(store)
    const raw = JSON.stringify({ renderer: '3d', combatPopups: false, fov: 100, viewmodel: true, keyHints: false, gamepadHints: 'contextual', depthTilt: 42, depthLosFade: true, depthLosSmoothing: false, uiScale: 1.12 })
    store.set(key, raw)
    const s = getSettings()
    expect(s.hints).toBe('contextual')
    expect(store.get(key)).toBe(raw)
    saveSettings(s)
    expect(JSON.parse(store.get(key)!)).toEqual({ depthTilt: 42, depthLosFade: true, uiScale: 1.12, hints: 'contextual' })
    for (const [name, bytes] of unrelated) expect(store.get(name)).toBe(bytes)
    expect(store.size).toBe(unrelated.size + 1)
    saveSettings({ ...defaultSettings })
    expect(store.get(key)).toBe('{}')
  })

  it.each([
    [{ hints: 'off', gamepadHints: 'contextual', keyHints: true }, 'off'],
    [{ hints: 'invalid', gamepadHints: 'contextual', keyHints: false }, 'contextual'],
    [{ gamepadHints: 'invalid', keyHints: false }, 'off'],
    [{ hints: 7, keyHints: true }, 'adaptive'],
  ])('retains hint migration precedence for %j', (saved, hints) => {
    store.set(key, JSON.stringify(saved))
    expect(getSettings().hints).toBe(hints)
  })

  it('persists independent hit and death gore levels without losing existing motion preferences', () => {
    saveSettings({ ...defaultSettings, hitGore: 0, deathGore: 1.25, deathSizeScaling: 0, meleeBumpStrength: 1.75, meleeBumpSnap: 0.5, hitSprayOutward: 0.25, deathSprayOutward: 0.75 })
    expect(getSettings()).toMatchObject({ hitGore: 0, deathGore: 1.25, deathSizeScaling: 0, meleeBumpStrength: 1.75, meleeBumpSnap: 0.5, hitSprayOutward: 0.25, deathSprayOutward: 0.75 })
    saveSettings({ ...getSettings(), hitGore: 2 })
    expect(getSettings()).toMatchObject({ hitGore: 2, deathGore: 1.25, deathSizeScaling: 0, meleeBumpSnap: 0.5, hitSprayOutward: 0.25, deathSprayOutward: 0.75 })
  })

  it.each([['Off', false], ['Viewport only', false], ['Frame only', true], ['Both', true]])('retains the outer border choice from %s', (legacy, border) => {
    store.set(key, JSON.stringify({ minimapOutline: legacy }))
    expect(getSettings().minimapOutline).toBe(border)
    saveSettings(getSettings())
    expect(getSettings().minimapOutline).toBe(border)
  })

  it('validates booleans and unions on both read and write', () => {
    const invalid = { depthMovement: 'false', confirmStairs: 1, depthMovementEasing: 'bounce', depthLighting: 'invalid', minibarStyle: 'flat', minibarPosition: 'middle' }
    store.set(key, JSON.stringify(invalid))
    expect(getSettings()).toEqual(defaultSettings)
    saveSettings({ ...defaultSettings, ...invalid } as unknown as Settings)
    expect(store.get(key)).toBe('{}')
    saveSettings({ ...defaultSettings, depthMovement: false, confirmStairs: true, depthMovementEasing: 'linear' })
    expect(getSettings()).toMatchObject({ depthMovement: false, confirmStairs: true, depthMovementEasing: 'linear' })
  })

  it('ignores retired preferences and preserves other saved values', () => {
    store.set(key, JSON.stringify({ depthAnimate: false, depthFog: true, depthAtmosphere: false, exploreDelay: 120, minimapTiles: 19, minimapCell: 12, depthZoom: 1.5 }))
    expect(getSettings()).toEqual({ ...defaultSettings, depthZoom: 1.5 })
    saveSettings(getSettings())
    expect(JSON.parse(store.get(key)!)).toEqual({ depthZoom: 1.5 })
  })
})

const numericKeys = ['combatVfxVariation', 'meleeBumpSpeed', 'hitSprayOutward', 'deathSprayOutward', 'hitSprayReach', 'deathSprayReach', 'deathEffectDuration', 'hitGore', 'deathGore', 'meleeBumpStrength', 'meleeBumpSnap', 'depthTilt', 'depthZoom', 'depthMovementDuration', 'depthMovementHopHeight', 'depthMovementSquash', 'depthMovementSway', 'uiScale', 'characterPanelScale', 'touchControlHeight', 'touchMovementWidth', 'touchActionsWidth', 'minimapBackgroundOpacity', 'messageLines'] as const
describe('numeric preference validation', () => {
  it.each(numericKeys)('rejects invalid %s values on read and write', name => {
    for (const value of [null, true, '12', {}, [], NaN, Infinity, -Infinity]) {
      store.set(key, JSON.stringify({ [name]: value }))
      expect(getSettings()[name]).toBe(defaultSettings[name])
      saveSettings({ ...defaultSettings, [name]: value } as Settings)
      expect(store.get(key)).toBe('{}')
    }
    // JSON permits exponents that overflow while parsing.
    store.set(key, `{"${name}":1e999}`)
    expect(getSettings()[name]).toBe(defaultSettings[name])
  })

  it.each([
    ['combatVfxVariation', -1, 0], ['combatVfxVariation', 3, 2],
    ['hitSprayOutward', -1, 0], ['hitSprayOutward', 2, 1], ['deathSprayOutward', -1, 0], ['deathSprayOutward', 2, 1],
    ['hitSprayReach', 0, 0.25], ['hitSprayReach', 5, 4], ['deathSprayReach', 0, 0.25], ['deathSprayReach', 5, 4],
    ['deathEffectDuration', 0, 0.25], ['deathEffectDuration', 5, 4],
    ['deathSizeScaling', -1, 0], ['deathSizeScaling', 2, 1],
    ['meleeBumpSpeed', 0, 0.25], ['meleeBumpSpeed', 99, 4],
    ['hitGore', -1, 0], ['hitGore', 99, 4], ['deathGore', -1, 0], ['deathGore', 99, 4],
    ['depthTilt', -10, 20], ['depthTilt', 100, 90],
    ['depthZoom', 0, 0.5], ['depthZoom', 4, 2],
    ['depthLightIntensity', 0, 0.1], ['depthLightIntensity', 3, 2],
    ['depthLosFadeDuration', 0, 0.04], ['depthLosFadeDuration', 1, 0.4],
    ['depthMovementDuration', 0, 0.04], ['depthMovementDuration', 1, 0.25],
    ['depthMovementHopHeight', -1, 0], ['depthMovementHopHeight', 3, 2],
    ['depthMovementSquash', -1, 0], ['depthMovementSquash', 3, 2],
    ['depthMovementSway', -1, 0], ['depthMovementSway', 3, 2],
    ['uiScale', 0, 0.85], ['uiScale', 9, 1.5],
    ['minimapBackgroundOpacity', -1, 0], ['minimapBackgroundOpacity', 2, 1],
    ['touchMovementWidth', -5, 0], ['touchMovementWidth', 120, 100], ['touchActionsWidth', 43.6, 44],
    ['touchControlHeight', 0, 1], ['touchControlHeight', 3, 2],
    ['characterPanelScale', 0, 0.6], ['characterPanelScale', 9, 1],
    ['messageLines', -2, 0], ['messageLines', 1, 2], ['messageLines', 99, 20], ['messageLines', 4.6, 5],
  ] as const)('normalizes %s=%s to %s consistently', (name, value, expected) => {
    store.set(key, JSON.stringify({ [name]: value }))
    expect(getSettings()[name]).toBe(expected)
    saveSettings({ ...defaultSettings, [name]: value })
    expect(getSettings()[name]).toBe(expected)
    expect(JSON.parse(store.get(key)!)[name] ?? defaultSettings[name]).toBe(expected)
  })

  it('preserves non-stop custom values and Auto semantics', () => {
    const custom = { ...defaultSettings, depthTilt: 42.5, depthZoom: 1.1, depthMovementDuration: 0.123, uiScale: 1.12, messageLines: 7 }
    saveSettings(custom)
    expect(getSettings()).toEqual(custom)
    saveSettings({ ...custom, messageLines: 0 })
    expect(getSettings()).toMatchObject({ messageLines: 0 })
  })
})
