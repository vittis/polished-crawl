import { menuReplayCheck } from './menu-replay'
import { expect } from '@playwright/test'
import { Keys, MouseMode, UiState } from '../../packages/webtiles/src/protocol'
import { MSGCH } from '../../packages/webtiles/src/state'
import type { PadEvent } from '../../apps/orbrun/src/gamepad'
import { test, result } from './fixtures'

type LiveAnimation = { receive(msg: Record<string, unknown>): void; pad(event: PadEvent): void; walk(): void; destroy(): void; snapshot(): { xl: number; sent: unknown[]; playerProjection: { x: number; y: number; scale: number } } }

type MapWindow = Window & { __orbrunMapLifecycle: { receive(msg: Record<string, unknown>): void; pad(event: PadEvent): void; snapshot(): { sent: unknown[]; presentation: string; tileSize: number | null; cursor: { x: number; y: number; mode: string } | null }; projectCell(x: number, y: number): { x: number; y: number } | null; ready(): void; showSpellbook(): void } }
const androidUserAgent = 'Mozilla/5.0 (Linux; Android 15) Chrome/144.0.0.0 Mobile Safari/537.36'

test('tiles beneath the message log respond to the mouse and a pending pause still takes the click', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ messageLines: 16, depthZoom: 1.4 })))
  await page.goto('/testbed/map-lifecycle.html')
  await page.addStyleTag({ content: '#controls { display: none }' })
  await page.evaluate(() => document.fonts.ready)
  const log = page.locator('.hud .messages')
  const view = page.locator('canvas.view')
  const receive = (msg: Record<string, unknown>) => page.evaluate(message => (window as unknown as MapWindow).__orbrunMapLifecycle.receive(message), msg)
  const snapshot = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot())
  await receive({ msg: 'msgs', messages: [{ text: 'You climb downwards.' }] })
  await expect(log).toContainText('You climb downwards.')
  const tile = { x: 13, y: 6 }
  const sent: unknown[] = []
  for (const viewport of [{ width: 1280, height: 720 }, { width: 540, height: 600 }]) {
    await page.setViewportSize(viewport)
    const position = await view.evaluate((canvas, { x, y }) => {
      const { left, top } = canvas.getBoundingClientRect()
      const point = (window as unknown as MapWindow).__orbrunMapLifecycle.projectCell(x, y)!
      return { x: left + point.x, y: top + point.y }
    }, tile)
    const bounds = (await log.boundingBox())!
    expect(position.x).toBeGreaterThan(bounds.x)
    expect(position.x).toBeLessThan(bounds.x + bounds.width)
    expect(position.y).toBeGreaterThan(bounds.y)
    expect(position.y).toBeLessThan(bounds.y + bounds.height)
    await page.mouse.move(position.x, position.y)
    await expect.poll(async () => (await snapshot()).cursor).toMatchObject({ ...tile, mode: 'examine' })
    await page.screenshot({ path: `test-results/tile-through-message-log-${viewport.width}.png` })
    await page.mouse.click(position.x, position.y)
    sent.push({ msg: 'click_cell', ...tile, button: 1 })
    expect((await snapshot()).sent).toEqual(sent)
    await page.mouse.click(position.x, position.y, { button: 'right' })
    sent.push({ msg: 'click_cell', ...tile, button: 3 })
    expect((await snapshot()).sent).toEqual(sent)
    await page.mouse.move(0, 0)
    await expect.poll(async () => (await snapshot()).cursor).toBeNull()

    await receive({ msg: 'msgs', more: true, messages: [{ text: 'The dungeon falls quiet.' }] })
    await expect(log.locator('.more')).toHaveText('--more--')
    await page.mouse.click(position.x, position.y)
    sent.push({ msg: 'key', keycode: 32 })
    expect((await snapshot()).sent).toEqual(sent)
    await receive({ msg: 'msgs', more: false })
    await expect(log).not.toHaveClass(/\bmore\b/)
  }
})

for (const touch of [false, true]) {
  test.describe(touch ? 'nearby monster touch' : 'nearby monster mouse', () => {
    const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }
    test.use({ viewport, screen: viewport, hasTouch: touch })

    test('each portrait in a group opens that monster’s inspection', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ showNearbyMonsters: true })))
      await page.goto('/testbed/map-lifecycle.html?nearby-monsters')
      await page.addStyleTag({ content: '#controls { display: none }' })
      const group = page.locator('.monsters .group').filter({ hasText: '2 goblins' })
      const portraits = group.getByRole('button', { name: /^Inspect goblin/ })
      const sent = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
      const body = page.locator('.popup .body')
      const expected: unknown[] = []
      await expect(portraits).toHaveCount(2)
      await page.screenshot({ path: `test-results/nearby-monsters-${viewport.width}.png` })

      for (const [i, x] of [11, 12].entries()) {
        const portrait = portraits.nth(i)
        if (touch) await portrait.tap()
        else await portrait.click()
        expected.push({ msg: 'click_cell', x, y: 3, button: 3 })
        await expect.poll(sent).toEqual(expected)
        const description = i === 0 ? 'This goblin is sleeping.' : 'This goblin is poisoned.'
        await page.evaluate(body => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({
          msg: 'ui-push', type: 'describe-monster', title: 'a goblin', body,
        }), description)
        await expect(body).toHaveText(description)
        await expect(portraits).toHaveCount(0)
        await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({ msg: 'ui-pop' }))
        await expect(body).toBeHidden()
      }

      // A same-species replacement can arrive while the old portrait is still drawn.
      await portraits.first().evaluate(button => {
        const game = (window as unknown as MapWindow).__orbrunMapLifecycle
        game.receive({ msg: 'map', cells: [{ x: 11, y: 3, mon: { id: 3, name: 'goblin', att: 0 } }] })
        ;(button as HTMLButtonElement).click()
      })
      expect(await sent()).toEqual(expected)
    })
  })
}

test('nearby hover opens its cursor tooltip immediately and loads each monster once', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ showNearbyMonsters: true })))
  await page.goto('/testbed/map-lifecycle.html?nearby-monsters')
  await page.addStyleTag({ content: '#controls { display: none }' })
  const group = page.locator('.monsters .group').filter({ hasText: '2 goblins' })
  const name = group.getByText('2 goblins', { exact: true })
  const portrait = group.getByRole('button', { name: 'Inspect goblin (2 of 2)', exact: true })
  const image = group.locator('canvas.picture')
  await expect(portrait).toBeVisible()
  const center = async (el: typeof portrait) => {
    const box = (await el.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const imageCenter = async (index: number) => {
    const box = (await image.boundingBox())!
    return { x: box.x + (index + 0.5) * box.width / 2, y: box.y + box.height / 2 }
  }
  const gapCenter = async () => {
    const picture = (await image.boundingBox())!
    const label = (await name.boundingBox())!
    const pictureRight = picture.x + picture.width
    expect(label.x).toBeGreaterThan(pictureRight)
    return { x: (pictureRight + label.x) / 2, y: label.y + label.height / 2 }
  }
  const nameAt = await center(name)
  const firstAt = await imageCenter(0)
  const portraitAt = await imageCenter(1)
  const gapAt = await gapCenter()
  const start = new Date()
  await page.clock.install({ time: start })
  await page.clock.pauseAt(new Date(start.getTime() + 1000))
  const receive = (msg: Record<string, unknown>) => page.evaluate(message => (window as unknown as MapWindow).__orbrunMapLifecycle.receive(message), msg)
  const sent = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent as { msg: string; keycode?: number }[])
  const inspections = async () => (await sent()).filter(m => m.msg === 'click_cell')
  const closes = async () => (await sent()).filter(m => m.msg === 'key' && m.keycode === 27)
  const tooltip = page.locator('.monster-tooltip')

  await page.mouse.move(firstAt.x, firstAt.y)
  expect(await tooltip.isVisible()).toBe(true)
  await expect(tooltip).toHaveText('Loading description…')
  await expect(tooltip).toHaveAttribute('data-loading', '')
  await page.screenshot({ path: 'test-results/nearby-portrait-loading.png' })
  const first = { msg: 'click_cell', x: 11, y: 3, button: 3 }
  await page.mouse.move(gapAt.x, gapAt.y)
  await expect(tooltip).toHaveText('Loading description…')
  await page.mouse.move(nameAt.x, nameAt.y)
  await expect(tooltip).toHaveText('Loading description…')
  expect(await inspections()).toEqual([first])
  await receive({
    msg: 'ui-push', type: 'describe-monster', title: 'a goblin',
    body: 'This goblin is sleeping.\n\nSPELLSET_PLACEHOLDER', quote: 'Its quote.', status: 'Its status.',
    spellset: [{ spells: [{ letter: 'a', title: 'Magic Dart' }] }],
  })
  await page.clock.runFor(100)
  await expect(tooltip).toHaveText('This goblin is sleeping. Magic Dart')
  await expect(tooltip).toHaveCSS('pointer-events', 'none')
  await expect(tooltip.getByRole('button')).toHaveCount(0)
  await expect(page.locator('.type-describe-monster')).toHaveCount(0)
  const bounds = (await tooltip.boundingBox())!
  expect(bounds.x > nameAt.x || bounds.x + bounds.width < nameAt.x).toBe(true)
  await page.screenshot({ path: 'test-results/nearby-tooltip-desktop.png' })
  expect(await closes()).toHaveLength(1)
  const opening = await sent()
  await page.keyboard.press('!')
  expect(await sent()).toEqual(opening)

  // A second cold hover appears immediately while the first server window
  // closes. Its request waits for that close before going out.
  await page.mouse.move(portraitAt.x, portraitAt.y)
  await expect(tooltip).toHaveText('Loading description…')
  expect(await inspections()).toEqual([first])
  await receive({ msg: 'input_mode', mode: 0 })
  await receive({ msg: 'ui-pop' })
  expect(await inspections()).toEqual([first])
  await receive({ msg: 'input_mode', mode: 1 })
  expect(await inspections()).toEqual([first, { ...first, x: 12 }])

  await page.mouse.move(gapAt.x, gapAt.y)
  await expect(tooltip).toHaveText('Loading description…')
  await page.mouse.move(nameAt.x, nameAt.y)
  expect(await tooltip.isVisible()).toBe(true)
  await expect(tooltip).toHaveText('This goblin is sleeping. Magic Dart')
  await expect(tooltip).not.toHaveAttribute('data-loading')
  await page.mouse.move(2, 400)
  await expect(tooltip).toBeHidden()
  await page.mouse.move(firstAt.x, firstAt.y)
  expect(await tooltip.isVisible()).toBe(true)
  await expect(tooltip).not.toHaveAttribute('data-loading')
  expect(await inspections()).toEqual([first, { ...first, x: 12 }])
  await page.mouse.move(2, 400)
  await receive({ msg: 'ui-push', type: 'describe-monster', title: 'a goblin', body: 'It arrived after mouseout.' })
  await page.clock.runFor(100)
  await expect(tooltip).toBeHidden()
  await expect(page.locator('.type-describe-monster')).toHaveCount(0)
  expect(await closes()).toHaveLength(2)
  await page.mouse.click(portraitAt.x, portraitAt.y)
  expect(await inspections()).toHaveLength(2)
  await receive({ msg: 'ui-pop' })
  expect(await inspections()).toEqual([first, { ...first, x: 12 }, { ...first, x: 12 }])
  await receive({ msg: 'ui-push', type: 'describe-monster', title: 'a goblin', body: 'Manual inspection.' })
  await page.clock.runFor(100)
  await expect(page.locator('.type-describe-monster .body')).toHaveText('Manual inspection.')
  await page.mouse.click(2, 400)
  await receive({ msg: 'ui-pop' })
  await receive({ msg: 'player', turn: 1 })
  // A server redraw can reintroduce the same ID with a fresh protocol object.
  await receive({ msg: 'map', cells: [{ x: 11, y: 3, mon: null }] })
  await receive({ msg: 'map', cells: [{ x: 11, y: 3, mon: { id: 1, name: 'goblin', plural: 'goblins', att: 0 }, t: { fg: 7209 } }] })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.runFor(100)
  const narrowGap = await gapCenter()
  await page.mouse.move(narrowGap.x, narrowGap.y)
  expect(await tooltip.isVisible()).toBe(true)
  await expect(tooltip).toHaveText('This goblin is sleeping. Magic Dart')
  const narrowAt = await imageCenter(0)
  await page.mouse.move(narrowAt.x, narrowAt.y)
  expect(await tooltip.isVisible()).toBe(true)
  await expect(tooltip).not.toHaveAttribute('data-loading')
  await expect(tooltip).toHaveText('This goblin is sleeping. Magic Dart')
  await page.clock.runFor(700)
  expect(await inspections()).toHaveLength(3)
  const narrowBounds = (await tooltip.boundingBox())!
  expect(narrowBounds.x).toBeGreaterThanOrEqual(0)
  expect(narrowBounds.x + narrowBounds.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/nearby-tooltip-narrow.png' })
})

test('nearby hover stays reachable above chat in a short desktop with the minimap', async ({ page }) => {
  await page.setViewportSize({ width: 940, height: 380 })
  await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ minimapSize: 'Large' })))
  await page.goto('/testbed/map-lifecycle.html?nearby-monsters')
  await page.addStyleTag({ content: '#controls { display: none }' })
  const name = page.locator('.monsters').getByText('2 goblins')
  const tooltip = page.locator('.monster-tooltip')
  await expect(page.locator('.minimap-button')).toBeVisible()
  await expect(page.locator('.chat_caption')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const bounds = (await name.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  expect(await tooltip.isVisible()).toBe(true)
  await expect(tooltip).toHaveText('Loading description…')
  expect(await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)).toEqual([
    { msg: 'click_cell', x: 11, y: 3, button: 3 },
  ])
  await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({
    msg: 'ui-push', type: 'describe-monster', title: 'a goblin', body: 'This goblin is sleeping.',
  }))
  await expect(tooltip).toHaveText('This goblin is sleeping.')
  await expect(tooltip).toBeVisible()
  await page.screenshot({ path: 'test-results/nearby-tooltip-short.png' })
})

test('each status light shows its server description without sending a game command', async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html')
  await page.addStyleTag({ content: '#controls { display: none }' })
  const stats = page.locator('.stats')
  const tip = page.locator('.status-tooltip')
  const poison = stats.getByText('Pois', { exact: true })
  const slow = stats.getByText('Slow', { exact: true })
  await expect(stats).toBeVisible()
  await expect(tip).toBeHidden()
  await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({ msg: 'player', status: [
    { light: 'Pois', col: 10, desc: 'You are <lightgreen>poisoned</lightgreen>.\nYou will take damage over time.' },
    { light: 'Slow', col: 12, text: 'moving slowly' },
  ] }))

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await poison.hover()
    await expect(tip).toBeVisible()
    await expect(tip).toHaveText('You are poisoned. You will take damage over time.')
    await expect(tip.locator('.fg10')).toHaveText('poisoned')
    const bounds = (await tip.boundingBox())!
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height)
    await page.screenshot({ path: `test-results/status-tooltip-${viewport.width}.png` })
    await slow.hover()
    await expect(tip).toHaveText('moving slowly')
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await expect(tip).toBeHidden()
  }

  await poison.hover()
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
  await slow.hover()
  await expect(tip).toBeVisible()
  await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({ msg: 'player', status: [] }))
  await expect(slow).toHaveCount(0)
  await expect(tip).toBeHidden()
  expect(await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)).toEqual([])
})

