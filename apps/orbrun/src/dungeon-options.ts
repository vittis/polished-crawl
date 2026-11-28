import type { Render25dOptions } from '@orbrun/render-2.5d'
import type { Settings } from './settings'

/** Shared appearance for gameplay and the recorded menu; owns no input, audio or storage. */
export function dungeonOptions(st: Settings): Render25dOptions {
  return {
    tilt: st.depthPerspective ? st.depthTilt : null, zoom: st.depthZoom, animate: true,
    corridorCutaway: st.depthCorridorCutaway,
    dynamicLighting: st.depthLighting, lightIntensity: st.depthLightIntensity, lightAnimation: st.depthLightAnimation,
    visibilityFade: st.depthLosFade, visibilityFadeDuration: st.depthLosFadeDuration,
    meleeBumpStrength: st.meleeBumpStrength, meleeBumpSnap: st.meleeBumpSnap,
    hitGore: st.hitGore, deathGore: st.deathGore,
    hitSprayOutward: st.hitSprayOutward, deathSprayOutward: st.deathSprayOutward,
    hitSprayReach: st.hitSprayReach, deathSprayReach: st.deathSprayReach, deathEffectDuration: st.deathEffectDuration,
    combatVfxVariation: st.combatVfxVariation,
    idleIntensity: st.depthIdleIntensity, foliageSway: st.depthFoliageSway, liquidMotion: st.liquidMotion,
    movement: st.depthMovement, movementDuration: st.depthMovementDuration, movementEasing: st.depthMovementEasing,
    movementHopHeight: st.depthMovementHopHeight, movementSquash: st.depthMovementSquash, movementSway: st.depthMovementSway,
    minibarStyle: st.minibarStyle, minibarPosition: st.minibarPosition,
  }
}
