import { isPhone, viewportMetrics } from './grid/host'
import { resolveLayout } from './grid/layout'
import { MOBILE_GAP, mobileControlSpace, touchBankWidths, touchRowHeight, type TouchControlSpace } from './grid/mobile'
import { h } from './dom'
import { defaultSettings, getSettings, saveSettings } from './settings'
import { TOUCH_SIZE_ROWS } from './settings-rows'
import { TILE_POSITIONS, type Arrangement } from './touch-arrangement'

/** Sizing belongs to the device. Commit only edited fields when the layout dialog is saved. */
export function touchLayoutSizing(arrangement: () => Arrangement, controlSpace: () => TouchControlSpace | undefined) {
  const initial = getSettings()
  const draft = { touchMovementWidth: initial.touchMovementWidth, touchActionsWidth: initial.touchActionsWidth, touchControlHeight: initial.touchControlHeight }
  const movement = h('div', { class: 'size-bank movement-bank' }, ...Array.from({ length: 9 }, () => h('i')))
  const actions = h('div', { class: 'size-bank' })
  const movementLabel = h('span', {class: 'movement-caption'}, 'Movement')
  const actionsLabel = h('span', {class: 'actions-caption'}, 'Actions')
  const diagram = h('div', { class: 'size-diagram' }, movementLabel, actionsLabel, movement, actions)
  const panel = h('section', { class: 'layout-sizing', id: 'touch-layout-sizing', hidden: true }, diagram)
  const drawControls = TOUCH_SIZE_ROWS.map(row => {
    const input = h('input', { type: 'range', min: 0, max: row.values.length - 1, step: 1, 'aria-label': row.label })
    const readout = h('span', { class: 'size-value' })
    panel.append(h('label', { class: 'size-control' }, h('span', null, row.label), readout, input))
    input.addEventListener('input', () => {
      draft[row.key] = row.values[input.valueAsNumber]
      refresh()
    })
    return () => {
      const value = draft[row.key]
      const text = row.fmt(value)
      input.valueAsNumber = row.values.reduce((best, v, i) => Math.abs(v - value) < Math.abs(row.values[best] - value) ? i : best, 0)
      input.setAttribute('aria-valuetext', text)
      readout.textContent = text
    }
  })
  const swap = h('input', { type: 'checkbox' })
  swap.checked = initial.swapTouchControls
  swap.addEventListener('change', refresh)
  panel.append(h('label', { class: 'size-swap' }, swap, 'Swap D-pad and actions'))
  function viewportSpace() {
    const { insets } = viewportMetrics()
    const width = window.innerWidth, height = window.innerHeight
    const preset = getSettings().layoutPreset
    const layout = resolveLayout(preset === 'Desktop' ? 'Auto' : preset, true, isPhone(), width - insets.left - insets.right, height)
    return mobileControlSpace(layout === 'Desktop' ? 'Tablet landscape' : layout, width, height, insets).controlSpace
  }
  function refresh() {
    for (const draw of drawControls) draw()
    const space = controlSpace() ?? viewportSpace()
    const banks = touchBankWidths(space, draft.touchMovementWidth, draft.touchActionsWidth)
    const gap = Math.max(0, space.availableWidth - banks.movement - banks.actions)
    const percentOfDeck = (pixels: number) => 100 * pixels / space.availableWidth
    const widths = swap.checked ? [banks.actions, gap, banks.movement] : [banks.movement, gap, banks.actions]
    diagram.classList.toggle('swapped', swap.checked)
    diagram.style.gridTemplateColumns = widths.map(width => percentOfDeck(width) + '%').join(' ')
    const movementPercent = Math.round(100 * banks.movement / (banks.movement + banks.actions))
    movementLabel.textContent = space.portrait ? 'Movement · ' + movementPercent + '%' : 'Movement'
    actionsLabel.textContent = space.portrait ? 'Actions · ' + (100 - movementPercent) + '%' : 'Actions'
    diagram.style.setProperty('--size-row', percentOfDeck(touchRowHeight(space.availableHeight, draft.touchControlHeight)) + 'cqw')
    diagram.style.setProperty('--size-gap', percentOfDeck(MOBILE_GAP) + 'cqw')
    actions.replaceChildren(...TILE_POSITIONS[arrangement()].map(({row, col, size}) =>
      h('i', { style: { gridArea: row + ' / ' + col + ' / span ' + size + ' / span ' + size } })))
  }
  return {
    panel, refresh,
    reset() {
      swap.checked = defaultSettings.swapTouchControls
      for (const {key} of TOUCH_SIZE_ROWS) draft[key] = defaultSettings[key]
      refresh()
    },
    save() {
      const changed = TOUCH_SIZE_ROWS.filter(({key}) => draft[key] !== initial[key])
      const swapChanged = swap.checked !== initial.swapTouchControls
      if (!changed.length && !swapChanged) return false
      const current = getSettings()
      if (swapChanged) current.swapTouchControls = swap.checked
      for (const {key} of changed) current[key] = draft[key]
      saveSettings(current)
      return true
    },
  }
}
