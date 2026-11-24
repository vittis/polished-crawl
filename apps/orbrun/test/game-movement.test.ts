// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { cm, Keys, MenuFlag, type ServerMessage } from '@orbrun/webtiles'
import { mountGame } from './fixtures/game-screen'

const close = { msg: 'close_menu' }
const abilities = { msg: 'menu', tag: 'ability', title: { text: 'Abilities' }, items: [] }
const flags = MenuFlag.PAGED_INVENTORY | MenuFlag.ARROWS_SELECT
const gear: ServerMessage = { msg: 'menu', tag: 'inventory', flags, title: { text: 'Gear: 1/52 gear slots' },
  items: [{ text: 'a - a dagger', hotkeys: [97], level: 2 }] }
const scrolls: ServerMessage = { msg: 'menu', tag: 'inventory', flags, title: { text: 'Scrolls:' },
  items: [{ text: 'd - a scroll of fear', hotkeys: [100], level: 2 }, { text: 'e - a scroll of identify', hotkeys: [101], level: 2 }] }

describe('remembered tabs and rows', () => {
  it.each([
    ['a step', { x: 1, y: 0 }, 1],
    ['a new level at the same coordinates', { x: 0, y: 0 }, 2],
  ] as const)('keeps the action tab while standing still and opens Spells after %s', (_label, pos, depth) => {
    const game = mountGame()
    game.receive(abilities, close, { msg: 'player', hp: 19 })
    game.frame()
    game.tap('X')
    expect(game.sent).toEqual([cm.input('a')])
    game.receive(abilities)
    game.frame()
    game.receive(close, { msg: 'player', pos, depth })
    game.frame()
    game.tap('X')
    expect(game.sent).toEqual([cm.input('a'), cm.input('z')])
  })

  it('reopens the pack at its saved page and row until a confirmed step', () => {
    const game = mountGame()
    game.receive({ msg: 'player', inv: {
      0: { name: 'dagger', quantity: 1, base_type: 0 },
      60: { name: 'scroll of fear', quantity: 1, base_type: 5 },
      61: { name: 'scroll of identify', quantity: 1, base_type: 5 },
    } }, { ...scrolls, last_hovered: 1 })
    game.frame()
    game.receive(close, { msg: 'player', hp: 19 })
    game.frame()
    const keys = () => game.sent.filter(m => m.msg === 'input' || m.msg === 'key')
    game.tap('Y')
    expect(keys()).toEqual([cm.input('i')])
    game.receive(gear)
    game.frame()
    expect(keys()).toEqual([cm.input('i'), cm.key(Keys.CK_RIGHT)])
    game.receive({ ...scrolls, replace: true, last_hovered: 0 })
    game.frame()
    expect(game.sent).toContainEqual(cm.menuHover(1))

    game.receive(close, { msg: 'player', pos: { x: 1, y: 0 } })
    game.frame()
    game.sent.length = 0
    game.tap('Y')
    game.receive(gear)
    game.frame()
    expect(keys()).toEqual([cm.input('i')])
  })
})
