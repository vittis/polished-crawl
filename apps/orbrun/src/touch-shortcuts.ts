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
  CMD_FIRE_ITEM_NO_QUIVER: { label: 'Throw item', icon: 'MI_JAVELIN', aliases: 'fire throw missile without changing quiver' },
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

// The full catalogue still resolves shortcuts saved by earlier versions.
export const PICKER_GROUPS: Record<string, readonly string[]> = {
  Combat: ['CMD_AUTOFIGHT', 'CMD_AUTOFIRE', 'CMD_FIRE', 'CMD_FIRE_ITEM_NO_QUIVER', 'quiver', 'CMD_WEAPON_SWAP', 'spells', 'abilities', 'evocables'],
  Exploration: ['CMD_EXPLORE', 'CMD_DISPLAY_MAP', 'find', 'CMD_MAP_FIND_DOWNSTAIR', 'CMD_MAP_FIND_UPSTAIR', 'CMD_INTERLEVEL_TRAVEL', 'CMD_LOOK_AROUND', 'CMD_REST'],
  Equipment: ['gear', 'CMD_PICKUP', 'CMD_QUAFF', 'CMD_READ', 'CMD_DISPLAY_SKILLS'],
  Controls: ['interact', 'escape'],
}

export interface TouchPreset { name: string; slots: readonly string[] }
export const BUILTIN_PRESETS: readonly TouchPreset[] = [
  { name: 'Default', slots: DEFAULT_SHORTCUTS },
  { name: 'Melee brute', slots: ['CMD_WEAPON_SWAP', 'abilities', 'CMD_QUAFF', 'escape', 'CMD_EXPLORE', 'CMD_AUTOFIGHT'] },
  { name: 'Spellcaster', slots: ['quiver', 'abilities', 'CMD_AUTOFIRE', 'escape', 'CMD_EXPLORE', 'spells'] },
  { name: 'Ranged', slots: ['quiver', 'CMD_WEAPON_SWAP', 'CMD_FIRE', 'escape', 'CMD_EXPLORE', 'CMD_AUTOFIRE'] },
  { name: 'Skirmisher', slots: ['quiver', 'CMD_PICKUP', 'CMD_AUTOFIGHT', 'escape', 'CMD_EXPLORE', 'CMD_FIRE_ITEM_NO_QUIVER'] },
]

function validSlots(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === SLOT_CELLS.length && new Set(value).size === value.length &&
    value.every(id => typeof id === 'string' && SHORTCUTS.has(id))
}
const PRESET_PREFIX = 'orbrun.touch-preset.v1.'
const presetKey = (name: string) => PRESET_PREFIX + name.toLowerCase()

export function loadTouchPresets(): TouchPreset[] {
  const presets: TouchPreset[] = []
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PRESET_PREFIX)) continue
      try {
        const entry = JSON.parse(localStorage.getItem(key) ?? 'null')
        if (typeof entry?.name === 'string' && key === presetKey(entry.name) && validSlots(entry.slots)) presets.push(entry)
      } catch { /* A damaged preset does not affect the others. */ }
    }
  } catch { /* Built-in presets are always available. */ }
  return presets.sort((a, b) => a.name.localeCompare(b.name))
}

export function saveTouchPreset(name: string, slots: readonly string[]): TouchPreset {
  name = name.trim()
  if (!name) throw new Error('Enter a preset name.')
  if (!validSlots(slots)) throw new Error('Choose six different actions.')
  const key = presetKey(name)
  let exists: boolean
  try {
    exists = localStorage.getItem(key) !== null
  } catch { throw new Error('Presets could not be saved on this device.') }
  if (exists || BUILTIN_PRESETS.some(p => presetKey(p.name) === key) || name.toLowerCase() === 'custom layout')
    throw new Error('That name is already in use.')
  const preset = { name, slots: [...slots] }
  try { localStorage.setItem(key, JSON.stringify(preset)) }
  catch { throw new Error('Presets could not be saved on this device.') }
  return preset
}

export function loadShortcuts(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (validSlots(value)) return value
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
