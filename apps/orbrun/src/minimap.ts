import type { Rect } from '@orbrun/scene'

export const MINIMAP_SIZES = ['Small', 'Medium', 'Large'] as const
export type MinimapSize = typeof MINIMAP_SIZES[number]
export const MINIMAP_ALIGNMENTS = ['Left', 'Center', 'Right'] as const
export type MinimapAlignment = typeof MINIMAP_ALIGNMENTS[number]

const SCALE = { Small: 0.6, Medium: 0.8, Large: 1 }

// The panel follows the classic 80 × 70 proportions. Its CSS scale is
// independent of the map raster, so every size covers the same ground.
export function minimapFit(width: number, height: number, size: MinimapSize, rcPixels = 0) {
  const available = Math.max(0, Math.min(width / 80, height / 70, rcPixels > 0 ? rcPixels : Infinity))
  // Short phone sidebars can display the full raster at subpixel scale.
  const cell = available < 1 ? available : Math.floor(available)
  return { w: 80 * cell * SCALE[size], h: 70 * cell * SCALE[size] }
}

// One raster pixel per dungeon cell. Extend both axes together for levels
// whose known bounds exceed the standard dimensions.
export function minimapRaster(bounds: Rect) {
  const units = Math.max(10, Math.ceil((bounds.right - bounds.left + 1) / 8), Math.ceil((bounds.bottom - bounds.top + 1) / 7))
  return { w: 8 * units, h: 7 * units }
}

// map-feature.h order, with the standard WebTiles RC colours as fallbacks.
const FEATURES = [
  ['unseen', '#000000'], ['floor', '#333333'], ['wall', '#666666'],
  ['mapped_floor', '#222266'], ['mapped_wall', '#444499'], ['door', '#775544'],
  ['item', '#005544'], ['monster', '#660000'], ['monster', '#660000'],
  ['monster', '#660000'], ['monster', '#660000'], ['plant', '#446633'],
  ['upstairs', '#00ffff'], ['downstairs', '#ff00ff'], ['branchstairs', '#ff7788'],
  ['feature', '#997700'], ['water', '#114455'], ['lava', '#552211'],
  ['trap', '#aa6644'], ['excl_centre', '#552266'], ['excluded', '#552266'],
  ['player', '#ffffff'], ['deep_water', '#001122'], ['portal', '#ffdd00'],
  ['transporter', '#0000ff'], ['transporter_landing', '#5200aa'], ['explore_horizon', '#6b301b'],
]

export function mapColour(options: Record<string, unknown>, name: string, fallback: string) {
  const value = options['tile_' + name + '_col'] as { r?: number; g?: number; b?: number } | undefined
  return value && [value.r, value.g, value.b].every(Number.isFinite) ? `rgb(${value.r},${value.g},${value.b})` : fallback
}

export function mapPalette(options: Record<string, unknown>) {
  return FEATURES.map(([name, fallback]) => mapColour(options, name, fallback))
}
