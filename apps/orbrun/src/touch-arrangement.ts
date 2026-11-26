// The two lower 2×2 regions can each be one large shortcut or four small ones.
// Slot indexes stay fixed so splitting and joining a region preserves assignments.
export const ARRANGEMENTS = { pair: 'Two large', left: 'Large left', right: 'Large right', grid: 'All small' } as const
export type Arrangement = keyof typeof ARRANGEMENTS
export const SLOT_CELLS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9', 'slot10', 'slot11', 'slot12'] as const

interface Position { index: number; row: number; col: number; size: number; label: string }
const columns = ['left', 'middle left', 'middle right', 'right']
const cells = [[0, 1, 2, 3], [4, 6, 5, 9], [7, 8, 10, 11]]
function positions(largeLeft: boolean, largeRight: boolean): Position[] {
  const result: Position[] = []
  cells.forEach((line, r) => line.forEach((index, c) => {
    const large = r > 0 && (c < 2 ? largeLeft : largeRight)
    if (large && (r === 2 || c % 2 === 1)) return
    const label = large ? (c === 0 ? 'Bottom left' : 'Bottom right') :
      ['Top', 'Middle', 'Bottom'][r] + ' ' + columns[c]
    result.push({ index, row: r + 1, col: c + 1, size: large ? 2 : 1, label })
  }))
  return result
}
export const TILE_POSITIONS: Record<Arrangement, readonly Position[]> = {
  pair: positions(true, true), left: positions(true, false), right: positions(false, true), grid: positions(false, false),
}
