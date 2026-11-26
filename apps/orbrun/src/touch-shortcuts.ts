import { cm, Keys, type ClientMessage } from '@orbrun/webtiles'
import { CATALOGUE, commandMessage, keyName } from './command-catalogue'
import { ACTION_TABS, type ActionTabId } from './action-tabs'
import type { TouchCell, TouchIcon, TouchLabel } from './bindings'

export const DEFAULT_SHORTCUTS = ['CMD_DISPLAY_SKILLS', 'CMD_DISPLAY_MAP', 'gear', 'escape', 'CMD_EXPLORE', 'CMD_AUTOFIGHT']
export const SLOT_CELLS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'] as const
const STORAGE_KEY = 'orbrun.touch-layout.v1'

export interface Shortcut extends TouchIcon {
  id: string
  label: string
  group: string
  key?: string
  aliases?: string
  source?: TouchCell
  tab?: ActionTabId
  message?: ClientMessage
  mode?: 'command' | 'levelmap' | 'targeting' | 'menu'
}

const shortcuts: Shortcut[] = [
  { id: 'gear', label: 'Gear', group: 'Quick actions', icon: 'CMD_DISPLAY_INVENTORY', source: 'gear' },
  { id: 'escape', label: 'Esc', group: 'Quick actions', icon: 'PROMPT_NO', source: 'esc' },
  { id: 'find', label: 'Find…', group: 'Quick actions', icon: 'CMD_SEARCH_STASHES', aliases: 'find... items search' },
  { id: 'level-items', label: 'Items on this level', group: 'Quick actions', icon: 'CMD_SEARCH_STASHES' },
  { id: 'interact', label: 'Interact', group: 'Quick actions', icon: 'PROMPT_YES', source: 'select' },
  { id: 'descend', label: 'Descend', group: 'Quick actions', icon: 'CMD_MAP_NEXT_LEVEL' },
  ...ACTION_TABS.map(t => ({ id: t.id, label: t.label, group: 'Quick actions', icon: t.tile, tab: t.id })),
]
const overrides: Record<string, Partial<Shortcut>> = {
  CMD_DISPLAY_SKILLS: { source: 'corner' },
  CMD_DISPLAY_MAP: { label: 'Map', glyph: 'map', source: 'map' },
  CMD_EXPLORE: { label: 'Explore', source: 'explore' },
  CMD_AUTOFIGHT: { label: 'Fight', source: 'fight' },
  CMD_AUTOFIRE: { label: 'Autofire', group: 'Quick actions', key: 'Shift+Tab', message: cm.key(Keys.CK_SHIFT_TAB), glyph: 'target' },
  CMD_FIRE: { label: 'Fire', source: 'quiver' },
  CMD_LOOK_AROUND: { label: 'Examine', source: 'examine' },
  CMD_FULL_VIEW: { label: 'In view', source: 'spare' },
  CMD_MAP_FIND_DOWNSTAIR: { label: 'Find down' },
  CMD_MAP_FIND_UPSTAIR: { label: 'Find up' },
  CMD_SEARCH_STASHES: { label: 'Search items…' },
  CMD_REST: { label: 'Rest', message: cm.key(Keys.CK_SHIFT_CLEAR) },
}
for (const c of CATALOGUE) {
  const message = commandMessage(c)
  if (!message) continue
  const group = c.mode === 'command' ? c.category[0].toUpperCase() + c.category.slice(1)
    : { levelmap: 'Level map', targeting: 'Aiming', menu: 'Inventory menu' }[c.mode]
  shortcuts.push({ id: c.id, label: c.label, aliases: c.label, group, icon: c.id, mode: c.mode, key: keyName(c), message, ...overrides[c.id] })
}

export const SHORTCUTS = new Map(shortcuts.map(s => [s.id, s]))

export function loadShortcuts(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (Array.isArray(value) && value.length === SLOT_CELLS.length && new Set(value).size === value.length &&
        value.every(id => typeof id === 'string' && SHORTCUTS.has(id))) return value
  } catch { /* Use defaults when storage is unavailable. */ }
  return [...DEFAULT_SHORTCUTS]
}

export function saveShortcuts(ids: readonly string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)) } catch { /* The current game keeps its layout. */ }
}

export function shortcutLabel(id: string, cell: TouchCell, labels: ReadonlyMap<TouchCell, TouchLabel>): TouchLabel {
  const s = SHORTCUTS.get(id)!
  const live = s.source && labels.get(s.source)
  if (live) return { ...live, cell, label: id === 'interact' ? live.label : s.label }
  return {
    cell, button: `shortcut:${id}`, label: s.label, icon: s.icon, glyph: s.glyph,
    contextual: false, idle: !!s.source, action: { kind: 'keys', label: s.label, seq: [] },
  }
}
