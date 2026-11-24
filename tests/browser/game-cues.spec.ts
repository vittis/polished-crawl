import { expect } from '@playwright/test'
import { MouseMode, type ServerMessage } from '../../packages/webtiles/src/protocol'
import { result, smoke, test } from './fixtures'
import type {} from '../../apps/orbrun/testbed/live-animation'

test('level announcement appears before answering the stat choice and follows the rendered character', smoke, async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-13T12:00:01Z'))
  const popup = page.locator('.level-up')
  await expect(popup).toBeHidden()
  await page.evaluate(mode => {
    const fixture = window.__orbrunLiveAnimation
    fixture.receive({ msg: 'player', xl: 5 })
    fixture.receive({ msg: 'msgs', messages: [
      { text: 'You have reached level 6!', channel: 11, turn: 41 },
      { text: 'Your experience leads to an increase in your attributes!', channel: 11, turn: 41 },
      { text: 'Increase (S)trength, (I)ntelligence, or (D)exterity?', channel: 2, turn: 41 },
    ] })
    fixture.receive({ msg: 'input_mode', mode })
  }, MouseMode.PROMPT)
  await page.clock.runFor(100)
  await expect(popup).toBeVisible()
  await expect(popup).toHaveAttribute('data-level', '6')
  await expect(popup).toHaveCSS('pointer-events', 'none')
  await expect(popup.locator(':focus')).toHaveCount(0)
  await expect(page.locator('.prompt-card')).toBeVisible()
  expect(await page.evaluate(() => window.__orbrunLiveAnimation.snapshot().xl)).toBe(5)
  const checkAnchor = async () => {
    const player = await page.evaluate(() => window.__orbrunLiveAnimation.snapshot().playerProjection)
    const art = (await popup.locator('canvas').boundingBox())!
    expect(Math.abs(art.x + art.width / 2 - player.x)).toBeLessThanOrEqual(1)
    expect(art.y + art.height).toBeLessThan(player.y - player.scale * 0.7)
    expect(art.y + art.height).toBeGreaterThan(player.y - player.scale * 1.5)
  }
  await checkAnchor()
  // A camera/actor transition and a resize must not leave the banner at its old position.
  await page.evaluate(() => window.__orbrunLiveAnimation.walk())
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
  await page.evaluate(() => window.__orbrunLiveAnimation.receive({ msg: 'player', xl: 6 }))
  await page.clock.runFor(100)
  await expect(popup).toBeHidden()
  await page.evaluate(() => window.__orbrunLiveAnimation.destroy())
  expect((await result(page)).destroyed).toBe(true)
})

test('a level-up animation takes precedence over a pending MORE cue', async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-11-13T12:00:01Z'))
  const receive = (msg: ServerMessage) => page.evaluate(msg => window.__orbrunLiveAnimation.receive(msg), msg)
  const popup = page.locator('.level-up')
  const cue = page.locator('.more-cue')

  await receive({ msg: 'msgs', more: true, messages: [{ text: 'You have reached level 4!', channel: 11 }] })
  await page.clock.runFor(100)
  await expect(popup).toBeVisible()
  await expect(cue).toBeHidden()
  await expect(page.locator('.messages .line.more')).toHaveText('--more--')

  await page.keyboard.press('Space')
  expect(await page.evaluate(() => window.__orbrunLiveAnimation.snapshot().sent)).toEqual([{ msg: 'input', text: ' ' }])
  await page.clock.runFor(2000)
  await expect(popup).toBeHidden()
  await expect(cue).toBeVisible()
  await receive({ msg: 'msgs', more: false })
  await page.clock.runFor(100)
  await expect(cue).toBeHidden()
})

test('message pauses show a player cue until the server clears them and preserve dungeon brightness', smoke, async ({ page }) => {
  await page.goto('/testbed/live-animation.html?frameTime=1')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const cue = page.locator('.more-cue')
  await expect(cue).toBeHidden()
  const corner = { x: 30, y: 130, width: 40, height: 40 }
  await page.evaluate(() => {
    const fixture = window.__orbrunLiveAnimation
    fixture.receive({ msg: 'msgs', more: true, messages: [{ text: 'You have reached level 3!', channel: 11 }] })
  })
  await expect(page.locator('.messages .line.more')).toHaveText('--more--')
  await expect(cue).toBeVisible()
  await expect(page.locator('.more-scrim')).toHaveCount(0)
  const checkAnchor = () => expect.poll(async () => {
    const bounds = await cue.boundingBox()
    const player = await page.evaluate(() => window.__orbrunLiveAnimation.snapshot().playerProjection)
    return !!bounds && Math.abs(bounds.x + bounds.width / 2 - player.x) < 1
      && bounds.y + bounds.height < player.y - player.scale * 0.5
      && bounds.y + bounds.height > player.y - player.scale * 1.3
  }).toBe(true)
  await checkAnchor()
  await page.setViewportSize({ width: 390, height: 844 })
  await checkAnchor()
  const sent = () => page.evaluate(() => window.__orbrunLiveAnimation.snapshot().sent)
  expect(await sent()).toEqual([])
  await page.keyboard.press('Space')
  expect(await sent()).toEqual([{ msg: 'input', text: ' ' }])
  await expect(cue).toBeVisible()
  await page.evaluate(() => {
    const fixture = window.__orbrunLiveAnimation
    fixture.receive({ msg: 'msgs', more: false })
  })
  await expect(page.locator('.messages')).not.toHaveClass(/\bmore\b/)
  await expect(cue).toBeHidden()
  await page.evaluate(() => window.__orbrunLiveAnimation.pad({ type: 'press', button: 'START', t: performance.now() }))
  await expect(page.locator('.popup.sysmenu')).toBeVisible()
  expect(await page.locator('.overlay-stack').evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toBe('none')
  await expect.poll(() => page.locator('.overlay-stack').evaluate(el => getComputedStyle(el, '::before').backgroundColor)).toBe('rgba(3, 2, 6, 0.5)')

  await page.reload()
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  await page.evaluate(mode => {
    const fixture = window.__orbrunLiveAnimation
    fixture.receive({ msg: 'game_client' })
    fixture.receive({ msg: 'input_mode', mode })
  }, MouseMode.MORE)
  await expect(page.locator('.loading')).toBeVisible()
  await expect(cue).toBeHidden()
})

test('Dungeon and flat atmosphere, foliage sway, paused frames and impact', smoke, async ({ page }) => {
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

test('real GameScreen keeps animating after the device motion preference changes', smoke, async ({ page }) => {
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
