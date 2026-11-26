import type { TouchControlSpace } from './grid/mobile'
import type { TouchCell } from './bindings'
import { touchLayoutSizing } from './touch-layout-sizing'
import { touchShortcutIcon } from './touch-shortcut-icon'
import { h } from './dom'
import { ARRANGEMENTS, SLOT_CELLS, TILE_POSITIONS, type Arrangement } from './touch-arrangement'
import { BUILTIN_PRESETS, defaultShortcutHold, deleteTouchPreset, SHORTCUTS, sameTouchLayout, shortcutHold, showsQuiveredArt, loadTouchPresets, saveTouchPreset, type TouchLayout } from './touch-shortcuts'

/** A draft belongs to this dialog. The game sees it only when Save is pressed. */
export function editTouchLayout(host: HTMLElement, current: TouchLayout, renderTile: (button: HTMLElement, id: string, cell: TouchCell, hold?: string | null) => void, controlSpace: () => TouchControlSpace | undefined, save: (layout: TouchLayout, sizingChanged: boolean) => void) {
  const draft = [...current.slots]
  let holds = { ...current.holds }
  let arrangement = current.arrangement
  const snapshot = (): TouchLayout => ({ slots: [...draft], arrangement, ...(Object.keys(holds).length && { holds: { ...holds } }) })
  let selected = 0
  let editingHold = false
  const selectedHold = () => shortcutHold({ slots: draft, arrangement, holds }, selected)
  const dialog = h('dialog', { class: 'touch-layout-editor', 'aria-label': 'Edit touch layout' })
  const preview = h('div', { class: 'layout-preview', role: 'group', 'aria-label': 'Button positions' })
  const search = h('input', { id: 'touch-layout-search', type: 'search', placeholder: 'Search actions', 'aria-label': 'Search actions', autocomplete: 'off' })
  const list = h('div', { class: 'layout-options', 'aria-label': 'Available actions', role: 'group' })
  function actionToggle(hold: boolean) {
    const value = h('span', { class: 'assignment-value' })
    const icon = h('span', { class: 'assignment-icon' })
    const label = hold ? 'Hold action' : 'Tap action'
    const button = h('button', { type: 'button', 'aria-label': label, onclick: () => {
      if (editingHold === hold) return
      editingHold = hold
      search.value = ''
      refresh()
      list.scrollTop = 0
    } }, icon, label, value)
    return { button, value, icon }
  }
  const tapToggle = actionToggle(false)
  const holdToggle = actionToggle(true)
  const assignments = h('div', { class: 'layout-assignments', role: 'group', 'aria-label': 'Selected tile actions' }, tapToggle.button, holdToggle.button)
  const status = h('p', { class: 'preset-status', role: 'status' })
  let savedPresets = loadTouchPresets()
  const choices = () => [
    ...BUILTIN_PRESETS.map(preset => ({ value: preset.name, preset })),
    ...savedPresets.map(preset => ({ value: 'personal:' + preset.name, preset })),
  ]
  const presetSelect = h('select', { 'aria-label': 'Layout preset' })
  const nameInput = h('input', { type: 'text', placeholder: 'Preset name', 'aria-label': 'Preset name', autocomplete: 'off', maxlength: 48 })
  const presetError = h('p', { class: 'preset-error', role: 'alert', hidden: true })
  const nameForm = h('form', { class: 'preset-row', hidden: true }, nameInput,
    h('button', { type: 'submit' }, 'Save preset'),
    h('button', { type: 'button', 'aria-label': 'Cancel naming preset', onclick: () => finishNaming() }, '×'))
  const saveAs = h('button', { type: 'button', onclick: () => {
    presetRow.hidden = true
    nameForm.hidden = false
    nameInput.value = ''
    nameInput.focus()
  } }, 'Save as preset…')
  const remove = h('button', { type: 'button', class: 'preset-delete', title: 'Delete saved preset', 'aria-label': 'Delete saved preset', onclick: () => {
    const name = savedPresets.find(p => 'personal:' + p.name === presetSelect.value)?.name
    if (!name) return
    if (!window.confirm('Delete the saved preset “' + name + '”?')) return
    try {
      deleteTouchPreset(name)
      savedPresets = loadTouchPresets()
      populatePresets()
      refresh()
      status.textContent = 'Deleted preset “' + name + '”.'
      presetSelect.focus()
    } catch (error) {
      presetError.textContent = (error as Error).message
      presetError.hidden = false
    }
  } }, h('span', { 'aria-hidden': 'true', class: 'preset-trash' }))
  const presetRow = h('div', { class: 'preset-row' }, h('label', null, 'Preset', presetSelect), saveAs, remove)

  function finishNaming() {
    nameForm.hidden = true
    presetRow.hidden = false
    presetError.hidden = true
    const nextFocus = saveAs.hidden ? presetSelect : saveAs
    nextFocus.focus({ preventScroll: true })
  }
  function populatePresets() {
    const group = (label: string, items: typeof savedPresets, prefix = '') => h('optgroup', { label },
      items.map(p => h('option', { value: prefix + p.name }, p.name)))
    presetSelect.replaceChildren(h('option', { value: '', disabled: true }, 'Custom layout'),
      group('Built-in', [...BUILTIN_PRESETS]))
    if (savedPresets.length) presetSelect.append(group('My presets', savedPresets, 'personal:'))
  }
  function applyLayout(layout: TouchLayout) {
    draft.splice(0, draft.length, ...layout.slots)
    holds = { ...layout.holds }
    arrangement = layout.arrangement
    showPositions()
    search.value = ''
    refresh()
    list.scrollTop = 0
  }
  presetSelect.addEventListener('change', () => {
    const choice = choices().find(p => p.value === presetSelect.value)
    if (choice) applyLayout(choice.preset)
  })
  nameForm.addEventListener('submit', ev => {
    ev.preventDefault()
    try {
      const saved = saveTouchPreset(nameInput.value, snapshot())
      savedPresets = loadTouchPresets()
      populatePresets()
      presetSelect.value = 'personal:' + saved.name
      refresh()
      status.textContent = 'Saved preset “' + saved.name + '”.'
    } catch (error) {
      presetError.textContent = (error as Error).message
      presetError.hidden = false
      nameInput.focus()
    }
  })
  dialog.addEventListener('cancel', ev => {
    if (nameForm.hidden) return
    ev.preventDefault()
    finishNaming()
  })
  populatePresets()
  const slotButtons = SLOT_CELLS.map((_, i) => h('button', { type: 'button', class: 'tb', onclick: () => {
    selected = i
    search.value = ''
    refresh()
    list.scrollTop = 0
  }}))
  const patterns = h('div', { class: 'tile-patterns', role: 'group', 'aria-label': 'Tile arrangement' })
  for (const shape of Object.keys(ARRANGEMENTS) as Arrangement[]) {
    const diagram = h('span', { class: 'pattern-diagram', 'aria-hidden': 'true' })
    for (const p of TILE_POSITIONS[shape]) diagram.append(h('i', { style: { gridArea: area(p) } }))
    patterns.append(h('button', { type: 'button', 'data-shape': shape, 'aria-label': ARRANGEMENTS[shape], title: ARRANGEMENTS[shape], onclick: () => {
      arrangement = shape
      showPositions()
      refresh()
    } }, diagram))
  }
  function area(p: { row: number; col: number; size: number }) {
    return p.row + ' / ' + p.col + ' / span ' + p.size + ' / span ' + p.size
  }
  function showPositions() {
    const positions = TILE_POSITIONS[arrangement]
    if (!positions.some(p => p.index === selected)) selected = selected <= 8 ? 4 : 5
    preview.replaceChildren(...positions.map(p => {
      const button = slotButtons[p.index]
      button.style.gridArea = area(p)
      return button
    }))
    for (const button of patterns.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.shape === arrangement))
  }
  showPositions()

  // Tapping works one-handed. Dragging swaps slots directly without visiting the list.
  let drag: { from: number; pointer: number; x: number; y: number; moved: boolean } | null = null
  function dropIndex(ev: PointerEvent) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('button')
    return slotButtons.findIndex(b => b === hit)
  }
  let suppressClick = false
  function swapSlots(from: number, to: number) {
    const tap = draft[from]
    const hold = holds[from]
    draft[from] = draft[to]
    draft[to] = tap
    setHold(from, holds[to])
    setHold(to, hold)
  }
  function setHold(index: number, id: string | null | undefined) {
    if (id === undefined) delete holds[index]
    else holds[index] = id
  }
  preview.addEventListener('pointerdown', ev => {
    const from = slotButtons.indexOf((ev.target as Element).closest('button')!)
    if (from < 0 || drag || ev.button !== 0) return
    suppressClick = false
    drag = { from, pointer: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false }
    slotButtons[from].setPointerCapture(ev.pointerId)
  })
  preview.addEventListener('pointermove', ev => {
    if (!drag || drag.pointer !== ev.pointerId) return
    if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 6) drag.moved = true
    if (!drag.moved) return
    const to = dropIndex(ev)
    const from = drag.from
    slotButtons.forEach((button, i) => button.classList.toggle('drop-target', i === to && i !== from))
  })
  preview.addEventListener('click', ev => {
    if (suppressClick && ev.detail) ev.stopImmediatePropagation()
    suppressClick = false
  }, true)
  function endDrag(ev: PointerEvent) {
    if (!drag || drag.pointer !== ev.pointerId) return
    const { from, moved } = drag
    drag = null
    suppressClick = moved
    slotButtons.forEach(button => button.classList.remove('drop-target'))
    if (!moved || ev.type !== 'pointerup') return
    const to = dropIndex(ev)
    if (to < 0 || to === from) return
    swapSlots(from, to)
    selected = to
    search.value = ''
    refresh()
    slotButtons[to].focus({ preventScroll: true })
  }
  preview.addEventListener('pointerup', endDrag)
  preview.addEventListener('pointercancel', endDrag)
  preview.addEventListener('lostpointercapture', endDrag)

  function actionGroups(visible: string[]): Record<string, readonly string[]> {
    const groups: Record<string, string[]> = { 'On your layout': visible }
    for (const { id, group } of SHORTCUTS.values()) {
      if (!visible.includes(id)) (groups[group] ??= []).push(id)
    }
    return groups
  }
  const quiverOptionIcons = new Map<string, HTMLElement>()
  const quiverSample = h('span')
  function actionIcon(id: string) {
    if (showsQuiveredArt(id)) {
      renderTile(quiverSample, id, SLOT_CELLS[selected], null)
      const readied = quiverSample.querySelector('canvas')
      if (readied) return readied
    }
    return touchShortcutIcon(id)
  }
  function optionIcon(id: string) {
    const icon = h('span', { class: 'option-icon' }, actionIcon(id))
    if (showsQuiveredArt(id)) quiverOptionIcons.set(id, icon)
    return icon
  }
  function showOptions() {
    quiverOptionIcons.clear()
    const query = search.value.trim().toLowerCase()
    const groups = new Map<string, HTMLElement[]>()
    const visible = TILE_POSITIONS[arrangement].map(p => draft[p.index])
    const hold = selectedHold()
    const choose = (id: string | null, from: number) => {
      if (editingHold) setHold(selected, id === defaultShortcutHold(draft[selected]) ? undefined : id)
      else if (from >= 0) swapSlots(from, selected)
      else if (id) draft[selected] = id
      refresh()
      const target = editingHold ? holdToggle.button : slotButtons[selected]
      target.focus({ preventScroll: true })
    }
    const available = editingHold && hold && !visible.includes(hold) ? [...visible, hold] : visible
    for (const [group, ids] of Object.entries(actionGroups(available))) {
      for (const id of ids) {
        const from = draft.indexOf(id)
        const s = SHORTCUTS.get(id)!
        if (query && ![s.label, s.aliases, group, s.key, s.group].some(v => v?.toLowerCase().includes(query))) continue
        const selectedOption = editingHold ? hold === id : from === selected
        const assigned = !editingHold && visible.includes(id)
        const right = selectedOption ? 'Selected' : assigned ? 'Swap' : s.key || ''
        const button = h('button', { type: 'button', disabled: selectedOption, onclick: () => choose(id, from) }, optionIcon(id), h('span', null, s.label), h(assigned || selectedOption ? 'small' : 'kbd', null, right))
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group)!.push(button)
      }
    }
    const sections = [...groups]
    list.replaceChildren(...sections.map(([group, options]) => h('section', null, h('h3', null, group), options)))
    if (!sections.length) list.append(h('p', null, 'No matching actions.'))
    if (editingHold) list.prepend(h('button', { type: 'button', class: 'clear-hold', disabled: hold === null, onclick: () => choose(null, -1) }, optionIcon('no-hold'), 'No hold action'))
  }
  function paintSlots(include: (id: string) => boolean = () => true) {
    TILE_POSITIONS[arrangement].forEach(({ index: i, label, size }) => {
      if (!include(draft[i])) return
      const button = slotButtons[i]
      const s = SHORTCUTS.get(draft[i])!
      renderTile(button, s.id, SLOT_CELLS[i], holds[i])
      button.classList.toggle('primary-slot', size > 1)
      button.setAttribute('aria-pressed', String(i === selected))
      button.setAttribute('aria-label', label + ', ' + s.label)
    })
  }
  function refresh() {
    const layout = snapshot()
    const matches = choices().filter(({ preset }) => sameTouchLayout(preset, layout))
    saveAs.hidden = matches.length > 0
    if (saveAs.hidden && !nameForm.hidden) finishNaming()
    if (!matches.some(p => p.value === presetSelect.value)) presetSelect.value = matches[0]?.value ?? ''
    remove.hidden = !presetSelect.value.startsWith('personal:')
    const hold = selectedHold()
    tapToggle.icon.replaceChildren(actionIcon(draft[selected]))
    holdToggle.icon.replaceChildren(actionIcon(hold ?? 'no-hold'))
    tapToggle.value.textContent = SHORTCUTS.get(draft[selected])!.label
    holdToggle.value.textContent = hold ? SHORTCUTS.get(hold)!.label : 'None'
    for (const { button, value } of [tapToggle, holdToggle]) button.setAttribute('aria-description', value.textContent)
    tapToggle.button.setAttribute('aria-pressed', String(!editingHold))
    holdToggle.button.setAttribute('aria-pressed', String(editingHold))
    paintSlots()
    status.textContent = ''
    showOptions()
  }

  const close = () => dialog.close()
  const sizing = touchLayoutSizing(() => arrangement, controlSpace)
  const workspace = h('div', { class: 'layout-workspace' },
    h('div', { class: 'layout-slots' }, presetRow, nameForm, presetError, patterns, h('p', { class: 'layout-help' }, 'Tap a slot to assign an action. Drag to swap slots.'), preview, status),
    h('div', { class: 'layout-picker' }, assignments, search, list))
  const restore = h('button', { type: 'button', onclick: () => {
    if (!sizing.panel.hidden) return sizing.reset()
    presetSelect.value = 'Default'
    applyLayout(BUILTIN_PRESETS[0])
  } }, 'Restore defaults')
  const sizeToggle = h('button', { type: 'button', class: 'size-toggle', 'aria-controls': sizing.panel.id, 'aria-expanded': 'false', onclick: () => {
    const opening = sizing.panel.hidden
    if (!nameForm.hidden) finishNaming()
    sizing.panel.hidden = !opening
    workspace.hidden = opening
    if (opening) sizing.refresh()
    sizeToggle.setAttribute('aria-expanded', String(opening))
    sizeToggle.textContent = opening ? 'Edit tiles' : 'Control size'
    restore.textContent = opening ? 'Reset size' : 'Restore defaults'
  } }, 'Control size')
  dialog.append(
    h('header', null, h('h2', null, 'Edit touch layout'), sizeToggle, h('button', { type: 'button', 'aria-label': 'Cancel changes', onclick: close }, '×')),
    workspace, sizing.panel,
    h('footer', null, restore, h('button', { type: 'button', class: 'layout-save', onclick: () => { save(snapshot(), sizing.save()); close() } }, 'Save layout')),
  )
  const filterOptions = () => { showOptions(); list.scrollTop = 0 }
  search.addEventListener('input', filterOptions)
  const viewport = window.visualViewport
  function fitKeyboard() {
    if (!viewport) return
    // Mobile browsers can overlay the keyboard without changing the layout viewport.
    const cover = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    dialog.style.setProperty('--keyboard-cover', cover + 'px')
    dialog.style.setProperty('--viewport-top', viewport.offsetTop + 'px')
    dialog.classList.toggle('typing', cover > 80)
  }
  viewport?.addEventListener('resize', fitKeyboard)
  viewport?.addEventListener('scroll', fitKeyboard)
  fitKeyboard()
  dialog.addEventListener('close', () => {
    viewport?.removeEventListener('resize', fitKeyboard)
    viewport?.removeEventListener('scroll', fitKeyboard)
    dialog.remove()
  }, { once: true })
  host.append(dialog)
  refresh()
  dialog.showModal()
  slotButtons[0].focus({ preventScroll: true })
  return {
    dialog,
    refreshSize() {
      if (!sizing.panel.hidden) sizing.refresh()
    },
    refreshQuiveredArt() {
      paintSlots(showsQuiveredArt)
      for (const [id, icon] of quiverOptionIcons) icon.replaceChildren(actionIcon(id))
      const tap = draft[selected]
      const hold = selectedHold()
      if (showsQuiveredArt(tap)) tapToggle.icon.replaceChildren(actionIcon(tap))
      if (hold && showsQuiveredArt(hold)) holdToggle.icon.replaceChildren(actionIcon(hold))
    },
  }
}
