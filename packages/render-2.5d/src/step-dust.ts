import { cellKey, liquidMaterial, type Scene } from '@orbrun/scene'
import { debrisRandom } from './elemental-spray.js'
import { project, type Projection } from './projection.js'
import type { Context2d } from './tiles.js'

interface Point { x: number; y: number }
interface Grain {
  x: number; y: number; vx: number; vy: number
  size: number; stretch: number; lift: number; life: number
}
interface Trail {
  from: Point; to: Point; start: number; duration: number; strength: number
  position: (now: number) => Point
  isCurrent: () => boolean
}
interface Puff {
  origin: Point; momentum: Point; born: number; grains: Grain[]
  isCurrent: () => boolean
}

const lifetime = 0.22
const groundAt = (scene: Scene, { x, y }: Point) => {
  const cell = scene.cells.get(cellKey(Math.round(x), Math.round(y)))
  return cell?.visibility === 'visible' && !cell.occluder && cell.kind !== 'unknown' && !liquidMaterial(cell)
}

/** Hand off the moving foot's momentum to short-lived dust on dry ground. */
export class StepDust {
  private puffs: Puff[] = []
  private sequence = 0

  trail(scene: Scene, { from, to, start, duration, strength, position, isCurrent }: Trail) {
    if (!groundAt(scene, from) || !groundAt(scene, to)) return
    this.puffs = this.puffs.filter(puff => start - puff.born < lifetime)
    const dx = to.x - from.x, dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    const direction = { x: dx / length, y: dy / length }
    for (const phase of [0.18, 0.47, 0.78]) {
      const born = start + duration * phase
      const foot = position(born)
      const origin = { x: foot.x, y: foot.y + 0.32 }
      if (!groundAt(scene, origin)) continue
      // Each release draws from a short piece of the actual movement curve.
      // The last release forms beside the planted foot as the stride settles.
      const ahead = position(born + 0.030)
      const mx = ahead.x - foot.x, my = ahead.y - foot.y
      const carry = Math.min(1, 0.20 / Math.max(0.001, Math.hypot(mx, my)))
      const random = debrisRandom(++this.sequence)
      const grains = Array.from({ length: 3 }, (_, i): Grain => {
        const fine = i === 1
        const side = (i - 1) * 0.27 + (random() - 0.5) * 0.3
        const back = 0.24 + random() * 0.38
        const spread = (i - 1) * 0.075 + (random() - 0.5) * 0.08
        const offset = 0.055 + random() * 0.095
        return {
          x: -direction.x * offset - direction.y * spread,
          y: -direction.y * offset + direction.x * spread,
          vx: -direction.x * back - direction.y * side,
          vy: -direction.y * back + direction.x * side,
          size: (fine ? 0.025 + random() * 0.020 : 0.087 + random() * 0.038) * strength,
          stretch: 0.44 + random() * 0.22,
          lift: (fine ? 0.055 : 0.095) + random() * 0.07,
          life: lifetime * (0.72 + random() * 0.28),
        }
      })
      if (this.puffs.length >= 36) this.puffs.shift()
      this.puffs.push({ origin, momentum: { x: mx * carry, y: my * carry }, born, grains, isCurrent })
    }
  }

  observe(scene: Scene, now: number) {
    // A rapid turn can replace the path before its later puffs have launched.
    // Keep airborne dust on the old path and discard the unreleased puffs.
    if (this.puffs.length) this.puffs = this.puffs.filter(puff =>
      groundAt(scene, puff.origin) && (puff.born < now || puff.isCurrent()))
  }

  draw(ctx: Context2d, p: Projection, scene: Scene, now: number): boolean {
    if (!this.puffs.length) return false
    this.puffs = this.puffs.filter(puff => now - puff.born < lifetime)
    let active = false
    for (const { origin, momentum, born, grains } of this.puffs) {
      const q = project(p, origin.x, origin.y)
      if (q.x < -p.scale || q.x > p.width + p.scale || q.y < -p.scale || q.y > p.height + p.scale) continue
      const age = now - born
      if (age <= 0) { active = true; continue }
      const carry = 1 - Math.max(0, 1 - age / 0.06) ** 2
      for (const grain of grains) {
        const t = age / grain.life
        if (t >= 1) continue
        const drift = age * (1 - t * 0.44)
        const x = origin.x + momentum.x * carry + grain.x + grain.vx * drift
        const y = origin.y + momentum.y * carry + grain.y + grain.vy * drift
        if (!groundAt(scene, { x, y })) continue
        active = true
        const lift = grain.lift * Math.sin(t * Math.PI * 0.75)
        const at = project(p, x, y, lift)
        const radius = grain.size * p.scale * (0.72 + t * 0.8)
        ctx.save()
        ctx.translate(at.x, at.y)
        ctx.scale(1, grain.stretch)
        ctx.globalAlpha = Math.min(1, age / 0.018) * (1 - t) ** 1.5
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
