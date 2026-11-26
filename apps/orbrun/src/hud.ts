import { formattedStringToHtml, formattedStringToText, MapFeature, UiState, type GameState, type InvItem, type Monster, actionPanelItems } from '@orbrun/webtiles'
import { mapColour, mapPalette, minimapFit, minimapRaster, type MinimapSize, type MinimapAlignment } from './minimap'
import { cellKey, keyToXY, type Billboard, type Scene, type SceneCursor } from '@orbrun/scene'
import { Render2d } from '@orbrun/render-2d'
import { monsterGroups } from '@orbrun/scene-webtiles'
import type { Gamedata } from '@orbrun/gamedata'
import { h, clear, escapeHtml, replace, snapToPixels } from './dom'
import { commandTileId, tileCanvas } from './overlays'
import { CONTINUE, TOUCH_ANCHORS, TOUCH_CELLS, barLabels, isExtraButton, isSwitchButton, buttonGroup, promptLabels, typedInLog, type Action, type BindingLabel, type TouchCell, type TouchExtra, type TouchIcon, type TouchLabel } from './bindings'
import { SLOT_CELLS, TILE_POSITIONS } from './touch-arrangement'
import { loadShortcuts, saveShortcuts, shortcutLabel } from './touch-shortcuts'
import { editTouchLayout } from './touch-layout-editor'
import { glyphPath, type TouchGlyph } from './touch-glyphs'

/** A tap-or-hold button down: which, and the press's length as a fraction of the hold (bindings.ts HOLD_MS). */
export interface HoldProgress {
  button: string
  fraction: number
}
import { glyph, glyphName } from './glyphs'
import { defaultSettings, type Settings } from './settings'
import type { Context } from './context'
import type { Button, DiagonalButton, PadKind, VirtualButton } from './gamepad'
import type { InputDevice } from './game'
import { chatCaptionHeight, PORTRAIT_MAP_COLS, TOUCH_BUTTON_H, TOUCH_BUTTON_W, isPortrait, type CellRect, type GameLayout } from './grid/console'
import type { GridHost } from './grid/host'
import { MOBILE_GAP, PHONE_MONSTER_CELL, PHONE_MONSTER_LIST_HEIGHT, type MobileDungeon } from './grid/mobile'
import type { Spell } from './spell-bar'
import type { TouchLesson } from './touch-hints'
import { paneRows } from './grid/messages'
import { panelCellAt, panelCellIndex, panelGrid, panelScale, panelSpan, PANEL_CELL, type PanelBox, type PanelGrid } from './grid/panel'
import { paintRow } from './grid/paint'
import { PORTRAIT_ROWS, statsRows, type BarMemory } from './grid/stats'
interface PxRect { left: number; top: number; width: number; height: number }

export interface HudHooks {
  onBarAction(a: Action): void
  onMinimapClick(): void
  onMinimapInspect?(point: { x: number; y: number } | null): void
  onInspectMonster(x: number, y: number, monster: Monster): void
  onPreviewMonster(x: number, y: number, monster: Monster, preview: MonsterHoverPreview): boolean
  onPanelHover?(): void
  /** anywhere on the stats pane, the portrait and the name with it: the character screen, as the Character button opens it */
  /** action_panel.js: a left click uses the item (`inv_item_action`), a right click describes it (`inv_item_describe`). */
  onPanelItem(slot: number, describe: boolean): void
  /** action_panel.js show_panel: the placeholder brings a folded panel (`action_panel_show` off) back. */
  onPanelShow(): void
  /** action_panel.js hide_panel: the X button folds the panel away (`action_panel_show` off). */
  onPanelHide(): void
  /** action_panel.js: the game-menu button sends `main_menu_action`. */
  onGameMenu(): void
  /** action_panel.js show_settings: a right click on the X opens the panel's settings — Polished Crawl's own settings screen. */
  onPanelSettings(): void
  /** a finger went down (`down`) or came up on one of the touch bar's buttons: the pad's own button, pressed */
  onTouchButton(button: VirtualButton, down: boolean, cancelled: boolean): void
  /** a touch button for a menu's more-line switch or a popup's verb was tapped: send its key (Overlays.sendSwitch) */
  onTouchSwitch(key: string): void
  onLayoutSaved(sizingChanged: boolean): void
  onEditLayout(): void
  onShortcut(id: string): void
  /** A contextual button of the bar's own (bindings.ts `TouchExtra`). */
  onTouchExtra(id: TouchExtra): void
  /** a spell on the spell bar was tapped (spell-bar.ts SpellBar) */
  onSpellTap(spell: Spell): void
  /** The spellbook, or the non-phone bar's More button. */
  onSpellMore(describe: boolean): void
}

export interface MonsterHoverPreview {
  active(): boolean
  show(description: string): void
}

type SpellBarView = { spells: Spell[]; lit: string | null; short: string[]; commands: boolean }

/** monster_list.js: at most this many rows, then an ellipsis on the last. */
const MONSTER_LIST_MAX_ROWS = 5
const MONSTER_LIST_CELL = 32
const MINIMAP_LIST_GAP = 12
/** monster_list.js: at most this many sprites in one grouped row. */
const MONSTER_LIST_MAX_SPRITES = 6
/**
 * action_panel.js reserves two cells before the first item: the X that folds
 * the panel away (a right click on it opens the panel's settings; Polished Crawl
 * opens its own settings screen there) and the game-menu button. Polished Crawl draws
 * both, as the official client does.
 */
const NUM_RESERVED_BUTTONS = 2
/**
 * Modes whose screen is a panel over the view (overlays.ts `.popup`: a menu,
 * a CRT screen, a describe popup, a dialog, the new-game chooser, the death
 * screen). Its foot can lie a line or two above the view's, so the
 * prompts run along the strip under it as one row rather than a column.
 */
const POPUP_MODES: ReadonlySet<Context['mode']> = new Set(['menu', 'popup', 'crt', 'dialog', 'newgame', 'ended'])
/**
 * The level map's prompts, left to right in pairs that go together, each
 * pair one over the other: the stick lesson, the bumpers (stairs), the
 * triggers (zoom), the stick clicks, then the face buttons.
 */
const FOOT_PAIRS: readonly (readonly BindingLabel['button'][])[] = [
  ['LSTICK', 'LSTICK_UP', 'DPAD', 'RSTICK'],
  ['LB', 'RB'],
  ['LT', 'RT'],
  ['L3', 'R3'],
  ['Y', 'X'],
  ['A', 'B'],
  ['SELECT', 'START'],
]

/**
 * The prompts under a panel, left to right, so every menu reads them in the
 * same order and A, the button that fires the lit row, is always at the
 * right end: the sticks, the shoulders and triggers, the clicks and the
 * middle buttons, then the face buttons Y, X, B, A.
 */
const UNDER_ORDER: readonly BindingLabel['button'][] = ['LSTICK', 'LSTICK_UP', 'DPAD', 'RSTICK', 'LB', 'RB', 'LT', 'RT', 'L3', 'R3', 'SELECT', 'START', 'Y', 'X', 'B', 'A']

/** A prompt's cell under a menu (`footerPlaces`), 1-based as a grid's lines are. */
export interface FooterPlace {
  row: number
  col: number
}

/**
 * Where each prompt stands under a menu: in the cell of the footer that
 * names it (menu.cc `pad_more_with` lays its switches out in columns), so a
 * glyph is where the eye found its words: the shop's "mark item for
 * purchase" top right, "put item on shopping list" under it, "buy|examine
 * items" left of the first. The footer's rows and columns, closed up over
 * the ones no prompt names. Null when the footer names none of them.
 */
export function footerPlaces(more: string, labels: readonly BindingLabel[]): Map<BindingLabel, FooterPlace> | null {
  const lines = formattedStringToText(more).split('\n')
  const hits: { l: BindingLabel; line: number; start: number }[] = []
  for (const l of labels) {
    const words = formattedStringToText(l.label).trim()
    if (!words) continue
    // the switch's words after its bracketed key, up to the column gap or the line's end (menu-nav.ts parseMoreSwitches)
    const re = new RegExp('\\]\\s+' + words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?= {2,}|\\s*$)')
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i])
      if (!m) continue
      hits.push({ l, line: i, start: lines[i].lastIndexOf('[', m.index) })
      break
    }
  }
  if (!hits.length) return null
  const rows = [...new Set(hits.map((h) => h.line))].sort((a, b) => a - b)
  const cols = [...new Set(hits.map((h) => h.start))].sort((a, b) => a - b)
  return new Map(hits.map((h) => [h.l, { row: rows.indexOf(h.line) + 1, col: cols.indexOf(h.start) + 1 }]))
}

/** css px between a panel's foot and the prompts under it (placeBar) */
const BAR_GAP = 16

/** The pad's menu buttons (bindings.ts COMMAND), by the hand that reaches them: top to bottom as they sit on the pad, the everyday one at the foot. */
const MENU_LEFT: readonly Button[] = ['SELECT']
const MENU_RIGHT: readonly Button[] = ['START', 'Y', 'X']
const MENU_BUTTONS: readonly Button[] = [...MENU_LEFT, ...MENU_RIGHT]

/**
 * One row of the WebTiles monster list (`monster_list.js`): a strip of sprites
 * drawn with the cell renderer, the glyph-mode health box, the name.
 */
interface MonsterRow {
  node: HTMLElement
  canvas: HTMLCanvasElement
  portraitActions: HTMLElement
  r2d: Render2d
  health: HTMLElement
  name: HTMLElement
  ellipsis: HTMLElement | null
}

function sameMonster(a: Billboard, b: Billboard | undefined): boolean {
  return !!b && a.x === b.x && a.y === b.y && a.name === b.name && (a.ref as Monster).id === (b.ref as Monster).id
}

export const STATUS_BADGE_ROWS = 4

/** The hud's own font (styles.css `--mono`), for what is drawn on a canvas, where a css variable cannot be named; nothing sets it at run time, so it is read once. */
let monoFace = ''
function gridFont(): string {
  if (!monoFace) monoFace = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim()
  return monoFace || 'monospace'
}

/** The page's text weight (styles.css `--text-weight`), for the labels the hud draws on canvases; read each time, it is cheap and a test may change it. */
function textWeight(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--text-weight').trim() || 'normal'
}

/** A face the rc names for canvas text (glyph_mode_font, action_panel_font_family): WebTiles' default "monospace" is ours, as game.ts maps it for the page's text. */
export function rcFont(v: unknown): string {
  return typeof v === 'string' && v && v !== 'monospace' ? v : gridFont()
}

export class Hud {
  root: HTMLElement
  /** the right column (game.html `#right_column`): the stats pane, the minimap, the monster list, on the sidebar's cells */
  private sidebar = h('div', { class: 'sidebar' })
  /** the WebTiles `#stats` pane (player.js / game.html) as text rows on the grid (grid/stats.ts) */
  private stats = h('div', { class: 'stats' })
  private statsRowPx = 0
  private statusTooltip = h('div', { class: 'tooltip status-tooltip', role: 'tooltip', hidden: true })
  private statusTooltipAnchor: HTMLElement | null = null
  /**
   * The portrait: the player's own cell, drawn with the same cell renderer
   * as the monster list's thumbnails (`render_cell`), at the pane's
   * top-left corner beside the title and god lines. The doll, its status
   * badges and whatever the player stands on, exactly as the 2D view draws
   * the player's cell, next to the status summary.
   */
  private portraitCanvas = h('canvas', { class: 'portrait' })
  private portrait = new Render2d({ mode: 'tiles', cellSize: 32 })
  /** the portrait's side in css px (`PORTRAIT_ROWS` of the grid) and the cells the rows beside it give up */
  private portraitPx = 0
  private portraitDpr = 0
  /** the HUD's canvases are to be moved onto whole device pixels again at the end of this update (snapToPixels) */
  private snapDue = false
  private portraitCols = 0
  private portraitPre: unknown[] | undefined
  /** consumables action panel (action_panel.js): inventory items with action_panel_order >= 0, in the strip along the top between the stats pane and the minimap (grid/panel.ts) */
  private actionPanel = h('div', { class: 'action-panel' })
  private minimapButton = h('button', { class: 'minimap-button', type: 'button', 'aria-label': 'Dungeon minimap, open level map', title: 'Open level map (X). Hold the right mouse button to look around.' })
  private minimapWindow = h('span', { class: 'minimap-window' })
  private inspectPointer: number | null = null
  private minimapCanvas = h('canvas', { class: 'minimap' })
  /**
   * The status strip: the player's own corner badges (poison, constriction,
   * the server's status icons) blown up beside the minimap, each a square
   * STATUS_BADGE_ROWS of the grid tall, in a row running leftward from the
   * map's left edge a cell's gutter away, another row down once the row is
   * full; where the stats pane leaves no room for one, under the map
   * instead, the monster list stepping down to make room. The portrait paints them at a few texels in the corner of a cell;
   * here a poisoned character reads from across the room. Hidden when
   * there is nothing to show, and with the sidebar.
   */
  private sidebarFoot = h('div', { class: 'chat-space', hidden: true, 'aria-hidden': 'true' })
  private statuses = h('div', { class: 'statuses', hidden: true })
  private statusCanvas = h('canvas', { class: 'status-canvas' })
  private statusR2d = new Render2d({ mode: 'tiles', cellSize: 32 })
  /** a badge's side in css px and how many go across a row, from `layout` */
  private statusPx = 0
  private statusCols = 1
  /** where the rows hang: their right edge and top in css px, and whether under the map (with the gap to the monster list); null with no minimap to hang off */
  private statusAt: { right: number; top: number; below: number } | null = null
  private statusKey = ''
  /** what the strip was last considered for, checked before the scene is scanned */
  private statusPre: unknown[] | undefined
  private minimap = new Render2d({ mode: 'minimap', cellSize: 1, follow: false, living: false, background: 'transparent' })
  /**
   * The server's cursor (targeting, `x` examine, level map) on the minimap
   * too, so the player sees where they are pointing on the map as well as in
   * the view.
   */
  setCursor(cursor: SceneCursor | null) {
    this.minimap.setCursor(cursor)
    this.minimapKey = ''
  }
  /** What the minimap was last drawn for; empty when it must draw again (a resize, the level map closing, a new cursor). */
  private minimapKey = ''
  private minimapEnabled = true
  /** the finger's lessons standing (touch-hints.ts): a ring on the pane a tap opens something from, and its word under it */
  private touchHints = new Map<TouchLesson, { ring: HTMLElement; caption: HTMLElement; key: string }>()
  /** the WebTiles `#monster_list` */
  private monsters = h('div', { class: 'monsters' })
  private monsterRows: MonsterRow[] = []
  private monsterTargets = new WeakMap<HTMLElement, Billboard>()
  private monsterHover: { anchor: HTMLElement; target: Billboard; x: number; y: number } | null = null
  private monsterTooltip = h('div', { class: 'tooltip monster-tooltip', role: 'tooltip', hidden: true })
  private monstersKey = ''
  private monstersPre: unknown[] | undefined
  /** action panel: the one canvas WebTiles draws the buttons and item tiles on */
  private panelCanvas = h('canvas', { class: 'action-canvas' })
  private panelR2d = new Render2d({ mode: 'tiles', cellSize: 32 })
  private panelItems: (InvItem & { letter: string })[] = []
  private panelInventoryRev = -1

  panelButtonCount(state: GameState) {
    if (state.rev.player !== this.panelInventoryRev) {
      this.panelItems = actionPanelItems(state)
      this.panelInventoryRev = state.rev.player
    }
    return NUM_RESERVED_BUTTONS + this.panelItems.length
  }

