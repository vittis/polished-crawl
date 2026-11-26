import atlas from '../data/touch-shortcut-icons.json'
import { h } from './dom'

const icons: Readonly<Record<string, number>> = atlas.icons

/** Use the same bundled pixel art in the action list, slot preview, and HUD. */
export function touchShortcutIcon(id: string): HTMLElement {
  const index = icons[id] ?? atlas.icons.fallback
  const x = (index % atlas.columns) * 100 / (atlas.columns - 1)
  const y = Math.floor(index / atlas.columns) * 100 / (atlas.rows - 1)
  return h('span', {
    class: 'shortcut-icon', 'aria-hidden': 'true',
    style: {
      backgroundSize: `${atlas.columns * 100}% ${atlas.rows * 100}%`,
      backgroundPosition: `${x}% ${y}%`,
    },
  })
}
