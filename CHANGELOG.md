# What's new

## 0.1.2-hotfix.4 — 2026-11-27

- Movement and combat catch up smoothly when a slow connection delivers several confirmed turns together. Held keys keep their usual repeat behavior.
- Ctrl+F item search and G → D travel keep what you typed when Crawl updates the screen, so Enter submits the full line. Opening item search no longer flashes gray over the message log.

## 0.1.2-hotfix.3 — 2026-11-27

- The action list in **Edit touch layout** keeps its scroll position as you select tiles and assign shortcuts.

## 0.1.2-hotfix.2 — 2026-11-27

- Pinch the dungeon with two fingers to zoom in or out on phones and tablets. Your zoom is saved, and you can turn off **Pinch to zoom** in Settings → View.
- The default dungeon zoom uses more of the screen on phones and tablets while leaving room for extended line of sight when it appears.

## 0.1.2-hotfix.1 — 2026-11-27

- Turn off 2.5D perspective in Settings → View for a top-down dungeon with square tiles. The default view keeps raised walls and a 35° tilt.
- At 100% zoom, phones and tablets now fit the character's full line-of-sight area into the dungeon view. You can still adjust zoom in Settings → View.

## 0.1.2 — 2026-11-26

- Play Offline is available on polished-crawl.com. Install Stable or Trunk while connected, then reopen the same site or installed app to play offline. Saves stay in the browser where you created them.
- The existing site analytics now counts offline menu clicks, installation outcomes, and game launches when connected. The events use fixed action names and respect browser privacy controls.

## 0.1.1 — 2026-11-26

- Customize touch shortcuts with the layout editor and start from a Melee, Caster, or Ranged preset. Resize the movement pad and action grid independently, move shortcuts, and save your own layouts.
- Move by swiping or tapping the dungeon with optional touch controls. Hold supported action buttons for repeat input, and use the minimap to open the map.
- On phones and tablets, the menus and HUD make more room for the dungeon. The HUD stays in place when you open the level map, and nearby monsters appear below the minimap in portrait layouts.
- The Play menu groups games by server and shows where you have a game in progress. The sign-in screen and account controls make it easier to get back to a saved account.
- Dynamic lighting now defaults to Off on all devices. Enable it under Settings → View → Lighting. It can reduce performance on low-end devices. Spell effects start enabled, and combat particles stay readable as you change the dungeon zoom.
- Fixed stale input during some spell animations and improved map redraws and game switching.

## 0.1.0 — Public launch

- [Announced Polished Crawl on r/dcss](https://www.reddit.com/r/dcss/comments/1y2be5p/announcing_polished_crawl_a_25d_webtiles_client/) with 2.5D WebTiles, animated movement and combat, dynamic lighting, monster descriptions, and optional sound effects.
- Launch-period hotfixes improved mobile controls and zoom, account switching, hover and tile clicks, and dungeon presentation. See the [build changelog archive](project-notes/releases/legacy-changelog.md) for their original dates and version numbers.