  private panelSelected = -1
  /** the strip the panel stands in (grid/panel.ts `panelSpan`), from `layout`; zero width when there is no room for it */
  private panelBox: PanelBox = { left: 0, top: 0, width: 0, height: 0 }
  /** how the panel's cells last came out, and the cell's size in css px, so the pointer can name the cell it is over */
  private panelCells: PanelGrid = { cols: 0, rows: 0, shown: 0, overflow: false }
  private panelCell = 0
  private panelHorizontal = true
  private panelTooltip = h('div', { class: 'tooltip', style: { display: 'none' } })
  private panelTooltipTimer = 0
  /** hides the status line; one at a time, so a second status keeps its own three seconds */
  private statusTimer = 0
  private panelKey = ''
  private panelPre: unknown[] | undefined
  /** a chip wears the hold ring, so the next frame without a hold clears it */
  private holdShown = false
  /** the message pane (game.html `#message_pane`) as rows on the grid (grid/messages.ts), the `--more--` row last */
  private messages = h('div', { class: 'messages' })
  private actionbar = h('div', { class: 'actionbar' })
  /** the pad's standing menu buttons along the view's last row (renderMenus) */
  private menubar = h('div', { class: 'menubar', hidden: true })
  private shortcutArt: Gamedata | null = null
  private shortcuts = loadShortcuts()
  private editor?: HTMLDialogElement
  get editingLayout() { return !!this.editor?.open }
  closeLayoutEditor() { this.editor?.close() }

  private readonly editLayout = h('button', {
    type: 'button', class: 'layout-launcher', title: 'Edit touch layout', 'aria-label': 'Edit touch layout', 'aria-haspopup': 'dialog',
  }, h('span', { class: 'layout-mark', 'aria-hidden': 'true' }, ...TILE_POSITIONS.pair.map(() => h('i'))))
  /** Base cell dimensions shared by the compass, shortcuts and contextual controls. */
  private touchbar = h('div', { class: 'touchbar', hidden: true, style: { '--tb-w': TOUCH_BUTTON_W + 'px', '--tb-h': TOUCH_BUTTON_H + 'px' } })
  private touchPointers = new WeakMap<HTMLElement, number>()
  /** the spell bar (renderSpellBar): the touch bar's buttons, one row of them, under the messages */
  /** the layout keeps the spell bar's row under the messages (game.ts relayout) */
  spellRow = false
  private spellbar = h('div', { class: 'touchbar spellbar', hidden: true, style: { '--sb': SPELL_SLOT + 'px', '--sb-gap': SPELL_GAP + 'px', '--tb-h': TOUCH_BUTTON_H + 'px' } })
  private spellTrack = h('div', { class: 'spell-track' })
  private spellTrackKey = ''
  /** the touch bar stands at the right column's foot, under the minimap, not along the view's (console.ts touchBeside) */
  touchBeside = false
  private mobile: MobileDungeon | null = null
  private touchLayout: MobileDungeon | null = null
  /** where the log stands (placeLog): its cells' foot, where its last line should end, and a grid row, in css px; null leaves it on its cells */
  private logPlace: { cellsFoot: number; logFoot: number; row: number } | null = null
  private statusEl = h('div', { class: 'status-line', style: { display: 'none' } })
  private hooks: HudHooks
  private lastMsgKey = ''
  private lastPlayerRev = -1
  /** A stats row is painted again only when its key changes. */
  private statsKeys: string[] = []
  private logOffset = 0
  /** player.js `old_hp` / `old_mp` / `old_noise`: the previous values that size the increase/decrease bar segments */
  private bars: BarMemory = {}
  /** the grid and the split the pane last laid out on; nothing draws before the first `layout` */
  private host: GridHost | null = null
  private cells: GameLayout | null = null
  /** the free part of the view in css px, from `layout`, for `keepClear` */
  private freePx: PxRect | null = null
  /** Bounds used to place the menu strip across the view. */
  private viewBounds: PxRect | null = null
  /** the free view, whose bottom-right corner the prompts stack up from (layout), and where they were last put (placeBar) */
  private barCorner: PxRect | null = null
  private barAt = ''
  private barUnder = false
  /** the size the minimap was last given, in css px; nothing draws before the first `layout` */
  private minimapSize = { w: 0, h: 0 }
  private rcMapPixels = 0
  private minimapPreset: MinimapSize = defaultSettings.minimapSize
  private minimapAlignment: MinimapAlignment = defaultSettings.minimapAlignment
  get minimapShown() { return this.minimapSize.w > 0 }
  setMinimapAppearance(settings: Pick<Settings, 'minimapSize' | 'minimapAlignment' | 'minimapOutline' | 'minimapBackgroundOpacity'>, alignment = settings.minimapAlignment) {
    this.minimapPreset = settings.minimapSize
    this.minimapAlignment = alignment
    const align = { Left: 'start', Center: 'center', Right: 'end' }[alignment]
    this.sidebar.style.setProperty('--minimap-align', align)
    this.minimapButton.classList.toggle('outlined', settings.minimapOutline)
    this.minimapButton.style.setProperty('--minimap-background-opacity', (settings.minimapBackgroundOpacity * 100) + '%')
  }

  constructor(host: HTMLElement, hooks: HudHooks, private fullscreenButton?: HTMLButtonElement) {
    this.hooks = hooks
    this.root = h('div', { class: 'hud' })
    this.editLayout.addEventListener('click', () => {
      if (this.editingLayout) return
      for (const held of this.touchbar.querySelectorAll<HTMLElement>('.down[data-b]')) this.releaseTouchButton(held, true)
      this.hooks.onEditLayout()
      const editor = editTouchLayout(host, this.shortcuts, s => touchPicture(this.shortcutArt, s), () => this.touchLayout?.widthSpace, (layout, sizingChanged) => {
        this.shortcuts = layout
        saveShortcuts(layout)
        this.hooks.onLayoutSaved(sizingChanged)
      })
      this.editor = editor
      editor.addEventListener('close', () => {
        if (this.editor === editor) this.editor = undefined
      }, { once: true })
    })
    this.root.append(this.stats, this.sidebar, this.statuses, this.actionPanel, this.messages, this.menubar, this.actionbar, this.touchbar, this.spellbar)
    this.minimapButton.append(this.minimapCanvas, this.minimapWindow)
    this.sidebar.append(this.minimapButton, this.monsters, this.sidebarFoot)
    // Layout changes can fire pointerover under a stationary cursor when a
    // full inspection closes. Mouse motion starts the new hover immediately.
    this.monsters.addEventListener('pointermove', (ev) => this.showMonsterHover(ev))
    this.statuses.append(this.statusCanvas)
    this.statusR2d.mount(this.statusCanvas)
    host.append(this.root, this.statusEl, this.panelTooltip, this.statusTooltip, this.monsterTooltip)
    this.minimap.mount(this.minimapCanvas)
    this.portrait.mount(this.portraitCanvas)
    this.actionPanel.append(this.panelCanvas)
    this.panelR2d.mount(this.panelCanvas)
    this.attachPanelPointer()
    this.minimapButton.addEventListener('click', () => hooks.onMinimapClick())
    this.minimapButton.addEventListener('contextmenu', ev => ev.preventDefault())
    this.minimapButton.addEventListener('pointerdown', ev => {
      if (ev.button !== 2 || this.inspectPointer !== null) return
      ev.preventDefault()
      this.inspectPointer = ev.pointerId
      this.minimapButton.setPointerCapture(ev.pointerId)
      this.inspectMap(ev)
    })
    this.minimapButton.addEventListener('pointermove', ev => this.inspectMap(ev))
    this.minimapButton.addEventListener('lostpointercapture', () => this.endMapInspection())
    this.minimapButton.addEventListener('pointerup', () => this.endMapInspection())
    this.minimapButton.addEventListener('pointercancel', () => this.endMapInspection())
    window.addEventListener('blur', this.endMapInspection)
    this.stats.addEventListener('pointerover', (ev) => {
      if (ev.pointerType === 'touch' || !(ev.target instanceof HTMLElement)) return
      const desc = ev.target.dataset.statusDescription
      if (desc) this.showStatusTooltip(ev.target, desc)
    })
    this.stats.addEventListener('pointerout', (ev) => {
      if (ev.target === this.statusTooltipAnchor) this.dismissStatusTooltip()
    })
    // The log handles a pending --more-- where it takes clicks. Taps through to
    // the canvas use dismissesMoreAt instead.
    this.messages.addEventListener('click', () => {
      if (this.messages.classList.contains('dismissable')) hooks.onBarAction(CONTINUE)
    })
  }

  /**
   * Set the HUD on the grid, over the view:
   * the stats pane on its cells at the top-left corner, the sidebar (the
   * minimap, the monster list) on its column at the right, the message pane
   * on its rows along the bottom. `free` is the part of the view no pane
   * lies over: the action panel sits at its top-left corner under the stats
   * pane, as close to where action_panel.js floats it as the pane allows,
   * the prompts stacked upward from its last row at the right. While the level map is
   * open the stats pane, the sidebar and the messages step aside when the
   * rc's `tile_level_map_hide_*` say so (game.js
   * `toggle_full_window_dungeon_view`, which hides the whole `#right_column`);
   * the stats pane alone steps aside while the new-game chooser is up.
   */
  layout(host: GridHost, cells: GameLayout, free: CellRect, hidden: {
    stats: boolean; sidebar: boolean; messages: boolean; portrait?: boolean; monsters?: boolean; actionPanel?: boolean; desktopMenu?: boolean
  }, characterPanelScale = 1, mobile: MobileDungeon | null = null, touchLayout = mobile) {
    this.dismissStatusTooltip()
    this.cancelMonsterHover()
    this.host = host
    this.mobile = mobile
    this.touchLayout = touchLayout
    this.root.classList.toggle('mobile-dungeon', !!mobile)
    this.root.classList.toggle('mobile-landscape', !!mobile && !mobile.portrait)
    const portrait = mobile?.portrait ?? isPortrait(host.grid)
    // Upright Dungeon has no minimap column. Give the enabled list room below the stats.
    const uprightList = !mobile && portrait && !this.minimapEnabled && !hidden.monsters && !cells.sidebar.w
    if (uprightList) {
      const width = Math.min(PORTRAIT_MAP_COLS, host.grid.cols)
      cells = { ...cells, sidebar: { ...cells.sidebar, x: host.grid.cols - width, w: width } }
    }
    this.cells = cells
    this.spellbarW = null
    this.touchbarH = null
    const statsOnRight = cells.stats.x > cells.view.x
    const statsWidth = cells.stats.w * characterPanelScale
    const statsX = cells.stats.x + (!mobile && (statsOnRight || cells.stackedDesktop) ? cells.stats.w - statsWidth : 0)
    const statsRect = { ...cells.stats, x: statsX, w: statsWidth }
    host.place(this.stats, statsRect)
    this.statsRowPx = mobile?.statsRow ?? host.grid.ch * characterPanelScale
    this.stats.style.setProperty('--ch', this.statsRowPx + 'px')
    this.stats.style.fontSize = mobile ? mobile.statsFont + 'px' : ''
    this.messages.style.fontSize = mobile ? mobile.text.fs + 'px' : ''
    this.messages.style.setProperty('--ch', mobile ? mobile.text.ch + 'px' : '')
    const phonePortrait = mobile?.phonePortrait ?? false
    this.monsters.style.fontSize = mobile ? (phonePortrait ? Math.max(10, mobile.text.fs * 0.9) : mobile.text.fs) + 'px' : ''
    this.stats.style.setProperty('--character-panel-scale', String(characterPanelScale))
    // the pane grows with its rows (the status lights wrap); the cells give it its width and where it starts
    this.root.classList.toggle('stacked-desktop', !!cells.stackedDesktop)
    if (!mobile && !cells.stackedDesktop) this.stats.style.height = 'auto'
    // Compact status badges scroll with the monster list rather than lying over the clear view.
    if (cells.stackedDesktop) this.sidebar.prepend(this.statuses)
    else if (this.statuses.parentElement !== this.root) this.root.insertBefore(this.statuses, this.actionPanel)
    const sidebar = cells.sidebar
    const statsRowsShown = uprightList && !hidden.stats && this.stats.childElementCount
      ? (this.stats.childElementCount - 1) * characterPanelScale + 1
      : 0
    host.place(this.sidebar, { ...sidebar, y: sidebar.y + statsRowsShown, h: Math.max(0, sidebar.h - statsRowsShown) })
    host.place(this.messages, cells.messages)
    this.stats.hidden = hidden.stats || cells.stats.w === 0
    this.sidebar.hidden = hidden.sidebar || cells.sidebar.w === 0
    this.portraitCanvas.hidden = !!hidden.portrait
    this.monsters.hidden = !!hidden.monsters
    // the portrait is a square as tall as the pane's rows for it (one row on a compact pane); the rows beside it start a cell after it
    const side = !hidden.portrait && cells.stats.w > 0 ? this.statsRowPx * (mobile ? 2 : PORTRAIT_ROWS) : 0
    this.portraitCols = !side ? 0 : mobile ? Math.ceil(side / (mobile.text.cw * characterPanelScale)) + 1 :
      Math.min(cells.stats.w, Math.ceil(PORTRAIT_ROWS * host.grid.ch / host.grid.cw) + 1)
    const dpr = window.devicePixelRatio || 1
    if (side !== this.portraitPx || dpr !== this.portraitDpr) {
      this.portraitPx = side
      this.portraitDpr = dpr
      this.portrait.resize(side, side, dpr)
      this.portraitCanvas.style.width = side + 'px'
      this.portraitCanvas.style.height = side + 'px'
      this.portraitPre = undefined
    }
    this.messages.hidden = hidden.messages || !cells.messages.h
    const at = host.px(free)
    this.freePx = { left: at.left, top: at.top, width: at.width, height: at.height }
    this.placeFullscreen(this.statsKeys.length)
    for (const bar of [this.actionbar, this.menubar]) bar.style.maxHeight = cells.stackedDesktop ? at.height + 'px' : ''
    // The menu strip spans the full view width.
    const viewPx = host.px(cells.view)
    const msgPx = host.px(cells.messages)
    this.viewBounds = {
      left: at.left,
      top: at.top,
      width: Math.max(at.width, viewPx.left + viewPx.width - at.left),
      height: Math.max(at.height, msgPx.top + msgPx.height - at.top),
    }
    const sidePx = host.px(cells.sidebar)
    const statsPx = host.px(statsRect)
    const statsRight = this.stats.hidden || statsOnRight ? null : statsPx.left + statsPx.width
    const statsLeft = this.stats.hidden || !statsOnRight ? null : statsPx.left
    const gridW = host.grid.cols * host.grid.cw
    const bottom = this.root.clientHeight || 2 * host.grid.oy + host.grid.rows * host.grid.ch
    const across = host.width || gridW + 2 * host.grid.ox
    const compact = !!mobile || !!cells.stackedDesktop
    const chatFoot = chatCaptionHeight(host.grid.ch)
    const listRoom = hidden.monsters ? 0 : MONSTER_LIST_CELL + MINIMAP_LIST_GAP + chatFoot
    const mapRoom = mobile?.phonePortrait ? {
      width: sidePx.width,
      height: Math.max(0, Math.min(mobile.portraitMapHeight, sidePx.height - (hidden.monsters ? 0 : MOBILE_GAP + PHONE_MONSTER_CELL))),
    } : compact ? {
      width: sidePx.width * (hidden.monsters ? 1 : 0.45),
      height: Math.max(0, sidePx.height - (mobile?.sidebarChatHeight ?? 0)),
    } : { width: sidePx.width, height: Math.min(sidePx.height * 0.6, sidePx.height - listRoom) }
    const { w, h: size } = this.minimapEnabled && !this.sidebar.hidden
      ? minimapFit(mapRoom.width, mapRoom.height, this.minimapPreset, this.rcMapPixels)
      : { w: 0, h: 0 }
    const spare = mapRoom.width - w
    const mapOffset = this.minimapAlignment === 'Center' ? spare / 2 : this.minimapAlignment === 'Right' ? spare : 0
    this.sidebar.style.setProperty('--minimap-column', mapRoom.width + 'px')
    this.minimapSize = { w, h: size }
    this.sidebar.classList.toggle('compact-map', compact && !phonePortrait && this.minimapShown)
    this.sidebar.classList.toggle('phone-portrait-list', phonePortrait)
    this.sidebar.style.setProperty('--list-height', (phonePortrait ? PHONE_MONSTER_LIST_HEIGHT : mapRoom.height) + 'px')
    this.sidebar.style.setProperty('--minimap-list-gap', (phonePortrait ? MOBILE_GAP : MINIMAP_LIST_GAP) + 'px')
    // Keep the scrollable list clear of the chat caption over the sidebar's foot.
    this.sidebarFoot.hidden = !(cells.stackedDesktop || (!compact && this.minimapShown && !hidden.monsters))
    this.sidebarFoot.style.height = chatFoot + 'px'
    this.minimapButton.hidden = !this.minimapShown
    if (!this.minimapShown) this.endMapInspection()
    this.minimapCanvas.style.width = w + 'px'
    this.minimapCanvas.style.height = size + 'px'
    // the prompts stack upward from the view's last row, their right edge on its (styles.css .actionbar.contextual);
    // under a panel they stand at its foot instead (placeBar)
    this.barCorner = { left: at.left, top: at.top, width: at.width, height: at.height }
    this.barAt = ''
    this.placeBar(this.barUnder)
    // the menu buttons stand in both bottom corners of the same rows, the right stack on the view's own right edge under the
    // sidebar's column rather than the free part's (viewBounds); the stack starts above them (renderMenus)
    this.menubar.style.left = at.left + 'px'
    this.menubar.style.width = this.viewBounds.width + 'px'
    this.menubar.style.top = at.top + at.height + 'px'
    this.menubar.style.transform = 'translateY(-100%)'
    this.menuKey = ''
    this.spellbar.classList.toggle('beside', this.touchBeside)
    if (touchLayout) {
      const css = this.touchbar.style
      css.setProperty('--mobile-left', touchLayout.left + 'px')
      css.setProperty('--mobile-right', (host.width - touchLayout.right) + 'px')
      css.setProperty('--mobile-bottom', (host.height - touchLayout.bottom) + 'px')
      css.setProperty('--mobile-interact-bottom', touchLayout.interactBottom + 'px')
      css.setProperty('--mobile-row-height', touchLayout.rowHeight + 'px')
      css.setProperty('--mobile-dpad', touchLayout.dpadWidth + 'px')
      css.setProperty('--mobile-separator', (touchLayout.commandLeft - touchLayout.left - touchLayout.dpadWidth) + 'px')
      css.setProperty('--mobile-commands', (touchLayout.right - touchLayout.commandLeft) + 'px')
      css.setProperty('--mobile-gap', MOBILE_GAP + 'px')
      this.touchbar.classList.toggle('landscape', !touchLayout.portrait)
    }
    if (mobile) {
      this.spellbar.style.left = mobile.spellLeft + 'px'
      this.spellbar.style.width = mobile.spellWidth + 'px'
      this.spellbar.style.top = mobile.spellTop + 'px'
      this.logPlace = null
    } else {
      this.spellbar.style.left = ''
      const barPad = Number.parseFloat(getComputedStyle(this.touchbar).paddingBottom) || 0
      const foot = (this.touchbar.hidden ? bottom - SPELL_FOOT_GAP : this.touchBeside ? bottom - Math.max(SPELL_FOOT_GAP, barPad) : bottom - this.touchbar.offsetHeight) - SPELL_SLOT
      this.spellbar.style.top = foot + 'px'
      this.spellbar.style.width = (this.touchBeside ? sidePx.left : across) + 'px'
      this.logPlace = this.spellRow ? { cellsFoot: msgPx.top + msgPx.height, logFoot: foot - SPELL_LOG_GAP, row: host.grid.ch } : null
    }
    this.placeLog()
    this.spellKey = null
    // the action panel stands in the strip along the top between the stats pane and the minimap (grid/panel.ts), each a
    // cell's gutter away; the minimap's left edge is where it hangs from the column's right edge, not the column's own
    const minimapLeft = this.sidebar.hidden || w === 0 ? null : sidePx.left + mapOffset
    if (mobile || hidden.actionPanel || host.phone) {
      this.panelBox = mobile?.actionPanel?.box ?? { left: 0, top: 0, width: 0, height: 0 }
    } else {
      const start = hidden.desktopMenu ? Math.max(at.left, host.insets.left + TOUCH_BUTTON_H + 8) : at.left
      const span = { ...this.freePx, left: start, width: Math.max(0, at.left + at.width - start) }
      this.panelBox = panelSpan(span, statsRight, cells.stackedDesktop ? null : statsLeft ?? minimapLeft, host.grid.cw, PANEL_CELL)
    }
    // the status strip runs leftward from the minimap's left edge, a cell's gutter away: squares STATUS_BADGE_ROWS tall,
    // as many across as fit between the stats pane and the map, another row down past that; with no room for one there,
    // they run leftward under the map from its right edge instead, a cell's gutter down, as many across as the map is wide
    this.statusPx = host.grid.ch * STATUS_BADGE_ROWS
    // upright, the stats pane stands left of the map, in the band (gameSplit): the badges go under the map, at the head of
    // the monster list's column
    const stripLeft = statsRight === null ? this.freePx.left : statsRight + host.grid.cw
    const besideCols = minimapLeft === null || portrait ? 0 : Math.floor((minimapLeft - host.grid.cw - stripLeft) / this.statusPx)
    if (mobile) this.statusAt = null
    else if (!this.minimapShown) this.statusAt = portrait || this.sidebar.hidden || !sidePx.width ? null : { right: sidePx.left + sidePx.width, top: sidePx.top + host.grid.ch, below: host.grid.ch }
    else if (portrait) this.statusAt = this.sidebar.hidden || !sidePx.width ? null : { right: across, top: host.px(cells.band).top + size + host.grid.ch, below: host.grid.ch }
    else if (minimapLeft === null) this.statusAt = null
    else if (besideCols >= 1) this.statusAt = { right: minimapLeft - host.grid.cw, top: Math.max(sidePx.top, at.top), below: 0 }
    else this.statusAt = { right: minimapLeft + w, top: sidePx.top + size + host.grid.ch, below: host.grid.ch }
    const underW = portrait || !this.minimapShown ? sidePx.width : w
    this.statusCols = !this.statusAt ? 1 : this.statusAt.below ? Math.max(1, Math.floor(underW / this.statusPx)) : besideCols
    this.statusKey = ''
    // left aligned in the strip, where action_panel.js stands it in the dungeon's top-left corner; it shrinks to what it
    // draws, so placement follows the panel itself.
    this.actionPanel.style.left = this.panelBox.left + 'px'
    this.actionPanel.style.top = this.panelBox.top + 'px'
    this.panelKey = ''
    this.lastPlayerRev = -1
    this.statsKeys = []
    this.lastMsgKey = ''
    this.snapDue = true
  }

