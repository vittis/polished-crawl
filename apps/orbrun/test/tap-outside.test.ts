// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { cm, Keys, MenuFlag, type ServerMessage } from '@orbrun/webtiles'
import { mountGame } from './fixtures/game-screen'

const inventory: ServerMessage = {
  msg: 'menu', tag: 'inventory', flags: MenuFlag.ARROWS_SELECT,
  title: { text: 'Inventory' }, items: [{ text: 'a - a dagger', hotkeys: [97], level: 2 }],
}
const description: ServerMessage = { msg: 'ui-push', type: 'describe-monster', title: 'Goblin', body: 'It is sleeping.' }

function withMenu(kind: 'server' | 'local' | 'description') {
  const game = mountGame({ initialInput: 'touch', overrides: { swipeToMove: true } })
  if (kind === 'local') game.tap('START')
  else game.receive(kind === 'server' ? inventory : description)
  game.frame()
  game.sent.length = 0
  const gesture = (target: Element, { dx = 0, pointerType = 'touch', button = 0, cancel = false } = {}) => {
    game.pointer('pointerdown', target, { pointerType, button })
    if (dx) game.pointer('pointermove', target, { pointerType, button, clientX: 100 + dx })
    game.pointer(cancel ? 'pointercancel' : 'pointerup', target, { pointerType, button, clientX: 100 + dx })
  }
  return { ...game, gesture }
}

describe('outside a menu or popup', () => {
  it('sends Escape on a touch lift outside a Crawl menu', () => {
    const game = withMenu('server')
    game.pointer('pointerdown', game.canvas(), { pointerType: 'touch' })
    expect(game.sent).toEqual([])
    game.pointer('pointerup', game.canvas(), { pointerType: 'touch' })
    expect(game.sent).toEqual([cm.key(27)])
  })

  it('closes a local menu on touch without sending a Crawl command', () => {
    const game = withMenu('local')
    expect(game.element('.sysmenu')).toBeDefined()
    game.gesture(game.canvas())
    expect(game.screen.root.querySelector('.sysmenu')).toBeNull()
    expect(game.sent).toEqual([])
  })

  it.each(['server', 'local'] as const)('keeps the %s menu open on inside taps and gaps in the touch bar', kind => {
    const game = withMenu(kind)
    game.gesture(game.element('.popup'))
    game.gesture(game.element('.touchbar'))
    expect(game.screen.root.querySelector('.popup')).not.toBeNull()
    expect(game.sent).toEqual([])
  })

  it('sends directional menu keys for swipes and ignores a cancelled gesture', () => {
    const game = withMenu('server')
    game.gesture(game.canvas(), { cancel: true })
    expect(game.sent).toEqual([])
    game.gesture(game.canvas(), { dx: -80 })
    game.gesture(game.canvas(), { dx: 80 })
    expect(game.sent).toEqual([cm.key(Keys.CK_RIGHT), cm.key(Keys.CK_LEFT)])
  })

  it('turns a local menu tab on an outside swipe without closing the menu', () => {
    const game = withMenu('local')
    const tab = () => game.element('.sysmenu [aria-selected="true"]').textContent
    const initial = tab()
    game.gesture(game.canvas(), { dx: -80 })
    expect(tab()).not.toBe(initial)
    game.gesture(game.canvas(), { dx: 80 })
    expect(tab()).toBe(initial)
    expect(game.sent).toEqual([])
  })

  it.each(['server', 'local'] as const)('leaves a %s menu open on an outside mouse press', kind => {
    const game = withMenu(kind)
    game.pointer('pointerdown', game.canvas(), { pointerType: 'mouse' })
    game.pointer('pointerdown', game.element('.popup'), { pointerType: 'mouse', button: 2 })
    expect(game.screen.root.querySelector('.popup')).not.toBeNull()
    expect(game.sent).toEqual([])
  })

  it('sends Escape for a mouse press outside a description or a right press inside', () => {
    const game = withMenu('description')
    game.gesture(game.canvas(), { pointerType: 'mouse' })
    game.gesture(game.element('.popup'), { pointerType: 'mouse', button: 2 })
    expect(game.sent).toEqual([cm.key(27), cm.key(27)])
  })
})
