import { chatCaptionHeight, TOUCH_BUTTON_H, type GameLayout } from './console'
import type { GridHost } from './host'
import { portraitLayout, tabletLayout, type TouchLayout } from './layout'
import { PANEL_CELL, PANEL_FRAME, panelGrid } from './panel'

export const MOBILE_GAP = 4
export const MOBILE_SPELL_HEIGHT = TOUCH_BUTTON_H + MOBILE_GAP
export const PORTRAIT_MONSTER_CELL = 24
export const PORTRAIT_MONSTER_LIST_HEIGHT = 2 * PORTRAIT_MONSTER_CELL
const GUTTER = 8
const MONSTER_ROW = 32
const CORNER_CONTROL_SIZE = 32
/** Folded button's line, padding, border, and outer margins. */
const FOLDED_PANEL_HEIGHT = 37
const PORTRAIT_STATS_ROWS = 7
const MAX_COMMAND_WIDTH = 320
const MIN_DPAD_WIDTH = 3 * TOUCH_BUTTON_H + 2 * MOBILE_GAP
const MIN_CONTEXT_WIDTH = 5 * TOUCH_BUTTON_H + 4 * MOBILE_GAP

export type MobileDungeon = ReturnType<typeof mobileDungeonLayout>

function portraitMessageRows(height: number) {
  return Math.max(2, Math.floor(height / 145))
}

interface MobileHudOptions {
  stats: boolean
  monsters: boolean
  minimap: boolean
  touch: boolean
  msgRows: number
  floatingInteract: boolean
  hideEditTouchLayout: boolean
  spellHeight: number
  characterScale: number
  fullscreen: boolean
  panelCell: number
  panelButtons: number
  panelVertical: boolean
  movementWidth: number
  actionsWidth: number
  swapControls: boolean
  controlScale: number
}

export interface TouchControlSpace {
  portrait: boolean
  availableHeight: number
  availableWidth: number
  autoMovement: number
  autoActions: number
}

/** Both sliders use the same reference width. Only adjacent or crowded banks share a fixed budget. */
export function touchBankWidths(space: TouchControlSpace, movementPercent: number, actionsPercent: number) {
  const reference = space.autoMovement + space.autoActions
  const movement = movementPercent ? reference * movementPercent / 100 : space.autoMovement
  const actions = actionsPercent ? reference * actionsPercent / 100 : space.autoActions
  // Short landscapes need two spell buttons between the banks.
  const center = Math.min(space.availableWidth - reference, 2 * TOUCH_BUTTON_H + 2 * GUTTER + MOBILE_GAP)
  const limit = space.portrait ? reference : space.availableWidth - center
  const minTile = Math.min(32, (reference - 5 * MOBILE_GAP) / 7)
  const minMovement = 3 * minTile + 2 * MOBILE_GAP
  const minActions = 4 * minTile + 3 * MOBILE_GAP
  const wantedMovement = Math.max(minMovement, movement)
  const wantedActions = Math.max(minActions, actions)
  if (!space.portrait && wantedMovement + wantedActions <= limit)
    return { movement: wantedMovement, actions: wantedActions }
  const share = limit * movement / (movement + actions)
  const fittedMovement = Math.max(minMovement, Math.min(limit - minActions, share))
  return { movement: fittedMovement, actions: limit - fittedMovement }
}

export function touchRowHeight(usableHeight: number, scale: number) {
  // Even at the tallest setting, leave the HUD room above the compass on short phones.
  const maxRowHeight = Math.max(TOUCH_BUTTON_H, Math.floor((usableHeight - 108 - 2 * MOBILE_GAP) / 3))
  return Math.min(maxRowHeight, TOUCH_BUTTON_H * scale)
}

