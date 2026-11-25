import { expect } from '@playwright/test'
import type { ServerMessage } from '../../packages/webtiles/src/protocol'
import { smoke, test } from './fixtures'
import type {} from '../../apps/orbrun/testbed/map-lifecycle'

for (const touch of [false, true]) {
  test.describe(touch ? 'RC editor touch' : 'RC editor desktop', () => {
    test.use({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch })
    test('edits the server file from Play and reads it again on reopen', touch ? {} : smoke, async ({ page }) => {
      const files: Record<string, string> = { 'dcss-web-0.34': '# server rc\n', 'dcss-web-trunk': '# trunk rc\n' }
      const sent: { msg: string; game_id?: string; contents?: string }[] = []
      // Exercise the app's real connection and lobby without any public-server dependency.
      await page.route('**/morgue-proxy/**', route => route.fulfill({ status: 404, body: '' }))
      await page.route('**/gamedata-proxy/**', route => route.fulfill({ status: 404, body: '' }))
      await page.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
        socket.onMessage(raw => {
          const message = JSON.parse(String(raw))
          sent.push(message)
          if (message.msg === 'token_login') socket.send(JSON.stringify({ msgs: [
            { msg: 'login_success', username: 'rc-test' },
            { msg: 'set_game_links', content: Object.keys(files).map(id => `<span><br><a href="#play-${id}">DCSS ${id.endsWith('trunk') ? 'trunk' : '0.34'}</a><a class="edit_rc_link" data-game_id="${id}">(edit rc)</a></span>`).join('') },
            { msg: 'lobby_complete' },
          ] }))
          if (message.msg === 'set_login_cookie') socket.send(JSON.stringify({ msg: 'login_cookie', cookie: 'test-token', expires: 7 }))
          if (message.msg === 'get_rc') socket.send(JSON.stringify({ msg: 'rcfile_contents', game_id: message.game_id, contents: files[message.game_id] ?? '' }))
          if (message.msg === 'set_rc') files[message.game_id] = message.contents
        })
      })
      await page.addInitScript(() => {
        const account = { serverId: 'cdi', username: 'rc-test' }
        localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
        localStorage.setItem('orbrun.account', JSON.stringify(account))
        localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/rc-test': 'test-token' }))
      })
      await page.goto('/')
      await page.getByRole('button', { name: 'Play', exact: true }).click()
      await expect(page).toHaveURL(/\/play$/)
      const edit = page.locator('[data-focus="rc:dcss-web-0.34"]')
      await expect(edit).toBeVisible()
      const contained = await edit.evaluate(button => {
        const row = button.closest('.command-line')!
        const bounds = row.getBoundingClientRect()
        return [...row.querySelectorAll('button')].every(action => {
          const box = action.getBoundingClientRect()
          return box.top >= bounds.top && box.bottom <= bounds.bottom && box.left >= bounds.left && box.right <= bounds.right
        })
      })
      expect(contained).toBe(true)
      await edit.click()
      const text = page.getByRole('textbox', { name: 'rc file', exact: true })
      await expect(text).toHaveValue('# server rc\n')
      const contents = '# server rc\nautofight_stop = 60\n{\n  -- Lua stays verbatim\n}\n'
      await text.fill(contents)
      if (touch) await page.locator('[data-focus="rc:save"]').click()
      else await text.press('Control+s')
      await expect(page.locator('.brand > .hint').filter({ hasText: 'Saved on crawl.dcss.io.' })).toBeVisible()
      expect(files['dcss-web-0.34']).toBe(contents)
      expect(files['dcss-web-trunk']).toBe('# trunk rc\n')
      expect(sent.filter(message => message.msg === 'set_rc')).toEqual([{ msg: 'set_rc', game_id: 'dcss-web-0.34', contents }])
      await page.getByRole('button', { name: /Back/ }).click()
      await expect(edit).toBeFocused()
      // A WebTiles edit changes the same remote file. Reopening must fetch it again.
      files['dcss-web-0.34'] = '# edited in WebTiles\n'
      await edit.click()
      await expect(text).toHaveValue('# edited in WebTiles\n')
      await text.fill('# unsaved\n')
      await page.getByRole('button', { name: /Back/ }).click()
      await expect(text).toHaveValue('# unsaved\n')
      await page.getByRole('button', { name: /Back, without saving\?/ }).click()
      await expect(edit).toBeFocused()
      expect(files['dcss-web-0.34']).toBe('# edited in WebTiles\n')
      expect(sent.some(message => ['play', 'input', 'key'].includes(message.msg))).toBe(false)
    })
  })
}