  private placeFullscreen(statsRows: number) {
    const { fullscreenButton: button, host, cells, freePx } = this
    if (!button || !host || !cells || !freePx || this.mobile) return
    const portrait = isPortrait(host.grid)
    // In portrait the character sheet overlays the canvas. Its height follows the rendered rows.
    const top = portrait && !this.stats.hidden
      ? Math.max(freePx.top, host.px(cells.stats).top + statsRows * this.statsRowPx)
      : freePx.top
    const right = portrait
      ? this.sidebar.hidden ? 0 : host.width - host.px(cells.sidebar).left
      : host.width - freePx.left - freePx.width
    button.style.setProperty('--fullscreen-view-top', top + 'px')
    button.style.setProperty('--fullscreen-view-right', right + 'px')
  }

  status(text: string) {
    this.statusEl.textContent = text
    this.statusEl.style.display = ''
    // restart the animation
    this.statusEl.style.animation = 'none'
    void this.statusEl.offsetHeight
    this.statusEl.style.animation = ''
    clearTimeout(this.statusTimer)
    this.statusTimer = window.setTimeout(() => (this.statusEl.style.display = 'none'), 3000)
  }

  /** Stop the timers still pending, so nothing of a screen that is gone fires into the next. */
  destroy() {
    this.closeLayoutEditor()
    window.removeEventListener('blur', this.endMapInspection)
    this.endMapInspection()
    this.minimap.destroy()
    clearTimeout(this.statusTimer)
    clearTimeout(this.panelTooltipTimer)
    this.cancelMonsterHover()
  }

  /** Read back through the log in the pane's own rows: the Info layer's stick, a spectator's d-pad. */
  scrollLog(delta: number) {
    this.logOffset = Math.max(0, this.logOffset - delta * 3)
    this.lastMsgKey = ''
  }

  /**
   * `hints` false hides the corner prompts on both devices (the Hints setting
   * is off). The game supplies the pad's adaptive/contextual selection
   * through `padLabels`, and `holding` names the tap-or-hold button it is
   * holding down, with how far towards the hold the press has come. `menus`
   * stands the pad's menu buttons along the view's last row (renderMenus).
   */
  update(state: GameState, scene: Scene, ctx: Context, padKind: PadKind, gd: Gamedata | null, spectating: boolean, device: InputDevice, hints = true, padLabels?: BindingLabel[], holding?: HoldProgress | null, menus = false, panel = false, touch: TouchLabel[] | null = null, touchMode = ctx.mode) {
    // a new frame: the panes are measured again when first asked (`paneRect`)
    this.paneRects.clear()
    this.rootAt = null
    if (!this.cells) return
    const drawn = this.panelKey + this.statusKey + this.portraitPx + this.minimapSize.w
    if (state.rev.player !== this.lastPlayerRev) {
      this.lastPlayerRev = state.rev.player
      this.renderStats(state)
    }
    this.renderPortrait(scene, state, gd)
    this.renderActionPanel(state, gd, spectating)
    this.renderMonsters(scene, state, gd, !spectating && !panel && (ctx.mode === 'command' || ctx.mode === 'targeting'))
    this.renderMinimap(scene, state)
    this.renderStatuses(scene, state, gd)
    // only the player's pane can be dismissed, so that is part of the key
    // a line crawl reads there is typed in the log itself (bindings.ts typedInLog)
    const typed = !spectating && typedInLog(state.textInput) ? state.textInput!.text : undefined
    const msgKey = state.rev.messages + ':' + this.logOffset + (state.messages.more ? ':' + spectating : '') + (typed === undefined ? '' : ':' + typed)
    if (msgKey !== this.lastMsgKey) {
      this.lastMsgKey = msgKey
      this.renderMessages(state, spectating, typed)
    }
    this.renderMenus(ctx, padKind, menus && device === 'pad' && !spectating)
    // what takes a finger differs from what takes a mouse (styles.css .hud.touch)
    this.root.classList.toggle('touch', device === 'touch')
    // a panel of ours (`panel`, overlays.ts padPrompts) is up over the play view's own mode
    const under = panel || POPUP_MODES.has(ctx.mode)
    if (under) this.dismissStatusTooltip()
    this.renderBar(ctx, padKind, spectating, device, hints, padLabels, under)
    this.placeBar(under)
    const split = !panel && (touchMode === 'command' || touchMode === 'targeting' || touchMode === 'levelmap') ? touchMode : null
    this.renderTouchBar(touch, gd, split)
    this.showHold(holding)
    if (this.snapDue || drawn !== this.panelKey + this.statusKey + this.portraitPx + this.minimapSize.w) {
      this.snapDue = false
      for (const c of [this.panelCanvas, this.portraitCanvas, this.minimapButton, this.statusCanvas]) snapToPixels(c)
    }
  }

  /**
   * The held button's prompt fills its hold ring and warms the hold's
   * label as the press lengthens (styles.css `.chip.holding`), in place of a
   * strip of its own. Progress rides a custom property on the chip, so no
   * frame of the hold rebuilds the corner.
   */
  private showHold(holding?: HoldProgress | null) {
    if (!holding && !this.holdShown) return
    this.holdShown = !!holding
    for (const [button, chip] of this.barChips) {
      const on = !!holding && button === holding.button
      chip.classList.toggle('holding', on)
      if (on) chip.style.setProperty('--hold', String(Math.min(1, Math.max(0, holding.fraction))))
      else chip.style.removeProperty('--hold')
    }
  }

  // ------------------------------------------------------------- stats pane

  /**
   * The WebTiles stats pane as rows on the sidebar's cells (grid/stats.ts):
   * the same lines, captions, order and colours as `update_stats_pane` in
   * player.js, the bars painted as cells, the rc's colours from the
   * `options` message. A new `player` message rebuilds the rows; the bar
   * memory carries the previous values for the change segments.
   */
  private renderStats(state: GameState) {
    if (!this.cells) return
    const mobile = this.mobile
    const corner = !mobile && !!this.host && isPortrait(this.host.grid)
    const width = Math.max(0, mobile?.statsCols ?? this.cells.stats.w - (this.cells.stackedDesktop ? 2 : 0))
    const { rows, prev } = statsRows(state.player, state.options, this.bars, width, this.portraitCols, corner, !!mobile)
    this.bars = prev
    // the canvas keeps its drawing across the move; the rows beside it left its cells blank. Only the rows that read
    // differently are painted again: a turn changes a line or two, and a pane rebuilt whole is the page laid out again
    const keys = rows.map((r) => JSON.stringify(r))
    const lines = this.stats.children
    if (lines[0] !== this.portraitCanvas || lines.length !== keys.length + 1 || this.statsKeys.length !== keys.length) {
      replace(this.stats, this.portraitCanvas, ...rows.map((r) => paintRow(r)))
    } else {
      for (let i = 0; i < keys.length; i++) if (keys[i] !== this.statsKeys[i]) lines[i + 1].replaceWith(paintRow(rows[i]))
    }
    if (this.statusTooltipAnchor && !this.stats.contains(this.statusTooltipAnchor)) this.dismissStatusTooltip()
    this.statsKeys = keys
    this.placeFullscreen(rows.length)
    // Status lights can wrap beyond the character pane's reserved rows.
    // Keep the 2.5D list and badges below its actual text as conditions change.
    const host = this.host
    if (!mobile && host && !this.stats.hidden && !this.sidebar.hidden && !this.cells.stackedDesktop && (corner || this.cells.sidebar.y > this.cells.stats.y)) {
      const sidebar = host.px(this.cells.sidebar)
      const stats = host.px(this.cells.stats)
      const top = Math.max(sidebar.top, stats.top + rows.length * this.statsRowPx + host.grid.ch)
      this.sidebar.style.top = top + 'px'
      this.sidebar.style.height = Math.max(0, sidebar.height - (top - sidebar.top)) + 'px'
      if (this.statusAt) {
        const statusTop = top + (this.statusAt.below ? this.minimapSize.h + host.grid.ch : 0)
        if (this.statusAt.top !== statusTop) this.statusAt = { ...this.statusAt, top: statusTop }
      }
    }
  }

  private showStatusTooltip(anchor: HTMLElement, desc: string) {
    const tip = this.statusTooltip
    this.statusTooltipAnchor = anchor
    tip.innerHTML = formattedStringToHtml(desc)
    tip.hidden = false
    const { left, top, bottom } = anchor.getBoundingClientRect()
    const { width, height } = tip.getBoundingClientRect()
    const margin = 8
    const maxTop = window.innerHeight - height - margin
    tip.style.left = Math.max(margin, Math.min(left, window.innerWidth - width - margin)) + 'px'
    tip.style.top = Math.max(margin, bottom <= maxTop ? bottom : Math.min(top - height, maxTop)) + 'px'
  }

