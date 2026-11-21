import { afterEach, expect, it, vi } from 'vitest'
import { TileCache, type Context2d } from '../src/tiles.js'

class Canvas {
  constructor(public width: number, public height: number) {}
  getContext() { return new Proxy({}, { get: () => vi.fn() }) }
}
afterEach(() => vi.unstubAllGlobals())

it('keeps submitted fades separate within a frame and reuses them in later frames', () => {
  vi.stubGlobal('OffscreenCanvas', Canvas)
  const tiles = new TileCache(), atlas = new Canvas(32, 32)
  tiles.source = {
    tile: () => ({ atlas: 'test', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }),
    atlas: () => atlas as unknown as OffscreenCanvas, atlasNames: () => ['test'],
  }
  const drawImage = vi.fn(), ctx = { drawImage } as unknown as Context2d
  const draw = (value: number) => tiles.drawPlane(ctx, [{ tile: 1 }], { x: 0, y: 0, width: 32, height: 32 }, 1, value)
  tiles.beginFrame()
  draw(0.1); draw(0.2); draw(0.1)
  const first = drawImage.mock.calls[0][0], second = drawImage.mock.calls[1][0]
  expect(second).not.toBe(first)
  expect(drawImage.mock.calls[2][0]).toBe(first)
  tiles.beginFrame()
  draw(0.3); draw(0.4)
  expect(drawImage.mock.calls[3][0]).toBe(first)
  expect(drawImage.mock.calls[4][0]).toBe(second)
  tiles.clear(); tiles.beginFrame(); draw(0.1)
  expect(drawImage.mock.calls[5][0]).not.toBe(first)
})

it('preserves padded sprite sizes when terrain and sprite fades share the frame pool', () => {
  vi.stubGlobal('OffscreenCanvas', Canvas)
  const tiles = new TileCache(), atlas = new Canvas(32, 64)
  tiles.source = {
    tile: id => ({ atlas: 'test', sx: 0, sy: 0, w: 32, h: id === 2 ? 64 : 32, ox: 0, oy: id === 2 ? -32 : 0, cell: 32 }),
    atlas: () => atlas as unknown as OffscreenCanvas, atlasNames: () => ['test'],
  }
  const drawImage = vi.fn(), ctx = { drawImage } as unknown as Context2d
  const floor = () => tiles.drawPlane(ctx, [{ tile: 1 }], { x: 0, y: 0, width: 32, height: 32 }, 1, 0.2)
  const actor = (tile: number, scale = 1) => tiles.draw(ctx, [{ tile }], 0, 0, 32, 1, 0.2, undefined, undefined, undefined, scale)
  tiles.beginFrame(); floor(); actor(1); actor(2); actor(2, 2)
  const images = drawImage.mock.calls.map(([image]) => image as Canvas)
  expect(images.map(image => image.width)).toEqual([32, 36, 96, 192])
  expect(drawImage.mock.calls.map(([, x, , width]) => [x, width])).toEqual([[0, 32], [-2, 36], [-32, 96], [-32, 96]])
  tiles.beginFrame(); actor(2, 2); actor(2); floor(); actor(1)
  expect(drawImage.mock.calls.slice(4).map(([image]) => image)).toEqual([images[3], images[2], images[0], images[1]])
})
