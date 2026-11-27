// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { cm, Keys, mapKey, MenuFlag, MouseMode, MSGCH, UiState, type ServerMessage } from '@orbrun/webtiles'
import type { Dir8 } from '@orbrun/scene'
import { HOLD_MS } from '../src/bindings'
import { mountGame } from './fixtures/game-screen'

const escape = cm.key(27)
const rest = cm.key(Keys.CK_SHIFT_CLEAR)
const autofight = cm.key(Keys.TAB)
const oneItemMenu: ServerMessage = {
  msg: 'menu', tag: 'inventory', flags: MenuFlag.ARROWS_SELECT, title: { text: 'Inventory' },
  items: [{ text: 'a - a dagger', hotkeys: [97], level: 2 }],
}
const map = { msg: 'ui_state', state: UiState.VIEW_MAP }
const target = { msg: 'input_mode', mode: MouseMode.TARGET }
const prompt = { msg: 'input_mode', mode: MouseMode.PROMPT }
const processing = { msg: 'input_mode', mode: MouseMode.NORMAL }
const command = { msg: 'input_mode', mode: MouseMode.COMMAND }

describe('hold and repeat at the game screen', () => {
  it('sends Escape once on B press and cancels a pending rest', () => {
    const game = mountGame()
    game.press('LB')
    game.press('B')
    expect(game.sent).toEqual([escape])
    game.frame(HOLD_MS)
    game.screen.pad({ type: 'repeat', button: 'B', n: 1 })
    game.release('B')
    game.release('LB')
    expect(game.sent).toEqual([escape])
  })

  it('sends Wait only on a short release and spends no turn on a cancelled press', () => {
    const game = mountGame()
    game.press('LB')
    game.frame(100)
    expect(game.sent).toEqual([])
    game.release('LB', false, true)
    expect(game.sent).toEqual([])
    game.press('LB')
    game.frame(100)
    expect(game.sent).toEqual([])
    game.release('LB')
    expect(game.sent).toEqual([cm.input('.')])
  })

  it('shows progress during the hold, rests once at the threshold, then clears the cue', () => {
    const game = mountGame()
    game.press('LB')
    game.frame(HOLD_MS / 4)
    expect(game.element('.chip.LB.holding').style.getPropertyValue('--hold')).toBe('0.25')
    game.frame(HOLD_MS * 3 / 4 - 1)
    expect(game.sent).toEqual([])
    game.frame(1)
    expect(game.sent).toEqual([rest])
    expect(game.screen.root.querySelector('.chip.LB.holding')).toBeNull()
    game.frame(HOLD_MS)
    game.release('LB')
    expect(game.sent).toEqual([rest])

    game.receive(processing, command)
    game.press('LB')
    game.frame(100)
    expect(game.screen.root.querySelector('.chip.LB.holding')).not.toBeNull()
    game.release('LB')
    game.frame()
    expect(game.screen.root.querySelector('.chip.LB.holding')).toBeNull()
    expect(game.sent).toEqual([rest, cm.input('.')])
  })

  it('rests when release crosses the threshold between display frames', () => {
    const game = mountGame()
    game.press('LB')
    game.frame(HOLD_MS - 1)
    expect(game.sent).toEqual([])
    game.advance(2)
    game.release('LB')
    expect(game.sent).toEqual([rest])
  })

  it('defers automatic spell lookup while a touch hold is pending', () => {
    const game = mountGame({ initialInput: 'touch' })
    game.frame(490)
    game.press('LB', true)
    game.frame(100)
    expect(game.sent).toEqual([])
    game.release('LB', true, true)
    game.frame()
    expect(game.sent).toEqual([cm.input('I')])
  })

  it('cycles the quiver both ways when a short or long Y press ends in the fire aim', () => {
    const game = mountGame()
    game.receive({ msg: 'msgs', messages: [{ text: 'Press: f - fire, Q - select action', channel: MSGCH.PROMPT }] }, target)
    game.press('Y')
    game.frame(100)
    expect(game.sent).toEqual([])
    game.release('Y')
    expect(game.sent).toEqual([cm.input(')')])
    game.press('Y')
    game.frame(HOLD_MS)
    game.release('Y')
    expect(game.sent).toEqual([cm.input(')'), cm.input('(')])
  })

  it('disarms a pending rest when the server opens a menu', () => {
    const game = mountGame()
    game.press('LB')
    game.receive(oneItemMenu)
    game.frame(HOLD_MS)
    game.receive({ msg: 'close_menu' })
    game.release('LB')
    expect(game.sent.filter(m => m.msg !== 'menu_hover')).toEqual([])
  })

  it('cancels a pending rest when another action is taken', () => {
    const game = mountGame()
    game.press('LB')
    game.frame(100)
    game.tap('RT')
    game.frame(HOLD_MS)
    game.release('LB')
    expect(game.sent).toEqual([autofight])
  })

  it('repeats autofight in command mode and stops at a new aim', () => {
    const game = mountGame()
    const repeat = () => game.screen.pad({ type: 'repeat', button: 'RT', n: 1 })
    game.press('RT')
    repeat()
    expect(game.sent).toEqual([autofight])

    game.receive(processing, { msg: 'player', turn: 1 })
    game.frame(500)
    repeat()
    expect(game.sent).toEqual([autofight])

    // A prompt can accompany a final same-batch redraw.
    game.receive(command, { msg: 'map', cells: [] })
    game.frame(19)
    repeat()
    expect(game.sent).toEqual([autofight])
    game.frame(1)
    repeat()
    expect(game.sent).toEqual([autofight, autofight])

    game.receive(target)
    game.frame(100)
    repeat()
    game.release('RT')
    expect(game.sent).toEqual([autofight, autofight])
  })

  it('shares the pace across touch Explore and held Tab without queuing extra actions', () => {
    const game = mountGame({ initialInput: 'touch' })
    const explore = cm.input('o')
    game.tap('LT', true)
    game.receive(processing, { msg: 'player', turn: 1, pos: { x: 1, y: 0 } })
    game.frame(100)
    expect(game.renderers[0].renderer.setScene.mock.lastCall?.[0].player).toMatchObject({ x: 1, y: 0 })
    game.tap('LT', true)
    game.key('Tab')
    for (let i = 0; i < 5; i++) game.key('Tab', { repeat: true })
    expect(game.sent).toEqual([explore])

    game.receive({ msg: 'player', turn: 2, pos: { x: 2, y: 0 } }, command)
    game.frame(100)
    expect(game.renderers[0].renderer.setScene.mock.lastCall?.[0].player).toMatchObject({ x: 2, y: 0 })
    expect(game.sent).toEqual([explore])
    game.key('Tab', { repeat: true })
    expect(game.sent).toEqual([explore, autofight])

    game.receive(processing, { msg: 'msgs', messages: [{ text: 'No target in view!' }] }, command)
    game.frame(100)
    game.tap('LT', true)
    expect(game.sent).toEqual([explore, autofight, explore])
  })

  it('counts network latency toward the cadence and shares the gate across Autofire, movement and Wait', () => {
    const game = mountGame()
    const autofire = cm.key(Keys.CK_SHIFT_TAB)
    game.key('Tab', { shiftKey: true })
    game.receive(command)
    game.advance(150)
    game.key('p')
    game.key('ArrowRight')
    game.key('.', { code: 'Period', keyCode: 190 })
    expect(game.sent).toEqual([autofire])

    game.receive(processing, { msg: 'player', turn: 1 }, command)
    game.frame(19)
    game.key('ArrowRight', { repeat: true })
    expect(game.sent).toEqual([autofire])
    game.frame(1)
    game.key('ArrowRight', { repeat: true })
    expect(game.sent).toEqual([autofire, cm.input('l')])

    game.receive(processing, { msg: 'player', turn: 2, pos: { x: 1, y: 0 } }, command)
    game.frame(64)
    game.key('p')
    expect(game.sent).toEqual([autofire, cm.input('l')])
    game.frame(1)
    game.key('p')
    game.key('Tab', { shiftKey: true })
    game.key('Escape')
    expect(game.sent).toEqual([autofire, cm.input('l'), cm.input('p'), escape])
  })

  it('keeps a held explore key out of a prompt and lets fresh answers through immediately', () => {
    const game = mountGame()
    game.key('o')
    game.receive(processing, prompt)
    game.key('o', { repeat: true })
    expect(game.sent).toEqual([cm.input('o')])
    game.key('o')
    game.key('Escape')
    expect(game.sent).toEqual([cm.input('o'), cm.input('o'), escape])
  })

  it.each([
    ['Explore', 'o', {}, cm.input('o')],
    ['Rest', '5', {}, cm.input('5')],
    ['Run', 'ArrowRight', { shiftKey: true }, cm.input('L')],
  ] as const)('lets a compass input interrupt %s after Crawl starts spending turns', (_name, key, modifiers, automatic) => {
    const game = mountGame()
    const step = cm.input('h')
    game.key(key, modifiers)
    game.receive(processing)
    game.key('ArrowLeft')
    expect(game.sent).toEqual([automatic])

    game.receive({ msg: 'player', turn: 1 })
    game.key('ArrowLeft')
    game.key('ArrowLeft', { repeat: true })
    game.key('o')
    expect(game.sent).toEqual([automatic, step])

    game.receive(command)
    game.frame(80)
    game.key('ArrowLeft')
    expect(game.sent).toEqual([automatic, step, step])
  })

  it('recovers when Crawl confirms a turn and reannounces the command prompt without an interim mode', () => {
    const game = mountGame()
    game.key('Tab')
    game.receive({ msg: 'player', turn: 1 }, command)
    game.frame(100)
    game.key('Tab')
    expect(game.sent).toEqual([autofight, autofight])
  })

  it('paces held steps on clear ground before a slow reply and caps the outstanding steps', () => {
    const game = mountGame()
    const floor = game.session.state.map.cells.get(mapKey(1, 0))!
    game.receive({ msg: 'map', cells: [{ ...floor, x: 3 }, { ...floor, x: 4 }] })
    const step = cm.input('l')
    game.key('ArrowRight')
    game.advance(64)
    game.key('ArrowRight', { repeat: true })
    expect(game.sent).toEqual([step])
    game.advance(1)
    game.key('ArrowRight', { repeat: true })
    game.advance(65)
    game.key('ArrowRight', { repeat: true })
    expect(game.sent).toEqual([step, step, step])

    game.advance(170)
    game.key('ArrowRight', { repeat: true })
    game.key('ArrowLeft')
    game.key('Tab')
    expect(game.sent).toEqual([step, step, step])

    game.receive(processing, { msg: 'player', turn: 1, pos: { x: 1, y: 0 } }, command)
    game.key('ArrowRight', { repeat: true })
    expect(game.sent).toEqual([step, step, step, step])
    game.receive(processing, prompt)
    game.key('ArrowRight', { repeat: true })
    expect(game.sent).toEqual([step, step, step, step])
    game.receive(command)
    game.advance(100)
    game.key('ArrowLeft')
    expect(game.sent).toEqual([step, step, step, step, cm.input('h')])
  })

  it('waits for confirmation before sending a step into unexplored ground', () => {
    const game = mountGame()
    game.key('ArrowRight')
    game.advance(65)
    game.key('ArrowRight', { repeat: true })
    game.advance(65)
    game.key('ArrowRight', { repeat: true })
    expect(game.sent).toEqual([cm.input('l'), cm.input('l')])
  })

  it('opens examine on R3 press without repeating into the aim', () => {
    const game = mountGame()
    game.press('R3')
    game.receive(target)
    game.screen.pad({ type: 'repeat', button: 'R3', n: 1 })
    game.release('R3')
    expect(game.sent).toEqual([cm.input('x')])
  })
})