  dismissStatusTooltip(): boolean {
    if (!this.statusTooltipAnchor) return false
    this.statusTooltipAnchor = null
    this.statusTooltip.hidden = true
    return true
  }

  /**
   * The player's cell as cell_renderer.js `render_cell` draws it in the 2D
   * view (dungeon_renderer.js) and monster_list.js draws a monster's: the
   * terrain, the doll's parts (`draw_dolls`), then the status badges over
   * it in `draw_foreground`'s order; in glyph mode the `@` in its colour,
   * in hybrid the glyph over the terrain. Sized to the pane's rows rather
   * than `tile_cell_pixels`, so the title and god lines sit beside it. Off
   * the level (a remote level in view) the square is empty; the pane keeps
   * its shape.
   */
  private renderPortrait(scene: Scene, state: GameState, gd: Gamedata | null) {
    if (!this.portraitPx || this.stats.hidden) return
    const o = state.options
    const mode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
    // the square draws the player's cell and what stands on it, and a build hands on the very objects it did not touch:
    // those, not the scene's revision, which moves with every monster's step
    const cell = scene.playerOnLevel ? scene.cells.get(cellKey(scene.player.x, scene.player.y)) : undefined
    const here = cell ? scene.billboards.filter((b) => b.x === scene.player.x && b.y === scene.player.y) : []
    const filterScaling = this.host?.phone === true || o.tile_filter_scaling === true
    const pre = [cell, ...here, scene.playerOnLevel, scene.player.x, scene.player.y, mode, o.glyph_mode_font, filterScaling, gd?.version, this.portraitPx]
    if (!changed(this.portraitPre, pre)) return
    this.portraitPre = pre
    const px = this.portraitPx
    this.portrait.setOptions({ cellSize: px, mode, filterScaling, glyphFont: rcFont(o.glyph_mode_font) })
    if (gd) this.portrait.setTiles(gd)
    this.portrait.setScene(scene)
    this.portrait.clear(true)
    if (scene.playerOnLevel) this.portrait.renderCell(scene.player.x, scene.player.y, 0, 0, px)
  }

  /**
   * The status strip beside the minimap: the badges on the player's own
   * billboard (scene-webtiles `statusIcons`, the same ones the portrait
   * paints over the doll), each blown up to a square of its own on one
   * canvas, in rows leftward from the map's left edge, or under the map
   * when the stats pane leaves no room beside it. Left out:
   * the damage bar, which the stats pane's HP bar already says, and the
   * "something under here" marks, which are about the square, not the
   * player. Glyph mode paints no badges anywhere, so none here. The strip
   * carries the status lights' descriptions as its tooltip.
   */
  private renderStatuses(scene: Scene, state: GameState, gd: Gamedata | null) {
    if (!this.statusPx) return
    const at = this.statusAt
    // every message bumps `rev.any` and every rebuild the scene's revision: nothing below can differ without one
    const pre = [scene.revision, state.rev.any, gd, this.statusPx, this.statusCols, at]
    if (!changed(this.statusPre, pre)) return
    this.statusPre = pre
    const me = scene.playerOnLevel ? scene.billboards.find((b) => b.kind === 'player' && b.x === scene.player.x && b.y === scene.player.y) : undefined
    const badges = (me?.statusIcons || []).filter((i) => !i.at && !i.square && !i.full)
    const o = state.options
    const glyphs = o.tile_display_mode === 'glyphs'
    const tip = state.player.status
      .filter((s) => s.light)
      .map((s) => s.desc || s.text || s.light)
      .join('\n')
    const key = JSON.stringify([badges.map((b) => b.tile), glyphs, o.tile_filter_scaling, gd?.version, this.statusPx, this.statusCols, at, tip])
    if (key === this.statusKey) return
    this.statusKey = key
    const shown = badges.length > 0 && !glyphs && !!gd && !!at
    this.statuses.hidden = !shown
    this.monsters.style.marginTop = ''
    if (!shown || !at) return
    this.statuses.title = tip
    const px = this.statusPx
    const cols = Math.min(this.statusCols, badges.length)
    const rows = Math.ceil(badges.length / cols)
    const width = cols * px
    const height = rows * px
    this.statuses.style.left = at.right - width + 'px'
    this.statuses.style.top = at.top + 'px'
    // under the map, the monster list starts under the badges
    if (at.below && !this.cells?.stackedDesktop) this.monsters.style.marginTop = height + 2 * at.below + 'px'
    const dpr = window.devicePixelRatio || 1
    this.statusR2d.resize(width, height, dpr)
    this.statusCanvas.style.width = width + 'px'
    this.statusCanvas.style.height = height + 'px'
    this.statusR2d.setOptions({ filterScaling: o.tile_filter_scaling === true })
    this.statusR2d.setTiles(gd!)
    this.statusR2d.clear(true)
    // a tenth of the square clear on each side, so neighbours never touch
    const pad = Math.round(px * 0.1)
    // the first badge is the one against the map; the next stands left of it, as WebTiles shifts its row leftward
    badges.forEach((b, i) => this.statusR2d.drawTileFit(b.tile, (cols - 1 - (i % cols)) * px, Math.floor(i / cols) * px, px, pad))
  }

