import { expect } from '@playwright/test'
import { UiState } from '../../packages/webtiles/src/protocol'
import { androidUserAgent, openHudSettings, result, smoke, test } from './fixtures'
import type {} from '../../apps/orbrun/testbed/map-lifecycle'

for (const touch of [false, true]) {
  test.describe(touch ? 'narrow touch' : 'narrow mouse', () => {
    test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: touch, deviceScaleFactor: 3 })
    test('readable HUD and repeated map/overview restoration', smoke, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ showCharacterPortrait: true })))
      await page.goto('/testbed/map-lifecycle.html')
      await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(touch)
      expect(await page.evaluate(() => screen.width)).toBe(390)
      const canvas = page.locator('canvas.view')
      const backingScale = () => canvas.evaluate(el => (el as HTMLCanvasElement).width / el.getBoundingClientRect().width)
      const dungeonScale = touch ? 1.5 : 1
      await expect(canvas).toHaveCSS('image-rendering', touch ? 'auto' : 'pixelated')
      await expect(page.locator('canvas.portrait')).toHaveCSS('image-rendering', touch ? 'auto' : 'pixelated')
      expect(await backingScale()).toBeCloseTo(dungeonScale)
      const layout = await page.locator('.stats').evaluate(el => {
        const rect = el.getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth }
      })
      expect(layout.left).toBeGreaterThanOrEqual(0)
      expect(layout.right).toBeLessThanOrEqual(layout.viewport)
      expect(layout.width).toBeGreaterThan(280)
      const overflow = await page.locator('.stats .line').evaluateAll(lines => lines
        .filter(line => line.textContent?.trim())
        .map(line => ({ text: line.textContent, width: line.clientWidth, content: line.scrollWidth })))
      expect(overflow.length).toBeGreaterThan(3)
      expect(overflow.filter(line => line.content > line.width + 1), 'clipped stats text').toEqual([])
      await page.getByRole('button', { name: 'Open level map', exact: true }).click()
      await expect.poll(async () => (await result(page)).renderer).toBe('Render2d')
      await expect(canvas).toHaveCSS('image-rendering', 'pixelated')
      expect(await backingScale()).toBeCloseTo(1)
      await expect.poll(async () => (await result(page)).cursor).toMatchObject({ x: 13, y: 7 })
      await page.getByRole('button', { name: 'Change tilt and zoom', exact: true }).click()
      expect((await result(page)).renderer).toBe('Render2d')
      await page.getByRole('button', { name: 'Open overview', exact: true }).click()
      await expect(page.getByText('Dungeon overview', { exact: true })).toBeVisible()
      expect((await result(page)).renderer).toBe('Render2d')
      await page.getByRole('button', { name: 'Close view', exact: true }).click()
      await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
      expect(await result(page)).toMatchObject({ tilt: 65, zoom: 1.2, cursor: null, canvases: 1, appliedDungeonOptions: { tilt: 65, zoom: 1.2, filterCreatureScaling: touch } })
      expect(await backingScale()).toBeCloseTo(dungeonScale)
      await page.setViewportSize({ width: 640, height: 720 })
      await page.getByRole('button', { name: 'Open level map', exact: true }).click()
      await expect.poll(async () => (await result(page)).renderer).toBe('Render2d')
      await page.getByRole('button', { name: 'Close view', exact: true }).click()
      await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
      const state = await result(page)
      expect(state.created - state.destroyed).toBe(1)
      expect(state.canvases).toBe(1)
      await page.getByRole('button', { name: 'Target creature', exact: true }).click()
      await expect.poll(async () => (await result(page)).cursor).toMatchObject({ x: 11, y: 3 })
      await page.locator('canvas.view').press('ArrowRight')
      await expect.poll(async () => JSON.stringify((await result(page)).sent)).toContain('"l"')
    })
  })
}

test.describe('desktop browser zoom below 100%', () => {
  test.use({ deviceScaleFactor: 0.75 })

  test('the flat map uses the browser pixel ratio', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html')
    await page.getByRole('button', { name: 'Open level map', exact: true }).click()
    await expect.poll(async () => (await result(page)).renderer).toBe('Render2d')
    const scale = await page.locator('canvas.view').evaluate(el => (el as HTMLCanvasElement).width / el.getBoundingClientRect().width)
    expect(scale).toBeCloseTo(0.75)
  })
})

