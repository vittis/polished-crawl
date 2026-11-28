import { expect, type WebSocketRoute } from '@playwright/test'
import { cm, Keys, MouseMode, UiState, type ClientMessage, type ServerMessage } from '../../packages/webtiles/src/protocol'
import { androidUserAgent, openHudSettings, result, smoke, test } from './fixtures'
import type {} from '../../apps/orbrun/testbed/map-lifecycle'
import type {} from '../../apps/orbrun/testbed/live-animation'
import skills from '../../apps/orbrun/test/fixtures/skills-crt.json' with { type: 'json' }

for (const touch of [false, true]) {
  test.describe(touch ? 'portrait gameplay popups' : 'desktop gameplay popups', () => {
    test.use(touch ? { viewport: { width: 390, height: 735 }, isMobile: true, hasTouch: true } : {})
    test.beforeEach(async ({ page }) => {
      await page.goto('/testbed/map-lifecycle.html' + (touch ? '?preview-touch' : ''))
      await page.waitForFunction(() => !!window.__orbrunMapLifecycle)
    })

    test('skills reflect confirmed training settings even when Crawl sends dark gray', smoke, async ({ page }) => {
      const receive = (message: ServerMessage) => page.evaluate(message => window.__orbrunMapLifecycle.receive(message), message)
      const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
      await receive(skills[0])
      await receive(skills[1])
      const row = page.locator('.crt-hot[title="Conjurations"]')
      const name = page.locator('.crt-line span').filter({ hasText: /^j [-+*] Conjurations\s*$/ }).last()
      await expect(name).toHaveCSS('color', 'rgb(85, 87, 83)')

      for (const [i, sign, color] of [
        [1, '+', 'rgb(238, 238, 236)'],
        [2, '*', 'rgb(238, 238, 236)'],
        [3, '-', 'rgb(85, 87, 83)'],
      ] as const) {
        if (touch) await row.tap()
        else await row.click()
        expect(await sent()).toEqual(Array.from({ length: i }, () => cm.input('j')))
        // The sign can change while the server still reports zero XP allocation (fg8).
        const line = skills[1].lines!['3'].replace('j - Conjurations', `j ${sign} Conjurations`)
        await receive({ msg: 'txt', id: 'menu_txt', lines: { 3: line } })
        await expect(name).toHaveText(`j ${sign} Conjurations`)
        await expect(name).toHaveCSS('color', color)
        await expect(page.locator('.crt-line .fg3').filter({ hasText: '4.2' })).toHaveCSS('color', 'rgb(6, 152, 154)')
      }
    })

    test('examine item verbs offer large targets and send their original keys', smoke, async ({ page }) => {
      await page.evaluate(() => window.__orbrunMapLifecycle.receive({
        msg: 'ui-push', type: 'describe-item', title: 'a ring of protection', body: 'This ring protects its wearer.',
        actions: '(P)ut on, (d)rop, (=)adjust, or (i)nscribe.',
      }))
      const popup = page.locator('.type-describe-item')
      const buttons = popup.getByRole('button')
      await expect(buttons).toHaveText(['(P)ut on', '(d)rop', '(=)adjust', '(i)nscribe'])
      for (const button of await buttons.all()) {
        const box = (await button.boundingBox())!
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      }
      const drop = popup.getByRole('button', { name: '(d)rop' })
      if (touch) await drop.tap({ position: { x: 4, y: 4 } })
      else await drop.click({ position: { x: 4, y: 4 } })
      const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
      expect(await sent()).toEqual([cm.input('d')])
      if (!touch) {
        await popup.getByRole('button', { name: '(=)adjust' }).press('Enter')
        expect(await sent()).toEqual([cm.input('d'), cm.input('=')])
      }
    })
  })
}