  /**
   * The consumables action panel, as action_panel.js draws it: one canvas
   * with every inventory item with `action_panel_order >= 0` in that order
   * (without the X and game-menu buttons WebTiles puts first) as its tile (or glyph
   * under `action_panel_glyphs`) with its quantity, a mesh over useless
   * items, a cursor over the hovered one and an ellipsis when it overflows.
   * `action_panel_scale`, `action_panel_orientation`, `action_panel_show`,
   * `action_panel_disabled` and `action_panel_font_*` come from the rc.
   * A left click uses the item, a right click describes it, exactly as the
   * official client sends them. Polished Crawl adds the inventory letter in the
   * corner so the same slot is reachable from the palette.
   *
   * It stands in the strip between the stats pane and the minimap
   * (grid/panel.ts) rather than over the view's top-left corner, which the
   * stats pane holds. A run that does not fit the strip wraps onto another
   * line (WebTiles has the whole dungeon width for one line; the strip is
   * narrower, and a stocked character carries more than fits across it),
   * PANEL_MAX_LINES of them at most, and what still does not fit is behind
   * the ellipsis exactly as the official client leaves it.
   */
  private renderActionPanel(state: GameState, gd: Gamedata | null, spectating: boolean) {
    const o = state.options
    const minimized = o.action_panel_show === false
    const pre = [state.rev.any, gd, this.panelBox, this.panelSelected, spectating, minimized]
    if (!changed(this.panelPre, pre)) return
    this.panelPre = pre
    const count = this.panelButtonCount(state)
    const items = this.panelItems
    const mobilePanel = this.mobile?.actionPanel
    // Touch gameplay keeps the two menu buttons available even before inventory arrives.
    const inited = !!mobilePanel || Object.keys(state.player.inv).length > 0
    // game.js hides the panel while the level map is up.
    const mapView = state.uiState === UiState.VIEW_MAP
    const disabled = o.action_panel_disabled === true || spectating || !inited || this.panelBox.width <= 0 || mapView
    const scale = mobilePanel ? mobilePanel.cell / PANEL_CELL : panelScale(o.action_panel_scale)
    const horizontal = o.action_panel_orientation !== 'vertical'
    const glyphs = o.action_panel_glyphs === true
    const fontFamily = rcFont(o.action_panel_font_family)
    const fontSize = typeof o.action_panel_font_size === 'number' && o.action_panel_font_size > 0 ? o.action_panel_font_size : 16
    const box = this.panelBox
    const key = JSON.stringify([disabled, minimized, scale, horizontal, glyphs, fontFamily, fontSize, o.glyph_mode_font, o.tile_filter_scaling, this.panelSelected, gd?.version, box.width, box.height, items.map((i) => [i.slot, i.name, i.quantity, i.tile, i.useless])])
    if (key === this.panelKey) return
    this.panelKey = key
    this.actionPanel.classList.toggle('hidden', disabled)
    this.actionPanel.classList.toggle('minimized', minimized && !disabled)
    this.actionPanel.classList.toggle('vertical', !horizontal)
    if (disabled) return
    if (minimized) {
      // action_panel.js hide_panel: only the placeholder button that brings it back
      this.panelCanvas.style.display = 'none'
      if (!this.actionPanel.querySelector('.placeholder')) {
        this.actionPanel.append(h('button', { class: 'placeholder', title: 'Show the action panel', onclick: () => this.hooks.onPanelShow() }, '+'))
      }
      return
    }
    this.actionPanel.querySelector('.placeholder')?.remove()
    this.panelCanvas.style.display = ''
    const cell = Math.max(1, Math.round(PANEL_CELL * scale))
    // the panel keeps to the strip (action_panel.js: available_length is the dungeon's), wrapping onto another line rather
    // than dropping everything past the first
    const grid = panelGrid(count, cell, box, horizontal)
    this.panelCells = grid
    this.panelCell = cell
    this.panelHorizontal = horizontal
    const width = grid.cols * cell
    const height = grid.rows * cell
    const dpr = window.devicePixelRatio || 1
    this.panelR2d.resize(width, height, dpr)
    this.panelCanvas.style.width = width + 'px'
    this.panelCanvas.style.height = height + 'px'
    this.panelR2d.setOptions({ cellSize: cell, filterScaling: o.tile_filter_scaling === true, glyphFont: rcFont(o.glyph_mode_font) })
    if (gd) this.panelR2d.setTiles(gd)
    this.panelR2d.clear(true)
    if (!gd) return
    const ctx = this.panelCanvas.getContext('2d')!
    const at = (i: number) => panelCellAt(i, grid, cell, horizontal)
    const drawNamed = (layer: 'gui' | 'icons' | 'main', name: string, i: number) => {
      const id = (layer === 'gui' ? gd.gui : layer === 'icons' ? gd.icons : gd.main).id(name)
      if (id === undefined) return
      const rect = gd.tile(id, layer)
      const img = rect && gd.atlas(rect.atlas)
      if (!rect || !img) return
      const p = at(i)
      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = o.tile_filter_scaling === true
      ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, rect.h, p.x + rect.ox * scale, p.y + rect.oy * scale, rect.w * scale, rect.h * scale)
      ctx.restore()
    }
    const cursorOn = (i: number) => {
      if (this.panelSelected === i) drawNamed('icons', 'CURSOR3', i)
    }
    // action_panel.js: the X that folds the panel away, then the game menu, before the first item
    if (grid.shown > 0) {
      drawNamed('gui', 'PROMPT_NO', 0)
      cursorOn(0)
    }
    if (grid.shown > 1) {
      drawNamed('gui', 'CMD_GAME_MENU', 1)
      cursorOn(1)
    }
    items.slice(0, grid.shown - NUM_RESERVED_BUTTONS).forEach((item, idx) => {
      const i = idx + NUM_RESERVED_BUTTONS
      const p = at(i)
      if (glyphs) {
        // action_panel.js draw_action: the item's glyph in its colour instead of the tile
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.font = `${Math.floor(cell * 0.8)}px ${rcFont(o.glyph_mode_font)}`
        ctx.fillStyle = TERM16[(item.col ?? 7) & 15]
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(typeof item.g === 'string' ? item.g : '?', p.x + cell / 2, p.y + cell / 2)
        ctx.restore()
      } else if (item.tile !== undefined) {
        // tileweb.cc `_send_item` sends `tile` as plain ids in the main texture (the known base item under the
        // item's own tile), which action_panel.js draw_action wraps in an array and draws against `main`; a
        // `{ t, tex }` layer keeps its own texture, as the map's tiles do
        for (const t of Array.isArray(item.tile) ? item.tile : [item.tile]) {
          const rect = typeof t === 'number' ? gd.tile(t, 'main') : gd.tile(t.t, String(t.tex))
          const img = rect && gd.atlas(rect.atlas)
          if (!rect || !img) continue
          let hh = rect.h
          const ymax = typeof t === 'number' ? undefined : t.ymax
          if (ymax !== undefined && ymax < rect.oy + rect.h) hh = Math.max(0, ymax - rect.oy)
          if (hh <= 0) continue
          ctx.save()
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.imageSmoothingEnabled = o.tile_filter_scaling === true
          ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, hh, p.x + rect.ox * scale, p.y + rect.oy * scale, rect.w * scale, hh * scale)
          ctx.restore()
        }
      }
      // cell_renderer.js draw_quantity: white with a black shadow, top-left
      const qtyField = typeof item.qty_field === 'string' ? item.qty_field : 'quantity'
      const qty = item[qtyField]
      if (typeof qty === 'number' || (typeof qty === 'string' && qty)) {
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = 'white'
        ctx.font = `${textWeight()} ${fontSize * scale}px ${fontFamily}`
        ctx.shadowColor = 'black'
        ctx.shadowBlur = 2
        ctx.shadowOffsetX = 1
        ctx.shadowOffsetY = 1
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(String(typeof qty === 'number' ? Math.max(0, Math.min(999, qty)) : qty), p.x + 2, p.y + 2)
        ctx.restore()
      }
      cursorOn(i)
      if (item.useless) drawNamed('icons', 'OOR_MESH', i)
      // Polished Crawl: the inventory letter, bottom-right, so the palette and the panel name the same slot
      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = `${textWeight()} ${Math.max(8, Math.round(9 * scale))}px ${fontFamily}`
      ctx.shadowColor = 'black'
      ctx.shadowBlur = 2
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(item.letter, p.x + cell - 2, p.y + cell - 1)
      ctx.restore()
    })
    if (grid.overflow) {
      // action_panel.js: an ellipsis icon at the far end when items are cut off — here the far end of the last line
      const id = gd.icons.id('ELLIPSIS')
      const rect = id !== undefined ? gd.tile(id, 'icons') : undefined
      const img = rect && gd.atlas(rect.atlas)
      if (rect && img) {
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, rect.h, width - rect.w * scale, height - rect.h * scale, rect.w * scale, rect.h * scale)
        ctx.restore()
      }
    }
  }

  /**
   * action_panel.js handle_mouse: hover tracks the cell under the pointer
   * (the cursor icon follows, a tooltip names the cell after half a second),
   * a left click uses the item, a right click describes. The two reserved
   * buttons take their own clicks: the X folds the panel away (right click:
   * the settings), the second opens the game menu.
   */
  private attachPanelPointer() {
    const c = this.panelCanvas
    // the cell the pointer is over, on the grid the last draw laid out (grid/panel.ts): a wrapped panel has lines, so
    // both axes count
    const cellAt = (ev: MouseEvent): number => {
      const rect = c.getBoundingClientRect()
      return panelCellIndex(ev.clientX - rect.left, ev.clientY - rect.top, this.panelCells, this.panelCell, this.panelHorizontal)
    }
    const hideTip = () => {
      clearTimeout(this.panelTooltipTimer)
      this.panelTooltip.style.display = 'none'
    }
    c.addEventListener('mousemove', (ev) => {
      const i = cellAt(ev)
      if (i !== this.panelSelected) {
        this.panelSelected = i
        this.panelKey = ''
        this.hooks.onPanelHover?.()
        hideTip()
        if (i >= 0) {
          const html = this.panelTip(i)
          if (html) this.panelTooltipTimer = window.setTimeout(() => this.showTooltip(html, ev.pageX + 10, ev.pageY + 10), 500)
        }
      }
    })
    c.addEventListener('mouseleave', () => {
      if (this.panelSelected < 0) return
      this.panelSelected = -1
      this.panelKey = ''
      hideTip()
      this.hooks.onPanelHover?.()
    })
    c.addEventListener('contextmenu', (ev) => ev.preventDefault())
    c.addEventListener('mousedown', (ev) => {
      const i = cellAt(ev)
      hideTip()
      if (i < 0) return
      if (ev.button === 0) {
        // the X folds the panel away even in targeting mode, as action_panel.js has it; the rest wait for command mode,
        // which the app's own hooks check
        if (i === 0) this.hooks.onPanelHide()
        else if (i === 1) this.hooks.onGameMenu()
        else {
          const item = this.panelItems[i - NUM_RESERVED_BUTTONS]
          if (item) this.hooks.onPanelItem(item.slot, false)
        }
      } else if (ev.button === 2) {
        if (i === 0) this.hooks.onPanelSettings()
        else if (i >= NUM_RESERVED_BUTTONS) {
          const item = this.panelItems[i - NUM_RESERVED_BUTTONS]
          if (item) this.hooks.onPanelItem(item.slot, true)
        }
      }
    })
  }

  /**
   * action_panel.js show_tooltip: the buttons say what their clicks do, an
   * item gives its letter and name and then its own two clicks (the server
   * names the left one in `action_verb`).
   */
  private panelTip(i: number): string {
    if (i === 0) return 'Left click: minimize<br>Right click: open settings'
    if (i === 1) return 'Left click: show main menu'
    const item = this.panelItems[i - NUM_RESERVED_BUTTONS]
    if (!item) return ''
    const verb = typeof item.action_verb === 'string' ? item.action_verb.toLowerCase() : ''
    return (
      escapeHtml(item.letter + ' - ' + (item.name || '')) +
      (verb ? '<br>Left click: ' + escapeHtml(verb) : '') +
      '<br>Right click: describe'
    )
  }

  /** mouse_control.js show_tooltip: a small box near the pointer. */
  showTooltip(html: string, x: number, y: number) {
    if (!html) return
    this.panelTooltip.innerHTML = html
    this.panelTooltip.style.left = x + 'px'
    this.panelTooltip.style.top = y + 'px'
    this.panelTooltip.style.display = ''
  }

  hideTooltip() {
    this.panelTooltip.style.display = 'none'
  }

  private showMonsterHover(ev: PointerEvent) {
    const element = ev.target
    if (ev.pointerType === 'touch' || ev.buttons || !(element instanceof HTMLElement)) return
    const row = element.closest<HTMLElement>('.group')
    const first = row && this.monsterTargets.get(row)
    if (!row || !first) return
    const hoverInRow = this.monsterHover && row.contains(this.monsterHover.anchor) ? this.monsterHover : null
    // Keep the selected monster while crossing the gap. Entering a row
    // through its padding selects the same monster as its name does.
    const anchor = element !== row && this.monsterTargets.has(element) ? element : hoverInRow?.anchor ?? row
    const target = this.monsterTargets.get(anchor) ?? first
    if (hoverInRow && sameMonster(hoverInRow.target, target)) {
      hoverInRow.anchor = anchor
      hoverInRow.x = ev.clientX
      hoverInRow.y = ev.clientY
      this.placeMonsterTooltip(ev.clientX, ev.clientY)
      return
    }
    this.cancelMonsterHover()
    const hover = this.monsterHover = { anchor, target, x: ev.clientX, y: ev.clientY }
    this.monsterTooltip.setAttribute('data-loading', '')
    const { x, y, ref } = target
    const monster = ref as Monster
    const show = (description: string) => {
      const current = this.monsterHover
      if (!current || (!description && current !== hover)) return
      if (!current.anchor.isConnected || !sameMonster(target, this.monsterTargets.get(current.anchor))) return
      if (!description) {
        this.cancelMonsterHover()
        return
      }
      this.monsterTooltip.removeAttribute('data-loading')
      this.monsterTooltip.innerHTML = formattedStringToHtml(description)
      this.monsterTooltip.hidden = false
      this.placeMonsterTooltip(current.x, current.y)
    }
    const active = () => this.monsterHover === hover && this.monsterTooltip.hasAttribute('data-loading')
    if (!this.hooks.onPreviewMonster(x, y, monster, { active, show })) {
      this.cancelMonsterHover()
      return
    }
    if (active()) {
      this.monsterTooltip.textContent = 'Loading description…'
      this.monsterTooltip.hidden = false
      this.placeMonsterTooltip(hover.x, hover.y)
    }
  }

  private placeMonsterTooltip(x: number, y: number) {
    const tip = this.monsterTooltip
    const { width, height } = tip.getBoundingClientRect()
    const margin = 8, offset = 14
    const right = window.innerWidth - width - margin
    const bottom = window.innerHeight - height - margin
    tip.style.left = Math.max(margin, x + offset <= right ? x + offset : x - width - offset) + 'px'
    tip.style.top = Math.max(margin, Math.min(y + offset, bottom)) + 'px'
  }

  cancelMonsterHover() {
    if (!this.monsterHover) return
    this.monsterHover = null
    this.monsterTooltip.hidden = true
    this.monsterTooltip.removeAttribute('data-loading')
  }

  cancelPendingMonsterHover() {
    if (this.monsterTooltip.hasAttribute('data-loading')) this.cancelMonsterHover()
  }

  dismissMonsterTooltip(): boolean {
    if (this.monsterTooltip.hidden) return false
    this.cancelMonsterHover()
    return true
  }

  /**
   * The WebTiles monster list, as monster_list.js `update` draws it: the
   * visible monsters sorted and grouped (`monsterGroups`), at most five rows,
   * the "something invisible" description first when the server sent one,
   * each row a strip of up to six sprites drawn with the cell renderer (so
   * every badge the map cell carries is on the thumbnail too), the glyph-mode
   * health box, then the name (or "3 jackals") in its attitude and threat
   * colours; an ellipsis on the last row when rows were cut.
   */
  private renderMonsters(scene: Scene, state: GameState, gd: Gamedata | null, canInspect: boolean) {
    if (this.monsters.hidden) return
    if (!canInspect) this.cancelMonsterHover()
    const compact = this.mobile?.phonePortrait ?? false
    const pre = [scene.revision, state.rev.any, gd, canInspect, compact]
    if (!changed(this.monstersPre, pre)) return
    this.monstersPre = pre
    const groups = monsterGroups(scene)
    const invis = state.map.invisibleMonsterDesc
    const o = state.options
    const mode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
    const px = typeof o.tile_cell_pixels === 'number' && o.tile_cell_pixels > 0 ? o.tile_cell_pixels : MONSTER_LIST_CELL
    const vs = typeof o.tile_viewport_scale === 'number' && o.tile_viewport_scale > 0 ? o.tile_viewport_scale : 100
    const w = Math.max(16, Math.min(compact ? PHONE_MONSTER_CELL : 64, Math.round((px * vs) / 100)))
    const key = JSON.stringify([
      invis,
      canInspect,
      mode,
      w,
      window.devicePixelRatio,
      o.glyph_mode_font,
      o.tile_filter_scaling,
      gd?.version,
      state.rev.map,
      groups.map((g) => g.map((m) => [m.x, m.y, (m.ref as Monster).id, m.name, m.damage, m.attitude, m.threat])),
    ])
    if (key === this.monstersKey) return
    this.monstersKey = key
    let rows = Math.min(groups.length, MONSTER_LIST_MAX_ROWS)
    if (invis) rows++
    let i = 0
    for (; i < rows; i++) {
      const group = invis && i > 0 ? groups[i - 1] : groups[i]
      let row = this.monsterRows[i]
      if (!row) {
        // monster_list.js: <span class='group'><canvas class='picture'><span class='health'><span class='name'>
        const canvas = h('canvas', { class: 'picture' })
        const controls = h('div', { class: 'portrait-actions', hidden: true })
        const health = h('span', { class: 'health' })
        const name = h('span', { class: 'name' })
        const node = h('div', { class: 'group' }, h('div', { class: 'monster-portraits' }, canvas, controls), health, name)
        node.addEventListener('pointerleave', () => {
          if (this.monsterHover && node.contains(this.monsterHover.anchor)) this.cancelMonsterHover()
        })
        const r2d = new Render2d({ mode: 'tiles', cellSize: w })
        r2d.mount(canvas)
        row = { node, canvas, portraitActions: controls, r2d, health, name, ellipsis: null }
        this.monsterRows.push(row)
        this.monsters.append(node)
      }
      row.name.className = 'name'
      this.monsterTargets.delete(row.node)
      this.monsterTargets.delete(row.name)
      row.health.style.display = 'none'
      if (invis && i === 0) {
        // monster_list.js: the unseen-invisible tile and the description in magenta
        this.sizeRow(row, w, 1)
        row.r2d.clear()
        if (gd) {
          row.r2d.setTiles(gd)
          const id = gd.main.id('UNSEEN_INVISIBLE')
          if (id !== undefined) row.r2d.drawTiles([id], 0, 0, w)
        }
        row.name.innerHTML = formattedStringToHtml('<magenta>' + invis + '</magenta>')
        row.name.classList.add('invisible-desc')
        row.portraitActions.hidden = true
        row.ellipsis?.remove()
        row.ellipsis = null
        continue
      }
      const shown = Math.min(group.length, MONSTER_LIST_MAX_SPRITES)
      this.sizeRow(row, w, shown)
      row.r2d.setOptions({ cellSize: w, mode, filterScaling: o.tile_filter_scaling === true, glyphFont: rcFont(o.glyph_mode_font) })
      if (gd) row.r2d.setTiles(gd)
      row.r2d.setScene(scene)
      row.r2d.clear()
      row.portraitActions.hidden = !canInspect
      for (let j = 0; j < shown; j++) {
        const { x, y, ref } = group[j]
        row.r2d.renderCell(x, y, j * w, 0, w)
        if (!canInspect) continue
        const monster = ref as Monster
        let button = row.portraitActions.children[j] as HTMLButtonElement | undefined
        if (!button) {
          button = h('button', { class: 'monster-inspect', type: 'button' })
          row.portraitActions.append(button)
        }
        const label = 'Inspect ' + monster.name + (group.length > 1 ? ` (${j + 1} of ${group.length})` : '')
        button.setAttribute('aria-label', label)
        this.monsterTargets.set(button, group[j])
        button.onclick = () => {
          this.cancelMonsterHover()
          this.hooks.onInspectMonster(x, y, monster)
        }
      }
      while (row.portraitActions.children.length > shown) row.portraitActions.lastElementChild!.remove()
      const first = group[0]
      const mon = first.ref as Monster
      if (canInspect) {
        this.monsterTargets.set(row.node, first)
        this.monsterTargets.set(row.name, first)
      }
      if (group.length === 1) {
        row.name.textContent = mon.name
        if (mode === 'glyphs') {
          // monster_list.js: in glyph mode a coloured box beside the glyph shows the wounds
          row.health.className = (first.damage || 'uninjured') + ' health'
          row.health.style.width = w + 'px'
          row.health.style.height = w + 'px'
          row.health.style.display = ''
        }
      } else row.name.textContent = group.length + ' ' + (mon.plural || mon.name)
      row.name.classList.add(first.attitude || 'hostile')
      row.name.classList.add(first.threat || 'easy')
      if (i === rows - 1 && rows < groups.length + (invis ? 1 : 0)) {
        if (!row.ellipsis) {
          row.ellipsis = h('span', { class: 'ellipse' }, '...')
          row.node.append(row.ellipsis)
        }
      } else {
        row.ellipsis?.remove()
        row.ellipsis = null
      }
    }
    for (; i < this.monsterRows.length; i++) this.monsterRows[i].node.remove()
    this.monsterRows = this.monsterRows.slice(0, rows)
    const hover = this.monsterHover
    if (hover && (!hover.anchor.isConnected || !sameMonster(hover.target, this.monsterTargets.get(hover.anchor)))) this.cancelMonsterHover()
  }

  private sizeRow(row: MonsterRow, w: number, sprites: number) {
    const dpr = window.devicePixelRatio || 1
    const width = w * Math.max(1, sprites)
    if (row.canvas.width !== Math.floor(width * dpr) || row.canvas.height !== Math.floor(w * dpr)) {
      row.r2d.resize(width, w, dpr)
      row.canvas.style.width = width + 'px'
      row.canvas.style.height = w + 'px'
    }
  }

  private renderMinimap(scene: Scene, state: GameState) {
    if (!this.minimapShown) return
    const key = `${scene.revision}|${scene.player.x},${scene.player.y}|${scene.playerOnLevel}|${state.rev.player}`
    if (key === this.minimapKey) return
    this.minimapKey = key
    this.drawMinimap(scene, state)
  }

  private drawMinimap(scene: Scene, state: GameState) {
    const palette = mapPalette(state.options)
    const raster = minimapRaster(scene.bounds)
    if (this.minimapCanvas.width !== raster.w || this.minimapCanvas.height !== raster.h) {
      this.minimap.resize(raster.w, raster.h, 1)
    }
    this.minimapButton.style.setProperty('--minimap-unseen', palette[MapFeature.UNSEEN])
    palette[MapFeature.UNSEEN] = 'transparent'
    this.minimap.setOptions({ mfColours: palette, minimapColours: { player: palette[MapFeature.PLAYER] } })
    this.minimapWindow.style.borderColor = mapColour(state.options, 'window', '#558855')
    this.minimap.setScene(scene)
    this.minimap.render()
  }

  setMinimapWindow(view: { left: number; top: number; right: number; bottom: number }) {
    const a = this.minimap.cellCentre(view.left, view.top)
    const b = this.minimap.cellCentre(view.right, view.bottom)
    const scale = this.minimapSize.w / this.minimapCanvas.width
    Object.assign(this.minimapWindow.style, {
      left: Math.round(a.x * scale) + 'px', top: Math.round(a.y * scale) + 'px',
      width: Math.round((b.x - a.x) * scale) + 'px', height: Math.round((b.y - a.y) * scale) + 'px',
    })
  }

  private inspectMap(ev: PointerEvent) {
    if (ev.pointerId !== this.inspectPointer) return
    const r = this.minimapCanvas.getBoundingClientRect()
    const key = this.minimap.pick((ev.clientX - r.left) * this.minimapCanvas.width / r.width, (ev.clientY - r.top) * this.minimapCanvas.height / r.height)
    if (key !== null) this.hooks.onMinimapInspect?.(keyToXY(key))
  }

  endMapInspection = () => {
    if (this.inspectPointer === null) return
    const id = this.inspectPointer
    this.inspectPointer = null
    if (this.minimapButton.hasPointerCapture(id)) this.minimapButton.releasePointerCapture(id)
    this.hooks.onMinimapInspect?.(null)
  }

  setMinimapEnabled(enabled: boolean, rcPixels = 0) {
    this.rcMapPixels = rcPixels
    this.minimapEnabled = enabled
  }

  /**
   * The message pane as rows (grid/messages.ts): the last lines of the log
   * that fit the pane's rows, wrapped to its width, the turn and command
   * markers in front as messages.js prints them, the text cursor on the last
   * line while the game reads there, and the `--more--` row under them.
   *
   * A `--more--` changes nothing on the pane, as in WebTiles: `#more` there
   * is a bare line under the messages in the page's white, and so is the
   * more row here (styles.css `.messages`). A ring around the pane read as a
   * focused panel, the thing A would open, and a tag on the row read as a
   * control; both said the wrong thing. The more row and the action bar
   * indicate the pause; the dungeon keeps its normal brightness.
   * Nothing moves to the middle of the view, so the player's eye stays on
   * the log it was already reading.
   *
   * The way out is on the action bar (`--more--` on A, or Space), and for
   * the player a click on the pane sends space (`.dismissable`). A spectator
   * cannot dismiss it, so its pane takes no click.
   */
  private renderMessages(state: GameState, spectating: boolean, typed?: string) {
    if (!this.cells) return
    const area = this.cells.messages
    const mobile = this.mobile
    const rows = mobile ? mobile.lines - Number(state.messages.more) : area.h - 1
    const pane = paneRows(state.messages, rows, mobile?.messageCols ?? area.w, this.logOffset, typed)
    this.logOffset = pane.offset
    const lines = mobile && !mobile.portrait ? pane.lines.filter(row => row.length) : pane.lines
    replace(this.messages, ...lines.map(r => paintRow(r)), paintRow(pane.more, 'line more'))
    this.placeLog()
    this.messages.classList.toggle('attention', state.messages.more || state.messages.textCursor)
    this.messages.classList.toggle('more', state.messages.more)
    this.messages.classList.toggle('dismissable', state.messages.more && !spectating)
  }

  /** The bar's prompt chips by button, so a hold can light one without a rebuild (showHold). */
  private barChips = new Map<string, HTMLElement>()
  private menuKey = ''

  /**
   * The pad's standing menu buttons, in the view's two bottom corners: the
   * ones that open a screen rather than spend a turn. The left hand's one
   * (Select: Travel) stands in the left corner reading from its glyph, the
   * right hand's (Start: Character, the Polished Crawl menu, over Y: Gear over
   * X: Spells) hard against the right edge with its glyphs at the edge, so
   * each sits where its thumb is. Only while the play view is up and
   * the pad spoke last: in a menu or while aiming these buttons mean other
   * things, and the contextual stack (renderBar) stands on their lower row.
   */
  private renderMenus(ctx: Context, padKind: PadKind, show: boolean) {
    const labels = show && ctx.mode === 'command' ? barLabels(ctx).filter((l) => MENU_BUTTONS.includes(l.button as Button)) : []
    const key = labels.map((l) => l.button + ':' + l.label).join(',') + padKind
    if (this.menuKey === key) return
    this.menuKey = key
    this.menubar.hidden = labels.length === 0
    clear(this.menubar)
    if (labels.length) {
      const side = (buttons: readonly Button[]) => h('span', { class: 'side' }, ...buttons.map((b) => labels.find((l) => l.button === b)).filter((l) => !!l).map((l) => this.chip(l, l.button + ':' + l.label + padKind, padKind)))
      this.menubar.append(side(MENU_LEFT), side(MENU_RIGHT))
    }
    // the menu buttons stand a row off the view's foot (styles.css .menubar --rise), and the stack lifts the same, so the
    // interact prompt shares their lowest row (styles.css .actionbar.contextual --foot)
    const rows = [...this.menubar.querySelectorAll<HTMLElement>('.side:last-child .chip')]
    const pitch = rows.length >= 2 ? rows[1].offsetTop - rows[0].offsetTop : 0
    this.menubar.style.setProperty('--rise', pitch + 'px')
    this.actionbar.style.setProperty('--foot', pitch + 'px')
  }

  /**
   * Where the prompts stand: up from the free view's bottom-right corner, or
   * while a panel is up (`under`), right below the top one, their right edge
   * on its, so they read as the panel's own key help wherever it hangs
   * (styles.css .popup). The panels leave room for them above the view's
   * foot (`--bar-room`), and they never go past it. Measured every update, since a menu
   * grows and shrinks with what the server sends without the prompts
   * changing; written only when it moved.
   */
  private placeBar(under: boolean) {
    this.barUnder = under
    const corner = this.barCorner
    if (!corner) return
    let panel: DOMRect | null = null
    const stack = this.root.parentElement?.querySelector<HTMLElement>('.overlay-stack')
    const room = under && !this.actionbar.hidden ? this.actionbar.offsetHeight + BAR_GAP + 'px' : ''
    // the panels stop short of the line under them, so a tall one (any menu on a phone) keeps it off its last lines
    // (styles.css .popup --bar-room)
    if (stack && stack.style.getPropertyValue('--bar-room') !== room) stack.style.setProperty('--bar-room', room)
    if (under && !this.actionbar.hidden) {
      const shown = stack?.querySelectorAll<HTMLElement>(':scope > .popup:not(.hidden)')
      const top = shown?.[shown.length - 1]
      if (top) panel = top.getBoundingClientRect()
    }
    let at: { left: number; width: number; top: number; transform: string }
    if (panel && panel.width) {
      const host = this.root.getBoundingClientRect()
      const foot = corner.top + corner.height
      const top = Math.min(panel.bottom - host.top + BAR_GAP, foot - this.actionbar.offsetHeight)
      at = { left: panel.left - host.left, width: panel.width, top, transform: 'none' }
    } else {
      at = { left: corner.left, width: corner.width, top: corner.top + corner.height, transform: 'translateY(-100%)' }
    }
    const key = at.left + ',' + at.width + ',' + at.top + ',' + at.transform
    if (key === this.barAt) return
    this.barAt = key
    this.actionbar.classList.toggle('under', !!panel?.width)
    this.actionbar.style.left = at.left + 'px'
    this.actionbar.style.width = at.width + 'px'
    this.actionbar.style.top = at.top + 'px'
    this.actionbar.style.transform = at.transform
  }

  /**
   * The contextual prompts, stacked in the bottom-right corner of the view.
   * They show only what the situation created (bindings.ts `promptLabels`):
   * Attack with a hostile ahead, Descend on the stairs, the pile's own name
   * where one lies underfoot, a prompt's own answers; the standing bindings
   * stay on the controls sheet. The stack grows upward from the corner, a
   * list with nothing held for a button that is away, and the pad's lessons
   * (gamepad-hints.ts) stack above the contextual ones. Labels sit left of
   * their glyphs so the glyphs line up in one column at the edge. Drawn only
   * while the pad spoke last: the keyboard and the mouse get no prompts (a
   * keyboard player knows the keys; a click acts on the cell itself). A chip
   * whose label did not change keeps its node, and prompts appear in place,
   * still: Attack comes and goes with every hostile, and a slide on each
   * would keep the corner moving under the player's eye. A spectator never
   * sees any of it.
   *
   * The level map is the exception: the server prints no key help there, so
   * every button stands named, in a line of pairs along the map's foot instead.
   */
  private renderBar(ctx: Context, padKind: PadKind, spectating: boolean, device: InputDevice, hints: boolean, padLabels?: BindingLabel[], under = POPUP_MODES.has(ctx.mode)) {
    // the level map names every button it has, too many to stack: a line of pairs along its foot, each
    // pair one over the other (FOOT_PAIRS, styles.css .actionbar.contextual.foot)
    const foot = ctx.mode === 'levelmap'
    const shown = device === 'pad' && !spectating ? (padLabels ?? (hints ? promptLabels(ctx) : [])) : []
    // a list, nothing held for a button that is away: under a panel in one order whatever the panel, A last (UNDER_ORDER)
    const labels: BindingLabel[] = under ? [...shown].sort((a, b) => UNDER_ORDER.indexOf(a.button) - UNDER_ORDER.indexOf(b.button)) : shown
    // under a menu, laid out as its footer is where the footer names them (footerPlaces); the footer crawl shows is one or
    // the other of the two it sends (overlays.ts updateMore), so the one that names more of them
    const menu = under && !foot ? ctx.menu?.menu : undefined
    const footers = menu ? [menu.more, menu.alt_more].filter((t): t is string => !!t) : []
    const places = footers.map((t) => footerPlaces(t, labels)).reduce<Map<BindingLabel, FooterPlace> | null>((a, b) => (b && (!a || b.size > a.size) ? b : a), null)
    const key = device + '|' + ctx.mode + '|' + ctx.layer + '|' + labels.map((l) => l.button + ':' + l.label + '/' + (l.hold || '') + !!l.teaching + (l.fresh ? '!' : '') + (places?.get(l) ? '@' + places.get(l)!.row + '.' + places.get(l)!.col : '')).join(',') + padKind + under
    if (this.actionbar.dataset.v === key) return
    this.actionbar.dataset.v = key
    this.actionbar.hidden = labels.length === 0
    this.actionbar.classList.add('contextual')
    // under a popup the prompts stand at its foot in one line (placeBar), instead of climbing behind the panel in one
    // column (styles.css .actionbar.contextual.row)
    this.actionbar.classList.toggle('row', under)
    this.actionbar.classList.toggle('foot', foot)
    this.actionbar.classList.toggle('grid', !!places)
    this.actionbar.style.gridTemplateColumns = places ? 'repeat(' + Math.max(...[...places.values()].map((p) => p.col)) + ', auto)' : ''
    const keep = new Map(this.barChips)
    this.barChips.clear()
    clear(this.actionbar)
    const chipFor = (l: BindingLabel) => {
      const k = l.button + ':' + l.label + '/' + (l.hold || '') + !!l.teaching + !!l.fresh + padKind
      const kept = keep.get(l.button)
      const chip = kept && kept.dataset.k === k ? kept : this.chip(l, k, padKind)
      this.barChips.set(l.button, chip)
      return chip
    }
    if (foot) {
      for (const buttons of FOOT_PAIRS) {
        const pair = buttons.flatMap((b) => labels.filter((l) => l.button === b))
        if (pair.length) this.actionbar.append(h('span', { class: 'foot-pair' }, ...pair.map(chipFor)))
      }
      return
    }
    if (places) {
      // what the footer does not name stands in a line above its cells, in UNDER_ORDER
      const rest = labels.filter((l) => !places.has(l))
      const line = rest.map(chipFor)
      for (const chip of line) chip.style.gridArea = ''
      if (line.length) this.actionbar.append(h('span', { class: 'rest' }, ...line))
      for (const [l, p] of places) {
        const chip = chipFor(l)
        chip.style.gridArea = p.row + (line.length ? 1 : 0) + ' / ' + p.col
        this.actionbar.append(chip)
      }
      return
    }
    let group: HTMLElement | null = null
    let groupName = ''
    // under a panel the strip is a grid two prompts wide, filled from the corner: leftward along the last row, then the row above
    const rows = Math.ceil(labels.length / 2)
    labels.forEach((l, i) => {
      const g = buttonGroup(l.button)
      if (g !== groupName || !group) {
        groupName = g
        group = this.group(g)
        this.actionbar.append(group)
      }
      const chip = chipFor(l)
      // filled from the corner, so A, last in UNDER_ORDER, keeps it
      const at = labels.length - 1 - i
      chip.style.gridArea = under ? rows - Math.floor(at / 2) + ' / ' + ((at % 2) + 1) : ''
      group.append(chip)
    })
  }

  /** Movement uses the compass and action grid. Menus show only the actions available in that menu. */
  private renderTouchBar(labels: TouchLabel[] | null, gd: Gamedata | null, split: 'command' | 'targeting' | 'levelmap' | null = null) {
    const art = (l: TouchLabel) => '#' + (l.icon ?? '') + (l.art?.join() ?? '') + '+' + (l.glyph ?? '') + JSON.stringify(l.item ?? null) + 'x' + (l.count ?? '') + (l.keycapHtml ?? '') + (l.labelHtml ?? '') + (l.bare ? '!' : '')
    this.shortcutArt = gd
    const deck = split === 'command' && !!labels?.length
    if (this.editingLayout && !deck) this.closeLayoutEditor()
    const positions = TILE_POSITIONS[this.shortcuts.arrangement]
    const slots = this.shortcuts.slots
    const hasShortcut = (id: string) => positions.some(p => slots[p.index] === id)
    const key = labels ? [split, split && this.shortcuts.arrangement, split && slots.join(',')].join(':') + ':' + labels.map((l) => l.cell + '*' + (l.span ?? 1) + '=' + l.button + ':' + l.label + '/' + (l.hold || '') + (l.lit ? '*' : '') + (l.fresh ? '!' : '') + (l.refused ? '~' : '') + art(l)).join(',') + '@' + (window.devicePixelRatio || 1) + (gd ? '#' + gd.version : '') : ''
    if (this.touchbar.dataset.v === key) return
    this.touchbar.dataset.v = key
    this.touchbarH = null
    this.touchbar.hidden = !labels?.length
    const aimDeck = split === 'targeting' && hasShortcut('CMD_FIRE') &&
      labels?.some(l => l.cell === 'quiver' && l.action.kind === 'fire')
    this.touchbar.classList.toggle('command-deck', deck || !!aimDeck)
    this.touchbar.classList.toggle('split', !!split)
    this.touchbar.classList.toggle('context-controls', !split)
    // Keep a pressed button's node and pointer capture when its caption or placement changes.
    const previous = new Map(Array.from(this.touchbar.children, el => [(el as HTMLElement).dataset.cell, el as HTMLElement]))
    previous.delete(undefined) // The layout launcher has no gameplay cell.
    const byCell = new Map(labels?.map(l => [l.cell, l]))
    const menuArrows = !split && labels !== null && labels.some(l => l.cell in TOUCH_MENU_NAVIGATION)
    this.touchbar.classList.toggle('menu-arrows', menuArrows)
    if (menuArrows) {
      // The bottom row holds Esc, Left, Down, Right and Select. Up leaves four spaces on the row above.
      const extras = labels.filter(l => !(l.cell in TOUCH_MENU_NAVIGATION) && l.cell !== 'esc' && l.cell !== 'select')
      this.touchbar.style.setProperty('--menu-rows', String(2 + Math.ceil(Math.max(0, extras.length - 4) / 5)))
    }
    let last: HTMLElement | null = null
    const place = (covers: readonly TouchCell[], row: number, col: number, rows = 1, cols = covers.length) => {
      const cell = covers[0]
      const old = previous.get(cell)
      previous.delete(cell)
      const l = byCell.get(cell)
      let el: HTMLElement
      if (l && !l.idle && old?.dataset.b === l.button) {
        el = old
        this.fillTouchButton(el, covers, l, gd, !!split)
      } else {
        if (old) this.releaseTouchButton(old, true)
        const idle = l ?? (split ? TOUCH_ANCHORS[cell] : undefined)
        el = l && !l.idle ? this.touchButton(covers, l, gd, !!split) :
          idle ? idleTouchButton(cell, idle, gd) : h('span', { class: 'tb empty', 'data-cell': cell })
        if (old) old.replaceWith(el)
        else if (last) last.after(el)
        else this.touchbar.prepend(el)
      }
      el.style.gridArea = split ? `${row} / ${col} / span ${rows} / span ${cols}` : ''
      el.style.order = split ? '' : String(col)
      el.style.setProperty('--control-span', String(covers.length))
      el.classList.toggle('movement', !!split && col <= 3)
      el.classList.toggle('primary-slot', rows > 1)
      last = el
    }
    if (labels?.length && split) {
      const dpad: readonly (readonly TouchCell[])[] = [
        ['upLeft', 'up', 'upRight'],
        ['left', 'wait', 'right'],
        ['downLeft', 'down', 'downRight'],
      ]
      for (const [cell, button, label] of DIAGONAL_TOUCH) {
        if (byCell.has('up')) byCell.set(cell, { cell, button, label, contextual: false, action: { kind: 'keys', label, seq: [] } })
      }
      const shot = byCell.get('quiver')
      dpad.forEach((row, r) => row.forEach((cell, c) => place([cell], r + 1, c + 1)))
      if (deck || aimDeck) {
        // Keep Fire under the same finger when the server changes to aiming.
        const aiming: (TouchCell | undefined)[] = positions.map(({ index }) => {
          const id = slots[index]
          return id === 'CMD_FIRE' ? 'quiver' : id === 'escape' ? 'esc' : id === 'CMD_LOOK_AROUND' ? 'examine' : undefined
        })
        if (aimDeck) {
          for (const cell of ['esc', 'examine', 'explore', 'fight'] as const) {
            if (byCell.has(cell) && !aiming.includes(cell)) aiming[aiming.indexOf(undefined)] = cell
          }
        }
        positions.forEach(({ index, row, col, size }, i) => {
          const cell = SLOT_CELLS[index]
          if (deck) byCell.set(cell, shortcutLabel(slots[index], cell, byCell))
          else {
            const live = aiming[i] && byCell.get(aiming[i]!)
            if (!live) return
            byCell.set(cell, { ...live, cell })
          }
          place([cell], row, 4 + col, size, size)
        })
        if (deck && !this.editLayout.parentElement) this.touchbar.append(this.editLayout)
      } else {
        const targetSelect = shot?.action.kind === 'fire' && byCell.get('select')?.action.kind === 'fire' ? null : 'select'
        const commands: readonly (readonly (TouchCell | null)[])[] = split === 'levelmap'
          ? [['corner', 'examine', 'quiver'], ['explore', 'fight', 'actions'], ['esc', 'select', 'gear']]
          : [['examine', 'spare', 'gear'], ['explore', 'fight', 'actions'], ['esc', targetSelect, 'quiver']]
        commands.forEach((row, r) => row.forEach((cell, c) => { if (cell) place([cell], r + 1, c + 5) }))
      }
      const special = split === 'command' ? 'select' : split === 'levelmap' ? 'spare' : null
      if (special && byCell.has(special) && !(deck && hasShortcut('interact'))) {
        place([special], 3, 7)
        const interact = this.touchbar.querySelector<HTMLElement>(`[data-cell="${special}"]`)!
        interact.classList.add('touch-interact')
        interact.style.gridArea = 'auto'
      }
    } else if (labels?.length) {
      const rows: readonly (readonly TouchCell[])[] = TOUCH_CELLS
      for (const [i, l] of labels.entries()) {
        const row = rows.find(cells => cells.includes(l.cell))
        const start = row?.indexOf(l.cell) ?? 0
        const covers = row?.slice(start, start + (l.span ?? 1)) ?? [l.cell]
        const order = l.cell === 'esc' ? 0 : l.cell === 'select' ? labels.length + 1 : i + 1
        place(covers, 1, order)
      }
    }
    if (!deck) this.editLayout.remove()
    for (const old of previous.values()) {
      this.releaseTouchButton(old, true)
      old.remove()
    }
  }

  /** what the spell bar last drew, '' for nothing; null draws it again, shown or not (`layout`) */
  private spellKey: string | null = ''
  /** the spell bar's width as last measured, null when its place or its showing has changed since (`renderSpellBar`) */
  private spellbarW: number | null = null

  /**
   * The spell bar (spell-bar.ts): one row of small buttons under the
   * messages, a spell each in crawl's letter order, its art alone, the lit
   * one (armed, or being aimed) marked. It stands centred across its
   * width, upright and on its side alike. Too
   * many for the row: the last button is More, every spell in crawl's cast
   * list. Null leaves the row bare (its rows stay, so the messages hold still).
   */
  renderSpellBar(view: SpellBarView | null, gd: Gamedata | null) {
    this.spellbar.classList.toggle('mobile-spells', !!this.mobile)
    if (this.mobile) {
      this.renderMobileSpells(view, gd)
      return
    }
    // measured once a change (`spellbarW`), not once a frame: the read forces the frame's layout
    const width = (this.spellbarW ??= this.spellbar.clientWidth)
    const key = view ? view.spells.map((s) => s.letter + s.name + JSON.stringify(s.tile)).join(',') + '|' + view.lit + '|' + view.short.join('') + '|' + width + '|' + (window.devicePixelRatio || 1) + (gd ? '#' + gd.version : '') : ''
    if (key === this.spellKey) return
    this.spellKey = key
    // a bar shown again has its width again
    if (this.spellbar.hidden !== !view) this.spellbarW = null
    this.spellbar.hidden = !view
    if (!view) return clear(this.spellbar)
    const css = getComputedStyle(this.spellbar)
    const pad = (Number.parseFloat(css.paddingLeft) || 0) + (Number.parseFloat(css.paddingRight) || 0)
    const fit = Math.max(1, Math.floor((width - pad + SPELL_GAP) / (SPELL_SLOT + SPELL_GAP)))
    const more = view.spells.length > fit
    const shown = more ? view.spells.slice(0, fit - 1) : view.spells
    const buttons = shown.map((s) => this.spellButton(s, s.letter === view.lit, gd, view.short.includes(s.letter)))
    if (more) buttons.push(this.spellButton(null, false, gd))
    this.spellbar.replaceChildren(...buttons)
  }

  private renderMobileSpells(view: SpellBarView | null, gd: Gamedata | null) {
    this.spellbar.hidden = !view
    if (!view) return
    const { spells, lit, short } = view
    const key = JSON.stringify(spells) + '@' + window.devicePixelRatio + '#' + gd?.version
    if (this.spellTrackKey !== key) {
      this.spellTrackKey = key
      const scroll = this.spellTrack.scrollLeft
      this.spellTrack.replaceChildren(...spells.map(spell => this.spellButton(spell, false, gd, false, true)))
      this.spellTrack.scrollLeft = scroll
    }
    if (this.spellTrack.parentElement !== this.spellbar) {
      this.spellbar.replaceChildren(this.spellTrack, this.spellButton(null, false, gd, false, true))
      this.spellbar.setAttribute('role', 'group')
      this.spellbar.setAttribute('aria-label', 'Spell shortcuts')
    }
    for (const [i, button] of Array.from(this.spellTrack.children).entries()) {
      const active = spells[i].letter === lit
      button.classList.toggle('lit', active)
      button.classList.toggle('short', short.includes(spells[i].letter))
      if (active) button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    }
    const book = this.spellTrack.nextElementSibling as HTMLButtonElement
    book.disabled = !view.commands
  }

  private spellButton(spell: Spell | null, lit: boolean, gd: Gamedata | null, short = false, mobile = false): HTMLElement {
    // the spell's own art, whole (crawl's GUI tile, 32px); More is crawl's icon for casting with an ellipsis' dots
    const more = gd ? commandTileId(gd, 'CMD_CAST_SPELL') : undefined
    const size = mobile ? 30 : SPELL_SLOT
    const icon = spell ? tileCanvas(gd, spell.tile, 1, size) : more === undefined ? touchGlyph('action') : tileCanvas(gd, [{ t: more }], 1, size)
    const label = spell?.name ?? (mobile ? 'Spellbook' : 'More spells')
    const name = spell?.fail ? label + ', ' + spell.fail + ' fail' : label
    const shortcut = mobile ? h('span', { class: 'spell-key', 'aria-hidden': 'true' }, spell ? 'z' + spell.letter : 'I') : null
    const btn = h('button', { type: 'button', class: 'tb' + (lit ? ' lit' : '') + (short ? ' short' : '') + (spell ? '' : ' more'), title: name, 'aria-label': name }, icon, shortcut)
    btn.addEventListener('pointerdown', () => btn.classList.add('down'))
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => btn.classList.remove('down'))
    btn.addEventListener('click', () => (spell ? this.hooks.onSpellTap(spell) : this.hooks.onSpellMore(mobile)))
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault())
    return btn
  }

  /** A touch button's press or release: a pad button's goes to the game as the pad's would, a menu switch sends its key and the bar's own runs as it goes down. */
  private pressTouch(b: string, down: boolean, cancelled = false) {
    if (b.startsWith('shortcut:')) {
      if (down) this.hooks.onShortcut(b.slice(9))
    } else if (isSwitchButton(b)) {
      if (down) this.hooks.onTouchSwitch(b.slice('key:'.length))
    } else if (isExtraButton(b)) {
      if (down) this.hooks.onTouchExtra(b.slice('do:'.length) as TouchExtra)
    } else this.hooks.onTouchButton(b as VirtualButton, down, cancelled)
  }

  private releaseTouchButton(btn: HTMLElement, cancelled: boolean) {
    const pointer = this.touchPointers.get(btn)
    if (pointer === undefined) return
    this.touchPointers.delete(btn)
    btn.classList.remove('down')
    if (btn.hasPointerCapture(pointer)) btn.releasePointerCapture(pointer)
    this.pressTouch(btn.dataset.b!, false, cancelled)
  }

  /** A touch bar button pressing `l.button` for as long as the finger stays on it, over the cells `covers`. */
  private touchButton(covers: readonly TouchCell[], l: TouchLabel, gd: Gamedata | null, split: boolean): HTMLElement {
    const b = l.button
    const btn = h('button', { type: 'button', 'data-b': b, 'data-cell': covers[0] })
    btn.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || this.touchPointers.has(btn)) return
      ev.preventDefault()
      this.touchPointers.set(btn, ev.pointerId)
      // the finger may slide off before it lifts: its pointerup still comes here (a pointer the page never saw cannot be captured)
      try {
        btn.setPointerCapture(ev.pointerId)
      } catch {}
      btn.classList.add('down')
      this.pressTouch(b, true)
    })
    const up = (ev: PointerEvent) => {
      if (this.touchPointers.get(btn) !== ev.pointerId) return
      this.releaseTouchButton(btn, ev.type !== 'pointerup')
    }
    btn.addEventListener('pointerup', up)
    btn.addEventListener('pointercancel', up)
    btn.addEventListener('lostpointercapture', up)
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault())
    this.fillTouchButton(btn, covers, l, gd, split)
    return btn
  }

  /**
   * What a touch bar button shows for `l`: its art, its count, its word; a
   * press it is under stays. It wears the names of the cells it covers
   * (`at-select`), so one across Select's is the screen's verb as Select is
   * (styles.css).
   */
  private fillTouchButton(btn: HTMLElement, covers: readonly TouchCell[], l: TouchLabel, gd: Gamedata | null, split: boolean) {
    const arrow = TOUCH_ARROW_ROT[covers[0]]
    // a switch the screen prints in brackets wears them, the key bright between them
    // the key as the screen prints it, in its colours
    const keycap = () =>
      l.bare
        ? h('span', { class: 'keycap', html: l.keycapHtml ? unbracketed(l.keycapHtml) : escapeHtml(l.keycap!) })
        : l.keycapHtml
          ? h('span', { class: 'keycap', html: l.keycapHtml })
          : h('span', { class: 'keycap' }, h('span', { class: 'bracket' }, '['), l.keycap!, h('span', { class: 'bracket' }, ']'))
    // a tap-or-hold one names both on the one line, the hold in brackets: Wait [Rest]
    const caption = split ? l.label : TOUCH_MENU_NAVIGATION[covers[0]] ?? l.label
    const words = l.hold && !split ? caption + ' [' + l.hold + ']' : caption
    const text = formattedStringToText(words)
    // words too long for a caption's one line (a thing crawl names, "+2 short sword", a switch's choices
    // "Training|cost|targets") take two in place of the picture, which leaves no room for two under it
    const long = arrow === undefined && l.keycap === undefined && text.length > TOUCH_CAPTION_CHARS && (text.includes(' ') || (!!l.choices && text.includes('|')))
    const icon = arrow !== undefined ? touchArrow(arrow) : l.keycap !== undefined ? keycap() : long ? null : touchPicture(gd, l, l.item)
    btn.className = 'tb ' + covers.map((c) => 'at-' + c).join(' ') + (l.hold ? ' has-hold' : '') + (icon ? ' has-icon' : '') + (long ? ' long' : '') + (l.keycap !== undefined ? ' has-keycap' : '') + (l.bare ? ' bare' : '') + (isSwitchButton(l.button) ? ' switch' : '') + (l.lit ? ' lit' : '') + (l.fresh ? ' fresh' : '') + (l.refused ? ' refused' : '') + (btn.classList.contains('down') ? ' down' : '')
    btn.setAttribute('aria-label', formattedStringToText(caption))
    const parts: (Element | null)[] = [icon, l.count !== undefined ? h('span', { class: 'count' }, String(l.count)) : null, (split && arrow !== undefined) || l.bare ? null : l.labelHtml ? h('span', { class: 'label', html: l.labelHtml }) : label(words)]
    if (split && l.hold) {
      btn.setAttribute('aria-description', 'Hold for ' + l.hold)
      if (covers[0] === 'wait') parts.push(h('span', { class: 'hold-label' }, 'Hold ' + l.hold))
    } else btn.removeAttribute('aria-description')
    btn.replaceChildren(...parts.filter((n): n is Element => n !== null))
    // sized by its length to keep to its one line, or by its longer line of two (styles.css .tb.has-icon .label, .tb.long .label)
    btn.style.setProperty('--chars', String(long ? longerHalf(text, l.choices ? '|' : ' ') : text.length))
  }

  /**
   * The log let down onto what stands under it (layout `logPlace`). The
   * last row, the --more-- line's, is bare most of the time: with the spell
   * bar it stands over the bar, which is away while a --more-- waits. Held
   * upright the Health and Magic row stays, so the bare row stands over it
   * and the log goes up a row while a --more-- is on it, rather than keep a
   * row empty for it the rest of the time.
   */
  private placeLog() {
    const at = this.logPlace
    let v = ''
    if (at) {
      const by = Math.round(at.logFoot - at.cellsFoot + at.row)
      if (by > 0) v = `translateY(${by}px)`
    }
    if (this.messages.style.transform !== v) this.messages.style.transform = v
  }

  /** Lift the log above a phone's keyboard without overriding its layout transform. */
  liftLog(px: number) {
    const v = px > 0 ? `0 ${-px}px` : ''
    if (this.messages.style.translate !== v) this.messages.style.translate = v
  }

  /** Where the message pane is on the page, while it shows (overlays.ts placeLogInput). */
  logRect(): DOMRect | null {
    return this.messages.hidden || !this.cells ? null : this.messages.getBoundingClientRect()
  }

  /** A tap through the log still dismisses a pending --more--. */
  dismissesMoreAt(clientX: number, clientY: number): boolean {
    if (this.messages.hidden || !this.messages.classList.contains('dismissable')) return false
    const r = this.messages.getBoundingClientRect()
    return clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom
  }

  /** Mark the controls for touch gestures the player has yet to learn. */
  showTouchHints(ids: TouchLesson[], gd: Gamedata | null, systemMenu: HTMLButtonElement) {
    for (const [id, el] of this.touchHints) {
      if (ids.includes(id)) continue
      el.ring.remove()
      el.caption.remove()
      this.touchHints.delete(id)
    }
    if (!ids.length) return
    const root = this.paneRect(this.root)
    for (const id of ids) {
      const target = id === 'menu' ? systemMenu : this.minimapShown && !this.sidebar.hidden ? this.minimapCanvas : null
      const shown = target !== null && !target.hidden
      const r = shown ? this.paneRect(target) : null
      let el = this.touchHints.get(id)
      if (!r || r.width === 0 || r.height === 0) {
        if (el) el.ring.hidden = el.caption.hidden = true
        if (el) el.key = ''
        continue
      }
      if (!el) {
        // crawl's own icon for its help (`?`, CMD_DISPLAY_COMMANDS), drawn as the touch bar draws its pictures
        const icon = touchArt(gd, 'CMD_DISPLAY_COMMANDS', undefined)
        el = { ring: h('div', { class: 'touch-ring' }), caption: h('div', { class: 'touch-caption' }, icon, h('span', {}, id === 'menu' ? 'Tap for the menu' : 'Tap for the level map')), key: '' }
        this.root.append(el.ring, el.caption)
        this.touchHints.set(id, el)
      }
      const box = r
      const key = `${box.left},${box.top},${box.width},${box.height},${root.width}`
      if (key === el.key) continue
      el.key = key
      el.ring.hidden = el.caption.hidden = false
      Object.assign(el.ring.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' })
      const cw = el.caption.offsetWidth
      const centered = box.left + box.width / 2 - cw / 2
      const landscape = this.mobile && !this.mobile.portrait
      const anchor = id === 'menu' ? (landscape ? this.paneRect(this.stats).left - cw - 8 : box.left + box.width - cw)
        : landscape ? box.left - cw - 8 : centered
      const left = Math.max(4, Math.min(root.width - cw - 4, anchor))
      const messages = this.paneRect(this.messages)
      const below = box.top + box.height + 4
      const top = id === 'menu' ? (landscape ? Math.max(below, messages.top + messages.height + 4) : below)
        : this.mobile?.portrait ? messages.top - el.caption.offsetHeight - 4 : landscape ? box.top + 44 : below
      // on whole pixels, or the icon in it smears (snapToPixels)
      Object.assign(el.caption.style, { left: Math.round(left) + 'px', top: Math.round(top) + 'px' })
    }
  }

  /** the panes measured this frame, relative to the hud (`paneRect`); emptied as each frame's `update` starts */
  private paneRects = new Map<HTMLElement, PxRect>()
  /** the hud's own place on the page this frame, for `paneRect` */
  private rootAt: DOMRect | null = null

  /**
   * Where `el` is, in css px relative to the hud (the hud itself at 0, 0), measured once a frame: what steps round the
   * panes (the touch lessons' rings) asks after writes of its own, and every measure after a write forces
   * the frame's layout again. The panes they ask about stand still for the rest of the frame once `update` has set them.
   */
  private paneRect(el: HTMLElement): PxRect {
    let r = this.paneRects.get(el)
    if (!r) {
      const first = !this.rootAt
      const root = (this.rootAt ??= this.root.getBoundingClientRect())
      const measure = (e: HTMLElement) => {
        const at = e === this.root ? root : e.getBoundingClientRect()
        const m = { left: at.left - root.left, top: at.top - root.top, width: at.width, height: at.height }
        this.paneRects.set(e, m)
        return m
      }
      // all of them at once, on the one layout: asked one by one, between writes, each would lay the page out again
      if (first) for (const e of this.panes()) measure(e)
      r = this.paneRects.get(el) ?? measure(el)
    }
    return r
  }

  /** the panes the touch lessons stand on (`paneRect`) */
  private panes(): HTMLElement[] {
    return [this.root, this.stats, this.actionPanel, this.actionbar, this.menubar, this.statuses, this.minimapCanvas, this.monsters]
  }

  /** The touch bar's height in css px, for what stands on the view's foot to stand on it instead. */
  get touchbarHeight(): number {
    return this.touchbar.hidden ? 0 : (this.touchbarH ??= this.touchbar.offsetHeight)
  }
  /**
   * the touch bar's height as last measured; null when its buttons or its place have changed since. Read every frame
   * (game.ts relayout), and a read forces the frame's layout, so it is measured once a change rather than once a frame
   */
  private touchbarH: number | null = null

  /**
   * Menu controls reserve a footer. The landscape compass leaves the command
   * bank beside the overlay, and the portrait compass stays below it.
   */
  get touchbarInset(): { right: number; bottom: number } {
    if (this.touchbar.hidden || !this.touchLayout || !this.host) return { right: 0, bottom: 0 }
    const layout = this.touchLayout
    if (this.touchbar.classList.contains('context-controls')) {
      return { right: 0, bottom: this.host.height - layout.bottom + this.touchbarHeight }
    }
    return layout.portrait
      ? { right: 0, bottom: this.host.height - layout.barTop }
      : { right: this.host.width - layout.commandLeft + MOBILE_GAP, bottom: 0 }
  }

  /** One prompt: the button's glyph, the label, and the hold's label under it when there is one. Inert to a press: the view answers, not the prompt. */
  private chip(l: BindingLabel, key: string, padKind: PadKind): HTMLElement {
    const chip = h(
      'span',
      { class: 'chip ' + l.button + (l.hold ? ' has-hold' : '') + (l.teaching ? ' teaching' : '') + (l.fresh ? ' fresh' : ''), title: glyphName(l.button, padKind) + (l.hold ? ': ' + formattedStringToText(l.label) + ', hold for ' + formattedStringToText(l.hold) : ''), onclick: l.teaching ? undefined : () => this.hooks.onBarAction(l.action) },
      h('span', { class: 'key' }, glyph(l.button, padKind)),
      h('span', { class: 'text' }, label(l.label), l.hold ? h('span', { class: 'hold' }, glyph('HOLD', padKind), h('span', { html: formattedStringToHtml(l.hold) })) : null),
    )
    chip.dataset.k = key
    return chip
  }

  private group(name: string, ...chips: (HTMLElement | null)[]): HTMLElement {
    return h('span', { class: 'group ' + name }, ...chips)
  }
}