test.describe('cog menu on a touch tablet', () => {
  const viewport = { width: 848, height: 838 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('fits the landscape viewport above the menu controls, including settings', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => window.__orbrunMapLifecycle.ready())
    await expect(page.locator('.game')).toHaveClass(/touch-landscape/)
    await page.getByRole('button', { name: 'Open system menu', exact: true }).tap()

    const stack = page.locator('.overlay-stack')
    const menu = stack.locator(':scope > .popup.command-menu[data-client]')
    const menuControls = page.locator('.hud .touchbar.context-controls')
    const checkBounds = async (safeLeft = 0) => {
      await expect(menu).toBeVisible()
      await expect.poll(async () => {
        const available = (await stack.boundingBox())!
        const box = (await menu.boundingBox())!
        return box.x >= available.x + Math.max(safeLeft, 8) - 1 && box.x + box.width <= available.x + available.width - 7 &&
          box.y >= available.y && box.y + box.height <= available.y + available.height + 1
      }).toBe(true)
    }

    await checkBounds()
    await expect(menuControls.getByRole('button')).toHaveCount(6)
    await expect(menu.getByRole('tab', { name: 'Character' })).toBeInViewport({ ratio: 1 })
    await expect(menu.getByRole('button', { name: /^Skills/ })).toHaveClass(/focused/)
    await menuControls.getByRole('button', { name: 'Next', exact: true }).tap()
    await expect(menu.getByRole('button', { name: /^Character status/ })).toHaveClass(/focused/)
    await menuControls.getByRole('button', { name: 'Previous', exact: true }).tap()
    await expect(menu.getByRole('button', { name: /^Skills/ })).toHaveClass(/focused/)
    const right = menuControls.getByRole('button', { name: 'Right', exact: true })
    const left = menuControls.getByRole('button', { name: 'Left', exact: true })
    await right.tap()
    await expect(menu.getByRole('tab', { name: 'System' })).toHaveAttribute('aria-selected', 'true')
    await menu.getByRole('button', { name: 'Settings', exact: true }).tap()
    await checkBounds()
    await menu.getByRole('button', { name: 'Interface', exact: true }).tap()
    await expect(menu.getByRole('button', { name: 'Layout next', exact: true })).toBeVisible()
    const layout = menu.locator('[data-focus="setting:Layout"]')
    await expect(layout).toHaveClass(/focused/)
    await right.tap()
    await expect(layout.locator('.val')).toHaveText('Phone portrait')
    await left.tap()
    await expect(layout.locator('.val')).toHaveText('Auto')
    await checkBounds()

    const device = await page.context().newCDPSession(page)
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 36, right: 10 } })
    await page.setViewportSize({ width: 690, height: 620 })
    await expect.poll(() => stack.evaluate(el => el.parentElement!.clientWidth)).toBe(690)
    await checkBounds(36)
    const back = menuControls.getByRole('button', { name: 'Esc', exact: true })
    await expect(back).toBeInViewport({ ratio: 1 })
    await back.tap()
    await expect(menu.getByRole('button', { name: 'Interface', exact: true })).toBeVisible()
    await back.tap()
    await expect(menu.getByRole('tab', { name: 'System' })).toBeVisible()
    await back.tap()
    await expect(menu).toBeHidden()
    const compass = page.locator('.touchbar.split')
    await expect(compass.getByRole('button', { name: 'Northwest' })).toBeVisible()
    await expect(compass.getByRole('button', { name: 'Fight', exact: true })).toBeVisible()
  })
})

