import { expect } from '@playwright/test'
import type { Render25d } from '@orbrun/render-2.5d'
import type { Scene } from '@orbrun/scene'
import { test, result, smoke } from './fixtures'

test('flat dungeon terrain and still actors reproduce the source pixels at fractional browser densities', smoke, async ({ page }) => {
  await page.goto('/testbed/dungeon.html')
  await page.waitForFunction(() => '__ready' in window)
  const samples = await page.evaluate(() => {
    const { renderer, scene, canvas } = window as unknown as { renderer: Render25d; scene: Scene; canvas: HTMLCanvasElement }
    const atlas = document.createElement('canvas')
    atlas.width = 64; atlas.height = 32
    const ink = atlas.getContext('2d')!
    // Unique neighboring texels make dropped, doubled and displaced pixels detectable.
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
      ink.fillStyle = `rgb(${x * 4}, ${y * 8}, ${(x + y) % 2 ? 210 : 40})`
      ink.fillRect(x, y, 1, 1)
    }
    const floor = { atlas: 'test', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
    const body = { ...floor, sx: 32, w: 21, h: 26, ox: 5, oy: 4 }
    const equipment = { ...floor, sx: 53, sy: 8, w: 11, h: 21, ox: 14, oy: 8 }
    renderer.setTiles({ tile: id => [floor, body, equipment][id - 1], atlas: () => atlas, atlasNames: () => ['test'] })
    const cells: Scene['cells'] = new Map()
    for (const x of [0, 1, 2]) {
      cells.set((512 << 10) + x + 512, { x, y: 0, kind: 'floor', floorTile: 1, occluder: false, visibility: 'visible', flags: {
        water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false,
      } })
    }
    renderer.setScene({ ...scene, cells, player: { x: 1, y: 0 }, playerOnLevel: true, billboards: [
      { kind: 'player', x: 1, y: 0, height: 1, tile: 2, damage: 'heavily_damaged', layers: [{ tile: 2 }, { tile: 3, ox: 1, ymax: 24 }] },
      { kind: 'monster', x: 2, y: 0, height: 1, tile: 2, damage: 'almost_dead' },
    ] }, 0)
    renderer.setOptions({ tilt: null, center: null, zoom: 1, fitSpan: null, animate: true, idleIntensity: 0, movement: false, dynamicLighting: false, minibars: null })
    const ctx = canvas.getContext('2d')!
    const reference = document.createElement('canvas')
    const compare = reference.getContext('2d')!
    return [[1024, 920, 0.75, 32], [979, 727, 1.25, 64], [390, 601, 3, 64]].map(([width, height, dpr, edge]) => {
      renderer.resize(width, height, dpr)
      reference.width = reference.height = edge
      compare.imageSmoothingEnabled = false
      const scale = edge / 32
      function expected(x: number) {
        compare.drawImage(atlas, 0, 0, 32, 32, 0, 0, edge, edge)
        if (x > 0) compare.drawImage(atlas, 32, 0, 21, 26, 5 * scale, 4 * scale, 21 * scale, 26 * scale)
        if (x === 1) compare.drawImage(atlas, 53, 8, 11, 16, 15 * scale, 8 * scale, 11 * scale, 16 * scale)
        return compare.getImageData(0, 0, edge, edge).data
      }
      function matches(x: number) {
        const corner = renderer.project(x - 0.5, -0.5)
        const data = ctx.getImageData(Math.round(corner.x * dpr), Math.round(corner.y * dpr), edge, edge).data
        const target = expected(x)
        return data.every((value, i) => value === target[i])
      }
      renderer.setOptions({ idleIntensity: 0 })
      renderer.render(1)
      const still = [0, 1, 2].map(matches)
      const asleep = !renderer.animating
      renderer.setOptions({ idleIntensity: 1 })
      renderer.render(2)
      const animated = matches(0) && !matches(1) && !matches(2) && renderer.animating
      return { dpr, still, asleep, animated }
    })
  })
  expect(samples).toEqual([0.75, 1.25, 3].map(dpr => ({ dpr, still: [true, true, true], asleep: true, animated: true })))
})