test('the Watch route exposes the cog while game data is loading', smoke, async ({ page }) => {
  const sent: { msg: string; username?: string }[] = []
  await page.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
    socket.onMessage(raw => {
      const msg = JSON.parse(String(raw))
      sent.push(msg)
      if (msg.msg === 'watch') socket.send(JSON.stringify({ msg: 'watching_started', username: msg.username }))
    })
  })
  await page.goto('/watch/cdi#fixture-spectator')
  const loading = page.getByText('Loading game data…', { exact: true })
  const cog = page.getByRole('button', { name: 'Open system menu', exact: true })
  await expect(loading).toBeVisible()
  await expect(cog).toBeInViewport({ ratio: 1 })
  await cog.click()
  const system = page.locator('.overlay-stack > .sysmenu')
  await expect(system.getByText('Stop watching', { exact: true })).toBeVisible()
  await system.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.settings-groups')).toBeVisible()
  expect(sent).toEqual([{ msg: 'watch', username: 'fixture-spectator' }])
})

for (const touch of [false, true]) {
  test.describe(`spectator menus with ${touch ? 'touch' : 'mouse'}`, () => {
    test.use({ viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: touch })

    test('the spectator cog opens Escape and local settings stay above incoming windows', touch ? smoke : {}, async ({ page }) => {
      await page.goto('/testbed/map-lifecycle.html?spectating')
      await page.addStyleTag({ content: '#controls { display: none }' })
      const cog = page.getByRole('button', { name: 'Open system menu', exact: true })
      await expect(cog).toBeVisible()
      const box = (await cog.boundingBox())!
      if (touch) expect(box.x + box.width).toBe(386)
      else expect(box.x).toBeLessThanOrEqual(8)
      expect(box.y).toBeLessThanOrEqual(8)
      const open = () => touch ? cog.tap() : cog.click()
      await open()
      const system = page.locator('.overlay-stack > .sysmenu')
      await expect(system.getByText('Stop watching', { exact: true })).toBeVisible()
      await system.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.locator('.settings-groups').getByText('View', { exact: true }).click()

      const settings = page.getByRole('dialog', { name: 'View settings' })
      const zoom = settings.getByRole('slider', { name: 'Dungeon zoom', exact: true })
      await zoom.focus()
      const receive = (msg: ServerMessage) => page.evaluate(msg => window.__orbrunMapLifecycle.receive(msg), msg)
      await receive({ msg: 'menu', tag: 'inventory', title: { text: 'Inventory' }, flags: 0, total_items: 1,
        items: [{ text: 'a - Watched inventory item', hotkeys: [97] }] })
      await receive({ msg: 'ui-push', type: 'describe-item', title: 'Watched item details', body: 'An item in the watched game.' })
      const inventory = page.locator('.overlay-stack > .popup').filter({ hasText: 'Watched inventory item' })
      const details = page.locator('.overlay-stack > .popup').filter({ hasText: 'Watched item details' })
      await expect(inventory).toBeVisible()
      await expect(details).toBeVisible()
      await expect.poll(() => page.locator('.overlay-stack').evaluate(stack => {
        const local = stack.querySelector(':scope > .settings[data-client]')
        const watched = [...stack.querySelectorAll<HTMLElement>(':scope > .popup:not([data-client])')]
        return !!local && watched.length === 2 && watched.every(el => el.inert &&
          (el.compareDocumentPosition(local) & Node.DOCUMENT_POSITION_FOLLOWING))
      })).toBe(true)
      await expect(zoom).toBeFocused()
      await zoom.press('ArrowRight')
      await expect(zoom).toHaveAttribute('aria-valuetext', '105%')

      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      await expect(system).toBeHidden()
      await expect(details).not.toHaveAttribute('inert', '')
      await open()
      await expect(system.getByText('Stop watching', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await expect(system).toBeVisible()
      expect(await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)).toEqual([])
    })
  })
}

test('returns to the last successful login after browsing another server, reauthentication and logout', async ({ page }) => {
  let acceptToken = true
  let cookies = 0
  let tokenAttempts = 0
  const username = 'usual-player'
  await page.route('**/morgue-proxy/**', route => route.fulfill({ status: 404 }))
  await page.routeWebSocket(/wss?:\/\//, socket => {
    const reply = (msg: object) => socket.send(JSON.stringify(msg))
    reply({ msg: 'lobby_complete' })
    if (new URL(socket.url()).hostname !== 'crawl-br.roguelikes.gg') return
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw))
      if (message.msg === 'login' && message.username === username && message.password === 'fixture-password') reply({ msg: 'login_success', username })
      if (message.msg === 'token_login') {
        tokenAttempts++
        reply(acceptToken ? { msg: 'login_success', username } : { msg: 'login_fail' })
      }
      if (message.msg === 'set_login_cookie') reply({ msg: 'login_cookie', cookie: `fixture-${++cookies}`, expires: 7 })
    })
  })
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbrun.homeServer')) localStorage.setItem('orbrun.homeServer', JSON.stringify('cdi'))
  })
  await page.goto('/login/cbrg')
  const picker = page.getByRole('combobox', { name: 'Server', exact: true })
  const logIn = page.getByRole('button', { name: 'Log in', exact: true })
  const logOut = page.getByRole('button', { name: 'Log out', exact: true })
  await page.locator('input[name=username]').fill(username)
  await page.locator('input[name=password]').fill('fixture-password')
  await page.locator('.login-form button[data-focus=login]').click()
  await expect(logOut).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orbrun.tokens'))).toContain('fixture-1')

  await picker.selectOption('cao')
  await expect(picker).toHaveValue('cao')
  await expect(logOut).toBeHidden()
  await page.reload()
  await expect(picker).toHaveValue('cbrg')
  await expect(logOut).toBeVisible()
  expect(tokenAttempts).toBe(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('orbrun.tokens'))).toContain('fixture-2')

  acceptToken = false
  await page.reload()
  await expect(picker).toHaveValue('cbrg')
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(username)
  await expect(logIn).toBeEnabled()
  await expect(page.locator('.auth-status')).toBeEmpty()
  await page.getByLabel('Password', { exact: true }).fill('fixture-password')
  await logIn.click()
  await logOut.click()
  await page.reload()
  await expect(picker).toHaveValue('cbrg')
  await expect(logIn).toBeEnabled()
})

