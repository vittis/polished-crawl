import { test as base, expect, type Page } from '@playwright/test'
import servers from '../../apps/orbrun/data/servers.json' with { type: 'json' }
import type {} from '../../apps/orbrun/testbed/map-lifecycle'

export const smoke = { tag: '@smoke' }
export const androidUserAgent = 'Mozilla/5.0 (Linux; Android 15) Chrome/144.0.0.0 Mobile Safari/537.36'

// Every test gets a fresh browser context. Fixture exceptions must fail the gate,
// including errors that happen after a fixture writes its initial status.
export const test = base.extend<{ pageErrors: void }>({
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route(url => servers.some(server => url.href === server.http + '/'), route =>
      route.request().method() === 'HEAD' ? route.abort() : route.fallback())
    await use()
    expect(errors, 'uncaught browser errors').toEqual([])
  }, { auto: true }],
})

export async function result(page: Page) {
  const text = await page.locator('#result').innerText()
  return text.trim() ? JSON.parse(text) : {}
}

export async function openHudSettings(page: Page, group = 'Interface') {
  await page.evaluate(() => window.__orbrunMapLifecycle.pad({ type: 'press', button: 'START', t: performance.now() }))
  await page.getByRole('tab', { name: 'System', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-groups').getByText(group, { exact: true }).click()
}
