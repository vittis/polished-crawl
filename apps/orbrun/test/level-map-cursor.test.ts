// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { initialState, reduce, UiState } from '@orbrun/webtiles'
import { emptyScene } from '@orbrun/scene'
import { mountGame } from './fixtures/game-screen'
import { deriveContext, deriveMode } from '../src/context'

it('passes the cursor received with the opening frame to the flat renderer and clears it on return', () => {
  const game = mountGame()
  game.receive(
    { msg: 'menu', tag: 'stash', flags: 0, title: { text: 'Search results' }, items: [{ text: 'a - a scroll', hotkeys: [97], level: 2 }] },
    { msg: 'ui_cutoff', cutoff: 0 },
    { msg: 'ui_state', state: UiState.VIEW_MAP },
    { msg: 'cursor', id: 2, loc: { x: 12, y: 7 } },
  )
  game.frame()
  const flat = game.renderers[1]
  expect(flat.view).toBe('flat-map')
  expect(flat.renderer.setCursor).toHaveBeenLastCalledWith(expect.objectContaining({ x: 12, y: 7, mode: 'map' }))

  game.receive(
    { msg: 'cursor', id: 2 }, { msg: 'ui_state', state: UiState.NORMAL }, { msg: 'ui_cutoff', cutoff: -1 },
  )
  game.frame()
  expect(game.renderers[2].view).toBe('dungeon')
  expect(game.renderers[2].renderer.setCursor).toHaveBeenLastCalledWith(null)
  expect(flat.renderer.destroy).toHaveBeenCalledOnce()
})

describe('the level map opened from the ctrl-f results', () => {
  /** stash.cc `on_single_selection`: `show_map` runs with the results menu still on crawl's stack, hidden by its `ui::cutoff_point` */
  function openFromSearch() {
    const st = initialState()
    st.phase = 'playing'
    reduce(st, { msg: 'menu', tag: 'stash', flags: 0, title: { text: 'Search results' }, items: [{ text: 'a - a scroll', hotkeys: [97], level: 2 }] })
    reduce(st, { msg: 'ui_cutoff', cutoff: 0 })
    reduce(st, { msg: 'ui_state', state: UiState.VIEW_MAP })
    reduce(st, { msg: 'cursor', id: 2, loc: { x: 12, y: 7 } })
    return st
  }

  it('is the level map, not the hidden menu (menu.js takes no keys for a hidden popup)', () => {
    const st = openFromSearch()
    expect(st.menus[0]?.hidden).toBe(true)
    expect(deriveMode(st)).toBe('levelmap')
    expect(st.cursors[2]).toEqual({ x: 12, y: 7 })
  })

  it('gives the menu back when the map closes and the cutoff lifts', () => {
    const st = openFromSearch()
    reduce(st, { msg: 'cursor', id: 2 })
    reduce(st, { msg: 'ui_state', state: 0 })
    reduce(st, { msg: 'ui_cutoff', cutoff: -1 })
    expect(deriveMode(st)).toBe('menu')
    expect(st.cursors[2]).toBeNull()
  })
})

describe('the level map cursor away from the player', () => {
  it('is what the pad travels to (CURSOR_MAP is id 2)', () => {
    const st = initialState()
    st.phase = 'playing'
    reduce(st, { msg: 'ui_state', state: UiState.VIEW_MAP })
    const scene = { ...emptyScene(), playerOnLevel: true }
    reduce(st, { msg: 'cursor', id: 2, loc: { x: 0, y: 0 } })
    expect(deriveContext(st, scene, 0, 'micro').mapCursorHome).toBe(true)
    reduce(st, { msg: 'cursor', id: 2, loc: { x: 2, y: 1 } })
    expect(deriveContext(st, scene, 0, 'micro').mapCursorHome).toBe(false)
  })
})
