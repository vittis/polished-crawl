import { h } from './dom'
import { gamepadHints } from './gamepad-hints'
import { touchHints } from './touch-hints'
import { defaultSettings, getSettings, saveSettings, type Settings } from './settings'
import { adjustSetting, chooseSetting, groupAtDefaults, resetGroup, resetSetting, rowHint, rowOff, settingGroups, settingValue, type SettingGroup } from './settings-rows'
import { audio } from './audio/controller'

/**
 * Polished Crawl's settings, one panel for the front end and the game: drawn as
 * the game draws a menu (a title line, a letter per item, the value on the
 * right between the arrows that turn it, the hovered line lit). Left and
 * right, A, Enter or the letter change a value.
 *
 * One group to a panel (settings-rows.ts `SETTING_GROUPS`): the settings
 * screen lists the groups as rows, each opening its own page under a Back,
 * so every page of the settings is reached and left the same way. The
 * Controls page also carries the Gamepad controls sheet, a page to read
 * rather than a group of settings, which is why it is not a group itself. The pause menu opens the same
 * pages over the game (overlays.ts), the front end on its settings screen
 * (menu.ts), and both read `settings-rows.ts`, so the two never disagree.
 *
 * Every row is drawn again after any change: one setting can move another
 * (the camera decides what the height row sets and whether the distance
 * row does anything), and a row that is off is dark grey, as the game's
 * menus draw an item that cannot be taken, and left and right leave it.
 */
