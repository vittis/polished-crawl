// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TouchHints, touchHints } from '../src/touch-hints'
import type { Context } from '../src/context'
import { defaultSettings, getSettings, saveSettings } from '../src/settings'
import { settingsPanel } from '../src/settings-panel'

const ctx = (over: Partial<Context> = {}): Context => ({
  mode: 'command', layer: 'micro', ahead: { kind: 'none', label: '' }, under: { kind: 'none', label: '' }, hostilesInView: 0, ...over,
})
const shown = (h: TouchHints, c = ctx()) => h.shown(c, 'adaptive', false)

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    clear: () => store.clear(),
  })
  touchHints().reset()
})

describe('touch lessons', () => {
  it('remembers that the player opened the map by touch across runs', () => {
    const h = new TouchHints()
    expect(shown(h)).toBe(true)
    h.attempt('command', 20)
    h.observe('levelmap', 30)
    expect(shown(h)).toBe(false)
    expect(shown(new TouchHints())).toBe(false)
  })

  it('reads map progress from existing touch lesson records', () => {
    localStorage.setItem('orbrun.touch-learning.v1', JSON.stringify(['menu']))
    expect(shown(new TouchHints())).toBe(true)
    localStorage.setItem('orbrun.touch-learning.v1', JSON.stringify(['menu', 'map']))
    expect(shown(new TouchHints())).toBe(false)
  })

  it('learns only from what the tap opened', () => {
    const h = new TouchHints()
    h.attempt('command', 0)
    h.observe('menu', 10)
    expect(shown(h)).toBe(true)
    h.observe('levelmap', 5000)
    expect(shown(h)).toBe(true)
    expect(h.waiting).toBe(false)
  })

  it('stands only at quiet moments on Adaptive', () => {
    const h = new TouchHints()
    expect(shown(h, ctx({ hostilesInView: 1 }))).toBe(false)
    expect(shown(h, ctx({ mode: 'menu' }))).toBe(false)
    expect(h.shown(ctx(), 'adaptive', true)).toBe(false)
    expect(h.shown(ctx(), 'contextual', false)).toBe(false)
    expect(h.shown(ctx(), 'off', false)).toBe(false)
  })

  it('Replay tips restores the minimap tip', () => {
    const h = touchHints()
    h.attempt('command', 0)
    h.observe('levelmap', 10)
    saveSettings({ ...defaultSettings, hints: 'off' })
    settingsPanel('Controls', {}).el.querySelector<HTMLElement>('[data-focus="replay-gamepad-tips"]')!.click()
    expect(shown(h)).toBe(true)
    expect(getSettings().hints).toBe('adaptive')
  })
})
