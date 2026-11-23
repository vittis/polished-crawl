import { chatCaptionHeight, TOUCH_BUTTON_H, type GameLayout } from './console'
import type { GridHost } from './host'
import { portraitLayout, tabletLayout, type TouchLayout } from './layout'
import { PANEL_CELL } from './panel'

export const MOBILE_GAP = 4
export const MOBILE_SPELL_HEIGHT = TOUCH_BUTTON_H + MOBILE_GAP
const GUTTER = 8
const MONSTER_ROW = 32
const CORNER_CONTROL_SIZE = 32
/** Folded button's line, padding, border, and outer margins. */
const FOLDED_PANEL_HEIGHT = 37
const PORTRAIT_STATS_ROWS = 7
const MAX_COMMAND_WIDTH = 320
const MIN_DPAD_WIDTH = 3 * TOUCH_BUTTON_H + 2 * MOBILE_GAP
const MIN_FOUR_COMMANDS_WIDTH = 4 * TOUCH_BUTTON_H + 3 * MOBILE_GAP
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
  spellHeight: number
  characterScale: number
  fullscreen: boolean
  panelCell: number
}

/** The viewport and HUD share the usable space in CSS pixels. */
export function mobileDungeonLayout(host: GridHost, layout: TouchLayout, options: MobileHudOptions) {
  const { stats, monsters, minimap, touch, msgRows, spellHeight, characterScale, fullscreen, panelCell } = options
  const portrait = portraitLayout(layout)
  const tablet = tabletLayout(layout)
  const { width, height, insets, grid } = host
  const left = insets.left + GUTTER
  const right = width - insets.right - GUTTER
  const top = insets.top
  const bottom = height - Math.max(GUTTER, insets.bottom + MOBILE_GAP)
  const usableWidth = right - left
  const usableHeight = bottom - top
  const barHeight = TOUCH_BUTTON_H * 3 + MOBILE_GAP * 2
  const barTop = touch ? bottom - barHeight : bottom
  // On short phones spell shortcuts use the first row alongside Escape, with the map button beside them.
  const spellsBesideEscape = !portrait && spellHeight > 0 && barTop - top < 125
  const contentBottom = barTop - (portrait || spellsBesideEscape ? 0 : spellHeight)
  const sideWidth = portrait ? 0 : Math.min(tablet ? 352 : MAX_COMMAND_WIDTH, Math.max(MIN_CONTEXT_WIDTH, Math.round(usableWidth * 0.34)))
  const dungeonRight = portrait ? width : right - sideWidth - GUTTER
  const statLeft = portrait ? left : dungeonRight + GUTTER
  const statWidth = right - statLeft
  const text = host.textMetrics((portrait ? 11 : 10.5) + (tablet ? 1 : 0))
  const statsFont = text.fs * characterScale
  const statsRow = text.ch * characterScale
  const statsCols = Math.floor(statWidth / text.cw)
  // In landscape the map and list share one row below the scrollable character sheet.
  const mapHeight = tablet ? 112 : 96
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
  const panelLeft = panelBesideLog ? left + MIN_DPAD_WIDTH + MOBILE_GAP : left
  const panelWidth = (portrait ? right - controlsWidth : messageRight) - panelLeft
  const landscapeCell = portrait ? 0 : Math.min(panelCell, Math.floor(panelWidth / 2), Math.max(PANEL_CELL, aboveCompass - text.ch))
  const landscapePanelHeight = landscapeCell > 0 ? Math.max(FOLDED_PANEL_HEIGHT, landscapeCell) : 0
  const messageWidth = (panelBesideLog ? panelLeft - MOBILE_GAP : messageRight) - left
  const messageCols = Math.floor(messageWidth / text.cw)
  const landscapeLines = landscapePanelHeight > 0 && !panelBesideLog ? Math.floor((aboveCompass - landscapePanelHeight) / text.ch) : 3
  const lines = Math.max(1, Math.min(msgRows, portrait ? portraitMessageRows(usableHeight) : Math.min(3, landscapeLines)))
  const messageHeight = stats ? lines * text.ch : 0
  const sheetTop = portrait ? barTop - statsHeight - MOBILE_GAP : top
  const spellTop = portrait ? sheetTop - spellHeight : spellsBesideEscape ? barTop : contentBottom
  const viewHeight = portrait ? Math.max(1, spellTop - messageHeight - (stats ? MOBILE_GAP : 0)) : height
  const cell = portrait ? Math.min(panelCell, Math.floor(panelWidth / 2), Math.max(PANEL_CELL, Math.floor(viewHeight / 3))) : landscapeCell
  const panelTop = top + MOBILE_GAP + (portrait || panelBesideLog ? 0 : messageHeight + MOBILE_GAP)
  const actionPanel = cell > 0 ? {
    cell, box: { left: panelLeft, top: panelTop, width: panelWidth, height: portrait || panelBesideLog ? cell : Math.max(cell, barTop - panelTop) },
  } : null
  const portraitSidebarTop = top + MOBILE_GAP + (actionPanel ? Math.max(FOLDED_PANEL_HEIGHT, cell) + MOBILE_GAP : 0)
  // Fit zoom against a stable viewport with room for the full touch HUD.
  const referenceHeight = Math.min(height, host.smallViewportHeight || height)
  const referenceUsable = referenceHeight - GUTTER
  const fitHeight = portrait ? Math.max(1, referenceUsable - barHeight - MOBILE_SPELL_HEIGHT
    - Math.min(referenceUsable * 0.22, PORTRAIT_STATS_ROWS * statsRow + MOBILE_GAP)
    - portraitMessageRows(referenceUsable) * text.ch - 2 * MOBILE_GAP) : referenceHeight
  const logTop = portrait ? viewHeight : top + MOBILE_GAP
  const dpadShare = portrait ? Math.min(148, (usableWidth - GUTTER) * 0.44) : MIN_DPAD_WIDTH
  const dpadWidth = Math.max(MIN_DPAD_WIDTH, Math.floor(dpadShare))
  const commandLeft = portrait ? Math.max(left + dpadWidth + GUTTER, right - MAX_COMMAND_WIDTH) : Math.max(statLeft, right - MAX_COMMAND_WIDTH)
  const commandColumns = right - commandLeft >= MIN_FOUR_COMMANDS_WIDTH ? 4 : 3
  const commandWidth = (right - commandLeft - (commandColumns - 1) * MOBILE_GAP) / commandColumns
  const rect = (x: number, y: number, w: number, h: number) => ({
    x: (x - grid.ox) / grid.cw, y: (y - grid.oy) / grid.ch, w: Math.max(0, w) / grid.cw, h: Math.max(0, h) / grid.ch,
  })
  const view = rect(0, 0, dungeonRight, viewHeight)
  const cells: GameLayout = {
    view,
    band: rect(0, 0, 0, 0),
    clear: portrait ? view : rect(0, top, dungeonRight, height - top),
    messages: rect(left, logTop, messageWidth, messageHeight),
    stats: rect(statLeft, sheetTop, statWidth, statsHeight),
    sidebar: portrait
      ? rect(left, portraitSidebarTop, Math.min(panelWidth, minimap && monsters ? usableWidth - 88 : Math.min(180, usableWidth / 2)), Math.min(mapHeight, Math.max(0, viewHeight - portraitSidebarTop), viewHeight / 3))
      : rect(statLeft, top + statsHeight, statWidth, contentBottom - top - statsHeight - MOBILE_GAP),
  }
  const chatHeight = chatCaptionHeight(grid.ch)
  // Keep room for the map and at least two monster rows when chat shares the sidebar.
  const sidebarContentHeight = minimap ? 2 * MONSTER_ROW : monsters ? MONSTER_ROW : 0
  const sidebarChatHeight = !portrait && cells.sidebar.h * grid.ch >= sidebarContentHeight + chatHeight
    ? chatHeight : 0
  const launcherLeft = left + dpadWidth + MOBILE_GAP
  const chatLauncher = !portrait && !sidebarChatHeight ? {
    left: launcherLeft, top, width: dungeonRight - GUTTER - launcherLeft, height: bottom - top,
  } : null
  return {
    cells, portrait, fitHeight, text, statsFont, statsRow, statsCols, messageCols, lines,
    left, right, bottom, barTop, dpadWidth, commandLeft, commandColumns, commandWidth, spellsBesideEscape,
    sidebarChatHeight, chatLauncher, actionPanel, controlsLeft,
    interactBottom: portrait ? barTop - viewHeight + 6 : MOBILE_GAP,
    spellTop, spellLeft: statLeft, spellWidth: statWidth - (spellsBesideEscape ? commandWidth + MOBILE_GAP : 0),
  }
}