test('projected terrain and small sprites retain fine detail when the view compresses tiles', smoke, async ({ page }) => {
  await page.goto('/testbed/dungeon.html')
  await page.waitForFunction(() => '__ready' in window)
  const samples = await page.evaluate(() => {
    const { renderer, scene, canvas } = window as unknown as { renderer: Render25d; scene: Scene; canvas: HTMLCanvasElement }
    const atlas = document.createElement('canvas')
    atlas.width = 64; atlas.height = 32
    const ink = atlas.getContext('2d')!
    // Every second floor row contains green. Alternating red columns expose
    // any horizontal blur when only the row spacing is compressed.
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      ink.fillStyle = `rgb(${x % 2 ? 240 : 16}, ${y % 2 ? 224 : 32}, 0)`
      ink.fillRect(x, y, 1, 1)
      ink.fillStyle = `rgb(${y % 2 ? 224 : 32}, 24, ${x % 2 ? 240 : 16})`
      ink.fillRect(x + 32, y, 1, 1)
    }
    renderer.setTiles({
      tile: id => ({ atlas: 'test', sx: id === 1 ? 0 : 32, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }),
      atlas: () => atlas,
      atlasNames: () => ['test'],
    })
    const template = [...scene.cells.values()].find(cell => cell.kind === 'floor' && cell.visibility === 'visible')!
    const cells: Scene['cells'] = new Map([0, 1].map(x => [(512 << 10) + x + 512, {
      ...template, x, y: 0, floorTile: 1, featureTile: undefined, underlays: [], overlays: [], icons: [], flash: undefined,
    }]))
    renderer.setScene({
      ...scene, cells, player: { x: 0, y: 0 }, playerOnLevel: true,
      billboards: [{ kind: 'monster', x: 1, y: 0, height: 1, tile: 2, damage: 'heavily_damaged' }],
    }, 0)
    // At this angle a 32-device-pixel tile has 16 rows of projected terrain.
    const tilt = Math.asin(0.4) * 180 / Math.PI
    renderer.setOptions({ tilt, animate: true, movement: false, dynamicLighting: false, idleIntensity: 0, center: null, fitSpan: null, zoom: 1 })
    const ctx = canvas.getContext('2d')!
    return [1, 1.25, 2, 3].map(dpr => {
      renderer.resize(704, 464, dpr)
      renderer.setOptions({ fitWidth: (32 * 18) / dpr, fitHeight: 464, tilt, idleIntensity: 0 })
      renderer.render(0)
      const floor = renderer.project(-0.5, -0.5)
      const floorRow = ctx.getImageData(Math.round(floor.x * dpr), Math.round(floor.y * dpr) + 7, 32, 1).data
      const floorPreserved = Array.from({ length: 32 }, (_, x) =>
        floorRow[x * 4] === (x % 2 ? 240 : 16) && Math.abs(floorRow[x * 4 + 1] - 128) <= 1).every(Boolean)

      const foot = renderer.project(1, 0.3)
      const body = ctx.getImageData(Math.round(foot.x * dpr - 16), Math.round(foot.y * dpr - 32), 32, 32).data
      const native = ink.getImageData(32, 0, 32, 32).data
      const nativeSprite = body.every((value, i) => value === native[i])

      renderer.setOptions({ fitWidth: (16 * 18) / dpr })
      const actorResults = [null, tilt].flatMap(tilt => [0, 1].map(idleIntensity => {
        renderer.setOptions({ tilt, idleIntensity })
        renderer.render(1)
        const q = renderer.project(1, tilt === null ? 0.5 : 0.3)
        const body = ctx.getImageData(Math.round(q.x * dpr) - 4, Math.round(q.y * dpr) - 12, 8, 8).data
        // The original red and blue stripes both influence most screen pixels.
        let mixed = 0
        for (let i = 0; i < body.length; i += 4) {
          if (body[i] > 70 && body[i] < 188 && body[i + 2] > 70 && body[i + 2] < 188) mixed++
        }
        return { tilt, idleIntensity, mixed, animating: renderer.animating }
      }))
      return { dpr, floorPreserved, nativeSprite, actorResults }
    })
  })
  for (const { dpr, floorPreserved, nativeSprite, actorResults } of samples) {
    expect(floorPreserved, `projected terrain at DPR ${dpr}`).toBe(true)
    expect(nativeSprite, `still 2.5D sprite at DPR ${dpr}`).toBe(true)
    for (const { tilt, idleIntensity, mixed, animating } of actorResults) {
      expect(mixed, `actor at DPR ${dpr}, tilt ${tilt}, idle ${idleIntensity}`).toBeGreaterThanOrEqual(48)
      expect(animating).toBe(idleIntensity > 0)
    }
  }
})