export function settingsPanel(group: SettingGroup, opts: { onchange?: () => void; back?: () => void; controls?: () => void; editTouchLayout?: () => HTMLDialogElement | undefined } = {}) {
  const settingsRows = settingGroups().find(g => g.group === group)?.rows ?? []
  const sectioned = settingsRows.some(row => row.section)
  const panel = h('div', { class: sectioned ? 'settings menu game sectioned-settings' : 'settings menu game' })
  panel.append(h('div', { class: 'title' }, group))
  const ol = h('ol')
  const body = h('div', { class: 'body' }, ol)
  const rows: HTMLElement[] = []
  const hotkey = () => String.fromCharCode(97 + rows.length)
  const draw: ((settings: Settings) => void)[] = []
  const redraw = () => {
    const settings = getSettings()
    draw.forEach(f => f(settings))
  }
  const sections = new Map<string, HTMLOListElement>()
  for (const sr of settingsRows) {
    const val = h('span', { class: 'val' }, settingValue(sr))
    const k = hotkey()
    const adjust = (d: number) => {
      adjustSetting(sr, d, opts.onchange)
      redraw()
    }
    // the angle brackets are what left and right do, under the mouse: each turns the value its own way, so a click
    // can walk a long scale back as well as on. Each stops its click before the row takes it as a turn forward
    const arrow = (d: number, ch: string) => {
      const attrs = {
        class: 'arrow',
        'aria-label': `${sr.label} ${d < 0 ? 'previous' : 'next'}`,
        onclick: (ev: Event) => {
          ev.stopPropagation()
          adjust(d)
        },
      }
      return sr.section ? h('button', { ...attrs, type: 'button', tabindex: -1 }, ch) : h('span', { ...attrs, role: 'button' }, ch)
    }
    const previous = arrow(-1, '<'), next = arrow(1, '>')
    const numericStops = sr.section && typeof sr.values[0] === 'number' ? sr.values as readonly number[] : []
    // Wrapped controls retain their arrow order. Their sliders run from low to high.
    const sliderStops = sr.wrap ? [...numericStops].sort((a, b) => a - b) : numericStops
    const slider = sliderStops.length
      ? h('input', { class: 'setting-slider', type: 'range', min: 0, max: sliderStops.length - 1, step: 1, 'aria-label': sr.label })
      : null
    const reset = sr.section ? h('button', {
      class: 'setting-reset', type: 'button', 'aria-label': `Reset ${sr.label} to default`,
      onclick: (ev: MouseEvent) => {
        ev.stopPropagation()
        resetSetting(sr, opts.onchange)
        redraw()
      },
    }, 'Reset') : null
    const classes = 'row level2 selectable fg7' + (reset ? ' setting-control' : '') + (reset && !slider ? ' setting-choice' : '')
    const r = h(
      'li',
      { class: classes, dataset: { hotkey: k, focus: 'setting:' + sr.label, hint: rowHint(sr) } },
      h('span', { class: 'hotkey' }, k),
      h('span', { class: 'dash' }, '-'),
      h('span', { class: 'label' }, sr.label),
      slider,
      h('span', { class: 'value' }, previous, val, next),
      reset,
    )
    const updateSliderReadout = (input: HTMLInputElement, text: string) => {
      val.textContent = text
      input.setAttribute('aria-valuetext', text)
      input.style.setProperty('--slider-position', String(input.valueAsNumber / (sliderStops.length - 1)))
    }
    if (slider) {
      slider.addEventListener('click', ev => ev.stopPropagation())
      slider.addEventListener('input', () => {
        const value = sliderStops[slider.valueAsNumber]
        updateSliderReadout(slider, sr.fmt(value))
        chooseSetting(sr, value, opts.onchange)
      })
      slider.addEventListener('change', redraw)
    }
    draw.push(settings => {
      const text = settingValue(sr, settings), off = rowOff(sr, settings)
      r.hidden = sr.visible?.(settings) === false
      r.dataset.hint = rowHint(sr, settings)
      r.classList.toggle('off', off)
      const value = settings[sr.key]
      if (slider) {
        const stored = Number(value)
        // A saved preference between stops keeps its value until the user adjusts it.
        const index = sliderStops.reduce((best, stop, i) => Math.abs(stop - stored) < Math.abs(sliderStops[best] - stored) ? i : best, 0)
        slider.valueAsNumber = index
        updateSliderReadout(slider, text)
        slider.disabled = off
      } else val.textContent = text
      if (reset) {
        const bounded = slider !== null && !sr.wrap
        previous.toggleAttribute('disabled', off || bounded && value === sr.values[0])
        next.toggleAttribute('disabled', off || bounded && value === sr.values[sr.values.length - 1])
        reset.setAttribute('aria-disabled', String(value === defaultSettings[sr.key]))
      }
    })
    r.addEventListener('click', () => adjust(1))
    r.addEventListener('adjust', (ev) => adjust((ev as CustomEvent<number>).detail))
    rows.push(r)
    if (sr.section && !sections.has(sr.section)) {
      const list = h('ol')
      body.insertBefore(h('section', { class: 'settings-section', 'aria-label': sr.section }, h('h2', null, sr.section), list), ol)
      sections.set(sr.section, list)
    }
    const list = sections.get(sr.section ?? '') ?? ol
    list.append(r)
    const openEditor = opts.editTouchLayout
    if (sr.key === 'hideEditTouchLayout' && openEditor) {
      const key = hotkey()
      const action = h('li', { class: 'row level2 selectable fg7 setting-control action', role: 'button', 'aria-label': 'Edit touch layout',
        'aria-haspopup': 'dialog', dataset: { hotkey: key, focus: 'edit-touch-layout', hint: 'Customize your touch buttons, presets and control sizes.' } },
        h('span', { class: 'hotkey' }, key), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Edit touch layout'),
        h('span', { 'aria-hidden': 'true', class: 'setting-open' }, '›'))
      action.addEventListener('click', () => {
        const dialog = openEditor()
        dialog?.addEventListener('close', () => { redraw(); action.focus({ preventScroll: true }) }, { once: true })
      })
      rows.push(action)
      list.append(action)
    }
  }
  if (group === 'Audio') {
    const controller = audio()
    const status = h('div', { class: 'audio-status', role: 'status', 'aria-live': 'polite' })
    const details = h('details', { class: 'audio-details' }, h('summary', null, 'Pack details'))
    const description = h('p')
    details.append(description)
    body.append(status, details)
    const action = (label: string, hint: string, run: () => void) => {
      const k = hotkey()
      const row = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'audio:' + label, hint } },
        h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, label))
      row.addEventListener('click', run)
      rows.push(row); ol.append(row)
    }
    action('Download / refresh OSP', 'Download roughly 45 MB from CNC. Reads only the base init.txt and saves the pack on this device.', () => { void controller.download() })
    action('Import OSP ZIP', 'Choose a local sound pack with init.txt at the ZIP root. Replaces the selected pack.', () => {
      const input = h('input', { type: 'file', accept: '.zip,application/zip' })
      input.addEventListener('change', () => { if (input.files?.[0]) void controller.importZip(input.files[0]) })
      input.click()
    })
    action('Test sound', 'Play the selected pack’s hit sound. Enable sound effects first. With a controller, a tap or keyboard press may be needed to unlock audio.', () => controller.testSound())
    action('Remove cached pack', 'Stop playback and remove the selected pack from this device.', () => { void controller.remove() })
    // Settings panels have no destroy hook. Observe attachment/removal to release the subscription.
    let attached = false
    const unsubscribe = controller.subscribe(value => {
      status.textContent = value.message
      status.setAttribute('aria-busy', String(value.busy))
      details.hidden = !value.info
      description.textContent = value.info ? `${value.info.name}\n${value.info.sounds} sounds · SHA-256 ${value.hash}\n${value.info.details.join('\n')}` : ''
    })
    const observer = new MutationObserver(() => {
      if (panel.isConnected) attached = true
      else if (attached) { unsubscribe(); observer.disconnect() }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    controller.prepare()
  }
  // A direct tap/key gesture is needed by the Fullscreen API. Keep this action
  // available to existing standalone installs as well as ordinary browser tabs.
  // It is deliberately an enter action: manifest fullscreen is separate from
  // document.fullscreenElement and cannot be exited with exitFullscreen().
  if (group === 'Interface' && document.fullscreenEnabled && document.documentElement.requestFullscreen) {
    const k = hotkey()
    const status = h('div', { role: 'status', hidden: true })
    const fullscreen = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'fullscreen', hint: 'Hide the system bars. If using a controller, you may need to tap this row on the screen.' } },
      h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Go fullscreen'))
    let pending = false
    fullscreen.addEventListener('click', async () => {
      if (pending) return
      pending = true
      status.hidden = true
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      } catch {
        status.textContent = 'Fullscreen could not start. Tap Go fullscreen on the screen or press its letter on a keyboard to try again.'
        status.hidden = false
      } finally {
        pending = false
      }
    })
    rows.push(fullscreen)
    ol.append(fullscreen)
    body.append(status)
  }
  // the tips are the pad's and the finger's, so they are a row of the page the Hints setting is on
  if (group === 'Controls') {
    const k = hotkey()
    const replay = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'replay-gamepad-tips', hint: 'Forget which gamepad and touch controls you have used and teach them again: switches Hints to Adaptive.' } },
      h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Replay tips'))
    replay.addEventListener('click', () => {
      gamepadHints().reset()
      touchHints().reset()
      saveSettings({ ...getSettings(), hints: 'adaptive' })
      opts.onchange?.()
      redraw()
      replay.querySelector('.label')!.textContent = 'Tips reset'
    })
    rows.push(replay)
    ol.append(replay)
    if (opts.controls) {
      const k = hotkey()
      const sheet = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'gamepad-controls', hint: 'What every button on the pad does, on each layer.' } },
        h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Gamepad controls'))
      sheet.addEventListener('click', () => opts.controls!())
      rows.push(sheet)
      ol.append(sheet)
    }
  }
  // the page's own settings back as they came; dark while there is nothing to put back
  {
    const k = hotkey()
    const reset = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'settings-reset', hint: `Put every ${group.toLowerCase()} setting back to its default.` } },
      h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Reset to defaults'))
    draw.push(settings => reset.classList.toggle('off', groupAtDefaults(group, settings)))
    reset.addEventListener('click', () => {
      if (groupAtDefaults(group)) return
      resetGroup(group, opts.onchange)
      redraw()
    })
    rows.push(reset)
    ol.append(reset)
  }
  redraw()
  // every page leaves the same way: Back at its foot, where the group's row was taken from
  if (opts.back) {
    const k = hotkey()
    const back = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'settings-back', hint: 'Back to the settings.' } }, h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Back'))
    back.addEventListener('click', () => opts.back!())
    rows.push(back)
    ol.append(back)
  }
  panel.append(body)
  if (sectioned) panel.append(h('div', { class: 'settings-shortcuts' },
    h('span', { class: 'kbd-only' }, 'Backspace resets the selected setting.'),
    h('span', { class: 'pad-only' }, 'Y resets the selected setting.')))
  else panel.append(h('div', { class: 'more' }, '[<] [>] change a setting  [Esc] back'))
  return { el: panel, rows, refresh: redraw }
}