test('the item search field stays transparent over the log when it opens', smoke, async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html')
  await expect(page.locator('.hud .stats')).toContainText('Map lifecycle')
  await page.keyboard.press('Control+f')
  const opacity = await page.evaluate(() => new Promise<string>(resolve => {
    const stack = document.querySelector('.overlay-stack')!
    const placed = new MutationObserver(() => {
      const prompt = stack.querySelector('.text-input.in-log.placed')
      if (!prompt) return
      placed.disconnect()
      for (const animation of prompt.getAnimations()) {
        animation.pause()
        animation.currentTime = 65
      }
      resolve(getComputedStyle(prompt).opacity)
    })
    placed.observe(stack, { childList: true, attributes: true, subtree: true })
    const f = window.__orbrunMapLifecycle
    f.receive({ msg: 'msgs', messages: [{ text: 'Search for what? ' }] })
    f.receive({ msg: 'init_input', type: 'messages', tag: 'stash_search', maxlen: 99 })
  }))
  expect(opacity).toBe('0')
})

for (const { tag, command, value, width, enter } of [
  { tag: 'stash_search', command: ['Control+f'], value: 'potions', width: 1280, enter: 'Enter' },
  { tag: 'travel_depth', command: ['G', 'D'], value: '3', width: 540, enter: 'NumpadEnter' },
]) {
  test(`${tag} submits the typed line after a server UI update`, smoke, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await page.goto('/testbed/map-lifecycle.html')
    await expect(page.locator('.hud .stats')).toContainText('Map lifecycle')
    for (const key of command) await page.keyboard.press(key)
    await page.evaluate(tag => {
      const f = window.__orbrunMapLifecycle
      f.receive({ msg: 'msgs', messages: [{ text: tag === 'stash_search' ? 'Search for what? ' : 'What level of Dungeon? ' }] })
      f.receive({ msg: 'init_input', type: 'messages', tag, maxlen: 99 })
    }, tag)
    const field = page.locator(`.popup.tag-${tag} input`)
    await expect(field).toBeFocused()
    await page.keyboard.type(value)
    await expect(field).toHaveValue(value)
    await page.keyboard.press('Home')
    await page.evaluate(async () => {
      window.__orbrunMapLifecycle.receive({ msg: 'cursor', id: 0, loc: null })
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    await page.keyboard.press(enter)
    const submitted = await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent.slice(-3))
    expect(submitted).toEqual([{ msg: 'key', keycode: 21 }, { msg: 'key', keycode: 11 }, { msg: 'text_input', text: value + '\r' }])
    expect(await field.evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(0)
  })
}

test('held online commands keep their original repeat delivery during a late reply', smoke, async ({ page }) => {
  const account = { serverId: 'cdi', username: 'pacing-test' }
  await page.addInitScript(account => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
    localStorage.setItem('orbrun.account', JSON.stringify(account))
    localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/pacing-test': 'fixture-session' }))
  }, account)
  await page.route('**/gamedata-proxy/crawl.dcss.io/**', async route => {
    const url = route.request().url().replace('/gamedata-proxy/crawl.dcss.io/', '/menu/')
    await route.fulfill({ response: await route.fetch({ url }) })
  })
  const sent: ClientMessage[] = []
  let gameSocket: WebSocketRoute | undefined
  const deliver = (socket: WebSocketRoute, ...msgs: ServerMessage[]) => socket.send(JSON.stringify({ msgs }))
  await page.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
    socket.onMessage(raw => {
      const msg: ClientMessage = JSON.parse(String(raw))
      if (msg.msg === 'token_login') deliver(socket, { msg: 'login_success', username: account.username })
      else if (msg.msg === 'play') {
        gameSocket = socket
        deliver(socket,
          { msg: 'game_started' },
          { msg: 'game_client', version: '0703b2fa62e821390161d95cf52f9da1183761d4' },
          { msg: 'player', name: 'Pacing test', hp: 20, hp_max: 20, pos: { x: 0, y: 0 } },
          { msg: 'map', player_on_level: true, vgrdc: { x: 0, y: 0 },
            cells: Array.from({ length: 6 }, (_, x) => ({ x, y: 0, g: '.', t: { bg: 2 } })) },
          { msg: 'input_mode', mode: MouseMode.COMMAND },
        )
      } else if (msg.msg === 'key' || msg.msg === 'input') sent.push(msg)
    })
  })
  await page.clock.install()
  await page.goto('/play/cdi/pacing-test/dcss-0.34')
  await expect(page.locator('.screen.game .stats')).toContainText('Pacing test')
  await expect(page.locator('.screen.game .loading')).toBeHidden()

  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('ArrowRight')
    await page.clock.runFor(30)
  }
  await page.keyboard.up('ArrowRight')
  for (let i = 0; i < 3; i++) {
    await page.keyboard.down('Tab')
    await page.clock.runFor(30)
  }
  await page.keyboard.up('Tab')
  const step = cm.input('l')
  const tab = cm.key(Keys.TAB)
  const expected = [step, step, step, tab, tab, tab]
  await expect.poll(() => sent.slice()).toEqual(expected)
  deliver(gameSocket!, ...[1, 2, 3].flatMap(turn => [
    { msg: 'input_mode', mode: MouseMode.NORMAL },
    { msg: 'player', turn, pos: { x: turn, y: 0 } },
    { msg: 'input_mode', mode: MouseMode.COMMAND },
  ]))
  await expect(page.locator('.hud .stats')).toContainText('Turn: 3')
  await page.clock.runFor(100)
  expect(sent).toEqual(expected)
})

