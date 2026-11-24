// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Render25d } from '@orbrun/render-2.5d'
import { mountGame } from './fixtures/game-screen'

/** Happy DOM has no canvas raster. The renderer still computes and samples real movement. */
function mountDungeon() {
  const gradient = { addColorStop() {} }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return new Proxy({
      canvas: this,
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      measureText: () => ({ width: 8 }),
    } as Record<PropertyKey, unknown>, {
      get(target, key) { return target[key] ?? (() => {}) },
      has(target, key) { return key in target },
    }) as unknown as CanvasRenderingContext2D
  })
  const renderer = new Render25d()
  const setScene = vi.spyOn(renderer, 'setScene')
  const game = mountGame({ renderer: () => renderer })
  const move = () => game.receive(
    { msg: 'player', pos: { x: 1, y: 0 } },
    { msg: 'map', vgrdc: { x: 1, y: 0 } },
  )
  return { ...game, renderer, setScene, move }
}

afterEach(() => vi.restoreAllMocks())

describe('game presentation', () => {
  it.each([60, 120])('starts motion at receipt and keeps the player centered at %i Hz', hz => {
    const game = mountDungeon()
    const { renderer } = game
    const initialX = renderer.project(0, 0).x
    const scale = renderer.project(1, 0).x - initialX
    const interval = 1000 / hz
    game.advance(interval / 4)
    game.move()
    game.frame(interval * 3 / 4)

    const fraction = (initialX - renderer.project(0, 0).x) / scale
    expect(fraction).toBeGreaterThan(0)
    expect(fraction).toBeLessThan(1)
    const player = game.session.scene.billboards.find(billboard => billboard.kind === 'player')!
    expect(renderer.projectBillboard(player).x).toBeCloseTo(initialX, 8)
    expect(renderer.playerSpriteAnchor?.x).toBeCloseTo(initialX, 8)

    game.receive({ msg: 'player', hp: 19 })
    game.frame(10)
    expect(initialX - renderer.project(0, 0).x).toBeGreaterThan(fraction * scale)
    expect(renderer.playerSpriteAnchor?.x).toBeCloseTo(initialX, 8)
  })

  it.each([[0, 1], [9999, 1.05]])('clamps receipt timestamp %s before handing it to the renderer', (receipt, expected) => {
    const game = mountDungeon()
    game.frame(1000)
    vi.spyOn(performance, 'now').mockReturnValueOnce(receipt)
    game.receive({ msg: 'player', pos: { x: 1, y: 0 } })
    game.setScene.mockClear()
    game.frame(50)
    expect(game.setScene.mock.calls[0][0].player).toEqual({ x: 1, y: 0 })
    expect(game.setScene.mock.calls[0][1]).toBe(expected)
  })
})
