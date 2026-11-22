import { describe, expect, it } from 'vitest'
import { minimapFit, minimapRaster } from '../src/minimap'

describe('desktop minimap', () => {
  it('scales the panel within both sidebar dimensions and honours the server cap', () => {
    expect(minimapFit(330, 300, 'Medium')).toEqual({ w: 256, h: 224 })
    expect(minimapFit(330, 300, 'Small')).toEqual({ w: 192, h: 168 })
    expect(minimapFit(330, 300, 'Large', 2)).toEqual({ w: 160, h: 140 })
    expect(minimapFit(200, 60, 'Small').h).toBe(36)
  })

  it('preserves square cells and includes both extremes of oversized explored levels', () => {
    expect(minimapRaster({ left: -15, top: -8, right: 20, bottom: 12 })).toEqual({ w: 80, h: 70 })
    expect(minimapRaster({ left: -60, top: -39, right: 59, bottom: 39 })).toEqual({ w: 120, h: 105 })
    expect(minimapRaster({ left: -20, top: -42, right: 20, bottom: 40 })).toEqual({ w: 96, h: 84 })
  })
})