test('shares saved sign-in between tabs through an interrupted connection and logout', smoke, async ({ page, context }) => {
  const sockets: import('@playwright/test').WebSocketRoute[] = []
  const attempts: { socket: number; cookie: string }[] = []
  const revoked: string[] = []
  const username = 'reconnect-test'
  let token = 'initial'
  const reply = (socket: import('@playwright/test').WebSocketRoute, msg: object) => socket.send(JSON.stringify(msg))
  await context.route('**/morgue-proxy/**', route => route.fulfill({ status: 404 }))
  await context.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
    const index = sockets.push(socket) - 1
    reply(socket, { msg: 'lobby_complete' })
    socket.onMessage(raw => {
      const msg = JSON.parse(String(raw))
      if (msg.msg === 'token_login') {
        attempts.push({ socket: index, cookie: msg.cookie })
        if (index === 0) return // the first connection fails before WebTiles accepts the token
        if (msg.cookie !== token) return reply(socket, { msg: 'login_fail' })
        token = ''
        reply(socket, { msg: 'login_success', username })
      }
      if (msg.msg === 'set_login_cookie') {
        token = `replacement-${index}`
        reply(socket, { msg: 'login_cookie', cookie: token, expires: 7 })
      }
      if (msg.msg === 'forget_login_cookie') revoked.push(msg.cookie)
    })
  })
  await page.addInitScript(username => {
    const account = { serverId: 'cdi', username }
    localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
    localStorage.setItem('orbrun.account', JSON.stringify(account))
    localStorage.setItem('orbrun.tokens', JSON.stringify({ ['cdi/' + username]: 'initial' }))
  }, username)
  await page.goto('/')
  await expect.poll(() => attempts).toEqual([{ socket: 0, cookie: 'initial' }])
  await expect(page.locator('.auth-status')).toContainText('Signing you back in')
  await expect(page.getByLabel('Password', { exact: true })).toBeHidden()

  const second = await context.newPage()
  await second.setViewportSize({ width: 390, height: 844 })
  await second.goto('/')
  await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.length)).toBe(1)
  await expect(second.getByLabel('Password', { exact: true })).toBeHidden()
  await sockets[0].close({ code: 1012 })

  await expect(second.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
  expect(attempts).toEqual([
    { socket: 0, cookie: 'initial' },
    { socket: 1, cookie: 'initial' },
    { socket: 2, cookie: 'replacement-1' },
  ])
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.tokens')!)['cdi/reconnect-test']?.token)).toBe('replacement-2')
  await second.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect.poll(() => revoked.includes('replacement-2')).toBe(true)
  await expect(page.getByRole('button', { name: username, exact: true })).toBeHidden()
  await page.getByRole('combobox', { name: 'Server', exact: true }).selectOption('cdi')
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
})

