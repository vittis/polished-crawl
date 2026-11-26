<p align="center"><img src="assets/logo.svg" alt="Polished Crawl" width="560"></p>

# Polished Crawl

**Dungeon Crawl Stone Soup in a 2.5D dungeon, with keyboard, gamepad and touch controls.**

[Play or watch](https://polished-crawl.com/) · [Preview upcoming changes](https://preview.polished-crawl.com/) · [Controls and privacy](ABOUT.md) · [Engineering guide](project-notes/README.md)

Polished Crawl connects to public DCSS WebTiles servers. Accounts, saves, rc files and gameplay remain on the selected server. Anonymous spectating needs no account.

Dungeon (2.5D) is the gameplay view: slanted floors, raised walls, upright creatures, lighting, spell effects and confirmed combat feedback. Tilt, zoom and movement presentation remain configurable. Traditional flat tiles remain for the minimap and temporary level-map/overview displays; closing a map returns to the dungeon. Movement and targeting use compass directions.

<p align="center"><img src="apps/orbrun/public/room/poster.jpg" alt="The bundled front room rendered in Dungeon 2.5D" width="720"></p>

Play online on a bundled WebTiles server or choose **Play Offline** to install Stable or Trunk. Once the channel shows **Ready offline**, you can reopen the site and play with no connection. Offline characters, options and morgues belong to local profiles on this device.

## Play

Use **Watch** to spectate, or **Play** to choose your account's server. The HUD includes server menus, prompts, messages, stats, chat, targeting and the monster list. The action bar describes the current gamepad or touch controls.

- [Keyboard, controller and touch guide](ABOUT.md#controls-and-interface)
- [Add to Steam](STEAM.md)
- [Add to Home Screen](INSTALL.md)
- [Release notes](CHANGELOG.md) · [GitHub Releases](https://github.com/vittis/polished-crawl/releases)

## Develop

Use Node 24.11.1 and npm 11.6.2, the verified web toolchain.

```sh
npm ci --include=dev
npm run dev -w apps/orbrun -- --host 127.0.0.1
npm run test:changed # focused editing loop
npm run verify # incremental types + unit tests; no browser/build
```

Install Chromium once with `npx playwright install chromium` for `npm run verify:browser`. Use `npm run verify:release` when a broad audit is useful. [Agent workflow](AGENTS.md) · [Release process](project-notes/DEPLOYMENT.md)

The local dev server and local Vite preview include the bounded gamedata proxy; WebSockets connect directly to the selected DCSS server. Optional engine tests report explicit skips when their artifacts are missing. [CONTRIBUTING.md](CONTRIBUTING.md) and the [runbook](project-notes/RUNBOOK.md) explain fixtures, browser checks and release validation.

## Packages

| Package | Responsibility |
|---|---|
| [webtiles](packages/webtiles) | Connection, protocol, formatting and mutable server-state reducer |
| [gamedata](packages/gamedata) | Bounded non-executing parsing of server enums/tile tables and atlas loading |
| [scene](packages/scene) | Render-facing cells, sprites, directions and presentation contracts |
| [scene-webtiles](packages/scene-webtiles) | DCSS state and gamedata to scene composition |
| [render-2.5d](packages/render-2.5d) | Canvas dungeon renderer and confirmed visual effects |
| [render-2d](packages/render-2d) | Flat supporting views and minimap |
| [vault](packages/vault) | Restricted DCSS `.des` parser and scene compiler for bundled scenery |
| [offline](packages/offline) | Local DCSS engine, installation and device saves |

`apps/orbrun` owns the app, controls, sessions, menus, settings, HUD and Worker. `engine/` builds the downloadable DCSS engines. No UI-framework or protocol replacement is part of this baseline.

## License and credits

Vittis develops Polished Crawl, an unofficial DCSS client based on [Orbrun](https://github.com/Caeous/orbrun). Caeous created the original client and its 2.5D renderer. Thanks to Linley Henzell, the Dungeon Crawl Stone Soup development team, and its contributors for the game, WebTiles, and tile art.

[AGPL-3.0-or-later](LICENSE). Copyright © 2026 the Orbrun developer. [Full attribution and third-party licenses](ATTRIBUTION.md) cover DCSS-derived code, artwork, fonts, PocketZot and Super Dungeon Crawl. The hosted About page links the exact corresponding source for its release.

Report issues at [Polished Crawl issues](https://github.com/vittis/polished-crawl/issues). Earlier release links also remain available in the [original repository](https://github.com/vittis/orbrun).
