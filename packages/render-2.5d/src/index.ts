import {
  cellKey, combatActorId, dirFromDelta, emptyScene, minibarRects, DungeonLife, liquidMaterial, livingPose, type DeathEffect, type HitEffect,
  MINIBAR_CELL, MINIBAR_ROWS, type Billboard, type CellKey, type LivingPose, type MapRenderer,
  type Minibars, type MinibarStyle, type MinibarPosition,
  type Scene, type SceneCell, type SceneCursor, type TileSource, type CombatBump, type Emitter, type SpellEffect,
} from '@orbrun/scene'
import { DUNGEON_ZOOM, DUNGEON_TILT, fittedScale, groundDepth, planeRect, project, unproject, type Projection } from './projection.js'
import { drawTile, TileCache, type Context2d, type Layer, type SurfaceLighting } from './tiles.js'
import { DungeonLighting, glowCenter, LIGHT_INTENSITY, overlaps } from './lighting.js'
import { DungeonMovement, type MovementAppearance, type MovementEasing } from './movement.js'
import { DungeonEffects, type SpellBurst } from './effects.js'
import { drawSpellTrace, drawSpellBurst } from './effects-draw.js'
import { ImpactArt } from './impact-draw.js'
import { DeathArt } from './death-draw.js'
import { DungeonDeaths, type DeathParticle } from './death.js'
import { sampleHitSpray } from './hit-spray.js'
import { BUMP_STRENGTH, BURST_VARIATION, PARTICLE_AMOUNT, PARTICLE_SCALE } from './combat-options.js'
import { drawWallShadows, shadeWallFace, wallHeight, wallRoof } from './wall-depth.js'
import type { WallSplat, WallSplats } from './wall-splatter.js'
import { DungeonVisibility, MEMORY_DARKNESS, VISIBILITY_FADE_DURATION } from './visibility.js'

export { fittedScale, project, unproject } from './projection.js'
export { BUMP_STRENGTH, BURST_VARIATION, PARTICLE_AMOUNT, PARTICLE_SCALE } from './combat-options.js'
export { LIGHT_INTENSITY } from './lighting.js'
export { VISIBILITY_FADE_DURATION } from './visibility.js'
export type { MovementEasing } from './movement.js'

export interface Render25dOptions extends MovementAppearance {
  /** Camera elevation above the ground in degrees, or null for square top-down tiles. */
  tilt?: number | null
  /** 0.5–2; higher values trade coverage for detail. */
  zoom?: number
  /** Lower foreground walls in narrow corridors. Defaults to enabled. */
  corridorCutaway?: boolean
  /** Width available for fitting the default zoom. */
  fitWidth?: number | null
  /** Height available for fitting the default zoom. */
  fitHeight?: number | null
  /** Ground tiles to fit across the available space. Null uses the default framing. */
  fitSpan?: number | null
  /** Enable renderer animation. The menu pauses it while playback is suspended. */
  animate?: boolean
  /** Draw light cast by visible sources and their decorative sparks. */
  dynamicLighting?: boolean
  lightIntensity?: number
  /** Animate light flicker and sparks. Short-lived spell glows still fade. */
  lightAnimation?: boolean
  /** Amplitude of player and monster idle poses, from 0 to 2. */
  idleIntensity?: number
  /** Amplitude of tree and plant idle sway, from 0 to 2. */
  foliageSway?: number
  liquidMotion?: number
  /** Fade newly known and remembered terrain as confirmed visibility changes. */
  visibilityFade?: boolean
  /** Seconds per visibility fade, captured when the fade starts. */
  visibilityFadeDuration?: number
  /** Animate confirmed travel and creature gaits. */
  movement?: boolean
  /** Seconds per move, clamped to 0.04–0.25. Retargets never queue. */
  movementDuration?: number
  /** Monotone curves without overshoot, for readable grid movement. */
  movementEasing?: MovementEasing
  meleeBumpStrength?: number
  meleeBumpSnap?: number
  hitGore?: number
  deathGore?: number
  hitSprayOutward?: number
  deathSprayOutward?: number
  hitSprayReach?: number
  deathSprayReach?: number
  deathEffectDuration?: number
  combatVfxVariation?: number
  center?: { x: number; y: number } | null
  minibars?: Minibars | null
  minibarStyle?: MinibarStyle
  minibarPosition?: MinibarPosition
  filterScaling?: boolean
}

interface Hit { key: CellKey; left: number; top: number; right: number; bottom: number }
type Standing = { cell: SceneCell; billboard?: Billboard; burst?: SpellBurst; fade?: number; retiring?: boolean; death?: DeathParticle; depth: number; x: number; y: number; moving?: boolean; contactBlend?: number }

/**
 * A separate presentation of Scene, not a filter over another renderer.
 * Ground → contact shadows and footstep dust → depth-sorted walls/sprites → markers.
 * One projection owns both drawing and picking. No game/protocol dependencies.
 */
export class Render25d implements MapRenderer {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null
  private ctx: Context2d | null = null
  private scene = emptyScene()
  private revision = -1
  private lighting = new DungeonLighting()
  private life = new DungeonLife()
  private movement = new DungeonMovement()
  private effects = new DungeonEffects()
  private deaths = new DungeonDeaths()
  private deathFades: { actor: Billboard; from: number; until: number }[] = []
  private deathArt = new DeathArt()
  private impactArt = new ImpactArt()
  private claimedImpacts = new WeakSet<object>()
  private visibility = new DungeonVisibility()
  private frameTime = 0
  private cursor: SceneCursor | null = null
  private tiles = new TileCache()
  private width = 1
  private height = 1
  private dpr = 1
  private cells: SceneCell[] = []
  private standing: Standing[] = []
  private playerAnchor: { x: number; y: number } | null = null
  private hits: Hit[] = []
  private active = false
  private opts: Required<Render25dOptions> = {
    tilt: 50, zoom: 1, fitWidth: null, fitHeight: null, fitSpan: null, animate: true, center: null, minibars: null, filterScaling: false,
    minibarStyle: 'default', minibarPosition: 'bottom',
    corridorCutaway: true,
    dynamicLighting: true, lightIntensity: LIGHT_INTENSITY.default, lightAnimation: true,
    visibilityFade: false,
    visibilityFadeDuration: VISIBILITY_FADE_DURATION.default,
    meleeBumpStrength: 1.75, meleeBumpSnap: 0.7,
    hitGore: 1, deathGore: 0.5, hitSprayOutward: 1, deathSprayOutward: 0.75, combatVfxVariation: 0.25,
    hitSprayReach: 1, deathSprayReach: 1, deathEffectDuration: 1,
    idleIntensity: 1, foliageSway: 1, liquidMotion: 1, movement: true, movementDuration: 0.1, movementEasing: 'ease-out',
    movementHopHeight: 0.4, movementSquash: 0.6, movementSway: 1,
  }

  constructor(options: Render25dOptions = {}) { this.setOptions(options) }

