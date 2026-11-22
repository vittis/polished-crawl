import { TOUCH_BUTTON_H, type GameLayout } from './console'
import type { GridHost } from './host'

export const MOBILE_GAP = 4
const GUTTER = 8
const MONSTER_ROW = 32
const MIN_DPAD_WIDTH = 3 * TOUCH_BUTTON_H + 2 * MOBILE_GAP
const MIN_FOUR_COMMANDS_WIDTH = 4 * TOUCH_BUTTON_H + 3 * MOBILE_GAP
const MIN_CONTEXT_WIDTH = 5 * TOUCH_BUTTON_H + 4 * MOBILE_GAP

export type MobileDungeon = ReturnType<typeof mobileDungeonLayout>

/** The viewport and HUD share the phone's usable space in CSS pixels. */
export function mobileDungeonLayout(host: GridHost, portrait: boolean, stats: boolean, monsters: boolean, touch: boolean, msgRows: number, spellHeight: number, characterScale: number) {
  const { width, height, insets, grid } = host
  const left = insets.left + GUTTER
  const right = width - insets.right - GUTTER
  const top = insets.top
  const bottom = height - Math.max(GUTTER, insets.bottom + MOBILE_GAP)
  const usableWidth = right - left
  const usableHeight = bottom - top
  const barHeight = TOUCH_BUTTON_H * 3 + MOBILE_GAP * 2
  const barTop = touch ? bottom - barHeight : bottom
  const sideWidth = portrait ? 0 : Math.min(320, Math.max(MIN_CONTEXT_WIDTH, Math.round(usableWidth * 0.34)))
  const dungeonRight = portrait ? width : right - sideWidth - GUTTER
  const statLeft = portrait ? left : dungeonRight + GUTTER
  const statWidth = right - statLeft
  const text = host.textMetrics(portrait ? 11 : 10.5)
  const statsFont = text.fs * characterScale
  const statsRow = text.ch * characterScale
  const statsCols = Math.floor(statWidth / text.cw)
  const statsRoom = portrait ? usableHeight * 0.22 : barTop - top - (monsters ? MONSTER_ROW + GUTTER : 0)
  const sheetRows = Math.max(0, Math.min(8, Math.floor((statsRoom - MOBILE_GAP) / statsRow)))
  const statsHeight = stats ? sheetRows * statsRow + MOBILE_GAP : 0
  const messageWidth = (portrait ? right : dungeonRight - 40) - left
  const messageCols = Math.floor(messageWidth / text.cw)
  const lines = Math.min(msgRows, portrait ? Math.max(2, Math.floor(usableHeight / 145)) : 3)
  const messageHeight = stats ? lines * text.ch : 0
  const sheetTop = portrait ? barTop - spellHeight - statsHeight - MOBILE_GAP : top
  const viewHeight = portrait ? Math.max(1, sheetTop - messageHeight - (stats ? MOBILE_GAP : 0)) : height
  const logTop = portrait ? viewHeight : top + MOBILE_GAP
  const dpadShare = portrait ? Math.min(148, (usableWidth - GUTTER) * 0.44) : MIN_DPAD_WIDTH
  const dpadWidth = Math.max(MIN_DPAD_WIDTH, Math.floor(dpadShare))
  const commandLeft = portrait ? left + dpadWidth + GUTTER : statLeft
  const commandColumns = right - commandLeft >= MIN_FOUR_COMMANDS_WIDTH ? 4 : 3
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
      ? rect(right - Math.min(180, usableWidth / 2), top + 42, Math.min(180, usableWidth / 2), Math.min(96, viewHeight / 3))
      : rect(statLeft, top + statsHeight, statWidth, barTop - top - statsHeight - MOBILE_GAP),
  }
  return {
    cells, portrait, text, statsFont, statsRow, statsCols, messageCols, lines,
    left, right, bottom, barTop, dpadWidth, commandLeft, commandColumns,
    interactBottom: portrait ? barTop - viewHeight + 6 : spellHeight + MOBILE_GAP,
    spellLeft: portrait ? left : left + dpadWidth + GUTTER,
    spellRight: portrait ? right : dungeonRight - MOBILE_GAP,
  }
}