test('tiles beneath the message log respond to the mouse and a pending pause still takes the click', smoke, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ messageLines: 16, depthZoom: 1.4 })))
  await page.goto('/testbed/map-lifecycle.html')
  await page.addStyleTag({ content: '#controls { display: none }' })
  await page.evaluate(() => document.fonts.ready)
  const log = page.locator('.hud .messages')
  const view = page.locator('canvas.view')
  const receive = (msg: ServerMessage) => page.evaluate(message => window.__orbrunMapLifecycle.receive(message), msg)
  const snapshot = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot())
  await receive({ msg: 'msgs', messages: [{ text: 'You climb downwards.' }] })
  await expect(log).toContainText('You climb downwards.')
  const tile = { x: 13, y: 6 }
  const sent: unknown[] = []
  for (const viewport of [{ width: 1280, height: 720 }, { width: 540, height: 600 }]) {
    await page.setViewportSize(viewport)
    const position = await view.evaluate((canvas, { x, y }) => {
      const { left, top } = canvas.getBoundingClientRect()
      const point = window.__orbrunMapLifecycle.projectCell(x, y)!
      return { x: left + point.x, y: top + point.y }
    }, tile)
    const bounds = (await log.boundingBox())!
    expect(position.x).toBeGreaterThan(bounds.x)
    expect(position.x).toBeLessThan(bounds.x + bounds.width)
    expect(position.y).toBeGreaterThan(bounds.y)
    expect(position.y).toBeLessThan(bounds.y + bounds.height)
    await page.mouse.move(position.x, position.y)
    await expect.poll(async () => (await snapshot()).cursor).toMatchObject({ ...tile, mode: 'examine' })
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

test.describe('touch movement settings', () => {
  const viewport = { width: 390, height: 844 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('pinches the dungeon by default, saves the zoom, and honors the View toggle', smoke, async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('orbrun.settings')) {
        localStorage.setItem('orbrun.settings', JSON.stringify({ swipeToMove: true }))
      }
    })
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    const canvas = page.locator('canvas.view')
    await expect(page.locator('.hud .stats')).toContainText('Mara')
    const device = await page.context().newCDPSession(page)
    const snapshot = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot())
    const scale = async () => (await snapshot()).tileSize!
    const base = await scale()
    const savedZoom = () => page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.settings')!).depthZoom)
    const pinch = async (endSpread: number) => {
      const { x, y, width, height } = (await canvas.boundingBox())!
      const center = { x: x + width / 2, y: y + height / 2 }
      const contacts = (spread: number) => [
        { x: center.x - spread, y: center.y, id: 1 },
        { x: center.x + spread, y: center.y, id: 2 },
      ]
      await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts(50) })
      await device.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts(endSpread) })
    }
    const end = (type: 'touchEnd' | 'touchCancel') => device.send('Input.dispatchTouchEvent', { type, touchPoints: [] })

    await pinch(80)
    await expect.poll(scale).toBeCloseTo(base * 1.6, 6)
    expect(await savedZoom()).toBeUndefined()
    await end('touchEnd')
    await expect.poll(savedZoom).toBe(1.6)
    expect((await snapshot()).sent).toEqual([])

    await pinch(100)
    await expect.poll(scale).toBeCloseTo(base * 2, 6)
    await end('touchCancel')
    await expect.poll(scale).toBeCloseTo(base * 1.6, 6)
    expect(await savedZoom()).toBe(1.6)

    await pinch(10)
    await end('touchEnd')
    await expect.poll(savedZoom).toBe(0.5)
    expect((await snapshot()).sent).toEqual([])

    await page.reload()
    await expect(page.locator('.hud .stats')).toContainText('Mara')
    await expect.poll(scale).toBeCloseTo(base * 0.5, 6)
    await openHudSettings(page, 'View')
    await expect(page.getByRole('slider', { name: 'Dungeon zoom', exact: true })).toHaveAttribute('aria-valuetext', '50%')
    const toggle = page.getByRole('button', { name: 'Pinch to zoom: On. Advance value', exact: true })
    await toggle.click()
    await expect(page.getByRole('button', { name: 'Pinch to zoom: Off. Advance value', exact: true })).toBeVisible()

    await page.reload()
    await expect(page.locator('.hud .stats')).toContainText('Mara')
    await pinch(100)
    await end('touchEnd')
    expect(await scale()).toBeCloseTo(base * 0.5, 6)
    expect(await savedZoom()).toBe(0.5)
    expect((await snapshot()).sent).toEqual([])

    await page.evaluate(state => window.__orbrunMapLifecycle.receive({ msg: 'ui_state', state }), UiState.VIEW_MAP)
    await expect.poll(async () => (await snapshot()).presentation).toBe('flat-map')
    await pinch(60)
    await end('touchEnd')
    expect((await snapshot()).sent).toEqual([{ msg: 'input', text: '}' }])
    expect(await savedZoom()).toBe(0.5)
  })

  test('swipes in eight directions and independently disables dungeon taps', smoke, async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => window.__orbrunMapLifecycle.ready())
    const view = page.locator('canvas.view')
    const swipeSetting = page.locator('[data-focus="setting:Swipe to move"]')
    const tapSetting = page.locator('[data-focus="setting:Tap to move"]')
    const closeSettings = async () => {
      await page.keyboard.press('Escape')
      await expect(page.locator('.settings-groups')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('tab', { name: 'System', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('.overlay-stack > [data-client]')).toHaveCount(0)
    }
    const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
    const receive = (msg: ServerMessage) => page.evaluate(message => window.__orbrunMapLifecycle.receive(message), msg)
    const tile = { x: 10, y: 5 }
    const tilePoint = () => view.evaluate((canvas, tile) => {
      const { left, top } = canvas.getBoundingClientRect()
      const point = window.__orbrunMapLifecycle.projectCell(tile.x, tile.y)!
      return { x: left + point.x, y: top + point.y }
    }, tile)
    const device = await page.context().newCDPSession(page)
    const finger = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', ...touchPoints: { x: number; y: number; id?: number }[]) =>
      device.send('Input.dispatchTouchEvent', { type, touchPoints })
    const swipe = async ({ x, y }: { x: number; y: number }, dx: number, dy: number) => {
      await finger('touchStart', { x, y })
      await finger('touchMove', { x: x + dx / 2, y: y + dy / 2 })
      await finger('touchMove', { x: x + dx, y: y + dy })
      await finger('touchEnd')
    }
    const expectTarget = async (point: { x: number; y: number }, selector: string) => {
      expect(await page.evaluate(({ x, y, selector }) => !!document.elementFromPoint(x, y)?.closest(selector), { ...point, selector })).toBe(true)
    }
    await expect(page.locator('.hud .stats')).toContainText('Mara')
    let point = await tilePoint()
    await expectTarget(point, 'canvas.view')
    await swipe(point, 40, 0)
    expect(await sent()).toEqual([])
    await page.touchscreen.tap(point.x, point.y)
    const click = expect.objectContaining({ msg: 'click_cell', button: 1 })
    const expected: unknown[] = [click]
    expect(await sent()).toEqual(expected)

    await openHudSettings(page, 'Controls')
    await expect(swipeSetting.locator('.val')).toHaveText('Off')
    await expect(tapSetting.locator('.val')).toHaveText('On')
    await swipeSetting.locator('.val').tap()
    await expect(swipeSetting.locator('.val')).toHaveText('On')
    await page.screenshot({ path: 'test-results/movement-controls-phone.png', animations: 'disabled' })
    await closeSettings()
    point = await tilePoint()
    for (const [dx, dy, text] of [[0, -40, 'k'], [40, -40, 'u'], [40, 0, 'l'], [40, 40, 'n'], [0, 40, 'j'], [-40, 40, 'b'], [-40, 0, 'h'], [-40, -40, 'y']] as const) {
      await swipe(point, dx, dy)
      expected.push({ msg: 'input', text })
    }
    expect(await sent()).toEqual(expected)

    const stats = (await page.locator('.hud .stats').boundingBox())!
    const hudPoint = { x: stats.x + 16, y: stats.y + 12 }
    await expectTarget(hudPoint, '.hud .stats')
    await swipe(hudPoint, 48, 0)
    expected.push({ msg: 'input', text: 'l' })
    expect(await sent()).toEqual(expected)

    await finger('touchStart', { ...point, id: 1 })
    await finger('touchStart', { ...point, id: 1 }, { x: point.x + 25, y: point.y + 25, id: 2 })
    await finger('touchMove', { x: point.x - 40, y: point.y, id: 1 }, { x: point.x + 45, y: point.y + 25, id: 2 })
    await finger('touchEnd')
    await finger('touchStart', point)
    await finger('touchMove', { x: point.x + 40, y: point.y })
    await finger('touchCancel')
    expect(await sent()).toEqual(expected)

    await openHudSettings(page, 'Controls')
    await tapSetting.locator('.val').tap()
    await expect(tapSetting.locator('.val')).toHaveText('Off')
    await closeSettings()
    point = await tilePoint()
    await page.touchscreen.tap(point.x, point.y)
    expect(await sent()).toEqual(expected)
    await swipe(point, -40, 35)
    expected.push({ msg: 'input', text: 'b' })
    const touchBar = page.locator('.touchbar.split')
    await expect(touchBar).toBeVisible()
    point = await tilePoint()
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(touchBar).toBeVisible()
    await page.mouse.up()
    expected.push({ msg: 'click_cell', ...tile, button: 1 })
    expect(await sent()).toEqual(expected)
    await expect(touchBar).toBeHidden()

    point = await tilePoint()
    await finger('touchStart', point)
    await finger('touchMove', { x: point.x + 40, y: point.y })
    await receive({ msg: 'input_mode', mode: MouseMode.TARGET })
    await finger('touchEnd')
    expect(await sent()).toEqual(expected)
    point = await tilePoint()
    await page.touchscreen.tap(point.x, point.y)
    expected.push(click)
    expect(await sent()).toEqual(expected)

    await page.reload()
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await openHudSettings(page, 'Controls')
    await expect(swipeSetting.locator('.val')).toHaveText('On')
    await expect(tapSetting.locator('.val')).toHaveText('Off')
  })
})