  setOptions(options: Render25dOptions) {
    const { visibilityFade, dynamicLighting } = this.opts
    Object.assign(this.opts, options)
    if (visibilityFade !== this.opts.visibilityFade || dynamicLighting !== this.opts.dynamicLighting) this.lighting.clear()
    if (dynamicLighting !== this.opts.dynamicLighting) this.life.setLighting(this.opts.dynamicLighting)
    if (this.opts.tilt !== null) {
      this.opts.tilt = Number.isFinite(this.opts.tilt) ? Math.max(DUNGEON_TILT.min, Math.min(DUNGEON_TILT.max, this.opts.tilt)) : 50
    }
    this.opts.zoom = Number.isFinite(this.opts.zoom) ? Math.max(DUNGEON_ZOOM.min, Math.min(DUNGEON_ZOOM.max, this.opts.zoom)) : 1
    this.opts.movementDuration = Number.isFinite(this.opts.movementDuration) ? Math.max(0.04, Math.min(0.25, this.opts.movementDuration)) : 0.1
    if (!['ease-out', 'smooth', 'linear'].includes(this.opts.movementEasing)) this.opts.movementEasing = 'ease-out'
    for (const [key, fallback] of [['idleIntensity', 1], ['foliageSway', 1], ['liquidMotion', 1], ['movementHopHeight', 0.4], ['movementSquash', 0.6], ['movementSway', 1]] as const) {
      this.opts[key] = Number.isFinite(this.opts[key]) ? Math.max(0, Math.min(2, this.opts[key])) : fallback
    }
    for (const [key, fallback] of [['meleeBumpSnap', 0.7], ['hitSprayOutward', 1], ['deathSprayOutward', 0.75]] as const) {
      this.opts[key] = Number.isFinite(this.opts[key]) ? Math.max(0, Math.min(1, this.opts[key])) : fallback
    }
    for (const [key, { min, max }, fallback] of [
      ['lightIntensity', LIGHT_INTENSITY, LIGHT_INTENSITY.default],
      ['visibilityFadeDuration', VISIBILITY_FADE_DURATION, VISIBILITY_FADE_DURATION.default],
      ['meleeBumpStrength', BUMP_STRENGTH, 1.75],
      ['combatVfxVariation', BURST_VARIATION, 0.25],
      ['hitGore', PARTICLE_AMOUNT, 1], ['deathGore', PARTICLE_AMOUNT, 0.5],
      ['hitSprayReach', PARTICLE_SCALE, 1], ['deathSprayReach', PARTICLE_SCALE, 1], ['deathEffectDuration', PARTICLE_SCALE, 1],
    ] as const) {
      this.opts[key] = Number.isFinite(this.opts[key]) ? Math.max(min, Math.min(max, this.opts[key])) : fallback
    }
    if (this.opts.deathGore === 0) this.deaths.clear()
    if (!this.opts.animate || !this.opts.movement) this.movement.finish()
    if (!this.opts.animate || visibilityFade && !this.opts.visibilityFade) this.visibility.finish()
    if (!this.opts.animate) { this.effects.clear(); this.deaths.clear(); this.deathFades = [] }
  }

  get animating() { return this.opts.animate && this.active }
  get materialHitEffects() { return this.opts.animate }

  mount(target: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = target
    this.ctx = target.getContext('2d') as Context2d | null
    if (!this.ctx) throw new Error('The 2.5D renderer needs a Canvas 2D context')
  }

  setTiles(source: TileSource) {
    if (source === this.tiles.source) return
    this.tiles.source = source
    this.tiles.clear()
    this.visibility.clear()
  }

  setScene(scene: Scene, now = performance.now() / 1000) {
    if (scene === this.scene && scene.revision === this.revision) return
    if (scene.levelKey !== this.scene.levelKey || !scene.playerOnLevel) this.deathFades = []
    this.scene = scene
    this.revision = scene.revision
    this.visibility.observe(scene, now, this.opts.animate && this.opts.visibilityFade, this.opts.visibilityFadeDuration)
    this.life.observe({ ...scene, billboards: scene.billboards.filter(b => b.kind !== 'projectile') }, now)
    this.effects.observe(scene, now, this.opts.animate)
    this.deaths.observe(scene, this.opts.animate)
    // Never render effects or entities in unseen cells, even if a producer supplies them.
    this.cells = [...scene.cells.values()].filter(c => c.visibility !== 'unseen' && c.kind !== 'unknown')
    this.standing = []
    const cloudCells = new Set(scene.billboards.filter(b => b.kind === 'cloud').map(b => cellKey(b.x, b.y)))
    for (const cell of this.cells) {
      if (cell.occluder || this.upright(cell)) this.standing.push({ cell, x: cell.x, y: cell.y, depth: cell.y + (cell.occluder ? 0.5 : 0.25) })
      if (cell.cloud !== undefined && !cloudCells.has(cellKey(cell.x, cell.y))) this.standing.push({ cell, x: cell.x, y: cell.y, depth: cell.y + 0.4, billboard: { x: cell.x, y: cell.y, tile: cell.cloud, kind: 'cloud', height: 1, alpha: 0.7 } })
    }
    for (const billboard of scene.billboards) {
      const cell = scene.cells.get(cellKey(billboard.x, billboard.y))
      if (!cell || cell.visibility === 'unseen' || cell.kind === 'unknown') continue
      this.standing.push({ cell, billboard, x: billboard.x, y: billboard.y, depth: billboard.y + 0.3 + (billboard.kind === 'cloud' ? 0.1 : 0) })
    }
    this.standing.sort((a, b) => a.depth - b.depth || a.cell.x - b.cell.x)
    this.movement.observe({ ...scene, billboards: this.standing.flatMap(entry => entry.billboard && entry.billboard.kind !== 'cloud' && entry.billboard.kind !== 'projectile' ? [entry.billboard] : []) }, this.opts.center ?? scene.player, now, {
      enabled: this.opts.animate && this.opts.movement, duration: this.opts.movementDuration, easing: this.opts.movementEasing,
    })
  }

