import { expect } from '@playwright/test'
import type { ServerMessage } from '../../packages/webtiles/src/protocol'
import { openHudSettings, result, smoke, test } from './fixtures'
import type {} from '../../apps/orbrun/testbed/map-lifecycle'

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

test('line of sight fade time is adjustable only when enabled and survives reloads', smoke, async ({ page }) => {
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
  const receive = (msg: ServerMessage) => page.evaluate(msg => window.__orbrunMapLifecycle.receive(msg), msg)
  const gainWithPrompt = async () => {
    await receive({ msg: 'player', xl: 4 })
    await receive({ msg: 'msgs', more: true })
    await expect(page.locator('.messages .line.more')).toHaveText('--more--')
    await expect(page.locator('.level-up-announcement')).toHaveText('Level up. You are now level 4.')
  }

  await openHudSettings(page, 'View')
  await expect(value(moreLabel)).toHaveText('On')
  await expect(value(levelLabel)).toHaveText('On')
  await toggle(moreLabel).click()
  await toggle(levelLabel).click()
  await closeSettings()
  await gainWithPrompt()
  await expect(page.locator('.more-cue')).toBeHidden()
  await expect(page.locator('.level-up')).toBeHidden()
  await page.keyboard.press('Space')
  expect(await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent.at(-1))).toEqual({ msg: 'input', text: ' ' })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.addStyleTag({ content: '#controls { display: none }' })
  await openHudSettings(page, 'View')
  await expect(value(moreLabel)).toHaveText('Off')
  await expect(value(levelLabel)).toHaveText('Off')
  await cues.getByRole('button', { name: 'Reset Level-up animation to default', exact: true }).click()
  await closeSettings()
  await gainWithPrompt()
  await expect(page.locator('.more-cue')).toBeHidden()
  await expect(page.locator('.level-up')).toBeVisible()
})

test.describe('View settings on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('in-game View sliders apply camera changes and support controller resets', smoke, async ({ page }) => {
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
    await page.evaluate(() => window.__orbrunMapLifecycle.pad({ type: 'press', button: 'Y', t: performance.now() }))
    await expect(zoom).toHaveAttribute('aria-valuetext', '100%')
    await expect.poll(async () => (await result(page)).appliedDungeonOptions).toMatchObject({ zoom: 1 })
    await zoom.press('Escape')
    await expect(panel).toBeHidden()
  })
})

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

    await page.evaluate(() => window.__orbrunMapLifecycle.pad({ type: 'press', button: 'Y', t: performance.now() }))
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
