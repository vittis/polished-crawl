import { refractLiquid, type LiquidMaterial, type SceneCell, type TileSource } from '@orbrun/scene'
import type { SurfaceRect } from './projection.js'
import { MEMORY_DARKNESS } from './visibility.js'

export type Context2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Raster = HTMLCanvasElement | OffscreenCanvas

function createRaster(width: number, height: number): Raster {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height })
}
function filteredRaster(source: Raster, width: number, height: number, rect: SurfaceRect): Raster | null {
  const target = createRaster(width, height)
  const ink = target.getContext('2d') as Context2d | null
  if (!ink) return null
  ink.imageSmoothingEnabled = true
  ink.imageSmoothingQuality = 'low'
  ink.drawImage(source, rect.x, rect.y, rect.width, rect.height)
  return target
}

function reducedRaster(source: Raster, width: number, height: number, rect: SurfaceRect = { x: 0, y: 0, width, height }): Raster | null {
  // Each bilinear pass can blend at most two adjoining texels along an axis.
  // Halve larger reductions in stages to keep thin markings in the sample.
  while (source.width > rect.width * 2 || source.height > rect.height * 2) {
    const w = Math.max(Math.ceil(rect.width), Math.ceil(source.width / 2))
    const h = Math.max(Math.ceil(rect.height), Math.ceil(source.height / 2))
    const reduced = filteredRaster(source, w, h, { x: 0, y: 0, width: w, height: h })
    if (!reduced) return null
    source = reduced
  }
  return filteredRaster(source, width, height, rect)
}

export interface Layer { tile: number; ox?: number; oy?: number; ymax?: number; at?: 'top' }
export interface SurfaceLighting { draw(ctx: Context2d, rect: SurfaceRect, mask?: HTMLCanvasElement | OffscreenCanvas, sample?: SurfaceRect): void }

/** Keep atlas offsets and doll clipping identical on every projected surface. */
export function drawTile(ctx: Context2d, source: TileSource | null, layer: Layer, x: number, y: number, size: number): boolean {
  const r = source?.tile(layer.tile)
  const image = r && source?.atlas(r.atlas)
  if (!r || !image) return false
  const height = layer.ymax === undefined ? r.h : Math.min(r.h, Math.max(0, layer.ymax - r.oy))
  if (!height) return true
  const scale = size / r.cell
  ctx.drawImage(image as CanvasImageSource, r.sx, r.sy, r.w, height,
    x + (r.ox + (layer.ox ?? 0)) * scale,
    y + (layer.at === 'top' ? 0 : r.oy + (layer.oy ?? 0)) * scale,
    r.w * scale, height * scale)
  return true
}

/** Bounded, readback-free cache. Padding preserves tall and offset tile art. */
export class TileCache {
  private entries = new Map<string, Raster>()
  private pixels = 0
  private fading = new Map<string, Raster>()
  private fadeRasters = new Map<string, { canvases: Raster[]; used: number }>()
  private fadePixels = 0
  private frameFades = new Map<string, Raster>()
  private fadeCursor = 0
  source: TileSource | null = null
  pixelRatio = 1

  beginFrame() {
    this.frameFades.clear(); this.fadeCursor = 0
    for (const pool of this.fadeRasters.values()) pool.used = 0
  }

  clear() {
    this.entries.clear(); this.pixels = 0; this.fading.clear()
    this.fadeRasters.clear(); this.fadePixels = 0; this.beginFrame()
  }

  draw(ctx: Context2d, layers: Layer[], x: number, y: number, size: number, light: number, memory: boolean | number, flash?: { r: number; g: number; b: number; a: number }, lighting?: SurfaceLighting, sample?: SurfaceRect, rasterScale = 1): boolean {
    const surface = this.composite(layers, light, memory, false, flash, rasterScale)
    if (!surface) return false
    const extent = size * surface.width / (32 * rasterScale)
    const margin = (extent - size) / 2
    const rect = { x: x - margin, y: y - margin, width: extent, height: extent }
    ctx.drawImage(surface, rect.x, rect.y, extent, extent)
    lighting?.draw(ctx, rect, surface, sample && extent !== size * 3 ? {
      x: sample.x + size - margin, y: sample.y + size - margin, width: extent, height: extent,
    } : sample)
    return true
  }

