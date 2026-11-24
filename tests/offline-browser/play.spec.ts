import { createServer, request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test as base, type Page } from '@playwright/test'

// Cut the origin at the socket. This also blocks worker requests in browsers whose
// automation offline switch bypasses service workers on the first navigation.
const test = base.extend<{ origin: { url: string; disconnect(): void } }>({
  origin: async ({ baseURL }, use) => {
    let connected = true
    const server = createServer((req, res) => {
      if (!connected) { req.socket.destroy(); return }
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
declare global { interface Window { observedPlayer: Player; receivedMap: boolean; terrain: Record<string, number> } }

async function finishCreation(page: Page) {
  await expect(page.locator('.popup.type-newgame-choice').first()).toBeVisible({ timeout: 20000 })
  await expect(async () => {
    if (await page.locator('.popup.type-newgame-choice').first().isVisible()) await page.keyboard.press('a')
    expect(await page.evaluate(() => window.receivedMap)).toBe(true)
  }).toPass({ timeout: 20000 })
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

test('install, save, close every page, resume and start another profile offline', async ({ context, page, origin }, testInfo) => {
  await context.routeWebSocket(/^wss:/, ws => ws.send(JSON.stringify({ msg: 'lobby_complete' })))
  await context.route(/^https:\/\//, route => route.abort())
  await context.addInitScript(() => {
    window.observedPlayer = {}
    window.receivedMap = false
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
  // Fixed generation through DCSS's normal per-profile RC setting.
  await page.evaluate(() => {
    for (const profile of ['player', 'anotherplayer']) localStorage.setItem('orbrun.offline.rc:' + profile, 'game_seed = 1')
  })
  const channel = testInfo.project.name === 'firefox' ? 'Trunk' : 'Stable'
  const install = page.locator('[data-focus="install:' + channel.toLowerCase() + '"]')
  await expect(install).toContainText('MiB', { timeout: 20000 })
  await install.click()
  await expect(page.getByText(new RegExp(channel + ' · Ready offline'))).toBeVisible({ timeout: 60000 })
  await page.screenshot({ path: testInfo.outputPath('offline-ready.png') })
  const game = page.locator('[data-focus^="play:offline-"]').first()
  await game.click()
  await finishCreation(page)
  if (testInfo.project.name === 'chromium') {
    const competing = await context.newPage()
    await competing.goto(page.url())
    await expect(competing.getByText('This character is already open in another tab.')).toBeVisible()
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
  await page.keyboard.press('Shift+S')
  await page.keyboard.press('y')
  await expect(page.locator('.polished-home')).toBeVisible({ timeout: 15000 })
  await page.close()
  origin.disconnect()
  const reopened = await context.newPage()
  await reopened.goto(origin.url)
  await reopened.getByRole('button', { name: 'Play Offline' }).click()
  await expect(reopened.getByText(new RegExp(channel + ' · Ready offline'))).toBeVisible()
  await reopened.locator('[data-focus^="play:offline-"]').first().click()
  await expect.poll(() => positionSnapshot(reopened)).toEqual(saved)
  await reopened.keyboard.press('.')
  await expect.poll(() => reopened.evaluate(() => window.observedPlayer.turn!)).toBeGreaterThan(saved.turn!)
  const dungeon = await reopened.locator('canvas.view').elementHandle()
  await reopened.keyboard.press('Shift+X')
  await expect.poll(() => dungeon!.evaluate(canvas => canvas.isConnected)).toBe(false)
  await reopened.keyboard.press('Escape')
  await reopened.keyboard.press('Shift+S')
  await reopened.keyboard.press('y')
  await expect(reopened.locator('.polished-home')).toBeVisible()
  await reopened.locator('[data-focus="account"]').click()
  await reopened.getByRole('button', { name: /Add an offline account/ }).click()
  await reopened.locator('input').filter({ visible: true }).first().fill('AnotherPlayer')
  await reopened.locator('input').filter({ visible: true }).first().press('Enter')
  await reopened.locator('[data-focus^="play:offline-"]').first().click()
  await finishCreation(reopened)
  await expect.poll(() => reopened.evaluate(() => window.observedPlayer.name)).toBe('AnotherPlayer')
  await reopened.keyboard.press('.')
  await expect.poll(() => reopened.evaluate(() => window.observedPlayer.turn)).toBeGreaterThan(0)
  const wasm = engineRequests.find(url => url.endsWith('/crawl.wasm'))
  expect(wasm).toBeDefined()
  if (testInfo.project.name === 'firefox-asyncify') expect(wasm).toContain('/asyncify/')
  await testInfo.attach('runtime', { body: wasm!.includes('/asyncify/') ? 'Asyncify' : 'JSPI' })
})