test('Shoals water moves without outlining the native depth transition', smoke, async ({ page }) => {
  await page.goto('/testbed/dungeon.html?scene=shoals')
  await page.waitForFunction(() => '__ready' in window)
  const samples = await page.evaluate(() => {
    const { renderer, scene, canvas } = window as unknown as { renderer: Render25d; scene: Scene; canvas: HTMLCanvasElement }
    renderer.setOptions({ center: { x: 0, y: 25.5 }, zoom: 3, movement: false })
    const ctx = canvas.getContext('2d')!
    function sample(time: number) {
      renderer.render(time)
      // The shallow tile's southern overlay meets the deep tile's own artwork here.
      const { x, y } = renderer.project(0, 25.5)
      const center = renderer.project(0, 26)
      return {
        edge: ctx.getImageData(Math.round(x) - 12, Math.round(y) - 1, 24, 2).data,
        interior: ctx.getImageData(Math.round(x) - 8, Math.round(center.y) - 8, 16, 16).data,
      }
    }
    const first = sample(5), second = sample(16)
    // Render the same atlas layers directly to obtain an independent reference.
    for (const cell of scene.cells.values()) cell.flags.water = false
    renderer.setScene({ ...scene, revision: scene.revision + 1 })
    const reference = sample(5).edge
    return {
      edgeError: Math.max(...reference.map((value, i) =>
        Math.max(Math.abs(value - first.edge[i]), Math.abs(value - second.edge[i])))),
      moving: first.interior.some((value, i) => Math.abs(value - second.interior[i]) > 2),
    }
  })
  expect(samples.edgeError).toBeLessThanOrEqual(1)
  expect(samples.moving).toBe(true)
})

test('LOS shading changes immediately at straight and diagonal tile boundaries by default', smoke, async ({ page }) => {
  await page.goto('/testbed/los-boundary-checks.html')
  await expect.poll(async () => {
    try { return (await result(page)).status } catch { return 'loading' }
  }).toMatch(/complete|error/)
  const report = await result(page)
  expect(report.status, JSON.stringify(report)).toBe('complete')
  expect(report.checks).toBe(32)
  expect(report.failures, JSON.stringify(report)).toEqual([])
})

test('ruined columns and similar wall-category props keep floor-supported silhouettes', smoke, async ({ page }) => {
  await page.goto('/testbed/scenery-terrain-checks.html')
  await expect.poll(async () => {
    try { return (await result(page)).status } catch { return 'loading' }
  }).toMatch(/complete|error/)
  const report = await result(page)
  expect(report.status, JSON.stringify(report)).toBe('complete')
  expect(report.checks).toBe(64)
  expect(report.failures, JSON.stringify(report)).toEqual([])
})

test('elemental splatters stay visible at tile scale and lightning has bright zigzag cores', smoke, async ({ page }) => {
  await page.goto('/testbed/elemental-checks.html')
  await expect.poll(async () => {
    try { return (await result(page)).status } catch { return 'loading' }
  }).toMatch(/complete|error/)
  const report = await result(page)
  expect(report.status, JSON.stringify(report)).toBe('complete')
  expect(report.checks).toBe(26)
  expect(report.failures, JSON.stringify(report)).toEqual([])
})

test('native spell tiles fade without deformation, settle and respect visibility and renderer pauses', smoke, async ({ page }) => {
  await page.goto('/testbed/spawn-checks.html')
  await expect.poll(async () => {
    try { return (await result(page)).status } catch { return 'loading' }
  }).toMatch(/complete|error/)
  const report = await result(page)
  expect(report.status, JSON.stringify(report)).toBe('complete')
  expect(report.checks).toBe(80)
  expect(report.failures, JSON.stringify(report)).toEqual([])
})

test('spell glyph and artwork updates preserve terrain with lighting and VFX enabled', smoke, async ({ page }) => {
  await page.goto('/testbed/spell-terrain-checks.html')
  await expect.poll(async () => {
    try { return (await result(page)).status } catch { return 'loading' }
  }, { timeout: 75_000 }).toMatch(/complete|error/)
  const report = await result(page)
  expect(report.status, JSON.stringify(report)).toBe('complete')
  expect(report.checks).toBe(240)
  expect(report.failures, JSON.stringify(report)).toEqual([])
})

const fullChecks = { tiles: 350, markers: 216, surfaces: 38, movement: 1134, depth: 189, visibility: 99, coherence: 648, corridors: 2430 }
// A smoke run still exercises every rendering concern; the profile reduces combinations.
const smokeChecks = { tiles: 20, markers: 16, surfaces: 19, movement: 126, depth: 14, visibility: 39, coherence: 48, corridors: 72 }
for (const lane of Object.keys(fullChecks) as (keyof typeof fullChecks)[]) {
  test(`raster: ${lane}`, smoke, async ({ page }, testInfo) => {
    const profile = testInfo.project.metadata.profile as 'smoke' | 'full'
    const checks = (profile === 'full' ? fullChecks : smokeChecks)[lane]
    await page.goto(`/testbed/dungeon-checks.html?lane=${lane}&profile=${profile}`)
    await expect.poll(async () => {
      try { return (await result(page)).status } catch { return 'loading' }
    }, { timeout: 75_000 }).toMatch(/complete|error/)
    const report = await result(page)
    expect(report.status, JSON.stringify(report)).toBe('complete')
    expect(report.profile).toBe(profile)
    expect(report.checks, `complete ${profile} matrix`).toBe(checks)
    expect(report.failures, JSON.stringify(report)).toEqual([])
    expect(report.passed).toBe(report.checks)
  })
}