test('Interface layout presets apply live and preserve the Action panel preference', smoke, async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html?action-panel')
  const game = page.locator('.screen.game')
  const hud = page.locator('.hud')
  const stats = hud.locator('.stats')
  const panel = page.getByTitle('Show the action panel')
  const compass = hud.locator('.touchbar.split').getByRole('button', { name: 'Northwest' })
  const preset = page.locator('[data-focus="setting:Layout"] .val')
  const actionPanel = page.locator('[data-focus="setting:Action panel"] .val')
  const next = page.getByRole('button', { name: 'Layout next', exact: true })
  await expect(panel).toBeVisible()
  await expect(hud).not.toHaveClass(/mobile-dungeon/)
  await openHudSettings(page)
  await expect(preset).toHaveText('Auto')
  const check = async (name: string, landscape: boolean) => {
    await next.click()
    await expect(preset).toHaveText(name)
    await expect(hud).toHaveClass(/mobile-dungeon/)
    if (landscape) await expect(hud).toHaveClass(/mobile-landscape/)
    else await expect(hud).not.toHaveClass(/mobile-landscape/)
    await expect(hud.locator('.touchbar.context-controls').getByRole('button')).toHaveCount(6)
    return stats.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  }
  const phonePortraitFont = await check('Phone portrait', false)
  const phoneLandscapeFont = await check('Phone landscape', true)
  expect(await check('Tablet portrait', false)).toBeGreaterThan(phonePortraitFont)
  expect(await check('Tablet landscape', true)).toBeGreaterThan(phoneLandscapeFont)
  await expect(actionPanel).toHaveText('On')
  await page.getByRole('button', { name: 'Action panel next', exact: true }).click()
  await expect(panel).toBeHidden()
  await page.reload()
  await expect(hud).toHaveClass(/mobile-landscape/)
  await expect(compass).toBeVisible()
  await expect(panel).toBeHidden()
  await page.keyboard.press('ArrowUp')
  await expect(compass).toBeVisible()
  await page.setViewportSize({ width: 390, height: 700 })
  await expect(hud).not.toHaveClass(/mobile-landscape/)
  await expect(compass).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(hud).toHaveClass(/mobile-landscape/)
  await openHudSettings(page)
  await expect(preset).toHaveText('Tablet landscape')
  await expect(actionPanel).toHaveText('Off')
  await next.click()
  await expect(preset).toHaveText('Desktop')
  await expect(hud).not.toHaveClass(/mobile-dungeon/)
  await expect(compass).toBeHidden()
  await page.getByRole('button', { name: 'Action panel next', exact: true }).click()
  await expect(panel).toBeVisible()
  await page.reload()
  const cog = game.getByRole('button', { name: 'Open system menu' })
  await expect(cog).toBeVisible()
  await cog.click()
  await page.getByRole('tab', { name: 'System', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-groups').getByText('Interface', { exact: true }).click()
  await next.click()
  await expect(preset).toHaveText('Auto')
  await expect(hud).not.toHaveClass(/mobile-dungeon/)
})

async function expectMapAndListAligned(page: import('@playwright/test').Page, compact: boolean, anchor: 'Left' | 'Center' | 'Right' = 'Center', gap = 12) {
  const map = page.locator('.minimap-button')
  const monster = page.locator('.monsters .group').first()
  await expect(map).toBeVisible()
  await expect(monster).toBeVisible()
  await expect.poll(async () => {
    const m = (await map.boundingBox())!
    const row = (await monster.boundingBox())!
    const sidebar = (await page.locator('.sidebar').boundingBox())!
    const columnWidth = compact ? row.x - sidebar.x - gap : sidebar.width
    const fraction = { Left: 0, Center: 0.5, Right: 1 }[anchor]
    const aligned = Math.abs(m.x - sidebar.x - (columnWidth - m.width) * fraction) <= 1
    const separated = compact
      ? Math.abs(m.y - row.y) <= 1 && row.x >= m.x + m.width + gap - 1
      : row.y >= m.y + m.height + gap - 1
    const list = (await page.locator('.monsters').boundingBox())!
    const listAligned = compact || Math.abs(list.x + list.width * fraction - (m.x + m.width * fraction)) <= 1
    return aligned && separated && listAligned
  }).toBe(true)
}

test('desktop minimap shows the explored level, inspects locally and applies saved settings', async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html?mobile-hud')
  await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
  await expect(page.locator('.minimap-button')).toBeHidden()
  await page.evaluate(() => window.__orbrunMapLifecycle.ready())
  await expect(page.locator('.minimap-button')).toBeVisible()
  await page.goto('/testbed/map-lifecycle.html')
  // Keep the fixture's diagnostics from resizing the dungeon after the first draw.
  await page.addStyleTag({ content: '#result { height: 3em }' })
  await page.evaluate(() => document.fonts.ready)
  await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
  const button = page.getByRole('button', { name: 'Dungeon minimap, open level map' })
  const map = button.locator('canvas')
  const outline = button.locator('.minimap-window')
  await expect(button).toBeVisible()
  const terrain = await map.evaluate(el => {
    const canvas = el as HTMLCanvasElement
    const { width, height } = canvas
    const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
    for (let i = 0; i < data.length; i += 4) {
      // A terrain cell away from the white player marker and the black background.
      if (data[i] > 0 && data[i] < 255) return { x: ((i / 4) % width + 0.5) / width, y: (Math.floor(i / 4 / width) + 0.5) / height }
    }
    return null
  })
  expect(terrain).not.toBeNull()
  const box = (await map.boundingBox())!
  const before = await outline.getAttribute('style')
  const sent = await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
  await page.mouse.move(box.x + terrain!.x * box.width, box.y + terrain!.y * box.height)
  await page.mouse.down({ button: 'right' })
  await expect.poll(() => outline.getAttribute('style')).not.toBe(before)
  await page.mouse.up({ button: 'right' })
  await expect(outline).toHaveAttribute('style', before!)
  expect(await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)).toEqual(sent)

  await button.click()
  await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'input', text: 'X' })
  await page.locator('#map').click()
  await expect(button).toBeHidden()
  await page.locator('#close').click()
  await expect(button).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expectMapAndListAligned(page, true)
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(button).toBeVisible()

  await openHudSettings(page)
  // The raster includes the explored terrain and player. Resizing the panel
  // should preserve every pixel, even when it gets smaller.
  const raster = () => map.evaluate(el => (el as HTMLCanvasElement).toDataURL())
  const originalRaster = await raster()
  const nextSize = page.getByRole('button', { name: 'Minimap size next', exact: true })
  await nextSize.click()
  await expectMapAndListAligned(page, false)
  await expect.poll(async () => (await map.boundingBox())!.width).toBeGreaterThan(box.width)
  expect(await raster()).toBe(originalRaster)
  await nextSize.click()
  await expectMapAndListAligned(page, false)
  await expect.poll(async () => (await map.boundingBox())!.width).toBeLessThan(box.width)
  expect(await raster()).toBe(originalRaster)
  const align = page.getByRole('button', { name: 'Minimap alignment next', exact: true })
  await align.click()
  await expectMapAndListAligned(page, false, 'Right')
  const right = await map.boundingBox()
  await nextSize.click()
  await expectMapAndListAligned(page, false, 'Right')
  const resized = await map.boundingBox()
  expect(Math.abs((right!.x + right!.width) - (resized!.x + resized!.width))).toBeLessThanOrEqual(1)
  await align.click()
  await expectMapAndListAligned(page, false, 'Left')
  const savedWidth = (await map.boundingBox())!.width
  const nextOutline = page.getByRole('button', { name: 'Minimap outer outline next', exact: true })
  await expect(button).toHaveCSS('box-shadow', 'none')
  for (const frame of [true, false]) {
    await nextOutline.click()
    await expect.poll(() => button.evaluate(el => getComputedStyle(el).boxShadow !== 'none')).toBe(frame)
    await expect(outline).toBeVisible()
    expect(await raster()).toBe(originalRaster)
  }
  const backing = () => button.evaluate(el => getComputedStyle(el).backgroundColor)
  const initialBacking = await backing()
  await expect(page.locator('[data-focus="setting:Minimap background opacity"] .val')).toHaveText('0%')
  await page.getByRole('button', { name: 'Minimap background opacity next', exact: true }).click()
  await expect.poll(backing).not.toBe(initialBacking)
  const adjustedBacking = await backing()
  expect(await raster()).toBe(originalRaster)

  await page.getByRole('button', { name: 'Minimap next', exact: true }).click()
  await expect(map).toBeHidden()
  await page.reload()
  await expect(page.locator('.stats')).toContainText('Map lifecycle')
  await expect(map).toBeHidden()
  await openHudSettings(page)
  await page.getByRole('button', { name: 'Minimap next', exact: true }).click()
  await expect.poll(async () => (await map.boundingBox())!.width).toBe(savedWidth)
  expect(await backing()).toBe(adjustedBacking)
  await expectMapAndListAligned(page, false, 'Left')
  await expect(button).toHaveCSS('box-shadow', 'none')
  await expect(outline).toBeVisible()
})

