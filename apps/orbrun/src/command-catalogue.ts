import { cm, Keys, type ClientMessage } from '@orbrun/webtiles'
import commands from '../data/commands.json'

/**
 * One entry of the command catalogue (data/commands.json), generated from the
 * server's default key table (cmd-keys.h). `mode` is the key-table section the
 * command lives in; `key` is the literal the official client would send, `ck`
 * the name of a CK_* constant for keys that have no character.
 */
interface CatalogueCommand {
  id: string
  label: string
  category: string
  mode: 'command' | 'levelmap' | 'targeting' | 'menu'
  key?: string
  ck?: string
}
export const CATALOGUE = commands as CatalogueCommand[]

/** The message the official client sends for a catalogue command's key. */
export function commandMessage(c: CatalogueCommand): ClientMessage | null {
  if (c.ck) {
    const code = (Keys as unknown as Record<string, number>)[c.ck]
    return code === undefined ? null : cm.key(code)
  }
  if (!c.key) return null
  const code = c.key.charCodeAt(0)
  // Send control keys and the JSON-opening brace as keycodes, as the keyboard does.
  return c.key.length === 1 && (code < 32 || c.key === '{') ? cm.key(code) : cm.input(c.key)
}

export function keyName(c: CatalogueCommand): string {
  if (c.ck) return c.ck.replace(/^CK_/, '').replace(/_/g, ' ').toLowerCase()
  if (!c.key) return ''
  const code = c.key.charCodeAt(0)
  if (c.key === '\t') return 'Tab'
  if (c.key === '\r') return 'Enter'
  if (code === 27) return 'Esc'
  if (code < 32) return 'Ctrl-' + String.fromCharCode(64 + code)
  return c.key
}
