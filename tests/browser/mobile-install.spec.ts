import { expect } from '@playwright/test'
import { smoke, test } from './fixtures'

const androidUserAgent = 'Mozilla/5.0 (Linux; Android 15) Chrome/144.0.0.0 Mobile Safari/537.36'

test.describe('Android web app installation', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, userAgent: androidUserAgent })

  test('offers the native install dialog on tap and remembers when it is declined', smoke, async ({ page }) => {
    await page.routeWebSocket(/wss?:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
    await page.addInitScript(() => localStorage.setItem('orbrun.loginServer', JSON.stringify('cdi')))
    await page.goto('/')
    const promotion = page.getByRole('region', { name: 'Install as app' })
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    await expect(promotion).toContainText('Install and create shortcut')
    await expect(promotion.getByRole('button', { name: 'Install', exact: true })).toBeHidden()

    const offerInstall = () => page.evaluate(() => {
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {
          document.documentElement.dataset.installActivated = String(navigator.userActivation.isActive)
          return { outcome: 'dismissed' }
        },
      })
      return !window.dispatchEvent(event)
    })
    expect(await offerInstall()).toBe(true)
    await expect(promotion).toBeInViewport({ ratio: 1 })
    await expect(page.locator('button[data-focus="play"]')).toBeInViewport({ ratio: 1 })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: 'test-results/mobile-install-android.png' })
    await promotion.getByRole('button', { name: 'Install', exact: true }).tap()
    await expect(page.locator('html')).toHaveAttribute('data-install-activated', 'true')
    await expect(promotion).toBeHidden()

    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    expect(await offerInstall()).toBe(true)
    await expect(promotion).toBeHidden()
    await page.getByRole('button', { name: 'About & credits' }).tap()
    await expect(page.getByRole('link', { name: 'Install Polished Crawl' })).toHaveAttribute('href', '/about/install')
  })
})

test.describe('iPhone web app installation', () => {
  test.use({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  })

  test.beforeEach(async ({ page }) => {
    await page.routeWebSocket(/wss?:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
    await page.addInitScript(() => localStorage.setItem('orbrun.loginServer', JSON.stringify('cdi')))
  })

  test('shows Safari installation instructions and remembers dismissal', async ({ page }) => {
    await page.goto('/')
    const promotion = page.getByRole('region', { name: 'Install as app' })
    await expect(promotion).toContainText('Share, then Add to Home Screen')
    await expect(promotion).toBeInViewport({ ratio: 1 })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: 'test-results/mobile-install-ios.png' })
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(promotion).toBeInViewport({ ratio: 1 })
    await expect(page.locator('button[data-focus="play"] .label')).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: 'test-results/mobile-install-ios-landscape.png' })
    await promotion.getByRole('button', { name: 'Dismiss install prompt' }).press('Enter')
    await expect(page.getByRole('button', { name: 'About & credits' })).toBeFocused()
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    await expect(promotion).toBeHidden()
  })

  test('does not promote installation when launched from the home screen', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Install as app' })).toBeHidden()
  })
})
