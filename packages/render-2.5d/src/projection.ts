export const DUNGEON_TILT = { min: 20, max: 90 } as const
export const DUNGEON_ZOOM = { min: 0.5, max: 2 } as const

/** Orthographic, north-up projection. World coordinates name cell centres. */
export interface Projection {
  x: number
  y: number
  width: number
  height: number
  scale: number
  tilt: number | null
  corridorCutaway?: boolean
}

/** Leave room for upright art in east–west passages while retaining the camera slant. */
export const groundDepth = (tilt: number | null) => tilt === null ? 1 : Math.sin(tilt) * 1.25

export function project(p: Projection, x: number, y: number, z = 0) {
  return {
    x: p.width / 2 + (x - p.x) * p.scale,
    y: p.height / 2 + ((y - p.y) * groundDepth(p.tilt) - (p.tilt === null ? 0 : z * Math.cos(p.tilt))) * p.scale,
  }
}

export function unproject(p: Projection, x: number, y: number) {
  return {
    x: p.x + (x - p.width / 2) / p.scale,
    y: p.y + (y - p.height / 2) / (p.scale * groundDepth(p.tilt)),
  }
}

export interface SurfaceRect { x: number; y: number; width: number; height: number }

/** Shared world edges must land on the same device pixel, even at fractional zoom/DPR. */
export function planeRect(p: Projection, x: number, y: number, z: number, dpr: number): SurfaceRect {
  const a = project(p, x - 0.5, y - 0.5, z)
  const b = project(p, x + 0.5, y + 0.5, z)
  const left = Math.round(a.x * dpr) / dpr, top = Math.round(a.y * dpr) / dpr
  return { x: left, y: top, width: Math.round(b.x * dpr) / dpr - left, height: Math.round(b.y * dpr) / dpr - top }
}

/** Fit the 17-cell LOS diameter with a margin and room for upright sprites. */
export function fittedScale(width: number, height: number, tilt: number | null, zoom = 1) {
  const span = 18
  const vertical = span * groundDepth(tilt) + (tilt === null ? 0 : 2)
  return Math.max(1, Math.min(width / span, height / vertical, 64) * zoom)
}
