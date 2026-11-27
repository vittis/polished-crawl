import { cm, mapKey, MouseMode, MSGCH, UiState, formattedStringToText, keyMessage, topMenu, type ClientMessage, type GameMessage, type GameState, type Monster, type Popup, type ServerMessage } from '@orbrun/webtiles'
import { cellKey, dirFromDelta, type CellKey, type MapRenderer, type Scene, type SceneCursor } from '@orbrun/scene'
import { ExploreDone } from './warnings'
import { Render25d } from '@orbrun/render-2.5d'
import { Render2d } from '@orbrun/render-2d'
import { escapeHtml, h, onDprChange } from './dom'
import type { Session } from './session'
import { deriveContext, deriveMode, type Context, type Mode } from './context'
import { CONTINUE, HOLD_MS, LEVEL_MAP, barLabels, buttonAction, contextualLabel, armsTapOrHold, holdAction, resolve, screenKey, touchExtraAction, touchLabels, typedInLog, type TouchLabel, type Action, type BindingLabel, type CommandCategory, type RelDir } from './bindings'
import { dungeonOptions, phoneDungeonDpr } from './dungeon-options'
import { Runner, type LastStep } from './runner'
import { Hud, rcFont, commandShortcutPreview, type MonsterHoverPreview } from './hud'
import { GridHost, isPhone } from './grid/host'
import { portraitLayout, resolveLayout, tabletLayout } from './grid/layout'
import { gameSplit, isPortrait, levelMapCanvas, levelMapSplit, touchBeside, touchColumn, TOUCH_BUTTON_H } from './grid/console'
import { MOBILE_SPELL_HEIGHT, mobileDungeonLayout } from './grid/mobile'
import { PANEL_CELL, panelScale } from './grid/panel'
import { Chat } from './chat'
import { CHARACTER_STATUS_TILE, commandTileId, monsterDescriptionText, Overlays, tileCanvas } from './overlays'
import { directionKey, isSettingsSliderKey, isTextEntry, keydownMessage } from './keys'
import { installFullscreenButton } from './fullscreen'
import { settingsGlyph } from './glyphs'
import { compassSector, isPadActivity, type Button, type GamepadInput, type PadEvent } from './gamepad'
import { gamepadHints, type HintMode, type PadHintEvidence } from './gamepad-hints'
import { SHORTCUTS } from './touch-shortcuts'
import { touchHints } from './touch-hints'
import { openPackKeys } from './pack-tabs'
import { OKAY_THEN, actionNeighbour, actionTab, actionTabOf, type ActionTabId } from './action-tabs'
import { type Settings } from './settings'
import { messageLinesOf, setAutoMessageLines, type SettingGroup } from './settings-rows'
import { PerfOverlay, type LogContext } from './perf'
import { FpsCounter } from './fps'
import { MapHold } from './map-hold'
import { swipeLean, swipeStep } from './swipe'
import { PointerDrag } from './pointer-drag'
import { requestRenderFrame, cancelFrame } from './frames'
import { SpellBar, SpellBook, isSpellPrompt, spellShort, type Spell } from './spell-bar'
import { CombatFeedback } from './combat-feedback'
import { audio } from './audio/controller'
import { presentCombat } from './combat-presentation'
import { NearDeath } from './near-death'
import { LevelUp } from './level-up'

/** at rest the frame loop sleeps, waking to run its body this often, so nothing that changed without waking it waits longer */
const IDLE_TICK_MS = 250
/** how long crawl and we must have said nothing before the spell bar looks its list up (spell-bar.ts) */
const SPELL_LOOK_STILL_MS = 500
/** what the spell bar takes from the log's last row down, in css px: a spell's art (hud.ts SPELL_SLOT) and a gap under it */
const SPELL_ROW_PX = 32 + 6
/** how long after the last thing that wanted a frame the loop keeps the display's rate before it parks (`awake`) */
const ACTIVE_MS = 500

/** Expire unechoed map cursor steps after one second. */
const MAP_CURSOR_WINDOW_MS = 1000
/** Minimum displacement for a movement swipe, in CSS pixels. */
const MOVE_SWIPE_MIN = 24
/** level-map cells per unit of right-stick pan while the map is open */
const MAP_PAN_RATE = 0.12
/** tileweb.cc `zoom_dungeon`: `tile_map_scale` in percent, a step a zoom key, clamped to 20..300 */
const MAP_SCALE_STEP = 10
const MAP_SCALE_MIN = 20
const MAP_SCALE_MAX = 300
/** game.js `show_diameter`: the cells across a full field of view, which the view is fitted to */
const SHOW_DIAMETER = 17
/** the screens a tap on the minimap closes (with Escape) instead of opening the level map over them */
const MINIMAP_CLOSES: ReadonlySet<Mode> = new Set(['more', 'menu', 'popup', 'newgame', 'text', 'yesno', 'prompt', 'crt', 'dialog'])

/**
 * A panel of ours leaves B unnamed (its footer says Esc, a pad player knows
 * B): a finger has no B to know, so the touch bar names it, the way back.
 */
function withBack(labels: BindingLabel[]): BindingLabel[] {
  // the press goes the pad's way (Game.pad: B cancels a panel of ours), so the label's action is never run
  return labels.some((l) => l.button === 'B') ? labels : [...labels, { button: 'B', label: 'Back', action: { kind: 'keys', label: 'Back', seq: [] }, contextual: false }]
}

/** A pointer press: a cell tap, a map drag, or a held map overview gesture. */
interface Drag {
  id: number
  /** Pointer position and click slop. */
  g: PointerDrag
  button: number
  touch: boolean
  hold?: number
  held?: boolean
  /** a finger dragging the level map: css px moved and not yet a whole cell (`panMapBy`) */
  pan?: { x: number; y: number }
}

/** The device the player touched last; the prompt strip is drawn for it. A finger is `touch`, a mouse or a pen `pointer`. */
export type InputDevice = 'pad' | 'keyboard' | 'pointer' | 'touch'

export type GamePresentation = 'dungeon' | 'flat-map'

export interface GameHooks {
  settings(): Settings
  /** one group's settings page, with what its Back does and what opens the Gamepad controls sheet (settings-panel.ts) */
  settingsPanel(group: SettingGroup, back: () => void, controls: () => void): { el: HTMLElement; rows: HTMLElement[] }
  onSystem(op: 'disconnect'): void
  gamepad: GamepadInput
  initialInput?: InputDevice
  /** Optional renderer override for the offline protocol test harness. */
  renderer?(presentation: GamePresentation): MapRenderer
}

/**
 * The game screen: canvas + renderer, HUD, overlays, input wiring.
 */
export class GameScreen {
  private feedback: CombatFeedback
  private nearDeath: NearDeath
  private levelUp: LevelUp
  private moreCue = h('span', { class: 'more-cue', hidden: true, 'aria-hidden': 'true' })
  root: HTMLElement
  private canvas = h('canvas', { class: 'view' })
  private renderer: MapRenderer
  /** the one console grid the screen is set on: the view, the sidebar and the messages are rectangles of its cells */
  private grid: GridHost
  /** what the last layout was made from; the split is redone only when it changes */
  private layoutKey = ''
  /** The active view; temporary maps include the hold across overview/search prompts. */
  private presentation: GamePresentation = 'dungeon'
  private get mapShown(): boolean { return this.presentation === 'flat-map' }
  private mapHold = new MapHold()
  private mapFloatingInteract = false
  private session: Session

  private heading: import("@orbrun/scene").Dir8 = 0
  private runner: Runner
  private hud: Hud
  private chat: Chat
  private overlays: Overlays
  private hooks: GameHooks
  private ctx: Context
  /** frame timing readout (perf.ts), on with `?perf` */
  private perf: PerfOverlay
  private fps = new FpsCounter()
  private unsub: (() => void)[] = []
  private _needsRender = true
  /**
   * Something for the frame loop to look at: a server message, a key, a
   * pointer, a pad event, a resize, a settings change. Cleared as a frame's
   * body starts, so anything set during it earns another frame. With it
   * clear and nothing moving, the loop's callback returns at once (`awake`).
   */
  private dirty = true
  /** the pointer moved over the view since the last pick, so the hovered cell may have changed */
  private pickDirty = false
  /** when the frame body last ran, for the idle safety tick (IDLE_TICK_MS) */
  private lastBody = 0
  /** when something last wanted a frame, for the run-on before the loop parks (ACTIVE_MS) */
  private lastActive = 0
  /** the settings as last read; cleared by `applySettings`, so a frame reads storage at most once */
  private settingsCache: Settings | null = null
  /** the context as last derived, and the key of what it was derived from */
  private ctxBase: Context | null = null
  private ctxKey = ''
  /** whether crawl last said explore has nowhere to go, and the level has given it nowhere since (warnings.ts) */
  private exploreDone = new ExploreDone()
  /** the revisions a frame was last drawn for: only a change to what is drawn (the map, the player, the UI stack) asks for a frame */
  private drawnRev = { map: -1, player: -1, ui: -1 }
  /** A game on this device has no one watching and no one to talk to: no chat box, no Chat row, F12 does nothing. */
  private get chatOn(): boolean {
    return !this.session.server.offline
  }
  /** A frame is needed; setting it also wakes the loop. */
  private get needsRender(): boolean {
    return this._needsRender
  }
  private set needsRender(v: boolean) {
    this._needsRender = v
    if (v) this.wake()
  }
  /** Something happened: the next frame runs its body, and a sleeping loop is started again at once. */
  private wake() {
    this.dirty = true
    if (!this.raf && !this.destroyed) {
      clearTimeout(this.idleTimer)
      this.idleTimer = 0
      // the clock starts again with the loop: an easing's first frame must not be handed the whole sleep as its dt
      this.lastFrame = performance.now()
      this.perf?.profile.resume()
      this.raf = requestRenderFrame(this.loop)
    }
  }
  /** Scene callbacks start both animations at the confirmed update's arrival time. */
  private sceneTime: number | undefined
  private inputContextDirty = false
  private lastFrame = performance.now()
  private raf = 0
  /** the safety tick while the loop sleeps (IDLE_TICK_MS) */
  private idleTimer = 0
  private destroyed = false
  private lastPos = { x: NaN, y: NaN }
  /**
   * The player's position as of the last server message, and every hop it
   * made since the scene was last rebuilt. The scene is rebuilt once per
   * frame, so a fast explore or travel (a busy frame, or `travel_delay -1`)
   * arrives as several cells at once: the hops keep the path the feet took,
   * so movement lessons can count confirmed cells across a batched update.
   */
  private hopPos = { x: NaN, y: NaN }
  private hops: { dx: number; dy: number }[] = []
  /** place and depth the player was last seen on, so a level change is known even when the coordinates barely move */
  private lastLevel = ''
  private loading = h('div', { class: 'loading' })
  private monsterDescriptions = new Map<number | Monster, {
    name: string; type?: number; baseType?: number; description: string
  }>()
  private monsterPreview: {
    x: number
    y: number
    monster: Monster
    show: (description: string) => void
    popup?: Popup
    deadline: number
    nextInspect?: { x: number; y: number; monster: Monster }
  } | null = null
  private pendingMonsterHover: { x: number; y: number; monster: Monster; preview: MonsterHoverPreview } | null = null
  private pressTimes = new Map<string, number>()
  /** A tap-or-hold button down and short of HOLD_MS: its corner prompt fills its hold ring (hud.ts showHold). */
  private holding: { button: Button; fraction: number } | null = null
  /**
   * The pad button that opened the client overlay on screen. Every menu a
   * button opens is a toggle: the same button puts it away, from whatever
   * screen it was carried into (a nested settings page closes with the whole
   * menu, as `close` already does for Select). Null when the overlay was
   * opened by mouse or keyboard, which have Esc.
   */
  private overlayOpener: Button | null = null
  /** The pointer now down closed a menu as it came down (`onDocPointer`); its click is spent on that. */
  private pointerClosed = false
  /** A finger down outside a menu: a tap closes it, a sideways swipe turns its tabs. */
  private outsideTouch: { id: number; x: number; y: number; t: number; close: () => void } | null = null
  private moveSwipe: { id: number; x: number; y: number } | null = null
  private lastCursor: SceneCursor | null = null
  private lastOptKey = ''
  private drag: Drag | null = null
  /** Two fingers on the level map: where each is, how far apart they came down, and the zoom steps sent so far (`pinchMap`). */
  private pinch: { pts: Map<number, { x: number; y: number }>; d0: number; scale0: number; sent: number } | null = null
  /** Lets go of a drag with no click behind it: the window lost focus, or the button was released out of sight. */
  private cancelDrag: () => void = () => {}
  /** One per screen, however many canvases it goes through: a renderer swap must not leave the old canvas's listener behind. */
  private onWindowBlur?: () => void
  /** Wheel scrolled since the last map scale change, in css pixels; a trackpad arrives in crumbs. */
  private wheel = 0
  /** Shift was down for the wheel crumbs counted so far: distance and height do not pool each other's scroll. */
  private wheelShift = false
  /** where the pointer is aiming, in canvas css pixels: the hovering mouse, or the finger on a touch screen */
  private hover: { x: number; y: number } | null = null
  /** dungeon_renderer.js tooltip_timeout: the cell tooltip waits half a second under a still pointer */
  private tooltipTimer = 0
  /** the pointer moved since the last target sent: keyboard cursor moves and turns never fight the mouse */
  private hoverMoved = false
  private lastTargetSent = -1
  /** the cursor shown is the pointer's own selection, not one the server placed: never face it */
  private cursorIsOurs = false
  /**
   * the mouse has moved since the last keyboard or pad action: the pointer's
   * own selection shows only then. A key or button hides it until the mouse
   * moves again, so a player on the keys is not shown a cell the reticle
   * happens to rest on after a turn or a step.
   */
  private pointerLive = false
  /** Last picked cell; unchanged frames reuse it. */
  private pickMemo: CellKey | null | undefined
  /** the canvas's place on the screen, from the last relayout, in css px */
  private viewPx: { left: number; top: number; width: number; height: number } | null = null
  /** The last tap on the level map: where the cursor stood and where it was sent (`tapMapCursor`). */
  private mapTap: { from: { x: number; y: number }; to: { x: number; y: number }; t: number } | null = null
  /** css px of the level map's canvas under the touch bar (`relayout`) */
  private mapFoot = 0
  /**
   * What the player touched last: the prompt strip is drawn for it (pad
   * glyphs, key caps, nothing for the mouse). Merely plugging in a pad is
   * not input; the front end passes along the device used to launch play.
   */
  private lastInput: InputDevice = 'keyboard'
  private usedTouchWithFinePointer = false
  private padHints = gamepadHints()
  private touchHints = touchHints()
  /** the game (its player, which a new game replaces) in which crawl has asked for a command: before that, as the species are coming, there is no map to teach */
  private commandedIn: object | null = null
  /** the pack's page last up (pack-tabs.ts), which Y opens it on again until the player moves (`forgetTabs`) */
  private packPage: string | null = null
  /** the item the cursor was last on in each of the pack's pages, by its letter: Y puts the cursor back on it */
  private packRow = new Map<string, number>()
  /** Y opened the pack: the page it is turning to, and whether the pack has been up since */
  private packReturn: { page: string; seen: boolean } | null = null
  /** X's actions as tabs (action-tabs.ts): the one up last, which X opens again until the player moves (`forgetTabs`) */
  private actionTabUp: ActionTabId = 'spells'
  /**
   * A turn to one of X's tabs under way (`openActionTab`): the menu left
   * being put away (`closing`), a tab's key sent and its menu or crawl's
   * refusal awaited (`sent`), or, for Spells, `z`'s question answered with
   * `*` (`listing`). `target` is the tab the player is turning to, `sent`
   * the one whose key is out: presses quicker than crawl move the target
   * only, and the turn goes on from whatever lands. `last` is the log's last
   * line when the key went: crawl's answer is a line after it.
   */
  private actionTurn: { target: ActionTabId; sent: ActionTabId | null; stage: 'closing' | 'sent' | 'listing'; last?: GameMessage; t: number } | null = null
  private padStep: LastStep | null = null
  /** the spells the touch spell bar shows, looked up quietly (spell-bar.ts) */
  private spellBook: SpellBook
  /** A shortcut starts a cast. A tap on its active aim confirms the target. */
  private spellBar: SpellBar
  private fullscreenButton?: HTMLButtonElement
  private systemMenu = h('button', { type: 'button', class: 'system-menu-button', hidden: true, 'aria-label': 'Open system menu', title: 'System menu' }, settingsGlyph())
  private systemMenuArt: Session['gamedata'] = null
  /** when the last message went to the server, and the last came from it, for the spell list's look to wait for a still moment */
  private lastSent = 0
  private lastHeard = 0
  /** the touch bar's last buttons, held through the spell bar's cast prompt */
  private lastTouch: { labels: TouchLabel[]; mode: Mode } | null = null
  /** right-stick travel accumulated toward the next level-map cursor step */
  private mapPan = { x: 0, y: 0 }

