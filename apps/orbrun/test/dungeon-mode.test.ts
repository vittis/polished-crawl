// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { UiState } from '@orbrun/webtiles'
import { dungeonOptions } from '../src/dungeon-options'
import { mountGame } from './fixtures/game-screen'
import { defaultSettings } from '../src/settings'

describe('effective dungeon animation', () => {
  it('passes configured idle and movement properties to the renderer', () => {
    expect(dungeonOptions({ ...defaultSettings, depthIdleIntensity: 0.25, depthFoliageSway: 0, liquidMotion: 1.75, depthMovement: false, depthMovementDuration: 0.18, depthMovementEasing: 'smooth',
      depthMovementHopHeight: 0, depthMovementSquash: 0.5, depthMovementSway: 1.5 })).toMatchObject({
      idleIntensity: 0.25, foliageSway: 0, liquidMotion: 1.75, movement: false, movementDuration: 0.18, movementEasing: 'smooth', movementHopHeight: 0, movementSquash: 0.5, movementSway: 1.5,
    })
  })
})

describe('the Dungeon presentation lifecycle', () => {
  it('keeps one canvas and one renderer through repeated server map transitions and settings changes', () => {
    const game = mountGame()
    const dungeon = game.canvas()
    for (let cycle = 0; cycle < 2; cycle++) {
      game.receive({ msg: 'ui_state', state: UiState.VIEW_MAP })
      game.frame()
      const map = game.canvas()
      expect(map).not.toBe(dungeon)
      expect(game.renderers.at(-1)?.view).toBe('flat-map')
      expect(game.renderers.at(-2)?.renderer.destroy).toHaveBeenCalledOnce()
      expect(game.screen.root.querySelectorAll('canvas.view')).toHaveLength(1)

      game.settings.depthTilt = 60
      game.screen.applySettings()
      game.receive({ msg: 'ui_state', state: UiState.VIEW_MAP })
      game.frame()
      expect(game.canvas()).toBe(map)
      expect(game.renderers.at(-1)?.renderer.destroy).not.toHaveBeenCalled()

      game.receive({ msg: 'ui_state', state: UiState.NORMAL })
      game.frame()
      expect(game.canvas()).not.toBe(map)
      expect(game.renderers.at(-1)?.view).toBe('dungeon')
      expect(game.renderers.at(-2)?.renderer.destroy).toHaveBeenCalledOnce()
    }
    expect(game.renderers.map(entry => entry.view)).toEqual(['dungeon', 'flat-map', 'dungeon', 'flat-map', 'dungeon'])
    game.destroy()
    for (const { renderer } of game.renderers) expect(renderer.destroy).toHaveBeenCalledOnce()
    expect(game.screen.root.isConnected).toBe(false)
  })
})