export function mobileControlSpace(layout: TouchLayout, width: number, height: number, insets: GridHost['insets']) {
  const portrait = portraitLayout(layout)
  const tablet = tabletLayout(layout)
  const left = insets.left + GUTTER
  const right = width - insets.right - GUTTER
  const top = insets.top
  const bottom = height - Math.max(GUTTER, insets.bottom + MOBILE_GAP)
  const usableWidth = right - left
  const usableHeight = bottom - top
  const sideWidth = portrait ? 0 : Math.min(tablet ? 352 : MAX_COMMAND_WIDTH, Math.max(MIN_CONTEXT_WIDTH, Math.round(usableWidth * 0.34)))
  const dungeonRight = portrait ? width : right - sideWidth - GUTTER
  const statLeft = portrait ? left : dungeonRight + GUTTER
  const statWidth = right - statLeft
  const autoDpadWidth = portrait
    ? Math.min(148, Math.floor((usableWidth - GUTTER - 5 * MOBILE_GAP) * 3 / 7) + 2 * MOBILE_GAP)
    : MIN_DPAD_WIDTH
  const autoCommandLeft = portrait ? Math.max(left + autoDpadWidth + GUTTER, right - MAX_COMMAND_WIDTH) : Math.max(statLeft, right - MAX_COMMAND_WIDTH)
  const controlSpace = { portrait, availableWidth: usableWidth, availableHeight: usableHeight, autoMovement: autoDpadWidth, autoActions: right - autoCommandLeft }
  return { controlSpace, left, right, top, bottom, dungeonRight, statLeft, statWidth }
}