describe('controls across server and local overlays', () => {
  it.each([
    ['menu', [oneItemMenu], [{ msg: 'close_menu' }], escape],
    ['aim', [target], [command], escape],
    ['map', [map], [{ msg: 'ui_state', state: UiState.NORMAL }], escape],
    ['prompt', [prompt], [command], escape],
    ['yes/no', [{ msg: 'msgs', messages: [{ text: 'Really attack? (y/N)', channel: MSGCH.PROMPT }] },
      { msg: 'input_mode', mode: MouseMode.YESNO }], [command], cm.input('N')],
    ['popup', [{ msg: 'ui-push', type: 'describe-monster', title: 'Goblin', body: 'It is asleep.' }], [{ msg: 'ui-pop' }], escape],
    ['dialog', [{ msg: 'show_dialog', html: '<button data-key="N">Cancel</button>' }], [{ msg: 'hide_dialog' }], cm.inputBytes([78])],
    ['more', [{ msg: 'msgs', more: true }], [{ msg: 'msgs', more: false }], escape],
  ] satisfies [string, ServerMessage[], ServerMessage[], ReturnType<typeof cm.key>][])(
    'B backs out or continues in %s without a follow-up command on release', (_name, opening, closing, expected) => {
      const game = mountGame()
      game.receive(...opening)
      game.frame()
      game.sent.length = 0
      game.press('B')
      expect(game.sent.filter(m => m.msg !== 'menu_scroll')).toEqual([expected])
      game.receive(...closing)
      game.frame(HOLD_MS * 2)
      game.release('B')
      expect(game.sent.filter(m => m.msg !== 'menu_scroll')).toEqual([expected])
    },
  )

  it.each(['LB', 'X'] as const)('holding %s in a server menu cannot act again after it closes', button => {
    const game = mountGame()
    game.receive({ ...oneItemMenu, last_hovered: 1, items: [
      { text: 'Weapons', level: 1 }, { text: 'a - a dagger', hotkeys: [97], level: 2 },
      { text: 'Armour', level: 1 }, { text: 'b - a robe', hotkeys: [98], level: 2 },
    ] })
    game.frame()
    game.sent.length = 0
    game.press(button)
    const expected = button === 'X' ? cm.textInput("'") : cm.menuHover(3)
    expect(game.sent.filter(m => m.msg !== 'menu_scroll')).toEqual([expected])
    game.receive({ msg: 'close_menu' })
    game.frame(HOLD_MS)
    game.release(button)
    expect(game.sent.filter(m => m.msg !== 'menu_scroll')).toEqual([expected])
    expect(game.screen.root.querySelector('.action-tabs')).toBeNull()
  })

  it('opens the system menu on Start and closes it with the same button', () => {
    const game = mountGame()
    game.press('START')
    expect(game.element('.sysmenu').textContent).toContain('Save and exit')
    game.frame(HOLD_MS)
    game.release('START')
    expect(game.screen.root.querySelector('.sysmenu')).not.toBeNull()
    game.tap('START')
    expect(game.screen.root.querySelector('.sysmenu')).toBeNull()
    expect(game.sent).toEqual([])
  })

  it('keeps Start as the opener after entering Settings and allows reopening after B', () => {
    const game = mountGame()
    game.tap('START')
    const settings = [...game.element('.sysmenu').querySelectorAll<HTMLElement>('[role=button]')]
      .find(row => row.textContent?.includes('Settings'))
    expect(settings).toBeDefined()
    settings!.click()
    expect(game.screen.root.querySelector('.sysmenu')).toBeNull()
    expect(game.screen.root.querySelector('.settings-groups')).not.toBeNull()
    game.tap('START')
    expect(game.screen.root.querySelector('.popup')).toBeNull()
    game.press('START')
    game.release('START')
    game.press('B')
    game.frame(HOLD_MS)
    game.release('B')
    expect(game.screen.root.querySelector('.sysmenu')).toBeNull()
    game.tap('START')
    expect(game.screen.root.querySelector('.sysmenu')).not.toBeNull()
    expect(game.sent).toEqual([])
  })

  it('routes bumpers and keyboard paging to an open local menu without sending game keys', () => {
    const game = mountGame()
    game.tap('START')
    const tab = () => game.element('.sysmenu [aria-selected="true"]').textContent
    const initial = tab()
    game.tap('RB')
    expect(tab()).not.toBe(initial)
    game.tap('LB')
    expect(tab()).toBe(initial)
    const focused = () => game.element('.sysmenu .focused').textContent
    const first = focused()
    game.key('PageDown')
    expect(focused()).not.toBe(first)
    game.key('PageUp')
    expect(focused()).toBe(first)
    expect(game.sent).toEqual([])
    game.press('LB')
    game.tap('B')
    game.frame(HOLD_MS)
    game.release('LB')
    expect(game.sent).toEqual([])
  })

  it('uses Start to submit a map chooser opened by L3 and B to cancel it', () => {
    const game = mountGame()
    game.receive(map)
    game.frame()
    game.tap('L3')
    expect(game.element('.popup .focused').textContent).toContain('Items on this level')
    game.tap('B')
    expect(game.screen.root.querySelector('.popup')).toBeNull()
    expect(game.sent).toEqual([])
    game.tap('L3')
    game.tap('START')
    expect(game.screen.root.querySelector('.popup')).toBeNull()
    expect(game.sent).toEqual([escape, cm.key(6)])
  })

  it('Select opens the level map and closes it on press without firing again on release', () => {
    const game = mountGame()
    game.tap('SELECT')
    expect(game.sent).toEqual([cm.input('X')])
    game.receive(map)
    game.frame()
    game.press('SELECT')
    game.frame(HOLD_MS)
    game.release('SELECT')
    expect(game.sent).toEqual([cm.input('X'), escape])
  })

  it('opens X’s action frame and sends only its spell command until Crawl replies', () => {
    const game = mountGame()
    game.tap('X')
    expect(game.element('.action-tabs .current').textContent).toBe('Spells')
    expect(game.sent).toEqual([cm.input('z')])
    game.tap('B')
    expect(game.screen.root.querySelector('.action-tabs')).toBeNull()
    expect(game.sent).toEqual([cm.input('z')])
  })

  it('Y opens the inventory through Crawl', () => {
    const game = mountGame()
    game.tap('Y')
    expect(game.sent).toEqual([cm.input('i')])
  })
})

