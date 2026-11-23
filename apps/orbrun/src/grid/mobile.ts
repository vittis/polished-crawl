import { TOUCH_BUTTON_H, type GameLayout } from './console'
import type { GridHost } from './host'

export const MOBILE_GAP = 4
export const MOBILE_SPELL_HEIGHT = TOUCH_BUTTON_H + MOBILE_GAP
const GUTTER = 8
const MONSTER_ROW = 32
const CORNER_CONTROL_SIZE = 32
const PORTRAIT_STATS_ROWS = 7
const MIN_DPAD_WIDTH = 3 * TOUCH_BUTTON_H + 2 * MOBILE_GAP
const MIN_FOUR_COMMANDS_WIDTH = 4 * TOUCH_BUTTON_H + 3 * MOBILE_GAP
const MIN_CONTEXT_WIDTH = 5 * TOUCH_BUTTON_H + 4 * MOBILE_GAP

export type MobileDungeon = ReturnType<typeof mobileDungeonLayout>

function portraitMessageRows(height: number) {
  return Math.max(2, Math.floor(height / 145))
}

/** The viewport and HUD share the phone's usable space in CSS pixels. */
export function mobileDungeonLayout(host: GridHost, portrait: boolean, stats: boolean, monsters: boolean, minimap: boolean, touch: boolean, msgRows: number, spellHeight: number, characterScale: number, fullscreen: boolean) {
  const { width, height, insets, grid } = host
  const left = insets.left + GUTTER
  const right = width - insets.right - GUTTER
  const top = insets.top
  const bottom = height - Math.max(GUTTER, insets.bottom + MOBILE_GAP)
  const usableWidth = right - left
  const usableHeight = bottom - top
  const barHeight = TOUCH_BUTTON_H * 3 + MOBILE_GAP * 2
  const barTop = touch ? bottom - barHeight : bottom
  // The first command row only holds Escape. On short phones its unused space
  // fits the spell shortcuts and leaves room for HP, MP and monsters above.
  const spellsBesideEscape = !portrait && spellHeight > 0 && barTop - top < 125
  const contentBottom = barTop - (portrait || spellsBesideEscape ? 0 : spellHeight)
  const sideWidth = portrait ? 0 : Math.min(320, Math.max(MIN_CONTEXT_WIDTH, Math.round(usableWidth * 0.34)))
  const dungeonRight = portrait ? width : right - sideWidth - GUTTER
  const statLeft = portrait ? left : dungeonRight + GUTTER
  const statWidth = right - statLeft
  const text = host.textMetrics(portrait ? 11 : 10.5)
  const statsFont = text.fs * characterScale
  const statsRow = text.ch * characterScale
  const statsCols = Math.floor(statWidth / text.cw)
  // In landscape the map and list share one row below the scrollable character sheet.
  const sidebarHeight = minimap ? Math.min(96, (contentBottom - top) / 2) : monsters ? MONSTER_ROW : 0
  const statsRoom = portrait ? usableHeight * 0.22 : contentBottom - top - (sidebarHeight ? sidebarHeight + MOBILE_GAP : 0)
  const sheetRows = Math.max(0, Math.min(portrait ? PORTRAIT_STATS_ROWS : 8, Math.floor((statsRoom - MOBILE_GAP) / statsRow)))
  const statsHeight = stats ? sheetRows * statsRow + MOBILE_GAP : 0
  const controlsWidth = fullscreen ? 2 * CORNER_CONTROL_SIZE + MOBILE_GAP : CORNER_CONTROL_SIZE
  const statsHeader = portrait ? undefined : {
    rows: Math.ceil(CORNER_CONTROL_SIZE / statsRow),
    cols: Math.max(1, Math.floor((statWidth - controlsWidth) / (text.cw * characterScale))),
  }
  const messageWidth = (portrait ? right : dungeonRight - GUTTER) - left
  const messageCols = Math.floor(messageWidth / text.cw)
  const lines = Math.min(msgRows, portrait ? portraitMessageRows(usableHeight) : 3)
  const messageHeight = stats ? lines * text.ch : 0
  const sheetTop = portrait ? barTop - statsHeight - MOBILE_GAP : top
  const spellTop = portrait ? sheetTop - spellHeight : spellsBesideEscape ? barTop : contentBottom
  const viewHeight = portrait ? Math.max(1, spellTop - messageHeight - (stats ? MOBILE_GAP : 0)) : height
  // Fit zoom against a stable viewport with room for the full touch HUD.
  const referenceHeight = Math.min(height, host.smallViewportHeight || height)
  const referenceUsable = referenceHeight - GUTTER
  const fitHeight = portrait ? Math.max(1, referenceUsable - barHeight - MOBILE_SPELL_HEIGHT
    - Math.min(referenceUsable * 0.22, PORTRAIT_STATS_ROWS * statsRow + MOBILE_GAP)
    - portraitMessageRows(referenceUsable) * text.ch - 2 * MOBILE_GAP) : referenceHeight
  const logTop = portrait ? viewHeight : top + MOBILE_GAP
  const dpadShare = portrait ? Math.min(148, (usableWidth - GUTTER) * 0.44) : MIN_DPAD_WIDTH
  const dpadWidth = Math.max(MIN_DPAD_WIDTH, Math.floor(dpadShare))
  const commandLeft = portrait ? left + dpadWidth + GUTTER : statLeft
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
      ? rect(left, top + MOBILE_GAP, Math.min(usableWidth - controlsWidth, minimap && monsters ? usableWidth - 88 : Math.min(180, usableWidth / 2)), Math.min(96, viewHeight / 3))
      : rect(statLeft, top + statsHeight, statWidth, contentBottom - top - statsHeight - MOBILE_GAP),
  }
  return {
    cells, portrait, fitHeight, text, statsFont, statsRow, statsCols, statsHeader, messageCols, lines,
    left, right, bottom, barTop, dpadWidth, commandLeft, commandColumns,
    interactBottom: portrait ? barTop - viewHeight + 6 : MOBILE_GAP,
    spellTop, spellLeft: statLeft, spellWidth: statWidth - (spellsBesideEscape ? commandWidth + MOBILE_GAP : 0),
  }
}