test('action panel opens and closes without a server reply', async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html?action-panel')
  const expand = page.getByTitle('Show the action panel')
  const icons = page.locator('.action-panel canvas')
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 720 })
    await expect(expand).toBeVisible()
    await expand.click()
    await expect(icons).toBeVisible()
    await expect(expand).toBeHidden()
    await page.screenshot({ path: `test-results/action-panel-${width}.png` })
    await icons.click({ position: { x: 48, y: 16 } })
    await icons.click({ position: { x: 16, y: 16 } })
    await expect(expand).toBeVisible()
    await expect(icons).toBeHidden()
  }
  const sent = await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
  expect(sent).toEqual([1280, 800].flatMap(() => [
    { msg: 'set_option', line: 'action_panel_show = true' },
    { msg: 'main_menu_action' },
    { msg: 'set_option', line: 'action_panel_show = false' },
  ]))
})

for (const touch of [false, true]) {
  test.describe(`level items ${touch ? 'touch' : 'controller'}`, () => {
    test.use({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch })
    test('Find offers the current level and custom search without typing', async ({ page }) => {
      await page.goto('/testbed/map-lifecycle.html')
      await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
      const press = (button: 'SELECT' | 'L3' | 'A' | 'B') => page.evaluate(button => {
        ;(window as unknown as MapWindow).__orbrunMapLifecycle.pad({ type: 'press', button, t: performance.now() })
      }, button)
      const sent = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
      const opening = touch ? [] : [{ msg: 'input', text: 'X' }]
      if (!touch) await press('SELECT')
      expect(await sent()).toEqual(opening)
      const mapButton = page.getByRole('button', { name: 'Open level map', exact: true })
      if (touch) await mapButton.tap()
      else await mapButton.click()
      await expect.poll(async () => (await result(page)).renderer).toBe('Render2d')
      const find = () => touch ? page.getByRole('button', { name: 'Find…', exact: true }).tap() : press('L3')
      await find()
      const option = page.getByRole('button', { name: 'Items on this level', exact: true })
      await expect(option).toBeVisible()
      expect(await sent()).toHaveLength(opening.length)
      await page.screenshot({ path: `test-results/find-items-${touch ? 'touch' : 'controller'}.png`, animations: 'disabled' })
      // Cancelling the chooser leaves the map open and sends nothing to Crawl.
      if (touch) await page.getByRole('button', { name: 'Esc', exact: true }).tap()
      else await press('B')
      await expect(option).toBeHidden()
      expect(await sent()).toHaveLength(opening.length)
      await find()
      if (touch) await option.tap()
      else await press('A')
      await expect.poll(sent).toEqual([...opening, { msg: 'key', keycode: 27 }, { msg: 'key', keycode: 6 }])
      await page.evaluate(() => {
        const f = (window as unknown as MapWindow).__orbrunMapLifecycle
        f.receive({ msg: 'ui_state', state: 0 })
        f.receive({ msg: 'init_input', type: 'messages', tag: 'stash_search', prefill: 'old search' })
      })
      await expect.poll(sent).toEqual([
        ...opening, { msg: 'key', keycode: 27 }, { msg: 'key', keycode: 6 },
        { msg: 'key', keycode: 21 }, { msg: 'key', keycode: 11 }, { msg: 'text_input', text: '.\r' },
      ])
      await page.evaluate(() => {
        const f = (window as unknown as MapWindow).__orbrunMapLifecycle
        f.receive({ msg: 'close_input' })
        f.receive({ msg: 'menu', tag: 'stash_search', title: { text: 'Search results' }, flags: 0, items: [{ text: 'a +0 mace', hotkeys: [97], quantity: 1 }] })
      })
      await expect(page.getByText('a +0 mace', { exact: true })).toBeVisible()
      expect((await result(page)).renderer).toBe('Render2d')
      await page.evaluate(() => {
        const f = (window as unknown as MapWindow).__orbrunMapLifecycle
        f.receive({ msg: 'close_menu' })
        f.receive({ msg: 'ui_state', state: 2 })
      })
      await find()
      if (touch) {
        const search = page.getByRole('button', { name: 'Search items…', exact: true })
        await search.tap() // Command lists focus an unfocused row before activating it.
        await expect(search).toHaveClass(/focused/)
        expect(await sent()).toHaveLength(opening.length + 5)
        await search.tap()
      } else {
        await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.pad({ type: 'dir', dir: 4, source: 'dpad' }))
        await press('A')
      }
      await expect.poll(async () => (await sent()).length).toBe(opening.length + 7)
      await page.evaluate(() => {
        const f = (window as unknown as MapWindow).__orbrunMapLifecycle
        f.receive({ msg: 'ui_state', state: 0 })
        f.receive({ msg: 'init_input', type: 'messages', tag: 'stash_search' })
      })
      await expect(page.locator('.text-input.in-log input')).toBeVisible()
      expect(await sent()).toHaveLength(opening.length + 7)
    })
  })
}

test.describe('Android fullscreen', () => {
  test.use({
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, userAgent: androidUserAgent,
  })

  test('toggles from the menu and overlays the game without shrinking the viewport', async ({ page }) => {
    await page.routeWebSocket(/wss?:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
    let releaseClip!: () => void
    const waitForClip = new Promise<void>(resolve => { releaseClip = resolve })
    await page.route('**/menu/clips/**', async route => { await waitForClip; await route.continue() })
    const enter = page.getByRole('button', { name: 'Enter fullscreen' })
    const fullscreenControl = page.locator('.fullscreen-control')
    const fullscreen = () => page.evaluate(() => document.fullscreenElement === document.documentElement)
    await page.goto('/')
    await page.getByRole('combobox', { name: 'Server' }).selectOption('cdi')
    await expect(enter).toBeVisible()
    const corner = (await enter.boundingBox())!
    await expect(enter).toHaveCSS('position', 'absolute')
    expect(corner.x + corner.width).toBeGreaterThan(380)
    const login = (await page.getByRole('button', { name: 'Log in', exact: true }).boundingBox())!
    expect(login.x + login.width).toBeLessThanOrEqual(corner.x)
    await expect(page.locator('.menu-replay-status')).toContainText('Loading')
    await page.screenshot({ path: 'test-results/fullscreen-menu-android.png' })
    releaseClip()
    await enter.tap()
    await expect(fullscreenControl).toBeHidden()
    expect(await fullscreen()).toBe(true)
    await page.evaluate(() => document.exitFullscreen())
    await expect(enter).toBeVisible()

    await page.goto('/testbed/map-lifecycle.html')
    await page.addStyleTag({ content: '#controls { display: none }' })
    await expect(page.locator('.stats')).toBeVisible()
    const cog = page.getByRole('button', { name: 'Open system menu' })
    await expect(cog).toBeVisible()
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      await expect.poll(() => page.locator('.screen.game').boundingBox()).toEqual({ x: 0, y: 0, ...viewport })
      const canvas = (await page.locator('canvas.view').boundingBox())!
      const button = (await enter.boundingBox())!
      const menu = (await cog.boundingBox())!
      const stats = (await page.locator('.stats').boundingBox())!
      expect(button.x).toBeGreaterThanOrEqual(canvas.x)
      expect(button.y).toBeGreaterThanOrEqual(canvas.y)
      expect(button.y + button.height).toBeLessThanOrEqual(canvas.y + canvas.height)
      expect(button).toMatchObject({ width: menu.width, height: menu.height })
      if (viewport.width < viewport.height) {
        expect(menu.x + menu.width).toBe(viewport.width - 4)
        expect(button.x + button.width).toBe(menu.x)
        expect(button.y).toBe(menu.y)
        expect(button.y + button.height).toBeLessThanOrEqual(stats.y)
      } else {
        expect(menu.x + menu.width + 4).toBeCloseTo(stats.x)
        expect(button).toMatchObject({ x: menu.x, y: menu.y + menu.height })
      }
      await page.screenshot({ path: `test-results/fullscreen-game-${viewport.width}.png` })
    }
    const before = (await result(page)).sent
    const menu = await cog.boundingBox()
    await enter.press('Enter')
    await expect(fullscreenControl).toBeHidden()
    expect(await cog.boundingBox()).toEqual(menu)
    expect(await fullscreen()).toBe(true)
    await page.evaluate(() => document.exitFullscreen())
    await expect(enter).toBeVisible()
    expect(await fullscreen()).toBe(false)
    await enter.tap()
    await expect(fullscreenControl).toBeHidden()
    expect(await fullscreen()).toBe(true)
    await page.evaluate(() => document.exitFullscreen())
    expect((await result(page)).sent).toEqual(before)
  })
})

test('Shift+numpad sends server run commands when Windows consumes the modifier', async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const sent = await page.evaluate(() => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: { snapshot(): { sent: unknown[] } } }).__orbrunLiveAnimation
    const before = fixture.snapshot().sent.length
    const directions = [
      ['Numpad8', 'ArrowUp'], ['Numpad9', 'PageUp'], ['Numpad6', 'ArrowRight'], ['Numpad3', 'PageDown'],
      ['Numpad2', 'ArrowDown'], ['Numpad1', 'End'], ['Numpad4', 'ArrowLeft'], ['Numpad7', 'Home'],
    ]
    // Reproduce the OS event shape; browser automation does not emulate
    // Windows' synthetic Shift release when NumLock is overridden.
    for (const modifierNumLock of [true, false]) {
      for (const [code, key] of directions) {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          code, key, location: KeyboardEvent.DOM_KEY_LOCATION_NUMPAD,
          modifierNumLock, shiftKey: false, bubbles: true, cancelable: true,
        }))
      }
    }
    return fixture.snapshot().sent.slice(before)
  })
  expect(sent).toEqual([...('KULNJBHYkulnjbhy')].map(text => ({ msg: 'input', text })))
})

test('inputs use server replies immediately between paints, including touch and controller presses', async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const evidence = await page.evaluate(() => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: {
      receive(msg: Record<string, unknown>): void
      walk(): void
      pad(event: import('../../apps/orbrun/src/gamepad').PadEvent): void
      snapshot(): { totalFrames: number; sent: unknown[] }
    } }).__orbrunLiveAnimation
    const before = fixture.snapshot().totalFrames
    fixture.walk()
    // These replies and inputs all occur in one task: no RAF can refresh the
    // context between them. The actual reducer, controls and Runner are used.
    fixture.receive({ msg: 'msgs', more: true })
    fixture.pad({ type: 'press', button: 'A', t: performance.now() })
    fixture.pad({ type: 'release', button: 'A', t: performance.now(), held: 10 })
    fixture.receive({ msg: 'msgs', more: false })
    fixture.receive({ msg: 'msgs', more: true })
    fixture.pad({ type: 'press', button: 'A', t: performance.now(), touch: true })
    fixture.pad({ type: 'release', button: 'A', t: performance.now(), held: 10, touch: true })
    fixture.receive({ msg: 'msgs', more: false })
    fixture.receive({ msg: 'menu', tag: 'inventory', flags: 0, title: { text: 'Inventory' }, items: [
      { text: 'a - a dagger', hotkeys: [97], level: 2 },
    ], total_items: 1 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    fixture.receive({ msg: 'close_menu' })
    for (let i = 0; i < 8; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }))
    const after = fixture.snapshot()
    return { before, after: after.totalFrames, sent: after.sent }
  })
  expect(evidence.after).toBe(evidence.before)
  expect(evidence.sent.slice(0, 2)).toEqual([{ msg: 'key', keycode: 32 }, { msg: 'key', keycode: 32 }])
  expect(evidence.sent).toContainEqual({ msg: 'key', keycode: 13 })
  expect(evidence.sent.slice(-8)).toEqual(Array.from({ length: 8 }, () => ({ msg: 'input', text: 'l' })))
})

test('controller buttons navigate even while display frames are suspended', async ({ page }) => {
  await page.addInitScript(() => {
    // Simulate a browser that can run input tasks while a new paint is pending.
    window.requestAnimationFrame = () => 1
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
    const pad = { id: 'Xbox test controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] })
    window.addEventListener('test-controller-button', event => {
      buttons[(event as CustomEvent<number>).detail].pressed = true
    })
  })
  await page.routeWebSocket(/wss?:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Polished Crawl', exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-controller-button', { detail: 2 })))
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-controller-button', { detail: 1 })))
  await expect(page.getByRole('heading', { name: 'Polished Crawl', exact: true })).toBeVisible()
})

test('inventory transitions preserve live updates, stable hover targets, and immediate closing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const lifecycle = await page.evaluate(async () => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    const stack = document.querySelector<HTMLElement>('.overlay-stack')!
    const change = (msg: Record<string, unknown>) => new Promise<void>(resolve => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve() })
      observer.observe(stack, { childList: true })
      fixture.receive(msg)
    })
    await change({ msg: 'menu', tag: 'inventory', flags: 0, title: { text: 'Inventory' }, items: [
      { text: 'a - a dagger', hotkeys: [97], level: 2 },
      { text: 'b - a robe', hotkeys: [98], level: 2 },
      { text: 'c - a wand', hotkeys: [99], level: 2 },
    ], total_items: 3 })
    const first = stack.querySelector<HTMLElement>(':scope > .popup')!
    const entrance = first.getAnimations()
    const opened = { animations: entrance.length, duration: entrance[0]?.effect?.getTiming().duration, inert: first.inert }
    entrance.forEach(animation => animation.finish())
    await change({ msg: 'update_menu_items', chunk_start: 0, items: [{ text: 'a - a glowing dagger', hotkeys: [97], level: 2 }] })
    const updated = stack.querySelector<HTMLElement>(':scope > .popup')!
    return { opened, updated: { animations: updated.getAnimations().length, text: updated.textContent } }
  })
  expect(lifecycle.opened).toEqual({ animations: 1, duration: 130, inert: false })
  expect(lifecycle.updated.animations).toBe(0)
  expect(lifecycle.updated.text).toContain('glowing dagger')
  const rows = page.locator('.overlay-stack > .popup li.selectable')
  const row = rows.nth(1)
  const before = await row.boundingBox()
  await row.hover()
  expect(await row.boundingBox()).toEqual(before)
  const rowColors = () => rows.evaluateAll(items => items.map(item => getComputedStyle(item).backgroundColor))
  const inactive = 'rgba(0, 0, 0, 0)'
  const active = 'rgba(255, 212, 92, 0.09)'
  expect(await rowColors()).toEqual([inactive, active, inactive])
  const boxes = await Promise.all([rows.nth(2).boundingBox(), rows.nth(0).boundingBox()])
  for (const [i, box] of boxes.entries()) {
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    expect(await rowColors()).toEqual(i === 0 ? [inactive, inactive, active] : [active, inactive, inactive])
  }
  await page.mouse.move(5, 5)
  expect(await rowColors()).toEqual([inactive, inactive, inactive])
  const closed = await page.evaluate(async () => {
    const stack = document.querySelector<HTMLElement>('.overlay-stack')!
    await new Promise<void>(resolve => {
      const observer = new MutationObserver(() => { observer.disconnect(); resolve() })
      observer.observe(stack, { childList: true })
      ;(window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.receive({ msg: 'close_menu' })
    })
    const exit = stack.querySelector<HTMLElement>('.ui-exit')!
    const retiring = exit.querySelector<HTMLElement>('.popup')!
    return { live: stack.querySelectorAll(':scope > .popup').length, inert: exit.inert, hidden: exit.getAttribute('aria-hidden'),
      pointerEvents: getComputedStyle(retiring).pointerEvents, duration: retiring.getAnimations()[0]?.effect?.getTiming().duration }
  })
  expect(closed).toEqual({ live: 0, inert: true, hidden: 'true', pointerEvents: 'none', duration: 90 })
  await expect(page.locator('.ui-exit')).toHaveCount(0)
})

