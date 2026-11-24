import { cellKey, lightReaches, type CellKey, type Scene, type SpellEffect } from '@orbrun/scene'
import type { DeathParticle } from './death.js'
import { debrisRandom, elementalPalettes, sprayElement } from './elemental-spray.js'

export interface WallSplat extends Pick<DeathParticle, 'angle' | 'alpha' | 'colour' | 'sprite' | 'size'> {
  /** Position within the drawn face, independent of camera and wall height. */
  x: number; y: number
}

export type WallSplats = Map<CellKey, WallSplat[]>

interface WallSpray {
  origin: { x: number; y: number }
  direction: { x: number; y: number }
  palette: readonly WallSplat['colour'][]
  tone: SpellEffect['kind']
  seed: number
  age: number
  duration: number
  fadeDuration: number
  gore: number
  outward: number
  reach: number
  strength: number
  death: boolean
}

/** Scatter a few marks on nearby exposed south faces using the burst's reach and direction. */
export function sampleWallSplats(scene: Scene, splats: WallSplats, spray: WallSpray) {
  const { origin, direction, palette, age, duration, fadeDuration, gore, outward, reach, strength, death } = spray
  if (gore <= 0 || age < 0 || age >= duration) return
  const source = scene.cells.get(cellKey(Math.round(origin.x), Math.round(origin.y)))
  if (source?.visibility !== 'visible' || source.occluder) return

  const radius = Math.min(2.5, (death ? 1.25 : 0.95) * reach * strength)
  const directionLength = Math.hypot(direction.x, direction.y)
  const amount = Math.sqrt(gore)
  const fade = Math.min(1, (duration - age) / fadeDuration)
  const alpha = fade * (death ? 0.98 : 0.76) * Math.min(1, amount * (death ? 1.4 : 1))
  const element = sprayElement(spray.tone)
  for (let y = Math.ceil(origin.y - radius - 0.5); y < origin.y - 0.5; y++) {
    for (let x = Math.ceil(origin.x - radius - 0.25); x <= origin.x + radius + 0.25; x++) {
      const key = cellKey(x, y), wall = scene.cells.get(key)
      if (wall?.visibility !== 'visible' || !wall.occluder || wall.kind === 'unknown') continue
      const front = scene.cells.get(cellKey(x, y + 1))
      if (front?.visibility !== 'visible' || front.occluder || front.kind === 'unknown') continue
      const dx = x + Math.max(-0.25, Math.min(0.25, origin.x - x)) - origin.x, dy = y + 0.5 - origin.y
      const distance = Math.hypot(dx, dy)
      const forward = directionLength ? Math.max(0, (dx * direction.x + dy * direction.y) / (distance * directionLength)) : 1
      const coverage = outward + (1 - outward) * forward
      if (distance > radius * coverage || !lightReaches(scene, origin, front)) continue

      if (age < distance * 0.075) continue
      const random = debrisRandom(spray.seed ^ key), marks = splats.get(key) ?? []
      const centre = 0.5 + origin.x + dx - x
      const size = Math.min(death ? 0.55 : 0.34, (death ? 0.49 : 0.27) * amount * strength)
      for (let i = 0; i < (death ? 4 : 2); i++) {
        marks.push({ x: Math.max(0.05, Math.min(0.95, centre + (random() - 0.5) * (death ? 0.68 : 0.42))),
          y: 0.18 + random() * 0.64, angle: Math.floor(random() * 4) * Math.PI / 2,
          size: i === 0 ? size : size * (0.28 + random() * 0.25), alpha,
          colour: element && i === 1 ? elementalPalettes[element][2] : palette[i % palette.length], sprite: 'splat' })
      }
      splats.set(key, marks)
    }
  }
}
