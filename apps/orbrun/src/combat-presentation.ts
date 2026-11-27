import { cellKey, impactStrength, bumpTiming, type MapRenderer, type Scene, type SpellEffect } from '@orbrun/scene'
import type { CombatEvent } from './combat-feedback'
import { bumpFor } from './bump-effects'

/** Schedule presentation only. State and input are never delayed. */
export function presentCombat(renderer: MapRenderer, scene: Scene, events: CombatEvent[], spells: SpellEffect[], weapon: string | undefined, now: number, bumpSpeed = 1, catchUp = false): void {
  const turns = catchUp ? [...new Set(events.flatMap(e => e.turn === undefined ? [] : [e.turn]))].sort((a, b) => a - b) : []
  const stagger = turns.length > 1 ? Math.min(44, 132 / (turns.length - 1)) : 0
  const timeFor = (turn?: number) => now + stagger * (turn === undefined ? 0 : Math.max(0, turns.indexOf(turn)))
  const deaths = events.filter(e => e.kind === 'kill')
  const killed = (x: number | undefined, y: number | undefined, id?: string) => deaths.some(e =>
    id && e.actorId ? id === e.actorId : x !== undefined && y !== undefined && e.x === x && e.y === y)
  // Establish death ownership before a bump can schedule its contact spray.
  // A kill is confirmed by the server; never predict it from damage or wounds.
  for (const event of deaths) if (event.death) {
    const at = timeFor(event.turn)
    if (at > now && event.deathActor) renderer.death?.(event.death, at / 1000, { actor: event.deathActor, from: now / 1000 })
    else renderer.death?.(event.death, at / 1000)
  }
  const attacks = events.flatMap(e => {
    const attack = bumpFor(e, scene, weapon)
    return attack ? [{ ...attack, speed: bumpSpeed, ...(stagger ? { turn: e.turn } : {}) }] : []
  })
  const visible = (p: { x: number; y: number }) => scene.cells.get(cellKey(p.x, p.y))?.visibility === 'visible'
  const scheduled = renderer.bump ? attacks.filter(a => scene.playerOnLevel && visible(a.from) && visible(a.to)) : []
  for (const attack of scheduled) renderer.bump!(attack, timeFor(attack.turn) / 1000)
  const delayFor = (x: number | undefined, y: number | undefined, id?: string, turn?: number) => Math.max(0, ...scheduled
    .filter(a => !stagger || a.turn === turn)
    .filter(a => id && a.toId ? id === a.toId : a.to.x === x && a.to.y === y)
    .map(a => bumpTiming(a.speed).contact * 1000))
  for (const event of events) {
    const x = event.player ? scene.player.x : event.x, y = event.player ? scene.player.y : event.y
    const at = (timeFor(event.turn) + delayFor(x, y, event.player ? 'player' : event.actorId, event.turn)) / 1000
    if (killed(x, y, event.player ? 'player' : event.actorId)) continue
    if ((event.kind === 'hit' || event.kind === 'hurt') && event.amount !== 0 && x !== undefined && y !== undefined) {
      renderer.hit?.({ x, y, actorId: event.player ? 'player' : event.actorId, turn: event.turn, tone: event.tone, intensity: event.intensity }, at)
      if (stagger) renderer.impact?.(x, y, impactStrength(event.intensity), at, event.turn)
      else renderer.impact?.(x, y, impactStrength(event.intensity), at)
    }
  }
  for (const spell of spells) if (!killed(spell.x, spell.y, spell.actorId)) renderer.spell?.(spell, (timeFor(spell.turn) + delayFor(spell.x, spell.y, undefined, spell.turn)) / 1000)
}