  /** Terrain has no transparent padding to bleed into its edges when filtered. */
  drawPlane(ctx: Context2d, layers: Layer[], rect: SurfaceRect, light: number, memory: boolean | number, flash?: { r: number; g: number; b: number; a: number }, lighting?: SurfaceLighting, sample?: SurfaceRect, reduce = true): boolean {
    const surface = this.composite(layers, light, memory, true, flash, 1, reduce ? this.planeSize(rect) : undefined)
    if (!surface) return false
    ctx.drawImage(surface, rect.x, rect.y, rect.width, rect.height)
    lighting?.draw(ctx, rect, surface, sample)
    return true
  }

  /** Refract just the native floor. Decals, shoreline foam and actors keep their anchors. */
  drawLiquidFloor(ctx: Context2d, material: LiquidMaterial, cell: SceneCell, rect: SurfaceRect, memory: number, time: number, dpr: number, intensity: number) {
    const floor = this.composite([{ tile: cell.floorTile }], 1, false, true, undefined, 1, this.planeSize(rect))
    if (floor) {
      ctx.drawImage(floor, rect.x, rect.y, rect.width, rect.height)
      refractLiquid(ctx, floor, { sx: 0, sy: 0, w: floor.width, h: floor.height }, rect, material, cell, time, dpr, intensity)
    }
    if (this.source && memory !== 0) {
      ctx.fillStyle = `rgba(0,0,0,${memory})`; ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    }
    if (this.source && cell.flash) {
      const { r, g, b, a } = cell.flash
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`; ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    }
  }

  /** Turn the roof edge down into shallow stonework, keeping texels roughly square. */
  drawWallFace(ctx: Context2d, layers: Layer[], rect: SurfaceRect, light: number, memory: number, flash?: { r: number; g: number; b: number; a: number }, lighting?: SurfaceLighting) {
    if (rect.height <= 0) return
    const surface = this.composite(layers, light, memory, true, flash)
    if (!surface) return
    // Reflect only the adjoining band: the first face row matches the cap,
    // then the stone shapes continue instead of stretching into vertical lines.
    // Sampling by face depth also keeps low corridor cutaways from squeezing
    // an entire tile of artwork into their narrow lip.
    const depth = Math.min(surface.height, Math.max(1, Math.ceil(surface.width * rect.height / rect.width)))
    ctx.save()
    ctx.translate(rect.x, rect.y + rect.height)
    ctx.scale(1, -1)
    if (Math.round(rect.width * this.pixelRatio) < surface.width) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'medium'
    }
    ctx.drawImage(surface, 0, surface.height - depth, surface.width, depth, 0, 0, rect.width, rect.height)
    ctx.restore()
    lighting?.draw(ctx, rect)
  }

  private planeSize(rect: SurfaceRect) {
    const width = Math.min(32, Math.max(1, Math.round(rect.width * this.pixelRatio)))
    const height = Math.min(32, Math.max(1, Math.round(rect.height * this.pixelRatio)))
    if (width < 32 || height < 32) return { width, height }
  }

  /** Numeric memory is continuous black opacity; booleans retain static shading. */
  private composite(layers: Layer[], light: number, memory: boolean | number, flat: boolean, flash?: { r: number; g: number; b: number; a: number }, rasterScale = 1, planeSize?: { width: number; height: number }) {
    if (!layers.some(l => this.source?.tile(l.tile))) return null
    if (layers.some(l => { const r = this.source?.tile(l.tile); return r && !this.source?.atlas(r.atlas) })) return null
    const shade = Math.round(Math.max(0.2, Math.min(1, light)) * 16) / 16
    const darkness = typeof memory === 'number' ? Math.max(0, Math.min(1, memory)) : memory ? MEMORY_DARKNESS : 0
    const cachedMemory = darkness === MEMORY_DARKNESS
    const fading = darkness !== 0 && !cachedMemory
    const cachedFlash = fading ? undefined : flash
    const key = JSON.stringify([layers, shade, cachedMemory, flat, cachedFlash, rasterScale, planeSize])
    let surface = this.entries.get(key)
    if (!surface) {
      // Most sprites (especially dense spell clouds) fit their own cell.
      // Keep a filtering gutter for them and retain the full three-cell
      // footprint for overhanging art and offset equipment.
      const fits = !flat && layers.every(layer => {
        const tile = this.source?.tile(layer.tile)
        if (!tile) return true
        const left = tile.ox + (layer.ox ?? 0), top = layer.at === 'top' ? 0 : tile.oy + (layer.oy ?? 0)
        return left >= 0 && top >= 0 && left + tile.w <= tile.cell && top + tile.h <= tile.cell
      })
      const origin = flat ? 0 : fits ? 2 : 32, size = 32 + origin * 2
      const sourceScale = Math.max(1, rasterScale)
      surface = createRaster(size * sourceScale, size * sourceScale)
      const c = surface.getContext('2d') as Context2d | null
      if (!c) return null
      // Enlarge whole source pixels first. Filtering this surface then softens
      // only a narrow pixel edge instead of blurring entire atlas texels.
      c.imageSmoothingEnabled = false
      c.scale(sourceScale, sourceScale)
      let painted = false
      for (const layer of layers) painted = drawTile(c, this.source, layer, origin, origin, 32) || painted
      // Atlases may still be loading: a missing image must never poison the cache.
      if (!painted) return null
      c.globalCompositeOperation = 'source-atop'
      c.fillStyle = `rgba(0,0,0,${1 - shade})`
      c.fillRect(0, 0, size, size)
      if (cachedMemory) {
        c.fillStyle = `rgba(0,0,0,${MEMORY_DARKNESS})`
        c.fillRect(0, 0, size, size)
      }
      if (cachedFlash) {
        c.fillStyle = `rgba(${cachedFlash.r},${cachedFlash.g},${cachedFlash.b},${cachedFlash.a / 255})`
        c.fillRect(0, 0, size, size)
      }
      if (rasterScale < 1) {
        // Reduce the unposed sprite once, then animate that raster. Keep its
        // original tile origin aligned within the padding.
        const margin = Math.ceil(origin * rasterScale)
        const offset = margin - origin * rasterScale
        const extent = size * rasterScale
        const edge = Math.round(32 * rasterScale) + margin * 2
        const reduced = reducedRaster(surface, edge, edge, { x: offset, y: offset, width: extent, height: extent })
        if (!reduced) return null
        surface = reduced
      } else if (planeSize) {
        // Average only on axes compressed by the projection. The final draw
        // can still use nearest-neighbour to enlarge the other axis.
        surface = reducedRaster(surface, planeSize.width, planeSize.height) ?? surface
      }
      // Keep the same pixel budget for resized and enlarged artwork.
      const pixels = surface.width * surface.height
      while (this.entries.size && (this.entries.size >= 1024 || this.pixels + pixels > 1024 * 96 * 96)) {
        const oldest = this.entries.keys().next().value!
        const previous = this.entries.get(oldest)!
        this.pixels -= previous.width * previous.height
        this.entries.delete(oldest)
      }
      this.entries.set(key, surface)
      this.pixels += pixels
    }
    if (fading) {
      // Shade a reusable scratch surface, preserving sprite alpha and flash
      // ordering without quantized cache entries for every animation frame.
      const fadeKey = JSON.stringify([key, darkness, flash])
      const cached = this.frameFades.get(fadeKey)
      if (cached) return cached
      // Keep rasters immutable after submission. Pool by size so mixed padded
      // sprites and floor tiles never resize or clip each other's rasters.
      const sizeKey = surface.width + 'x' + surface.height
      let pool = this.fadeRasters.get(sizeKey)
      if (!pool) this.fadeRasters.set(sizeKey, pool = { canvases: [], used: 0 })
      const pixels = surface.width * surface.height
      const pooled = this.fadeCursor < 512 && (pool.used < pool.canvases.length || this.fadePixels + pixels <= 2 * 1024 * 1024)
      let fadingSurface = pooled ? pool.canvases[pool.used] : this.fading.get(sizeKey)
      if (!fadingSurface) {
        fadingSurface = createRaster(surface.width, surface.height)
        if (pooled) { pool.canvases.push(fadingSurface); this.fadePixels += pixels }
        else this.fading.set(sizeKey, fadingSurface)
      }
      if (pooled) { pool.used++; this.fadeCursor++ }
      const c = fadingSurface.getContext('2d') as Context2d | null
      if (!c) return surface
      c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, surface.width, surface.height)
      c.drawImage(surface, 0, 0)
      c.globalCompositeOperation = 'source-atop'
      c.fillStyle = `rgba(0,0,0,${darkness})`; c.fillRect(0, 0, surface.width, surface.height)
      if (flash) {
        c.fillStyle = `rgba(${flash.r},${flash.g},${flash.b},${flash.a / 255})`
        c.fillRect(0, 0, surface.width, surface.height)
      }
      if (pooled) this.frameFades.set(fadeKey, fadingSurface)
      return fadingSurface
    }
    return surface
  }
}