test('continues the requested game after a reconnect and a rejected saved sign-in', async ({ page }) => {
  const games: string[] = []
  const sockets: import('@playwright/test').WebSocketRoute[] = []
  await page.routeWebSocket('wss://crawl.dcss.io/socket', socket => {
    const index = sockets.push(socket) - 1
    socket.onMessage(raw => {
      const msg = JSON.parse(String(raw))
      if (msg.msg === 'token_login') {
        if (index === 0) void socket.close({ code: 1012 })
        else socket.send(JSON.stringify({ msg: 'login_fail', reason: 'Expired token.' }))
      }
      if (msg.msg === 'login' && msg.username === 'continue-test' && msg.password === 'fixture-password') {
        socket.send(JSON.stringify({ msg: 'login_success', username: msg.username }))
      }
      if (msg.msg === 'set_login_cookie') socket.send(JSON.stringify({ msg: 'login_cookie', cookie: 'replacement', expires: 7 }))
      if (msg.msg === 'play') {
        games.push(msg.game_id)
        socket.send(JSON.stringify({ msg: 'game_started' }))
      }
    })
  })
  await page.addInitScript(() => {
    const account = { serverId: 'cdi', username: 'continue-test' }
    localStorage.setItem('orbrun.accounts', JSON.stringify([account]))
    localStorage.setItem('orbrun.account', JSON.stringify(account))
    localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/continue-test': 'rejected' }))
  })
  await page.goto('/play/cdi/continue-test/dcss-0.34')
  const fallback = page.locator('.login-form')
  await expect(fallback).toBeVisible()
  await expect(fallback.getByRole('status')).toBeEmpty()
  await expect(fallback.locator('input[name=username]')).toHaveValue('continue-test')
  await fallback.locator('input[name=password]').fill('fixture-password')
  await fallback.locator('button[data-focus=login]').click()
  await expect.poll(() => games).toEqual(['dcss-0.34'])
  await expect(page.locator('.screen.game')).toBeVisible()
  sockets[1].send(JSON.stringify({ msg: 'go_lobby' }))
  await expect(page.locator('.signed-in').getByText('continue-test', { exact: true })).toBeVisible()
  expect(sockets).toHaveLength(2)
})

