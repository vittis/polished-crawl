import { createServer, request } from 'node:http'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { expect, test as base, type Page } from '@playwright/test'

// Cut the origin at the socket. This also blocks worker requests in browsers whose
// automation offline switch bypasses service workers on the first navigation.
const test = base.extend<{ origin: { url: string; disconnect(): void } }>({
  origin: async ({ baseURL }, use) => {
    let connected = true
    const server = createServer((req, res) => {
      if (!connected) { req.socket.destroy(); return }
      if (req.url === '/sw.js?interrupted-update') {
        const html = readFileSync(new URL('../../apps/orbrun/dist/index.html', import.meta.url), 'utf8')
        const previousEntry = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1]
        if (!previousEntry) { res.writeHead(500).end('Missing app entry'); return }
        const script = readFileSync(new URL('../../apps/orbrun/dist/sw.js', import.meta.url), 'utf8')
        const next = script.replace(/^const SHELL = (.+)$/m, (_, json: string) => {
          const shell = JSON.parse(json)
          const nextEntry = '/assets/interrupted-update.js'
          shell.files = shell.files.map((file: string) => file === previousEntry ? nextEntry : file)
          delete shell.sums[previousEntry]
          shell.sums[nextEntry] = 'missing'
          shell.version += '-interrupted'
          return 'const SHELL = ' + JSON.stringify(shell)
        })
        res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(next)
        return
      }
      if (req.url === '/assets/interrupted-update.js') { res.writeHead(404).end(); return }
      const upstream = request(new URL(req.url!, baseURL), { headers: req.headers }, reply => {
        res.writeHead(reply.statusCode!, reply.headers)
        reply.pipe(res)
      })
      upstream.on('error', () => res.destroy())
      req.pipe(upstream)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      await use({ url: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
        disconnect() { connected = false; server.closeAllConnections() } })
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  },
})

// Read the real worker's public WebTiles output to compare the engine state across two independent boots.
interface Player { turn?: number; name?: string; pos?: { x: number; y: number } }
declare global { interface Window { observedPlayer: Player; receivedMap: boolean; terrain: Record<string, number>; offlineEvents: string[] } }

async function finishCreation(page: Page) {
  await expect(page.locator('.popup.type-newgame-choice').first()).toBeVisible({ timeout: 20000 })
  await expect(async () => {
    if (await page.locator('.popup.type-newgame-choice').first().isVisible()) await page.keyboard.press('a')
    expect(await page.evaluate(() => window.receivedMap)).toBe(true)
  }).toPass({ timeout: 20000 })
}

async function saveAndExit(page: Page, url: string) {
  await page.keyboard.press('Shift+S')
  await expect(page.locator('.overlay-stack > .prompt-card').getByText('Save game and exit?', { exact: true })).toBeVisible()
  await page.keyboard.press('y')
  await expect(page.getByRole('navigation', { name: 'Play Offline', exact: true })).toBeVisible({ timeout: 15000 })
  await expect(page).toHaveURL(url + '/offline')
}

// Crawl rebases WebTiles coordinates when a process starts. Compare the surveyed
// terrain relative to the character to locate it across that change of origin.
function positionSnapshot(page: Page) {
  return page.evaluate(() => {
    const { name, turn, pos } = window.observedPlayer
    const area: (number | null)[] = []
    if (pos) {
      for (let y = -3; y <= 3; y++) {
        for (let x = -3; x <= 3; x++) area.push(window.terrain[[pos.x + x, pos.y + y].join(',')] ?? null)
      }
    }
    return { name, turn, area }
  })
}

test('install, save, edit the local rc and resume without a connection', async ({ context, page, origin }, testInfo) => {
  await context.routeWebSocket(/^wss:/, ws => ws.send(JSON.stringify({ msg: 'lobby_complete' })))
  await context.route(/^https:\/\//, route => route.abort())
  await context.addInitScript(() => {
    window.observedPlayer = {}
    window.receivedMap = false
    window.offlineEvents = []
    window.addEventListener('polished-crawl:analytics', event => window.offlineEvents.push((event as CustomEvent<string>).detail))
    window.Worker = class extends Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (!String(url).includes('/offline-worker/')) return
        window.observedPlayer = {}
        window.receivedMap = false
        window.terrain = {}
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'output') return
          for (const line of data.text.trim().split('\n')) {
            if (!line.startsWith('{')) continue
            const msg = JSON.parse(line)
            if (msg.msg === 'map' && msg.cells?.length) {
              window.receivedMap = true
              if (msg.clear) window.terrain = {}
              let x = 0, y = 0
              for (const cell of msg.cells) {
                x = cell.x ?? x + 1
                y = cell.y ?? y
                if (typeof cell.f === 'number') window.terrain[[x, y].join(',')] = cell.f
              }
            }
            if (msg.msg === 'player') Object.assign(window.observedPlayer, msg)
          }
        })
      }
    }
  })
  const engineRequests: string[] = []
  context.on('request', req => { if (req.url().includes('/engine/')) engineRequests.push(req.url()) })
  await page.goto(origin.url)
  await expect(page.getByRole('button', { name: 'Play Offline' })).toBeVisible()
  expect(engineRequests).toEqual([])
  await page.getByRole('button', { name: 'Play Offline' }).click()
  // Fixed generation through the RC editor and Crawl’s normal setting.
  await page.getByRole('button', { name: 'Edit rc', exact: true }).click()
  const rc = page.getByRole('textbox', { name: 'rc file' })
  await expect(rc).toBeEditable()
  await rc.fill('game_seed = 1')
  await page.locator('[data-focus="rc:save"]').click()
  await expect(page.getByText('Saved. It counts from the next game you start or continue.')).toBeVisible()
  await page.locator('[data-focus="back"]').click()
  const channel = ['chromium', 'firefox'].includes(testInfo.project.name) ? 'Trunk' : 'Stable'
  const install = page.locator('[data-focus="install:' + channel.toLowerCase() + '"]')
  await expect(install).toContainText('MiB', { timeout: 20000 })
  await install.click()
  await expect(page.getByText(new RegExp(channel + ' · Ready offline'))).toBeVisible({ timeout: 60000 })
  await page.screenshot({ path: testInfo.outputPath('offline-ready.png') })
  const game = page.locator('[data-focus^="play:offline-"]').first()
  const editInstalledRc = page.getByRole('button', { name: /^Edit rc for / })
  await editInstalledRc.click()
  await expect(rc).toHaveValue('game_seed = 1')
  await page.screenshot({ path: testInfo.outputPath('offline-rc.png') })
  await page.locator('[data-focus="back"]').click()
  await expect(editInstalledRc).toBeFocused()
  await game.click()
  await finishCreation(page)
  await expect.poll(() => page.evaluate(() => window.offlineEvents)).toEqual([
    'offline_clicked', 'offline_install_clicked', 'offline_install_succeeded', 'offline_play_clicked', 'offline_game_started',
  ])
  if (testInfo.project.name === 'chromium') {
    const competing = await context.newPage()
    await competing.setViewportSize({ width: 390, height: 844 })
    await competing.goto(page.url())
    const error = competing.getByText('This character is already open in another tab.')
    await expect(error).toBeVisible()
    expect(await error.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await competing.screenshot({ path: testInfo.outputPath('offline-start-error.png') })
    await competing.close()
  }
  const initial = await page.evaluate(() => window.observedPlayer.pos!)
  // Try adjacent cells until Crawl confirms movement through a walkable one.
  let moved = false
  for (const key of ['h', 'j', 'k', 'l', 'y', 'u', 'b', 'n']) {
    await page.keyboard.press(key)
    moved = await page.waitForFunction(start => {
      const pos = window.observedPlayer.pos
      return !!pos && (pos.x !== start.x || pos.y !== start.y)
    }, initial, { timeout: 750 }).then(() => true, () => false)
    if (moved) break
  }
  expect(moved).toBe(true)
  const saved = await positionSnapshot(page)
  expect(saved.turn).toBeGreaterThan(0)
  expect(new Set(saved.area).size).toBeGreaterThan(1)
  await saveAndExit(page, origin.url)
  await editInstalledRc.click()
  await expect(rc).toHaveValue('game_seed = 1')
  if (testInfo.project.name === 'chromium') {
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js?interrupted-update')
    })
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('?interrupted-update')
  }
  origin.disconnect()
  const updatedRc = 'game_seed = 1\nshow_more = false'
  await rc.fill(updatedRc)
  await page.locator('[data-focus="rc:save"]').click()
  await expect(page.getByText('Saved. It counts from the next game you start or continue.')).toBeVisible()
  await page.locator('[data-focus="back"]').click()
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: testInfo.outputPath('offline-after-update.png') })
    await game.click()
    await expect(page.locator('canvas.view')).toBeVisible()
    await expect.poll(() => positionSnapshot(page)).toEqual(saved)
    await saveAndExit(page, origin.url)
    await expect(page.getByText(new RegExp(channel + ' · Ready offline'))).toBeVisible()
    await expect(page.getByText('Installation needs repair')).toHaveCount(0)
  }
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto(origin.url)
  const offline = reopened.getByRole('button', { name: 'Play Offline' })
  await expect(offline).toContainText(/Continue DCSS (?:trunk|\d+\.\d+) · XL1 [A-Za-z]{4}/)
  await offline.click()
  await expect(reopened.getByText(new RegExp(channel + ' · Ready offline'))).toBeVisible()
  await reopened.locator('[data-focus^="play:offline-"]').first().click()
  await expect.poll(() => positionSnapshot(reopened)).toEqual(saved)
  await reopened.keyboard.press('.')
  await expect.poll(() => reopened.evaluate(() => window.observedPlayer.turn!)).toBeGreaterThan(saved.turn!)
  const dungeon = await reopened.locator('canvas.view').elementHandle()
  await reopened.keyboard.press('Shift+X')
  await expect.poll(() => dungeon!.evaluate(canvas => canvas.isConnected)).toBe(false)
  await reopened.keyboard.press('Escape')
  await saveAndExit(reopened, origin.url)
  await reopened.getByRole('button', { name: /^Edit rc for / }).click()
  await expect(reopened.getByRole('textbox', { name: 'rc file' })).toHaveValue(updatedRc)
  const wasm = engineRequests.find(url => url.endsWith('/crawl.wasm'))
  expect(wasm).toBeDefined()
  if (testInfo.project.name === 'firefox-asyncify') expect(wasm).toContain('/asyncify/')
  await testInfo.attach('runtime', { body: wasm!.includes('/asyncify/') ? 'Asyncify' : 'JSPI' })
})