test('level gain celebrates and expires without intercepting input', async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const popup = page.locator('.level-up')
  await expect(popup).toBeHidden()
  await page.evaluate(() => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    fixture.receive({ msg: 'player', xl: 4 })
  })
  await expect(popup).toBeVisible()
  await expect(popup).toHaveAttribute('data-level', '4')
  expect(await popup.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
  expect(await popup.locator('canvas').evaluate(el => getComputedStyle(el).imageRendering)).toBe('auto')
  expect(await page.locator(':focus').count()).toBe(0)
  await expect(popup).toBeHidden({ timeout: 6000 })
  await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.destroy())
  expect((await result(page)).destroyed).toBe(true)
})

test('level announcement appears before answering the stat choice and follows the rendered character', async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-13T12:00:01Z'))
  await page.evaluate(() => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    fixture.receive({ msg: 'player', xl: 5 })
    fixture.receive({ msg: 'msgs', messages: [
      { text: 'You have reached level 6!', channel: 11, turn: 41 },
      { text: 'Your experience leads to an increase in your attributes!', channel: 11, turn: 41 },
      { text: 'Increase (S)trength, (I)ntelligence, or (D)exterity?', channel: 2, turn: 41 },
    ] })
    fixture.receive({ msg: 'input_mode', mode: 7 }) // MouseMode.PROMPT
  })
  await page.clock.runFor(100)
  const popup = page.locator('.level-up')
  await expect(popup).toBeVisible()
  await expect(popup).toHaveAttribute('data-level', '6')
  await expect(page.locator('.prompt-card')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.snapshot().xl)).toBe(5)
  const checkAnchor = async () => {
    const player = await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.snapshot().playerProjection)
    const art = (await popup.locator('canvas').boundingBox())!
    expect(Math.abs(art.x + art.width / 2 - player.x)).toBeLessThanOrEqual(1)
    expect(art.y + art.height).toBeLessThan(player.y - player.scale * 0.7)
    expect(art.y + art.height).toBeGreaterThan(player.y - player.scale * 1.5)
  }
  await checkAnchor()
  // A camera/actor transition and a resize must not leave the banner at its old position.
  await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.walk())
  await page.clock.runFor(200)
  await checkAnchor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.runFor(200)
  await checkAnchor()
  // Smooth lettering retains readable warm highlights and antialiased edges.
  const pixels = await popup.locator('canvas').evaluate(canvas => {
    const art = canvas as HTMLCanvasElement
    const data = art.getContext('2d')!.getImageData(0, 0, art.width, art.height).data
    let warm = 0, partial = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 0 && data[i + 3] !== 255) partial++
      if (data[i + 3] > 128 && data[i] > 190 && data[i + 1] > 150 && data[i + 2] < data[i]) warm++
    }
    return { warm, partial }
  })
  expect(pixels.warm).toBeGreaterThan(50)
  expect(pixels.partial).toBeGreaterThan(100)
  await page.clock.runFor(3000)
  await expect(popup).toBeHidden()
  await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.receive({ msg: 'player', xl: 6 }))
  await page.clock.runFor(100)
  await expect(popup).toBeHidden()
})

test('a level-up animation takes precedence over a pending MORE cue', async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-13T12:00:01Z'))
  const receive = (msg: Record<string, unknown>) => page.evaluate(msg => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.receive(msg), msg)
  const popup = page.locator('.level-up')
  const cue = page.locator('.more-cue')

  await receive({ msg: 'msgs', more: true, messages: [{ text: 'You have reached level 4!', channel: 11 }] })
  await page.clock.runFor(100)
  await expect(popup).toBeVisible()
  await expect(cue).toBeHidden()
  await expect(page.locator('.messages .line.more')).toHaveText('--more--')

  await page.keyboard.press('Space')
  expect(await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.snapshot().sent)).toEqual([{ msg: 'input', text: ' ' }])
  await page.clock.runFor(2000)
  await expect(popup).toBeHidden()
  await expect(cue).toBeVisible()
  await receive({ msg: 'msgs', more: false })
  await page.clock.runFor(100)
  await expect(cue).toBeHidden()
})

test('level-up embers rise during the celebration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-13T12:00:01Z'))
  await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.receive({ msg: 'player', xl: 4 }))
  const embers = () => page.locator('.level-up-art').evaluate(canvas => {
    const art = canvas as HTMLCanvasElement, dpr = art.width / art.clientWidth
    const data = art.getContext('2d')!.getImageData(0, 0, art.width, art.height).data
    const points: { x: number; y: number }[] = []
    for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) {
      if (x / dpr >= 80 && x / dpr <= 160 && y / dpr >= 55) continue // exclude lettering
      const i = (y * art.width + x) * 4
      if (data[i + 3] > 40 && data[i] > 170 && data[i + 1] > 80) points.push({ x: x / dpr, y: y / dpr })
    }
    // Track the outermost ember, so motes entering/leaving the text mask cannot bias its motion.
    const left = Math.min(...points.map(p => p.x))
    const edge = points.filter(p => p.x <= left + 3)
    return { count: points.length, y: edge.length ? edge.reduce((sum, p) => sum + p.y, 0) / edge.length : 0 }
  })
  await page.clock.runFor(250)
  const first = await embers()
  expect(first.count).toBeGreaterThan(5)
  await page.clock.runFor(300)
  const later = await embers()
  expect(later.count).toBeGreaterThan(5)
  expect(later.y).toBeLessThan(first.y - 3)
})

test('message pauses show a player cue until the server clears them and preserve dungeon brightness', async ({ page }) => {
  await page.goto('/testbed/live-animation.html?frameTime=1')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const cue = page.locator('.more-cue')
  await expect(cue).toBeHidden()
  const corner = { x: 30, y: 130, width: 40, height: 40 }
  const before = await page.screenshot({ clip: corner })
  await page.evaluate(() => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    fixture.receive({ msg: 'msgs', more: true, messages: [{ text: 'You have reached level 3!', channel: 11 }] })
  })
  await expect(page.locator('.messages .line.more')).toHaveText('--more--')
  await expect(cue).toBeVisible()
  await expect(page.locator('.more-scrim')).toHaveCount(0)
  expect(await page.screenshot({ clip: corner })).toEqual(before)
  const checkAnchor = () => expect.poll(async () => {
    const bounds = await cue.boundingBox()
    const player = await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.snapshot().playerProjection)
    return !!bounds && Math.abs(bounds.x + bounds.width / 2 - player.x) < 1
      && bounds.y + bounds.height < player.y - player.scale * 0.5
      && bounds.y + bounds.height > player.y - player.scale * 1.3
  }).toBe(true)
  await checkAnchor()
  await page.screenshot({ path: 'test-results/more-cue-desktop.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await checkAnchor()
  await page.screenshot({ path: 'test-results/more-cue-narrow.png', animations: 'disabled' })
  const sent = () => page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.snapshot().sent)
  expect(await sent()).toEqual([])
  await page.keyboard.press('Space')
  expect(await sent()).toEqual([{ msg: 'input', text: ' ' }])
  await expect(cue).toBeVisible()
  await page.evaluate(() => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    fixture.receive({ msg: 'msgs', more: false })
  })
  await expect(page.locator('.messages')).not.toHaveClass(/\bmore\b/)
  await expect(cue).toBeHidden()
  await page.evaluate(() => (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation.pad({ type: 'press', button: 'START', t: performance.now() }))
  await expect(page.locator('.popup.sysmenu')).toBeVisible()
  expect(await page.locator('.overlay-stack').evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toBe('none')
  await expect.poll(() => page.locator('.overlay-stack').evaluate(el => getComputedStyle(el, '::before').backgroundColor)).toBe('rgba(3, 2, 6, 0.5)')

  await page.reload()
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.evaluate(mode => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    fixture.receive({ msg: 'game_client' })
    fixture.receive({ msg: 'input_mode', mode })
  }, MouseMode.MORE)
  await expect(page.locator('.loading')).toBeVisible()
  await expect(cue).toBeHidden()
  await page.screenshot({ path: 'test-results/more-cue-loading.png' })
})

for (const touch of [false, true]) {
  test.describe(touch ? 'RC editor touch' : 'RC editor desktop', () => {
    test.use({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch })
    test('edits the server file from Play and reads it again on reopen', async ({ page }) => {
      const files: Record<string, string> = { 'dcss-web-0.34': '# server rc\n', 'dcss-web-trunk': '# trunk rc\n' }
      const sent: { msg: string; game_id?: string; contents?: string }[] = []
      // Exercise the app's real connection and lobby without any public-server dependency.
      await page.route('**/morgue-proxy/**', route => route.fulfill({ status: 404, body: '' }))
      await page.route('**/gamedata-proxy/**', route => route.fulfill({ status: 404, body: '' }))
      await page.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
        socket.onMessage(raw => {
          const message = JSON.parse(String(raw))
          sent.push(message)
          if (message.msg === 'token_login') socket.send(JSON.stringify({ msgs: [
            { msg: 'login_success', username: 'rc-test' },
            { msg: 'set_game_links', content: Object.keys(files).map(id => `<span><br><a href="#play-${id}">DCSS ${id.endsWith('trunk') ? 'trunk' : '0.34'}</a><a class="edit_rc_link" data-game_id="${id}">(edit rc)</a></span>`).join('') },
            { msg: 'lobby_complete' },
          ] }))
          if (message.msg === 'set_login_cookie') socket.send(JSON.stringify({ msg: 'login_cookie', cookie: 'test-token', expires: 7 }))
          if (message.msg === 'get_rc') socket.send(JSON.stringify({ msg: 'rcfile_contents', game_id: message.game_id, contents: files[message.game_id] ?? '' }))
          if (message.msg === 'set_rc') files[message.game_id] = message.contents
        })
      })
      await page.addInitScript(() => {
        const account = { serverId: 'cdi', username: 'rc-test' }
        localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
        localStorage.setItem('orbrun.account', JSON.stringify(account))
        localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/rc-test': 'test-token' }))
      })
      await page.goto('/')
      const edit = page.locator('[data-focus="rc:dcss-web-0.34"]')
      await expect(edit).toBeVisible()
      const bounds = await edit.boundingBox()
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      await edit.click()
      const text = page.getByRole('textbox', { name: 'rc file', exact: true })
      await expect(text).toHaveValue('# server rc\n')
      const contents = '# server rc\nautofight_stop = 60\n{\n  -- Lua stays verbatim\n}\n'
      await text.fill(contents)
      if (touch) await page.locator('[data-focus="rc:save"]').click()
      else await text.press('Control+s')
      await expect(page.locator('.brand > .hint').filter({ hasText: 'Saved on crawl.dcss.io.' })).toBeVisible()
      expect(files['dcss-web-0.34']).toBe(contents)
      expect(files['dcss-web-trunk']).toBe('# trunk rc\n')
      expect(sent.filter(message => message.msg === 'set_rc')).toEqual([{ msg: 'set_rc', game_id: 'dcss-web-0.34', contents }])
      await page.getByRole('button', { name: /Back/ }).click()
      await expect(edit).toBeFocused()
      // A WebTiles edit changes the same remote file. Reopening must fetch it again.
      files['dcss-web-0.34'] = '# edited in WebTiles\n'
      await edit.click()
      await expect(text).toHaveValue('# edited in WebTiles\n')
      await text.fill('# unsaved\n')
      await page.getByRole('button', { name: /Back/ }).click()
      await expect(text).toHaveValue('# unsaved\n')
      await page.getByRole('button', { name: /Back, without saving\?/ }).click()
      await expect(edit).toBeFocused()
      expect(files['dcss-web-0.34']).toBe('# edited in WebTiles\n')
      expect(sent.some(message => ['play', 'input', 'key'].includes(message.msg))).toBe(false)
    })
  })
}

test('Dungeon and flat atmosphere, foliage sway, paused frames and impact', async ({ page }) => {
  await page.goto('/testbed/living-checks.html')
  await expect.poll(async () => {
    try { return (await result(page)).status } catch { return 'loading' }
  }, { timeout: 75_000 }).toMatch(/complete|error/)
  const report = await result(page)
  expect(report.status, JSON.stringify(report)).toBe('complete')
  expect(report.profile).toBe('full')
  expect(report.checks).toBe(21)
  expect(report.passed).toBe(report.checks)
  expect(report.failures).toEqual([])
})

test('real GameScreen keeps animating after the device motion preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).frames).toBeGreaterThan(2)
  const beforeChange = (await result(page)).frames
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(async () => (await result(page)).animating).toBe(true)
  await expect.poll(async () => (await result(page)).frames).toBeGreaterThan(beforeChange + 2)
  const impacts = (await result(page)).impacts
  await page.getByRole('button', { name: 'Trigger local hit', exact: true }).click()
  await expect.poll(async () => (await result(page)).impacts).toBeGreaterThan(impacts)
})

