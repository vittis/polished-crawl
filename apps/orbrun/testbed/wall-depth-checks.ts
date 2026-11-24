import { matrix, fixtureYield, releaseCanvas, equalPixels, pixelSampler } from './fixture'
import { Render25d, fittedScale } from '@orbrun/render-2.5d'
import { cellKey, emptyScene, type SceneCell, type TileSource } from '@orbrun/scene'
import { planeRect } from '../../../packages/render-2.5d/src/projection'

/** Raster checks for depth cues, including consistent height and hidden neighbours. */
export async function wallDepthChecks(source: TileSource) {
  let checks = 0
  const failures: unknown[] = []
  for (const dpr of matrix([1, 1.25, 2], [1.25, 2])) for (const degrees of matrix([35, 50, 65], [50])) for (const zoom of matrix([0.8, 1, 1.4], [1])) {
    const canvas = document.createElement('canvas')
    const r = new Render25d({ tilt: degrees, zoom, animate: false })
    r.mount(canvas); r.resize(900, 700, dpr); r.setTiles(source)
    const scene = emptyScene()
    for (let y = -4; y <= 4; y++) for (let x = -5; x <= 5; x++) {
      const wall = Math.abs(x) <= 2 && (y === 0 || y === -1)
      scene.cells.set(cellKey(x, y), {
        x, y, kind: wall ? 'wall' : 'floor', occluder: wall, visibility: 'visible', floorTile: 1, wallTile: 1,
        flags: { water: false, lava: false },
      } as SceneCell)
    }
    const p = { x: 0, y: 0, width: 900, height: 700, tilt: degrees * Math.PI / 180, scale: fittedScale(900, 700, degrees * Math.PI / 180, zoom) }
    const ctx = canvas.getContext('2d')!
    let snapshot: ReturnType<typeof pixelSampler>
    const pixel = (x: number, y: number) => snapshot(x, y)[0]
    const draw = () => { r.render(0); snapshot = pixelSampler(ctx, dpr, { x: 450, y: 0, width: 1, height: 700 }) }
    const assert = (name: string, passed: boolean, detail: unknown) => {
      checks++; if (!passed) failures.push({ name, dpr, degrees, zoom, detail })
    }
    r.setScene(scene); draw()
    const ground = planeRect(p, 0, 0, 0, dpr), roof = planeRect(p, 0, 0, 0.58, dpr)
    const bottom = ground.y + ground.height, faceTop = roof.y + roof.height
    const upper = pixel(450, faceTop + (bottom - faceTop) * 0.35)
    const lower = pixel(450, faceTop + (bottom - faceTop) * 0.88)
    assert('wall foot darker than upper face', lower < upper - 15, { upper, lower })
    const floor = planeRect(p, 0, 1, 0, dpr)
    const near = pixel(450, floor.y + floor.height * 0.04), far = pixel(450, floor.y + floor.height * 0.8)
    assert('wall casts a fading base shadow', near < far - 35, { near, far })
    const shadowInk = () => {
      let sum = 0
      for (let i = 1; i < 16; i++) sum += 255 - pixel(450, floor.y + floor.height * i / 16)
      return sum
    }
    const tall = shadowInk()
    const monster = { kind: 'monster' as const, x: 0, y: -1, tile: 2, height: 1 }
    scene.billboards = [monster]
    scene.revision++; r.setScene(scene); draw()
    const foot = r.project(monster.x, monster.y + 0.3, 0.58)
    const points = [0.18, 0.78].map(offset => foot.y - offset * p.scale)
    const samples = points.map(y => snapshot(foot.x, y))
    const picks = points.map(y => r.pick(foot.x, y))
    // The low sample would be covered by a later wall paint. The high one
    // would lie above the sprite if it were still anchored at ground level.
    assert('a monster in a raised wall is visible at its cap and picks its confirmed cell',
      samples.every(([red, green, blue]) => blue > 2 * red && blue > green) &&
      picks.every(key => key === cellKey(monster.x, monster.y)), { samples, picks })
    scene.billboards = []
    const behind = scene.cells.get(cellKey(0, -1))!
    behind.kind = 'floor'; behind.occluder = false
    scene.revision++; r.setScene(scene); draw()
    const short = shadowInk()
    assert('opening ground behind a wall preserves its height and shadow', tall === short, { tall, short })
    const wall = scene.cells.get(cellKey(0, 0))!
    wall.wallStyle = 'transparent'
    scene.revision++; r.setScene(scene); draw()
    const transparent = shadowInk()
    assert('transparent walls cast lighter shadows', transparent < short, { transparent, short })
    // Unseen geometry and its occupants must not affect visible pixels.
    wall.visibility = 'unseen'
    scene.billboards = [{ ...monster, x: wall.x, y: wall.y }]
    scene.revision++; r.setScene(scene); draw()
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    wall.occluder = false; wall.kind = 'unknown'
    scene.billboards = []
    scene.revision++; r.setScene(scene); draw()
    assert('hidden walls and their occupants never affect visible pixels', equalPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, before), {})
    assert('static depth cues let still scenes sleep', !r.animating, {})
    r.destroy(); releaseCanvas(canvas)
    await fixtureYield('wall-depth-checks')
  }
  return { checks, failures }
}
