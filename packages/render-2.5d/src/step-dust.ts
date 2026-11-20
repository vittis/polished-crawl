import { cellKey, liquidMaterial, type Scene } from '@orbrun/scene'
import { debrisRandom } from './elemental-spray.js'
import { project, type Projection } from './projection.js'
import type { Context2d } from './tiles.js'

interface Point { x: number; y: number }
interface Grain {
  x: number; y: number; vx: number; vy: number
  size: number; stretch: number; lift: number; life: number
}
interface Puff { origin: Point; born: number; grains: Grain[] }

const lifetime = 0.29
export const STEP_DUST_FADE_IN = 0.023
const groundAt = (scene: Scene, { x, y }: Point) => {
  const cell = scene.cells.get(cellKey(Math.round(x), Math.round(y)))
  return cell?.visibility === 'visible' && !cell.occluder && cell.kind !== 'unknown' && !liquidMaterial(cell)
}

/** A small push-off on dry ground, left behind in world space. */
export class StepDust {
  private puffs: Puff[] = []
  private sequence = 0

  kick(scene: Scene, from: Point, to: Point, foot: Point, born: number, strength: number) {
    const origin = { x: foot.x, y: foot.y + 0.27 }
    if (!groundAt(scene, from) || !groundAt(scene, to) || !groundAt(scene, origin)) return
    const dx = to.x - from.x, dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    const direction = { x: dx / length, y: dy / length }
    const random = debrisRandom(++this.sequence)
    const grains = Array.from({ length: 5 }, (_, i): Grain => {
      const side = (i - 2) * 0.3 + (random() - 0.5) * 0.24
      const back = 0.32 + random() * 0.52
      const fine = i >= 3
      const spread = (i - 2) * 0.052 + (random() - 0.5) * 0.09
      const offset = 0.045 + random() * 0.105
      return {
        x: -direction.x * offset - direction.y * spread,
        y: -direction.y * offset + direction.x * spread,
        vx: -direction.x * back - direction.y * side,
        vy: -direction.y * back + direction.x * side,
        size: (fine ? 0.030 + random() * 0.018 : 0.082 + random() * 0.038) * strength,
        stretch: 0.44 + random() * 0.22,
        lift: (fine ? 0.07 : 0.12) + random() * 0.09,
        life: lifetime * (0.74 + random() * 0.26),
      }
    })
    this.puffs = this.puffs.filter(puff => born - puff.born < lifetime)
    if (this.puffs.length >= 24) this.puffs.shift()
    this.puffs.push({ origin, born, grains })
  }

  retainVisibleGround(scene: Scene) {
    if (this.puffs.length) this.puffs = this.puffs.filter(puff => groundAt(scene, puff.origin))
  }

  draw(ctx: Context2d, p: Projection, scene: Scene, now: number): boolean {
    if (!this.puffs.length) return false
    this.puffs = this.puffs.filter(puff => now - puff.born < lifetime)
    let active = false
    for (const { origin, born, grains } of this.puffs) {
      const q = project(p, origin.x, origin.y)
      if (q.x < -p.scale || q.x > p.width + p.scale || q.y < -p.scale || q.y > p.height + p.scale) continue
      const age = now - born
      if (age <= 0) { active = true; continue }
      for (const grain of grains) {
        const t = age / grain.life
        if (t >= 1) continue
        const drift = age * (1 - t * 0.44)
        const x = origin.x + grain.x + grain.vx * drift
        const y = origin.y + grain.y + grain.vy * drift
        if (!groundAt(scene, { x, y })) continue
        active = true
        const lift = grain.lift * Math.sin(t * Math.PI * 0.75)
        const at = project(p, x, y, lift)
        const radius = grain.size * p.scale * (0.72 + t * 0.8)
        ctx.save()
        ctx.translate(at.x, at.y)
        ctx.scale(1, grain.stretch)
        ctx.globalAlpha = Math.min(1, age / STEP_DUST_FADE_IN) * (1 - t) ** 1.5
        const tint = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
        tint.addColorStop(0, 'rgba(214,194,163,0.67)')
        tint.addColorStop(0.45, 'rgba(183,163,138,0.44)')
        tint.addColorStop(1, 'rgba(161,142,122,0)')
        ctx.fillStyle = tint
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
        ctx.restore()
      }
    }
    return active
  }

  clear() { this.puffs = []; this.sequence = 0 }
}
