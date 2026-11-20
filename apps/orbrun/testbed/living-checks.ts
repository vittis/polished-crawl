import { fixtureStart, fixtureComplete, fixtureYield, captures, equalPixels, releaseCanvas } from './fixture'
/** Retained real-browser atmosphere assertions formerly mixed with first-person checks. */
import { Render25d } from '@orbrun/render-2.5d'
import { Render2d } from '@orbrun/render-2d'
import { cellKey, emptyScene, type MapRenderer, type SceneCell } from '@orbrun/scene'
import { antechamberScene } from '../src/room/scene'
import { loadRoomTiles } from '../src/room/tiles'
fixtureStart('living-checks')
const tiles = await loadRoomTiles(), { scene } = antechamberScene(tiles)
const fire = { colour: [255, 118, 30] as [number, number, number], radius: 3.4, power: 0.7, pulse: 'fire' as const }
for (const cell of scene.cells.values()) {
  if (cell.x < 7) cell.visibility = 'remembered'
  cell.life = { motion: cell.flags.water ? 'water' : cell.flags.lava ? 'lava' : undefined }
}
scene.cells.get(cellKey(10, 3))!.life = { motion: 'flame', lights: [fire] }
for (const b of scene.billboards) b.life = { motion: b.scenery ? 'plant' : b.kind === 'monster' ? 'breath' : b.kind === 'cloud' ? 'cloud' : b.kind === 'item' ? 'gold' : undefined }
scene.revision++
const checks: { name: string; passed: boolean }[] = []
const image = (view: MapRenderer, canvas: HTMLCanvasElement, time: number) => { view.render(time); return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data }
for (const name of ['Dungeon', 'Flat']) for (const [width, height, dpr] of [[960, 720, 1], [390, 600, 2]]) {
  const canvas = document.createElement('canvas')
  const view = name === 'Dungeon' ? new Render25d({ animate: true }) : new Render2d({ living: true, animate: true, cellSize: 48, center: { x: 11, y: 5 } })
  view.mount(canvas); view.resize(width, height, dpr)
  view.setTiles(tiles); view.setScene(scene, 10)
  const first = image(view, canvas, 10), second = image(view, canvas, 11)
  checks.push({ name: `${name} ${width} DPR${dpr} animated`, passed: !equalPixels(first, second) })
  view.setOptions({ animate: false })
  checks.push({ name: `${name} ${width} DPR${dpr} still`, passed: equalPixels(image(view, canvas, 12), image(view, canvas, 14)) })
  view.setOptions({ animate: true })
  const before = image(view, canvas, 20.4)
  view.impact(11, 5, 1, 20)
  checks.push({ name: `${name} ${width} DPR${dpr} impact`, passed: !equalPixels(before, image(view, canvas, 20.4)) })
  canvas.style.width = Math.min(width, 480) + 'px'
  if (captures) document.getElementById('captures')!.append(canvas)
  view.destroy(); if (!captures) releaseCanvas(canvas)
  await fixtureYield(name)
}

for (const subject of ['tree', 'plant', 'creature'] as const) {
  const canvas = document.createElement('canvas')
  const view = new Render25d({ zoom: 2 })
  view.mount(canvas); view.resize(480, 360, 2); view.setTiles(tiles)
  const scene = emptyScene()
  const cell: SceneCell = { x: 0, y: 0, kind: 'floor', floorTile: tiles.id('FLOOR_GREY_DIRT')!,
    visibility: 'visible', occluder: false,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } }
  scene.cells.set(cellKey(0, 0), cell)
  if (subject === 'tree') {
    cell.kind = 'feature'; cell.stance = 'upright'; cell.featureTile = tiles.id('DNGN_TREE')!
    cell.life = { motion: 'plant' }
  } else {
    const plant = subject === 'plant'
    scene.billboards.push({ x: 0, y: 0, kind: 'monster', tile: tiles.id('MONS_PLANT')!, height: 1,
      scenery: plant, life: { motion: plant ? 'plant' : 'breath' } })
  }
  view.setScene(scene, 0)
  const standard = image(view, canvas, 1)
  view.setOptions({ foliageSway: 2 })
  const stronger = image(view, canvas, 1)
  view.setOptions({ foliageSway: 0 })
  const still = image(view, canvas, 1)
  const later = image(view, canvas, 2)
  if (subject === 'creature') {
    checks.push({ name: 'foliage sway leaves creature idle motion intact', passed:
      equalPixels(standard, still) && equalPixels(standard, stronger) && !equalPixels(still, later) && view.animating })
  } else {
    checks.push({ name: `${subject} sway changes with intensity`, passed:
      !equalPixels(standard, stronger) && !equalPixels(standard, still) && !equalPixels(stronger, still) })
    checks.push({ name: `${subject} sway Off settles the renderer`, passed: equalPixels(still, later) && !view.animating })
  }
  view.destroy(); releaseCanvas(canvas)
}
fixtureComplete({ checks: checks.length, failures: checks.filter(c => !c.passed), results: checks })
