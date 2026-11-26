import { h } from './dom'
import { defaultSettings, getSettings, saveSettings } from './settings'
import { TOUCH_SIZE_ROWS } from './settings-rows'
import { TILE_POSITIONS, type Arrangement } from './touch-arrangement'

/** Sizing belongs to the device. Commit only edited fields when the layout dialog is saved. */
export function touchLayoutSizing(arrangement: () => Arrangement, autoPercent: () => number) {
  const initial = getSettings()
  const draft = { touchMovementPercent: initial.touchMovementPercent, touchControlHeight: initial.touchControlHeight }
  const movement = h('div', { class: 'size-bank movement-bank' }, ...Array.from({ length: 9 }, () => h('i')))
  const actions = h('div', { class: 'size-bank' })
  const diagram = h('div', { class: 'size-diagram', 'aria-hidden': 'true' },
    h('span', null, 'Movement'), h('span', null, 'Actions'), movement, actions)
  const panel = h('section', { class: 'layout-sizing', id: 'touch-layout-sizing', 'aria-label': 'Control size', hidden: true }, diagram)
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
  function refresh() {
    for (const draw of drawControls) draw()
    const share = draft.touchMovementPercent || autoPercent()
    diagram.style.gridTemplateColumns = share + 'fr ' + (100 - share) + 'fr'
    diagram.style.setProperty('--size-row', (16 * draft.touchControlHeight) + 'px')
    actions.replaceChildren(...TILE_POSITIONS[arrangement()].map(({row, col, size}) =>
      h('i', { style: { gridArea: row + ' / ' + col + ' / span ' + size + ' / span ' + size } })))
  }
  return {
    panel, refresh,
    reset() {
      for (const {key} of TOUCH_SIZE_ROWS) draft[key] = defaultSettings[key]
      refresh()
    },
    save() {
      const changed = TOUCH_SIZE_ROWS.filter(({key}) => draft[key] !== initial[key])
      if (!changed.length) return false
      const current = getSettings()
      for (const {key} of changed) current[key] = draft[key]
      saveSettings(current)
      return true
    },
  }
}
