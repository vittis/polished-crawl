import { cellKey, lightReaches, type CellKey, type Scene, type SpellEffect } from '@orbrun/scene'
import type { DeathParticle } from './death.js'
import { debrisRandom, elementalPalettes, sprayElement } from './elemental-spray.js'

export interface WallSplat extends Pick<DeathParticle, 'angle' | 'alpha' | 'colour' | 'sprite' | 'size'> {
  surface: 'face' | 'cap'
  /** Position within the drawn surface, independent of camera and wall height. */
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

const faceEdges = [{ x: 0, y: 1 }]
const deathEdges = [...faceEdges, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }]

/** Scatter marks on reachable wall faces and catch lighter death spray on exposed cap edges. */
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
  const edges = death ? deathEdges : faceEdges
  const extent = radius + 0.5
  for (let y = Math.ceil(origin.y - extent); y <= origin.y + extent; y++) {
    for (let x = Math.ceil(origin.x - extent); x <= origin.x + extent; x++) {
      const key = cellKey(x, y), wall = scene.cells.get(key)
      if (wall?.visibility !== 'visible' || !wall.occluder || wall.kind === 'unknown') continue
      for (const edge of edges) {
        const across = (origin.x - x) * edge.x + (origin.y - y) * edge.y
        if (across <= 0.5) continue
        const floor = scene.cells.get(cellKey(x + edge.x, y + edge.y))
        if (floor?.visibility !== 'visible' || floor.occluder || floor.kind === 'unknown') continue
        const along = Math.max(-0.25, Math.min(0.25, edge.y ? origin.x - x : origin.y - y))
        const dx = x + (edge.y ? along : edge.x * 0.5) - origin.x
        const dy = y + (edge.x ? along : edge.y * 0.5) - origin.y
        const distance = Math.hypot(dx, dy)
        const forward = directionLength ? Math.max(0, (dx * direction.x + dy * direction.y) / (distance * directionLength)) : 1
        const coverage = outward + (1 - outward) * forward
        if (distance > radius * coverage || age < distance * 0.075 || !lightReaches(scene, origin, floor)) continue

        const face = edge.y === 1
        const edgeSeed = face ? 0 : edge.x + edge.y * 2
        const random = debrisRandom(spray.seed ^ key ^ edgeSeed)
        const marks = splats.get(key) ?? []
        const size = Math.min(death ? 0.55 : 0.34, (death ? 0.49 : 0.27) * amount * strength)
        for (let i = 0; i < (face && death ? 4 : 2); i++) {
          const spread = 0.5 + along + (random() - 0.5) * (face && death ? 0.68 : 0.42)
          const tangent = Math.max(0.05, Math.min(0.95, spread))
          const inset = face ? 0.18 + random() * 0.64 : 0.5 + (edge.x || edge.y) * (0.45 - random() * 0.06)
          marks.push({ surface: face ? 'face' : 'cap',
            x: edge.x ? inset : tangent, y: edge.x ? tangent : inset,
            angle: Math.floor(random() * 4) * Math.PI / 2,
            size: (face ? size : size * 0.48) * (i === 0 ? 1 : 0.28 + random() * 0.25),
            alpha: face ? alpha : alpha * 0.65,
            colour: element && i === 1 ? elementalPalettes[element][2] : palette[i % palette.length], sprite: 'splat' })
        }
        splats.set(key, marks)
      }
    }
  }
}
