import { h } from './dom'
import { BUILTIN_PRESETS, DEFAULT_SHORTCUTS, PICKER_GROUPS, SHORTCUTS, loadTouchPresets, saveTouchPreset, type Shortcut } from './touch-shortcuts'

const positions = ['Top left', 'Top middle left', 'Top middle right', 'Top right', 'Bottom left', 'Bottom right']

/** A draft belongs to this dialog. The game sees it only when Save is pressed. */
export function editTouchLayout(host: HTMLElement, current: readonly string[], picture: (s: Shortcut) => Element | null, save: (ids: string[]) => void) {
  const draft = [...current]
  let selected = 0
  const dialog = h('dialog', { class: 'touch-layout-editor', 'aria-label': 'Edit touch layout' })
  const preview = h('div', { class: 'layout-preview', role: 'group', 'aria-label': 'Button positions' })
  const search = h('input', { type: 'search', placeholder: 'Search actions', 'aria-label': 'Search actions', autocomplete: 'off' })
  const list = h('div', { class: 'layout-options', 'aria-label': 'Available actions', role: 'group' })
  const status = h('p', { class: 'layout-status', role: 'status' })
  let savedPresets = loadTouchPresets()
  const presets = () => [...BUILTIN_PRESETS, ...savedPresets]
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
  const presetRow = h('div', { class: 'preset-row' }, h('label', null, 'Preset', presetSelect), saveAs)

  function finishNaming() {
    nameForm.hidden = true
    presetRow.hidden = false
    presetError.hidden = true
    saveAs.focus({ preventScroll: true })
  }
  function populatePresets() {
    const group = (label: string, items: typeof savedPresets) => h('optgroup', { label },
      items.map(p => h('option', { value: p.name }, p.name)))
    presetSelect.replaceChildren(h('option', { value: '', disabled: true }, 'Custom layout'),
      group('Built-in', [...BUILTIN_PRESETS]))
    if (savedPresets.length) presetSelect.append(group('My presets', savedPresets))
  }
  function applyLayout(slots: readonly string[]) {
    draft.splice(0, draft.length, ...slots)
    search.value = ''
    refresh()
    list.scrollTop = 0
  }
  presetSelect.addEventListener('change', () => {
    const preset = presets().find(p => p.name === presetSelect.value)
    if (preset) applyLayout(preset.slots)
  })
  nameForm.addEventListener('submit', ev => {
    ev.preventDefault()
    try {
      const saved = saveTouchPreset(nameInput.value, draft)
      savedPresets = loadTouchPresets()
      populatePresets()
      presetSelect.value = saved.name
      finishNaming()
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
  const slotButtons = positions.map((_, i) => h('button', { type: 'button', onclick: () => {
    selected = i
    search.value = ''
    refresh()
    list.scrollTop = 0
  }}))
  preview.append(...slotButtons)

  // Tapping works one-handed. Dragging swaps slots directly without visiting the list.
  let drag: { from: number; pointer: number; x: number; y: number; moved: boolean } | null = null
  function dropIndex(ev: PointerEvent) {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('button')
    return slotButtons.findIndex(b => b === hit)
  }
  let suppressClick = false
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
    ;[draft[from], draft[to]] = [draft[to], draft[from]]
    selected = to
    search.value = ''
    refresh()
    slotButtons[to].focus({ preventScroll: true })
  }
  preview.addEventListener('pointerup', endDrag)
  preview.addEventListener('pointercancel', endDrag)
  preview.addEventListener('lostpointercapture', endDrag)

  const pickerIds = new Set(Object.values(PICKER_GROUPS).flat())
  function showOptions() {
    const query = search.value.trim().toLowerCase()
    const groups = new Map<string, HTMLElement[]>()
    const assignedExtras = draft.filter(id => !pickerIds.has(id))
    for (const [group, ids] of Object.entries({ ...PICKER_GROUPS, 'On your layout': assignedExtras })) {
      for (const id of ids) {
        const from = draft.indexOf(id)
        const s = SHORTCUTS.get(id)!
        if (query && ![s.label, s.aliases, group, s.key].some(v => v?.toLowerCase().includes(query))) continue
        const right = from === selected ? 'Selected' : from >= 0 ? 'Swap' : s.key || ''
        const button = h('button', { type: 'button', disabled: from === selected, onclick: () => {
          if (from >= 0) draft[from] = draft[selected]
          draft[selected] = s.id
          refresh()
          slotButtons[selected].focus({ preventScroll: true })
        } }, h('span', null, s.label), h('small', null, right))
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group)!.push(button)
      }
    }
    const sections = [...groups]
    list.replaceChildren(...sections.map(([group, options]) => h('section', null, h('h3', null, group), options)))
    if (!sections.length) list.append(h('p', null, 'No matching actions.'))
  }
  function refresh() {
    const matches = presets().filter(p => p.slots.every((id, i) => id === draft[i]))
    if (!matches.some(p => p.name === presetSelect.value)) presetSelect.value = matches[0]?.name ?? ''
    slotButtons.forEach((button, i) => {
      const s = SHORTCUTS.get(draft[i])!
      button.setAttribute('aria-pressed', String(i === selected))
      button.setAttribute('aria-label', positions[i] + ', ' + s.label)
      button.replaceChildren(...[picture(s), h('span', null, s.label)].filter((el): el is Element => !!el))
    })
    status.textContent = positions[selected] + ' · ' + SHORTCUTS.get(draft[selected])!.label
    showOptions()
  }

  const close = () => dialog.close()
  dialog.append(
    h('header', null, h('h2', null, 'Edit touch layout'), h('button', { type: 'button', 'aria-label': 'Cancel changes', onclick: close }, '×')),
    h('div', { class: 'layout-workspace' },
      h('div', { class: 'layout-slots' }, presetRow, nameForm, presetError, h('p', { class: 'layout-help' }, 'Tap a slot to assign an action. Drag to swap slots.'), preview, status),
      h('div', { class: 'layout-picker' }, search, list)),
    h('footer', null, h('button', { type: 'button', onclick: () => {
      presetSelect.value = 'Default'
      applyLayout(DEFAULT_SHORTCUTS)
    } }, 'Restore defaults'), h('button', { type: 'button', class: 'layout-save', onclick: () => { save(draft); close() } }, 'Save layout')),
  )
  search.addEventListener('input', () => { showOptions(); list.scrollTop = 0 })
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
  return dialog
}