for (const touch of [false, true]) {
  test.describe(touch ? 'nearby monster touch' : 'nearby monster mouse', () => {
    const viewport = touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }
    test.use({ viewport, screen: viewport, hasTouch: touch })

    test('each portrait in a group opens that monster’s inspection', touch ? smoke : {}, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ showNearbyMonsters: true })))
      await page.goto('/testbed/map-lifecycle.html?nearby-monsters')
      await page.addStyleTag({ content: '#controls { display: none }' })
      const group = page.locator('.monsters .group').filter({ hasText: '2 goblins' })
      const portraits = group.getByRole('button', { name: /^Inspect goblin/ })
      const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
      const body = page.locator('.popup .body')
      const expected: unknown[] = []
      await expect(portraits).toHaveCount(2)

      for (const [i, x] of [11, 12].entries()) {
        const portrait = portraits.nth(i)
        if (touch) await portrait.tap()
        else await portrait.click()
        expected.push({ msg: 'click_cell', x, y: 3, button: 3 })
        await expect.poll(sent).toEqual(expected)
        const description = i === 0 ? 'This goblin is sleeping.' : 'This goblin is poisoned.'
        await page.evaluate(body => window.__orbrunMapLifecycle.receive({
          msg: 'ui-push', type: 'describe-monster', title: 'a goblin', body,
        }), description)
        await expect(body).toHaveText(description)
        await expect(portraits).toHaveCount(0)
        await page.evaluate(() => window.__orbrunMapLifecycle.receive({ msg: 'ui-pop' }))
        await expect(body).toBeHidden()
      }

      // A same-species replacement can arrive while the old portrait is still drawn.
      await portraits.first().evaluate(button => {
        const game = window.__orbrunMapLifecycle
        game.receive({ msg: 'map', cells: [{ x: 11, y: 3, mon: { id: 3, name: 'goblin', att: 0 } }] })
        ;(button as HTMLButtonElement).click()
      })
      expect(await sent()).toEqual(expected)
    })
  })
}

