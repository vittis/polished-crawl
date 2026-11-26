import type { Render25dOptions } from '@orbrun/render-2.5d'
import type { Settings } from './settings'
import { isPhone } from './grid/host'

export function dynamicLightingEnabled(mode: Settings['depthLighting']): boolean {
  if (mode !== 'Auto') return mode === 'On'
  if (typeof window === 'undefined') return true
  const { hardwareConcurrency, deviceMemory } = window.navigator as Navigator & { deviceMemory?: number }
  // Capability hints may be absent. In that case the phone check still applies.
  return !isPhone() && !(hardwareConcurrency > 0 && hardwareConcurrency <= 4)
    && !(deviceMemory !== undefined && deviceMemory > 0 && deviceMemory <= 4)
}

export function combatVisualsEnabled(st: Settings, lighting = dynamicLightingEnabled(st.depthLighting)): boolean {
  return st.combatVisuals === 'Auto' ? lighting : st.combatVisuals === 'On'
}

/** Bound the phone dungeon's backing store to 2.25 times its CSS pixel area. */
export function phoneDungeonDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 1.5)
}

/** Shared appearance for gameplay and the recorded menu; owns no input, audio or storage. */
export function dungeonOptions(st: Settings): Render25dOptions {
  const dynamicLighting = dynamicLightingEnabled(st.depthLighting)
  return {
    tilt: st.depthTilt, zoom: st.depthZoom, animate: true,
    corridorCutaway: st.depthCorridorCutaway,
    dynamicLighting, lightIntensity: st.depthLightIntensity, lightAnimation: st.depthLightAnimation,
    combatVisuals: combatVisualsEnabled(st, dynamicLighting),
    visibilityFade: st.depthLosFade, visibilityFadeDuration: st.depthLosFadeDuration,
    meleeBumpStrength: st.meleeBumpStrength, meleeBumpSnap: st.meleeBumpSnap,
    hitGore: st.hitGore, deathGore: st.deathGore,
    hitSprayOutward: st.hitSprayOutward, deathSprayOutward: st.deathSprayOutward,
    hitSprayReach: st.hitSprayReach, deathSprayReach: st.deathSprayReach, deathEffectDuration: st.deathEffectDuration,
    combatVfxVariation: st.combatVfxVariation,
    idleIntensity: st.depthIdleIntensity, foliageSway: st.depthFoliageSway, liquidMotion: st.liquidMotion,
    movement: st.depthMovement, movementDuration: st.depthMovementDuration, movementEasing: st.depthMovementEasing,
    movementHopHeight: st.depthMovementHopHeight, movementSquash: st.depthMovementSquash, movementSway: st.depthMovementSway,
  }
}