/**
 * A prompt's label as one more line of the HUD: a crawl formatted string,
 * drawn with the message pane's colours (format.ts `formattedStringToHtml`,
 * styles.css `.fg10`), so "a staff of alchemy" underfoot is the green the log
 * gave it. A label with no tags is its own plain text.
 */
function label(text: string): HTMLElement {
  return h('span', { class: 'label', html: formattedStringToHtml(text) })
}

/**
 * A touch button's icon: crawl's command art by name (bindings.ts
 * `touchIcon`), or an item's own tile (`item`, the quivered shot), or null
 * for neither or before the gamedata has come. Crawl's command icons are
 * 28px of a 32px cell (offset 2) framed in a 1px grey box on black, a
 * button of their own on its command bar; on ours, which is the button, the
 * frame and the black are dropped and the 26px inside drawn alone. An item
 * is cut to the same 26px of its cell, so the two stand the same size. Each
 * art pixel a whole number of device pixels (`touchArtScale`; overlays.ts
 * `tileCanvas` says why).
 */
function touchArt(gd: Gamedata | null, icon: string | undefined, item: TouchLabel['item']): HTMLCanvasElement | null {
  if (!gd) return null
  const layers: { t: number; layer?: string; ymax?: number }[] = []
  if (item !== undefined) {
    // tileweb.cc `_send_item`: plain ids in the main texture, a `{ t, tex }` layer keeping its own (as the action panel draws them)
    for (const t of Array.isArray(item) ? item : [item]) layers.push(typeof t === 'number' ? { t, layer: 'main' } : { t: t.t, layer: String(t.tex), ymax: t.ymax })
  } else {
    const id = commandTileId(gd, icon)
    if (id !== undefined) layers.push({ t: id })
  }
  if (!layers.length) return null
  const k = touchArtScale()
  const dpr = window.devicePixelRatio || 1
  const c = h('canvas', { class: 'tile' })
  c.width = c.height = TOUCH_ART * k
  c.style.width = c.style.height = (TOUCH_ART * k) / dpr + 'px'
  const ctx = c.getContext('2d')
  if (!ctx) return c
  // the bar is built again whenever a word on it changes, and every button with it: a picture drawn before is copied
  const key = k + '|' + (icon ?? '') + '|' + JSON.stringify(layers)
  let drawn = touchArtDrawn.get(gd)
  if (!drawn) touchArtDrawn.set(gd, (drawn = new Map()))
  const made = drawn.get(key)
  if (made) {
    ctx.drawImage(made, 0, 0)
    requestAnimationFrame(() => snapToPixels(c))
    return c
  }
  ctx.imageSmoothingEnabled = false
  let whole = true
  for (const l of layers) {
    const rect = gd.tile(l.t, l.layer)
    const img = rect && gd.atlas(rect.atlas)
    if (!rect || !img) {
      whole = false
      continue
    }
    const hh = l.ymax !== undefined && l.ymax < rect.oy + rect.h ? Math.max(0, l.ymax - rect.oy) : rect.h
    if (hh <= 0) continue
    ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, hh, (rect.ox - TOUCH_ART_INSET) * k, (rect.oy - TOUCH_ART_INSET) * k, rect.w * k, hh * k)
  }
  if (item === undefined && /^(CMD|PROMPT)_/.test(icon ?? '')) {
    // the command art's black ground lets the button's own show through (a dark backing over the dungeon on its side)
    try {
      const px = ctx.getImageData(0, 0, c.width, c.height)
      const d = px.data
      for (let i = 0; i < d.length; i += 4) if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) d[i + 3] = 0
      ctx.putImageData(px, 0, 0)
    } catch {
      // an atlas from another origin taints the canvas: the black stays, on a button nearly as dark
    }
  }
  // kept only whole: an atlas still loading draws its layer next time
  if (whole) {
    const keep = document.createElement('canvas')
    keep.width = keep.height = c.width
    keep.getContext('2d')?.drawImage(c, 0, 0)
    drawn.set(key, keep)
  }
  requestAnimationFrame(() => snapToPixels(c))
  return c
}