/** The viewport and HUD share the usable space in CSS pixels. */
export function mobileDungeonLayout(host: GridHost, layout: TouchLayout, options: MobileHudOptions) {
  const { stats, monsters, minimap, touch, msgRows, spellHeight, characterScale, fullscreen, panelCell } = options
  const portrait = portraitLayout(layout)
  const tablet = tabletLayout(layout)
  const { width, height, insets, grid } = host
  const { controlSpace, left, right, top, bottom, dungeonRight, statLeft, statWidth } = mobileControlSpace(layout, width, height, insets)
  const { availableWidth: usableWidth, availableHeight: usableHeight } = controlSpace
  const rowHeight = touchRowHeight(usableHeight, options.controlScale)
  const barHeight = rowHeight * 3 + MOBILE_GAP * 2
  const barTop = touch ? bottom - barHeight : bottom
  const banks = touchBankWidths(controlSpace, options.movementWidth, options.actionsWidth)
  const leftBankWidth = options.swapControls ? banks.actions : banks.movement
  const rightBankWidth = options.swapControls ? banks.movement : banks.actions
  const rightBankLeft = right - rightBankWidth
  const bankGap = usableWidth - leftBankWidth - rightBankWidth
  const editInGap = !options.hideEditTouchLayout && bankGap >= TOUCH_BUTTON_H + 2 * MOBILE_GAP
  // In short landscapes the spell rail uses the top of the gap. The editor sits at its foot.
  const gapLeft = left + leftBankWidth + GUTTER
  const gapWidth = bankGap - 2 * GUTTER
  const spellsInGap = !portrait && spellHeight > 0 && barTop - top < 125 && gapWidth >= 2 * TOUCH_BUTTON_H + MOBILE_GAP
  const dockLeft = !portrait && touch ? rightBankLeft : statLeft
  const spellLeft = spellsInGap ? gapLeft : dockLeft
  const spellWidth = spellsInGap ? gapWidth : right - dockLeft
  const mapHeight = tablet ? 112 : 96
  const landscapeSpellTop = spellsInGap ? barTop : barTop - spellHeight
  // Keep the gap placement on short screens where another docked row would crowd the sidebar.
  const dockInteract = tablet && options.floatingInteract && !spellsInGap && landscapeSpellTop - top >= mapHeight + TOUCH_BUTTON_H + MOBILE_GAP
  const interactRoom = dockInteract ? TOUCH_BUTTON_H + MOBILE_GAP : 0
  const contentBottom = portrait ? barTop : landscapeSpellTop - interactRoom
  const text = host.textMetrics((portrait ? 11 : 10.5) + (tablet ? 1 : 0))
  const statsFont = text.fs * characterScale
  const statsRow = text.ch * characterScale
  // Leave a dedicated touch target at the right of the portrait character sheet.
  const sheetWidth = statWidth - (portrait && touch && !options.hideEditTouchLayout && !editInGap ? TOUCH_BUTTON_H + MOBILE_GAP : 0)
  const statsCols = Math.floor(sheetWidth / text.cw)
  // In landscape the map and list share one row below the scrollable character sheet.
  const sidebarHeight = minimap ? Math.min(mapHeight, (contentBottom - top) / 2) : monsters ? MONSTER_ROW : 0
  const statsRoom = portrait ? usableHeight * 0.22 : contentBottom - top - (sidebarHeight ? sidebarHeight + MOBILE_GAP : 0)
  const sheetRows = Math.max(0, Math.min(portrait ? PORTRAIT_STATS_ROWS : 8, Math.floor((statsRoom - MOBILE_GAP) / statsRow)))
  const statsHeight = stats ? sheetRows * statsRow + MOBILE_GAP : 0
  const controlsWidth = fullscreen ? 2 * CORNER_CONTROL_SIZE : CORNER_CONTROL_SIZE
  const controlsLeft = statLeft - CORNER_CONTROL_SIZE - MOBILE_GAP
  const messageRight = portrait ? right : controlsLeft - MOBILE_GAP
  // Fit the panel above the compass. In the shortest windows it sits to the right of the log and compass.
  const aboveCompass = barTop - top - 2 * MOBILE_GAP
  const panelBesideLog = !portrait && panelCell > 0 && aboveCompass < FOLDED_PANEL_HEIGHT + text.ch
  const panelLeft = panelBesideLog ? left + leftBankWidth + MOBILE_GAP : left
  const panelWidth = (portrait ? right - controlsWidth : messageRight) - panelLeft
  const landscapeCell = portrait ? 0 : Math.min(panelCell, Math.floor((panelWidth - PANEL_FRAME) / 2), Math.max(PANEL_CELL, aboveCompass - text.ch - MOBILE_GAP))
  const minimumPanelHeight = landscapeCell > 0 ? (options.panelButtons ? landscapeCell + PANEL_FRAME : FOLDED_PANEL_HEIGHT) : 0
  const messageWidth = (panelBesideLog ? panelLeft - MOBILE_GAP : messageRight) - left
  // In portrait, hang the message prefix in the safe-area gutter beside the character sheet.
  const messageGutter = portrait ? GUTTER : 0
  const messageCols = Math.floor(messageWidth / text.cw) + Number(portrait)
  const landscapeLines = minimumPanelHeight > 0 && !panelBesideLog ? Math.floor((aboveCompass - minimumPanelHeight) / text.ch) : 3
  const lines = Math.max(1, Math.min(msgRows, portrait ? portraitMessageRows(usableHeight) : Math.min(3, landscapeLines)))
  const messageHeight = stats ? lines * text.ch : 0
  // Reserve the log's lines before wrapping a vertical panel above them.
  const panelCapacity = Math.max(landscapeCell, barTop - top - 2 * MOBILE_GAP - messageHeight - PANEL_FRAME)
  let landscapePanelHeight = minimumPanelHeight
  if (landscapeCell > 0 && options.panelButtons && options.panelVertical && !panelBesideLog) {
    const grid = panelGrid(options.panelButtons, landscapeCell, { height: panelCapacity }, false)
    landscapePanelHeight = grid.rows * landscapeCell + PANEL_FRAME
  }
  const sheetTop = portrait ? barTop - statsHeight - MOBILE_GAP : top
  const spellTop = portrait ? sheetTop - spellHeight : landscapeSpellTop
  const viewHeight = portrait ? Math.max(1, spellTop - interactRoom - messageHeight - (stats ? MOBILE_GAP : 0)) : height
  const cell = portrait ? Math.min(panelCell, Math.floor((panelWidth - PANEL_FRAME) / 2), Math.max(PANEL_CELL, Math.floor(viewHeight / 3))) : landscapeCell
  const panelTop = top + MOBILE_GAP
  const actionPanel = cell > 0 ? {
    cell, box: { left: panelLeft, top: panelTop, width: panelWidth, height: portrait || panelBesideLog ? cell : panelCapacity },
  } : null
  const portraitSidebarTop = top + MOBILE_GAP + (actionPanel ? Math.max(FOLDED_PANEL_HEIGHT, cell + PANEL_FRAME) + MOBILE_GAP : 0)
  const portraitSidebarRoom = Math.max(0, viewHeight - portraitSidebarTop)
  const portraitMapHeight = Math.min(mapHeight, viewHeight / 3)
  const portraitListRoom = portrait && minimap && monsters ? MOBILE_GAP + PORTRAIT_MONSTER_LIST_HEIGHT : 0
  // Fit zoom against a stable viewport with room for the full touch HUD.
  const referenceHeight = Math.min(height, host.smallViewportHeight || height)
  const referenceUsable = referenceHeight - GUTTER
  const fitHeight = portrait ? Math.max(1, referenceUsable - barHeight - MOBILE_SPELL_HEIGHT
    - Math.min(referenceUsable * 0.22, PORTRAIT_STATS_ROWS * statsRow + MOBILE_GAP)
    - portraitMessageRows(referenceUsable) * text.ch - 2 * MOBILE_GAP) : referenceHeight
  const logTop = portrait ? viewHeight : panelTop + (landscapePanelHeight > 0 && !panelBesideLog ? landscapePanelHeight + MOBILE_GAP : 0)
  const rect = (x: number, y: number, w: number, h: number) => ({
    x: (x - grid.ox) / grid.cw, y: (y - grid.oy) / grid.ch, w: Math.max(0, w) / grid.cw, h: Math.max(0, h) / grid.ch,
  })
  const view = rect(0, 0, dungeonRight, viewHeight)
  const cells: GameLayout = {
    view,
    band: rect(0, 0, 0, 0),
    clear: portrait ? view : rect(0, top, dungeonRight, height - top),
    messages: rect(left - messageGutter, logTop, messageWidth + messageGutter, messageHeight),
    stats: rect(statLeft, sheetTop, sheetWidth, statsHeight),
    sidebar: portrait
      ? rect(left, portraitSidebarTop, Math.min(panelWidth, 180, usableWidth / 2), Math.min(portraitSidebarRoom, portraitMapHeight + portraitListRoom))
      : rect(statLeft, top + statsHeight, statWidth, contentBottom - top - statsHeight - MOBILE_GAP),
  }
  const chatHeight = chatCaptionHeight(grid.ch)
  // Keep room for the map and at least two monster rows when chat shares the sidebar.
  const sidebarContentHeight = minimap ? 2 * MONSTER_ROW : monsters ? MONSTER_ROW : 0
  const sidebarChatHeight = !portrait && cells.sidebar.h * grid.ch >= sidebarContentHeight + chatHeight
    ? chatHeight : 0
  const launcherLeft = left + leftBankWidth + MOBILE_GAP
  const launcherRight = Math.min(dungeonRight, rightBankLeft - (editInGap ? TOUCH_BUTTON_H + MOBILE_GAP : 0)) - GUTTER
  const chatLauncher = !portrait && !sidebarChatHeight ? {
    left: launcherLeft, top, width: Math.max(0, launcherRight - launcherLeft), height: bottom - top,
  } : null
  return {
    cells, portrait, portraitMapHeight, fitHeight, text, statsFont, statsRow, statsCols, messageCols, messageGutter, lines,
    left, right, bottom, barTop, rowHeight, dpadWidth: banks.movement, rightBankLeft, rightBankWidth, bankGap, swapped: options.swapControls, controlSpace,
    sidebarChatHeight, chatLauncher, actionPanel, controlsLeft, editInGap, dockLeft, dockInteract,
    interactBottom: dockInteract ? barTop - spellTop + MOBILE_GAP : portrait ? barTop - viewHeight + 6 : MOBILE_GAP,
    spellTop, spellLeft, spellWidth,
  }
}
