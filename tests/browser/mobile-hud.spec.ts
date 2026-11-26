import { expect } from '@playwright/test'
import { Keys, MouseMode, UiState, type ServerMessage } from '../../packages/webtiles/src/protocol'
import { MSGCH } from '../../packages/webtiles/src/state'
import { androidUserAgent, openHudSettings, result, smoke, test } from './fixtures'
import type {} from '../../apps/orbrun/testbed/map-lifecycle'

for (const viewport of [{ width: 800, height: 1080 }, { width: 1000, height: 900 }]) {
  test(`a touch on a mixed-input screen keeps the zoom and brings up the split compass at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => window.__orbrunMapLifecycle.ready())
    const hud = page.locator('.hud')
    const controls = hud.locator('.touchbar.split')
    const stats = hud.locator('.stats .line').first()
    const tileSize = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().tileSize!)
    await expect(stats).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true)
    await expect(hud).not.toHaveClass(/mobile-dungeon/)
    const scale = await tileSize()
    await stats.dispatchEvent('pointerdown', { pointerType: 'touch' })
    await expect(controls.getByRole('button', { name: 'Northwest' })).toBeVisible()
    expect(await tileSize()).toBeCloseTo(scale, 8)
    const dungeon = page.locator('canvas.view')
    const width = (await dungeon.boundingBox())!.width
    await page.keyboard.press('ArrowUp')
    await expect(controls).toBeHidden()
    expect((await dungeon.boundingBox())!.width).toBe(width)
    expect(await tileSize()).toBeCloseTo(scale, 8)
  })
}

test.describe('touch layout editor', () => {
  test.use({ viewport: { width: 390, height: 735 }, isMobile: true, hasTouch: true })
  test('control height persists and fits both orientations', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?preview-touch&spells')
    const controls = page.locator('.touchbar.split')
    const button = (name: string) => controls.getByRole('button', { name, exact: true })
    await expect(button('Northwest')).toHaveCSS('height', '44px')
    await openHudSettings(page)
    const step = page.getByRole('button', { name: 'Touch control height next', exact: true })
    await step.tap()
    await step.tap()
    await expect(page.getByRole('slider', { name: 'Touch control height' })).toHaveAttribute('aria-valuetext', '150%')
    await page.reload()
    for (const viewport of [{ width: 405, height: 803 }, { width: 944, height: 481 }, { width: 740, height: 240 }]) {
      await page.setViewportSize(viewport)
      const short = viewport.height === 240
      await expect.poll(async () => (await button('Northwest').boundingBox())?.height).toBe(short ? 44 : 66)
      const compass = (await button('Northwest').boundingBox())!
      const skills = (await button('Skills').boundingBox())!
      const fight = (await button('Fight').boundingBox())!
      expect(skills.height).toBe(compass.height)
      expect(skills.y).toBe(compass.y)
      expect(fight.height).toBe(2 * skills.height + 4)
      expect(fight.y + fight.height).toBeLessThanOrEqual(viewport.height)
    }
  })

  test('previews presets, saves a personal layout and keeps older assigned actions usable', async ({ page }) => {
    await page.addInitScript(() => {
      const key = 'orbrun.touch-layout.v1'
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(
        ['CMD_LIST_GOLD', 'CMD_DISPLAY_MAP', 'gear', 'escape', 'CMD_EXPLORE', 'CMD_AUTOFIGHT']))
    })
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    const hud = page.locator('.touchbar.split')
    const edit = hud.getByRole('button', { name: 'Edit touch layout' })
    const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
    const select = dialog.getByRole('combobox', { name: 'Layout preset' })
    const button = (name: string) => dialog.getByRole('button', { name, exact: true })
    await edit.tap()
    await expect(button('Top left, Show gold')).toBeVisible()
    for (const [name, primary] of [['Melee brute', 'Fight'], ['Spellcaster', 'Spells'], ['Ranged', 'Autofire'], ['Skirmisher', 'Throw item']]) {
      await select.selectOption(name)
      await expect(button('Bottom right, ' + primary)).toBeVisible()
    }
    await dialog.getByRole('searchbox').fill('gold')
    await expect(dialog.getByText('No matching actions.')).toBeVisible()
    await button('Top middle left, Pick up').tap()
    await dialog.getByRole('searchbox').fill('find down')
    await button('Find down >').tap()
    await expect(select).toHaveValue('')
    await button('Save as preset…').tap()
    const name = dialog.getByRole('textbox', { name: 'Preset name' })
    await name.fill(' Ranged ')
    await button('Save preset').tap()
    await expect(dialog.getByRole('alert')).toHaveText('That name is already in use.')
    await name.fill('Javelins')
    await button('Save preset').tap()
    await expect(select).toHaveValue('Javelins')
    await button('Cancel changes').tap()
    await expect(hud.getByRole('button', { name: 'Show gold' })).toBeVisible()
    await page.reload()
    await edit.tap()
    await select.selectOption('Javelins')
    await expect(button('Top middle left, Find down')).toBeVisible()
    await button('Save layout').tap()
    await hud.getByRole('button', { name: 'Throw item' }).tap()
    await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'input', text: 'F' })
  })

  test('swaps across rows, saves shortcuts and sends nested actions only on their own screen', smoke, async ({ page }) => {
    const ready = async () => {
      await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
      await page.evaluate(() => window.__orbrunMapLifecycle.ready())
    }
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await ready()
    const hud = page.locator('.touchbar.split')
    const edit = hud.getByRole('button', { name: 'Edit touch layout' })
    const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
    const button = (name: string) => dialog.getByRole('button', { name, exact: true })
    const search = dialog.getByRole('searchbox')
    const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
    const receive = (msg: ServerMessage) => page.evaluate(msg => window.__orbrunMapLifecycle.receive(msg), msg)
    await edit.tap()
    await button('Top left, Skills').dragTo(button('Bottom right, Fight'))
    await expect(button('Top left, Fight')).toBeVisible()
    await button('Fight Swap').tap()
    await expect(button('Bottom right, Fight')).toBeVisible()
    await button('Skills Swap').tap()
    await expect(button('Bottom right, Skills')).toBeVisible()
    await button('Bottom right, Skills').tap()
    await search.fill('autofire')
    await button('Autofire Shift+Tab').tap()
    await button('Top middle left, Map').tap()
    await search.fill('find down')
    await button('Find down >').tap()
    await page.setViewportSize({ width: 740, height: 265 })
    await expect(button('Save layout')).toBeInViewport({ ratio: 1 })
    await search.fill('')
    await page.setViewportSize({ width: 800, height: 1080 })
    await button('Save layout').tap()
    expect(await sent()).toEqual([])
    await page.reload()
    await ready()
    await edit.tap()
    await button('Restore defaults').tap()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await hud.getByRole('button', { name: 'Autofire', exact: true }).tap()
    const autofire = { msg: 'key', keycode: Keys.CK_SHIFT_TAB }
    await expect.poll(sent).toEqual([autofire])
    const find = hud.getByRole('button', { name: 'Find down', exact: true })
    const map = { msg: 'input', text: 'X' }
    await find.tap()
    await expect.poll(sent).toEqual([autofire, map])
    await receive({ msg: 'input_mode', mode: MouseMode.MORE })
    await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
    await receive({ msg: 'ui_state', state: UiState.VIEW_MAP })
    expect(await sent()).toEqual([autofire, map])
    await receive({ msg: 'ui_state', state: UiState.NORMAL })
    await find.tap()
    await find.tap()
    await receive({ msg: 'ui_state', state: UiState.VIEW_MAP })
    await expect.poll(sent).toEqual([autofire, map, map, { msg: 'input', text: '>' }])
  })
})

test.describe('short landscape on a wide touch device', () => {
  test.use({ viewport: { width: 740, height: 265 }, screen: { width: 1227, height: 673 }, isMobile: true, hasTouch: true, userAgent: androidUserAgent })

  test('fits the minimap, monsters and chat above or between the controls', smoke, async ({ page }) => {
    const device = await page.context().newCDPSession(page)
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 36, top: 0, right: 10, bottom: 16 } })
    await page.goto('/testbed/map-lifecycle.html?mobile-hud')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => window.__orbrunMapLifecycle.ready())
    await expect(page.locator('.game')).not.toHaveClass(/\bphone\b/)
    const minimap = page.getByRole('button', { name: 'Dungeon minimap, open level map' })
    const monsters = page.locator('.hud .monsters')
    const launcher = page.getByRole('link', { name: 'Chat', exact: true })
    const controls = page.locator('.touchbar.split')
    await expect(launcher).toBeVisible()
    await expect(minimap).toBeVisible()
    await expect(monsters.getByText('goblin', { exact: true })).toBeVisible()
    expect((await minimap.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    const list = (await monsters.boundingBox())!
    expect(list.height).toBeGreaterThanOrEqual(44)
    expect(list.y + list.height).toBeLessThan((await controls.getByRole('button', { name: 'Skills', exact: true }).boundingBox())!.y)
    const badge = (await launcher.boundingBox())!
    const dpad = (await controls.getByRole('button', { name: 'Southeast' }).boundingBox())!
    const commands = (await controls.getByRole('button', { name: 'Explore' }).boundingBox())!
    expect(badge.x).toBeGreaterThan(dpad.x + dpad.width)
    expect(badge.x + badge.width).toBeLessThan(commands.x)
    await page.evaluate(() => window.__orbrunMapLifecycle.receive({
      msg: 'chat', sender: 'Edda', content: '<span class="chat_msg">Nice find!</span>',
    }))
    await launcher.tap()
    const caption = page.locator('.chat_caption')
    await expect(caption).toBeVisible()
    expect((await page.locator('.chat').boundingBox())!.x).toBeGreaterThan(dpad.x + dpad.width)
    await expect(page.locator('.chat_history').getByText('Nice find!')).toBeInViewport()
    await caption.tap()
    await expect(launcher).toBeVisible()
    await expect(caption).toBeHidden()
  })
})

test.describe('portrait action panel', () => {
  const viewport = { width: 732, height: 896 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('keeps the menu at the upper left with the minimap below it at phone and wider sizes', async ({ page }) => {
    const device = await page.context().newCDPSession(page)
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 8, top: 12 } })
    await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ minimapAlignment: 'Right' })))
    await page.goto('/testbed/map-lifecycle.html?mobile-hud&action-panel')
    const actions = page.locator('.action-panel')
    const icons = actions.locator('canvas')
    const expand = page.getByTitle('Show the action panel')
    const map = page.getByRole('button', { name: 'Dungeon minimap, open level map' })
    const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await expect(actions).toBeHidden()
    await page.evaluate(() => window.__orbrunMapLifecycle.ready())
    for (const size of [viewport, { width: 320, height: 560 }]) {
      await page.setViewportSize(size)
      await expect.poll(() => page.locator('canvas.view').boundingBox().then(box => box?.width)).toBe(size.width)
      await expect(expand).toBeVisible()
      await expect(map).toBeVisible()
      const folded = (await actions.boundingBox())!
      const minimap = (await map.boundingBox())!
      expect(folded).toMatchObject({ x: 16, y: 16 })
      expect(minimap.x).toBe(folded.x)
      expect(minimap.y).toBeGreaterThan(folded.y + folded.height)
      await expand.tap()
      await expect(icons).toBeVisible()
      const panel = (await icons.boundingBox())!
      expect(panel).toMatchObject({ x: folded.x, y: folded.y })
      expect(panel.y + panel.height).toBeLessThan(minimap.y)
      expect(await map.boundingBox()).toEqual(minimap)
      await page.touchscreen.tap(panel.x + 48, panel.y + 16)
      await page.touchscreen.tap(panel.x + 16, panel.y + 16)
      await expect(expand).toBeVisible()
    }
    expect(await sent()).toEqual(Array.from({ length: 2 }).flatMap(() => [
      { msg: 'set_option', line: 'action_panel_show = true' },
      { msg: 'main_menu_action' },
      { msg: 'set_option', line: 'action_panel_show = false' },
    ]))
  })
})

test.describe('wide landscape on a phone', () => {
  const viewport = { width: 1047, height: 473 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('keeps the action panel and spectator caption accessible', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?mobile-hud&action-panel')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => window.__orbrunMapLifecycle.ready())
    await expect(page.locator('.game')).toHaveClass(/\bphone\b/)
    const caption = page.locator('.chat_caption')
    await expect(caption).toBeVisible()
    await expect(caption).toContainText('0 spectators')
    const expand = page.getByTitle('Show the action panel')
    await expand.tap()
    const panel = page.locator('.action-panel canvas')
    await expect(panel).toBeVisible()
    const compass = page.locator('.touchbar.split').getByRole('button', { name: 'Northwest' })
    expect((await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThan((await compass.boundingBox())!.y)
    await caption.tap()
    await expect(page.locator('.chat_body')).toBeVisible()
    await caption.tap()
    await expect(page.locator('.chat_body')).toBeHidden()
    await panel.tap({ position: { x: 48, y: 16 } })
    await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'main_menu_action' })

    await page.setViewportSize({ width: 740, height: 230 })
    await expect.poll(() => page.locator('canvas.view').boundingBox().then(box => box?.height)).toBe(230)
    await expect(caption).toBeHidden()
    await expect(panel).toBeVisible()
    const chat = page.getByRole('link', { name: 'Chat', exact: true })
    await chat.tap()
    await expect(page.locator('.chat_body')).toBeVisible()
  })
})

for (const orientation of ['portrait', 'landscape', 'wide-landscape'] as const) {
  const portrait = orientation === 'portrait'
  const wide = orientation === 'wide-landscape'
  test.describe(`mobile HUD ${orientation}`, () => {
    const viewport = wide ? { width: 1227, height: 673 } : portrait ? { width: 390, height: 735 } : { width: 824, height: 300 }
    const screen = wide ? viewport : portrait ? { width: 390, height: 844 } : { width: 844, height: 390 }
    const insets = wide ? { left: 0, top: 0, right: 0, bottom: 0 } : portrait
      ? { left: 0, top: 12, right: 0, bottom: 24 }
      : { left: 36, top: 0, right: 10, bottom: 16 }
    test.use({
      viewport, screen,
      isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: androidUserAgent,
    })

    test('fits touch controls and keeps the dungeon and character sheet readable', portrait ? smoke : {}, async ({ page }) => {
      const device = await page.context().newCDPSession(page)
      await device.send('Emulation.setSafeAreaInsetsOverride', { insets })
      await page.clock.install()
      await page.goto('/testbed/map-lifecycle.html?mobile-hud' + (wide ? '&action-panel' : ''))
      const dungeon = page.locator('canvas.view')
      const stats = page.locator('.hud .stats')
      const log = page.locator('.hud .messages')
      const nearby = page.locator('.hud .monsters')
      const controls = page.locator('.touchbar.split')
      const cog = page.getByRole('button', { name: 'Open system menu' })
      const commands = ['Explore', 'Fight', 'Skills', 'Esc', 'Gear', 'Map']
      const button = (name: string) => controls.getByRole('button', { name, exact: true })
      const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
      const receive = (msg: ServerMessage) => page.evaluate(msg => window.__orbrunMapLifecycle.receive(msg), msg)
      const loading = page.getByText('Loading game data…', { exact: true })
      await expect(loading).toBeVisible()
      await expect(stats).toBeHidden()
      await expect(cog).toBeHidden()
      expect((await loading.boundingBox())!.height).toBe(viewport.height)
      await page.evaluate(() => window.__orbrunMapLifecycle.ready())
      await expect(loading).toBeHidden()
      await expect.poll(async () => (await result(page)).renderer).toBe('Render25d')
      await expect(stats.getByText('Mara the Slasher', { exact: true })).toBeVisible()
      await expect(log.getByText('A bat comes into view.')).toBeVisible()
      await expect(stats.locator('.line:has(.stat-bar)')).toHaveCount(1)
      await expect(stats.locator('.stat-bar')).toHaveCount(2)
      await page.evaluate(() => document.fonts.ready)
      await expect(controls).toBeVisible()
      const fit = async (width: number, height: number) => {
        const view = (await dungeon.boundingBox())!
        const messages = (await log.boundingBox())!
        const sheet = (await stats.boundingBox())!
        const wait = (await button('Wait').boundingBox())!
        const fight = (await button('Fight').boundingBox())!
        const map = (await button('Map').boundingBox())!
        const menu = (await cog.boundingBox())!
        const fullscreen = (await page.getByRole('button', { name: 'Enter fullscreen' }).boundingBox())!
        expect(menu.y).toBe(insets.top + 4)
        expect(view.y).toBe(0)
        expect(sheet.x).toBeGreaterThanOrEqual(insets.left)
        expect(sheet.y).toBeGreaterThanOrEqual(insets.top)
        expect(wait.x).toBeLessThan(fight.x)
        expect(map.y + map.height).toBeLessThan(fight.y)
        if (portrait) {
          expect(menu.x + menu.width).toBe(width - insets.right - 4)
          expect(fullscreen.x + fullscreen.width).toBe(menu.x)
          expect(view.height).toBeGreaterThan(height * 0.4)
          expect(messages.y).toBeGreaterThanOrEqual(view.y + view.height - 1)
          expect(sheet.y).toBeGreaterThanOrEqual(messages.y + messages.height - 1)
          expect(sheet.y + sheet.height).toBeLessThan(wait.y)
        } else {
          const list = (await nearby.boundingBox())!
          expect(menu.x + menu.width + 4).toBeCloseTo(sheet.x)
          expect(messages.x + messages.width).toBeLessThan(menu.x)
          expect(fullscreen).toMatchObject({ x: menu.x, y: menu.y + menu.height })
          expect(view.width).toBeGreaterThan(width / 2)
          expect(messages.y + messages.height).toBeLessThan(height / 2)
          expect(sheet.x).toBeGreaterThan(view.x + view.width - 1)
          expect(list.y).toBeGreaterThanOrEqual(sheet.y + sheet.height - 1)
          expect(list.y + list.height).toBeLessThan(fight.y)
          expect(wait.x + wait.width).toBeLessThan(view.width / 2)
          expect(wait.y).toBeGreaterThan(view.height / 2)
          const covered = await stats.locator('.line > span').evaluateAll((spans, buttons) => spans.some(span => {
            const rect = span.getBoundingClientRect()
            return buttons.some(button => rect.top < button.y + button.height && rect.bottom > button.y &&
              rect.left < button.x + button.width && rect.right > button.x)
          }), [menu, fullscreen])
          expect(covered).toBe(false)
        }
        for (const name of [...commands, 'Wait', 'Northwest', 'Northeast', 'Southwest', 'Southeast']) {
          const target = (await button(name).boundingBox())!
          expect(target.width, name).toBeGreaterThanOrEqual(width < 350 ? 38 : 44)
          expect(target.height, name).toBeGreaterThanOrEqual(44)
          expect(target.x, name).toBeGreaterThanOrEqual(insets.left)
          expect(target.x + target.width, name).toBeLessThanOrEqual(width - insets.right)
          expect(target.y + target.height, name).toBeLessThanOrEqual(height - insets.bottom)
        }
      }
      if (!portrait) {
        await expect(nearby.getByText('goblin', { exact: true })).toBeVisible()
        await expect(nearby.getByText('bat', { exact: true })).toBeVisible()
      }
      await fit(viewport.width, viewport.height)
      const sheet = (await stats.boundingBox())!
      const readiedItem = stats.getByText('3 throwing nets', { exact: true })
      if (!portrait) await readiedItem.scrollIntoViewIfNeeded()
      const readied = (await readiedItem.boundingBox())!
      expect(readied.y + readied.height).toBeLessThanOrEqual(sheet.y + sheet.height)
      if (!portrait) await stats.evaluate(el => { el.scrollTop = 0 })
      expect((await result(page)).appliedDungeonOptions).toMatchObject({ portraitFraming: portrait })
      const upper = await Promise.all(['Skills', 'Map', 'Gear', 'Esc'].map(name => button(name).boundingBox()))
      const primary = await Promise.all(['Explore', 'Fight'].map(name => button(name).boundingBox()))
      expect(upper.every(box => box && box.y === upper[0]?.y)).toBe(true)
      expect(primary.every(box => box && box.y > upper[0]!.y && box.height >= 2 * upper[0]!.height && box.width >= 2 * upper[0]!.width)).toBe(true)
      expect((await button('Wait').boundingBox())!.height).toBe(44)
      if (wide) {
        const expand = page.getByTitle('Show the action panel')
        await expand.tap()
        await expect.poll(sent).toContainEqual({ msg: 'set_option', line: 'action_panel_show = true' })
        const panel = page.locator('.action-panel canvas')
        const chat = page.locator('.chat .chat_head')
        await expect(panel).toBeVisible()
        await expect(chat).toBeVisible()
        const logBox = (await log.boundingBox())!
        const listBox = (await nearby.boundingBox())!
        const panelBox = (await panel.boundingBox())!
        expect(logBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height)
        await receive({ msg: 'options', options: { action_panel_orientation: 'vertical' } })
        await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(panelBox.height)
        const vertical = (await panel.boundingBox())!
        const below = (await log.boundingBox())!
        expect(below.y).toBeGreaterThanOrEqual(vertical.y + vertical.height)
        expect(below.height).toBe(logBox.height)
        expect((await chat.boundingBox())!.y).toBeGreaterThanOrEqual(listBox.y + listBox.height)
        await chat.locator('.chat_hide_button').tap()
        const showChat = page.getByRole('link', { name: 'Show chat' })
        await expect(showChat).toBeVisible()
        const folded = (await showChat.boundingBox())!
        const spells = (await button('Skills').boundingBox())!
        expect(folded.y + folded.height).toBeLessThanOrEqual(spells.y)
        await showChat.tap()
        await expect(chat).toBeVisible()
      }
      const fireTwice = async () => {
        const before = await sent()
        const fire = (await button('Fire').boundingBox())!
        const tapFire = () => page.touchscreen.tap(fire.x + fire.width / 2, fire.y + fire.height / 2)
        const shot = { msg: 'input', text: 'f' }
        await tapFire()
        await expect.poll(sent).toEqual([...before, shot])
        await receive({ msg: 'msgs', messages: [{ text: 'Press: f - fire, + - next target, Q - select action', channel: MSGCH.PROMPT }] })
        await receive({ msg: 'input_mode', mode: MouseMode.TARGET })
        await receive({ msg: 'cursor', id: 0, loc: { x: 12, y: 3 } })
        const confirm = button('Fire at goblin')
        await expect(confirm).toBeVisible()
        expect(await confirm.boundingBox()).toEqual(fire)
        await expect(button('Northwest')).toBeVisible()
        await expect(button('Esc')).toBeVisible()
        await expect(button('Next target')).toBeVisible()
        await tapFire()
        await expect.poll(sent).toEqual([...before, shot, shot])
        await receive({ msg: 'cursor', id: 0 })
        await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
        await expect(button('Fire')).toBeVisible()
      }
      const edit = button('Edit touch layout')
      const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
      const assignFire = async () => {
        await edit.tap()
        await dialog.getByRole('button', { name: 'Top left, Skills' }).tap()
        await dialog.getByRole('searchbox').fill('Fire')
        await dialog.getByRole('button', { name: 'Fire f', exact: true }).tap()
        await dialog.getByRole('button', { name: 'Save layout' }).tap()
      }
      await assignFire()
      await fireTwice()
      if (wide) {
        await page.getByRole('button', { name: 'Dungeon minimap, open level map' }).tap()
        await expect.poll(sent).toContainEqual({ msg: 'input', text: 'X' })
        await receive({ msg: 'ui_state', state: UiState.VIEW_MAP })
        for (const name of ['Northwest', 'Find…', 'Find down', 'Zoom in', 'Zoom out', 'Descend']) await expect(button(name)).toBeVisible()
        await receive({ msg: 'ui_state', state: UiState.NORMAL })
        await expect(button('Northwest')).toBeVisible()
        await page.setViewportSize({ width: 800, height: 1080 })
        await expect(page.locator('.hud.mobile-dungeon')).not.toHaveClass(/mobile-landscape/)
        await expect(button('Northwest')).toBeVisible()
        await fireTwice()
      }
      const short = portrait ? { width: 320, height: 560 } : { width: 740, height: 265 }
      await page.setViewportSize(short)
      const dimension = portrait ? 'width' : 'height'
      await expect.poll(async () => (await dungeon.boundingBox())![dimension]).toBe(short[dimension])
      await edit.tap()
      await dialog.getByRole('button', { name: 'Restore defaults' }).tap()
      await dialog.getByRole('button', { name: 'Save layout' }).tap()
      await fit(short.width, short.height)
      if (portrait) {
        await assignFire()
        await fireTwice()
      }

      const beforeMove = await sent()
      const diagonals = [['Northwest', 'y'], ['Northeast', 'u'], ['Southwest', 'b'], ['Southeast', 'n']]
      for (const [name] of diagonals) await button(name).tap()
      await expect.poll(sent).toEqual([...beforeMove, ...diagonals.map(([, text]) => ({ msg: 'input', text }))])
      if (!portrait) {
        await button('Gear').tap()
        await expect.poll(sent).toContainEqual({ msg: 'input', text: 'i' })
        await page.evaluate(() => window.__orbrunMapLifecycle.receive({
          msg: 'menu', tag: 'inventory', flags: 0, title: { text: 'Inventory' },
          items: [{ text: 'a +0 long sword', hotkeys: [97], quantity: 1 }],
        }))
        const esc = page.locator('.touchbar.context-controls').getByRole('button', { name: 'Esc', exact: true })
        await esc.tap()
        await expect.poll(sent).toContainEqual({ msg: 'key', keycode: 27 })
        return
      }
      const hold = async (name: string, ms: number, end: 'touchEnd' | 'touchCancel' = 'touchEnd') => {
        const box = (await button(name).boundingBox())!
        await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
        await page.clock.runFor(ms)
        await device.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] })
      }
      const beforeWait = await sent()
      await hold('Wait', 150, 'touchCancel')
      expect(await sent()).toEqual(beforeWait)
      await button('Wait').tap()
      await expect.poll(sent).toContainEqual({ msg: 'input', text: '.' })
      await hold('Wait', 500)
      await expect.poll(sent).toContainEqual({ msg: 'key', keycode: Keys.CK_SHIFT_CLEAR })
      expect((await sent()).slice(beforeWait.length)).toEqual([{ msg: 'input', text: '.' }, { msg: 'key', keycode: Keys.CK_SHIFT_CLEAR }])
      const beforeHold = (await sent()).length
      await hold('Southeast', 650)
      const afterHold = await sent()
      expect(afterHold.length - beforeHold).toBeGreaterThan(1)
      expect(afterHold.slice(beforeHold)).toEqual(Array.from({ length: afterHold.length - beforeHold }, () => ({ msg: 'input', text: 'n' })))
      await page.clock.runFor(450)
      expect(await sent()).toEqual(afterHold)
    })

    if (portrait) test('keeps the same tile size when the touch HUD resizes the canvas', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 530 })
      await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ depthTilt: 65 })))
      await page.goto('/testbed/map-lifecycle.html?mobile-hud')
      await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
      await page.evaluate(() => window.__orbrunMapLifecycle.ready())
      const view = page.locator('canvas.view')
      const controls = page.locator('.touchbar.split')
      const stats = page.locator('.hud .stats .line').first()
      const tileSize = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().tileSize!)
      await expect(stats).toBeVisible()
      await expect(controls).toBeVisible()
      const initial = (await view.boundingBox())!.height
      const scale = await tileSize()
      await page.keyboard.press('ArrowUp')
      await expect(controls).toBeHidden()
      await expect.poll(async () => (await view.boundingBox())!.height).toBeGreaterThan(initial)
      expect(await tileSize()).toBeCloseTo(scale, 8)
      await stats.tap()
      await expect(controls).toBeVisible()
      await expect.poll(async () => (await view.boundingBox())!.height).toBe(initial)
      expect(await tileSize()).toBeCloseTo(scale, 8)
    })

    test('keeps spells within thumb reach and uses Crawl’s prompts to cast', portrait ? smoke : {}, async ({ page }) => {
      const device = await page.context().newCDPSession(page)
      await device.send('Emulation.setSafeAreaInsetsOverride', { insets })
      await page.clock.install()
      await page.goto('/testbed/map-lifecycle.html?mobile-hud&spells')
      await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
      await page.evaluate(() => window.__orbrunMapLifecycle.ready())
      const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
      const receive = (msg: ServerMessage) => page.evaluate(msg => window.__orbrunMapLifecycle.receive(msg), msg)
      await expect.poll(sent).toEqual([{ msg: 'input', text: 'I' }])

      const wait = (await page.getByRole('button', { name: 'Wait', exact: true }).boundingBox())!
      await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: wait.x + wait.width / 2, y: wait.y + wait.height / 2 }] })
      await page.clock.runFor(475)
      await expect.poll(sent).toEqual([{ msg: 'input', text: 'I' }])
      const showSpellbook = () => page.evaluate(() => window.__orbrunMapLifecycle.showSpellbook())
      await showSpellbook()
      await receive({ msg: 'close_menu' })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
      const rest = { msg: 'key', keycode: Keys.CK_SHIFT_CLEAR }
      await expect.poll(sent).toEqual([{ msg: 'input', text: 'I' }, { msg: 'key', keycode: 27 }, rest])
      await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      expect((await sent()).at(-1)).toEqual(rest)
      expect((await sent()).length).toBe(3)

      const rail = page.getByRole('group', { name: 'Spell shortcuts' })
      const book = rail.getByRole('button', { name: 'Spellbook' })
      await expect(rail.getByRole('button')).toHaveCount(9)
      await expect(rail.getByRole('button', { name: /Foxfire/ })).toBeVisible()
      await expect(book).toBeVisible()
      const cog = page.getByRole('button', { name: 'Open system menu', exact: true })
      await expect(cog).toBeVisible()
      const order = async (short = false) => {
        const shortcuts = (await rail.boundingBox())!
        const sheet = (await page.locator('.hud .stats').boundingBox())!
        const compass = (await page.locator('.touchbar.split').boundingBox())!
        const map = (await page.locator('.touchbar.split').getByRole('button', { name: 'Map', exact: true }).boundingBox())!
        expect(shortcuts.height).toBeGreaterThanOrEqual(44)
        expect(shortcuts.x + shortcuts.width).toBeLessThanOrEqual((await page.viewportSize())!.width - insets.right)
        if (portrait) {
          const log = (await page.locator('.hud .messages').boundingBox())!
          expect(log.y + log.height).toBeLessThanOrEqual(shortcuts.y + 1)
          expect(shortcuts.y + shortcuts.height).toBeLessThanOrEqual(sheet.y)
          expect(sheet.y + sheet.height).toBeLessThan(compass.y)
        } else {
          const monsters = (await page.locator('.hud .monsters').boundingBox())!
          expect(monsters.y + monsters.height).toBeLessThanOrEqual(shortcuts.y)
          if (short) {
            const esc = (await page.locator('.touchbar.split').getByRole('button', { name: 'Esc', exact: true }).boundingBox())!
            const vitals = (await page.locator('.hud .stats .line:has(.stat-bar)').boundingBox())!
            expect(shortcuts.y).toBeCloseTo(esc.y)
            expect(shortcuts.x + shortcuts.width).toBeLessThan(map.x)
            expect(map.y).toBeCloseTo(esc.y)
            expect(map.x + map.width).toBeLessThan(esc.x)
            expect(vitals.y + vitals.height).toBeLessThan(sheet.y + sheet.height)
          } else {
            expect(shortcuts.x).toBeCloseTo(sheet.x)
            expect(shortcuts.y + shortcuts.height).toBeLessThan(compass.y)
          }
        }
      }
      await order()
      await page.evaluate(() => document.fonts.ready)
      await page.setViewportSize(portrait ? { width: 320, height: 560 } : { width: 740, height: 265 })
      await expect.poll(async () => {
        const box = (await page.locator('.touchbar.split').boundingBox())!
        return Math.round(box.x + box.width)
      }).toBe((portrait ? 320 : 740) - insets.right - 8)
      await expect.poll(async () => {
        const box = (await rail.boundingBox())!
        return box.x + box.width
      }).toBeLessThanOrEqual((portrait ? 320 : 740) - insets.right)
      await order(true)

      const track = rail.locator('.spell-track')
      const trackBox = (await track.boundingBox())!
      const bookBox = await book.boundingBox()
      const x = trackBox.x + trackBox.width - 15, y = trackBox.y + trackBox.height / 2
      await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      for (let i = 1; i <= 5; i++) {
        await device.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 24 * i, y }] })
      }
      await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(() => track.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
      expect(await book.boundingBox()).toEqual(bookBox)
      expect((await sent()).at(-1)).toEqual(rest)
      await track.evaluate(el => { el.scrollLeft = 0 })

      await rail.getByRole('button', { name: /Foxfire/ }).tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'z' })
      await receive({ msg: 'msgs', messages: [{ text: 'Cast which spell? (? or * to list)', channel: MSGCH.PROMPT }] })
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'a' })
      await receive({ msg: 'msgs', messages: [{ text: 'You conjure some foxfire!' }] })
      await receive({ msg: 'player', turn: 382, mp: 4 })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
      await expect(book).toBeEnabled()

      const dart = rail.getByRole('button', { name: /Magic Dart/ })
      await dart.tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'z' })
      await receive({ msg: 'msgs', messages: [{ text: 'Cast which spell? (? or * to list)', channel: MSGCH.PROMPT }] })
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'b' })
      await receive({ msg: 'input_mode', mode: MouseMode.TARGET })
      await expect(dart).toHaveAttribute('aria-current', 'true')
      await expect(book).toBeDisabled()
      await dart.tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'f' })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })

      await book.tap()
      await expect.poll(async () => (await sent()).at(-1)).toEqual({ msg: 'input', text: 'I' })
      await showSpellbook()
      await expect(page.getByText('Your spells (describe)', { exact: true })).toBeVisible()
      const menuControls = page.locator('.touchbar.context-controls')
      const [up, left, down, right] = await Promise.all(['Previous', 'Left', 'Next', 'Right'].map(async name => {
        const arrow = menuControls.getByRole('button', { name, exact: true })
        await expect(arrow).toBeInViewport({ ratio: 1 })
        return (await arrow.boundingBox())!
      }))
      expect(up.x).toBe(down.x)
      expect(up.y + up.height).toBeLessThan(down.y)
      expect(left.y).toBe(down.y)
      expect(right.y).toBe(down.y)
      expect(left.x + left.width).toBeLessThan(down.x)
      expect(down.x + down.width).toBeLessThan(right.x)
      await receive({ msg: 'close_menu' })
      await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
      const beforeMenu = await sent()
      await page.locator('.hud .stats .line').first().tap()
      const system = page.getByRole('tab', { name: 'System', exact: true })
      await expect(system).toBeHidden()
      await cog.tap()
      await system.tap()
      await page.getByRole('button', { name: 'Settings', exact: true }).tap()
      await expect(page.getByText('Polished Crawl settings', { exact: true })).toBeVisible()
      expect(await sent()).toEqual(beforeMenu)
    })
  })
}
