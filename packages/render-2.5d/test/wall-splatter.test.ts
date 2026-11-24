import { describe, expect, it } from 'vitest'
import { cellKey, emptyScene, type SceneCell } from '@orbrun/scene'
import { DungeonDeaths } from '../src/death'
import type { SpellBurst } from '../src/effects'
import { sampleHitSpray } from '../src/hit-spray'
import type { WallSplats } from '../src/wall-splatter'

const origin = { x: 0, y: 0 }, direction = { x: 0, y: -1 }
const north = cellKey(0, -1)

function room() {
  const scene = { ...emptyScene(), playerOnLevel: true, levelKey: 'D:1' }
  for (let y = -3; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const occluder = x === 0 && [-3, -1, 1].includes(y)
    scene.cells.set(cellKey(x, y), { x, y, visibility: 'visible', kind: occluder ? 'wall' : 'floor', occluder, floorTile: 1, flags: {} } as SceneCell)
  }
  return scene
}

function hit(scene: ReturnType<typeof room>, now: number, { gore = 1, reach = 1, aim = direction } = {}) {
  const burst: SpellBurst = { ...origin, kind: 'acid', intensity: 'heavy', born: 0, requested: 0, duration: 0.3, source: 'confirmed',
    spray: { kind: 'flesh', source: 'melee', height: 1, seed: 7, direction: aim } }
  const marks: WallSplats = new Map()
  sampleHitSpray(scene, burst, now, origin, gore, 0, 0.25, reach, marks)
  return marks
}

describe('wall splatter', () => {
  it('leaves small directional hit marks that fade in place during the burst', () => {
    const scene = room()
    expect(hit(scene, 0)).toEqual(new Map())
    const marks = hit(scene, 0.1)
    expect([...marks.keys()]).toEqual([north])
    const early = marks.get(north)!
    expect(hit(scene, 0.22).get(north)).toEqual(early)
    const later = hit(scene, 0.265).get(north)!
    expect(later).toEqual(early.map((mark, i) => ({ ...mark, alpha: later[i].alpha })))
    expect(later[0].alpha).toBeCloseTo(early[0].alpha / 2)
    expect(hit(scene, 0.299).has(north)).toBe(true)
    expect(hit(scene, 0.3).size).toBe(0)
    expect(hit(scene, 0.1, { gore: 0 }).size).toBe(0)
    expect(hit(scene, 0.1, { reach: 0.25 }).size).toBe(0)
    expect(hit(scene, 0.1, { aim: { x: 0, y: 1 } }).size).toBe(0)
  })

  it('leaves heavier death marks using the death clock and clears on a level change', () => {
    const scene = room(), deaths = new DungeonDeaths()
    deaths.observe(scene, true)
    const death = { ...origin, actorId: 'goblin', kind: 'flesh' as const, direction, height: 0.8 }
    expect(deaths.spawn(scene, death, 0)).toBe(true)
    function sample(time: number, duration = 1, current = scene) {
      const marks: WallSplats = new Map()
      deaths.sample(current, time, 0.5, 0.75, 0.25, 1, duration, marks)
      return marks.get(north) ?? []
    }
    const hitMarks = hit(scene, 0.1).get(north)!, deathMarks = sample(0.1)
    expect(deathMarks.length).toBeGreaterThan(hitMarks.length)
    expect(deathMarks[0].size).toBeGreaterThan(hitMarks[0].size)
    expect(sample(1.1)).toEqual(deathMarks)
    expect(sample(2.475)[0].alpha).toBeCloseTo(deathMarks[0].alpha / 2)
    expect(sample(4.95, 2)[0].alpha).toBeCloseTo(deathMarks[0].alpha / 2)
    expect(sample(5.399, 2)).not.toEqual([])
    expect(sample(5.4, 2)).toEqual([])
    expect(deaths.spawn(scene, death, 6)).toBe(true)
    expect(sample(6.1)).not.toEqual([])
    const next = { ...scene, levelKey: 'D:2' }
    deaths.observe(next, true)
    expect(sample(6.1, 1, next)).toEqual([])
  })

  it('keeps marks off remembered walls and behind occluders', () => {
    const scene = room(), wall = scene.cells.get(north)!
    expect([...hit(scene, 0.23, { reach: 4 }).keys()]).toEqual([north])
    wall.visibility = 'remembered'
    expect(hit(scene, 0.23, { reach: 4 }).size).toBe(0)
    wall.visibility = 'visible'
    scene.cells.get(cellKey(origin.x, origin.y))!.visibility = 'remembered'
    expect(hit(scene, 0.23, { reach: 4 }).size).toBe(0)
  })
})