/** each touch picture as `touchArt` drew it, by gamedata, then by scale and art (`touchArt`) */
const touchArtDrawn = new WeakMap<Gamedata, Map<string, HTMLCanvasElement>>()

/** a spell bar button, in css px: a spell's 32px art alone, which wears crawl's own frame, small so a row holds many */
const SPELL_SLOT = 32
/** the gap between the spell bar's buttons, in css px */
const SPELL_GAP = 4
/** between the log's last line and the spell bar, and between the bar and the screen's foot on its side, in css px */
const SPELL_LOG_GAP = 4
const SPELL_FOOT_GAP = 6
/** the inside of crawl's command art, in its pixels: 28 less the frame's 1 each side */
const TOUCH_ART = 26
/**
 * what a touch button with an icon takes down besides the icon, in css px: its border and padding, the gap and
 * the caption's line (styles.css .touchbar .tb)
 */
const TOUCH_CAPTION_PX = 18
/** where that inside starts in the art's 32px cell: the art's offset 2 and the frame's 1 */
const TOUCH_ART_INSET = 3
/**
 * the longest caption kept to one line under its picture, shrunk to fit (Leave dungeon, Wait [Rest]); a longer one
 * with a space in it takes two lines (hud.ts fillTouchButton)
 */
const TOUCH_CAPTION_CHARS = 13