for (const touch of [false, true]) {
  test.describe(touch ? 'Polished menu touch' : 'Polished menu desktop', () => {
    test.use({ viewport: touch ? { width: 320, height: 960 } : { width: 1016, height: 780 }, hasTouch: touch })
    test('keeps inline auth, keyed rows and modal focus stable as the lobby changes', touch ? {} : smoke, async ({ page }) => {
      const sockets: import('@playwright/test').WebSocketRoute[] = []
      const sent: { msg: string; username?: string; password?: string }[] = []
      const send = (socket: import('@playwright/test').WebSocketRoute, msgs: object[]) => socket.send(JSON.stringify({ msgs }))
      await page.route('**/morgue-proxy/**', route => route.fulfill({ status: 404, body: '' }))
      await page.routeWebSocket(/wss?:\/\//, socket => {
        sockets.push(socket)
        send(socket, [{ msg: 'lobby_complete' }])
        socket.onMessage(raw => {
          const m = JSON.parse(String(raw)); sent.push(m)
          if (m.msg === 'set_login_cookie') send(socket, [{ msg: 'login_cookie', cookie: 'fixture-session', expires: 7 }])
          if (m.msg === 'token_login' || (m.msg === 'login' && m.password === 'fixture-password')) send(socket, [
            { msg: 'login_success', username: m.username ?? 'menu-test' },
            { msg: 'set_game_links', content: '<span><a href="#play-dcss-0.34">DCSS 0.34</a><a class="edit_rc_link" data-game_id="stable-rc">(edit rc)</a></span><span><a href="#play-dcss-web-trunk">DCSS trunk</a><a class="edit_rc_link" data-game_id="trunk-rc">(edit rc)</a></span><span><a href="#play-descent-web-trunk">Descent</a></span>' },
            { msg: 'lobby_complete' },
          ])
        })
      })
      await page.addInitScript(() => {
        const account = { serverId: 'cdi', username: 'menu-test' }
        localStorage.setItem('orbrun.accounts', JSON.stringify([account, { serverId: 'cdi', username: 'other-test' }]))
        localStorage.setItem('orbrun.account', JSON.stringify(account))
      })
      await page.goto('/')
      const user = page.getByRole('textbox', { name: 'Username', exact: true }), pass = page.getByLabel('Password', { exact: true })
      const server = page.getByRole('combobox', { name: 'Server', exact: true })
      const login = page.getByRole('button', { name: 'Log in', exact: true })
      const commands = page.getByRole('navigation', { name: 'Main menu' }).getByRole('button')
      const firstCommand = commands.first()
      const cursor = (command: typeof firstCommand) => command.locator('.command-marker').evaluate(marker => ({
        glyph: getComputedStyle(marker, '::after').content,
        visible: getComputedStyle(marker, '::after').opacity,
        inactiveGlyph: getComputedStyle(marker, '::before').opacity,
      }))
      await expect(firstCommand).toBeFocused()
      await expect.poll(() => cursor(firstCommand)).toEqual({ glyph: '"@"', visible: '1', inactiveGlyph: '0' })
      await page.keyboard.press('ArrowDown')
      await expect(commands.nth(1)).toBeFocused()
      await expect.poll(() => cursor(commands.nth(1))).toEqual({ glyph: '"@"', visible: '1', inactiveGlyph: '0' })
      await expect.poll(() => cursor(firstCommand)).toMatchObject({ visible: '0', inactiveGlyph: '1' })
      await page.getByRole('link', { name: 'Forgot password', exact: true }).focus()
      await page.keyboard.press('Tab')
      await expect(firstCommand).toBeFocused()
      const unused = await firstCommand.evaluate(button => {
        const box = button.getBoundingClientRect()
        return { x: box.right + 4, y: box.y + box.height / 2 }
      })
      await page.mouse.click(unused.x, unused.y)
      await expect(page).toHaveURL(/\/$/)
      // Cover both a remembered account and a server where this device has never logged in.
      if (touch) {
        await server.selectOption('cao')
        const [picker, ...fields] = await Promise.all([server, user, pass, login].map(control => control.boundingBox()))
        for (const field of fields) expect(field!.y + field!.height / 2).toBeCloseTo(picker!.y + picker!.height / 2)
        await expect(login).toBeInViewport({ ratio: 1 })
      }
      await expect(login).toBeEnabled()
      await expect(firstCommand.getByText('Log in to play', { exact: true })).toBeVisible()
      await firstCommand.click()
      await expect(page).toHaveURL(/\/$/)
      await expect(touch ? user : pass).toBeFocused()
      await user.fill('menu-test'); await pass.fill('fixture-password')
      const handle = await pass.elementHandle()
      send(sockets.at(-1)!, [{ msg: 'lobby_entry', id: 1, username: 'viewer', game_id: 'dcss-0.34' }, { msg: 'lobby_complete' }])
      await expect(pass).toBeFocused(); await expect(pass).toHaveValue('fixture-password')
      expect(await handle!.evaluate(el => el === document.activeElement)).toBe(true)
      for (const id of ['about', 'news']) {
        const trigger = page.locator(`[data-focus="${id}"]`)
        await trigger.click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.locator('.polished-home')).toHaveAttribute('inert', '')
        send(sockets.at(-1)!, [{ msg: 'lobby_complete' }])
        await page.keyboard.press('Shift+Tab')
        expect(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement))).toBe(true)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(trigger).toBeFocused()
        await expect(pass).toHaveValue('fixture-password')
      }
      expect(await page.evaluate(() => localStorage.getItem('orbrun.newsSeen'))).toBeTruthy()
      await pass.fill('rejected-password')
      await login.click()
      await expect(login).toBeDisabled()
      await expect(page.locator('.account-bar [role="status"]')).toHaveText('Logging in…')
      await pass.fill('fixture-password')
      await pass.press('Enter')
      send(sockets.at(-1)!, [{ msg: touch ? 'auth_error' : 'login_fail', reason: 'Incorrect password.' }])
      await expect(page.locator('.account-bar [role="status"]')).toHaveText('Incorrect password.')
      await expect(pass).toHaveValue('fixture-password')
      await expect(login).toBeEnabled()
      await pass.press('Enter')
      await expect(page.locator('.signed-in')).toContainText('menu-test')
      const rootMenu = page.getByRole('navigation', { name: 'Main menu' })
      const rootPlay = rootMenu.getByRole('button', { name: 'Play', exact: true })
      const rootOffline = rootMenu.getByRole('button', { name: 'Play Offline', exact: true })
      await expect(rootMenu.locator('.label')).toHaveText(['Play', 'Play Offline', 'Watch', 'Settings'])
      await expect(rootMenu.getByText('Log in to play', { exact: true })).toHaveCount(0)
      const title = page.getByRole('heading', { name: 'Polished Crawl', exact: true })
      await page.evaluate(() => document.fonts.ready)
      const position = await title.boundingBox()
      await rootPlay.click()
      await expect(page).toHaveURL(/\/play$/)
      expect(await title.boundingBox()).toEqual(position)
      const playMenu = page.getByRole('navigation', { name: 'Play', exact: true })
      await expect(playMenu.getByRole('button', { name: 'Morgues', exact: true })).toBeVisible()
      await expect(playMenu.getByRole('button', { name: 'More versions & modes', exact: true })).toBeVisible()
      await expect(playMenu.getByRole('button').last()).toHaveText(/Back$/)
      const stable = page.locator('[data-focus="play:dcss-0.34"]')
      await expect(stable).toBeFocused()
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.account')!))).toEqual({ serverId: touch ? 'cao' : 'cdi', username: 'menu-test' })
      await expect(page.locator('.polished-commands')).not.toContainText('Descent')
      expect(sent.filter(m => m.msg === 'login')).toEqual([
        { msg: 'login', username: 'menu-test', password: 'rejected-password' },
        { msg: 'login', username: 'menu-test', password: 'fixture-password' },
      ])
      const play = page.locator('[data-focus="play:dcss-web-trunk"]'); await play.focus()
      const node = await play.elementHandle()
      send(sockets.at(-1)!, [{ msg: 'lobby_entry', id: 2, username: 'menu-test', game_id: 'dcss-web-trunk', char: 'TrFi', xl: '11', place: 'Lair:2' }])
      await expect(play).toContainText('Continue')
      expect(await node!.evaluate(el => el === document.activeElement)).toBe(true)
      expect(await page.locator('.polished-home').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.evaluate(() => document.fonts.ready)
      await page.locator('[data-focus="about"]').click()
      await page.goBack()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('.polished-home')).not.toHaveAttribute('inert', '')
      await expect(page.getByRole('button', { name: 'Accounts', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'menu-test', exact: true })).toHaveCount(0)
      await playMenu.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(rootPlay).toBeFocused()
      await rootPlay.click()
      await expect(stable).toBeFocused()
      await playMenu.getByRole('button', { name: 'Back', exact: true }).click()
      await rootOffline.click()
      await expect(page).toHaveURL(/\/offline$/)
      const offlineMenu = page.getByRole('navigation', { name: 'Play Offline', exact: true })
      expect(await title.boundingBox()).toEqual(position)
      await expect(offlineMenu.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0)
      await expect(offlineMenu.getByRole('button').first()).toBeFocused()
      const offlineBack = offlineMenu.getByRole('button').last()
      await expect(offlineBack).toHaveText(/Back$/)
      await offlineBack.click()
      await expect(rootOffline).toBeFocused()
      await rootPlay.click()
      await expect(stable).toBeFocused()
      await page.getByRole('button', { name: 'Log out', exact: true }).click()
      await expect(page).toHaveURL(/\/$/)
      await expect(user).toHaveValue('')
      await expect(login).toBeEnabled()
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('orbrun.account')!))).toBeNull()
      await expect(firstCommand.getByText('Log in to play', { exact: true })).toBeVisible()
      await firstCommand.press('Enter')
      await expect(page).toHaveURL(/\/$/)
      await expect(user).toBeFocused()
    })
  })
}
