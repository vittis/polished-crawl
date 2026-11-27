import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import { smoke, test } from './fixtures'

type Evidence = { workers: number; opens: string[]; draws: number }

export function menuReplayCheck(production: boolean) {
  test('recorded menu renders without an engine and sleeps when covered or hidden', smoke, async ({ page, baseURL }) => {
    const base = production ? 'http://127.0.0.1:5287' : baseURL!
    const csp = /Content-Security-Policy: (.+)/.exec(readFileSync(new URL('../../apps/orbrun/public/_headers', import.meta.url), 'utf8'))![1]
    await page.route(base + '/**', async route => {
      if (route.request().resourceType() !== 'document') return route.continue()
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
    })
    const forbidden: string[] = []
    page.on('request', request => { if (/\/menu-engine\/|\/engine\/|\.wasm(?:$|\?)/.test(request.url())) forbidden.push(request.url()) })
    await page.routeWebSocket(/^wss:\/\//, socket => {
      socket.onMessage(message => {
        const msg = JSON.parse(String(message)).msg
        if (['watch', 'play', 'key', 'input', 'chat'].includes(msg)) forbidden.push(msg)
      })
      socket.send(JSON.stringify({ msg: 'lobby_complete' }))
    })
    await page.addInitScript(() => {
      const evidence: Evidence = { workers: 0, opens: [], draws: 0 }
      Object.assign(window, { __menuEvidence: evidence })
      // Replay works even where the retired JSPI engine was unsupported.
      Object.defineProperty(WebAssembly, 'Suspending', { configurable: true, value: undefined })
      const originalOpen = indexedDB.open.bind(indexedDB)
      indexedDB.open = (...args) => { evidence.opens.push(args[0]); return originalOpen(...args) }
      const Original = Worker
      window.Worker = class extends Original {
        constructor(url: string | URL, options?: WorkerOptions) { super(url, options); evidence.workers++ }
      }
      const draw = CanvasRenderingContext2D.prototype.drawImage
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        if (this.canvas.matches?.('.menu-backdrop canvas')) evidence.draws++
        return Reflect.apply(draw, this, args)
      }
    })
    const evidence = () => page.evaluate(() => (window as unknown as { __menuEvidence: Evidence }).__menuEvidence)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(base)
    const canvas = page.locator('.menu-backdrop canvas')
    await expect(canvas).toBeVisible()
    expect(await canvas.evaluate(el => (el as HTMLCanvasElement).width / el.getBoundingClientRect().width)).toBeCloseTo(1)
    const pixels = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL())
    const initial = await pixels()
    await expect.poll(pixels).not.toBe(initial)
    const park = async () => {
      const before = await evidence(), beforePixels = await pixels()
      await page.waitForTimeout(1000) // Real observation: neither the renderer nor playback wakes while parked.
      expect((await evidence()).draws).toBe(before.draws)
      expect(await pixels()).toBe(beforePixels)
    }
    await page.locator('[data-focus="about"]').click(); await park()
    await page.keyboard.press('Escape')
    const resumed = (await evidence()).draws
    await expect.poll(async () => (await evidence()).draws).toBeGreaterThan(resumed)
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
    await park()
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
    await expect(canvas).toBeVisible()
    const beforeResize = (await evidence()).draws
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => (await evidence()).draws).toBeGreaterThan(beforeResize)
    await expect(page.getByRole('heading', { name: 'Polished Crawl' })).toBeVisible()
    expect((await evidence()).workers).toBe(0)
    expect((await evidence()).opens).toEqual([])
    expect(forbidden).toEqual([])
    await page.locator('[data-focus="settings"]').click()
    const settingsDraws = (await evidence()).draws
    await expect.poll(async () => (await evidence()).draws).toBeGreaterThan(settingsDraws)
    const replay = page.getByRole('group', { name: 'Dungeon replay' })
    await expect(replay.getByRole('combobox', { name: 'Choose scene' })).toBeVisible()
    await expect(replay).toBeInViewport({ ratio: 1 })
    expect(await page.locator('.polished-shell.settings').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none')
    await page.locator('[data-focus="settings:View"]').click()
    const view = page.locator('.settings-scroll')
    const tilt = view.getByRole('slider', { name: 'Dungeon tilt' })
    const quickTilt = replay.getByRole('slider', { name: 'Dungeon tilt' })
    const quickZoom = replay.getByRole('slider', { name: 'Dungeon zoom' })
    const perspective = view.getByRole('button', { name: '2.5D perspective next' })
    await expect(quickTilt).toHaveAttribute('aria-valuetext', '35 degrees')
    await expect(quickTilt).toBeEnabled()
    await perspective.click()
    await expect(tilt).toBeDisabled()
    await expect(quickTilt).toBeDisabled()
    await perspective.click()
    await expect(quickTilt).toBeEnabled()
    await tilt.scrollIntoViewIfNeeded()
    const box = (await tilt.boundingBox())!
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2)
    const beforeEdit = (await evidence()).draws
    await page.mouse.down()
    await expect(quickTilt).toHaveAttribute('aria-valuetext', '90 degrees')
    await expect.poll(async () => (await evidence()).draws).toBeGreaterThan(beforeEdit)
    await page.mouse.up()
    await quickZoom.click()
    await quickZoom.press('End')
    await expect(view.getByRole('slider', { name: 'Dungeon zoom' })).toHaveAttribute('aria-valuetext', '200%')
    await expect(replay).toBeInViewport({ ratio: 1 })
    const narrowFrame = (await page.locator('.menu-frame.settings-list').boundingBox())!
    const narrowReplay = (await replay.boundingBox())!
    expect(narrowFrame.y + narrowFrame.height).toBeLessThanOrEqual(narrowReplay.y)
    await page.setViewportSize({ width: 1280, height: 720 })
    const desktopDraws = (await evidence()).draws
    await expect.poll(async () => (await evidence()).draws).toBeGreaterThan(desktopDraws)
    await expect(replay).toBeInViewport({ ratio: 1 })
    const desktopFrame = (await page.locator('.menu-frame.settings-list').boundingBox())!
    const desktopReplay = (await replay.boundingBox())!
    expect(desktopFrame.x + desktopFrame.width).toBeLessThanOrEqual(desktopReplay.x)
    await replay.getByRole('combobox', { name: 'Choose scene' }).selectOption({ label: 'Crystal Spears in Dis' })
    await expect(replay.locator('.menu-replay-title')).toHaveText('Crystal Spears in Dis')
    await expect(canvas).toBeVisible()
    await expect(page.getByRole('heading', { name: 'View', exact: true })).toBeVisible()
  })
}