for (const touch of [false, true]) {
  test.describe(touch ? 'dungeon touch' : 'dungeon desktop', () => {
    test.use({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch })
    test('dungeon canvas stays clear of Tune and accepts movement', async ({ page }) => {
      await page.goto('/testbed/map-lifecycle.html')
      await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
      await expect(page.getByRole('complementary', { name: 'Quick settings' })).toHaveCount(0)
      await page.locator('canvas.view').press('ArrowRight')
      await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'input', text: 'l' })
    })
  })
  test.describe(touch ? 'narrow touch' : 'narrow mouse', () => {
    test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: touch, deviceScaleFactor: 3 })
    test('readable HUD and repeated map/overview restoration', async ({ page }) => {
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

for (const viewport of [{ width: 800, height: 1080 }, { width: 1000, height: 900 }]) {
  test(`a touch on a mixed-input screen keeps the zoom and brings up the split compass at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
    const hud = page.locator('.hud')
    const controls = hud.locator('.touchbar.split')
    const stats = hud.locator('.stats .line').first()
    const tileSize = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().tileSize!)
    await expect(stats).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true)
    await expect(hud).not.toHaveClass(/mobile-dungeon/)
    const scale = await tileSize()
    await stats.dispatchEvent('pointerdown', { pointerType: 'touch' })
    await expect(controls.getByRole('button', { name: 'Northwest' })).toBeVisible()
    expect(await tileSize()).toBeCloseTo(scale, 8)
    const dungeon = page.locator('canvas.view')
    const width = (await dungeon.boundingBox())!.width
    await page.keyboard.press('ArrowUp')
    await expect(controls).toBeHidden()
    expect((await dungeon.boundingBox())!.width).toBe(width)
    expect(await tileSize()).toBeCloseTo(scale, 8)
  })
}

test.describe('short landscape on a wide touch device', () => {
  test.use({ viewport: { width: 740, height: 265 }, screen: { width: 1227, height: 673 }, isMobile: true, hasTouch: true, userAgent: androidUserAgent })

  test('fits the minimap, monsters and chat above or between the controls', async ({ page }) => {
    const device = await page.context().newCDPSession(page)
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 36, top: 0, right: 10, bottom: 16 } })
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
    await expect(page.locator('.game')).not.toHaveClass(/\bphone\b/)
    const minimap = page.getByRole('button', { name: 'Dungeon minimap, open level map' })
    const monsters = page.locator('.hud .monsters')
    const launcher = page.getByRole('link', { name: 'Chat', exact: true })
    const controls = page.locator('.touchbar.split')
    await expect(launcher).toBeVisible()
    await expect(minimap).toBeVisible()
    await expect(monsters.getByText('goblin', { exact: true })).toBeVisible()
    expect((await minimap.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    const list = (await monsters.boundingBox())!
    expect(list.height).toBeGreaterThanOrEqual(44)
    expect(list.y + list.height).toBeLessThan((await controls.getByRole('button', { name: 'Fire', exact: true }).boundingBox())!.y)
    const badge = (await launcher.boundingBox())!
    const dpad = (await controls.getByRole('button', { name: 'Southeast' }).boundingBox())!
    const commands = (await controls.getByRole('button', { name: 'Explore' }).boundingBox())!
    expect(badge.x).toBeGreaterThan(dpad.x + dpad.width)
    expect(badge.x + badge.width).toBeLessThan(commands.x)
    await page.screenshot({ path: 'test-results/short-wide-touch-chat.png', animations: 'disabled' })
    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({
      msg: 'chat', sender: 'Edda', content: '<span class="chat_msg">Nice find!</span>',
    }))
    await launcher.tap()
    const caption = page.locator('.chat_caption')
    await expect(caption).toBeVisible()
    expect((await page.locator('.chat').boundingBox())!.x).toBeGreaterThan(dpad.x + dpad.width)
    await expect(page.locator('.chat_history').getByText('Nice find!')).toBeInViewport()
    await page.screenshot({ path: 'test-results/short-wide-touch-chat-open.png', animations: 'disabled' })
    await caption.tap()
    await expect(launcher).toBeVisible()
    await expect(caption).toBeHidden()
  })
})

test.describe('portrait action panel', () => {
  const viewport = { width: 732, height: 896 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('keeps the menu at the upper left with the minimap below it at phone and wider sizes', async ({ page }) => {
    const device = await page.context().newCDPSession(page)
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 8, top: 12 } })
    await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ minimapAlignment: 'Right' })))
    await page.goto('/testbed/map-lifecycle.html?mobile-hud&action-panel')
    const actions = page.locator('.action-panel')
    const icons = actions.locator('canvas')
    const expand = page.getByTitle('Show the action panel')
    const map = page.getByRole('button', { name: 'Dungeon minimap, open level map' })
    const sent = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await expect(actions).toBeHidden()
    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
    for (const size of [viewport, { width: 320, height: 560 }]) {
      await page.setViewportSize(size)
      await expect.poll(() => page.locator('canvas.view').boundingBox().then(box => box?.width)).toBe(size.width)
      await expect(expand).toBeVisible()
      await expect(map).toBeVisible()
      const folded = (await actions.boundingBox())!
      const minimap = (await map.boundingBox())!
      expect(folded).toMatchObject({ x: 16, y: 16 })
      expect(minimap.x).toBe(folded.x)
      expect(minimap.y).toBeGreaterThan(folded.y + folded.height)
      await expand.tap()
      await expect(icons).toBeVisible()
      const panel = (await icons.boundingBox())!
      expect(panel).toMatchObject({ x: folded.x, y: folded.y })
      expect(panel.y + panel.height).toBeLessThan(minimap.y)
      expect(await map.boundingBox()).toEqual(minimap)
      await page.screenshot({ path: `test-results/portrait-action-panel-${size.width}.png`, animations: 'disabled' })
      await page.touchscreen.tap(panel.x + 48, panel.y + 16)
      await page.touchscreen.tap(panel.x + 16, panel.y + 16)
      await expect(expand).toBeVisible()
    }
    expect(await sent()).toEqual(Array.from({ length: 2 }).flatMap(() => [
      { msg: 'set_option', line: 'action_panel_show = true' },
      { msg: 'main_menu_action' },
      { msg: 'set_option', line: 'action_panel_show = false' },
    ]))
  })
})

test.describe('wide landscape on a phone', () => {
  const viewport = { width: 1047, height: 473 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('keeps the action panel and spectator caption accessible', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?mobile-hud&action-panel')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
    await expect(page.locator('.game')).toHaveClass(/\bphone\b/)
    const caption = page.locator('.chat_caption')
    await expect(caption).toBeVisible()
    await expect(caption).toContainText('0 spectators')
    const expand = page.getByTitle('Show the action panel')
    await expand.tap()
    const panel = page.locator('.action-panel canvas')
    await expect(panel).toBeVisible()
    const compass = page.locator('.touchbar.split').getByRole('button', { name: 'Northwest' })
    expect((await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThan((await compass.boundingBox())!.y)
    await page.screenshot({ path: 'test-results/wide-phone-landscape.png', animations: 'disabled' })
    await caption.tap()
    await expect(page.locator('.chat_body')).toBeVisible()
    await caption.tap()
    await expect(page.locator('.chat_body')).toBeHidden()
    await panel.tap({ position: { x: 48, y: 16 } })
    await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'main_menu_action' })

    await page.setViewportSize({ width: 740, height: 230 })
    await expect.poll(() => page.locator('canvas.view').boundingBox().then(box => box?.height)).toBe(230)
    await expect(caption).toBeHidden()
    await expect(panel).toBeVisible()
    const chat = page.getByRole('link', { name: 'Chat', exact: true })
    await chat.tap()
    await expect(page.locator('.chat_body')).toBeVisible()
  })
})

for (const orientation of ['portrait', 'landscape', 'wide-landscape'] as const) {
  const portrait = orientation === 'portrait'
  const wide = orientation === 'wide-landscape'
  test.describe(`mobile HUD ${orientation}`, () => {
    const viewport = wide ? { width: 1227, height: 673 } : portrait ? { width: 390, height: 735 } : { width: 824, height: 300 }
    const screen = wide ? viewport : portrait ? { width: 390, height: 844 } : { width: 844, height: 390 }
    const insets = wide ? { left: 0, top: 0, right: 0, bottom: 0 } : portrait
      ? { left: 0, top: 12, right: 0, bottom: 24 }
      : { left: 36, top: 0, right: 10, bottom: 16 }
    test.use({
      viewport, screen,
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: androidUserAgent,
    })

    test('fits touch controls and keeps the dungeon and character sheet readable', async ({ page }) => {
      const device = await page.context().newCDPSession(page)
      await device.send('Emulation.setSafeAreaInsetsOverride', { insets })
      await page.clock.install()
      await page.goto('/testbed/map-lifecycle.html?mobile-hud' + (wide ? '&action-panel' : ''))
      const dungeon = page.locator('canvas.view')
      const stats = page.locator('.hud .stats')
      const log = page.locator('.hud .messages')
      const nearby = page.locator('.hud .monsters')
      const controls = page.locator('.touchbar.split')
      const cog = page.getByRole('button', { name: 'Open system menu' })
      const commands = ['Explore', 'Fight', 'Fire', 'Spells', 'Skills', 'In view', 'Examine', 'Esc', 'Gear', 'Map']
      const button = (name: string) => controls.getByRole('button', { name, exact: true })
      const sent = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
      const receive = (msg: Record<string, unknown>) => page.evaluate(msg => (window as unknown as MapWindow).__orbrunMapLifecycle.receive(msg), msg)
      const loading = page.getByText('Loading game data…', { exact: true })
      await expect(loading).toBeVisible()
      await expect(stats).toBeHidden()
      await expect(cog).toBeHidden()
      expect((await loading.boundingBox())!.height).toBe(viewport.height)
      await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
      await expect(loading).toBeHidden()
      await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
      await expect(stats.getByText('Mara the Slasher', { exact: true })).toBeVisible()
      await expect(log.getByText('A bat comes into view.')).toBeVisible()
      await expect(stats.locator('.line:has(.stat-bar)')).toHaveCount(1)
      await expect(stats.locator('.stat-bar')).toHaveCount(2)
      await page.evaluate(() => document.fonts.ready)
      await expect(controls).toBeVisible()
      const fit = async (width: number, height: number) => {
        const view = (await dungeon.boundingBox())!
        const messages = (await log.boundingBox())!
        const sheet = (await stats.boundingBox())!
        const wait = (await button('Wait').boundingBox())!
        const fire = (await button('Fire').boundingBox())!
        const map = (await button('Map').boundingBox())!
        const menu = (await cog.boundingBox())!
        const fullscreen = (await page.getByRole('button', { name: 'Enter fullscreen' }).boundingBox())!
        expect(menu.y).toBe(insets.top + 4)
        expect(view.y).toBe(0)
        expect(sheet.x).toBeGreaterThanOrEqual(insets.left)
        expect(sheet.y).toBeGreaterThanOrEqual(insets.top)
        expect(wait.x).toBeLessThan(fire.x)
        expect(map.y + map.height).toBeLessThan(fire.y)
        if (portrait) {
          expect(menu.x + menu.width).toBe(width - insets.right - 4)
          expect(fullscreen.x + fullscreen.width).toBe(menu.x)
          expect(view.height).toBeGreaterThan(height * 0.4)
          expect(messages.y).toBeGreaterThanOrEqual(view.y + view.height - 1)
          expect(sheet.y).toBeGreaterThanOrEqual(messages.y + messages.height - 1)
          expect(sheet.y + sheet.height).toBeLessThan(wait.y)
          if (width === 320) expect(map.y + map.height).toBeLessThanOrEqual(messages.y)
        } else {
          const list = (await nearby.boundingBox())!
          expect(menu.x + menu.width + 4).toBeCloseTo(sheet.x)
          expect(messages.x + messages.width).toBeLessThan(menu.x)
          expect(fullscreen).toMatchObject({ x: menu.x, y: menu.y + menu.height })
          expect(view.width).toBeGreaterThan(width / 2)
          expect(messages.y + messages.height).toBeLessThan(height / 2)
          expect(sheet.x).toBeGreaterThan(view.x + view.width - 1)
          expect(list.y).toBeGreaterThanOrEqual(sheet.y + sheet.height - 1)
          expect(list.y + list.height).toBeLessThan(fire.y)
          expect(wait.x + wait.width).toBeLessThan(view.width / 2)
          expect(wait.y).toBeGreaterThan(view.height / 2)
          const covered = await stats.locator('.line > span').evaluateAll((spans, buttons) => spans.some(span => {
            const rect = span.getBoundingClientRect()
            return buttons.some(button => rect.top < button.y + button.height && rect.bottom > button.y &&
              rect.left < button.x + button.width && rect.right > button.x)
          }), [menu, fullscreen])
          expect(covered).toBe(false)
        }
        for (const name of [...commands, 'Wait', 'Northwest', 'Northeast', 'Southwest', 'Southeast']) {
          const target = (await button(name).boundingBox())!
          expect(target.width, name).toBeGreaterThanOrEqual(44)
          expect(target.height, name).toBeGreaterThanOrEqual(44)
          expect(target.x, name).toBeGreaterThanOrEqual(insets.left)
          expect(target.x + target.width, name).toBeLessThanOrEqual(width - insets.right)
          expect(target.y + target.height, name).toBeLessThanOrEqual(height - insets.bottom)
        }
      }
      if (!portrait) {
        await expect(nearby.getByText('goblin', { exact: true })).toBeVisible()
        await expect(nearby.getByText('bat', { exact: true })).toBeVisible()
      }
      await fit(viewport.width, viewport.height)
      const sheet = (await stats.boundingBox())!
      const readiedItem = stats.getByText('3 throwing nets', { exact: true })
      if (!portrait) await readiedItem.scrollIntoViewIfNeeded()
      const readied = (await readiedItem.boundingBox())!
      expect(readied.y + readied.height).toBeLessThanOrEqual(sheet.y + sheet.height)
      if (!portrait) await stats.evaluate(el => { el.scrollTop = 0 })
      expect((await result(page)).appliedDungeonOptions).toMatchObject({ portraitFraming: portrait })
      const mainCommands = await Promise.all(['Explore', 'Fight', 'Fire', 'Spells'].map(name => button(name).boundingBox()))
      expect(mainCommands.every(box => box && box.y === mainCommands[0]?.y && box.width <= (wide ? 80 : 64))).toBe(true)
      expect((await button('Wait').boundingBox())!.height).toBe(44)
      if (wide) {
        const expand = page.getByTitle('Show the action panel')
        await expand.tap()
        await expect.poll(sent).toContainEqual({ msg: 'set_option', line: 'action_panel_show = true' })
        const panel = page.locator('.action-panel canvas')
        const chat = page.locator('.chat .chat_head')
        await expect(panel).toBeVisible()
        await expect(chat).toBeVisible()
        const logBox = (await log.boundingBox())!
        const listBox = (await nearby.boundingBox())!
        expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(logBox.y + logBox.height)
        expect((await chat.boundingBox())!.y).toBeGreaterThanOrEqual(listBox.y + listBox.height)
        await chat.locator('.chat_hide_button').tap()
        const showChat = page.getByRole('link', { name: 'Show chat' })
        await expect(showChat).toBeVisible()
        const folded = (await showChat.boundingBox())!
        const spells = (await button('Spells').boundingBox())!
        expect(folded.y + folded.height).toBeLessThanOrEqual(spells.y)
        await showChat.tap()
        await expect(chat).toBeVisible()
      }
      await page.screenshot({ path: `test-results/mobile-hud-${orientation}.png`, animations: 'disabled' })
      const fireTwice = async (capture = false) => {
        const before = await sent()
        const fire = (await button('Fire').boundingBox())!
        const tapFire = () => page.touchscreen.tap(fire.x + fire.width / 2, fire.y + fire.height / 2)
        const shot = { msg: 'input', text: 'f' }
        await tapFire()
        await expect.poll(sent).toEqual([...before, shot])
        await receive({ msg: 'msgs', messages: [{ text: 'Press: f - fire, + - next target, Q - select action', channel: MSGCH.PROMPT }] })
        await receive({ msg: 'input_mode', mode: MouseMode.TARGET })
        await receive({ msg: 'cursor', id: 0, loc: { x: 12, y: 3 } })
        const confirm = button('Fire at goblin')
        await expect(confirm).toBeVisible()
        expect(await confirm.boundingBox()).toEqual(fire)
        await expect(button('Northwest')).toBeVisible()
        await expect(button('Esc')).toBeVisible()
        await expect(button('Next target')).toBeVisible()
        if (capture) await page.screenshot({ path: `test-results/mobile-fire-${orientation}.png`, animations: 'disabled' })
        await tapFire()
        await expect.poll(sent).toEqual([...before, shot, shot])
        await receive({ msg: 'cursor', id: 0 })
        await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
        await expect(button('Fire')).toBeVisible()
      }
      await fireTwice(true)
      if (wide) {
        await page.getByRole('button', { name: 'Dungeon minimap, open level map' }).tap()
        await expect.poll(sent).toContainEqual({ msg: 'input', text: 'X' })
        await receive({ msg: 'ui_state', state: UiState.VIEW_MAP })
        for (const name of ['Northwest', 'Find…', 'Find down', 'Zoom in', 'Zoom out', 'Descend']) await expect(button(name)).toBeVisible()
        await receive({ msg: 'ui_state', state: UiState.NORMAL })
        await expect(button('Northwest')).toBeVisible()
        await page.setViewportSize({ width: 800, height: 1080 })
        await expect(page.locator('.hud.mobile-dungeon')).not.toHaveClass(/mobile-landscape/)
        await expect(button('Northwest')).toBeVisible()
        await fireTwice()
      }
      const short = portrait ? { width: 320, height: 560 } : { width: 740, height: 265 }
      await page.setViewportSize(short)
      const dimension = portrait ? 'width' : 'height'
      await expect.poll(async () => (await dungeon.boundingBox())![dimension]).toBe(short[dimension])
      await fit(short.width, short.height)
      if (portrait) {
        await page.screenshot({ path: 'test-results/mobile-map-button-narrow.png', animations: 'disabled' })
        await fireTwice()
      }

      const beforeMove = await sent()
      const diagonals = [['Northwest', 'y'], ['Northeast', 'u'], ['Southwest', 'b'], ['Southeast', 'n']]
      for (const [name] of diagonals) await button(name).tap()
      await expect.poll(sent).toEqual([...beforeMove, ...diagonals.map(([, text]) => ({ msg: 'input', text }))])
      if (!portrait) {
        await button('Gear').tap()
        await expect.poll(sent).toContainEqual({ msg: 'input', text: 'i' })
        await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({
          msg: 'menu', tag: 'inventory', flags: 0, title: { text: 'Inventory' },
          items: [{ text: 'a +0 long sword', hotkeys: [97], quantity: 1 }],
        }))
        const esc = page.locator('.touchbar.context-controls').getByRole('button', { name: 'Esc', exact: true })
        await esc.tap()
        await expect.poll(sent).toContainEqual({ msg: 'key', keycode: 27 })
        return
      }
      const hold = async (name: string, ms: number, end: 'touchEnd' | 'touchCancel' = 'touchEnd') => {
        const box = (await button(name).boundingBox())!
        await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
        await page.clock.runFor(ms)
        await device.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] })
      }
      const beforeWait = await sent()
      await hold('Wait', 150, 'touchCancel')
      expect(await sent()).toEqual(beforeWait)
      await button('Wait').tap()
      await expect.poll(sent).toContainEqual({ msg: 'input', text: '.' })
      await hold('Wait', 500)
      await expect.poll(sent).toContainEqual({ msg: 'key', keycode: Keys.CK_SHIFT_CLEAR })
      expect((await sent()).slice(beforeWait.length)).toEqual([{ msg: 'input', text: '.' }, { msg: 'key', keycode: Keys.CK_SHIFT_CLEAR }])
      const beforeHold = (await sent()).length
      await hold('Southeast', 650)
      const afterHold = await sent()
      expect(afterHold.length - beforeHold).toBeGreaterThan(1)
      expect(afterHold.slice(beforeHold)).toEqual(Array.from({ length: afterHold.length - beforeHold }, () => ({ msg: 'input', text: 'n' })))
      await page.clock.runFor(450)
      expect(await sent()).toEqual(afterHold)
    })

    if (portrait) test('keeps the same tile size when the touch HUD resizes the canvas', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 530 })
      await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ depthTilt: 65 })))
      await page.goto('/testbed/map-lifecycle.html?mobile-hud')
      await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
      await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
      const view = page.locator('canvas.view')
      const controls = page.locator('.touchbar.split')
      const stats = page.locator('.hud .stats .line').first()
      const tileSize = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().tileSize!)
      await expect(stats).toBeVisible()
      await expect(controls).toBeVisible()
      const initial = (await view.boundingBox())!.height
      const scale = await tileSize()
      await page.keyboard.press('ArrowUp')
      await expect(controls).toBeHidden()
      await expect.poll(async () => (await view.boundingBox())!.height).toBeGreaterThan(initial)
      expect(await tileSize()).toBeCloseTo(scale, 8)
      await stats.tap()
      await expect(controls).toBeVisible()
      await expect.poll(async () => (await view.boundingBox())!.height).toBe(initial)
      expect(await tileSize()).toBeCloseTo(scale, 8)
    })

    test('keeps spells within thumb reach and uses Crawl’s prompts to cast', async ({ page }) => {
      const device = await page.context().newCDPSession(page)
      await device.send('Emulation.setSafeAreaInsetsOverride', { insets })
      await page.clock.install()
      await page.goto('/testbed/map-lifecycle.html?mobile-hud&spells')
      await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
      await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
      const sent = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
      const receive = (msg: Record<string, unknown>) => page.evaluate(msg => (window as unknown as MapWindow).__orbrunMapLifecycle.receive(msg), msg)
      await expect.poll(sent).toEqual([{ msg: 'input', text: 'I' }])

      const wait = (await page.getByRole('button', { name: 'Wait', exact: true }).boundingBox())!
      await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: wait.x + wait.width / 2, y: wait.y + wait.height / 2 }] })
      await page.clock.runFor(475)
      await expect.poll(sent).toEqual([{ msg: 'input', text: 'I' }])
      const showSpellbook = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.showSpellbook())
      await showSpellbook()
      await receive({ msg: 'close_menu' })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
      const rest = { msg: 'key', keycode: Keys.CK_SHIFT_CLEAR }
      await expect.poll(sent).toEqual([{ msg: 'input', text: 'I' }, { msg: 'key', keycode: 27 }, rest])
      await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      expect((await sent()).at(-1)).toEqual(rest)
      expect((await sent()).length).toBe(3)

      const rail = page.getByRole('group', { name: 'Spell shortcuts' })
      const book = rail.getByRole('button', { name: 'Spellbook' })
      await expect(rail.getByRole('button')).toHaveCount(9)
      await expect(rail.getByRole('button', { name: /Foxfire/ })).toBeVisible()
      await expect(book).toBeVisible()
      const cog = page.getByRole('button', { name: 'Open system menu', exact: true })
      await expect(cog).toBeVisible()
      const order = async (short = false) => {
        const shortcuts = (await rail.boundingBox())!
        const sheet = (await page.locator('.hud .stats').boundingBox())!
        const compass = (await page.locator('.touchbar.split').boundingBox())!
        const map = (await page.locator('.touchbar.split').getByRole('button', { name: 'Map', exact: true }).boundingBox())!
        expect(shortcuts.height).toBeGreaterThanOrEqual(44)
        expect(shortcuts.x + shortcuts.width).toBeLessThanOrEqual((await page.viewportSize())!.width - insets.right)
        if (portrait) {
          const log = (await page.locator('.hud .messages').boundingBox())!
          expect(log.y + log.height).toBeLessThanOrEqual(shortcuts.y + 1)
          expect(shortcuts.y + shortcuts.height).toBeLessThanOrEqual(sheet.y)
          expect(sheet.y + sheet.height).toBeLessThan(compass.y)
        } else {
          const monsters = (await page.locator('.hud .monsters').boundingBox())!
          expect(monsters.y + monsters.height).toBeLessThanOrEqual(shortcuts.y)
          expect(shortcuts.x).toBeCloseTo(sheet.x)
          if (short) {
            const esc = (await page.locator('.touchbar.split').getByRole('button', { name: 'Esc', exact: true }).boundingBox())!
            const vitals = (await page.locator('.hud .stats .line:has(.stat-bar)').boundingBox())!
            expect(shortcuts.y).toBeCloseTo(esc.y)
            expect(shortcuts.x + shortcuts.width).toBeLessThan(esc.x)
            expect(map.y).toBeCloseTo(esc.y)
            expect(map.x + map.width).toBeLessThan(shortcuts.x)
            expect(vitals.y + vitals.height).toBeLessThan(sheet.y + sheet.height)
          } else expect(shortcuts.y + shortcuts.height).toBeLessThan(compass.y)
        }
      }
      await order()
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `test-results/mobile-spells-${orientation}.png`, animations: 'disabled' })
      await page.setViewportSize(portrait ? { width: 320, height: 560 } : { width: 740, height: 265 })
      await expect.poll(async () => {
        const box = (await page.locator('.touchbar.split').boundingBox())!
        return Math.round(box.x + box.width)
      }).toBe((portrait ? 320 : 740) - insets.right - 8)
      await expect.poll(async () => {
        const box = (await rail.boundingBox())!
        return box.x + box.width
      }).toBeLessThanOrEqual((portrait ? 320 : 740) - insets.right)
      await order(true)
      if (!portrait) await page.screenshot({ path: `test-results/mobile-spells-${orientation}-short.png`, animations: 'disabled' })

      const track = rail.locator('.spell-track')
      const trackBox = (await track.boundingBox())!
      const bookBox = await book.boundingBox()
      const x = trackBox.x + trackBox.width - 15, y = trackBox.y + trackBox.height / 2
      await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let i = 1; i <= 5; i++) {
        await device.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 24 * i, y }] })
      }
      await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(() => track.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
      expect(await book.boundingBox()).toEqual(bookBox)
      expect((await sent()).at(-1)).toEqual(rest)
      await track.evaluate(el => { el.scrollLeft = 0 })

      await rail.getByRole('button', { name: /Foxfire/ }).tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'z' })
      await receive({ msg: 'msgs', messages: [{ text: 'Cast which spell? (? or * to list)', channel: MSGCH.PROMPT }] })
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'a' })
      await receive({ msg: 'msgs', messages: [{ text: 'You conjure some foxfire!' }] })
      await receive({ msg: 'player', turn: 382, mp: 4 })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
      await expect(book).toBeEnabled()

      const dart = rail.getByRole('button', { name: /Magic Dart/ })
      await dart.tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'z' })
      await receive({ msg: 'msgs', messages: [{ text: 'Cast which spell? (? or * to list)', channel: MSGCH.PROMPT }] })
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'b' })
      await receive({ msg: 'input_mode', mode: MouseMode.TARGET })
      await expect(dart).toHaveAttribute('aria-current', 'true')
      await expect(book).toBeDisabled()
      await dart.tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'f' })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })

      await book.tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'I' })
      await showSpellbook()
      await expect(page.getByText('Your spells (describe)', { exact: true })).toBeVisible()
      await receive({ msg: 'close_menu' })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
      const beforeMenu = await sent()
      await page.locator('.hud .stats .line').first().tap()
      const system = page.getByRole('tab', { name: 'System', exact: true })
      await expect(system).toBeHidden()
      await cog.tap()
      await system.tap()
      await page.getByRole('button', { name: 'Settings', exact: true }).tap()
      await expect(page.getByText('Polished Crawl settings', { exact: true })).toBeVisible()
      expect(await sent()).toEqual(beforeMenu)
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

async function openHudSettings(page: import('@playwright/test').Page, group = 'Interface') {
  await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.pad({ type: 'press', button: 'START', t: performance.now() }))
  await page.getByRole('tab', { name: 'System', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-groups').getByText(group, { exact: true }).click()
}

test('in-game dungeon tilt follows the slider before mouse release', async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html')
  await expect(page.locator('.hud .stats')).toContainText('Map lifecycle')
  await openHudSettings(page, 'View')
  const tilt = page.getByRole('slider', { name: 'Dungeon tilt', exact: true })
  await tilt.scrollIntoViewIfNeeded()
  const { x, y, width, height } = (await tilt.boundingBox())!
  const centerY = y + height / 2
  const appliedTilt = async () => (await result(page)).appliedDungeonOptions?.tilt
  await expect.poll(appliedTilt).toBe(35)
  await page.mouse.move(x + width - 2, centerY)
  await page.mouse.down()
  try {
    await expect.poll(appliedTilt).toBe(90)
    await page.mouse.move(x + 2, centerY, { steps: 8 })
    await expect.poll(appliedTilt).toBe(20)
  } finally { await page.mouse.up() }
  await page.reload()
  await expect.poll(appliedTilt).toBe(20)
})

test.describe('cog menu on a touch tablet', () => {
  const viewport = { width: 848, height: 838 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('fits the landscape viewport above the menu controls, including settings', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
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
    await page.screenshot({ path: 'test-results/cog-menu-landscape.png', animations: 'disabled' })
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
    await expect(compass.getByRole('button', { name: 'Fire', exact: true })).toBeVisible()
  })
})

test('Interface layout presets apply live and preserve the Action panel preference', async ({ page }) => {
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
  await page.screenshot({ path: 'test-results/minimap-loading.png' })
  await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
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
  const sent = await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
  await page.mouse.move(box.x + terrain!.x * box.width, box.y + terrain!.y * box.height)
  await page.mouse.down({ button: 'right' })
  await expect.poll(() => outline.getAttribute('style')).not.toBe(before)
  await page.mouse.up({ button: 'right' })
  await expect(outline).toHaveAttribute('style', before!)
  expect(await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)).toEqual(sent)
  await page.screenshot({ path: 'test-results/minimap-desktop.png' })

  await button.click()
  await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'input', text: 'X' })
  await page.locator('#map').click()
  await expect(button).toBeHidden()
  await page.locator('#close').click()
  await expect(button).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expectMapAndListAligned(page, true)
  await page.screenshot({ path: 'test-results/minimap-narrow.png' })
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
      const sent = () => page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)
      const showMap = (state: number) => page.evaluate(state => (window as unknown as MapWindow).__orbrunMapLifecycle.receive({ msg: 'ui_state', state }), state)
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
        await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.ready())
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
      await page.screenshot({ path: `test-results/minimap-phone-${orientation}.png` })
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
        await page.screenshot({ path: 'test-results/minimap-phone-landscape-short.png' })
      }
      await expect(await openMap(map)).toBeVisible()
      await showMap(UiState.NORMAL)
      await checkPlacement()

      if (!landscape) {
        await page.setViewportSize({ width: 320, height: 560 })
        await expect.poll(() => page.locator('canvas.view').boundingBox().then(box => box?.width)).toBe(320)
        await checkPlacement()
        await page.screenshot({ path: 'test-results/minimap-phone-portrait-narrow.png' })
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
      await page.screenshot({ path: `test-results/hud-settings-${narrow ? 'narrow' : 'desktop'}.png` })
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
      await page.screenshot({ path: `test-results/hud-visibility-${narrow ? 'narrow' : 'desktop'}.png` })
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
      await page.screenshot({ path: `test-results/character-panel-scale-${layout.replaceAll(' ', '-')}.png` })
    })
  })
}

test('line of sight fade time is adjustable only when enabled and survives reloads', async ({ page }) => {
  await page.routeWebSocket(/wss?:\/\//, socket => socket.close())
  await page.goto('/settings/view')
  await expect(page.locator('[data-focus="setting:Unexplored fog"], [data-focus="setting:Unexplored atmosphere"]')).toHaveCount(0)
  await expect(page.locator('[data-focus="setting:Smooth LOS edges"]')).toHaveCount(0)
  const fadeRow = page.locator('[data-focus="setting:Line of sight fade"]')
  const fade = fadeRow.locator('.val')
  const fadeNext = fadeRow.getByRole('button', { name: 'Line of sight fade next', exact: true })
  const resetFade = fadeRow.getByRole('button', { name: 'Reset Line of sight fade to default', exact: true })
  const time = page.getByRole('slider', { name: 'Line of sight fade time', exact: true })
  await expect(fade).toHaveText('Off')
  await expect(time).toBeHidden()
  await fadeRow.press('ArrowDown')
  await expect(page.locator('[data-focus="setting:Idle intensity"]')).toBeFocused()
  await fadeNext.click()
  await expect(time).toHaveAttribute('aria-valuetext', '140 ms')
  await time.press('End')
  await time.press('ArrowRight')
  await expect(time).toHaveAttribute('aria-valuetext', '400 ms')
  await page.reload()
  await expect(fade).toHaveText('On')
  await expect(time).toHaveAttribute('aria-valuetext', '400 ms')
  await resetFade.press('Enter')
  await expect(fade).toHaveText('Off')
  await expect(time).toBeHidden()
  await fadeNext.click()
  await expect(time).toHaveAttribute('aria-valuetext', '400 ms')
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await time.scrollIntoViewIfNeeded()
    await expect(fadeNext).toBeInViewport({ ratio: 1 })
    await expect(time).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: `test-results/los-settings-${viewport.width}.png` })
  }
})

test('in-game settings navigation skips fade time while line of sight fade is off', async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html')
  await openHudSettings(page, 'View')
  const fade = page.locator('[data-focus="setting:Line of sight fade"]')
  const time = page.locator('[data-focus="setting:Line of sight fade time"]')
  const idle = page.locator('[data-focus="setting:Idle intensity"]')
  await idle.press('ArrowUp')
  await expect(fade).toBeFocused()
  await fade.press('ArrowDown')
  await expect(idle).toBeFocused()
  await fade.press('ArrowRight')
  await fade.press('ArrowDown')
  await expect(time).toBeFocused()
  await time.press('ArrowRight')
  await expect(time.getByRole('slider')).toHaveAttribute('aria-valuetext', '150 ms')
})

test('foliage sway is adjustable and persists independently of creature idle intensity', async ({ page }) => {
  await page.routeWebSocket(/wss?:\/\//, socket => socket.close())
  await page.goto('/settings/view')
  const foliage = page.locator('[data-focus="setting:Foliage sway"]')
  const previous = foliage.getByRole('button', { name: 'Foliage sway previous' })
  await expect(foliage.locator('.val')).toHaveText('100%')
  await previous.click()
  await page.reload()
  await expect(foliage.locator('.val')).toHaveText('95%')
  await expect(page.locator('[data-focus="setting:Idle intensity"] .val')).toHaveText('100%')
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await foliage.scrollIntoViewIfNeeded()
    await expect(previous).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: `test-results/foliage-sway-${viewport.width}.png` })
  }
  await page.getByText('Reset to defaults', { exact: true }).click()
  await expect(foliage.locator('.val')).toHaveText('100%')
})

test('movement tuning persists in the narrow settings menu and respects instant movement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.routeWebSocket(/wss?:\/\//, socket => socket.close())
  await page.goto('/settings/view')
  const row = (label: string) => page.locator(`[data-focus="setting:${label}"]`)
  const slider = (label: string) => page.getByRole('slider', { name: label, exact: true })
  await expect(page.getByRole('button', { name: /^Explore delay/ })).toHaveCount(0)
  const gestures = [['Move hop height', '35%', '40%'], ['Move squash', '55%', '60%'], ['Move sway', '95%', '100%']]
  for (const [label, changed] of gestures) {
    await page.getByRole('button', { name: `${label} previous`, exact: true }).click()
    await expect(row(label).locator('.val')).toHaveText(changed)
  }
  await slider('Dungeon move duration').press('ArrowRight')
  await expect(row('Dungeon move duration').locator('.val')).toHaveText('150 ms')
  await page.reload()
  for (const [label, changed] of gestures) await expect(row(label).locator('.val')).toHaveText(changed)
  await expect(row('Dungeon move duration').locator('.val')).toHaveText('150 ms')
  await page.getByRole('button', { name: 'Dungeon movement next', exact: true }).click()
  for (const [label, changed] of gestures) {
    await expect(slider(label)).toBeDisabled()
    await expect(page.getByRole('button', { name: `${label} next`, exact: true })).toBeDisabled()
    await expect(row(label).locator('.val')).toHaveText(changed)
  }
  await page.getByRole('button', { name: 'Reset Dungeon move duration to default', exact: true }).click()
  await expect(slider('Dungeon move duration')).toHaveAttribute('aria-valuetext', '140 ms')
  await expect(row('Dungeon movement').locator('.val')).toHaveText('Instant')
  await page.getByRole('button', { name: 'Dungeon movement next', exact: true }).click()
  for (const [label] of gestures) await expect(row(label)).not.toHaveClass(/off/)
  await page.getByText('Reset to defaults', { exact: true }).click()
  for (const [label, , fallback] of gestures) await expect(row(label).locator('.val')).toHaveText(fallback)
  const bounds = await page.locator('.settings .row .value').evaluateAll(values => values.map(value => {
    const rect = value.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewport: innerWidth }
  }))
  for (const rect of bounds) {
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(rect.viewport)
  }
})

test('player cue preferences persist and apply during a game', async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html')
  await page.addStyleTag({ content: '#controls { display: none }' })
  const cues = page.getByRole('region', { name: 'Player cues', exact: true })
  const toggle = (label: string) => cues.getByRole('button', { name: `${label} next`, exact: true })
  const value = (label: string) => cues.locator(`[data-focus="setting:${label}"] .val`)
  const moreLabel = 'MORE icon'
  const levelLabel = 'Level-up animation'
  const closeSettings = async () => {
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
    await expect(page.locator('.overlay-stack > .sysmenu')).toBeHidden()
  }
  const receive = (msg: Record<string, unknown>) => page.evaluate(msg => (window as unknown as MapWindow).__orbrunMapLifecycle.receive(msg), msg)
  const gainWithPrompt = async () => {
    await receive({ msg: 'player', xl: 4 })
    await receive({ msg: 'msgs', more: true })
    await expect(page.locator('.messages .line.more')).toHaveText('--more--')
    await expect(page.locator('.level-up-announcement')).toHaveText('Level up. You are now level 4.')
  }

  await openHudSettings(page, 'View')
  await expect(value(moreLabel)).toHaveText('On')
  await expect(value(levelLabel)).toHaveText('On')
  await cues.screenshot({ path: 'test-results/player-cues-desktop.png' })
  await toggle(moreLabel).click()
  await toggle(levelLabel).click()
  await closeSettings()
  await gainWithPrompt()
  await expect(page.locator('.more-cue')).toBeHidden()
  await expect(page.locator('.level-up')).toBeHidden()
  await page.keyboard.press('Space')
  expect(await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent.at(-1))).toEqual({ msg: 'input', text: ' ' })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.addStyleTag({ content: '#controls { display: none }' })
  await openHudSettings(page, 'View')
  await expect(value(moreLabel)).toHaveText('Off')
  await expect(value(levelLabel)).toHaveText('Off')
  await cues.screenshot({ path: 'test-results/player-cues-narrow.png' })
  await cues.getByRole('button', { name: 'Reset Level-up animation to default', exact: true }).click()
  await closeSettings()
  await gainWithPrompt()
  await expect(page.locator('.more-cue')).toBeHidden()
  await expect(page.locator('.level-up')).toBeVisible()
})

test.describe('View settings on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('in-game View sliders apply camera changes and support controller resets', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html')
    await page.addStyleTag({ content: '#controls { display: none }' })
    await openHudSettings(page, 'View')
    const panel = page.getByRole('dialog', { name: 'View settings' })
    const zoom = panel.getByRole('slider', { name: 'Dungeon zoom', exact: true })
    await expect(zoom).toHaveAttribute('aria-valuetext', '100%')
    await zoom.scrollIntoViewIfNeeded()
    const box = (await zoom.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    await zoom.tap({ position: { x: box.width - 2, y: box.height / 2 } })
    await expect(zoom).toHaveAttribute('aria-valuetext', '200%')
    await expect.poll(async () => (await result(page)).appliedDungeonOptions).toMatchObject({ zoom: 2 })
    await zoom.press('Tab')
    await expect(panel.getByRole('button', { name: 'Reset Dungeon zoom to default', exact: true })).toBeFocused()
    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.pad({ type: 'press', button: 'Y', t: performance.now() }))
    await expect(zoom).toHaveAttribute('aria-valuetext', '100%')
    await expect.poll(async () => (await result(page)).appliedDungeonOptions).toMatchObject({ zoom: 1 })
    await zoom.press('Escape')
    await expect(panel).toBeHidden()
  })
})

test('the Watch route exposes the cog while game data is loading', async ({ page }) => {
  const sent: { msg: string; username?: string }[] = []
  await page.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
    socket.onMessage(raw => {
      const msg = JSON.parse(String(raw))
      sent.push(msg)
      if (msg.msg === 'watch') socket.send(JSON.stringify({ msg: 'watching_started', username: msg.username }))
    })
  })
  await page.goto('/watch/cdi#fixture-spectator')
  const loading = page.getByText('Loading game data…', { exact: true })
  const cog = page.getByRole('button', { name: 'Open system menu', exact: true })
  await expect(loading).toBeVisible()
  await expect(cog).toBeInViewport({ ratio: 1 })
  await cog.click()
  const system = page.locator('.overlay-stack > .sysmenu')
  await expect(system.getByText('Stop watching', { exact: true })).toBeVisible()
  await system.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.settings-groups')).toBeVisible()
  expect(sent).toEqual([{ msg: 'watch', username: 'fixture-spectator' }])
})

for (const touch of [false, true]) {
  test.describe(`spectator menus with ${touch ? 'touch' : 'mouse'}`, () => {
    test.use({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch })

    test('the spectator cog opens Escape and local settings stay above incoming windows', async ({ page }) => {
      await page.goto('/testbed/map-lifecycle.html?spectating')
      await page.addStyleTag({ content: '#controls { display: none }' })
      const cog = page.getByRole('button', { name: 'Open system menu', exact: true })
      await expect(cog).toBeVisible()
      const box = (await cog.boundingBox())!
      if (touch) expect(box.x + box.width).toBe(386)
      else expect(box.x).toBeLessThanOrEqual(8)
      expect(box.y).toBeLessThanOrEqual(8)
      const open = () => touch ? cog.tap() : cog.click()
      await open()
      const system = page.locator('.overlay-stack > .sysmenu')
      await expect(system.getByText('Stop watching', { exact: true })).toBeVisible()
      await system.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.locator('.settings-groups').getByText('View', { exact: true }).click()

      const settings = page.getByRole('dialog', { name: 'View settings' })
      const zoom = settings.getByRole('slider', { name: 'Dungeon zoom', exact: true })
      await zoom.focus()
      const receive = (msg: Record<string, unknown>) => page.evaluate(msg => (window as unknown as MapWindow).__orbrunMapLifecycle.receive(msg), msg)
      await receive({ msg: 'menu', tag: 'inventory', title: { text: 'Inventory' }, flags: 0, total_items: 1,
        items: [{ text: 'a - Watched inventory item', hotkeys: [97] }] })
      await receive({ msg: 'ui-push', type: 'describe-item', title: 'Watched item details', body: 'An item in the watched game.' })
      const inventory = page.locator('.overlay-stack > .popup').filter({ hasText: 'Watched inventory item' })
      const details = page.locator('.overlay-stack > .popup').filter({ hasText: 'Watched item details' })
      await expect(inventory).toBeVisible()
      await expect(details).toBeVisible()
      await expect.poll(() => page.locator('.overlay-stack').evaluate(stack => {
        const local = stack.querySelector(':scope > .settings[data-client]')
        const watched = [...stack.querySelectorAll<HTMLElement>(':scope > .popup:not([data-client])')]
        return !!local && watched.length === 2 && watched.every(el => el.inert &&
          (el.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING))
      })).toBe(true)
      await expect(zoom).toBeFocused()
      await zoom.press('ArrowRight')
      await expect(zoom).toHaveAttribute('aria-valuetext', '105%')

      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      await expect(system).toBeHidden()
      await expect(details).not.toHaveAttribute('inert', '')
      await open()
      await expect(system.getByText('Stop watching', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(system).toBeVisible()
      expect(await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.snapshot().sent)).toEqual([])
    })
  })
}

test('desktop Combat sliders, arrows and individual resets share the saved values', async ({ page }) => {
  await page.routeWebSocket(/wss?:\/\//, socket => socket.close())
  await page.goto('/settings/combat')
  const slider = (name: string) => page.getByRole('slider', { name, exact: true })
  const reset = (name: string) => page.getByRole('button', { name: `Reset ${name} to default`, exact: true })
  const expectValue = (name: string, value: string) => expect(slider(name)).toHaveAttribute('aria-valuetext', value)
  await expectValue('Melee motion time', '210 ms')
  await expectValue('Impact snap', '70%')
  await expectValue('Burst variation', '60%')
  await expectValue('Hit spray pattern', 'All around')
  await expectValue('Death spray pattern', '75% around')
  await slider('Hit spray pattern').press('Home')
  await expectValue('Hit spray pattern', 'Forward')
  await page.getByRole('button', { name: 'Melee motion time next', exact: true }).click()
  await expectValue('Melee motion time', '218 ms')

  const reach = slider('Hit spray reach')
  await reach.scrollIntoViewIfNeeded()
  const { x, y, width, height } = (await reach.boundingBox())!
  await page.mouse.move(x + width / 3, y + height / 2)
  await page.mouse.down()
  await page.mouse.move(x + width - 2, y + height / 2, { steps: 5 })
  await page.mouse.up()
  await expectValue('Hit spray reach', '4×')
  await expect(page.getByRole('button', { name: 'Hit spray reach next', exact: true })).toBeDisabled()

  const duration = slider('Death debris lifetime')
  await expectValue('Death debris lifetime', '4 s')
  await duration.press('ArrowLeft')
  await expectValue('Death debris lifetime', '3.9 s')
  await duration.press('ArrowRight')
  await expectValue('Death debris lifetime', '4 s')
  await duration.press('Home')
  await expectValue('Death debris lifetime', '0.75 s')
  await duration.press('End')
  await expectValue('Death debris lifetime', '12 s')
  await page.reload()
  await expectValue('Hit spray reach', '4×')
  await expectValue('Death debris lifetime', '12 s')
  await expectValue('Hit spray pattern', 'Forward')
  await reset('Death debris lifetime').press('Enter')
  await expectValue('Death debris lifetime', '4 s')
  await expectValue('Hit spray reach', '4×')
  await expectValue('Melee motion time', '218 ms')
  await page.getByText('Reset to defaults', { exact: true }).click()
  await expectValue('Hit spray reach', '1×')
  await expectValue('Hit spray pattern', 'All around')
  await expectValue('Melee motion time', '210 ms')
})

test.describe('Combat settings on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('in-game Combat sliders and individual resets work with touch, keyboard and controller navigation', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html')
    await page.addStyleTag({ content: '#controls { display: none }' })
    await openHudSettings(page, 'Combat')
    const panel = page.getByRole('dialog', { name: 'Combat settings' })
    const amount = panel.getByRole('slider', { name: 'Hit particle amount', exact: true })
    const reach = panel.getByRole('slider', { name: 'Hit spray reach', exact: true })
    await expect(reach).toHaveAttribute('aria-valuetext', '1×')
    await reach.scrollIntoViewIfNeeded()
    const box = (await reach.boundingBox())!
    expect(box.x).toBeGreaterThan(0)
    expect(box.x + box.width).toBeLessThan(390)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await reach.tap({ position: { x: box.width - 2, y: box.height / 2 } })
    await expect(reach).toHaveAttribute('aria-valuetext', '4×')
    await reach.press('ArrowLeft')
    await expect(reach).toHaveAttribute('aria-valuetext', '3.95×')
    const reset = panel.getByRole('button', { name: 'Reset Hit spray reach to default', exact: true })
    await reach.press('Tab')
    await expect(reset).toBeFocused()

    await page.evaluate(() => (window as unknown as MapWindow).__orbrunMapLifecycle.pad({ type: 'press', button: 'Y', t: performance.now() }))
    await expect(reach).toHaveAttribute('aria-valuetext', '1×')
    await reach.press('End')
    await amount.press('Home')
    await expect(reach).toBeDisabled()
    await reset.tap()
    await expect(reach).toHaveAttribute('aria-valuetext', '1×')
    await expect(amount).toHaveAttribute('aria-valuetext', 'Off')
    await reset.press('Escape')
    await expect(panel).toBeHidden()
  })
})

// Real ZIP worker, IndexedDB, browser decoding and AudioContext; only the pack HTTP response is local.
test('audio settings load OSP, persist cache and volume, import ZIPs and remove cached assets', async ({ page }) => {
  const { audioArchive, audioStarts, observeAudio } = await import('./audio-fixture')
  await observeAudio(page)
  await page.routeWebSocket(/wss?:\/\//, socket => socket.close())
  let downloads = 0
  await page.route('https://osp.nemelex.cards/build/latest.zip', route => {
    downloads++
    return route.fulfill({ body: audioArchive(), contentType: 'application/zip', headers: { 'access-control-allow-origin': '*' } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings/audio')
  await expect(page.locator('.audio-status')).toContainText('Download CNC')
  expect(downloads).toBe(0)
  await page.getByRole('button', { name: 'Sound effects next', exact: true }).click()
  await page.getByRole('button', { name: 'Master volume previous', exact: true }).click()
  await page.getByText('Download / refresh OSP', { exact: true }).click()
  await expect(page.locator('.audio-status')).toContainText('3 sound rules ready')
  await page.getByText('Test sound', { exact: true }).click()
  await expect.poll(() => audioStarts(page)).toBe(1)
  await page.reload()
  await expect(page.locator('.audio-status')).toContainText('3 sound rules ready')
  expect(downloads).toBe(1)
  await expect(page.locator('[data-focus="setting:Master volume"] .val')).toHaveText('65%')
  await page.getByText('Test sound', { exact: true }).click()
  await expect.poll(() => audioStarts(page)).toBe(1)
  const choosing = page.waitForEvent('filechooser')
  await page.getByText('Import OSP ZIP', { exact: true }).click()
  await (await choosing).setFiles({ name: 'local-osp.zip', mimeType: 'application/zip', buffer: audioArchive() })
  await expect(page.locator('.audio-status')).toContainText('3 sound rules ready')
  await page.getByText('Remove cached pack', { exact: true }).click()
  await expect(page.locator('.audio-status')).toContainText('removed')
  await page.reload()
  await expect(page.locator('.audio-status')).toContainText('Download CNC')
  expect(downloads).toBe(1)
})

test('live sounds follow confirmed message occurrences and stop on screen teardown', async ({ page }) => {
  const { audioArchive, audioStarts, observeAudio } = await import('./audio-fixture')
  await observeAudio(page)
  await page.routeWebSocket(/wss?:\/\//, socket => socket.close())
  await page.route('https://osp.nemelex.cards/build/latest.zip', route => route.fulfill({ body: audioArchive(), contentType: 'application/zip', headers: { 'access-control-allow-origin': '*' } }))
  await page.goto('/settings/audio')
  await page.getByRole('button', { name: 'Sound effects next', exact: true }).click()
  await page.getByText('Download / refresh OSP', { exact: true }).click()
  await expect(page.locator('.audio-status')).toContainText('3 sound rules ready')
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.evaluate(async () => {
    // Vite-only inspection of the same controller owned by this real GameScreen.
    const path = '/src/audio/controller.ts'
    const { audio } = await import(path)
    await new Promise<void>(resolve => {
      if (audio().snapshot().info) { resolve(); return }
      const off = audio().subscribe((s: { info?: unknown }) => { if (s.info) { off(); resolve() } })
    })
  })
  // A real gesture unlocks Web Audio without sending a game command.
  await page.locator('#controls').click({ position: { x: 2, y: 2 } })
  const receive = (text: string, rollback = 0) => page.evaluate(({ text, rollback }) => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    fixture.receive({ msg: 'msgs', rollback, messages: [{ text, turn: 1 }] })
  }, { text, rollback })
  await receive('You hit the goblin.')
  await expect.poll(() => audioStarts(page)).toBe(1)
  await receive('You hit the goblin. You miss the goblin.', 1)
  await expect.poll(() => audioStarts(page)).toBe(2)
  await receive('You hit the goblin. You miss the goblin.', 1)
  await receive('You hit the goblin.')
  await expect.poll(() => audioStarts(page)).toBe(3)
  await page.evaluate(() => {
    const fixture = (window as unknown as { __orbrunLiveAnimation: LiveAnimation }).__orbrunLiveAnimation
    fixture.receive({ msg: 'msgs', messages: [{ text: 'You hit the goblin.' }] })
    fixture.destroy()
  })
  // Worker replies and browser audio callbacks must not revive a destroyed screen.
  await page.waitForTimeout(150)
  expect(await audioStarts(page)).toBe(3)
})

test('returns to the last successful login after browsing another server, reauthentication and logout', async ({ page }) => {
  let acceptToken = true
  let cookies = 0
  let tokenAttempts = 0
  const username = 'usual-player'
  await page.route('**/morgue-proxy/**', route => route.fulfill({ status: 404 }))
  await page.routeWebSocket(/wss?:\/\//, socket => {
    const reply = (msg: object) => socket.send(JSON.stringify(msg))
    reply({ msg: 'lobby_complete' })
    if (new URL(socket.url()).hostname !== 'crawl-br.roguelikes.gg') return
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw))
      if (message.msg === 'login' && message.username === username && message.password === 'fixture-password') reply({ msg: 'login_success', username })
      if (message.msg === 'token_login') {
        tokenAttempts++
        reply(acceptToken ? { msg: 'login_success', username } : { msg: 'login_fail' })
      }
      if (message.msg === 'set_login_cookie') reply({ msg: 'login_cookie', cookie: `fixture-${++cookies}`, expires: 7 })
    })
  })
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbrun.homeServer')) localStorage.setItem('orbrun.homeServer', JSON.stringify('cdi'))
  })
  await page.goto('/login/cbrg')
  const picker = page.getByRole('combobox', { name: 'Server', exact: true })
  const logIn = page.getByRole('button', { name: 'Log in', exact: true })
  const logOut = page.getByRole('button', { name: 'Log out', exact: true })
  await page.locator('input[name=username]').fill(username)
  await page.locator('input[name=password]').fill('fixture-password')
  await page.locator('.login-form button[data-focus=login]').click()
  await expect(logOut).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orbrun.tokens'))).toContain('fixture-1')

  await picker.selectOption('cao')
  await expect(picker).toHaveValue('cao')
  await expect(logOut).toBeHidden()
  await page.reload()
  await expect(picker).toHaveValue('cbrg')
  await expect(logOut).toBeVisible()
  expect(tokenAttempts).toBe(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orbrun.tokens'))).toContain('fixture-2')

  acceptToken = false
  await page.reload()
  await expect(picker).toHaveValue('cbrg')
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(username)
  await expect(page.locator('.auth-status')).toContainText('Log in again')
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await logIn.click()
  await logOut.click()
  await page.reload()
  await expect(picker).toHaveValue('cbrg')
  await expect(logIn).toBeEnabled()
})

test('shares saved sign-in between tabs through an interrupted connection and logout', async ({ page, context }) => {
  const sockets: import('@playwright/test').WebSocketRoute[] = []
  const attempts: { socket: number; cookie: string }[] = []
  const revoked: string[] = []
  const username = 'reconnect-test'
  let token = 'initial'
  const reply = (socket: import('@playwright/test').WebSocketRoute, msg: object) => socket.send(JSON.stringify(msg))
  await context.route('**/morgue-proxy/**', route => route.fulfill({ status: 404 }))
  await context.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
    const index = sockets.push(socket) - 1
    reply(socket, { msg: 'lobby_complete' })
    socket.onMessage(raw => {
      const msg = JSON.parse(String(raw))
      if (msg.msg === 'token_login') {
        attempts.push({ socket: index, cookie: msg.cookie })
        if (index === 0) return // the first connection fails before WebTiles accepts the token
        if (msg.cookie !== token) return reply(socket, { msg: 'login_fail' })
        token = ''
        reply(socket, { msg: 'login_success', username })
      }
      if (msg.msg === 'set_login_cookie') {
        token = `replacement-${index}`
        reply(socket, { msg: 'login_cookie', cookie: token, expires: 7 })
      }
      if (msg.msg === 'forget_login_cookie') revoked.push(msg.cookie)
    })
  })
  await page.addInitScript(username => {
    const account = { serverId: 'cdi', username }
    localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
    localStorage.setItem('orbrun.account', JSON.stringify(account))
    localStorage.setItem('orbrun.tokens', JSON.stringify({ ['cdi/' + username]: 'initial' }))
  }, username)
  await page.goto('/')
  await expect.poll(() => attempts).toEqual([{ socket: 0, cookie: 'initial' }])
  await expect(page.locator('.auth-status')).toContainText('Signing you back in')
  await expect(page.getByLabel('Password', { exact: true })).toBeHidden()
  await page.screenshot({ path: 'test-results/reconnect-desktop.png' })

  const second = await context.newPage()
  await second.setViewportSize({ width: 390, height: 844 })
  await second.goto('/')
  await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.length)).toBe(1)
  await expect(second.getByLabel('Password', { exact: true })).toBeHidden()
  await second.screenshot({ path: 'test-results/reconnect-narrow.png' })
  await sockets[0].close({ code: 1012 })

  await expect(second.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
  expect(attempts).toEqual([
    { socket: 0, cookie: 'initial' },
    { socket: 1, cookie: 'initial' },
    { socket: 2, cookie: 'replacement-1' },
  ])
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.tokens')!)['cdi/reconnect-test']?.token)).toBe('replacement-2')
  await second.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect.poll(() => revoked.includes('replacement-2')).toBe(true)
  await expect(page.getByRole('button', { name: username, exact: true })).toBeHidden()
  await page.getByRole('combobox', { name: 'Server', exact: true }).selectOption('cdi')
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
})

test('continues the requested game after a reconnect and a rejected saved sign-in', async ({ page }) => {
  const games: string[] = []
  const sockets: import('@playwright/test').WebSocketRoute[] = []
  await page.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
    const index = sockets.push(socket) - 1
    socket.onMessage(raw => {
      const msg = JSON.parse(String(raw))
      if (msg.msg === 'token_login') {
        if (index === 0) void socket.close({ code: 1012 })
        else socket.send(JSON.stringify({ msg: 'login_fail' }))
      }
      if (msg.msg === 'login' && msg.username === 'continue-test' && msg.password === 'fixture-password') {
        socket.send(JSON.stringify({ msg: 'login_success', username: msg.username }))
      }
      if (msg.msg === 'set_login_cookie') socket.send(JSON.stringify({ msg: 'login_cookie', cookie: 'replacement', expires: 7 }))
      if (msg.msg === 'play') {
        games.push(msg.game_id)
        socket.send(JSON.stringify({ msg: 'game_started' }))
      }
    })
  })
  await page.addInitScript(() => {
    const account = { serverId: 'cdi', username: 'continue-test' }
    localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
    localStorage.setItem('orbrun.account', JSON.stringify(account))
    localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/continue-test': 'rejected' }))
  })
  await page.goto('/play/cdi/continue-test/dcss-0.34')
  const fallback = page.locator('.login-form')
  await expect(fallback).toContainText('Log in again')
  await expect(fallback.locator('input[name=username]')).toHaveValue('continue-test')
  await fallback.locator('input[name=password]').fill('fixture-password')
  await fallback.locator('button[data-focus=login]').click()
  await expect.poll(() => games).toEqual(['dcss-0.34'])
  await expect(page.locator('.screen.game')).toBeVisible()
  sockets[1].send(JSON.stringify({ msg: 'go_lobby' }))
  await expect(page.getByRole('button', { name: 'continue-test', exact: true })).toBeVisible()
  expect(sockets).toHaveLength(2)
})

for (const touch of [false, true]) {
  test.describe(touch ? 'Polished menu touch' : 'Polished menu desktop', () => {
    test.use({ viewport: touch ? { width: 320, height: 960 } : { width: 1016, height: 780 }, hasTouch: touch })
    test('keeps inline auth, keyed rows and modal focus stable as the lobby changes', async ({ page }) => {
      const sockets: import('@playwright/test').WebSocketRoute[] = []
      const sent: { msg: string; username?: string; password?: string }[] = []
      const send = (socket: import('@playwright/test').WebSocketRoute, msgs: object[]) => socket.send(JSON.stringify({ msgs }))
      await page.route('**/morgue-proxy/**', route => route.fulfill({ status: 404, body: '' }))
      await page.routeWebSocket(/wss?:\/\//, socket => {
        sockets.push(socket)
        send(socket, [{ msg: 'lobby_complete' }])
        socket.onMessage(raw => {
          const m = JSON.parse(String(raw)); sent.push(m)
          if (m.msg === 'login' && m.password === 'fixture-password') send(socket, [
            { msg: 'login_success', username: m.username },
            { msg: 'set_game_links', content: '<span><a href="#play-dcss-0.34">DCSS 0.34</a><a class="edit_rc_link" data-game_id="stable-rc">(edit rc)</a></span><span><a href="#play-dcss-web-trunk">DCSS trunk</a><a class="edit_rc_link" data-game_id="trunk-rc">(edit rc)</a></span><span><a href="#play-descent-web-trunk">Descent</a></span>' },
            { msg: 'lobby_complete' },
          ])
        })
      })
      await page.addInitScript(() => {
        const account = { serverId: 'cdi', username: 'menu-test' }
        localStorage.setItem('orbrun.accounts', JSON.stringify([account, { serverId: 'cdi', username: 'other-test' }]))
        localStorage.setItem('orbrun.account', JSON.stringify(account))
      })
      await page.goto('/')
      const user = page.getByRole('textbox', { name: 'Username', exact: true }), pass = page.getByLabel('Password', { exact: true })
      const server = page.getByRole('combobox', { name: 'Server', exact: true })
      const login = page.getByRole('button', { name: 'Log in', exact: true })
      const firstCommand = page.getByRole('navigation', { name: 'Main menu' }).getByRole('button').first()
      await expect(firstCommand).not.toBeFocused()
      await expect(firstCommand).toHaveCSS('outline-style', 'none')
      await page.getByRole('button', { name: 'Accounts', exact: true }).focus()
      await page.keyboard.press('Tab')
      await expect(firstCommand).toBeFocused()
      await expect(firstCommand).toHaveCSS('outline-style', 'solid')
      await page.locator('.polished-subtitle').click()
      await expect(firstCommand).not.toBeFocused()
      await expect(firstCommand).toHaveCSS('outline-style', 'none')
      // Cover both a remembered account and a server where this device has never logged in.
      if (touch) {
        await server.selectOption('cao')
        const [picker, ...fields] = await Promise.all([server, user, pass, login].map(control => control.boundingBox()))
        for (const field of fields) expect(field!.y + field!.height / 2).toBeCloseTo(picker!.y + picker!.height / 2)
        await expect(login).toBeInViewport({ ratio: 1 })
      }
      await user.fill('menu-test'); await pass.fill('fixture-password')
      const handle = await pass.elementHandle()
      send(sockets.at(-1)!, [{ msg: 'lobby_entry', id: 1, username: 'viewer', game_id: 'dcss-0.34' }, { msg: 'lobby_complete' }])
      await expect(pass).toBeFocused(); await expect(pass).toHaveValue('fixture-password')
      expect(await handle!.evaluate(el => el === document.activeElement)).toBe(true)
      for (const id of ['about', 'news']) {
        const trigger = page.locator(`[data-focus="${id}"]`)
        await trigger.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.locator('.polished-home')).toHaveAttribute('inert', '')
        send(sockets.at(-1)!, [{ msg: 'lobby_complete' }])
        await page.keyboard.press('Shift+Tab')
        expect(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(trigger).toBeFocused()
        await expect(pass).toHaveValue('fixture-password')
      }
      expect(await page.evaluate(() => localStorage.getItem('orbrun.newsSeen'))).toBeTruthy()
      await pass.fill('rejected-password')
      await login.click()
      await expect(login).toBeDisabled()
      await expect(page.locator('.account-bar [role="status"]')).toHaveText('Logging in…')
      await pass.fill('fixture-password')
      await pass.press('Enter')
      send(sockets.at(-1)!, [{ msg: touch ? 'auth_error' : 'login_fail', reason: 'Incorrect password.' }])
      await expect(page.locator('.account-bar [role="status"]')).toHaveText('Incorrect password.')
      await expect(pass).toHaveValue('fixture-password')
      await expect(login).toBeEnabled()
      await page.screenshot({ path: `test-results/polished-login-${touch ? 'mobile' : 'desktop'}.png` })
      await pass.press('Enter')
      await expect(page.locator('[data-focus="play:dcss-0.34"]')).toBeVisible()
      await expect(page.locator('.signed-in')).toContainText('menu-test')
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.account')!))).toEqual({ serverId: touch ? 'cao' : 'cdi', username: 'menu-test' })
      await expect(page.locator('.polished-commands')).not.toContainText('Descent')
      expect(sent.filter(m => m.msg === 'login')).toEqual([
        { msg: 'login', username: 'menu-test', password: 'rejected-password' },
        { msg: 'login', username: 'menu-test', password: 'fixture-password' },
      ])
      const play = page.locator('[data-focus="play:dcss-web-trunk"]'); await play.focus()
      const node = await play.elementHandle()
      send(sockets.at(-1)!, [{ msg: 'lobby_entry', id: 2, username: 'menu-test', game_id: 'dcss-web-trunk', char: 'TrFi', xl: '11', place: 'Lair:2' }])
      await expect(play).toContainText('Continue')
      expect(await node!.evaluate(el => el === document.activeElement)).toBe(true)
      expect(await page.locator('.polished-home').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `test-results/polished-${touch ? 'mobile' : 'desktop'}.png` })
      await page.locator('[data-focus="about"]').click()
      await page.screenshot({ path: `test-results/polished-modal-${touch ? 'mobile' : 'desktop'}.png` })
      await page.goBack()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.polished-home')).not.toHaveAttribute('inert', '')
      await page.getByRole('button', { name: 'menu-test', exact: true }).click()
      const switchAccount = page.getByRole('button', { name: 'Switch to other-test on CDI' })
      await expect(switchAccount).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: `test-results/accounts-${touch ? 'mobile' : 'desktop'}.png` })
      await switchAccount.click()
      await expect(server).toHaveValue('cdi')
      await expect(user).toHaveValue('other-test')
      await expect(login).toBeEnabled()
    })
  })
}

test('menu entrance remains usable when recordings are unavailable despite an old saved animation setting', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let requests = 0
  let failFirstRequest!: () => void
  const loading = new Promise<void>(resolve => { failFirstRequest = resolve })
  await page.route('**/menu/clips/**', async route => {
    if (++requests !== 1) return route.continue()
    await loading
    return route.fulfill({ status: 404, body: '' })
  })
  await page.routeWebSocket(/wss?:\/\//, socket => socket.close())
  await page.addInitScript(() => { localStorage.setItem('orbrun.settings', JSON.stringify({ depthAnimate: false })) })
  await page.goto('/')
  const canvas = page.locator('.menu-backdrop canvas')
  const shine = page.locator('.crawl-title')
  await expect(page.getByText('Loading dungeon replay…')).toBeVisible()
  await expect(page.locator('.polished-footer')).toBeInViewport({ ratio: 1 })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: 'test-results/menu-loading-narrow.png' })
  failFirstRequest()
  await expect(page.getByRole('button', { name: 'Retry replay' })).toBeVisible()
  expect(requests).toBe(1)
  await expect(canvas).toBeHidden()
  expect(await shine.evaluate(el => getComputedStyle(el, '::after').animationDuration)).toBe('8s')
  await page.locator('[data-focus="about"]').click()
  expect(await shine.evaluate(el => getComputedStyle(el, '::after').animationName)).toBe('none')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Retry replay' }).click()
  await expect(canvas).toBeVisible()
  await page.locator('[data-focus="settings"]').click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  expect(requests).toBe(2)
})

menuReplayCheck(false)

test.describe('menu replay on a high-density phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })

  test('uses extra backing pixels in portrait and caps the canvas area in landscape', async ({ page }) => {
    await page.routeWebSocket(/^wss:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
    await page.addInitScript(() => { Math.random = () => 0.999 })
    await page.goto('/')
    const canvas = page.locator('.menu-backdrop canvas')
    await expect(canvas).toBeVisible()
    const measure = () => canvas.evaluate(el => {
      const { width, height } = el.getBoundingClientRect()
      const { width: pixelsWide, height: pixelsHigh } = el as HTMLCanvasElement
      return { scale: pixelsWide / width, area: pixelsWide * pixelsHigh, cssArea: width * height }
    })
    await expect.poll(async () => (await measure()).scale).toBeCloseTo(1.5)
    await page.setViewportSize({ width: 960, height: 440 })
    const budget = 1280 * 720
    await expect.poll(async () => (await measure()).area / budget).toBeCloseTo(1)
    const landscape = await measure()
    expect(landscape.cssArea * 1.5 ** 2).toBeGreaterThan(budget)
    expect(landscape.scale).toBeCloseTo(Math.sqrt(budget / landscape.cssArea))
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => (await measure()).scale).toBeCloseTo(1.5)
  })
})

for (const narrow of [false, true]) {
  test(`menu recording chooser loads only the current recording and resets on reload at ${narrow ? 'narrow' : 'desktop'} width`, async ({ page }) => {
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1280, height: 720 })
    await page.routeWebSocket(/^wss:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
    await page.addInitScript(() => {
      Math.random = () => .999
      localStorage.setItem('orbrun.settings', JSON.stringify({ depthTilt: 65 }))
    })
    const assetRequests: string[] = []
    page.on('request', request => { if (request.url().includes('/menu/')) assetRequests.push(request.url()) })
    await page.goto('/')
    const chooser = page.getByRole('combobox', { name: 'Choose scene', exact: true })
    const canvas = page.locator('.menu-backdrop canvas')
    await expect(chooser).toBeVisible()
    await expect(canvas).toBeVisible()
    await expect(chooser).toHaveValue('')
    const requestedClips = () => assetRequests.filter(url => url.includes('/menu/clips/'))
    expect(requestedClips()).toHaveLength(1)
    expect(new Set(assetRequests.filter(url => url.includes('/menu/gamedata/')).map(url => url.split('/gamedata/')[1].split('/')[0])).size).toBe(1)
    for (const title of ['Octopode in the Vaults', 'Crystal Spears in Dis', 'Vaults skirmish', 'Ghoul in the Swamp', 'Blademaster in the Elven Halls', 'The Gauntlet Transporter', 'Stand against Jeremiah', 'Djinni descent', 'Volcano Lake']) {
      const before = await canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())
      await chooser.selectOption({ label: title })
      await expect.poll(() => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())).not.toBe(before)
      await expect(canvas).toBeVisible()
    }
    expect(requestedClips()).toHaveLength(10)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.settings')!))).toEqual({ depthTilt: 65 })
    await chooser.selectOption({ label: 'Polar Vortex in Gehenna' })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `test-results/menu-chooser-${narrow ? 'narrow' : 'desktop'}.png` })
    const chosen = await chooser.inputValue()
    await page.locator('[data-focus="about"]').click(); await expect(chooser).toBeHidden()
    await page.keyboard.press('Escape'); await expect(chooser).toHaveValue(chosen)
    await chooser.selectOption({ label: 'Shuffle all' }); await expect(chooser).toHaveValue('')
    await chooser.selectOption({ label: 'Djinni descent' })
    const djinni = await chooser.inputValue()
    await page.getByRole('button', { name: 'Next scene' }).click()
    await expect(chooser).not.toHaveValue(djinni)
    await page.getByRole('button', { name: 'Previous scene' }).click()
    await expect(chooser).toHaveValue(djinni)
    await expect(page.locator('.menu-replay-title')).toHaveText('Djinni descent')
    await page.reload(); await expect(chooser).toBeVisible(); await expect(chooser).toHaveValue('')
  })

  test(`menu replay tilt and zoom preview and persist with native controls at ${narrow ? 'narrow' : 'desktop'} width`, async ({ page }) => {
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1280, height: 720 })
    await page.routeWebSocket(/^wss:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
    await page.addInitScript(() => {
      Math.random = () => 0.999 // Stable first clip for the visual evidence.
      if (!localStorage.getItem('orbrun.settings')) localStorage.setItem('orbrun.settings', JSON.stringify({ depthTilt: 50, depthZoom: 1.2 }))
    })
    await page.goto('/')
    const slider = page.getByRole('slider', { name: 'Dungeon tilt', exact: true })
    const canvas = page.locator('.menu-backdrop canvas')
    await expect(canvas).toBeVisible()
    await expect(slider).toBeVisible()
    await expect(slider).toHaveValue('50')
    const controls = await page.locator('.menu-replay-controls').boundingBox()
    expect(controls).not.toBeNull()
    expect(controls!.x).toBeGreaterThanOrEqual(0)
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(narrow ? 390 : 1280)
    expect(controls!.x + controls!.width / 2).toBeCloseTo(narrow ? 195 : 1280 * .68, 0)
    if (narrow) {
      const main = (await page.locator('.polished-main').boundingBox())!
      const footer = (await page.locator('.polished-footer').boundingBox())!
      expect(main.y).toBeLessThan(844 / 4)
      expect(main.y + main.height).toBeLessThanOrEqual(controls!.y)
      const footerGap = footer.y - (controls!.y + controls!.height)
      expect(footerGap).toBeGreaterThanOrEqual(0)
      expect(footerGap).toBeLessThan(16)
      expect(footer.y + footer.height).toBeGreaterThan(814)
      await expect(page.locator('.polished-footer')).toBeInViewport({ ratio: 1 })
    }
    const before = await canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())
    // A real pointer click catches controls accidentally buried under the full-screen home layer.
    await slider.click()
    await slider.fill('70')
    await slider.press('ArrowRight')
    await expect(slider).toHaveValue('71')
    await expect(slider).toHaveAttribute('aria-valuetext', '71 degrees')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.settings')!))).toMatchObject({ depthTilt: 71, depthZoom: 1.2 })
    await expect.poll(() => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())).not.toBe(before)
    const zoom = page.getByRole('slider', { name: 'Dungeon zoom', exact: true })
    await expect(zoom).toHaveValue('120')
    await zoom.click()
    await zoom.press('Home'); await expect(zoom).toHaveValue('50')
    await zoom.press('End'); await expect(zoom).toHaveValue('200')
    await zoom.fill('145')
    await zoom.press('ArrowRight')
    await expect(zoom).toHaveAttribute('aria-valuetext', '150%')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.settings')!))).toMatchObject({ depthTilt: 71, depthZoom: 1.5 })
    await page.screenshot({ path: `test-results/menu-tilt-${narrow ? 'narrow' : 'desktop'}.png` })
    await page.locator('[data-focus="about"]').click()
    await expect(slider).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(slider).toBeVisible()
    await expect(slider).toHaveValue('71')
    await page.reload()
    await expect(slider).toBeVisible()
    await expect(slider).toHaveValue('71')
    await expect(zoom).toHaveValue('150')
    for (const [key, value] of [['Home', '20'], ['End', '90']]) {
      const pixels = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())
      await expect(canvas).toBeVisible()
      const previous = await pixels()
      await slider.press(key)
      await expect(slider).toHaveValue(value)
      await expect.poll(pixels).not.toBe(previous)
      await page.screenshot({ path: `test-results/menu-tilt-${value}-${narrow ? 'narrow' : 'desktop'}.png` })
    }
  })
}