test('nearby hover opens its cursor tooltip immediately and loads each monster once', smoke, async ({ page }) => {
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
  const receive = (msg: ServerMessage) => page.evaluate(message => window.__orbrunMapLifecycle.receive(message), msg)
  const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent as { msg: string; keycode?: number }[])
  const inspections = async () => (await sent()).filter(m => m.msg === 'click_cell')
  const closes = async () => (await sent()).filter(m => m.msg === 'key' && m.keycode === 27)
  const tooltip = page.locator('.monster-tooltip')

  await page.mouse.move(firstAt.x, firstAt.y)
  expect(await tooltip.isVisible()).toBe(true)
  await expect(tooltip).toHaveText('Loading description…')
  await expect(tooltip).toHaveAttribute('data-loading', '')
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
  expect(await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)).toEqual([
    { msg: 'click_cell', x: 11, y: 3, button: 3 },
  ])
  await page.evaluate(() => window.__orbrunMapLifecycle.receive({
    msg: 'ui-push', type: 'describe-monster', title: 'a goblin', body: 'This goblin is sleeping.',
  }))
  await expect(tooltip).toHaveText('This goblin is sleeping.')
  await expect(tooltip).toBeVisible()
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
  await page.evaluate(() => window.__orbrunMapLifecycle.receive({ msg: 'player', status: [
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
  await page.evaluate(() => window.__orbrunMapLifecycle.receive({ msg: 'player', status: [] }))
  await expect(slow).toHaveCount(0)
  await expect(tip).toBeHidden()
  expect(await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)).toEqual([])
})

test('action panel opens and closes without a server reply', async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html?action-panel')
  const expand = page.getByTitle('Show the action panel')
  const icons = page.locator('.action-panel:not(.minimized)')
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 720 })
    await expect(expand).toBeVisible()
    await expand.click()
    await expect(icons).toBeVisible()
    await expect(expand).toBeHidden()
    await icons.click({ position: { x: 48, y: 16 } })
    await icons.click({ position: { x: 16, y: 16 } })
    await expect(expand).toBeVisible()
    await expect(icons).toBeHidden()
  }
  const sent = await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
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
        ;window.__orbrunMapLifecycle.pad({ type: 'press', button, t: performance.now() })
      }, button)
      const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
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
        const f = window.__orbrunMapLifecycle
        f.receive({ msg: 'ui_state', state: 0 })
        f.receive({ msg: 'init_input', type: 'messages', tag: 'stash_search', prefill: 'old search' })
      })
      await expect.poll(sent).toEqual([
        ...opening, { msg: 'key', keycode: 27 }, { msg: 'key', keycode: 6 },
        { msg: 'key', keycode: 21 }, { msg: 'key', keycode: 11 }, { msg: 'text_input', text: '.\r' },
      ])
      await page.evaluate(() => {
        const f = window.__orbrunMapLifecycle
        f.receive({ msg: 'close_input' })
        f.receive({ msg: 'menu', tag: 'stash_search', title: { text: 'Search results' }, flags: 0, items: [{ text: 'a +0 mace', hotkeys: [97], quantity: 1 }] })
      })
      await expect(page.getByText('a +0 mace', { exact: true })).toBeVisible()
      expect((await result(page)).renderer).toBe('Render2d')
      await page.evaluate(() => {
        const f = window.__orbrunMapLifecycle
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
        await page.evaluate(() => window.__orbrunMapLifecycle.pad({ type: 'dir', dir: 4, source: 'dpad' }))
        await press('A')
      }
      await expect.poll(async () => (await sent()).length).toBe(opening.length + 7)
      await page.evaluate(() => {
        const f = window.__orbrunMapLifecycle
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
    }
    const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
    const before = await sent()
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
    expect(await sent()).toEqual(before)
  })
})

