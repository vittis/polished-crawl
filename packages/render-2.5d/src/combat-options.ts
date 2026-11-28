export const BUMP_STRENGTH = { min: 0, max: 4 } as const
export const PARTICLE_AMOUNT = { min: 0, max: 4 } as const
export const PARTICLE_SCALE = { min: 0.25, max: 4 } as const
export const BURST_VARIATION = { min: 0, max: 2 } as const
export const DEATH_SIZE_SCALING = { min: 0, max: 1, default: 1 } as const

export const DEFAULT_DEATH_PARTICLES = {
  gore: 0.5, outward: 0.75, reach: 1, duration: 4 / 3, variation: 0.6,
} as const

/** Keep the original budgets through 2× and allow denser bursts above it. */
export function particleBudget(base: number, amount: number): number {
  return Math.round(base * Math.max(1, Math.min(PARTICLE_AMOUNT.max, amount) / 2))
}