describe('keyboard, compass and pointer routing', () => {
  it('passes native commands and F1 to Crawl', () => {
    const game = mountGame()
    const letters = ['q', 'r', 'z', 'm', 'g', 'G', '>', '<']
    for (const key of letters) game.key(key)
    game.key('F1', { code: 'F1' })
    expect(game.sent).toEqual([...letters.map(cm.input), cm.key(-265)])
  })

  it.each([MouseMode.COMMAND, MouseMode.MACRO])('sends F2–F5 to Crawl in input mode %s', mode => {
    const game = mountGame()
    game.receive({ msg: 'input_mode', mode })
    for (const key of ['F2', 'F3', 'F4', 'F5']) expect(game.key(key, { code: key }).defaultPrevented).toBe(true)
    expect(game.sent).toEqual([-266, -267, -268, -269].map(cm.key))
  })

  it('sends the prompt letter b raw and uses ArrowRight as a compass step in command mode', () => {
    const game = mountGame()
    game.receive(prompt)
    game.key('b')
    game.receive(command)
    game.key('ArrowRight')
    expect(game.sent).toEqual([cm.input('b'), cm.input('l')])
  })

  const directions = ['k', 'u', 'l', 'n', 'j', 'b', 'h', 'y']
  it.each([['command', command], ['aim', target], ['map', map]] as const)('sends all eight compass directions in %s', (_name, mode) => {
    const game = mountGame()
    game.receive(mode)
    for (const source of ['keyboard', 'lstick', 'dpad', 'touch'] as const) {
      game.sent.length = 0
      const touchButtons = ['DU', 'DUR', 'DR', 'DDR', 'DD', 'DDL', 'DL', 'DUL'] as const
      for (let dir = 0; dir < directions.length; dir++) {
        if (source === 'keyboard') game.key(directions[dir])
        else if (source === 'touch') game.tap(touchButtons[dir], true)
        else game.screen.pad({ type: 'dir', source, dir: dir as Dir8 })
        if (mode === command) {
          game.receive(processing, command)
          game.advance(80)
        }
      }
      expect(game.sent, source).toEqual(directions.map(cm.input))
    }
  })

  it('keeps X as the level map and Ctrl+X as the in-view list', () => {
    const game = mountGame()
    game.key('X', { shiftKey: true })
    game.key('x', { ctrlKey: true })
    expect(game.sent).toEqual([cm.input('X'), cm.key(24)])
  })

  it('uses right-stick panning only while the level map is open', () => {
    const game = mountGame()
    const pan = () => { for (let i = 0; i < 9; i++) game.screen.pad({ type: 'pan', dx: 1, dy: 0 }) }
    pan()
    expect(game.sent).toEqual([])
    game.receive(map)
    pan()
    expect(game.sent).toEqual([cm.input('l')])
  })

  it('aims with a fresh pointer move and discards hovering from before the aim', () => {
    const game = mountGame()
    game.pointer('pointermove', game.canvas())
    game.frame()
    game.receive(target)
    game.frame()
    expect(game.sent).toEqual([])
    game.pointer('pointermove', game.canvas(), { clientX: 120 })
    game.frame()
    expect(game.sent).toEqual([cm.targetCursor(1, 0)])
  })
})
