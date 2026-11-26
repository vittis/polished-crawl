// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { cm, UiState } from '@orbrun/webtiles'
import { mountGame } from './fixtures/game-screen'

describe('a drag whose release the page never saw', () => {
  it.each(['buttonless move', 'window blur'] as const)('drops capture and accepts a fresh click after %s', reason => {
    const game = mountGame()
    const canvas = game.canvas()
    const captured = new Set<number>()
    vi.spyOn(canvas, 'setPointerCapture').mockImplementation(id => { captured.add(id) })
    vi.spyOn(canvas, 'hasPointerCapture').mockImplementation(id => captured.has(id))
    vi.spyOn(canvas, 'releasePointerCapture').mockImplementation(id => { captured.delete(id) })
    game.pointer('pointerdown', canvas, { buttons: 1 })
    expect(captured.size).toBe(1)

    if (reason === 'buttonless move') game.pointer('pointermove', canvas, { clientX: 101, buttons: 0 })
    else window.dispatchEvent(new Event('blur'))
    expect(captured.size).toBe(0)
    game.pointer('pointerup', canvas)
    expect(game.sent).toEqual([])

    game.pointer('pointerdown', canvas, { buttons: 1 })
    game.pointer('pointerup', canvas)
    expect(game.sent).toEqual([cm.clickCell(1, 0, 1)])
  })

  it('releases the outgoing canvas and removes the blur listener after renderer swaps', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    try {
      const game = mountGame()
      const original = add.mock.calls.filter(([type]) => type === 'blur').map(([, fn]) => fn)
      add.mockClear()
      const outgoing = game.canvas()
      vi.spyOn(outgoing, 'hasPointerCapture').mockReturnValue(true)
      const release = vi.spyOn(outgoing, 'releasePointerCapture')
      game.pointer('pointerdown', outgoing, { pointerType: 'touch', buttons: 1 })
      game.receive({ msg: 'ui_state', state: UiState.VIEW_MAP })
      game.frame()
      expect(release).toHaveBeenCalledExactlyOnceWith(1)
      game.pointer('pointerup', outgoing, { pointerType: 'touch' })
      expect(game.sent).toEqual([])

      game.receive({ msg: 'ui_state', state: UiState.NORMAL })
      game.frame()
      const fresh = game.canvas()
      game.pointer('pointerdown', fresh, { pointerType: 'touch', buttons: 1 })
      game.pointer('pointerup', fresh, { pointerType: 'touch' })
      expect(game.sent).toEqual([cm.clickCell(1, 0, 1)])

      const callbacks = new Set(add.mock.calls.filter(([type]) => type === 'blur').map(([, fn]) => fn))
      expect(callbacks.size).toBe(1)
      expect(original).toContain([...callbacks][0])
      game.destroy()
      expect(remove).toHaveBeenCalledWith('blur', [...callbacks][0])
    } finally {
      add.mockRestore()
      remove.mockRestore()
    }
  })
})