for (const [orientation, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]] as const) {
  test.describe(`phone minimap in ${orientation}`, () => {
    test.use({ viewport: { width, height }, screen: { width, height }, hasTouch: true, isMobile: true })

    test('uses the orientation’s default placement and opens the map by touch', async ({ page }) => {
      const landscape = orientation === 'landscape'
      const insets = landscape ? { left: 36, top: 0, right: 10, bottom: 16 } : { left: 0, top: 12, right: 0, bottom: 24 }
      const device = await page.context().newCDPSession(page)
      await device.send('Emulation.setSafeAreaInsetsOverride', { insets })
      await page.goto('/testbed/map-lifecycle.html?mobile-hud')
      const map = page.getByRole('button', { name: 'Dungeon minimap, open level map' })
      const mapButton = page.locator('.touchbar.split').getByRole('button', { name: 'Map', exact: true })
      const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
      const showMap = (state: number) => page.evaluate(state => window.__orbrunMapLifecycle.receive({ msg: 'ui_state', state }), state)
      const openMap = async (opener: typeof map) => {
        const before = await sent()
        await opener.tap()
        await expect.poll(sent).toEqual([...before, { msg: 'input', text: 'X' }])
        await showMap(UiState.VIEW_MAP)
        await expect.poll(async () => (await result(page)).renderer).toBe('Render2d')
        await expect(map).toBeHidden()
        await expect(mapButton).toBeHidden()
        return page.locator('.touchbar.split').getByRole('button', { name: 'Find…', exact: true })
      }
      const load = async () => {
        const loading = page.getByText('Loading game data…', { exact: true })
        await expect(loading).toBeVisible()
        await page.evaluate(() => window.__orbrunMapLifecycle.ready())
        await expect(loading).toBeHidden()
      }
      const checkPlacement = async () => {
        await expectMapAndListAligned(page, landscape, landscape ? 'Center' : 'Left', landscape ? 12 : 4)
        if (landscape) {
          const box = (await map.boundingBox())!
          const stats = (await page.locator('.hud .stats').boundingBox())!
          const controls = (await page.locator('.touchbar.split').boundingBox())!
          expect(box.y).toBeGreaterThanOrEqual(stats.y + stats.height)
          expect(controls.y).toBeGreaterThan(box.y + box.height)
        } else {
          const box = (await map.boundingBox())!
          const panel = (await page.locator('.action-panel canvas').boundingBox())!
          expect(box.x).toBe(insets.left + 8)
          expect(box.y).toBeGreaterThan(panel.y + panel.height)
          const portrait = (await page.locator('.monsters .group canvas.picture').first().boundingBox())!
          expect(portrait.height).toBeLessThan(32)
        }
      }
      await load()
      await checkPlacement()
      for (const size of ['Small', 'Large']) {
        await page.evaluate(minimapSize => localStorage.setItem('orbrun.settings', JSON.stringify({ minimapSize })), size)
        await page.reload()
        await load()
        await checkPlacement()
      }
      if (landscape) {
        await page.setViewportSize({ width: 740, height: 265 })
        await expect.poll(async () => (await page.locator('canvas.view').boundingBox())!.height).toBe(265)
        await checkPlacement()
      }
      await expect(await openMap(map)).toBeVisible()
      await showMap(UiState.NORMAL)
      await checkPlacement()

      if (!landscape) {
        await page.setViewportSize({ width: 320, height: 560 })
        await expect.poll(() => page.locator('canvas.view').boundingBox().then(box => box?.width)).toBe(320)
        await checkPlacement()
        await openHudSettings(page)
        await page.getByRole('button', { name: 'Minimap next', exact: true }).tap()
        await expect(map).toBeHidden()
        await page.reload()
        await load()
        await expect(map).toBeHidden()
        const list = page.locator('.monsters')
        await expect(list.getByText('goblin', { exact: true })).toBeVisible()
        expect((await list.boundingBox())!.x).toBe(insets.left + 8)
      }
      const find = await openMap(mapButton)
      await find.tap()
      await expect(page.getByRole('button', { name: 'Items on this level', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Search items…', exact: true })).toBeVisible()
    })
  })
}

for (const narrow of [false, true]) {
  test.describe(narrow ? 'narrow HUD' : 'desktop HUD', () => {
    test.use(narrow ? { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true } : {})

    test('HUD portrait and nearby monsters respect their independent settings', async ({ page }) => {
      await page.goto('/testbed/map-lifecycle.html')
      const stats = page.locator('.hud .stats')
      const portrait = stats.locator('canvas.portrait')
      const monsters = page.locator('.hud .monsters')
      await expect(stats.getByText('Map lifecycle', { exact: true })).toBeVisible()
      await expect(page.locator('.system-menu-button')).toBeVisible({ visible: narrow })
      await expect(portrait).toBeHidden()
      await expect(monsters.getByText('goblin')).toBeVisible()
      await expect(page.locator('.minimap-button')).toBeVisible()

      await openHudSettings(page)
      const portraitValue = page.locator('[data-focus="setting:Character portrait"] .val')
      const monstersValue = page.locator('[data-focus="setting:Nearby monsters"] .val')
      await expect(portraitValue).toHaveText('Off')
      await expect(monstersValue).toHaveText('On')
      await page.getByRole('button', { name: 'Nearby monsters previous' }).click()
      await expect(monstersValue).toHaveText('Off')
      await page.getByRole('button', { name: 'Character portrait next' }).click()
      await expect(portrait).toBeVisible()
      await expect(monsters).toBeHidden()
      await page.getByRole('button', { name: 'Nearby monsters previous' }).click()
      await expect(monstersValue).toHaveText('On')
      await expect(monsters.getByText('goblin')).toBeVisible()
      await page.getByRole('button', { name: 'Character portrait next' }).click()
      await expect(portrait).toBeHidden()
      await expect(monsters.getByText('goblin')).toBeVisible()

      await page.reload()
      await expect(stats.getByText('Map lifecycle', { exact: true })).toBeVisible()
      await expect(portrait).toBeHidden()
      await expect(monsters.getByText('goblin')).toBeVisible()
      await page.evaluate(async () => {
        await document.fonts.ready
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      })
      const statsBounds = (await stats.boundingBox())!
      const listBounds = (await monsters.boundingBox())!
      if (narrow) expect(listBounds.y + listBounds.height).toBeLessThan(statsBounds.y)
      else expect(listBounds.y).toBeGreaterThanOrEqual(statsBounds.y + statsBounds.height)
    })
  })
}

for (const [layout, width, height, hasTouch] of [
  ['desktop', 1280, 720, false],
  ['narrow desktop', 390, 844, false],
  ['upright phone', 390, 844, true],
] as const) {
  test.describe(layout, () => {
    test.use({ viewport: { width, height }, screen: { width, height }, hasTouch })

    test('character panel scale shrinks the stats and portrait in place and persists', async ({ page }) => {
      await page.addInitScript(() => {
        if (!localStorage.getItem('orbrun.settings')) {
          localStorage.setItem('orbrun.settings', JSON.stringify({ showCharacterPortrait: true, showNearbyMonsters: true }))
        }
      })
      await page.goto('/testbed/map-lifecycle.html')
      const stats = page.locator('.hud .stats')
      const portrait = stats.locator('canvas.portrait')
      const messages = page.locator('.hud .messages')
      const title = stats.getByText('Map lifecycle', { exact: true })
      await expect(title).toBeVisible()
      await expect(portrait).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const measure = () => stats.evaluate(el => {
        const box = el.getBoundingClientRect()
        return {
          width: box.width, right: box.right,
          font: parseFloat(getComputedStyle(el).fontSize),
          row: el.querySelector('.line')!.getBoundingClientRect().height,
          portrait: el.querySelector('canvas')!.getBoundingClientRect().width,
        }
      })
      const before = await measure()
      const messageFont = await messages.evaluate(el => getComputedStyle(el).fontSize)
      await openHudSettings(page)
      const value = page.locator('[data-focus="setting:Character panel scale"] .val')
      await expect(value).toHaveText('100%')
      if (hasTouch) {
        const slider = page.getByRole('slider', { name: 'Character panel scale', exact: true })
        await slider.scrollIntoViewIfNeeded()
        const { x, y, width, height } = (await slider.boundingBox())!
        const centerY = y + height / 2
        const device = await page.context().newCDPSession(page)
        await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x + width - 6, y: centerY }] })
        try {
          await device.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + width / 2, y: centerY }] })
          await expect.poll(async () => (await measure()).font / before.font).toBeCloseTo(0.8, 2)
        } finally { await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
      } else {
        const previous = page.getByRole('button', { name: 'Character panel scale previous', exact: true })
        await previous.click()
        await previous.click()
      }
      await expect(value).toHaveText('80%')
      await expect.poll(async () => (await measure()).font / before.font).toBeCloseTo(0.8, 2)
      await page.reload()
      await expect(title).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const after = await measure()
      expect(after.right).toBeCloseTo(before.right, 0)
      for (const dimension of ['width', 'font', 'row', 'portrait'] as const) {
        expect(after[dimension] / before[dimension], dimension).toBeCloseTo(0.8, 2)
      }
      await expect(messages).toHaveCSS('font-size', messageFont)
      const monsters = page.locator('.hud .monsters')
      await expect(monsters.getByText('goblin')).toBeVisible()
      const panel = (await stats.boundingBox())!
      const list = (await monsters.boundingBox())!
      if (hasTouch) expect(list.y + list.height).toBeLessThan(panel.y)
      else expect(list.y).toBeGreaterThanOrEqual(panel.y + panel.height)
    })
  })
}