  constructor(host: HTMLElement, session: Session, hooks: GameHooks) {
    // first: anything below that asks for a frame (`wake`) schedules the loop
    this.loop = this.loop.bind(this)
    this.session = session
    this.feedback = new CombatFeedback(session.state)
    this.unsub.push(audio().attach(session))
    this.nearDeath = new NearDeath(session.state)
    this.levelUp = new LevelUp(session.state)
    this.hooks = hooks
    this.root = h('div', { class: 'screen game' })
    host.append(this.root)
    const fullscreen = new AbortController()
    this.fullscreenButton = installFullscreenButton(this.root, fullscreen.signal)
    this.unsub.push(() => fullscreen.abort())
    this.root.append(this.canvas, this.loading, this.fps.root, this.systemMenu)
    this.systemMenu.addEventListener('click', ev => {
      this.prepareInput()
      if (this.systemMenu.hidden || !this.canOpenSystemMenu()) return
      if (ev instanceof PointerEvent && ev.pointerType === 'touch') this.inputFrom('touch')
      this.inputActed()
      this.uiOp('system')
      this.wake()
    })
    this.root.append(this.nearDeath.root, this.levelUp.root, this.levelUp.announcement, this.moreCue)
    this.perf = new PerfOverlay(this.root, () => this.perfContext())
    this.unsub.push(this.perf.watch(session))
    this.grid = new GridHost(this.root, this.textPx())
    // a phone's text comes down to fit a phone's console (host.ts PHONE_COLS), asked again at every resize
    this.grid.setLeast(() => this.settings().layoutPreset !== 'Desktop' && isPhone())
    this.shrinkText()
    this.grid.onfit = () => {
      this.settingsCache = null // Device-dependent defaults follow the fitted grid.
      this.shrinkText()
      this.relayout(true)
    }
    this.renderer = this.makeRenderer()
    this.hud = new Hud(this.root, {
      onBarAction: (a) => this.runner.execute(a),
      onMinimapClick: () => this.minimapTap(),
      onMinimapInspect: point => {
        if (!(this.renderer instanceof Render25d)) return
        this.renderer.inspectCenter = point
        this.needsRender = true
      },
      onInspectMonster: (x, y, monster) => this.inspectMonster(x, y, monster),
      onPreviewMonster: (x, y, monster, preview) => this.inspectMonster(x, y, monster, preview),
      onPanelHover: () => this.wake(),
      // action_panel.js: items act only in command mode
      onPanelItem: (slot, describe) => {
        if (this.session.state.inputMode !== MouseMode.COMMAND) return
        this.runner.send(describe ? cm.invItemDescribe(slot) : cm.invItemAction(slot))
      },
      onPanelShow: () => this.setPanelShown(true),
      onPanelHide: () => this.setPanelShown(false),
      // action_panel.js: the game-menu button acts only in command mode
      onGameMenu: () => {
        if (this.session.state.inputMode === MouseMode.COMMAND) this.runner.send(cm.mainMenuAction())
      },
      // WebTiles' own settings menu here is the panel's rc options; Polished Crawl's settings screen is where those live
      onPanelSettings: () => this.overlays.showSettings(),
      // the touch bar's buttons are the pad's, pressed by a finger: the press goes the pad's way (`pad`), the device is the finger
      onTouchButton: (button, down, cancelled) => {
        this.inputFrom('touch')
        if (down) this.hooks.gamepad.virtualDown(button, performance.now(), true)
        else this.hooks.gamepad.virtualUp(button, performance.now(), true, cancelled)
      },
      onSpellTap: (spell) => this.spellTap(spell),
      onSpellMore: (describe) => this.spellMore(describe),
      onTouchSwitch: (key) => {
        this.inputFrom('touch')
        this.overlays.sendSwitch(key)
      },
      onLayoutSaved: sizingChanged => {
        if (sizingChanged) this.applySettings()
        this.wake()
      },
      onEditLayout: () => {
        this.cancelMoveSwipe()
        this.hooks.gamepad.virtualRelease()
        this.tapArmed.clear()
        this.runner.abortSequence()
      },
      onShortcut: id => {
        if (this.destroyed || document.hidden || this.hud.editingLayout || this.chat.capturing) return
        this.inputFrom('touch')
        this.prepareInput()
        if (this.ctx.mode !== 'command' || this.overlays.hasClientOverlay || this.session.watching) return
        const shortcut = SHORTCUTS.get(id)
        if (!shortcut) return
        this.inputActed()
        this.wake()
        if (shortcut.source) {
          const live = touchLabels(barLabels(this.ctx), this.ctx).find(l => l.cell === shortcut.source)
          if (live && !live.idle) this.executePadAction(live.action)
        } else if (shortcut.tab) this.openActionTab(shortcut.tab)
        else if (id === 'find') this.uiOp('findItems')
        else if (id === 'level-items') this.runner.findItems(true)
        else if (id === 'descend') this.runner.execute(touchExtraAction('descend', this.ctx))
        else if (shortcut.message && shortcut.mode) {
          if (shortcut.mode === 'command') this.runner.send(shortcut.message)
          else this.runner.shortcutIn(shortcut.mode, shortcut.message)
        }
      },
      onTouchExtra: (id) => {
        this.inputFrom('touch')
        this.prepareInput()
        this.runner.execute(touchExtraAction(id, this.ctx))
      },
    }, this.fullscreenButton)
    // straight to the session: the runner drops what a spectator sends, and chat is a spectator's to send
    this.chat = new Chat(this.root, { send: (m) => this.session.send(m), padKind: () => this.hooks.gamepad.kind })
    this.overlays = new Overlays(this.root, {
      padKind: () => this.hooks.gamepad.kind,
      send: (m) => this.runner.send(m),
      gamedata: () => this.session.gamedata,
      watching: () => this.session.watching,
      onClientOverlayChange: () => {
        this.cancelMoveSwipe()
        this.tapArmed.clear()
        this.holding = null
        this.needsRender = true
      },
      onSystemAction: (op) => this.systemAction(op),
      settingsPanel: (group, back, controls) => this.hooks.settingsPanel(group, back, controls),
      actionTab: (to) => this.openActionTab(to),
      swipe: (step) => this.touchPress(step > 0 ? 'DR' : 'DL'),
      typed: () => this.wake(),
    })
    this.runner = new Runner(session, {
      context: () => this.ctx,
      facing: () => this.heading,
      direction: dir => {
        this.heading = dir
        this.ctxKey = ''
        this.ctx.ahead = deriveContext(this.session.state, this.session.scene, dir, 'micro').ahead
      },
      ui: (op, arg, category, section) => this.uiOp(op, arg, category, section),
      osk: (op, dir) => this.overlays.oskOp(op, dir),
      menu: (op) => this.overlays.menuOp(this.session.state, op),
      focus: (op) => this.overlays.focusOp(this.session.state, this.ctx, op),
      status: (t) => this.hud.status(t),
      confirmDangerous: () => this.hooks.settings().confirmStairs,
      now: () => performance.now(),
      keepMap: () => {
        this.mapHold.begin(performance.now())
        // a frame after the wait, so a hold nothing came for is let go even on a still screen
        setTimeout(() => this.wake(), 1600)
      },
    })
    this.ctx = deriveContext(session.state, session.scene, this.heading, 'micro')
    this.spellBook = new SpellBook({
      send: (m) => this.session.send(m, true),
      changed: () => {
        this.needsRender = true
        this.wake()
      },
      now: () => performance.now(),
    })
    session.hold = (m) => this.holdMonsterPreviewInput(m) || this.spellBook.hold(m)
    session.intercept = (m) => this.spellBook.intercept(m)
    // they go with the screen: a session that outlives it (a reconnect's next screen) gets its own
    this.unsub.push(() => {
      session.hold = null
      session.intercept = null
    })
    this.spellBar = new SpellBar({
      mode: () => this.ctx,
      turn: () => this.session.state.player.turn,
      now: () => performance.now(),
      cast: (spell) => this.runner.execute({ kind: 'keys', label: 'Cast ' + spell.name, seq: [{ text: 'z' }, { text: spell.letter, await: 'spell' }] }),
      fire: () => this.runner.execute({ kind: 'fire' }),
      cancel: () => this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] }),
    })
    this.lastInput = this.grid.coarsePointer && hooks.initialInput !== 'pad' ? 'touch' : hooks.initialInput ?? 'keyboard'
    this.usedTouchWithFinePointer = this.lastInput === 'touch' && !this.grid.coarsePointer
    this.padHints.cancel() // no pending server reply survives a screen/run change
    this.unsub.push(
      session.on((e) => {
        if (e.type === 'scene') {
          this.inputContextDirty = true
          this.wake()
          this.onScene()
        } else if (e.type === 'state') {
          this.inputContextDirty = true
          if ((e.msg.msg === 'map' && e.msg.clear) || e.msg.msg === 'game_client' || e.msg.msg === 'go_lobby') this.hud.endMapInspection()
          this.observeMonsterPreview(e.msg)
          this.feedback.observe(session.state, e.msg)
          this.nearDeath.observe(session.state, e.msg, performance.now())
          this.levelUp.observe(session.state, e.msg, performance.now(), this.settings().showLevelUpAnimation)
          this.lastHeard = performance.now()
          this.wake()
          this.trackHop()
          this.trackActions(performance.now(), false)
          // a new game on the same version reuses the loaded gamedata, so no
          // `gamedata` event follows: only wait when the session is fetching
          if (e.msg.msg === 'game_client' || e.msg.msg === 'go_lobby') {
            this.monsterDescriptions.clear()
            this.hud.cancelMonsterHover()
            if (this.session.gamedata && !this.session.loading) this.hideLoading()
            else this.showLoading('Loading game data…')
          }
        } else if (e.type === 'sent') {
          this.lastSent = performance.now()
        } else if (e.type === 'closed') {
          this.finishMonsterPreview()
          this.hud.cancelMonsterHover()
          this.nearDeath.clear()
          this.levelUp.clear()
          this.wake()
        } else if (e.type === 'gamedata') {
          if (e.status === 'ready') {
            this.hideLoading()
            if (this.session.gamedata) {
              this.renderer.setTiles(this.session.gamedata)
            }
            this.needsRender = true
          } else if (e.status === 'error') this.showLoading('Could not load game data: ' + (e.detail || ''))
          else this.showLoading(`Loading game data… ${e.done ?? 0}/${e.total ?? 0}`)
        }
      }),
    )
    if (this.session.gamedata) {
      this.renderer.setTiles(this.session.gamedata)
      this.hideLoading()
    } else this.showLoading('Loading game data…')
    this.onKeyDown = this.onKeyDown.bind(this)
    window.addEventListener('keydown', this.onKeyDown, true)
    this.onResize = this.onResize.bind(this)
    window.addEventListener('resize', this.onResize)
    // a phone's keyboard moves the visual viewport alone: the log is lifted onto it while a line is typed there (hud.liftLog)
    const vv = window.visualViewport
    if (vv) {
      const wake = () => this.wake()
      vv.addEventListener('resize', wake)
      vv.addEventListener('scroll', wake)
      this.unsub.push(() => {
        vv.removeEventListener('resize', wake)
        vv.removeEventListener('scroll', wake)
      })
    }
    // a move to a screen of another density need not resize the window, and every canvas is drawn for the old one
    this.unsub.push(onDprChange(() => {
      this.wake()
      this.relayout(true)
    }))
    this.onDocPointer = this.onDocPointer.bind(this)
    document.addEventListener('pointerdown', this.onDocPointer, true)
    this.onDocPointerEnd = this.onDocPointerEnd.bind(this)
    document.addEventListener('pointerup', this.onDocPointerEnd, true)
    document.addEventListener('pointercancel', this.onDocPointerEnd, true)
    this.outsideMove = this.outsideMove.bind(this)
    document.addEventListener('pointermove', this.outsideMove, true)
    this.onDocContextMenu = this.onDocContextMenu.bind(this)
    document.addEventListener('contextmenu', this.onDocContextMenu, true)
    this.attachPointer(this.canvas)
    this.relayout(true)
    this.wake()
  }

  destroy() {
    setAutoMessageLines(null)
    this.destroyed = true
    // a finger on the touch bar as it goes (a reconnect, the screen torn down under it) never lifts where the page
    // can hear it: let go here, or a held arrow walks on into the next game. The releases land on nothing (`pad`)
    this.hooks.gamepad.virtualRelease()
    cancelFrame(this.raf)
    clearTimeout(this.idleTimer)
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('pointerdown', this.onDocPointer, true)
    document.removeEventListener('pointerup', this.onDocPointerEnd, true)
    document.removeEventListener('pointercancel', this.onDocPointerEnd, true)
    document.removeEventListener('pointermove', this.outsideMove, true)
    if (this.onWindowBlur) window.removeEventListener('blur', this.onWindowBlur)
    document.removeEventListener('contextmenu', this.onDocContextMenu, true)
    for (const u of this.unsub) u()
    // a key sequence waiting on the server's prompt keeps its own session listener and timer past
    // these subscriptions: ended here, so a screen that is gone sends no follow-up key into the game
    this.runner.abortSequence()
    clearTimeout(this.tooltipTimer)
    this.finishMonsterPreview()
    this.hud.destroy()
    this.overlays.destroy()
    this.perf.destroy()
    this.grid.destroy()
    document.documentElement.style.removeProperty('--phone-shrink')
    this.renderer.destroy()
    this.nearDeath.clear()
    this.levelUp.clear()
    this.root.remove()
  }

  /**
   * On a phone the menus and popups come down with the grid's text (host.ts `setLeast`): they are sized from the
   * page's font (styles.css html), which would leave them a desktop's size over a phone's console. The `phone`
   * class spreads them across the screen (styles.css `.game.phone .popup`).
   */
  private shrinkText() {
    this.root.classList.toggle('phone', this.grid.phone)
    const st = document.documentElement.style
    if (this.grid.phone && this.grid.shrink < 1) st.setProperty('--phone-shrink', this.grid.shrink.toFixed(3))
    else st.removeProperty('--phone-shrink')
  }

  /** The grid's text size: the console cell's font in px, from the UI scale setting. */
  private textPx(): number {
    return Math.round(16 * this.hooks.settings().uiScale)
  }

  /**
   * Position the HUD for the current viewport. The level map uses the space
   * around those panes and any additional room freed by the server's RC options.
   */
  private relayout(force = false) {
    if (!this.hud) return
    const st = this.session.state
    const o = st.options
    const settings = this.settings()
    const g = this.grid.grid
    const mapView = this.mapShown
    const hideSidebar = mapView && o.tile_level_map_hide_sidebar === true
    // a line crawl reads in the log (Find…, off the map) asks its question there: the log stands while it waits
    const hideMessages = mapView && o.tile_level_map_hide_messages === true && !typedInLog(st.textInput)
    // no character yet: the official client's crt layer (game.js `set_ui_state`, `client.set_layer("crt")`) covers
    // the sidebar while the new-game chooser has the UI in CRT state (newgame.cc `choose_game`), until the redraw
    // that sends the first `player` (tileweb.cc `redraw`); a continued game has no sheet before that message either.
    const characterReady = st.uiState !== UiState.CRT && st.player.received
    const hideStats = hideSidebar || !characterReady
    // the touch bar's rows are its own: along the foot the panes stand above them; on its side, at the right column's
    // foot, the column ends above them and the view keeps its height (touchBeside); with the column gone, the foot
    const safeWidth = this.grid.width - this.grid.insets.left - this.grid.insets.right
    const layout = resolveLayout(settings.layoutPreset, this.hasTouchInput, this.grid.phone, safeWidth, this.grid.height)
    const mobile = layout !== 'Desktop'
    const portrait = layout !== 'Desktop' && portraitLayout(layout)
    const manualDesktop = settings.layoutPreset === 'Desktop'
    const monsters = settings.showNearbyMonsters
    const beside = mobile ? !portrait : !hideSidebar && touchBeside(g)
    const barRows = Math.ceil(this.hud.touchbarHeight / g.ch)
    // the Message lines setting; on Auto a phone's few, elsewhere what the server's `layout` asks for
    const msgRows = messageLinesOf(settings, st.messages.paneHeight, layout !== 'Desktop' && !tabletLayout(layout))
    // off a phone, the settings' Message lines row reads Auto with what this server asks for
    setAutoMessageLines(st.messages.paneHeight)
    const rcMapPixels = typeof o.tile_map_pixels === 'number' ? o.tile_map_pixels : 0
    const minimap = characterReady && !this.session.loading && this.session.scene.cells.size > 0 && settings.showMinimap
    // Reserve the spell row while the level map hides its buttons.
    const spells = this.spellsShown()
    const spellRows = spells ? Math.max(0, Math.ceil(SPELL_ROW_PX / g.ch) - 1) : 0
    const touch = this.touchControls && (characterReady || barRows > 0)
    const watching = this.session.watching
    const panelCell = mobile && settings.showActionPanel && characterReady && !this.session.loading && !watching && o.action_panel_disabled !== true
      ? Math.max(1, Math.round(PANEL_CELL * panelScale(o.action_panel_scale))) : 0
    const panelButtons = panelCell && !portrait && o.action_panel_show !== false ? this.hud.panelButtonCount(st) : 0
    const panelVertical = o.action_panel_orientation === 'vertical'
    const floatingInteract = mapView ? this.mapFloatingInteract : this.hud.floatingInteract
    const key = [g.cols, g.rows, g.cw, g.ch, g.ox, g.oy, msgRows, characterReady, mapView, hideSidebar, hideMessages, window.devicePixelRatio, barRows, beside, this.grid.phone, layout, manualDesktop, minimap, rcMapPixels, spells, settings.characterPanelScale, settings.showCharacterPortrait, settings.showActionPanel, monsters, touch, watching, this.grid.width, this.grid.height, this.grid.insets.bottom, this.grid.smallViewportHeight, panelCell, panelButtons, panelVertical, settings.touchControlHeight, settings.touchMovementWidth, settings.touchActionsWidth, settings.swapTouchControls, settings.hideEditTouchLayout, floatingInteract].join(',')
    if (!force && key === this.layoutKey) return
    this.layoutKey = key
    this.root.classList.toggle('touch-dungeon', mobile)
    this.root.classList.toggle('manual-desktop', manualDesktop)
    const phone = mobile ? mobileDungeonLayout(this.grid, layout, {
      stats: characterReady, monsters, minimap, touch, msgRows, floatingInteract, hideEditTouchLayout: settings.hideEditTouchLayout,
      spellHeight: spells ? MOBILE_SPELL_HEIGHT : 0, characterScale: settings.characterPanelScale,
      fullscreen: !!this.fullscreenButton, panelCell, panelButtons, panelVertical, swapControls: settings.swapTouchControls, controlScale: settings.touchControlHeight, movementWidth: settings.touchMovementWidth, actionsWidth: settings.touchActionsWidth,
    }) : null
    this.root.classList.toggle('touch-landscape', !!phone && !phone.portrait)
    this.root.style.setProperty('--landscape-controls-left', phone && !phone.portrait ? phone.controlsLeft + 'px' : '')
    const cells = phone?.cells ?? gameSplit(g, msgRows, undefined, beside ? 0 : barRows, beside ? barRows : 0, beside && barRows ? touchColumn(g) : undefined, 0, 0, spellRows, true, settings.characterPanelScale)
    this.hud.setMinimapAppearance(settings, phone?.portrait ? 'Left' : settings.minimapAlignment)
    this.hud.setMinimapEnabled(minimap, rcMapPixels)
    this.hud.touchBeside = beside
    // Touch layouts already reserve room for the visible HUD.
    const map = mapView && !phone ? levelMapSplit(g, cells, { hideSidebar, hideMessages }) : null
    const view = map ? levelMapCanvas(cells, map, beside && barRows > 0, g.rows) : cells.view
    const px = this.grid.px(view)
    if (phone && mapView && hideSidebar) px.width = this.grid.width
    if (phone?.portrait && hideMessages) {
      const bottom = hideStats ? phone.barTop : this.grid.px(cells.stats).top
      px.height = Math.max(px.height, bottom - px.top)
    }
    // upright, the view runs across the whole screen, the grid's margins too, from under the minimap's band down to the
    // screen's foot, under the touch bar (gameSplit).
    if (!phone && !map && isPortrait(g)) {
      px.left = 0
      px.width = this.root.clientWidth || px.width
      px.height = Math.max(px.height, this.root.clientHeight - px.top)
    } else if (!phone && !map) {
      // the grid keeps clear of a phone's cutouts (host.ts `insets`); the view the cells stand over runs on under them
      const ins = this.grid.insets
      const dl = view.x === 0 ? ins.left : 0
      const dt = view.y === 0 ? ins.top : 0
      const dr = view.x + view.w >= g.cols ? ins.right : 0
      if (dl || dt || dr) {
        px.left -= dl
        px.top -= dt
        px.width += dl + dr
        px.height += dt
      }
    }
    this.canvas.style.left = px.left.toFixed(2) + 'px'
    this.canvas.style.top = px.top.toFixed(2) + 'px'
    this.canvas.style.width = px.width.toFixed(2) + 'px'
    this.canvas.style.height = px.height.toFixed(2) + 'px'
    this.viewPx = px
    const fpsArea = this.settings().depthShowFps && this.presentation === 'dungeon' && !mapView ? this.grid.px(cells.clear) : null
    const fpsPortrait = isPortrait(g)
    if (fpsArea && watching && !mobile && !fpsPortrait) fpsArea.left = Math.max(fpsArea.left, this.grid.insets.left + TOUCH_BUTTON_H + 8)
    this.fps.place(fpsArea, fpsPortrait)
    // the map is centred, and its cells fitted, on its part above the touch bar (render-2d `foot`)
    const mapPx = map && this.grid.px(map)
    const mapBottom = mapPx ? mapPx.top + mapPx.height : mapView && phone ? phone.barTop : px.top + px.height
    this.mapFoot = Math.max(0, px.top + px.height - mapBottom)
    const phoneDungeon = this.grid.phone && !mapView
    const dpr = phoneDungeon ? phoneDungeonDpr() : Math.min(window.devicePixelRatio || 1, 1)
    this.canvas.classList.toggle('view-hidpi', dpr > 1)
    if (this.renderer instanceof Render25d) {
      const { left, right, top, bottom } = this.grid.insets
      // The camera stays centered on the canvas. Fit within the smaller half on each axis.
      this.renderer.setOptions({
        filterCreatureScaling: phoneDungeon,
        fitWidth: phone ? Math.max(1, px.width - 2 * (phone.portrait ? Math.max(left, right) : left)) : null,
        fitHeight: phone ? Math.max(1, Math.min(phone.fitHeight, px.height - 2 * Math.max(top, phone.portrait ? 0 : bottom))) : null,
      })
    }
    this.renderer.resize(px.width, px.height, dpr)
    // what rides the view's edges keeps clear of the panes
    const free = map ?? cells.clear
    const desktopMenuTop = this.grid.px(free).top
    this.root.style.setProperty('--desktop-menu-top', manualDesktop ? desktopMenuTop + 'px' : '')
    this.hud.spellRow = spells
    this.hud.layout(this.grid, cells, free, {
      stats: hideStats, sidebar: hideSidebar, messages: hideMessages, levelMap: mapView,
      portrait: !settings.showCharacterPortrait, monsters: !monsters || (mobile && hideStats),
      actionPanel: !settings.showActionPanel,
      desktopMenu: manualDesktop, editTouchLayout: settings.hideEditTouchLayout,
    }, settings.characterPanelScale, phone)
    const msgPx = this.grid.px(cells.messages)
    const log = hideMessages || !msgPx.width ? null : msgPx
    const compactChat = phone ? !phone.sidebarChatHeight : this.grid.phone
    const chatBox = this.grid.px(cells.sidebar)
    if (phone?.sidebarChatHeight) {
      chatBox.left = phone.dockLeft
      chatBox.width = phone.right - phone.dockLeft
    }
    this.chat.place(chatBox, this.root.clientHeight, this.root.clientWidth, compactChat, log, phone?.chatLauncher, this.hasTouchInput || mobile)
    this.needsRender = true
  }

  private makeRenderer(): MapRenderer {
    const st = this.hooks.settings()
    const r: MapRenderer = this.hooks.renderer?.(this.presentation) ?? (this.presentation === 'dungeon'
      ? new Render25d(dungeonOptions(st))
      : new Render2d({ cellSize: 32, living: true, liquidMotion: st.liquidMotion, lighting: st.depthLighting }))
    r.mount(this.canvas)
    if (this.session.gamedata) {
      r.setTiles(this.session.gamedata)
    }
    this.syncRendererScene(this.session.scene, undefined, r)
    return r
  }

  openTouchLayoutSettings() {
    return this.hud.openLayoutEditor(commandShortcutPreview(this.ctx, this.session.gamedata))
  }

  applySettings() {
    const wasDesktop = this.settingsCache?.layoutPreset === 'Desktop'
    this.settingsCache = null
    const st = this.settings()
    if (!st.showLevelUpAnimation) this.levelUp.stopAnimation()
    document.documentElement.style.setProperty('--ui-scale', String(st.uiScale))
    this.grid.setTextSize(this.textPx())
    if (wasDesktop !== (st.layoutPreset === 'Desktop')) this.grid.fit()
    this.shrinkText()
    if (this.renderer instanceof Render25d) this.renderer.setOptions(dungeonOptions(st))
    else if (this.renderer instanceof Render2d) {
      this.renderer.setOptions({ liquidMotion: st.liquidMotion, lighting: st.depthLighting })
    }
    this.relayout(true)
    this.needsRender = true
  }

  /** The settings, read from storage once and kept until `applySettings` says they changed. */
  private settings(): Settings {
    return (this.settingsCache ??= this.hooks.settings())
  }

  /** Switch between the dungeon and its temporary flat level map. */
  private setPresentation(presentation: GamePresentation) {
    if (presentation === this.presentation) return
    this.cancelDrag()
    const old = { canvas: this.canvas, renderer: this.renderer }
    if (presentation === 'flat-map') this.mapFloatingInteract = this.hud.floatingInteract
    this.presentation = presentation
    const c = h('canvas', { class: 'view' })
    old.canvas.replaceWith(c)
    this.canvas = c
    this.attachPointer(c)
    this.renderer = this.makeRenderer()
    this.renderer.setCursor(this.lastCursor)
    this.lastOptKey = ''
    this.relayout(true)
    this.needsRender = true
    old.renderer.destroy()
  }

  private showLoading(text: string) {
    this.loading.textContent = text
    this.loading.style.display = ''
  }
  private hideLoading() {
    this.loading.style.display = 'none'
  }

  private onResize() {
    this.wake()
    // the grid host watches the root too; a window resize is the sure signal on browsers without a ResizeObserver
    this.grid.fit()
  }

  // ------------------------------------------------------------- frame loop

  private loop(now: number) {
    this.raf = requestRenderFrame(this.loop)
    const previousFrame = this.lastFrame
    this.lastFrame = now
    // The reply already spent time waiting for this frame. Starting its glide
    // at `now` would draw no motion until the NEXT frame. Clamp to the last
    // frame so a stale/load-time update cannot fast-forward a new animation.
    this.sceneTime = Math.min(now, Math.max(previousFrame, this.session.sceneChangedAt ?? now)) / 1000
    const perf = this.perf?.enabled ? this.perf.profile : null
    perf?.begin(now)
    try {
      if (this.session.flushScene()) {
        this.needsRender = true
        perf?.tag('scene')
      }
    } finally {
      this.sceneTime = undefined
    }
    perf?.mark('scene')
    this.advancePresentation(now / 1000)
    perf?.mark('present')
    if (!this.awake(now)) {
      this.fps.update(now, false)
      // nothing to do and nothing moving: no frames until something happens (`wake`) or the safety tick
      cancelFrame(this.raf)
      this.raf = 0
      this.idleTimer = window.setTimeout(this.idleTick, IDLE_TICK_MS)
      perf?.resume()
      return
    }
    this.dirty = false
    this.lastBody = now
    // what is drawn changed: the map, the player, the UI stack (a menu's cursor, the level map opening)
    const rev = this.session.state.rev
    if (rev.map !== this.drawnRev.map || rev.player !== this.drawnRev.player || rev.ui !== this.drawnRev.ui) {
      this.drawnRev = { map: rev.map, player: rev.player, ui: rev.ui }
      this.needsRender = true
    }
    if (this.renderer.animating) this.needsRender = true
    const st = this.session.state
    // overlays first: the popup's parsed actions and the focus cursor feed the context and the action bar
    // the device first: the overlays decide what to bring up with a server prompt by who spoke last
    this.updateContext()
    // The gamedata fetch runs while the game is already talking: the launcher's
    // save-transfer question (a `show_dialog`) comes up with the veil still
    // over the screen. A veil that swallowed the click would strand the player,
    // so the veil stands behind open menus, including a spectator's system menu.
    this.loading.classList.toggle('behind', !!(this.overlays.hasClientOverlay || st.dialog || st.menus.length || st.ui.length || st.textInput))
    this.fireHolds(now)
    this.trackPack()
    this.trackActions(now, true)
    this.spellFrame()
    if (this.padHints.waiting) this.padHints.observe(this.padHintEvidence(), now)
    if (this.touchHints.waiting) this.touchHints.observe(deriveMode(st), now)
    const cursor = this.cursorFor()
    const lc = this.lastCursor
    if ((cursor?.x !== lc?.x || cursor?.y !== lc?.y || cursor?.mode !== lc?.mode || cursor?.tile !== lc?.tile) && !(cursor === null && lc === null)) {
      this.lastCursor = cursor
      this.renderer.setCursor(cursor)
      // the pointer's own hover cell stays out of the minimap; only a cursor the server placed shows there
      this.hud.setCursor(this.cursorIsOurs ? null : cursor)
      this.needsRender = true
    }
    this.setPresentation(this.mapHold.shown(st.uiState === UiState.VIEW_MAP, this.ctx.mode, now) ? 'flat-map' : 'dungeon')
    const swipeMovement = this.canSwipeMove()
    this.root.classList.toggle('swipe-to-move', swipeMovement)
    if (!swipeMovement) this.cancelMoveSwipe()
    this.relayout()
    this.applyServerOptions()
    const settings = this.settings()
    const combat = this.feedback.flush(this.session.scene)
    const spells = this.feedback.takeSpells()
    if (spells.length || combat.length) this.needsRender = true
    // one of our own panels has its prompts from the panel (Overlays.padPrompts), set under it as crawl's menus' are
    const ours = this.overlays.padPrompts
    let padLabels = this.chat.capturing ? [] : ours ?? this.padHints.prompts(this.ctx, settings.hints)
    // A held tap-or-hold button (B: Wait, hold for Rest) shows its prompt while it is down, even when the
    // situation did not put it in the corner, so the hold's progress has a place to show. It joins the
    // contextual ones, under the lessons.
    const held = this.holding
    if (held && !padLabels.some((l) => l.button === held.button)) {
      padLabels = padLabels.filter((l) => l.button !== held.button)
      const l = barLabels(this.ctx).find((l) => l.button === held.button)
      if (l) {
        const at = padLabels.findIndex((l) => l.teaching)
        padLabels.splice(at < 0 ? padLabels.length : at, 0, l)
      }
    }
    // a finger gets every button the screen has, by its word (bindings.ts touchLabels); a panel of ours names its own.
    // For spectators, B and Start open the Polished Crawl menu, where Stop watching is.
    // the bar's cast passes through crawl's "Cast which spell?" on its way to the aim: the buttons hold still through it,
    // rather than flash the prompt's own for a frame or two
    const passing = this.castPrompt()
    const touch = passing && this.touchControls ? this.lastTouch : this.touchControls
      ? { labels: touchLabels(ours ? withBack(ours) : barLabels(this.ctx), this.ctx, !!ours), mode: this.ctx.mode }
      : null
    this.lastTouch = touch
    const hadFloatingInteract = this.hud.floatingInteract
    this.hud.update(st, this.session.scene, this.ctx, this.hooks.gamepad.kind, this.session.gamedata, this.session.watching, this.lastInput, settings.hints !== 'off', padLabels, held, !this.overlays.hasClientOverlay && !this.chat.capturing, !!ours, touch?.labels ?? null, touch?.mode)
    if (hadFloatingInteract !== this.hud.floatingInteract) this.relayout()
    // Reserve space for the controls rendered this frame, including when a menu replaces the compass.
    const inset = this.hud.touchbarInset
    const overlayStyle = this.overlays.root.style
    const right = inset.right + 'px', bottom = inset.bottom + 'px'
    if (overlayStyle.getPropertyValue('--touch-right') !== right) overlayStyle.setProperty('--touch-right', right)
    if (overlayStyle.getPropertyValue('--touch-bottom') !== bottom) overlayStyle.setProperty('--touch-bottom', bottom)
    // a line typed in the log (bindings.ts typedInLog) stands on the phone's keyboard, and what Chrome lays over its top
    const field = typedInLog(st.textInput) ? this.overlays.activeInput() : null
    this.hud.liftLog(field && document.activeElement === field ? keyboardCover(this.root) : 0)
    this.overlays.placeLogInput(() => this.hud.logRect())
    this.root.classList.toggle('spectating', this.session.watching)
    this.systemMenu.hidden = !this.canOpenSystemMenu()
    const menuArt = this.session.watching ? null : this.session.gamedata
    if (menuArt !== this.systemMenuArt) {
      this.systemMenuArt = menuArt
      const id = commandTileId(menuArt, CHARACTER_STATUS_TILE)
      this.systemMenu.replaceChildren(id === undefined ? settingsGlyph() : tileCanvas(menuArt, [{ t: id }]))
    }
    this.hud.showMinimapTip(this.showTouchMapTip(settings.hints), this.session.gamedata)
    const book = this.spellBook.spells
    this.hud.renderSpellBar(this.spellsShown() && this.spellsLive() ? {
      spells: book, lit: this.spellBar.lit(), short: book.filter(s => spellShort(s, st.player)).map(s => s.letter),
      commands: this.ctx.mode === 'command' && !this.spellBook.busy,
    } : null, this.session.gamedata)
    this.chat.update(st, this.chatOn && (st.phase === 'playing' || st.phase === 'watching'), !!st.lobby.username)
    this.syncTarget()
    perf?.mark('ui')
    let rendered = false
    if (this.needsRender) {
      this.needsRender = false
      // dungeon_renderer.js set_view_center: the 2D view sits on the server's view
      // centre (`vgrdc`), the player in normal play and the map cursor while the
      // level map is open, so the map scrolls under the cursor as WebTiles' does.
      if (this.renderer instanceof Render2d) this.renderer.setOptions({ center: st.map.viewCenter })
      this.syncRendererScene(this.session.scene, now / 1000)
      if (!this.mapShown) {
        const weapon = st.player.inv[st.player.weapon_index]?.name
        presentCombat(this.renderer, this.session.scene, combat, spells, weapon, now, settings.meleeBumpSpeed)
      }
      this.renderer.render(now / 1000)
      if (this.hud.minimapShown && this.renderer instanceof Render25d) {
        this.hud.setMinimapWindow(this.renderer.viewportBounds())
      }
      rendered = true
      perf?.mark('render')
      // a frame that drew: the key whose answer it put on the screen stops waiting (perf.ts `drew`)
      if (perf) this.perf.net.drew()
    }
    this.nearDeath.render(now, !this.mapShown && !this.overlays.hasClientOverlay
      && this.session.scene.playerOnLevel && (st.phase === 'playing' || st.phase === 'watching'))
    this.placePlayerCues(now, settings.showMoreCue)
    this.fps.update(now, rendered)
    perf?.end()
  }

  private placePlayerCues(now: number, showMoreCue: boolean) {
    const { scene, state, closed } = this.session
    const view = this.viewPx
    const visible = !this.mapShown && !this.overlays.hasClientOverlay && scene.playerOnLevel
      && (state.phase === 'playing' || state.phase === 'watching')
    const celebrating = this.levelUp.active
    const more = showMoreCue && !celebrating && visible && this.ctx.mode === 'more' && !closed && this.loading.style.display === 'none'
    let cueVisible = false
    if (view && visible && (more || celebrating)) {
      const player = scene.billboards.find(b => b.kind === 'player')
      const centre = this.renderer.project?.(scene.player.x, scene.player.y)
      const right = this.renderer.project?.(scene.player.x + 1, scene.player.y)
      // Upright sprites stand at y + 0.3 and are one projected tile tall.
      const foot = this.renderer.project?.(scene.player.x, scene.player.y + 0.3)
      const actor = player ? this.renderer.projectBillboard?.(player) ?? centre : centre
      if (actor && centre && right && foot) {
        const head = actor.y + foot.y - centre.y - Math.abs(right.x - centre.x)
        const cue = more && player && (this.renderer instanceof Render25d ? this.renderer.playerSpriteAnchor : { x: actor.x, y: head })
        if (cue && cue.x >= 0 && cue.x <= view.width && cue.y >= 0 && cue.y <= view.height) {
          cueVisible = true
          this.moreCue.style.left = `${view.left + cue.x}px`
          this.moreCue.style.top = `${view.top + cue.y}px`
        }
        if (celebrating) this.levelUp.place(view, { x: actor.x, y: head - 6 })
      }
    }
    this.moreCue.toggleAttribute('hidden', !cueVisible)
    this.levelUp.render(now, visible)
  }

  /**
   * What was on the screen when a perf sample was taken (perf.ts
   * `LogContext`). A timing says what was slow; this says what it was slow
   * on, and the renderer's own counters say how much of it was work the
   * frame chose to do — a `level` of 28 ms with the chunk counter stepping
   * once is the chunk rebuild working, and the same 28 ms with it stepping
   * forty times is not.
   */
  private perfContext(): LogContext {
    // the log's header is written while this screen is still being built, before the first frame
    // derived either of them: nothing here may assume the loop has run
    const ctx = this.ctx as Context | undefined
    return {
      mode: ctx?.mode,
      place: this.session.state.player.place ? `${this.session.state.player.place}:${this.session.state.player.depth}` : undefined,
      cells: this.session.scene.cells.size,
      crowd: this.session.scene.billboards.length,
      loading: this.session.loading,
    }
  }

  /** Deliver the frame timestamp before the renderer samples entity and view movement. */
  private advancePresentation(now: number) {
    this.syncRendererScene(this.session.scene, now)
  }

  /** Deliver the view centre with the scene, including receipt-time observations before drawing. */
  private syncRendererScene(scene: Scene, now?: number, renderer = this.renderer) {
    if (!renderer) return
    if (renderer instanceof Render25d) renderer.setOptions({ center: this.session.state.map.viewCenter })
    renderer.setScene(this.nearDeath.scene(scene), now)
  }

  /**
   * The context of the frame (context.ts `deriveContext`): scans of the
   * scene's billboards and the message log, so it is derived once per change
   * of what it reads (every message bumps `rev.any`; a scene rebuild bumps
   * `scene.revision`; a turn changes the facing) and copied for the fields
   * the frame fills in afterwards (`examining`, `popupActions`, `focus`).
   */
  private deriveContext(st: GameState): Context {
    const suppressed = this.monsterPreview?.popup
    const key = `${st.rev.any}|${this.session.scene.revision}|${this.heading}|${!!suppressed}`
    if (!this.ctxBase || key !== this.ctxKey) {
      this.ctxKey = key
      this.ctxBase = deriveContext(suppressed ? { ...st, ui: st.ui.filter(p => p !== suppressed) } : st, this.session.scene, this.heading, 'micro')
      if (this.exploreDone.update(st, this.session.scene)) this.ctxBase.exploreDone = true
    }
    return { ...this.ctxBase }
  }

  /** A reply may arrive after the last paint but before the next input poll.
   * Resolve that input against confirmed state now, without waiting for RAF. */
  private prepareInput() {
    if (!this.inputContextDirty) return
    this.session.flushScene()
    this.updateContext()
  }

  private updateContext() {
    this.inputContextDirty = false
    this.overlays.setDevice(this.lastInput)
    this.overlays.update(this.session.state, this.monsterPreview?.popup)
    this.ctx = this.deriveContext(this.session.state)
    // The runner distinguishes examine from other server targeting modes.
    if (this.runner.examining(this.ctx.mode)) this.ctx.examining = true
    if (this.ctx.mode === 'popup') this.ctx.popupActions = this.overlays.popupActions()
    if (this.ctx.mode === 'menu') this.ctx.switches = this.overlays.menuSwitches()
    if (this.ctx.mode === 'popup') this.ctx.switches = this.overlays.popupSwitches()
    this.overlays.updatePrompt(this.ctx.mode, this.ctx.prompt, this.lastInput)
    this.overlays.syncFocus(this.ctx)
    const fi = this.overlays.focusInfo(this.ctx)
    if (fi) this.ctx.focus = fi
    this.ctx.pageable = this.overlays.pageable(this.ctx)
  }

  /** The safety tick: a frame after IDLE_TICK_MS asleep, so anything that changed without waking the loop is seen. */
  private idleTick = () => {
    this.idleTimer = 0
    if (!this.raf && !this.destroyed) {
      this.lastFrame = performance.now()
      this.perf?.profile.resume()
      this.raf = requestRenderFrame(this.loop)
    }
  }

  /**
   * Whether this frame has anything to do. At rest (no message, no input,
   * nothing easing or animating, no hold under way) the loop's body is
   * skipped whole, so an idle game costs the CPU nothing but the callback.
   * A safety tick every IDLE_TICK_MS still runs the body, so anything that
   * changes state without waking the loop (a runner's timeout, a tooltip)
   * is seen within a quarter second.
   *
   * Play is not one event but a stream of them: a step, the messages it
   * brings, the turn that follows. Parking between them would hand the
   * frames back to whatever woke the loop next, so they would arrive when a
   * packet did rather than when the display asked, which reads as judder
   * however many of them there are. So the loop holds the display's rate for
   * ACTIVE_MS past the last thing that wanted a frame, and only then parks.
   */
  private awake(now: number): boolean {
    if (this.busy()) {
      this.lastActive = now
      return true
    }
    if (now - this.lastActive < ACTIVE_MS) return true
    // the safety tick woke the loop: a frame's body, and then sleep again
    return now - this.lastBody >= IDLE_TICK_MS
  }

  /** Something wants this frame: a message, an input, an easing, an animation, a hold. */
  private busy(): boolean {
    if (this.dirty || this._needsRender) return true
    if (this.renderer.animating || this.nearDeath.active || this.levelUp.active) return true
    return this.pressTimes.size > 0 || this.padHints.waiting || this.touchHints.waiting
  }

  /**
   * Honour the rc options the server sends (the same `options` message the
   * official client reads): tile size and scales, display mode, minibars,
   * level-map pane hiding, fonts. Cheap to call every frame; only acts on change.
   */
  private applyServerOptions() {
    const st = this.session.state
    const o = st.options
    const p = st.player
    const mapView = this.mapShown
    const key = JSON.stringify([
      this.presentation,
      // the cell size is fitted to the view (`cellPixels`), so its size belongs to the key (`relayout` ran first in the frame)
      this.viewPx?.width,
      this.viewPx?.height,
      this.mapFoot,
      o.tile_cell_pixels,
      o.tile_viewport_scale,
      o.tile_map_scale,
      o.tile_display_mode,
      o.tile_filter_scaling,
      o.tile_show_minihealthbar,
      o.tile_show_minimagicbar,
      p.hp,
      p.hp_max,
      p.mp,
      p.mp_max,
      o.tile_level_map_hide_messages,
      o.tile_level_map_hide_sidebar,
      o.glyph_mode_font,
      o.tile_font_msg_family,
      o.tile_font_msg_size,
      o.tile_font_stat_family,
      o.tile_font_stat_size,
      o.tile_font_crt_family,
      o.tile_font_crt_size,
      o.tile_font_lbl_family,
      o.tile_font_lbl_size,
      o.custom_text_colours,
    ])
    if (key === this.lastOptKey) return
    this.lastOptKey = key
    // (the level map's pane hiding is the grid's: `relayout` and `levelMapSplit`)
    // fonts: a family or size from the rc overrides the theme for text off the grid (CRT screens, labels);
    // WebTiles' default "monospace" maps to ours. The grid's own cells keep the one grid font (console-grid.md).
    const rs = document.documentElement.style
    const font = (fam: unknown, size: unknown, v: string) => {
      if (typeof fam === 'string' && fam && fam !== 'monospace') rs.setProperty(`--font-${v}`, fam)
      else rs.removeProperty(`--font-${v}`)
      if (typeof size === 'number' && size > 0) rs.setProperty(`--font-${v}-size`, size + 'px')
      else rs.removeProperty(`--font-${v}-size`)
    }
    font(o.tile_font_msg_family, o.tile_font_msg_size, 'msg')
    font(o.tile_font_stat_family, o.tile_font_stat_size, 'stat')
    font(o.tile_font_crt_family, o.tile_font_crt_size, 'crt')
    font(o.tile_font_lbl_family, o.tile_font_lbl_size, 'lbl')
    // game.js init_custom_text_colours: the rc may replace any of the 16 terminal colours
    for (let i = 0; i < 16; i++) rs.removeProperty('--color-' + i)
    if (Array.isArray(o.custom_text_colours)) {
      for (const c of o.custom_text_colours as { index: number; r: number; g: number; b: number }[]) {
        if (typeof c?.index === 'number') rs.setProperty('--color-' + c.index, `rgb(${c.r}, ${c.g}, ${c.b})`)
      }
    }
    // cell_renderer.js draw_minibars: the player's bars, when tile_show_minihealthbar / tile_show_minimagicbar allow
    const minibars = { hp: p.hp, hpMax: p.hp_max, mp: p.mp, mpMax: p.mp_max, showHp: o.tile_show_minihealthbar !== false, showMp: o.tile_show_minimagicbar !== false }
    if (this.renderer instanceof Render25d) this.renderer.setOptions({ minibars, filterScaling: o.tile_filter_scaling === true })
    if (this.renderer instanceof Render2d) {
      const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
      const px = num(o.tile_cell_pixels, 32)
      const scale = mapView ? num(o.tile_map_scale, 60) : num(o.tile_viewport_scale, 100)
      const mode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
      ;(this.renderer as Render2d).setOptions({
        cellSize: this.cellPixels(Math.max(8, Math.round((px * scale) / 100)), mode),
        mode,
        living: !mapView,
        foot: mapView ? this.mapFoot : 0,
        filterScaling: o.tile_filter_scaling === true,
        glyphFont: rcFont(o.glyph_mode_font),
        minibars,
      })
    }
    this.needsRender = true
  }

  /**
   * dungeon_renderer.js `fit_to`: the cells from the rc options, shrunk to fit
   * if a full field of view (game.js `show_diameter`) would not otherwise
   * stand in the view. Glyph modes size their cells from the font instead, so
   * they are left alone. The level map is not fitted, as WebTiles' is: on a
   * phone the fit already holds its default scale, and zooming in did nothing.
   */
  private cellPixels(cell: number, mode: string): number {
    if (mode === 'glyphs' || this.mapShown) return cell
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight - (this.mapShown ? this.mapFoot : 0)
    if (!w || h <= 0) return cell
    const span = SHOW_DIAMETER * cell
    if (span <= w && span <= h) return cell
    return Math.max(1, Math.floor(cell * Math.min(w / span, h / span)))
  }

  private cursorFor(): SceneCursor | null {
    const st = this.session.state
    // cursor ids: 0 mouse/targeting, 1 tutorial, 2 level map
    const c = st.cursors[0] || st.cursors[2] || st.cursors[1]
    this.cursorIsOurs = false
    if (!c) {
      // dungeon_renderer.js handle_mouse: with nothing else up, the pointer's cell wears CURSOR_MOUSE
      const key = this.pointerCell()
      if (key === null) return null
      this.cursorIsOurs = true
      return { x: (key & 1023) - 512, y: (key >> 10) - 512, mode: 'examine', tile: this.session.gamedata?.icons.id('CURSOR') }
    }
    const mode: SceneCursor['mode'] = st.uiState === UiState.VIEW_MAP ? 'map' : st.inputMode === MouseMode.COMMAND ? 'examine' : 'target'
    // WebTiles paints icons.CURSOR for the mouse and map cursors, TUTORIAL_CURSOR for the tutorial one
    const tutorial = !st.cursors[0] && !st.cursors[2] && !!st.cursors[1]
    const tile = this.session.gamedata?.icons.id(tutorial ? 'TUTORIAL_CURSOR' : 'CURSOR')
    return { x: c.x, y: c.y, mode, tile }
  }

  /**
   * The cell the pointer selects in command mode, where a click acts and the
   * cursor icon lies. It is the plain WebTiles pointer: the cell it hovers,
   * whatever it is. Nothing for a spectator, with `tile_web_mouse_control`
   * off, or outside command mode, where the server owns the cursor; and
   * nothing until the mouse moves after a keyboard or pad action
   * (`pointerLive`).
   */
  private pointerCell(): CellKey | null {
    if (!this.hover || !this.pointerLive || this.session.watching || this.ctx.mode !== 'command') return null
    if (this.session.state.options.tile_web_mouse_control === false) return null
    // every camera move, resize and level change marks a render, and a pointer move marks the pick, so these are the only times it can change
    if (this.needsRender || this.pickDirty || this.pickMemo === undefined) {
      this.pickDirty = false
      this.pickMemo = this.renderer.pick(this.hover.x, this.hover.y)
    }
    return this.pickMemo
  }

  /**
   * Once a frame: while an aim is up the pointer steers its cursor
   * (`pointTarget`). Outside one, a mouse resting on the view does not aim
   * the `x` or `f` that opens next: the movement it made in command mode
   * is forgotten, so only movement while the aim is up moves its cursor.
   */
  private syncTarget() {
    if (this.ctx.mode === 'targeting') this.pointTarget()
    else {
      this.lastTargetSent = -1
      this.hoverMoved = false
    }
  }

  /**
   * Targeting with the pointer: the cell under the hovering mouse or the
   * dragging finger is where the server's cursor should be, as the
   * official client does with `target_cursor` on mouse move.
   */
  private pointTarget() {
    if (this.session.watching || !this.hover || !this.hoverMoved) return
    this.hoverMoved = false
    if (this.session.state.options.tile_web_mouse_control === false) return
    const key = this.renderer.pick(this.hover.x, this.hover.y)
    if (key === null || key === this.lastTargetSent) return
    this.lastTargetSent = key
    this.runner.send(cm.targetCursor((key & 1023) - 512, (key >> 10) - 512))
  }

  /** A server message came in: note the step the player made, if any (see `hops`). */
  private trackHop() {
    const pos = this.session.state.player.pos
    if (!pos) return
    const { x, y } = this.hopPos
    if (pos.x === x && pos.y === y) return
    const dx = pos.x - x
    const dy = pos.y - y
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) this.hops.push({ dx, dy })
    this.hopPos = { x: pos.x, y: pos.y }
  }

  private onScene() {
    const now = this.sceneTime ?? performance.now() / 1000
    const scene = this.session.scene
    const p = scene.player
    const hops = this.hops
    this.hops = []
    if (scene.playerOnLevel) {
      const level = `${this.session.state.player.place}:${this.session.state.player.depth}`
      const sameLevel = level === this.lastLevel
      if (p.x !== this.lastPos.x || p.y !== this.lastPos.y || !sameLevel) {
        this.forgetTabs()
        const dx = p.x - this.lastPos.x, dy = p.y - this.lastPos.y
        const direction = dirFromDelta(Math.sign(dx), Math.sign(dy))
        if (sameLevel && direction !== null) this.heading = direction
        if (sameLevel && this.padStep && this.runner.lastStep === this.padStep && !this.session.watching) {
          this.padHints.moved(Math.max(1, hops.length))
          this.padStep = null
        }
        this.lastPos = { x: p.x, y: p.y }
      }
      this.lastLevel = level
    }
    this.syncRendererScene(scene, now)
    this.needsRender = true
  }

  // ------------------------------------------------------------------ input

  /** Buttons whose hold action already ran this press; their release is swallowed. */
  private holdFired = new Set<string>()

  /**
   * Buttons whose press opened a tap-or-hold decision (bindings.ts
   * `armsTapOrHold`). A press that acted at once (space under a --more--, a
   * menu select) is not here, so its release cannot become a tap in whatever
   * mode the server moved to meanwhile: A on a --more-- while standing on
   * stairs must not also climb them.
   */
  private tapArmed = new Set<string>()

  /** Fire the hold half of any tap-or-hold button that has been down for HOLD_MS, without waiting for release. */
  private fireHolds(now: number) {
    this.holding = null
    if (this.hud?.editingLayout || this.chat.capturing || this.overlays.hasClientOverlay) {
      this.tapArmed.clear()
      return
    }
    for (const [b, t0] of this.pressTimes) {
      if (!this.tapArmed.has(b)) continue
      // the server may have moved the mode under the press: a button the new context has no tap-or-hold for
      // disarms, so neither half can fire where it would mean something else (LB pressed in a menu must not rest)
      if (!armsTapOrHold(b as Button, this.ctx)) { this.tapArmed.delete(b); continue }
      if (this.holdFired.has(b) || !this.hooks.gamepad.isHeld(b as Button)) continue
      const a = holdAction(b as Button, this.ctx)
      if (!a) continue
      if (now - t0 < HOLD_MS) {
        // the button's own prompt shows how far along the hold is; the same for every tap-or-hold
        this.holding = { button: b as Button, fraction: (now - t0) / HOLD_MS }
        continue
      }
      this.holdFired.add(b)
      this.executePadAction(a)
      this.needsRender = true
    }
  }

  pad(ev: PadEvent) {
    if (this.destroyed) return
    if (this.hud?.editingLayout) {
      if (ev.type === 'press' && ev.button === 'B') this.hud.closeLayoutEditor()
      return
    }
    if (this.monsterPreview) return
    this.wake()
    // a press, a stick or the d-pad is the pad speaking; a stick settling back to centre is not
    if (isPadActivity(ev)) {
      this.hud.cancelPendingMonsterHover()
      this.inputFrom('pad')
    }
    this.prepareInput()
    if (this.chat.capturing) {
      this.chat.pad(ev)
      return
    }
    if (this.overlays.hasClientOverlay) {
      if (ev.type === 'press') {
        // the button that opened this screen puts it away whole, before anything else it would do here
        if (ev.button === this.overlayOpener) this.overlays.clientOverlayInput('close')
        else if (ev.button === 'A') this.overlays.clientOverlayInput('select')
        else if (ev.button === 'START') this.overlays.clientOverlayInput('submit')
        else if (ev.button === 'B') this.overlays.clientOverlayInput('cancel')
        // Select is the put-away button even for a screen it did not open
        else if (ev.button === 'SELECT') this.overlays.clientOverlayInput('close')
        else if (ev.button === 'X') this.overlays.clientOverlayInput('keyboard')
        else if (ev.button === 'Y' && this.overlays.sectionedSettingsOpen) this.overlays.clientOverlayInput('resetSetting')
        else if (ev.button === 'LB') this.overlays.clientOverlayInput('bumperPrev')
        else if (ev.button === 'RB') this.overlays.clientOverlayInput('bumperNext')
        // put away by any route (the opener, Select, B on the first screen): the next opener owns the next screen
        if (!this.overlays.hasClientOverlay) this.overlayOpener = null
      } else if (ev.type === 'dir' || ev.type === 'dirRepeat') {
        if (ev.dir === 0) this.overlays.clientOverlayInput('prev')
        else if (ev.dir === 4) this.overlays.clientOverlayInput('next')
        else if (ev.dir === 6) this.overlays.clientOverlayInput('left')
        else if (ev.dir === 2) this.overlays.clientOverlayInput('right')
      }
      return
    }
    if (ev.type === 'pan') {
      if (this.ctx.mode === 'levelmap') {
        // the right stick pans the level map
        this.panMap(ev.dx, ev.dy)
        return
      }
      this.mapPan = { x: 0, y: 0 }
      return
    }
    if (ev.type === 'press') {
      this.pressTimes.set(ev.button, ev.t)
      this.holdFired.delete(ev.button)
      if (this.ctx.mode !== 'spectating' && armsTapOrHold(ev.button, this.ctx)) this.tapArmed.add(ev.button)
      else this.tapArmed.delete(ev.button)
    }
    if (ev.type === 'release') {
      this.pressTimes.delete(ev.button)
      this.holding = null
      const armed = this.tapArmed.delete(ev.button)
      if (this.holdFired.delete(ev.button) || !armed) return
    }
    if (this.ctx.mode === 'spectating') {
      if (ev.type === 'press' && (ev.button === 'B' || ev.button === 'START')) {
        this.uiOp('system')
        this.overlayOpener = ev.button
      }
      // a spectator's chat is one button away, as F12 is in the official client
      if (ev.type === 'press' && ev.button === 'X') this.chat.padFocus()
      if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.hud.scrollLog(ev.dir === 0 ? -1 : ev.dir === 4 ? 1 : 0)
      return
    }
    const a = resolve(ev, this.ctx)
    if (!a) return
    this.inputActed()
    const overlayWasUp = this.overlays.hasClientOverlay
    this.executePadAction(a)
    // whichever button just opened a client overlay owns closing it; a screen
    // reached from inside one (A on a settings row) keeps the opener it came with
    if (ev.type === 'press') {
      if (!this.overlays.hasClientOverlay) this.overlayOpener = null
      // (the frame a turn of X's tabs stands in is no screen of the bumper's: the bumper turns it again;
      // nor is A's chooser of what to do underfoot A's: A picks a row there, as in every list)
      else if (!overlayWasUp && this.overlays.openMenu !== 'battle' && ev.button !== 'A') this.overlayOpener = ev.button
    }
    this.needsRender = true
  }

  private padHintEvidence(): PadHintEvidence {
    const st = this.session.state
    const cursor = st.cursors[0] ?? st.cursors[2]
    return {
      mode: deriveMode(st), turn: st.player.turn, x: st.player.pos?.x ?? NaN, y: st.player.pos?.y ?? NaN,
      cursor: cursor ? `${cursor.x},${cursor.y}` : '',
      focus: this.overlays.focusInfo(this.ctx)?.index ?? st.menus.at(-1)?.last_hovered ?? -1,
      clientOverlay: this.overlays.hasClientOverlay,
    }
  }

  private canOpenSystemMenu(): boolean {
    if (this.overlays.hasClientOverlay || this.chat.capturing) return false
    return this.session.watching || ((this.hasTouchInput || this.settings().layoutPreset !== 'Auto') && !this.session.loading &&
      (this.ctx.mode === 'command' || this.ctx.mode === 'targeting'))
  }

  private get hasTouchInput(): boolean {
    return this.grid.coarsePointer || this.usedTouchWithFinePointer || this.lastInput === 'touch'
  }

  private get touchControls(): boolean {
    if (this.chat.capturing) return false
    const preset = this.settings().layoutPreset
    return preset !== 'Desktop' && (preset !== 'Auto' || this.lastInput === 'touch')
  }

  private showTouchMapTip(mode: HintMode): boolean {
    const st = this.session.state
    if (st.inputMode === MouseMode.COMMAND) this.commandedIn = st.player
    if (this.lastInput !== 'touch' || this.session.loading || this.session.watching || this.chat.capturing || this.commandedIn !== st.player) return false
    return this.touchHints.shown(this.ctx, mode, this.overlays.hasClientOverlay)
  }

  private executePadAction(a: Action) {
    const beforeStep = this.runner.lastStep
    this.padHints.attempt(a, this.ctx, this.padHintEvidence(), performance.now())
    this.runner.execute(a)
    if (a.kind === 'step' && this.ctx.mode === 'command' && this.runner.lastStep !== beforeStep) this.padStep = this.runner.lastStep
    else this.padStep = null
    this.padHints.observe(this.padHintEvidence(), performance.now())
  }

  /**
   * A keyboard or pad action fired: the pointer's own selection (and the
   * tooltip hanging off it) goes away until the mouse moves again. The
   * server's cursors are untouched.
   */
  /** Which device spoke last: the prompt strip is drawn in its terms (hud.ts renderBar). */
  private inputFrom(device: InputDevice) {
    // Keep the layout stable when a touchscreen user also uses a mouse or keyboard.
    if (device === 'touch' && !this.grid.coarsePointer) this.usedTouchWithFinePointer = true
    if (device !== 'pad') {
      this.padHints.cancel()
      this.padStep = null
    }
    if (device === this.lastInput) return
    this.lastInput = device
    this.needsRender = true
  }

  /**
   * The spell bar's part of a frame (spell-bar.ts): the lit spell goes out when its moment passes, and the list
   * is looked up when it is wanted (a finger playing) and crawl stands still at its prompt with nothing up, a
   * moment after the last key and the last word from crawl, so the look never lands in the middle of something:
   * travel and explore keep the command mode while they run, and a key stops them.
   */
  private spellFrame() {
    this.spellBook.tick()
    this.spellBar.frame()
    if (this.tapArmed.size || this.hud?.touchPressPending || this.moveSwipe) return
    const st = this.session.state
    const still = st.inputMode === MouseMode.COMMAND && !st.menus.length && !st.ui.length && !st.textInput && !st.dialog && !st.messages.more
    if (!this.monsterPreview && !this.hud?.editingLayout && this.touchControls && this.session.playing && !this.session.watching && this.session.gamedata && this.ctx.mode === 'command' && still && !this.overlays.hasClientOverlay && performance.now() - Math.max(this.lastSent, this.lastHeard) > SPELL_LOOK_STILL_MS) this.spellBook.look()
  }

  /** The spell bar stands (and the messages over it): a finger playing a character with spells. */
  private spellsShown(): boolean {
    return this.touchControls && this.session.playing && !this.session.watching && this.spellBook.spells.length > 0
  }

  /** crawl's question which spell, asked of the bar's own cast on its way to the aim (spl-cast.cc `cast_a_spell`) */
  private castPrompt(): boolean {
    if (this.ctx.mode !== 'prompt' || !this.spellBar.casting()) return false
    // a line on the prompt channel, not a prompt the context parses: "Cast which spell? (? or * to list)", or with the
    // last spell offered first (trunk), "Confirm with . or Enter, or press ? or * to list all spells."
    const last = this.session.state.messages.lines.at(-1)
    return isSpellPrompt(last)
  }

  /** Its buttons show: on the map, in an aim, and through the cast's own prompt, with nothing of ours up. Elsewhere its row is bare. */
  private spellsLive(): boolean {
    const m = this.ctx.mode
    return (m === 'command' || (m === 'targeting' && !this.ctx.examining) || this.castPrompt()) && !this.overlays.hasClientOverlay && !this.chat.capturing && !this.mapShown
  }

  /** Start casting, or confirm this spell's current aim. */
  private spellTap(spell: Spell) {
    this.inputFrom('touch')
    this.prepareInput()
    if (!this.spellsLive() || !this.spellBook.known || this.spellBook.busy) return
    this.inputActed(false)
    this.spellBar.tap(spell)
    this.needsRender = true
  }

  private spellMore(describe: boolean) {
    this.inputFrom('touch')
    this.prepareInput()
    this.inputActed()
    if (this.ctx.mode !== 'command' || this.spellBook.busy) return
    if (describe) this.runner.send(cm.input('I'))
    else this.openActionTab('spells')
  }

  private inputActed(disarmSpell = true) {
    this.hud.cancelPendingMonsterHover()
    this.tapArmed.clear()
    if (disarmSpell) this.spellBar?.disarm()
    this.holding = null
    if (!this.pointerLive) return
    this.pointerLive = false
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    this.needsRender = true
  }

  private onKeyDown(ev: KeyboardEvent) {
    if (this.hud?.editingLayout) return
    if ((ev.target as HTMLElement | null)?.closest?.('.layout-launcher') && ['Enter', ' ', 'Tab'].includes(ev.key)) return
    this.hud.cancelPendingMonsterHover()
    if ((ev.key === 'Escape' && this.hud.dismissMonsterTooltip()) || this.monsterPreview) {
      ev.preventDefault()
      return
    }
    const target = ev.target as HTMLElement | null
    if (target?.closest?.('.fullscreen-control, .system-menu-button, .monster-inspect, .spellbar, .minimap-button') && ['Enter', ' ', 'Tab'].includes(ev.key)) return
    if (this.overlays.sectionedSettingsOpen && (ev.key === 'Tab' || isSettingsSliderKey(ev) ||
        target?.matches?.('.setting-control button') && ['Enter', ' '].includes(ev.key))) return
    if (ev.key === 'Escape' && this.hud.dismissStatusTooltip()) {
      ev.preventDefault()
      return
    }
    this.wake()
    // a key typed into a field is still the keyboard speaking (a server prompt's on-screen keyboard goes away for it)
    this.inputFrom('keyboard')
    this.prepareInput()
    if (target && !target.matches?.('.setting-slider') && isTextEntry(target)) return
    if (this.overlays.hasClientOverlay) {
      if (ev.key === 'Escape') this.overlays.clientOverlayInput('cancel')
      else if (ev.key === 'Backspace' && this.overlays.sectionedSettingsOpen) this.overlays.clientOverlayInput('resetSetting')
      else if (ev.key === 'ArrowDown') this.overlays.clientOverlayInput('next')
      else if (ev.key === 'ArrowUp') this.overlays.clientOverlayInput('prev')
      else if (ev.key === 'ArrowLeft') this.overlays.clientOverlayInput('left')
      else if (ev.key === 'ArrowRight') this.overlays.clientOverlayInput('right')
      else if (ev.key === 'PageDown') this.overlays.clientOverlayInput('pageNext')
      else if (ev.key === 'PageUp') this.overlays.clientOverlayInput('pagePrev')
      else if (ev.key === 'Home') this.overlays.clientOverlayInput('first')
      else if (ev.key === 'End') this.overlays.clientOverlayInput('last')
      // Enter and space both fire the row the cursor is on, as they do in a server menu
      else if (ev.key === 'Enter' || ev.key === ' ') this.overlays.clientOverlayInput('select')
      else if (!ev.altKey && !ev.metaKey) {
        if (ev.key === 'Tab') this.overlays.clientOverlayHotkey('Tab')
        else if (ev.key.length === 1) this.overlays.clientOverlayHotkey(ev.ctrlKey ? 'Ctrl-' + ev.key.toUpperCase() : ev.key)
      }
      ev.preventDefault()
      return
    }
    if (ev.key === 'F12' || ev.code === 'F12') {
      // client.js: F12 focuses chat
      if (this.chatOn) this.chat.focus()
      ev.preventDefault()
      return
    }
    if (this.session.watching) {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        this.uiOp('system')
      }
      return
    }
    // Esc is the server's game menu; Polished Crawl's settings are also under Commands → More.
    const mode = this.ctx.mode
    // on a screen the keyboard is a pad: Enter, Escape, Space and the arrows are its buttons and its
    // d-pad, and do exactly what those do (bindings.ts screenKey), down the same path
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
      const sk = screenKey(ev.key, this.ctx, this.overlays.popupScrolls)
      if (sk) {
        ev.preventDefault()
        // a pad's buttons never repeat (gamepad.ts): a held Enter confirms once, not on every screen it
        // opens; the arrows repeat as the d-pad does
        if (ev.repeat && 'button' in sk) return
        this.inputActed()
        const a = 'button' in sk ? buttonAction(sk.button, this.ctx) : resolve({ type: 'dir', dir: sk.dir, source: 'dpad' }, this.ctx)
        if (a) this.runner.execute(a)
        this.needsRender = true
        return
      }
    }
    // a server menu: paging and the paging characters move its hover and page on
    // the client, as menu.js does before any key reaches the server
    if (mode === 'menu' && this.ctx.menu?.menu.type !== 'crt' && this.overlays.menuKey(this.session.state, ev)) {
      ev.preventDefault()
      this.inputActed()
      this.needsRender = true
      return
    }
    // a popup that scrolls on the client (describe screens, help, the game-over
    // text): arrows, paging and the paging characters scroll it, as ui-layouts.js does
    if ((mode === 'popup' || mode === 'ended') && this.overlays.popupKey(this.session.state, ev)) {
      ev.preventDefault()
      this.inputActed()
      this.needsRender = true
      return
    }
    // direction keys are rewritten in command and targeting modes only; macro capture and everything else is raw
    if (mode === 'command' || mode === 'targeting') {
      const d = directionKey(ev)
      if (d) {
        ev.preventDefault()
        // direction keys keep their compass meaning for movement and targeting
        // (plain: step / cursor move, Shift: run / fire that way, Ctrl: attack).
        // Left and right turn or strafe as this key set's setting says
        this.inputActed()
        this.runner.step(d.abs as RelDir, { run: d.mod === 'shift', attack: d.mod === 'ctrl' })
        this.needsRender = true
        return
      }
    }
    const msg: ClientMessage | null = keydownMessage(ev)
    if (!msg) return
    ev.preventDefault()
    this.inputActed()
    this.runner.send(msg)
  }

  private attachPointer(c: HTMLCanvasElement) {
    c.tabIndex = -1
    c.addEventListener('contextmenu', (ev) => ev.preventDefault())
    c.addEventListener('pointerdown', (ev) => {
      const touch = ev.pointerType === 'touch'
      if (touch) this.inputFrom('touch')
      // mouse_control.js: any mousedown hides the cell tooltip
      clearTimeout(this.tooltipTimer)
      this.hud.hideTooltip()
      // a click is the mouse speaking: its selection is live again, so a click right after a key still acts on the hovered cell
      if (ev.pointerType === 'mouse') this.pointerLive = true
      if (this.drag) {
        if (this.startPinch(this.drag, ev)) c.setPointerCapture(ev.pointerId)
        return
      }
      if (touch && !ev.isPrimary && this.ctx.mode === 'command' && this.settings().swipeToMove) return
      const d: Drag = (this.drag = { id: ev.pointerId, g: new PointerDrag(touch, { t: ev.timeStamp, x: ev.clientX, y: ev.clientY }), button: ev.button, touch })
      // a finger held still on the view is R3, the stick click the touch bar has no cell for (bindings.ts TOUCH_CELLS):
      // what is ahead examined on the map, the overview on the level map; the lift then does nothing more
      if (d.touch && this.ctx.mode === 'levelmap') {
        d.hold = window.setTimeout(() => {
          if (this.drag !== d || d.g.moved) return
          d.held = true
          this.touchPress('R3')
        }, HOLD_MS)
      }
      c.setPointerCapture(ev.pointerId)
    })
    c.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'mouse') {
        const rect = this.canvas.getBoundingClientRect()
        this.hover = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
        this.hoverMoved = true
        this.pointerLive = true
        // the hovered cell is picked again next frame; only a change of cell draws one
        this.pickDirty = true
        this.wake()
        this.armCellTooltip(ev.pageX, ev.pageY)
      }
      if (this.pinch?.pts.has(ev.pointerId)) return this.pinchMap(ev)
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      // the button came up somewhere the page could not see it (off the window
      // entirely, so no pointerup was ever delivered): this move, with nothing
      // held, is that release. Drop the drag instead of orbiting a held button
      // that is not held.
      if (ev.pointerType === 'mouse' && ev.buttons === 0) return this.cancelDrag()
      const coalesced = ev.getCoalescedEvents?.() ?? []
      const step = d.g.move((coalesced.length ? coalesced : [ev]).map((e) => ({ t: e.timeStamp, x: e.clientX, y: e.clientY })))
      if (!step || d.held) return
      clearTimeout(d.hold)
      if (d.touch && this.panMapBy(d, step.dx, step.dy)) return
    })
    const end = (ev: PointerEvent) => {
      if (this.pinch?.pts.has(ev.pointerId)) {
        // either finger lifting ends the pinch, and the one left on the glass does nothing more
        for (const id of this.pinch.pts.keys()) if (c.hasPointerCapture(id)) c.releasePointerCapture(id)
        this.pinch = null
        this.drag = null
        return
      }
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      this.drag = null
      clearTimeout(d.hold)
      if (c.hasPointerCapture(ev.pointerId)) c.releasePointerCapture(ev.pointerId)
      // Keep the touch HUD in place until the click can use the view the pointer pressed.
      if (ev.type === 'pointerup' && !d.touch) this.inputFrom('pointer')
      if (d.held || d.pan) return
      if (ev.type === 'pointerup' && !d.g.moved) {
        // the message pane lets the press through to here (hud.ts dismissesMoreAt): on a pending --more-- it is space
        if (this.hud.dismissesMoreAt(ev.clientX, ev.clientY)) return this.runner.execute(CONTINUE)
        const rect = this.canvas.getBoundingClientRect()
        if (d.touch) {
          this.prepareInput()
          if (this.tapMapCursor(ev.clientX - rect.left, ev.clientY - rect.top)) return
          if (this.ctx.mode === 'command' && !this.settings().tapToMove) return
        }
        this.onPointer(ev.clientX - rect.left, ev.clientY - rect.top, d.button)
      }
    }
    // a drag does not survive leaving the page: the button released out there
    // sends no pointerup, and coming back should not still be a press
    // (the one listener reads `cancelDrag` when it fires, so it always lets go of the canvas in play; adding it again is a no-op)
    this.onWindowBlur ??= () => {
      this.hud.cancelTouchPresses()
      this.hud.cancelMonsterHover()
      this.cancelDrag()
    }
    window.addEventListener('blur', this.onWindowBlur)
    this.cancelDrag = () => {
      this.cancelMoveSwipe()
      if (this.pinch) {
        for (const id of this.pinch.pts.keys()) if (c.hasPointerCapture(id)) c.releasePointerCapture(id)
        this.pinch = null
        this.drag = null
        return
      }
      const d = this.drag
      if (!d) return
      this.drag = null
      clearTimeout(d.hold)
      if (c.hasPointerCapture(d.id)) c.releasePointerCapture(d.id)
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse' && this.hover) {
        this.hover = null
        this.hoverMoved = false
        this.wake()
      }
      clearTimeout(this.tooltipTimer)
      this.hud.hideTooltip()
    })
  }

  /**
   * Android's back (back.ts): B, the way out of whatever is up, but over the
   * map with nothing up, where crawl ignores Escape, Save and exit as the
   * Polished Crawl menu's row sends it. Crawl's S asks first, so a second back is the
   * B that answers no. The device stays what it was: back is no finger on the
   * view, nor the pad.
   */
  back() {
    if (this.hud?.editingLayout) { this.hud.closeLayoutEditor(); return }
    if (this.ctx.mode === 'command' && !this.session.watching && !this.overlays.hasClientOverlay && !this.chat.capturing) {
      this.runner.send(cm.input('S'))
      return
    }
    const t = performance.now()
    this.pad({ type: 'press', button: 'B', t, touch: true })
    this.pad({ type: 'release', button: 'B', t, held: 0, touch: true })
  }

  /** A finger pressing and releasing one of the pad's buttons at once, as the touch bar's do over time. */
  private touchPress(button: Button) {
    this.inputFrom('touch')
    const now = performance.now()
    this.hooks.gamepad.virtualDown(button, now, true)
    this.hooks.gamepad.virtualUp(button, now, true)
  }

  /**
   * dungeon_renderer.js handle_mouse + mouse_control.js handle_cell_tooltip:
   * with `tile_web_mouse_control` on, a pointer resting on a cell with a
   * monster for half a second shows its name, and what a click would do
   * (select target while targeting, describe on right click). The cell is
   * the pointer's selection (`pointerCell`); the tip is drawn at page
   * coordinates (pageX, pageY), where the pointer is.
   */
  private armCellTooltip(pageX: number, pageY: number) {
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    const st = this.session.state
    if (st.options.tile_web_mouse_control === false) return
    this.tooltipTimer = window.setTimeout(() => {
      if (this.drag) return
      const key = this.ctx.mode === 'command' ? this.pointerCell() : this.hover ? this.renderer.pick(this.hover.x, this.hover.y) : null
      if (key === null) return
      const x = (key & 1023) - 512
      const y = (key >> 10) - 512
      const cell = st.map.cells.get(mapKey(x, y))
      if (!cell?.mon) return
      const im = st.inputMode
      const canTarget = im === MouseMode.TARGET || im === MouseMode.TARGET_DIR || im === MouseMode.TARGET_PATH
      const canDescribe = canTarget || im === MouseMode.COMMAND || st.uiState === UiState.VIEW_MAP
      const visible = this.session.scene.cells.get(cellKey(x, y))?.visibility === 'visible'
      let text = ''
      if (canTarget && visible) text += 'Left click: select target'
      if (canDescribe) text += (text ? '<br>' : '') + 'Right click: describe'
      if (text) text = '<br><br>' + text
      this.hud.showTooltip(escapeHtml(cell.mon.name || '') + text, pageX + 10, pageY + 10)
    }, 500)
  }

  /**
   * action_panel.js show_panel / hide_panel: the panel's X folds it away and
   * the placeholder unfolds it again, the rc's `action_panel_show` either
   * way, and the change goes back to the rc, so the official client and
   * Polished Crawl agree on the next game.
   */
  private setPanelShown(shown: boolean) {
    const st = this.session.state
    if (st.options.action_panel_disabled === true) return
    st.options.action_panel_show = shown
    this.wake()
    if (!this.session.watching) this.runner.send(cm.setOption('action_panel_show', shown))
  }

  /**
   * A server popup or dialog is up, and the pointer may close it: ui.js
   * registers its handlers on the same condition. Under a finger (`touch`) a
   * menu is one too, as menu.js shows it with ui.show_popup: on a phone the
   * menu covers the view, and a tap beside it is the way out a finger reaches.
   */
  private popupUp(touch = false): boolean {
    if (this.monsterPreview?.popup) return false
    if (this.session.watching || this.overlays.hasClientOverlay) return false
    if (this.ctx.mode !== 'popup' && this.ctx.mode !== 'dialog' && !(touch && this.ctx.mode === 'menu')) return false
    return this.session.state.options.tile_web_mouse_control !== false
  }

  /**
   * ui.js popup_clickoutside_handler: while a popup is up (with
   * `tile_web_mouse_control` on) a mousedown outside it sends Escape, "since
   * for crawl we really need to send a 'close popup' message to the server
   * rather than do it in the client". The chat is outside the game
   * (`target_outside_game`) and keeps its clicks. Polished Crawl adds: a right click
   * closes wherever it lands, inside the popup too, the mirror of the right
   * click that opened a describe, so a look is over as fast as it began.
   * Under a finger, a crawl menu goes the same way (`popupUp`), and so do
   * Polished Crawl's own panels: a tap outside them is their Escape, a step back
   * (B). A mouse leaves those be, as before: it has the view to drag while
   * a setting is tuned. The touch bar is no outside, buttons or not: its
   * buttons are the pad's, and its Back already says what it does, so a tap
   * that misses one between them closes nothing. A finger outside closes
   * as it lifts rather than as it lands, since a swipe there turns the menu's
   * tabs as a swipe over it does (`onDocPointerEnd`).
   */
  private onDocPointer(ev: PointerEvent) {
    if (this.hud?.editingLayout) return
    this.hud.cancelMonsterHover()
    const t = ev.target instanceof Element ? ev.target : null
    const touch = ev.pointerType === 'touch'
    if (touch && !ev.isPrimary) this.cancelMoveSwipe()
    if (t?.closest('.fullscreen-control, .system-menu-button')) return
    this.wake()
    this.pointerClosed = false
    // a finger anywhere (a menu's row, a prompt's chip) is the finger speaking: the touch bar comes up for it
    if (touch) {
      this.inputFrom('touch')
      if (this.settings().swipeToMove) this.prepareInput()
    }
    if (t?.closest('.touchbar')) return
    if (touch && this.overlays.hasClientOverlay && !this.session.watching) {
      // inside a panel, on the on-screen keyboard or in the chat, the press is theirs
      if (t?.closest('.popup, .osk') || (t && this.chat.owns(t))) return
      ev.preventDefault()
      ev.stopPropagation()
      this.pointerClosed = true
      this.outsideTouch = {
        id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: ev.timeStamp,
        close: () => {
          if (!this.overlays.hasClientOverlay) return
          this.overlays.clientOverlayInput('cancel')
          if (!this.overlays.hasClientOverlay) this.overlayOpener = null
          this.needsRender = true
        },
      }
      return
    }
    if (!this.popupUp(touch)) {
      if (touch && ev.isPrimary && this.canSwipeMove() && t && this.root.contains(t) && !this.chat.owns(t) &&
          !t.closest('button, a, input, textarea, select, label, [role="button"], [contenteditable], [data-status-description], .chip, .action-panel, .perf, .popup, .osk')) {
        this.moveSwipe = { id: ev.pointerId, x: ev.clientX, y: ev.clientY }
      }
      return
    }
    if (t && this.chat.owns(t)) return
    // the perf pane takes its own taps (it saves the log); a tap on it is not a tap outside the popup
    if (t?.closest('.perf')) return
    const inside = !!t?.closest('.popup')
    if (inside && ev.button !== 2) return
    ev.preventDefault()
    ev.stopPropagation()
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    this.pointerClosed = true
    if (touch) this.outsideTouch = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: ev.timeStamp, close: () => this.runner.send(cm.key(27)) }
    else this.runner.send(cm.key(27))
  }

  /** The finger that came down outside a menu moves: the menu's tabs lean toward the turn it would make (tab-lean.ts). */
  private outsideMove(ev: PointerEvent) {
    const o = this.outsideTouch
    if (o && ev.pointerId === o.id) this.overlays.tabLean.lean(swipeLean(ev.clientX - o.x, ev.clientY - o.y))
  }

  private canSwipeMove(): boolean {
    return this.settings().swipeToMove && this.presentation === 'dungeon' && this.ctx.mode === 'command' &&
      this.session.state.phase === 'playing' && !this.session.loading && !this.session.closed && !this.session.watching &&
      !this.overlays.hasClientOverlay && !this.hud.editingLayout && !this.chat.capturing && !this.monsterPreview
  }

  private cancelMoveSwipe() {
    if (this.moveSwipe && this.drag?.id === this.moveSwipe.id) this.drag.g.moved = true
    this.moveSwipe = null
  }

  /**
   * The finger that came down outside a menu lifts: a sideways swipe is the
   * d-pad's Left or Right, as over the menu itself (swipe.ts), anything else
   * the tap that closes it. A movement swipe also waits for the finger to lift.
   */
  private onDocPointerEnd(ev: PointerEvent) {
    const swipe = this.moveSwipe
    if (swipe?.id === ev.pointerId) {
      const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y
      if (ev.type === 'pointerup' && Math.hypot(dx, dy) >= MOVE_SWIPE_MIN) {
        this.cancelMoveSwipe()
        this.prepareInput()
        const dir = compassSector(dx, dy)
        if (dir !== null && this.canSwipeMove()) {
          this.inputActed()
          this.runner.step(dir)
          this.needsRender = true
        }
      } else this.moveSwipe = null
    }
    const o = this.outsideTouch
    if (!o || ev.pointerId !== o.id) return
    this.outsideTouch = null
    if (ev.type === 'pointercancel') return this.overlays.tabLean.end(0)
    const step = swipeStep(ev.clientX - o.x, ev.clientY - o.y, ev.timeStamp - o.t)
    this.overlays.tabLean.end(step)
    if (step) this.touchPress(step > 0 ? 'DR' : 'DL')
    else o.close()
  }

  /**
   * A tap or click on the minimap opens the level map only from the game
   * itself. Over a menu it is a tap outside the menu, which closes it and
   * nothing more: under a finger the press already did (`onDocPointer`), and
   * a mouse's click closes it here.
   */
  private minimapTap() {
    if (this.pointerClosed) return
    if (!this.session.watching) {
      if (this.overlays.hasClientOverlay) {
        this.overlays.clientOverlayInput('cancel')
        if (!this.overlays.hasClientOverlay) this.overlayOpener = null
        this.needsRender = true
        return
      }
      if (MINIMAP_CLOSES.has(this.ctx.mode)) return this.runner.send(cm.key(27))
    }
    this.uiOp('levelmap')
  }

  /** ui.js context_disable: no browser context menu while a popup is up, except on a text input. */
  private onDocContextMenu(ev: MouseEvent) {
    if (this.hud?.editingLayout) return
    this.wake()
    // a long press on a menu's row is the finger's (onDocPointer took it as touch first): no callout over the menu
    if (!this.popupUp(this.lastInput === 'touch')) return
    const t = ev.target instanceof Element ? ev.target : null
    if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return
    ev.preventDefault()
  }

  /**
   * A click at canvas coordinates (px, py): the official client's
   * `click_cell` on the cell the pointer selects, with the button numbered as
   * `ev.which` (1 left, 2 middle, 3 right), and the server decides what it
   * means (see Runner.clickCell). The server remains authoritative.
   */
  private onPointer(px: number, py: number, button: number) {
    if (this.session.watching) return
    // tile_web_mouse_control = false turns off clicking on the dungeon view
    if (this.session.state.options.tile_web_mouse_control === false) return
    const key = this.renderer.pick(px, py)
    if (key === null) return
    this.runner.clickCell((key & 1023) - 512, (key >> 10) - 512, button + 1)
  }

  private monsterAtPortrait(x: number, y: number, portrait: Monster) {
    const { state, scene } = this.session
    const cell = state.map.cells.get(mapKey(x, y))
    const monster = cell?.mon
    if (!monster || monster.name !== portrait.name || monster.id !== portrait.id) return null
    if (monster.id === undefined && monster !== portrait) return null
    if (scene.cells.get(cellKey(x, y))?.visibility !== 'visible') return null
    return monster
  }

  private readMonsterDescription(monster: Monster): string | undefined {
    // The map reducer can replace the object when a monster leaves sight.
    const cached = this.monsterDescriptions.get(monster.id ?? monster)
    if (cached && cached.name === monster.name && cached.type === monster.type && cached.baseType === monster.btype) return cached.description
  }

  private inspectMonster(x: number, y: number, portrait: Monster, preview?: MonsterHoverPreview): boolean {
    if (this.monsterPreview && !preview) {
      if (this.pointerClosed) return false
      const request = this.monsterPreview
      // A click on the just-hovered monster can use the inspection already
      // on its way. Let the server's reply open as the normal interactive UI.
      if (!request.popup && request.x === x && request.y === y && (request.monster.id ?? request.monster) === (portrait.id ?? portrait)) {
        this.finishMonsterPreview()
        return true
      }
      request.nextInspect = { x, y, monster: portrait }
      return false
    }
    this.prepareInput()
    if ((!preview && this.pointerClosed) || this.session.watching || this.overlays.hasClientOverlay) return false
    if (this.ctx.mode !== 'command' && this.ctx.mode !== 'targeting') return false
    const monster = this.monsterAtPortrait(x, y, portrait)
    if (!monster) return false
    if (preview) {
      const cached = this.readMonsterDescription(monster)
      if (cached) {
        preview.show(cached)
        return true
      }
      if (this.monsterPreview) {
        this.pendingMonsterHover = { x, y, monster, preview }
        return true
      }
      // A right click opens a server popup. Only start a preview from a ready
      // command prompt so its reply cannot be confused with a nested popup.
      const { state } = this.session
      if (state.ui.length || state.menus.length || this.spellBook.busy || this.chat.capturing) return false
      if (state.inputMode === MouseMode.NORMAL && this.ctx.mode === 'command') {
        this.pendingMonsterHover = { x, y, monster, preview }
        return true
      }
      if (state.inputMode !== MouseMode.COMMAND) return false
      this.pendingMonsterHover = null
      const { name, type, btype: baseType } = monster
      const key = monster.id ?? monster
      this.monsterPreview = {
        x, y, monster,
        show: description => {
          if (description) {
            this.monsterDescriptions.set(key, { name, type, baseType, description })
            if (this.monsterDescriptions.size > 256) this.monsterDescriptions.delete(this.monsterDescriptions.keys().next().value!)
          }
          preview.show(description)
        },
        deadline: window.setTimeout(() => this.finishMonsterPreview(), 2500),
      }
      this.session.send(cm.clickCell(x, y, 3), true)
    } else this.runner.clickCell(x, y, 3)
    return true
  }

  private holdMonsterPreviewInput(msg: ClientMessage): boolean {
    if (!this.monsterPreview) return false
    return ['key', 'input', 'text_input', 'click_cell', 'target_cursor', 'inv_item_action', 'inv_item_describe', 'main_menu_action'].includes(msg.msg)
  }

  private observeMonsterPreview(msg: ServerMessage) {
    const request = this.monsterPreview
    if (!request) {
      if (msg.msg === 'input_mode' && msg.mode === MouseMode.COMMAND) this.resumeMonsterHover()
      return
    }
    const { ui } = this.session.state
    if (request.popup) {
      if (!ui.includes(request.popup)) this.finishMonsterPreview(msg.msg === 'ui-pop')
      return
    }
    if (msg.msg === 'ui-push') {
      const popup = ui.at(-1)
      if (ui.length === 1 && popup?.data === msg && popup.type === 'describe-monster') {
        request.popup = popup
        clearTimeout(request.deadline)
        request.deadline = window.setTimeout(() => this.finishMonsterPreview(), 2500)
        request.show(monsterDescriptionText(msg))
        // Only close the confirmed description. Keep its UI state until Crawl
        // acknowledges the close, while the HUD displays the extracted body.
        this.session.send(cm.key(27), true)
      } else this.finishMonsterPreview()
    } else if (['menu', 'init_input', 'show_dialog', 'game_client', 'go_lobby', 'game_ended'].includes(msg.msg)) {
      this.finishMonsterPreview()
    }
  }

  private finishMonsterPreview(confirmedClose = false) {
    const request = this.monsterPreview
    if (!confirmedClose) {
      this.pendingMonsterHover?.preview.show('')
      this.pendingMonsterHover = null
    }
    if (!request) return
    clearTimeout(request.deadline)
    this.monsterPreview = null
    if (!request.popup) request.show('')
    this.inputContextDirty = true
    this.wake()
    const next = request.nextInspect
    if (!confirmedClose) return
    if (next) {
      this.pendingMonsterHover = null
      this.inspectMonster(next.x, next.y, next.monster)
    } else queueMicrotask(() => this.resumeMonsterHover())
  }

  private resumeMonsterHover() {
    const next = this.pendingMonsterHover
    if (!next || this.destroyed || this.monsterPreview || this.session.state.inputMode !== MouseMode.COMMAND) return
    this.pendingMonsterHover = null
    if (next.preview.active() && !this.inspectMonster(next.x, next.y, next.monster, next.preview)) next.preview.show('')
  }

  /**
   * A finger's tap on the level map puts its cursor on the cell tapped, as a
   * click does in local tiles; a WebTiles click there does nothing.
   */
  private tapMapCursor(px: number, py: number): boolean {
    if (this.ctx.mode !== 'levelmap' || this.session.watching) return false
    const c = this.session.state.cursors[2]
    const key = this.renderer.pick(px, py)
    if (!c || key === null) return true
    this.inputActed()
    // taps quicker than the server's echo walk on from the last one's cell
    const t = this.mapTap
    const from = t && t.from.x === c.x && t.from.y === c.y && performance.now() - t.t < MAP_CURSOR_WINDOW_MS ? t.to : c
    const to = { x: (key & 1023) - 512, y: (key >> 10) - 512 }
    this.mapTap = { from: { x: c.x, y: c.y }, to, t: performance.now() }
    this.runner.mapCursorBy(to.x - from.x, to.y - from.y)
    return true
  }

  /**
   * A finger dragging the level map grabs it:
   * the map follows the finger, so its cursor, which the map is centred on,
   * walks the other way a cell for each cell's width dragged.
   */
  private panMapBy(d: Drag, dx: number, dy: number): boolean {
    if (this.ctx.mode !== 'levelmap' || this.session.watching || !(this.renderer instanceof Render2d)) return false
    const cs = this.renderer.cellSize
    // the first move counts from where the finger came down: the slop it crossed is part of the drag
    const p = (d.pan ??= { x: d.g.x - d.g.x0 - dx, y: d.g.y - d.g.y0 - dy })
    p.x += dx
    p.y += dy
    const cx = Math.trunc(p.x / cs)
    const cy = Math.trunc(p.y / cs)
    if (!cx && !cy) return true
    p.x -= cx * cs
    p.y -= cy * cs
    this.inputActed()
    this.mapTap = null
    this.runner.mapCursorBy(-cx, -cy)
    return true
  }

  /**
   * A second finger down on the level map while the first is on it starts a
   * pinch. Crawl owns the map's zoom (tileweb.cc `zoom_dungeon`, a tenth of
   * `tile_map_scale` a step), so the pinch only decides how many steps of
   * the zoom keys to send.
   */
  private startPinch(d: Drag, ev: PointerEvent): boolean {
    if (!d.touch || ev.pointerType !== 'touch' || d.held || this.ctx.mode !== 'levelmap' || this.session.watching) return false
    clearTimeout(d.hold)
    const pts = new Map([
      [d.id, { x: d.g.x, y: d.g.y }],
      [ev.pointerId, { x: ev.clientX, y: ev.clientY }],
    ])
    const d0 = Math.max(1, Math.hypot(ev.clientX - d.g.x, ev.clientY - d.g.y))
    const o = this.session.state.options.tile_map_scale
    this.pinch = { pts, d0, scale0: typeof o === 'number' && o > 0 ? o : 60, sent: 0 }
    this.inputActed()
    return true
  }

  /** The fingers moved apart or together: zoom by as many steps as the spread asks, within crawl's 20%..300%. */
  private pinchMap(ev: PointerEvent) {
    const p = this.pinch!
    p.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    const [a, b] = [...p.pts.values()]
    const want = p.scale0 * (Math.hypot(a.x - b.x, a.y - b.y) / p.d0)
    const steps = Math.round((Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, want)) - p.scale0) / MAP_SCALE_STEP)
    while (p.sent < steps) {
      p.sent++
      this.runner.sendKeys([{ text: '}' }])
    }
    while (p.sent > steps) {
      p.sent--
      // `{` as text would open a JSON message (keys.ts)
      this.runner.sendKeys([{ key: 123 }])
    }
  }

  /**
   * Right stick over the level map: accumulate deflection and step the map
   * cursor (north-up, absolute) each time a whole cell's worth builds up.
   */
  private panMap(dx: number, dy: number) {
    if (dx === 0 && dy === 0) {
      this.mapPan = { x: 0, y: 0 }
      return
    }
    const p = this.mapPan
    p.x += dx * MAP_PAN_RATE
    p.y += dy * MAP_PAN_RATE
    const sx = Math.abs(p.x) >= 1 ? Math.sign(p.x) : 0
    const sy = Math.abs(p.y) >= 1 ? Math.sign(p.y) : 0
    if (!sx && !sy) return
    p.x -= sx
    p.y -= sy
    const d = dirFromDelta(sx, sy)
    if (d !== null) this.runner.execute({ kind: 'cursor', dir: d })
  }

  private uiOp(op: string, arg?: number, category?: CommandCategory, section?: string) {
    switch (op) {
      case 'commands':
        this.openActionTab(this.actionTabUp)
        break
      case 'actionTab':
        // from the tab being turned to, when presses run ahead of crawl
        this.openActionTab(actionNeighbour(this.actionTurn?.target ?? this.ctx.menu?.actions?.current ?? this.actionTabUp, arg ?? 1))
        break
      case 'equipment': {
        // crawl's own pack, at once, on the page and row it was left on: its pages are the tabs (pack-tabs.ts)
        const seq = openPackKeys(this.session.state, this.packPage)
        this.runner.execute({ kind: 'keys', label: 'Inventory', seq })
        // no turns: the page left is gone (or was the first), so the pack stays on its first, Gear
        this.packReturn = { page: seq.length > 1 && this.packPage ? this.packPage : 'gear', seen: false }
        break
      }
      case 'interact':
        this.overlays.showChoices('Interact', [
          { label: contextualLabel(this.ctx), run: () => this.runner.contextual(false) },
          { label: 'Pick up items', run: () => this.runner.contextual(true) },
        ])
        break
      case 'palette':
        this.overlays.showPalette(category || 'command', section)
        break
      case 'popupAction':
        this.overlays.triggerPopupAction(arg ?? 0)
        break
      case 'system':
        this.overlays.showSystem({ spectating: this.session.watching, inGame: true, chat: this.chatOn, run: (a) => this.runner.execute(a) })
        break
      case 'bindings':
        this.overlays.showBindings(this.hooks.gamepad.kind)
        break
      case 'levelmap':
        if (this.lastInput === 'touch' && !this.session.watching) this.touchHints.attempt(deriveMode(this.session.state), performance.now())
        this.runner.execute(LEVEL_MAP)
        break
      case 'findItems':
        if (this.ctx.mode !== 'levelmap' && this.ctx.mode !== 'command') break
        this.overlays.showChoices('Find items', [
          { label: 'Items on this level', sub: 'known items on the current floor', tile: 'CMD_SEARCH_STASHES', run: () => this.runner.findItems(true) },
          { label: 'Search items…', sub: 'search across explored levels', tile: 'CMD_SEARCH_STASHES', run: () => this.runner.findItems(false) },
        ])
        break
      case 'scrollLog':
        if (arg) this.hud.scrollLog(arg)
        break
      case 'keyboard':
        this.overlays.oskOp('shift')
        break
    }
  }

  /**
   * One of X's actions as tabs (action-tabs.ts), by its key. The frame
   * lights the tab at once; crawl is asked for one menu at a time. From one
   * of its menus that one goes away first, and the key follows once it has
   * (`trackActions`): a key sent behind the Escape in one go could not wait
   * for `z`'s question, and a refused one would leak its `*` into the
   * dungeon. A press while a turn is under way only moves its target, so a
   * quick player never has a key land in the menu that was opening.
   */
  private openActionTab(id: ActionTabId) {
    this.actionTabUp = id
    this.overlays.showActionTabs(id, null)
    if (this.actionTurn) {
      this.actionTurn.target = id
      return
    }
    if (deriveMode(this.session.state) === 'menu') this.closeForTurn(id)
    else this.sendActionKey(id)
  }

  private closeForTurn(target: ActionTabId) {
    this.actionTurn = { target, sent: null, stage: 'closing', t: performance.now() }
    this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
  }

  private sendActionKey(target: ActionTabId) {
    const tab = actionTab(target)
    this.actionTurn = { target, sent: target, stage: 'sent', last: this.session.state.messages.lines.at(-1), t: performance.now() }
    this.runner.execute({ kind: 'keys', label: tab.label, seq: [{ text: tab.key }] })
  }

  /**
   * A turn of X's tabs, seen through: the tab's menu up (the frame goes,
   * and X will open on it again), or crawl's line refusing it ("You don't
   * know any spells."), which the frame shows where the menu would be.
   * `z` asks before it lists (spl-cast.cc `cast_a_spell`, a prompt-channel
   * line), and `*` answers. Anything else crawl puts up, or nothing for a
   * while, ends the turn and the frame with it. The keys go as crawl's
   * answers land; the frame goes only from a drawn frame (`drawn`), once
   * what crawl put up stands in its place, or the screen would be bare
   * for a frame between the two.
   */
  private trackActions(now: number, drawn: boolean) {
    const turn = this.actionTurn
    const st = this.session.state
    // read off the state, not the frame's context: crawl's answer to one key may call for the next before a frame is drawn
    const mode = deriveMode(st)
    const menu = mode === 'menu' ? topMenu(st) : undefined
    const up = menu ? actionTabOf(menu) : null
    if (!turn) {
      if (up) this.actionTabUp = up
      return
    }
    const end = () => {
      if (!drawn) return
      this.actionTurn = null
      if (this.overlays.openMenu === 'battle') this.overlays.closeClientOverlay()
    }
    // the frame was put away while crawl was still answering: what lands goes too
    const abandoned = this.overlays.openMenu !== 'battle'
    // a menu going away passes through `prompt` (its last line was one); anything else crawl puts up ends the turn
    const elsewhere = mode !== 'command' && mode !== 'menu' && mode !== 'prompt'
    if (elsewhere || now - turn.t > ACTION_TURN_MS) return end()
    if (turn.stage === 'closing') {
      // the menu left is still up until the Escape lands, whichever tab it is
      if (mode !== 'command') return
      if (abandoned) return end()
      return this.sendActionKey(turn.target)
    }
    if (up) {
      if (abandoned) {
        this.actionTurn = null
        this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
        return
      }
      // the player went on past this one while it opened
      if (up !== turn.target) return this.closeForTurn(turn.target)
      this.actionTabUp = up
      return end()
    }
    const last = st.messages.lines.at(-1)
    if (!last || last === turn.last) return
    const text = formattedStringToText(last.text).trim()
    if (text === OKAY_THEN) return
    // `z` asks before it lists, and waits for the answer; a refusal (some on the same channel) waits for nothing
    if (mode !== 'command') {
      if (turn.sent === 'spells' && turn.stage === 'sent' && last.channel === MSGCH.PROMPT) {
        turn.stage = 'listing'
        turn.last = last
        this.runner.execute({ kind: 'keys', label: 'List spells', seq: [{ text: '*' }] })
      }
      return
    }
    // refused: the tab is empty, and crawl's line says so; or the player has gone on, and the next key goes
    if (abandoned) return end()
    if (turn.sent !== turn.target) return this.sendActionKey(turn.target)
    this.actionTurn = null
    this.overlays.showActionTabs(turn.target, text)
  }

  /**
   * The pack's page and row, kept as the player leaves them, so Y brings the
   * pack back where it was: the same scroll under the cursor for reading it
   * again and again. Once Y's pack is on its page the cursor goes back to the
   * item, by its letter (a stack keeps its letter as it shrinks); an item
   * gone leaves crawl's own first row.
   */
  private trackPack() {
    const m = this.ctx.mode === 'menu' ? this.ctx.menu : undefined
    const page = m?.pack?.current
    const back = this.packReturn
    if (!m || !page) {
      // the pack put away (or never opened: crawl refused it) after Y's turn at it
      if (back?.seen && this.ctx.mode !== 'menu') this.packReturn = null
      return
    }
    if (back) {
      back.seen = true
      if (page !== back.page) return
      this.packReturn = null
      const key = this.packRow.get(page)
      if (key !== undefined) this.overlays.hoverHotkey(this.session.state, key)
    }
    this.packPage = page
    const hovered = m.menu.items[m.menu.last_hovered]?.hotkeys?.[0]
    if (hovered !== undefined) this.packRow.set(page, hovered)
  }

  /**
   * The player stepped on (or changed level): X opens on Spells and Y on
   * Gear's first row again. The tab and row kept are for doing the same
   * thing again where you stand, a scroll of identify read after another.
   */
  private forgetTabs() {
    this.actionTabUp = 'spells'
    this.packPage = null
    this.packRow.clear()
  }

  private systemAction(op: string) {
    if (op === 'chat' && this.chatOn) this.chat.padFocus()
    else if (op === 'disconnect') this.hooks.onSystem('disconnect')
  }
}

/** How long a turn of X's tabs waits on crawl before it gives up (`trackActions`), as the runner's `awaitPrompt` waits on a prompt. */
const ACTION_TURN_MS = 1500

export { keyMessage }

/** How far a phone's keyboard comes up over `host`'s foot: the visual viewport shrinks for it, the layout one does not. */
function keyboardCover(host: HTMLElement): number {
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, Math.round(host.getBoundingClientRect().bottom - (vv.offsetTop + vv.height)))
}
