import { h } from './dom'
import type { PadEvent } from './gamepad'

const artwork = Object.values(import.meta.glob<string>('./loading-art/*.png', { eager: true, import: 'default', query: '?url' }))
let nextArtwork = Math.floor(Math.random() * artwork.length)

export class LoadingScreen {
  private status = h('div', { role: 'status' })
  private actions = h('div', { class: 'loading-actions' })
  private panel = h('div', { class: 'loading-panel' }, this.status, this.actions)
  readonly root = h('div', { class: 'loading' }, this.panel)

  constructor(readonly illustrated = false) {
    if (illustrated) {
      this.root.classList.add('illustrated')
      this.root.prepend(h('img', { class: 'loading-art', src: artwork[nextArtwork], alt: '', decoding: 'async' }))
      nextArtwork = (nextArtwork + 1) % artwork.length
    }
  }

  text(text: string) {
    if (this.status.textContent !== text) this.status.textContent = text
  }

  setActions(...actions: [label: string, run: () => void][]) {
    this.actions.replaceChildren(...actions.map(([label, run]) => h('button', {
      type: 'button', onclick: run,
    }, label)))
  }

  back() {
    this.actions.querySelector('button')?.click()
  }

  pad(event: PadEvent) {
    if (event.type === 'press' && event.button === 'B') return this.back()
    const buttons = [...this.actions.querySelectorAll('button')]
    if (!buttons.length) return
    const active = buttons.findIndex(button => button === document.activeElement)
    if (event.type === 'dir' && event.dir !== null) buttons[(active + 1) % buttons.length]?.focus()
    if (event.type === 'press' && event.button === 'A' && active >= 0) buttons[active].click()
  }
}
