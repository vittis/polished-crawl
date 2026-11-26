import { expect, type Locator } from '@playwright/test'
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

  test('uses default and saved hold actions once, and cancels without tapping', smoke, async ({ page }) => {
    await page.clock.install()
    const device = await page.context().newCDPSession(page)
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    const deck = page.locator('.touchbar.command-deck')
    const tile = (name: string) => deck.getByRole('button', { name, exact: true })
    const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
    const mapState = (state: typeof UiState.NORMAL | typeof UiState.VIEW_MAP) => page.evaluate(state => window.__orbrunMapLifecycle.receive({ msg: 'ui_state', state }), state)
    const press = async (button: Locator) => {
      const box = (await button.boundingBox())!
      await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
    }
    const release = (type: 'touchEnd' | 'touchCancel' = 'touchEnd') => device.send('Input.dispatchTouchEvent', { type, touchPoints: [] })
    const explore = tile('Explore')
    const map = { msg: 'input', text: 'X' }
    await expect(explore).toHaveAccessibleDescription('Hold for Map')
    await explore.tap()
    const autoExplore = { msg: 'input', text: 'o' }
    expect(await sent()).toEqual([autoExplore])
    await press(explore)
    await page.clock.runFor(500)
    expect(await sent()).toEqual([autoExplore, map])
    await mapState(UiState.VIEW_MAP)
    await expect(page.locator('.touchbar.split').getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await release()
    expect(await sent()).toEqual([autoExplore, map])
    await mapState(UiState.NORMAL)

    await tile('Edit touch layout').tap()
    const editor = page.getByRole('dialog', { name: 'Edit touch layout' })
    const button = (name: string) => editor.getByRole('button', { name, exact: true })
    await button('Top left, Skills').tap()
    await button('Hold action').tap()
    await page.setViewportSize({ width: 740, height: 265 })
    await editor.getByRole('searchbox').fill('Rest')
    await editor.getByRole('button', { name: /^Rest\b/ }).tap()
    await page.setViewportSize({ width: 390, height: 735 })
    await expect(button('Top left, Skills')).toHaveAccessibleDescription('Hold for Rest')
    await button('Bottom left, Explore').tap()
    await button('No hold action').tap()
    await button('Save as preset…').tap()
    await editor.getByRole('textbox', { name: 'Preset name' }).fill('Hold shortcuts')
    await button('Save preset').tap()
    const presets = editor.getByRole('combobox', { name: 'Layout preset' })
    await presets.selectOption('Default')
    await presets.selectOption({ label: 'Hold shortcuts' })
    await button('Save layout').tap()

    await page.reload()
    await expect(explore).not.toHaveAccessibleDescription('Hold for Map')
    const skills = tile('Skills')
    await expect(skills).toHaveAccessibleDescription('Hold for Rest')
    await press(skills)
    await release('touchCancel')
    await page.clock.runFor(500)
    expect(await sent()).toEqual([])
    await press(skills)
    await page.clock.runFor(500)
    const rest = { msg: 'key', keycode: Keys.CK_SHIFT_CLEAR }
    expect(await sent()).toEqual([rest])
    await release()
    expect(await sent()).toEqual([rest])
  })

  test('maximum control height persists and the size preview matches the deck in both orientations', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?preview-touch&spells')
    const controls = page.locator('.touchbar.split')
    const button = (name: string) => controls.getByRole('button', { name, exact: true })
    await expect(button('Northwest')).toHaveCSS('height', '44px')
    await openHudSettings(page)
    const step = page.getByRole('button', { name: 'Button height next', exact: true })
    await page.getByRole('slider', { name: 'Button height' }).fill('99')
    await step.tap()
    await expect(page.getByRole('slider', { name: 'Button height' })).toHaveAttribute('aria-valuetext', '200%')
    await page.reload()
    for (const viewport of [{ width: 405, height: 803 }, { width: 944, height: 481 }, { width: 740, height: 240 }]) {
      await page.setViewportSize(viewport)
      if (viewport.width > viewport.height) await expect(controls).toHaveClass(/landscape/)
      const short = viewport.height === 240
      await expect.poll(async () => (await button('Northwest').boundingBox())?.height).toBe(short ? 44 : 88)
      const compass = (await button('Northwest').boundingBox())!
      const skills = (await button('Skills').boundingBox())!
      const fight = (await button('Fight').boundingBox())!
      expect(skills.height).toBe(compass.height)
      expect(skills.y).toBe(compass.y)
      expect(fight.height).toBe(2 * skills.height + 4)
      expect(fight.y + fight.height).toBeLessThanOrEqual(viewport.height)

      await button('Edit touch layout').tap()
      const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
      await dialog.getByRole('tab', { name: 'Control size' }).tap()
      await expect(dialog.getByRole('slider', { name: 'Button height' })).toHaveAttribute('aria-valuetext', '200%')
      const small = (await dialog.locator('.movement-bank i').first().boundingBox())!
      const large = (await dialog.locator('.size-bank:not(.movement-bank) i').last().boundingBox())!
      const scale = small.width / compass.width
      expect(small.height).toBeCloseTo(compass.height * scale, 0)
      expect(large.width).toBeCloseTo(fight.width * scale, 0)
      expect(large.height).toBeCloseTo(fight.height * scale, 0)
      await dialog.getByRole('button', { name: 'Cancel changes' }).tap()
    }
  })

  test('swaps the D-pad and action grid in the preview and saves their positions across rotation', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    const controls = page.locator('.touchbar.command-deck')
    const button = (name: string) => controls.getByRole('button', { name, exact: true })
    const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
    const openSize = async () => {
      await button('Edit touch layout').tap()
      await dialog.getByRole('tab', { name: 'Control size' }).tap()
    }
    const swap = dialog.getByRole('checkbox', { name: 'Swap D-pad and actions' })
    const save = dialog.getByRole('button', { name: 'Save layout' })
    const order = () => controls.getByRole('button', { name: /^(Northwest|Northeast|Skills|Esc)$/ }).evaluateAll(buttons => {
      const bounds = new Map(buttons.map(el => [el.getAttribute('aria-label'), el.getBoundingClientRect()]))
      const nw = bounds.get('Northwest'), ne = bounds.get('Northeast')
      const skills = bounds.get('Skills'), esc = bounds.get('Esc')
      if (!nw || !ne || !skills || !esc) return null
      return {
        movementOrdered: nw.left < ne.left,
        actionsOrdered: skills.left < esc.left,
        actionsOnLeft: esc.right <= nw.left,
        movementOnLeft: ne.right <= skills.left,
      }
    })
    const expectOrder = (swapped: boolean) => expect.poll(order).toEqual({
      movementOrdered: true, actionsOrdered: true, actionsOnLeft: swapped, movementOnLeft: !swapped,
    })
    await openSize()
    await expect(swap).not.toBeChecked()
    await swap.check()
    const movement = (await dialog.locator('.movement-bank').boundingBox())!
    const actions = (await dialog.locator('.size-bank:not(.movement-bank)').boundingBox())!
    expect(actions.x + actions.width).toBeLessThanOrEqual(movement.x)
    expect(actions.y).toBe(movement.y)
    await dialog.getByRole('button', { name: 'Cancel changes' }).tap()
    await expectOrder(false)
    await openSize()
    await expect(swap).not.toBeChecked()
    await swap.check()
    await save.tap()
    await expectOrder(true)
    await page.setViewportSize({ width: 979, height: 883 })
    await page.reload()
    await expectOrder(true)
    await button('Northwest').tap()
    await button('Gear').tap()
    await expect.poll(async () => (await result(page)).sent.slice(-2)).toEqual([
      { msg: 'input', text: 'y' }, { msg: 'input', text: 'i' },
    ])
    await openSize()
    await expect(swap).toBeChecked()
    await dialog.getByRole('button', { name: 'Reset size' }).tap()
    await expect(swap).not.toBeChecked()
    await save.tap()
    await expectOrder(false)
  })

  test('shares control size between the editor and Interface settings across rotation', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    const controls = page.locator('.touchbar.command-deck')
    const edit = controls.getByRole('button', { name: 'Edit touch layout' })
    const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
    const size = dialog.getByRole('tab', { name: 'Control size' })
    const movement = 'D-pad width', actions = 'Action grid width', height = 'Button height'
    const slider = (name: string) => dialog.getByRole('slider', { name, exact: true })
    const openSize = async () => { await edit.tap(); await size.tap() }
    const save = () => dialog.getByRole('button', { name: 'Save layout' }).tap()
    const widths = async () => {
      const rect = async (name: string) => (await controls.getByRole('button', { name, exact: true }).boundingBox())!
      const nw = await rect('Northwest'), ne = await rect('Northeast'), skills = await rect('Skills'), esc = await rect('Esc')
      return { movement: ne.x + ne.width - nw.x, actions: esc.x + esc.width - skills.x }
    }
    await openSize()
    await slider(movement).fill('30')
    await slider(actions).fill('77')
    await slider(height).fill('1')
    await dialog.getByRole('button', { name: 'Cancel changes' }).tap()
    await openSize()
    for (const name of [movement, actions]) await expect(slider(name)).toHaveAttribute('aria-valuetext', 'Auto')
    await expect(slider(height)).toHaveAttribute('aria-valuetext', '100%')
    // Values need not sum to 100. Here 51:34 normalizes to 60:40.
    await slider(movement).fill('51')
    await slider(actions).fill('34')
    await slider(height).fill('26')
    await expect(dialog.getByText('Movement · 60%', { exact: true })).toBeVisible()
    await save()
    await expect.poll(async () => { const w = await widths(); return w.movement / w.actions }).toBeCloseTo(1.5, 2)
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(controls).toHaveClass(/landscape/)
    const before = await widths()
    await openSize()
    await slider(movement).fill('52')
    await save()
    const moved = await widths()
    expect(moved.movement).toBeGreaterThan(before.movement)
    expect(moved.actions).toBeCloseTo(before.actions, 2)
    // Open with touch so switching input devices cannot move the panel during the first adjustment.
    await page.getByRole('button', { name: 'Open system menu', exact: true }).tap()
    await page.getByRole('tab', { name: 'System', exact: true }).tap()
    await page.getByRole('button', { name: 'Settings', exact: true }).tap()
    await page.getByRole('button', { name: 'Interface', exact: true }).tap()
    const settings = page.getByRole('dialog', { name: 'Interface settings' })
    const actionWidth = settings.getByRole('slider', { name: actions, exact: true })
    const buttonHeight = settings.getByRole('slider', { name: height, exact: true })
    await expect(actionWidth).toHaveAttribute('aria-valuetext', '34%')
    await expect(buttonHeight).toHaveAttribute('aria-valuetext', '126%')
    await settings.getByRole('button', { name: actions + ' next', exact: true }).tap()
    await expect(actionWidth).toHaveAttribute('aria-valuetext', '35%')
    await settings.getByRole('button', { name: height + ' next', exact: true }).tap()
    await expect(buttonHeight).toHaveAttribute('aria-valuetext', '127%')
    await page.reload()
    const resized = await widths()
    expect(resized.movement).toBeCloseTo(moved.movement, 2)
    expect(resized.actions).toBeGreaterThan(moved.actions)
    await openSize()
    await expect(slider(movement)).toHaveAttribute('aria-valuetext', '52%')
    await expect(slider(actions)).toHaveAttribute('aria-valuetext', '35%')
    await expect(slider(height)).toHaveAttribute('aria-valuetext', '127%')
    await dialog.getByRole('button', { name: 'Reset size' }).tap()
    for (const name of [movement, actions]) await expect(slider(name)).toHaveAttribute('aria-valuetext', 'Auto')
    await dialog.getByRole('tab', { name: 'Edit tiles' }).tap()
    await expect(dialog.getByRole('button', { name: 'Save as preset…' })).toBeHidden()
  })

  test('keeps Fire and Autofire in sync with the quiver across gameplay and the editor', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('orbrun.touch-layout.v1', JSON.stringify({
      arrangement: 'grid',
      slots: ['CMD_LOOK_AROUND', 'CMD_FIRE', 'CMD_AUTOFIRE', 'escape', 'CMD_DISPLAY_MAP', 'gear',
        'CMD_DISPLAY_SKILLS', 'CMD_AUTOFIGHT', 'CMD_EXPLORE', 'CMD_FULL_VIEW', 'spells', 'CMD_INTERLEVEL_TRAVEL'],
    })))
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    await page.getByRole('button', { name: 'Edit touch layout' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
    const compare = () => page.evaluate(() => {
      const picture = (el: Element) => {
        const icon = el.querySelector('.shortcut-icon')
        return icon ? getComputedStyle(icon).backgroundPosition : el.querySelector('canvas')?.toDataURL()
      }
      const tiles = Array.from(document.querySelectorAll('.layout-preview button'))
      const hud = Array.from(document.querySelectorAll('.command-deck [data-cell^="slot"]'))
      const mismatches: string[] = []
      for (const tile of hud) {
        const name = tile.querySelector('.label')!.textContent!
        const preview = tiles.find(btn => btn.querySelector('.label')?.textContent === name)
        const icon = picture(tile)
        if (!preview || !icon || picture(preview) !== icon) mismatches.push(name)
      }
      return { count: hud.length, mismatches }
    })
    await expect.poll(compare).toEqual({ count: 12, mismatches: [] })
    const fire = dialog.getByRole('button', { name: 'Top middle left, Fire' })
    const autofire = dialog.getByRole('button', { name: 'Top middle right, Autofire' })
    const pixels = (button: Locator) => button.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
    const net = await pixels(fire)
    expect(await pixels(autofire)).toBe(net)
    await expect(page.locator('.command-deck [data-cell="slot3"] .count')).toHaveText('3')
    await dialog.getByRole('searchbox').fill('Fire')
    const fireOption = dialog.getByRole('button', { name: 'Fire Swap', exact: true })
    const autofireOption = dialog.getByRole('button', { name: 'Autofire Swap', exact: true })
    expect(await pixels(fireOption)).toBe(net)
    expect(await pixels(autofireOption)).toBe(net)
    await page.evaluate(() => window.__orbrunMapLifecycle.receive({
      msg: 'player', quiver_item: -1, quiver_desc: 'Cast: <lightmagenta>Magic Dart</lightmagenta>',
    }))
    await expect.poll(() => pixels(fire)).not.toBe(net)
    const spell = await pixels(fire)
    await expect.poll(compare).toEqual({ count: 12, mismatches: [] })
    expect(await pixels(autofire)).toBe(spell)
    expect(await pixels(fireOption)).toBe(spell)
    expect(await pixels(autofireOption)).toBe(spell)
    await expect(page.locator('.command-deck [data-cell="slot3"] .count')).toHaveCount(0)

    await page.evaluate(() => window.__orbrunMapLifecycle.receive({
      msg: 'player', quiver_item: -1, quiver_desc: 'Nothing quivered',
    }))
    await expect(autofireOption.locator('.shortcut-icon')).toBeVisible()
    const fallback = await autofireOption.locator('.shortcut-icon').evaluate(icon => getComputedStyle(icon).backgroundPosition)
    await expect(autofire.locator('.shortcut-icon')).toHaveCSS('background-position', fallback)
    await expect.poll(compare).toEqual({ count: 12, mismatches: [] })
    await dialog.getByRole('button', { name: 'Cancel changes' }).tap()
    await page.locator('.command-deck').getByRole('button', { name: 'Autofire', exact: true }).tap()
    expect(await page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)).toEqual([{ msg: 'key', keycode: Keys.CK_SHIFT_TAB }])
  })

  test('can hide the layout editor button and restore it through Interface settings', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    const edit = page.getByRole('button', { name: 'Edit touch layout' })
    const toggle = page.getByRole('button', { name: 'Hide in-game editor button next', exact: true })
    await expect(edit).toBeVisible()
    await openHudSettings(page)
    await toggle.tap()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Northwest' })).toBeVisible()
    await expect(edit).toBeHidden()
    await openHudSettings(page)
    const settings = page.getByRole('dialog', { name: 'Interface settings' })
    const open = settings.getByRole('button', { name: 'Edit touch layout', exact: true })
    await open.tap()
    const editor = page.getByRole('dialog', { name: 'Edit touch layout' })
    await editor.getByRole('combobox', { name: 'Layout preset' }).selectOption('Ranged')
    await editor.getByRole('tab', { name: 'Control size' }).tap()
    await editor.getByRole('slider', { name: 'Button height' }).fill('15')
    await editor.getByRole('button', { name: 'Save layout' }).tap()
    await expect(open).toBeFocused()
    await expect(settings.getByRole('slider', { name: 'Button height' })).toHaveAttribute('aria-valuetext', '115%')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Autofire', exact: true })).toBeVisible()
    await expect(edit).toBeHidden()
    await openHudSettings(page)
    await toggle.tap()
    await page.reload()
    await edit.tap()
    await expect(page.getByRole('dialog', { name: 'Edit touch layout' })).toBeVisible()
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
    for (const [name, primary] of [['Melee brute', 'Fight'], ['Spellcaster', 'Spells'], ['Ranged', 'Autofire'], ['Thrower', 'Throw item']]) {
      await select.selectOption(name)
      await expect(button('Bottom right, ' + primary)).toBeVisible()
      await expect(button('Save as preset…')).toBeHidden()
    }
    await dialog.getByRole('searchbox').fill('gold')
    await dialog.getByRole('button', { name: /^Show gold/ }).tap()
    await expect(button('Top left, Show gold')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Show gold Selected' })).toBeDisabled()
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
    await expect(select).toHaveValue('personal:Javelins')
    await expect(button('Save as preset…')).toBeHidden()
    await button('Cancel changes').tap()
    await expect(hud.getByRole('button', { name: 'Show gold' })).toBeVisible()
    await page.reload()
    await edit.tap()
    await select.selectOption({ label: 'Javelins' })
    await expect(button('Top middle left, Find down')).toBeVisible()
    await button('Save layout').tap()
    await hud.getByRole('button', { name: 'Throw item' }).tap()
    await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'input', text: 'F' })
  })

  test('retains split tile assignments, saves the arrangement and deletes only personal presets', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?preview-touch')
    const controls = page.locator('.touchbar.command-deck')
    const edit = controls.getByRole('button', { name: 'Edit touch layout' })
    const dialog = page.getByRole('dialog', { name: 'Edit touch layout' })
    const button = (name: string) => dialog.getByRole('button', { name, exact: true })
    const select = dialog.getByRole('combobox', { name: 'Layout preset' })
    const slots = dialog.getByRole('group', { name: 'Button positions' }).getByRole('button')
    const remove = button('Delete saved preset')
    await edit.tap()
    await expect(remove).toBeHidden()
    for (const [shape, count] of [['Two large', 6], ['All small', 12], ['Large left', 9], ['Large right', 9]] as const) {
      await button(shape).tap()
      await expect(slots).toHaveCount(count)
    }
    await slots.getByText('Quaff', { exact: true }).tap()
    await dialog.getByRole('searchbox').fill('find down')
    await button('Find down >').tap()
    await button('Two large').tap()
    await button('Large right').tap()
    await expect(slots.getByText('Find down')).toBeVisible()
    await button('Save as preset…').tap()
    await dialog.getByRole('textbox', { name: 'Preset name' }).fill('One large')
    await button('Save preset').tap()
    await button('Save layout').tap()
    await page.reload()
    const primary = controls.getByRole('button', { name: 'Fight', exact: true })
    for (const size of [{ width: 390, height: 735 }, { width: 740, height: 320 }]) {
      await page.setViewportSize(size)
      await expect(controls.locator('.primary-slot')).toHaveCount(1)
      const big = (await primary.boundingBox())!
      const small = (await controls.getByRole('button', { name: 'Explore', exact: true }).boundingBox())!
      expect(big.height).toBeGreaterThanOrEqual(2 * small.height)
      expect(big.x).toBeGreaterThan(small.x)
    }
    await edit.tap()
    await select.selectOption('Thrower')
    await expect(remove).toBeHidden()
    await select.selectOption({ label: 'One large' })
    await expect(button('Large right')).toHaveAttribute('aria-pressed', 'true')
    page.once('dialog', d => d.dismiss())
    await remove.click()
    await expect(select).toHaveValue('personal:One large')
    page.once('dialog', d => d.accept())
    await remove.click()
    await expect(select.getByRole('option', { name: 'One large' })).toHaveCount(0)
    await expect(slots.getByText('Find down')).toBeVisible()
    await page.reload()
    await edit.tap()
    await expect(select.getByRole('option', { name: 'One large' })).toHaveCount(0)
    await expect(button('Large right')).toHaveAttribute('aria-pressed', 'true')
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

test.describe('tablet contextual action', () => {
  const viewport = { width: 979, height: 883 }
  test.use({ viewport, screen: viewport, isMobile: true, hasTouch: true })

  test('stacks chat and the underfoot action above spells while the item is present', async ({ page }) => {
    await page.goto('/testbed/map-lifecycle.html?preview-touch&spells')
    const receive = (msg: ServerMessage) => page.evaluate(msg => window.__orbrunMapLifecycle.receive(msg), msg)
    await expect.poll(async () => (await result(page)).sent).toContainEqual({ msg: 'input', text: 'I' })
    await page.evaluate(() => window.__orbrunMapLifecycle.showSpellbook())
    await receive({ msg: 'close_menu' })
    await receive({ msg: 'input_mode', mode: MouseMode.COMMAND })
    const spells = page.getByRole('group', { name: 'Spell shortcuts' })
    await expect(spells).toBeVisible()
    const tab = page.getByRole('link', { name: 'Show chat' })
    const start = (await tab.boundingBox())!
    const rail = (await spells.boundingBox())!
    await receive({ msg: 'msgs', messages: [{ text: 'You see here a quill talisman.', channel: MSGCH.FLOOR_ITEMS, turn: 381 }] })
    const interact = page.getByRole('button', { name: /quill talisman/i })
    await expect(interact).toBeVisible()
    const item = (await interact.boundingBox())!
    expect(item.x + item.width).toBeCloseTo(rail.x + rail.width, 0)
    expect(item.y + item.height).toBeCloseTo(rail.y - 4, 0)
    expect((await tab.boundingBox())!.y).toBeCloseTo(start.y - item.height - 4, 0)
    await tab.tap()
    await expect(page.locator('.chat')).toBeVisible()
    const chat = (await page.locator('.chat').boundingBox())!
    expect(chat.y + chat.height).toBeLessThan(item.y)
    await receive({ msg: 'player', turn: 382, inv: { 3: { quantity: 1, name: 'quill talisman' } } })
    await expect(interact).toBeHidden()
    await expect(spells).toBeVisible()
    expect((await spells.boundingBox())!.y).toBe(rail.y)
    await page.locator('.chat_hide_button').tap()
    await expect(tab).toBeVisible()
    expect((await tab.boundingBox())!.y).toBe(start.y)
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
    const edit = (await controls.getByRole('button', { name: 'Edit touch layout' }).boundingBox())!
    expect(badge.x + badge.width).toBeLessThan(edit.x)
    expect(edit.x + edit.width).toBeLessThan(commands.x)
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
  const viewport = { width: 806, height: 883 }
  test.use({ viewport, screen: viewport, hasTouch: true, isMobile: true, userAgent: androidUserAgent })

  test('swipes through every item without using one and keeps the menu in place', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/testbed/map-lifecycle.html?mobile-hud&action-panel')
    await expect(page.getByText('Loading game data…', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      window.__orbrunMapLifecycle.ready()
      const inv = Object.fromEntries(Array.from({ length: 20 }, (_, slot) => [slot, {
        name: 'item ' + slot, quantity: 1, action_panel_order: slot, tile: 1234,
      }]))
      window.__orbrunMapLifecycle.receive({ msg: 'player', inv })
    })
    await page.getByTitle('Show the action panel').tap()
    const track = page.locator('.panel-track')
    const menu = page.locator('.panel-menu')
    await expect(track).toBeVisible()
    await expect(menu).toBeVisible()
    const fixed = await menu.boundingBox()
    const box = (await track.boundingBox())!
    const y = box.y + box.height / 2
    const device = await page.context().newCDPSession(page)
    const sent = () => page.evaluate(() => window.__orbrunMapLifecycle.snapshot().sent)
    const before = await sent()
    const start = box.x + box.width - 8
    await device.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] })
    for (let dx = 24; dx < box.width - 8; dx += 24) {
      await device.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start - dx, y }] })
    }
    await device.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => track.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    await track.hover()
    await page.mouse.wheel(0, 1000)
    await expect.poll(() => track.evaluate(el => el.scrollWidth - el.clientWidth - el.scrollLeft)).toBeLessThan(1)
    expect(await menu.boundingBox()).toEqual(fixed)
    expect(await sent()).toEqual(before)
    await page.touchscreen.tap(box.x + box.width - 8, y)
    await expect.poll(sent).toEqual([...before, { msg: 'inv_item_action', slot: 19 }])
  })

  test('stacks the action panel, minimap and nearby monsters at the upper left in portrait', async ({ page }) => {
    const device = await page.context().newCDPSession(page)
    await device.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 8, top: 12 } })
    await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ minimapAlignment: 'Right' })))
    await page.goto('/testbed/map-lifecycle.html?mobile-hud&action-panel')
    const actions = page.locator('.action-panel')
    const icons = page.locator('.action-panel:not(.minimized)')
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
      const monster = page.locator('.hud .monsters .group').first()
      await expect(monster).toBeInViewport()
      const row = (await monster.boundingBox())!
      expect(row.x).toBeCloseTo(minimap.x, 0)
      expect(row.y).toBeGreaterThanOrEqual(minimap.y + minimap.height)
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
    await expect(caption).toBeHidden()
    await page.getByRole('link', { name: 'Show chat' }).tap()
    await expect(caption).toBeVisible()
    await expect(caption).toContainText('0 spectators')
    const expand = page.getByTitle('Show the action panel')
    await expand.tap()
    const panel = page.locator('.action-panel:not(.minimized)')
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
      const lastMessage = log.getByText('A bat comes into view.', { exact: true })
      await expect(lastMessage).toBeVisible()
      if (portrait) {
        const name = stats.getByText('Mara the Slasher', { exact: true })
        expect((await lastMessage.boundingBox())!.x).toBeCloseTo((await name.boundingBox())!.x, 0)
      }
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
        const panel = page.locator('.action-panel:not(.minimized)')
        const chat = page.locator('.chat .chat_head')
        await expect(panel).toBeVisible()
        await expect(chat).toBeHidden()
        const showChat = page.getByRole('link', { name: 'Show chat' })
        await showChat.tap()
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
      if (wide) await page.addInitScript(() => localStorage.setItem('orbrun.settings', JSON.stringify({ touchActionsWidth: 64 })))
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
      await expect(rail).toHaveText('')
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
            const actions = (await page.locator('.command-deck').getByRole('button', { name: 'Skills', exact: true }).boundingBox())!
            const esc = (await page.locator('.command-deck').getByRole('button', { name: 'Esc', exact: true }).boundingBox())!
            expect(shortcuts.x).toBeCloseTo(actions.x, 0)
            expect(shortcuts.x + shortcuts.width).toBeCloseTo(esc.x + esc.width, 0)
            expect(shortcuts.y + shortcuts.height).toBeLessThan(compass.y)
            const edit = (await page.getByRole('button', { name: 'Edit touch layout' }).boundingBox())!
            expect(edit.y + edit.height).toBeCloseTo(compass.y + compass.height)
            expect(edit.x + edit.width).toBeLessThan(actions.x)
            if (wide) {
              await page.getByRole('link', { name: 'Show chat' }).tap()
              await expect(page.locator('.chat')).toBeVisible()
              const chat = (await page.locator('.chat').boundingBox())!
              expect(chat.x).toBeCloseTo(shortcuts.x)
              expect(chat.width).toBeCloseTo(shortcuts.width)
              await page.locator('.chat_hide_button').tap()
            }
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