/** the longer line of `text` broken at the space that splits it most evenly, as `text-wrap: balance` breaks it */
function longerHalf(text: string, at = ' '): number {
  let best = text.length
  // a line broken at a space loses the space; one broken after a `|` keeps it
  const kept = at === ' ' ? 0 : 1
  for (let i = text.indexOf(at); i >= 0; i = text.indexOf(at, i + 1)) best = Math.min(best, Math.max(i + kept, text.length - i - 1))
  return best
}

/** the most css px a touch icon stands: what a button leaves over its caption */
const TOUCH_ART_MOST = TOUCH_BUTTON_H - TOUCH_CAPTION_PX

/** device pixels to an art pixel on the touch bar: the most that keeps an icon within TOUCH_ART_MOST css px, and at least one */
function touchArtScale(): number {
  return Math.max(1, Math.floor((TOUCH_ART_MOST * (window.devicePixelRatio || 1)) / TOUCH_ART))
}

/** each d-pad cell's arrow, as a turn of the one pointing up (`touchArrow`) */
const DIAGONAL_TOUCH: readonly (readonly [TouchCell, DiagonalButton, string])[] = [
  ['upLeft', 'DUL', 'Northwest'], ['upRight', 'DUR', 'Northeast'],
  ['downLeft', 'DDL', 'Southwest'], ['downRight', 'DDR', 'Southeast'],
]
const TOUCH_ARROW_ROT: Partial<Record<TouchCell, number>> = {
  up: 0, upRight: 45, right: 90, downRight: 135, down: 180, downLeft: 225, left: 270, upLeft: 315,
}
const TOUCH_MENU_NAVIGATION: Partial<Record<TouchCell, string>> = {
  up: 'Previous', down: 'Next', left: 'Left', right: 'Right',
}

/** An anchor with nothing to do on this screen (bindings.ts `TOUCH_ANCHORS`): its arrow, or its picture over its word, dim, pressing nothing. */
function idleTouchButton(cell: TouchCell, idle: TouchIcon & { label: string; keycap?: string; bare?: boolean }, gd: Gamedata | null): HTMLElement {
  const arrow = TOUCH_ARROW_ROT[cell]
  const keyed = idle.keycap !== undefined
  // a switch away: its key alone, without the screen's colours (the skills screen's `[-]` outside its targets)
  const icon = arrow !== undefined ? touchArrow(arrow) : keyed ? h('span', { class: 'keycap' }, idle.keycap!) : touchPicture(gd, idle)
  const el = h('span', { class: 'tb idle at-' + cell + (icon ? ' has-icon' : '') + (keyed ? ' has-keycap' : '') + (idle.bare ? ' bare' : ''), 'data-cell': cell, 'aria-hidden': 'true' }, icon, arrow !== undefined || idle.bare ? null : label(idle.label))
  el.style.setProperty('--chars', String(idle.label.length))
  return el
}

/**
 * A touch button's picture: the item, or crawl's art by name, or a glyph of
 * ours; crawl's art this version of the game lacks is our step on, so no
 * button goes without. Null only for crawl's art before the gamedata has
 * come.
 */
function touchPicture(gd: Gamedata | null, face: TouchIcon, item?: TouchLabel['item']): Element | null {
  if (item !== undefined || face.icon || face.art) {
    // a spell's or an ability's own art, where this version has it, over crawl's icon for casting or using one
    const own = item === undefined ? face.art?.find((n) => commandTileId(gd, n) !== undefined) : undefined
    const art = touchArt(gd, own ?? face.icon, item)
    if (art || !gd) return art
  }
  return touchGlyph(face.glyph ?? 'action')
}

/**
 * A d-pad cell's arrow: a pixel arrow in the icons' own grain (their 26px,
 * drawn the same size), where a font's arrow read thin beside crawl's art.
 */
function touchArrow(deg: number): SVGSVGElement {
  const svg = touchSvg('arrow')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  // Keep both arrow shapes aligned to pixel steps when rotated.
  const diagonal = deg % 90 !== 0
  path.setAttribute('d', diagonal ? 'M12 4h10v10h-4v-4h-2v2h-2v2h-2v2h-2v2H8v2H6v-2H4v-2h2v-2h2v-2h2v-2h2V4z'
    : 'M12 3h2v2h2v2h2v2h2v2h2v2h-6v10h-6V13H4v-2h2V9h2V7h2V5h2z')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('transform', `rotate(${diagonal ? deg - 45 : deg} 13 13)`)
  svg.append(path)
  return svg
}

/** A glyph of ours (touch-glyphs.ts), drawn as the arrows are. */
function touchGlyph(name: TouchGlyph): SVGSVGElement {
  const svg = touchSvg('glyph')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', glyphPath(name))
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

/** an empty 26px square at the icons' size, for a pixel drawing of ours */
function touchSvg(cls: string): SVGSVGElement {
  const side = (TOUCH_ART * touchArtScale()) / (window.devicePixelRatio || 1)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', cls)
  svg.setAttribute('viewBox', '0 0 26 26')
  svg.setAttribute('width', String(side))
  svg.setAttribute('height', String(side))
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

/** The 16 terminal colours, for glyph-mode items on the action panel. */
const TERM16 = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff']

/** Whether `next` differs from `prev` element for element: a memo key with no string to build each frame. */
function changed(prev: readonly unknown[] | undefined, next: readonly unknown[]): boolean {
  if (!prev || prev.length !== next.length) return true
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) return true
  return false
}

/** a key the screen prints in brackets (`switchColours` `keyHtml`) without them, in its colour: a button with nothing else on it (TouchLabel `bare`) */
function unbracketed(keyHtml: string): string {
  return keyHtml
    .replace(/\[/, '')
    .replace(/\](?=[^\]]*$)/, '')
    .replace(/<span class="[^"]*"><\/span>/g, '')
}
