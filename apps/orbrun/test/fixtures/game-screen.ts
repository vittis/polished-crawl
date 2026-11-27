import { afterEach, vi } from 'vitest'
import { MouseMode, type ClientMessage, type CloseReason, type Connection, type ServerMessage } from '@orbrun/webtiles'
import { cellKey, type MapRenderer } from '@orbrun/scene'
import { fixtureGamedata } from '../../../../packages/scene-webtiles/test/recording'
import { GameScreen, type GameHooks } from '../../src/game'
import { GamepadInput, type VirtualButton } from '../../src/gamepad'
import { Session } from '../../src/session'
import { defaultSettings } from '../../src/settings'
import { settingsPanel } from '../../src/settings-panel'

const data = await fixtureGamedata()
const floor = data.dngn.id('FLOOR_GREY_DIRT')!
const playerTile = data.player.id('BASE_HUMAN')!

class TestConnection implements Connection {
  readonly kind = 'remote'
  readonly gamedataBase = 'https://game.example.invalid/'
  open = true
  readonly sent: ClientMessage[] = []
  private message?: (message: ServerMessage) => void
  private closed?: (reason: CloseReason) => void

  send(message: ClientMessage) { this.sent.push(message) }
  onOpen() { return () => {} }
  onMessage(handler: (message: ServerMessage) => void) {
    this.message = handler
    return () => { this.message = undefined }
  }
  onClose(handler: (reason: CloseReason) => void) {
    this.closed = handler
    return () => { this.closed = undefined }
  }
  receive(...messages: ServerMessage[]) {
    for (const message of messages) this.message?.(message)
  }
  close() {
    this.open = false
    this.closed?.({ code: 1000, reason: '', clean: true })
  }
}

function rendererSpy() {
  return {
    mount: vi.fn<MapRenderer['mount']>(),
    setTiles: vi.fn<MapRenderer['setTiles']>(),
    setScene: vi.fn<MapRenderer['setScene']>(),
    setCursor: vi.fn<MapRenderer['setCursor']>(),
    pick: vi.fn<MapRenderer['pick']>(() => cellKey(1, 0)),
    render: vi.fn<MapRenderer['render']>(),
    resize: vi.fn<MapRenderer['resize']>(),
    destroy: vi.fn<MapRenderer['destroy']>(),
  } satisfies MapRenderer
}

let dispose: (() => void) | undefined
afterEach(() => dispose?.())

/** Mount a production screen with a local message transport and explicitly stepped display frames. */
export function mountGame({ initialInput = 'pad', overrides, renderer }: {
  initialInput?: GameHooks['initialInput']
  overrides?: Partial<ReturnType<GameHooks['settings']>>
  renderer?: GameHooks['renderer']
} = {}) {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextId = 0
  const request = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
    callbacks.set(++nextId, callback)
    return nextId
  })
  const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { callbacks.delete(id) })
  const connection = new TestConnection()
  const session = new Session({
    id: 'fixture', name: 'Fixture', host: 'game.example.invalid',
    ws: 'wss://game.example.invalid/socket', http: 'https://game.example.invalid',
  }, null, connection)
  const receive = (...messages: ServerMessage[]) => connection.receive(...messages)
  session.gamedata = data
  receive(
    { msg: 'game_started' },
    { msg: 'player', name: 'Fixture', species: 'Human', pos: { x: 0, y: 0 }, place: 'Dungeon', depth: 1, xl: 1, hp: 20, hp_max: 20 },
    { msg: 'input_mode', mode: MouseMode.COMMAND },
    { msg: 'map', player_on_level: true, vgrdc: { x: 0, y: 0 }, cells: [-1, 0, 1].flatMap(y =>
      [-1, 0, 1, 2].map(x => ({ x, y, g: '.', t: { bg: floor, doll: [[playerTile, 0]] } }))) },
  )
  const host = document.createElement('div')
  document.body.append(host)
  // Happy DOM does not lay out children. Give the mounted root a desktop-sized viewport.
  const append = host.append.bind(host)
  host.append = (...children) => {
    for (const child of children) if (child instanceof HTMLElement) {
      Object.defineProperties(child, { clientWidth: { value: 1280 }, clientHeight: { value: 800 } })
    }
    append(...children)
  }
  const settings = { ...defaultSettings, hints: 'off' as const, ...overrides }
  const gamepad = new GamepadInput()
  const renderers: { view: Parameters<NonNullable<GameHooks['renderer']>>[0]; renderer: ReturnType<typeof rendererSpy> }[] = []
  const screen: GameScreen = new GameScreen(host, session, {
    initialInput, gamepad, settings: () => settings, onSystem() {},
    settingsPanel: (group, back, controls) => settingsPanel(group, { editTouchLayout: () => screen.openTouchLayoutSettings(), back, controls, onchange: () => screen.applySettings() }),
    renderer: renderer ?? (view => {
      const renderer = rendererSpy()
      renderers.push({ view, renderer })
      return renderer
    }),
  })
  const unroute = gamepad.on(event => screen.pad(event))
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    screen.destroy()
    unroute()
    session.close()
    host.remove()
  }
  dispose = () => {
    destroy()
    request.mockRestore()
    cancel.mockRestore()
    vi.useRealTimers()
    dispose = undefined
  }
  const advance = (ms: number) => vi.advanceTimersByTime(ms)
  const frame = (ms = 16) => {
    advance(ms)
    for (const [id, callback] of [...callbacks]) {
      if (callbacks.delete(id)) callback(performance.now())
    }
  }
  frame(0)
  const element = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const found = screen.root.querySelector<T>(selector)
    if (!found) throw new Error(`Missing mounted game element ${selector}`)
    return found
  }
  const key = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init })
    window.dispatchEvent(event)
    return event
  }
  const press = (button: VirtualButton, touch = false) => gamepad.virtualDown(button, performance.now(), touch)
  const release = (button: VirtualButton, touch = false, cancelled = false) =>
    gamepad.virtualUp(button, performance.now(), touch, cancelled)
  const tap = (button: VirtualButton, touch = false) => { press(button, touch); release(button, touch) }
  const pointer = (type: string, target: Element, init: PointerEventInit = {}) => {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
      pointerType: 'mouse', clientX: 100, clientY: 100, ...init })
    Object.defineProperty(event, 'timeStamp', { value: performance.now() })
    target.dispatchEvent(event)
  }
  return {
    screen, session, settings, gamepad, receive, advance, frame, key, press, release, tap, pointer, element, destroy,
    sent: connection.sent, renderers, canvas: () => element<HTMLCanvasElement>('canvas.view'),
  }
}
