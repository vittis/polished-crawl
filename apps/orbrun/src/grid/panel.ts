/**
 * Where the consumables action panel (action_panel.js) stands and how its
 * cells are laid out.
 *
 * The official client floats the panel over the top-left corner of
 * `#dungeon`, where Polished Crawl's stats pane already is. Polished Crawl stands it in the
 * strip along the top of the view between the stats pane and the minimap:
 * the one place at the top of the screen no pane holds, so the panel reads
 * as part of the same row of HUD furniture and the view under it stays
 * clear. Nothing here touches the DOM; the HUD (hud.ts `renderActionPanel`)
 * draws what this places, so the arithmetic can be pinned by tests.
 */

export interface PanelBox {
  left: number
  top: number
  width: number
  height: number
}

/** The action panel's cell before `action_panel_scale`. */
export const PANEL_CELL = 32
/** Combined width or height of the two 2px frame edges. */
export const PANEL_FRAME = 4
/** the least the strip may be for the panel to stand in it at all: one cell plus the gutters */
const PANEL_MIN_CELLS = 2

export function panelScale(percent: unknown): number {
  return typeof percent === 'number' && Number.isFinite(percent) && percent > 0 ? percent / 100 : 1
}

/**
 * The strip the panel stands in, in css px: along the top of the free view,
 * from the stats pane's right edge to the minimap's left edge, a `gutter`
 * clear of both. `statsRight` is null when the stats pane has stepped aside
 * (the level map, the new-game chooser) and `minimapLeft` is null when the
 * sidebar has; then the strip runs to the free view's own edge. A strip
 * narrower than `PANEL_MIN_CELLS` cells is no strip: the panel has nowhere
 * to stand and gets zero width, which folds it away.
 */
export function panelSpan(
  free: PanelBox,
  statsRight: number | null,
  minimapLeft: number | null,
  gutter: number,
  cell: number,
): PanelBox {
  const left = Math.max(free.left, statsRight === null ? free.left : statsRight + gutter)
  const right = Math.min(free.left + free.width, minimapLeft === null ? free.left + free.width : minimapLeft - gutter)
  const width = right - left
  if (width < PANEL_MIN_CELLS * cell) return { left, top: free.top, width: 0, height: 0 }
  return { left, top: free.top, width, height: Math.max(0, free.height) }
}

export interface PanelGrid {
  /** cells across and down the panel */
  cols: number
  rows: number
  count: number
}

/** Horizontal shortcuts occupy one scrollable row. Vertical orientation fills columns up to the available height. */
export function panelGrid(count: number, cell: number, span: { height: number }, horizontal: boolean): PanelGrid {
  const rows = horizontal ? 1 : Math.max(1, Math.min(count, Math.floor(span.height / cell)))
  return { cols: Math.max(1, Math.ceil(count / rows)), rows, count }
}

/** The top-left corner of cell `i`, in panel px: horizontal fills a line at a time, vertical a column at a time. */
export function panelCellAt(i: number, grid: PanelGrid, cell: number, horizontal: boolean): { x: number; y: number } {
  const col = horizontal ? i % grid.cols : Math.floor(i / grid.rows)
  const row = horizontal ? Math.floor(i / grid.cols) : i % grid.rows
  return { x: col * cell, y: row * cell }
}

/** Which cell of the panel a point `x`, `y` px from its top-left corner is in, or -1 when it is past the last one. */
export function panelCellIndex(x: number, y: number, grid: PanelGrid, cell: number, horizontal: boolean): number {
  if (x < 0 || y < 0 || cell <= 0) return -1
  const col = Math.floor(x / cell)
  const row = Math.floor(y / cell)
  if (col >= grid.cols || row >= grid.rows) return -1
  const i = horizontal ? row * grid.cols + col : col * grid.rows + row
  return i < grid.count ? i : -1
}
