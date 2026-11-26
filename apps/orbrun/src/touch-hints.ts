import type { Context } from './context'
import type { HintMode } from './gamepad-hints'

const STORAGE_KEY = 'orbrun.touch-learning.v1'
const RESPONSE_WINDOW = 1500

/** Teach the minimap gesture once per device, after the server confirms it opened the map. */
export class TouchHints {
  private learnedMap = false
  private attemptedAt: number | null = null

  constructor() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      this.learnedMap = Array.isArray(saved) && saved.includes('map')
    } catch { /* unavailable or old/corrupt storage: teach normally */ }
  }

  reset() {
    this.learnedMap = false
    this.attemptedAt = null
    this.save()
  }

  private save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.learnedMap ? ['map'] : [])) } catch { /* session-only learning still works */ }
  }

  get waiting(): boolean { return this.attemptedAt !== null }

  attempt(mode: Context['mode'], now: number) {
    if (!this.learnedMap && mode !== 'levelmap') this.attemptedAt = now
  }

  observe(mode: Context['mode'], now: number) {
    if (this.attemptedAt === null) return
    if (now - this.attemptedAt > RESPONSE_WINDOW) { this.attemptedAt = null; return }
    if (mode !== 'levelmap') return
    this.learnedMap = true
    this.attemptedAt = null
    this.save()
  }

  shown(ctx: Context, mode: HintMode, overlayOpen: boolean): boolean {
    return !this.learnedMap && mode === 'adaptive' && ctx.mode === 'command' && !overlayOpen && ctx.hostilesInView === 0
  }
}

let shared: TouchHints | undefined
export function touchHints(): TouchHints { return shared ??= new TouchHints() }