test('Shift+numpad sends server run commands when Windows consumes the modifier', smoke, async ({ page }) => {
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

test('inputs use server replies immediately between paints, including touch and controller presses', smoke, async ({ page }) => {
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const evidence = await page.evaluate(() => {
    const fixture = window.__orbrunLiveAnimation
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

test('controller buttons navigate even while display frames are suspended', smoke, async ({ page }) => {
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

test('inventory transitions preserve live updates, stable hover targets, and immediate closing', smoke, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/testbed/live-animation.html')
  await expect.poll(async () => (await result(page)).playerOnLevel).toBe(true)
  const lifecycle = await page.evaluate(async () => {
    const fixture = window.__orbrunLiveAnimation
    const stack = document.querySelector<HTMLElement>('.overlay-stack')!
    const change = (msg: ServerMessage) => new Promise<void>(resolve => {
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
      ;window.__orbrunLiveAnimation.receive({ msg: 'close_menu' })
    })
    const exit = stack.querySelector<HTMLElement>('.ui-exit')!
    const retiring = exit.querySelector<HTMLElement>('.popup')!
    return { live: stack.querySelectorAll(':scope > .popup').length, inert: exit.inert, hidden: exit.getAttribute('aria-hidden'),
      pointerEvents: getComputedStyle(retiring).pointerEvents, duration: retiring.getAnimations()[0]?.effect?.getTiming().duration }
  })
  expect(closed).toEqual({ live: 0, inert: true, hidden: 'true', pointerEvents: 'none', duration: 90 })
  await expect(page.locator('.ui-exit')).toHaveCount(0)
})

test('the desktop dungeon canvas accepts keyboard movement', smoke, async ({ page }) => {
  await page.goto('/testbed/map-lifecycle.html')
  await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
  await page.locator('canvas.view').press('ArrowRight')
  await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'input', text: 'l' })
})
