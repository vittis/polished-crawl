import { h } from './dom'
import { DEFAULT_SHORTCUTS, SHORTCUTS, type Shortcut } from './touch-shortcuts'

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

  function showOptions() {
    const query = search.value.trim().toLowerCase()
    const groups = new Map<string, HTMLElement[]>()
    for (const s of SHORTCUTS.values()) {
      if (query && ![s.label, s.aliases, s.group, s.key].some(v => v?.toLowerCase().includes(query))) continue
      const from = draft.indexOf(s.id)
      const group = from >= 0 ? 'On your layout' : s.group
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
    const assigned = groups.get('On your layout')
    if (assigned) groups.delete('On your layout')
    const sections = assigned ? [['On your layout', assigned] as const, ...groups] : [...groups]
    list.replaceChildren(...sections.map(([group, options]) => h('section', null, h('h3', null, group), options)))
    if (!sections.length) list.append(h('p', null, 'No matching actions.'))
  }
  function refresh() {
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
      h('div', { class: 'layout-slots' }, h('p', null, 'Tap a slot to assign an action. Drag to swap slots.'), preview, status),
      h('div', { class: 'layout-picker' }, search, list)),
    h('footer', null, h('button', { type: 'button', onclick: () => {
      draft.splice(0, draft.length, ...DEFAULT_SHORTCUTS)
      search.value = ''
      refresh()
      list.scrollTop = 0
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
