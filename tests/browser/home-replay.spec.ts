import { expect, type WebSocketRoute } from '@playwright/test'
import manifest from '../../apps/orbrun/data/menu-replays.json' with { type: 'json' }
import { menuReplayCheck } from './menu-replay'
import { smoke, test } from './fixtures'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

for (const narrow of [false, true]) {
  const viewport = narrow ? 'phone' : 'desktop'
  test(`main menu stays in place as data and artwork load on ${viewport}`, smoke, async ({ page }) => {
    await page.setViewportSize(narrow ? { width: 320, height: 660 } : { width: 1280, height: 720 })
    const fonts = deferred<void>()
    const replay = deferred<void>()
    const restore = deferred<WebSocketRoute>()
    const save = deferred<void>()
    await page.route(/\/fonts\/(?:barlow-condensed|ibm-plex).*\.woff2$/, async route => {
      await fonts.promise
      await route.continue()
    })
    await page.route('**/menu/clips/**', async route => {
      await replay.promise
      await route.continue()
    })
    await page.route('**/morgue-proxy/**/menu-test.where', async route => {
      await save.promise
      await route.fulfill({ body: 'v=0.35-a0:name=menu-test:race=Minotaur:cls=Fighter:char=MiFi:xl=3:place=D::2:br=D:lvl=2:status=saved\n' })
    })
    await page.routeWebSocket(/^wss:\/\//, socket => {
      socket.onMessage(raw => {
        if (JSON.parse(String(raw)).msg === 'token_login') restore.resolve(socket)
      })
    })
    await page.addInitScript(() => {
      const account = { serverId: 'cdi', username: 'menu-test' }
      localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
      localStorage.setItem('orbrun.account', JSON.stringify(account))
      localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/menu-test': 'fixture-session' }))
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Loading dungeon replay…')).toBeVisible()
    await expect(page.getByText('Signing you back in as menu-test…')).toBeVisible()
    const play = page.locator('button[data-focus="play"]')
    const watch = page.locator('button[data-focus="watch"]')
    const settings = page.locator('button[data-focus="settings"]')
    const about = page.getByRole('button', { name: 'About & credits' })
    await expect(play).toHaveAccessibleName('Play')
    await expect(watch).toContainText('Loading…')
    await expect(settings).toBeInViewport({ ratio: 1 })
    await expect(about).toBeInViewport({ ratio: 1 })
    const layout = () => Promise.all([
      page.locator('.crawl-title'), play, watch, settings, about,
    ].map(locator => locator.boundingBox()))
    const initial = await layout()

    fonts.resolve()
    await page.evaluate(() => document.fonts.ready)
    expect(await layout()).toEqual(initial)
    await page.screenshot({ path: `test-results/main-menu-${viewport}-loading.png` })

    const socket = await restore.promise
    socket.send(JSON.stringify({ msgs: [
      { msg: 'login_success', username: 'menu-test' },
      { msg: 'set_game_links', content: '<a href="#play-dcss-web-trunk">DCSS trunk</a>' },
      { msg: 'lobby_complete' },
    ] }))
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible()
    await expect(watch).toContainText('0 playing')
    expect(await layout()).toEqual(initial)

    save.resolve()
    await expect(play).toContainText('Continue DCSS trunk · XL3 MiFi')
    expect(await layout()).toEqual(initial)

    replay.resolve()
    await expect(page.getByRole('combobox', { name: 'Choose scene' })).toBeVisible()
    await expect(page.getByText('Loading dungeon replay…')).toBeHidden()
    expect(await layout()).toEqual(initial)
    await page.screenshot({ path: `test-results/main-menu-${viewport}-ready.png` })
  })
}

test('menu entrance remains usable when recordings are unavailable despite an old saved animation setting', smoke, async ({ page }) => {
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

test('menu recording chooser loads only the selected version and resets on reload', smoke, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.routeWebSocket(/^wss:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
  await page.addInitScript(() => {
    Math.random = () => .999
    localStorage.setItem('orbrun.settings', JSON.stringify({ depthTilt: 65 }))
  })
  const assets: string[] = []
  page.on('request', request => assets.push(new URL(request.url()).pathname))
  const clips = () => assets.filter(path => path.startsWith('/menu/clips/'))
  const versions = () => new Set(assets.flatMap(path => {
    const version = /^\/menu\/gamedata\/([^/]+)\//.exec(path)?.[1]
    return version ? [version] : []
  }))

  await page.goto('/')
  const chooser = page.getByRole('combobox', { name: 'Choose scene', exact: true })
  const backdrop = page.locator('.menu-backdrop')
  await expect(backdrop.locator('canvas')).toBeVisible()
  await expect(chooser).toHaveValue('')
  expect(clips()).toHaveLength(1)
  expect(versions().size).toBe(1)

  const initialClip = manifest.clips.find(clip => '/menu/' + clip.file === clips()[0])!
  const sameVersion = manifest.clips.find(clip => clip.version === initialClip.version && clip !== initialClip)!
  const otherVersion = manifest.clips.find(clip => clip.version !== initialClip.version)!
  for (const clip of [sameVersion, otherVersion]) {
    const expectedPath = '/menu/' + clip.file
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === expectedPath)
    await chooser.selectOption(clip.file)
    expect((await loaded).ok()).toBe(true)
    await expect(backdrop).toHaveAttribute('data-loading', 'false')
    await expect(backdrop.locator('canvas')).toBeVisible()
    await expect(chooser).toHaveAttribute('aria-description', 'Current scene: ' + clip.title)
  }
  expect(clips()).toEqual([initialClip, sameVersion, otherVersion].map(clip => '/menu/' + clip.file))
  expect(versions()).toEqual(new Set([initialClip.version, otherVersion.version]))
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.settings')!))).toEqual({ depthTilt: 65 })

  await page.locator('[data-focus="about"]').click()
  await expect(chooser).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(chooser).toHaveValue(otherVersion.file)
  await page.getByRole('button', { name: 'Next scene' }).click()
  await expect(chooser).not.toHaveValue(otherVersion.file)
  await page.getByRole('button', { name: 'Previous scene' }).click()
  await expect(chooser).toHaveValue(otherVersion.file)
  await chooser.selectOption({ label: 'Shuffle all' })
  await expect(chooser).toHaveValue('')
  await chooser.selectOption(otherVersion.file)
  await page.reload()
  await expect(chooser).toBeVisible()
  await expect(chooser).toHaveValue('')
})

for (const narrow of [false, true]) {
  test(`menu replay tilt and zoom preview and persist with native controls at ${narrow ? 'narrow' : 'desktop'} width`, async ({ page }) => {
    await page.setViewportSize(narrow ? { width: 390, height: 844 } : { width: 1280, height: 720 })
    await page.routeWebSocket(/^wss:\/\//, socket => socket.send(JSON.stringify({ msg: 'lobby_complete' })))
    await page.addInitScript(() => {
      Math.random = () => 0.999 // Stable first clip for the visual evidence.
      if (!localStorage.getItem('orbrun.settings')) localStorage.setItem('orbrun.settings', JSON.stringify({ depthPerspective: true, depthTilt: 50, depthZoom: 1.2 }))
    })
    await page.goto('/')
    const slider = page.getByRole('slider', { name: 'Dungeon tilt', exact: true })
    const canvas = page.locator('.menu-backdrop canvas')
    await expect(canvas).toBeVisible()
    await expect(slider).toBeVisible()
    await expect(slider).toHaveValue('50')
    const replayControls = page.locator('.menu-replay-controls')
    const controls = await replayControls.boundingBox()
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
    await page.locator('[data-focus="about"]').click()
    await expect(slider).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(slider).toBeVisible()
    await expect(slider).toHaveValue('71')
    if (!narrow) {
      await page.locator('[data-focus="settings"]').click()
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
      expect(await replayControls.boundingBox()).toEqual(controls)
      await slider.click()
      await expect(slider).toBeFocused()
      await slider.fill('71')
      await page.locator('.settings-list [data-focus="back"]').click()
    }
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
    }
  })
}
