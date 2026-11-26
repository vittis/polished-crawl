import { expect } from '@playwright/test'
import { result, smoke, test } from './fixtures'
import type {} from '../../apps/orbrun/testbed/live-animation'

// Real ZIP worker, IndexedDB, browser decoding and AudioContext; only the pack HTTP response is local.
test('audio settings load OSP, persist cache and volume, import ZIPs and remove cached assets', smoke, async ({ page }) => {
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

test('live sounds follow confirmed message occurrences and stop on screen teardown', smoke, async ({ page }) => {
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
    const fixture = window.__orbrunLiveAnimation
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
    const fixture = window.__orbrunLiveAnimation
    fixture.receive({ msg: 'msgs', messages: [{ text: 'You hit the goblin.' }] })
    fixture.destroy()
  })
  // Worker replies and browser audio callbacks must not revive a destroyed screen.
  await page.waitForTimeout(150)
  expect(await audioStarts(page)).toBe(3)
})