  setCursor(cursor: SceneCursor | null) { this.cursor = cursor }

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.dpr = dpr
    this.tiles.pixelRatio = dpr
    if (this.canvas) {
      this.canvas.width = Math.round(this.width * this.dpr)
      this.canvas.height = Math.round(this.height * this.dpr)
    }
  }

  /** Local right-button inspection leaves the server view centre and movement history intact. */
  inspectCenter: { x: number; y: number } | null = null

  viewportBounds() {
    const p = this.projection()
    const a = unproject(p, 0, 0)
    const b = unproject(p, p.width, p.height)
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  private projection(): Projection {
    const tilt = this.opts.tilt === null ? null : this.opts.tilt * Math.PI / 180
    // Server view centre also follows a targeting cursor outside the player's LOS.
    const target = this.opts.center ?? this.scene.player
    const center = this.inspectCenter ?? this.movement.center(target, this.frameTime)
    const scale = fittedScale(this.opts.fitWidth ?? this.width, this.opts.fitHeight ?? this.height, tilt, this.opts.zoom, this.opts.fitSpan ?? undefined)
    const p = { x: center.x, y: center.y, width: this.width, height: this.height, tilt, scale, corridorCutaway: this.opts.corridorCutaway }
    if (tilt === null && !this.opts.filterScaling) {
      const cellPixels = scale * this.dpr
      const fitSight = this.opts.fitSpan !== null && this.opts.zoom <= 1
      const round = fitSight ? Math.floor : Math.round
      // Whole atlas-pixel multiples preserve every texel. A view smaller
      // than the native resolution keeps its coverage with nearest-neighbour downsampling.
      p.scale = (cellPixels >= 32 ? 32 * round(cellPixels / 32) : Math.min(32, Math.max(1, round(cellPixels)))) / this.dpr
      // Snap the grid as one unit so artwork, terrain, and picking share its origin.
      const origin = project(p, -0.5, -0.5)
      p.x += (origin.x - this.snap(origin.x)) / p.scale
      p.y += (origin.y - this.snap(origin.y)) / p.scale
    }
    return p
  }

  private snap(value: number) { return Math.round(value * this.dpr) / this.dpr }

  private upright(cell: SceneCell) {
    return cell.featureTile !== undefined && (cell.stance === 'upright' || cell.freestanding || cell.feature?.type === 'door')
  }

  project(x: number, y: number, height = 0) {
    return project(this.projection(), x, y, height)
  }

  projectBillboard(billboard: Billboard, height = 0) {
    const pos = this.actorPosition(billboard, this.frameTime)
    return this.project(pos.x, pos.y, height)
  }

  /** The top of the posed player sprite, including any overhead minibars. */
  get playerSpriteAnchor() { return this.playerAnchor }

  private actorPosition(b: Billboard, now: number) {
    if (b.kind === 'cloud' || b.kind === 'projectile') return { x: b.x, y: b.y }
    const pos = this.movement.position(b, now), offset = this.opts.animate ? this.effects.offset(b, now, this.opts.meleeBumpStrength, this.opts.meleeBumpSnap) : { x: 0, y: 0 }
    return { x: pos.x + offset.x, y: pos.y + offset.y }
  }

  private inFrame(p: Projection, cell: { x: number; y: number }) {
    const q = project(p, cell.x, cell.y)
    return q.x > -p.scale * 2 && q.x < this.width + p.scale * 2 && q.y > -p.scale * 2 && q.y < this.height + p.scale * 2
  }

  private light() {
    // WebTiles draws visible atlas colours directly, without an exposure lift.
    return 1
  }

  private darkness(cell: SceneCell) { return this.visibility.darkness(cell, this.frameTime) }

  private lightExposure(cell: SceneCell) { return Math.max(0, 1 - this.darkness(cell) / MEMORY_DARKNESS) }

  private surfaceLighting(cell: SceneCell): SurfaceLighting | undefined {
    if (!this.lighting.active) return undefined
    const exposure = this.lightExposure(cell)
    if (exposure <= 0) return undefined
    if (exposure === 1) return this.lighting
    return { draw: (ctx, rect, mask, sample) => {
      ctx.save(); ctx.globalAlpha *= exposure
      this.lighting.draw(ctx, rect, mask, sample); ctx.restore()
    } }
  }

  private tile(ctx: Context2d, layers: Layer[], cell: SceneCell, x: number, y: number, size: number, world: { x: number; y: number }, rasterScale = 1) {
    return this.tiles.draw(ctx, layers, x, y, size, this.light(), this.darkness(cell), cell.flash, this.surfaceLighting(cell),
      { x: world.x - size, y: world.y - size, width: size * 3, height: size * 3 }, rasterScale)
  }

  private plane(ctx: Context2d, p: Projection, cell: SceneCell, layers: Layer[], z = 0, illuminate = true) {
    const rect = planeRect(p, cell.x, cell.y, z, this.dpr)
    // Uniform ambient light keeps the LOS boundary distinct from environmental glows.
    return this.tiles.drawPlane(ctx, layers, rect, this.light(), this.darkness(cell), cell.flash, illuminate ? this.surfaceLighting(cell) : undefined,
      rect)
  }

  impact(x: number, y: number, strength: number, now: number, turn?: number) {
    if (!this.opts.animate || this.scene.cells.get(cellKey(x, y))?.visibility !== 'visible') return
    this.effects.spell(this.scene, { x, y, turn, kind: 'physical', intensity: strength < 0.45 ? 'light' : strength > 0.8 ? 'heavy' : 'solid' }, now, 'generic')
    this.active = true
  }

  bump(attack: CombatBump, now: number) {
    if (this.opts.animate && this.effects.bump(this.scene, attack, now)) this.active = true
  }

  hit(effect: HitEffect, now: number) {
    if (this.opts.animate && this.effects.hit(this.scene, effect, now)) this.active = true
  }

  spell(effect: SpellEffect, now: number) {
    if (this.opts.animate && this.effects.spell(this.scene, effect, now)) this.active = true
  }

  death(effect: DeathEffect, now: number, fade?: { actor: Billboard; from: number }) {
    if (!this.opts.animate) return
    const cell = this.scene.cells.get(cellKey(effect.x, effect.y))
    if (fade && fade.from < now && this.scene.playerOnLevel && cell?.visibility === 'visible' && !cell.occluder) {
      this.deathFades.push({ ...fade, until: now })
      this.deathFades = this.deathFades.slice(-12)
      this.active = true
    }
    this.effects.death(this.scene, effect, now)
    if (this.opts.deathGore > 0 && this.deaths.spawn(this.scene, effect, now)) this.active = true
  }

  render(now = performance.now() / 1000) {
    const { ctx, canvas } = this
    if (!ctx || !canvas) return
    const time = this.opts.animate ? now : 0
    this.frameTime = now
    this.playerAnchor = null
    this.tiles.beginFrame()
    const p = this.projection(), s = p.scale, sy = groundDepth(p.tilt)
    this.active = this.movement.cameraMoving(now)
    if (this.opts.animate) for (const ripple of this.life.ripples) {
      if (ripple.kind === 'water' || this.claimedImpacts.has(ripple)) continue
      this.claimedImpacts.add(ripple)
      this.effects.spell(this.scene, { x: ripple.x, y: ripple.y, kind: 'physical',
        intensity: ripple.strength < 0.45 ? 'light' : ripple.strength > 0.8 ? 'heavy' : 'solid' }, ripple.born, 'generic')
    }
    this.effects.tick(this.scene, now)
    if (this.effects.hits.active) this.active = true
    const wallSplats: WallSplats = new Map()
    const deathParticles = this.opts.animate ? this.deaths.sample(this.scene, now, this.opts.deathGore,
      this.opts.deathSprayOutward, this.opts.combatVfxVariation, this.opts.deathSprayReach, this.opts.deathEffectDuration, wallSplats) : []
    // Sort and cull at the drawn position, retaining confirmed cells for semantics and picking.
    const standing: Standing[] = this.standing.filter(entry => !this.opts.animate || entry.billboard?.kind !== 'projectile').map(entry => {
      if (!entry.billboard || entry.billboard.kind === 'cloud') return entry
      const pos = this.actorPosition(entry.billboard, now)
      return { ...entry, ...pos, depth: entry.depth + pos.y - entry.billboard.y, moving: this.movement.moving(entry.billboard, now) }
    })
    const overlays = this.opts.animate ? this.effects.spawns.overlays(this.scene, now) : []
    const projectiles = this.opts.animate ? this.effects.projectiles(now) : []
    const departures = this.opts.animate ? this.effects.spawns.departures(now) : []
    if (this.opts.animate) {
      this.deathFades = this.deathFades.filter(({ actor, until }) => {
        const cell = this.scene.cells.get(cellKey(actor.x, actor.y))
        return now < until && cell?.visibility === 'visible' && !cell.occluder
      })
      for (const { actor, from, until } of this.deathFades) {
        const { x, y } = actor
        if (this.scene.billboards.some(b => (b.kind === 'monster' || b.kind === 'player') && b.x === x && b.y === y && !b.lying)) continue
        const fade = 0.8 * (until - Math.max(now, from)) / (until - from)
        standing.push({ cell: this.scene.cells.get(cellKey(x, y))!, billboard: actor, x, y, depth: y + 0.3, fade, retiring: true })
        this.active = true
      }
      for (const billboard of overlays) {
        const cell = this.scene.cells.get(cellKey(billboard.x, billboard.y))!
        standing.push({ cell, billboard, x: billboard.x, y: billboard.y, depth: billboard.y + 0.3 })
      }
      for (const fade of departures) {
        const cell = this.scene.cells.get(cellKey(fade.x, fade.y))!
        if (!this.inFrame(p, fade) || cell.occluder) continue
        const billboard = fade.billboard ?? (fade.terrain && this.upright(fade.terrain) ? {
          x: fade.x, y: fade.y, tile: fade.terrain.featureTile!, kind: 'doll' as const, height: 1, scenery: true,
        } : undefined)
        if (billboard) standing.push({ cell, billboard, x: fade.x, y: fade.y, depth: fade.y + (billboard.kind === 'cloud' ? 0.4 : 0.3), fade: fade.alpha, retiring: true })
      }
      if (this.effects.spawns.effects.some(e => this.inFrame(p, e))) this.active = true
      for (const death of deathParticles) {
        if (death.ground) continue
        const cell = this.scene.cells.get(cellKey(Math.round(death.x), Math.round(death.y)))!
        standing.push({ cell, death, x: death.x, y: death.y, depth: death.y + 0.35 })
      }
      if (this.deaths.active) this.active = true
      for (const billboard of projectiles) {
        const actor = billboard.targetId && this.scene.billboards.find(b => combatActorId(b) === billboard.targetId)
        const target = actor ? this.actorPosition(actor, now) : billboard.destination
        const blend = billboard.targetId ? billboard.contactBlend : 0
        const position = { x: billboard.x + (target.x - billboard.destination.x) * blend,
          y: billboard.y + (target.y - billboard.destination.y) * blend }
        const cell = this.scene.cells.get(cellKey(Math.round(position.x), Math.round(position.y)))
        if (!cell || cell.visibility !== 'visible' || !this.inFrame(p, position)) continue
        // Contact draws over the recipient, using the same upright footprint.
        standing.push({ cell, billboard, ...position, contactBlend: blend, depth: position.y + (blend ? 0.64 : 0.3) })
        this.active = true
      }
      if (this.effects.bursts.some(b => now < b.born && this.inFrame(p, b))) this.active = true
      for (const burst of this.effects.visibleBursts(now)) {
        const cell = this.scene.cells.get(cellKey(burst.x, burst.y))
        const actor = burst.actorId && this.scene.billboards.find(b => combatActorId(b) === burst.actorId)
        const position = actor ? this.actorPosition(actor, now) : burst
        if (!cell || cell.occluder || !this.inFrame(p, position)) continue
        if (burst.spray) {
          for (const particle of sampleHitSpray(this.scene, burst, now, position, this.opts.hitGore,
            this.opts.hitSprayOutward, this.opts.combatVfxVariation, this.opts.hitSprayReach, wallSplats)) {
            if (particle.ground) deathParticles.push(particle)
            else {
              const cell = this.scene.cells.get(cellKey(Math.round(particle.x), Math.round(particle.y)))!
              // A short spray starts in front of the struck sprite, including
              // northward hits whose fragments still overlap its upright art.
              standing.push({ cell, death: particle, x: particle.x, y: particle.y,
                depth: Math.max(particle.y + 0.35, burst.spray.origin!.y + 0.65) })
            }
          }
        } else standing.push({ cell, burst, x: position.x, y: position.y, depth: position.y + 0.65 })
        this.active = true
      }
    }
    standing.sort((a, b) => a.depth - b.depth || a.x - b.x)
    this.life.tick(now)
    const { dynamicLighting, lightIntensity } = this.opts
    const animateLights = this.opts.animate && this.opts.lightAnimation
    const emitters = dynamicLighting ? this.life.emitters(now) : []
    if (dynamicLighting) {
      for (const shot of [...projectiles, ...overlays]) {
        for (const light of shot.life?.lights ?? []) emitters.push({ ...light, x: Math.round(shot.x), y: Math.round(shot.y) })
      }
      if (lightIntensity !== LIGHT_INTENSITY.default) {
        for (const [i, source] of emitters.entries()) emitters[i] = { ...source, power: source.power * lightIntensity }
      }
      this.lighting.build(this.scene, p, emitters, time, animateLights, this.tiles.source, b => this.actorPosition(b, now),
        cell => cell.visibility === 'visible' || this.visibility.moving(cell, now))
    }
    this.hits = []
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.imageSmoothingEnabled = this.opts.filterScaling
    const cells = this.cells.filter(c => this.inFrame(p, c))
    if (this.opts.animate && cells.some(c => this.visibility.moving(c, now))) this.active = true

    for (const cell of cells) {
      const rect = planeRect(p, cell.x, cell.y, 0, this.dpr)
      const q = { x: rect.x, y: rect.y }
      ctx.fillStyle = cell.flags.lava ? '#75351b' : cell.flags.water ? '#193c50' : '#353538'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      const layers: Layer[] = []
      const material = liquidMaterial(cell)
      if (material) {
        this.tiles.drawLiquidFloor(ctx, material, cell, rect, this.darkness(cell), time, this.dpr, this.opts.liquidMotion)
        if (this.opts.liquidMotion > 0) this.active = true
      } else if (p.tilt === null && cell.occluder) {
        layers.push({ tile: cell.wallTile ?? cell.featureTile ?? cell.floorTile })
        layers.push(...(cell.wallOverlays ?? []).map(tile => ({ tile })))
      } else layers.push({ tile: cell.floorTile })
      layers.push(...(cell.underlays ?? []).map(tile => ({ tile })))
      const fadingFeature = this.opts.animate && cell.visibility === 'visible' && !cell.occluder && !this.upright(cell)
        && cell.featureTile !== undefined && this.effects.spawns.terrainOpacity(cell, now) < 1
      if (fadingFeature) {
        this.plane(ctx, p, cell, layers, 0, false)
        layers.length = 0
        ctx.save(); ctx.globalAlpha = this.effects.spawns.terrainOpacity(cell, now)
        this.plane(ctx, p, cell, [{ tile: cell.featureTile! }], 0, false); ctx.restore()
      } else if (!cell.occluder && !this.upright(cell) && cell.featureTile !== undefined) layers.push({ tile: cell.featureTile })
      layers.push(...(cell.overlays ?? []).filter(tile => p.tilt === null || !cell.wallShadows?.includes(tile)).map(tile => ({ tile })))
      if (layers.length) this.plane(ctx, p, cell, layers, 0, false)
      if (!this.tiles.source) {
        ctx.fillStyle = '#d7d5c8'
        ctx.font = `${s * 0.65}px monospace`
        ctx.textAlign = 'center'
        ctx.fillText(cell.glyph ?? (cell.occluder ? '#' : '·'), q.x + s / 2, q.y + s * sy * 0.8)
      }
      if (this.darkness(cell) > 0) {
        if (!this.tiles.source) {
          ctx.fillStyle = `rgba(0,0,0,${this.darkness(cell)})`
          ctx.fillRect(q.x, q.y, s, s * sy)
        }
      }
      if (cell.flash && !this.tiles.source) {
        const f = cell.flash
        ctx.fillStyle = `rgba(${f.r},${f.g},${f.b},${f.a / 255})`
        ctx.fillRect(q.x, q.y, s, s * sy)
      }
    }

    for (const fade of departures) if (fade.terrain && !this.upright(fade.terrain) && fade.terrain.featureTile !== undefined && this.inFrame(p, fade)) {
      const cell = this.scene.cells.get(cellKey(fade.x, fade.y))!
      if (cell.occluder) continue
      ctx.save(); ctx.globalAlpha = fade.alpha
      this.plane(ctx, p, cell, [{ tile: fade.terrain.featureTile }], 0, false); ctx.restore()
    }

    const lightArea = this.lighting.active ? this.lighting.groundArea(p) : undefined
    if (lightArea) {
      ctx.save(); ctx.beginPath()
      for (const cell of cells) if (!cell.occluder && this.darkness(cell) === 0) {
        const rect = planeRect(p, cell.x, cell.y, 0, this.dpr)
        if (overlaps(rect, lightArea)) ctx.rect(rect.x, rect.y, rect.width, rect.height)
      }
      ctx.clip(); this.lighting.draw(ctx, lightArea); ctx.restore()
      for (const cell of cells) if (!cell.occluder) {
        const darkness = this.darkness(cell)
        if (darkness === 0 || darkness >= MEMORY_DARKNESS) continue
        const rect = planeRect(p, cell.x, cell.y, 0, this.dpr)
        this.surfaceLighting(cell)?.draw(ctx, rect)
      }
    }
    if (this.lighting.active && (animateLights || emitters.some(source => source.transient))) this.active = true
    // Traces stay on the floor, underneath silhouettes, badges and targeting.
    if (this.opts.animate) for (const trace of this.effects.traces) {
      if (!this.inFrame(p, trace.source)) continue
      const cell = this.scene.cells.get(cellKey(trace.source.x, trace.source.y))
      if (!cell || cell.occluder) continue
      const rect = planeRect(p, cell.x, cell.y, 0, this.dpr)
      ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y - s * 0.4, rect.width, rect.height + s * 0.4); ctx.clip()
      drawSpellTrace(ctx, p, trace, now, this.impactArt, this.dpr); ctx.restore()
      this.active = true
    }
    for (const death of deathParticles) if (death.ground && this.inFrame(p, death)) this.deathArt.draw(ctx, p, this.scene, death, this.dpr)
    drawWallShadows(ctx, p, this.scene, cells, this.dpr, cell => this.darkness(cell))

    // Shadows lie on the ground; no sprite's shadow is painted over another sprite.
    for (const entry of standing) {
      if (!this.inFrame(p, entry)) continue
      if (p.tilt === null || entry.death || entry.burst || entry.retiring || entry.cell.occluder) continue
      const kind = entry.billboard?.kind
      if (kind === 'player' || kind === 'projectile' || kind === 'cloud') continue
      const q = project(p, entry.x, entry.y + 0.28)
      ctx.save()
      if (this.opts.animate && entry.cell.visibility === 'visible') ctx.globalAlpha *= entry.billboard
        ? this.effects.spawns.entrance(entry.billboard, now) : this.effects.spawns.terrainOpacity(entry.cell, now)
      ctx.translate(q.x, q.y)
      const lift = this.opts.animate && entry.cell.visibility === 'visible' && entry.billboard ? this.movement.pose(entry.billboard, now, this.opts).y : 0
      const contact = 1 - Math.min(0.25, lift * 1.5)
      ctx.globalAlpha *= contact
      ctx.scale(contact, sy * 0.3 * contact)
      const radius = s * (kind === 'item' ? 0.3 : 0.43)
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
      shadow.addColorStop(0, 'rgba(0,0,0,0.28)')
      shadow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = shadow
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
      ctx.restore()
    }

    if (this.opts.animate && this.opts.movement && this.movement.dust.draw(ctx, p, this.scene, now)) this.active = true
    const wallMonsters: (Standing & { billboard: Billboard; elevation: number })[] = []
    for (const entry of standing) {
      if (!this.inFrame(p, entry)) continue
      if (entry.moving) this.active = true
      if (entry.death) {
        this.deathArt.draw(ctx, p, this.scene, entry.death, this.dpr)
      }
      else if (entry.burst) {
        ctx.save(); ctx.beginPath()
        for (let y = Math.round(entry.y) - 1; y <= Math.round(entry.y) + 1; y++) for (let x = Math.round(entry.x) - 1; x <= Math.round(entry.x) + 1; x++) {
          const cell = this.scene.cells.get(cellKey(x, y))
          if (cell?.visibility !== 'visible' || cell.occluder && (x !== entry.x || y !== entry.y)) continue
          const rect = planeRect(p, x, y, 0, this.dpr)
          ctx.rect(rect.x, rect.y - s * 1.1, rect.width, rect.height + s * 1.1)
        }
        ctx.clip()
        drawSpellBurst(ctx, p, entry.burst, now, this.impactArt, this.dpr, { ...entry.burst, x: entry.x, y: entry.y })
        ctx.restore()
      }
      else if (entry.billboard) {
        const { billboard, cell } = entry
        if (p.tilt !== null && cell.occluder && cell.visibility === 'visible' && billboard.kind === 'monster' && !billboard.scenery && !billboard.lying) {
          wallMonsters.push({ ...entry, billboard, elevation: wallHeight(this.scene, cell, p.tilt, p.corridorCutaway) })
        } else this.actor(ctx, p, cell, billboard, time, entry)
      }
      else if (entry.cell.occluder) this.wall(ctx, p, entry.cell, wallSplats.get(cellKey(entry.cell.x, entry.cell.y)))
      else this.actor(ctx, p, entry.cell, { x: entry.cell.x, y: entry.cell.y, tile: entry.cell.featureTile!, height: 1, kind: 'doll', scenery: true, life: entry.cell.life }, time)
    }
    // Keep confirmed monsters on their wall caps above the surrounding wall geometry.
    for (const entry of wallMonsters) this.actor(ctx, p, entry.cell, entry.billboard, time, entry)

    if (dynamicLighting) {
      // Stairs and crystals can have decorative motes without casting light.
      if (animateLights) for (const cell of cells) {
        if (cell.visibility === 'visible' && !cell.life?.lights?.length && ['crystal', 'up', 'down'].includes(cell.life?.motion ?? '')) {
          emitters.push({ x: cell.x, y: cell.y, colour: [198, 222, 255], radius: 1, power: 0 })
        }
      }
      this.emitterParticles(ctx, p, emitters, time, animateLights)
    }
    if (this.opts.animate && this.opts.meleeBumpStrength > 0 && this.effects.bumps.some(b =>
      this.inFrame(p, b.from) || this.inFrame(p, b.to))) this.active = true
    this.impactRipples(ctx, p, time)

    // Travel, exclusion and targeting information must remain readable over depth/effects.
    const pendingTrail = this.movement.pendingExploreTrail(now)
    const trailFrom = pendingTrail && cellKey(pendingTrail.from.x, pendingTrail.from.y)
    const trailTo = pendingTrail && cellKey(pendingTrail.to.x, pendingTrail.to.y)
    const trailDirection = pendingTrail && dirFromDelta(pendingTrail.to.x - pendingTrail.from.x, pendingTrail.to.y - pendingTrail.from.y)
    for (const cell of cells) {
      const q = project(p, cell.x - 0.5, cell.y - 0.5)
      const key = cellKey(cell.x, cell.y)
      const hiddenTrail = key === trailFrom && cell.trail?.to === trailDirection ? cell.trail?.toTile
        : key === trailTo && cell.trail?.from === trailDirection ? cell.trail?.fromTile : undefined
      for (const tile of cell.icons ?? []) {
        if (tile === hiddenTrail) continue
        // Item cursors frame the upright atlas art. Travel/exclusion/stair
        // badges retain their ground anchor, even when sharing an item cell.
        const cursorItem = tile === cell.cursorTile && standing.find(entry => entry.cell === cell && entry.billboard?.kind === 'item' && !entry.billboard.lying)
        if (cursorItem) {
          const item = this.spriteRect(p, cursorItem.x, cursorItem.y)
          drawTile(ctx, this.tiles.source, { tile }, item.x, item.y, item.size)
        } else drawTile(ctx, this.tiles.source, { tile }, q.x, q.y, s)
      }
      if (cell.flags.excluded) {
        ctx.strokeStyle = '#ee776b'
        ctx.lineWidth = 1
        ctx.strokeRect(q.x + 2, q.y + 2, s - 4, s * sy - 4)
      }
      if (cell.flags.outOfRange) {
        ctx.fillStyle = 'rgba(10,13,21,0.24)'
        ctx.fillRect(q.x, q.y, s, s * sy)
      }
    }
    if (this.cursor) {
      const cell = this.scene.cells.get(cellKey(this.cursor.x, this.cursor.y))
      if (cell && cell.visibility !== 'unseen') {
        const q = project(p, cell.x - 0.5, cell.y - 0.5)
        ctx.strokeStyle = this.cursor.mode === 'target' ? '#ffc278' : '#bce5ec'
        ctx.lineWidth = 2
        ctx.strokeRect(q.x + 1, q.y + 1, s - 2, s * sy - 2)
        if (this.cursor.tile !== undefined) drawTile(ctx, this.tiles.source, { tile: this.cursor.tile }, q.x, q.y - s * (1 - sy), s)
      }
    }
  }

  private impactRipples(ctx: Context2d, p: Projection, time: number) {
    if (!this.opts.animate) return
    for (const ripple of this.life.ripples) {
      if (ripple.kind !== 'water') continue
      const age = (time - ripple.born) / 0.9
      if (age < 0 || age >= 1) continue
      this.active = true
      const q = project(p, ripple.x, ripple.y)
      ctx.save(); ctx.beginPath()
      for (const cell of this.cells) if (cell.visibility === 'visible' && !cell.occluder) {
        const r = planeRect(p, cell.x, cell.y, 0, this.dpr); ctx.rect(r.x, r.y, r.width, r.height)
      }
      ctx.clip()
      this.impactArt.draw(ctx, 'water', age, ripple.x * 11 + ripple.y * 23, ripple.strength,
        q.x, q.y, p.scale, this.dpr, groundDepth(p.tilt))
      ctx.restore()
    }
  }

  private wall(ctx: Context2d, p: Projection, cell: SceneCell, splats?: WallSplat[]) {
    if (p.tilt === null) return
    const roof = wallRoof(this.scene, p, cell, this.dpr)
    const ground = planeRect(p, cell.x, cell.y, 0, this.dpr)
    const tile = cell.faceTiles?.s ?? cell.wallTile ?? cell.featureTile ?? cell.floorTile
    const surface = { ...roof, height: ground.y + ground.height - roof.y }
    const face = { ...roof, y: roof.y + roof.height, height: surface.height - roof.height }
    ctx.save()
    if (cell.wallStyle === 'transparent') ctx.globalAlpha = 0.65
    ctx.fillStyle = '#343039'
    ctx.fillRect(surface.x, surface.y, surface.width, surface.height)
    // Keep the original cap and continue its edge into shaded stonework.
    const layers = [{ tile }, ...(cell.wallOverlays ?? []).map(tile => ({ tile }))]
    const darkness = this.darkness(cell), lighting = this.surfaceLighting(cell)
    this.tiles.drawPlane(ctx, layers, roof, this.light(), darkness, cell.flash, lighting, roof)
    // Decorations belong to the cap, never the reflected material underneath.
    this.tiles.drawWallFace(ctx, [{ tile: cell.wallMaterialTile ?? tile }], face,
      this.light(), darkness, cell.flash, lighting)
    if (splats) this.deathArt.drawWall(ctx, face, splats, p.tilt, this.lightExposure(cell), this.dpr)
    shadeWallFace(ctx, face)
    ctx.restore()
    this.hits.push({ key: cellKey(cell.x, cell.y), left: roof.x, right: roof.x + roof.width, top: roof.y, bottom: ground.y + ground.height })
  }

  private spriteFoot(p: Projection, x: number, y: number, elevation = 0) {
    return project(p, x, y + (p.tilt === null ? 0.5 : 0.3), elevation)
  }

  private spriteRect(p: Projection, x: number, y: number, elevation = 0, subpixel = false, cloud = false) {
    const foot = this.spriteFoot(p, x, y, elevation)
    const nativePlacement = !this.opts.filterScaling && !cloud
    const size = nativePlacement ? Math.max(1 / this.dpr, this.snap(p.scale)) : p.scale
    const left = foot.x - size / 2, top = foot.y - size
    return nativePlacement && !subpixel ? { x: this.snap(left), y: this.snap(top), size } : { x: left, y: top, size }
  }

  private actor(ctx: Context2d, p: Projection, cell: SceneCell, b: Billboard, time: number, position: { x: number; y: number; moving?: boolean; contactBlend?: number; fade?: number; retiring?: boolean; elevation?: number } = b) {
    const s = p.scale, visible = cell.visibility === 'visible'
    if (b.kind === 'projectile') {
      if (!visible) return
      const plane = planeRect(p, position.x, position.y, 0.28, this.dpr)
      const body = this.spriteFoot(p, position.x, position.y), blend = position.contactBlend ?? 0
      const rect = { x: plane.x + (body.x - s / 2 - plane.x) * blend,
        y: plane.y + (body.y - s - plane.y) * blend,
        width: plane.width + (s - plane.width) * blend, height: plane.height + (s - plane.height) * blend }
      ctx.save(); ctx.imageSmoothingEnabled = this.opts.filterScaling; ctx.globalAlpha = b.alpha ?? 0.95
      // Keep projectile strokes the width and thickness authored in the atlas.
      this.tiles.drawPlane(ctx, b.layers ?? [{ tile: b.tile }], rect, 1, false, undefined, undefined, undefined, false)
      ctx.restore()
      return
    }
    const creature = b.kind === 'player' || b.kind === 'monster' && !b.scenery
    const cloud = b.kind === 'cloud'
    const life = b.life ?? { motion: cloud ? 'cloud' : creature ? 'breath' : undefined }
    const foliage = life.motion === 'plant' || life.motion === 'grass'
    const idleIntensity = foliage ? this.opts.foliageSway : creature ? this.opts.idleIntensity : 1
    const animatedPose = idleIntensity > 0 && !b.lying && !life.held && this.opts.animate && visible && life.motion !== 'still'
      && (!!life.motion || !!life.flying || !!life.weary || !!life.fleeing || !!life.wading)
    const animation = this.movement.animation(b, time)
    const pose = livingPose({ ...life, rate: 1 }, animation.x, animation.y, animation.time,
      animatedPose, { strength: (cloud ? 2 : 3) * idleIntensity, smooth: true })
    if (this.opts.animate && visible && !position.retiring) {
      const stride = this.movement.pose(b, time, this.opts)
      pose.x += stride.x; pose.y += stride.y
      pose.sx *= stride.sx; pose.sy *= stride.sy; pose.angle += stride.angle
    }
    const opacity = position.fade ?? (this.opts.animate && visible ? this.effects.spawns.entrance(b, time) : 1)
    // Wound flags drive a small guarded lean and uneven breathing. This also
    // works for bloodless creatures without painting red over identifying art.
    const wound = ['uninjured', 'lightly_damaged', 'moderately_damaged', 'heavily_damaged', 'severely_damaged', 'almost_dead'].indexOf(b.damage ?? 'uninjured')
    if (creature && animatedPose && wound > 0) {
      const strain = wound / 5 * idleIntensity, phase = animation.x * 2.31 + animation.y * 1.73
      pose.angle -= strain * 0.035
      pose.sy -= strain * 0.025
      const effort = Math.sin(time * 1.8 + phase) * Math.sin(time * 0.9 + phase)
      pose.sy += effort * strain * 0.012
      pose.x += Math.sin(time * 0.85 + phase) * strain * 0.007
    }
    if (animatedPose) this.active = true
    const q = this.spriteFoot(p, position.x, position.y, position.elevation)
    // The atlas already encodes a rat's size relative to an ogre.
    // Preserve those authored proportions without scaling by billboard height.
    const filter = this.opts.filterScaling
    const transformed = pose.x !== 0 || pose.y !== 0 || pose.angle !== 0 || pose.sx !== 1 || pose.sy !== 1
    const smoothMotion = transformed || position.moving || position.x !== b.x || position.y !== b.y || this.movement.cameraMoving(this.frameTime)
    const rect = this.spriteRect(p, position.x, position.y, position.elevation, smoothMotion, cloud)
    const size = rect.size
    const x = rect.x + pose.x * s
    const foot = rect.y + size - pose.y * s
    const y = foot - size - (cloud ? s * 0.15 : 0)
    ctx.save()
    // Prefilter art smaller than its native size. At larger sizes filter
    // the enlarged texel edges only while a sprite is moving.
    const deviceSize = Math.max(1, Math.round(size * this.dpr))
    let rasterScale = 1
    if (deviceSize < 32) rasterScale = deviceSize / 32
    else if (smoothMotion && !cloud && !filter) rasterScale = Math.max(2, Math.min(4, Math.ceil(deviceSize / 32)))
    ctx.imageSmoothingEnabled = filter || (!b.lying && (cloud || smoothMotion))
    ctx.globalAlpha = (b.alpha ?? 1) * (cloud ? 0.58 : 1) * opacity
    const brightness = this.opts.animate && visible ? this.effects.hits.brightness(combatActorId(b), time) : 1
    if (brightness > 1) {
      if (typeof ctx.filter === 'string') ctx.filter = `brightness(${brightness})`
      else ctx.globalAlpha *= 1 - (brightness - 1) * 0.5
    }
    if (b.lying) {
      this.plane(ctx, p, { ...cell, x: position.x, y: position.y }, b.layers ?? [{ tile: b.tile }], 0.02)
    } else {
      ctx.translate(x, foot)
      ctx.translate(size / 2, 0)
      ctx.rotate(pose.angle)
      ctx.scale(pose.sx, pose.sy)
      ctx.translate(-size / 2, 0)
      const layers: Layer[] = b.layers ?? [{ tile: b.tile }]
      if (!this.tile(ctx, layers, cell, 0, -size - (cloud ? s * 0.15 : 0), size, { x, y }, rasterScale)) {
        ctx.globalAlpha *= 1 - this.darkness(cell)
        ctx.fillStyle = b.kind === 'player' ? '#fff0ba' : '#e5c4ae'
        ctx.font = `${size * 0.75}px monospace`
        ctx.textAlign = 'center'
        ctx.fillText(b.kind === 'player' ? '@' : cell.glyph ?? '?', size / 2, -size * 0.1)
      }
      if (b.kind === 'player' && visible && !position.retiring) {
        this.playerAnchor = { x: q.x, y: foot + this.playerSpriteTop(layers, size, pose) }
      }
    }
    ctx.restore()
    if (position.retiring) return // Visual residue has no hit region, badges or actor interaction.
    if (visible && (life.motion === 'gold' || life.motion === 'gem') && pose.glow > 0.05) {
      ctx.save()
      ctx.globalAlpha = pose.glow * 0.85
      ctx.strokeStyle = life.motion === 'gem' ? '#c6f4ff' : '#fff1b4'
      ctx.lineWidth = Math.max(1, s / 40)
      ctx.beginPath()
      ctx.moveTo(q.x - s * 0.06, q.y - s * 0.22); ctx.lineTo(q.x + s * 0.06, q.y - s * 0.22)
      ctx.moveTo(q.x, q.y - s * 0.28); ctx.lineTo(q.x, q.y - s * 0.16)
      ctx.stroke(); ctx.restore()
    }
    if (this.opts.animate && visible && b.kind === 'doll' && cell.feature?.type === 'fountain' && !/dry/.test(cell.feature.kind)) this.fountain(ctx, p, cell, time)
    if (p.tilt !== null && !cloud && !b.lying) this.hits.push({ key: cellKey(cell.x, cell.y), left: x + size * 0.12, right: x + size * 0.88, top: y, bottom: q.y })
    // Badges and bars stay upright and do not breathe, so tiny text never shimmers.
    if (b.statusIcons?.length) {
      const badge = this.spriteRect(p, position.x, position.y, position.elevation)
      for (const icon of b.statusIcons) drawTile(ctx, this.tiles.source, icon, badge.x, badge.y, badge.size)
    }
    if (b.kind === 'player' && this.opts.minibars) {
      const bars = minibarRects(this.opts.minibars, this.opts.minibarStyle)
      const last = bars.at(-1)
      if (!last) return
      const scale = s / MINIBAR_CELL
      const flat = this.opts.minibarStyle === 'default'
      // WebTiles uses whole pixels for the bar height, with one pixel kept at small zooms.
      const row = flat ? Math.max(1, Math.floor(s * this.dpr / 16)) / (this.dpr * MINIBAR_ROWS) : scale
      const overhead = this.opts.minibarPosition === 'top'
      const barTop = overhead ? q.y - s - 5
        : project(p, position.x, position.y + 0.5, position.elevation).y - (last.y + last.h) * row
      const top = flat ? this.snap(barTop) : barTop
      const left = flat ? this.snap(q.x - s / 2) : q.x - s / 2
      if (overhead && this.playerAnchor) this.playerAnchor.y = Math.min(this.playerAnchor.y, top)
      for (const bar of bars) {
        ctx.fillStyle = bar.colour
        ctx.globalAlpha = bar.alpha
        ctx.fillRect(left + bar.x * scale, top + bar.y * row, bar.w * scale, bar.h * row)
      }
      ctx.globalAlpha = 1
    }
  }

  private playerSpriteTop(layers: Layer[], size: number, pose: LivingPose) {
    const source = this.tiles.source
    const tilt = Math.sin(pose.angle) * pose.sx
    const stretch = Math.cos(pose.angle) * pose.sy
    let top = Infinity
    for (const layer of layers) {
      const tile = source?.tile(layer.tile)
      if (!tile?.w || !tile.h || !source?.atlas(tile.atlas) || (layer.ymax ?? Infinity) <= tile.oy) continue
      // The sprite is scaled and rotated around its feet, using the atlas offsets from drawTile.
      const left = (tile.ox + (layer.ox ?? 0)) / tile.cell - 0.5
      const y = (layer.at === 'top' ? 0 : tile.oy + (layer.oy ?? 0)) / tile.cell - 1
      top = Math.min(top, y * stretch + left * tilt + Math.min(0, tilt * tile.w / tile.cell))
    }
    return (Number.isFinite(top) ? top : -stretch) * size
  }

  private fountain(ctx: Context2d, p: Projection, cell: SceneCell, time: number) {
    this.active = true
    const q = this.spriteFoot(p, cell.x, cell.y), s = p.scale
    const phase = cell.x * 1.31 + cell.y * 2.17
    ctx.save()
    ctx.fillStyle = '#b8edf4'
    for (let i = 0; i < 5; i++) {
      const life = ((time * 0.75 + i / 5 + phase) % 1 + 1) % 1
      ctx.globalAlpha = Math.sin(life * Math.PI) * 0.45
      const side = i % 2 ? -1 : 1, size = Math.max(0.7, s / 75)
      ctx.fillRect(q.x + side * life * s * 0.2, q.y - s * (0.18 + Math.sin(life * Math.PI) * 0.19), size, size)
    }
    ctx.restore()
  }

  private emitterParticles(ctx: Context2d, p: Projection, sources: Emitter[], time: number, animate: boolean) {
    const s = p.scale
    let budget = 88
    for (const source of sources) {
      if (budget <= 0) break
      if (source.transient || !this.inFrame(p, source) || this.scene.cells.get(cellKey(source.x, source.y))?.visibility !== 'visible') continue
      const q = glowCenter(this.scene, p, source, this.tiles.source, b => this.actorPosition(b, this.frameTime))
      const phase = source.x * 1.31 + source.y * 2.17
      const fire = source.pulse === 'fire', count = Math.min(budget, fire ? 6 : 4)
      budget -= count
      ctx.save()
      // A compact core brightens the actual source instead of fogging the room.
      ctx.globalCompositeOperation = 'screen'
      if (source.power > 0) {
        const radius = s * (fire ? 0.18 : 0.13)
        const core = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, radius)
        core.addColorStop(0, `rgba(${source.colour.join(',')},${Math.min(0.22, source.power * 0.28)})`)
        core.addColorStop(1, `rgba(${source.colour.join(',')},0)`)
        ctx.fillStyle = core
        ctx.fillRect(q.x - radius, q.y - radius, radius * 2, radius * 2)
      }
      if (animate) {
        this.active = true
        ctx.fillStyle = fire ? '#ffdb91' : `rgb(${source.colour.join(',')})`
        for (let i = 0; i < count; i++) {
          const life = ((time * (fire ? 0.5 : 0.23) + i / count + phase) % 1 + 1) % 1
          ctx.globalAlpha = Math.min(1, Math.sin(life * Math.PI) ** 2 * (fire ? 0.62 : 0.42) * this.opts.lightIntensity)
          const size = Math.max(0.7, s / (fire ? 56 : 70))
          const x = q.x + Math.sin(phase + i * 8 + life * 2.4) * s * (fire ? 0.13 : 0.22)
          const y = q.y - life * s * (fire ? 0.52 : 0.38)
          ctx.fillRect(Math.round(x * this.dpr) / this.dpr, Math.round(y * this.dpr) / this.dpr, size, size * (fire && i % 3 === 0 ? 1.8 : 1))
        }
      }
      ctx.restore()
    }
  }

  pick(px: number, py: number): CellKey | null {
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return null
    // Resolve visible raised surfaces front-to-back before falling back to the ground.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]
      if (px >= h.left && px < h.right && py >= h.top && py < h.bottom) return h.key
    }
    const q = unproject(this.projection(), px, py)
    const x = Math.floor(q.x + 0.5), y = Math.floor(q.y + 0.5)
    const p = this.projection()
    // Raster alignment can move a shared edge by half a device pixel. Test
    // the adjacent ground quads so clicking that strip picks what was drawn.
    for (const dy of [0, -1, 1]) for (const dx of [0, -1, 1]) {
      const key = cellKey(x + dx, y + dy)
      const cell = this.scene.cells.get(key)
      if (!cell || cell.visibility === 'unseen' || cell.kind === 'unknown') continue
      const rect = planeRect(p, cell.x, cell.y, 0, this.dpr)
      if (px >= rect.x && px < rect.x + rect.width && py >= rect.y && py < rect.y + rect.height) return key
    }
    return null
  }

  destroy() {
    this.movement.clear()
    this.life.clear()
    this.effects.clear()
    this.deaths.clear()
    this.deathFades = []
    this.deathArt.clear()
    this.impactArt.clear()
    this.claimedImpacts = new WeakSet()
    this.visibility.clear()
    this.tiles.clear()
    this.tiles.source = null
    this.canvas = null
    this.ctx = null
    this.scene = emptyScene()
    this.revision = -1
    this.cells = []
    this.standing = []
    this.playerAnchor = null
    this.hits = []
    this.lighting.clear()
    this.active = false
  }
}
