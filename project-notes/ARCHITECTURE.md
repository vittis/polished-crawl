# Architecture

Polished Crawl is an npm/TypeScript workspace with a Vite app in `apps/orbrun`, Canvas renderers and a Cloudflare Worker. The remote or on-device DCSS engine owns gameplay. The client interprets ordered WebTiles state and presents confirmed information.

## Common change entry points

| Task | Start here | Existing verification |
|---|---|---|
| Keyboard, gamepad, touch and commands | `apps/orbrun/src/keys.ts`, `gamepad.ts` and `bindings.ts` normalize inputs. `game.ts` coordinates play and `runner.ts` handles command sequences. | `game-controls.test.ts`, `runner-controls.test.ts`, `tests/browser/game-input.spec.ts`, `tests/browser/mobile-hud.spec.ts` |
| HUD, minimap and settings | `apps/orbrun/src/grid/layout.ts` resolves layout presets. `grid/mobile.ts` computes touch geometry and `hud.ts` places controls, stats and maps. `minimap.ts` draws the overview. `settings.ts` and `settings-panel.ts` handle preferences and controls. | `narrow-hud-layout.test.ts`, `touch-bar.test.ts`, `minimap-turn.test.ts`, `settings.test.ts`, desktop and narrow browser checks |
| WebTiles order, commands and state | `packages/webtiles` owns transport and the reducer. `apps/orbrun/src/session.ts` applies ordered state and asset updates before presenting a scene. | `packages/webtiles/test/reducer.test.ts`, app `session-*.test.ts` fixtures |
| Combat, movement, visibility and artwork | Start with `apps/orbrun/src/combat-presentation.ts` for confirmed combat. `packages/scene-webtiles` interprets game cells. In `packages/render-2.5d`, `wall-depth.ts` resolves foreground wall geometry and `wall-splatter.ts` handles wall decals. | `combat-presentation.test.ts`, renderer unit tests, the app's `testbed/` raster and lifecycle fixtures |
| Play, offline and login | `apps/orbrun/src/menu.ts` coordinates routes and session actions. `menu-home.ts` renders the home screen and `servers.ts` owns account and server persistence. | `menu.test.ts`, `token-life.test.ts`, browser interaction and production checks |
| About, What's New and menu replays | `apps/orbrun/src/menu-modal.ts` manages About and What's New. `news.ts` tracks the seen version and `menu-backdrop.ts` owns loading and playback. | `app-update.test.ts`, `menu-backdrop.test.ts`, `site.test.ts`, production browser checks |
| Audio packs, playback and caching | `apps/orbrun/src/audio/controller.ts` coordinates playback, `pack-worker.ts` handles packs, and `store.ts` owns local persistence. | `audio-controller.test.ts`, `audio-worker.test.ts`, `audio-mixer.test.ts`, production browser checks |
| Hosted routes, embedded docs and release | `apps/orbrun/worker/index.ts` owns serving and proxies. `site-pages.ts` builds site pages. `.github/workflows/release.yml` and `tools/build/` handle publication. | `worker.test.ts`, `site.test.ts`, `npm run test:deploy`, `tests/browser/production.spec.ts` |

## Package and app responsibilities

| Area | Responsibility |
|---|---|
| `packages/webtiles` | Bounded connection/envelope handling, protocol keycodes, formatting and mutable state reduction |
| `packages/gamedata` | Bounded Acorn parsing of generated data without executing remote functions; atlas loading |
| `packages/scene-webtiles` | DCSS-specific classification and incremental scene composition |
| `packages/scene` | Render-facing cells, sprites, directions and shared visual-effect contracts |
| `packages/render-2.5d` | Sole gameplay renderer; raised-wall Canvas projection, visibility, lighting and confirmed animation |
| `packages/render-2d` | Flat temporary maps, minimap and development reference views |
| `packages/vault` | Restricted `.des` parsing and bundled scenery compilation |
| `packages/offline`, `engine/` | Optional local DCSS worker behind the WebTiles Connection interface. The installer owns verified runtimes and artwork, per-character build pins and cross-tab save locks. |
| `apps/orbrun/src/session.ts` | Connection/state/asset sequencing, scene flushes and lifecycle |
| `apps/orbrun/src/game.ts` | Gameplay screen, renderer/map lifecycle, input and presentation coordination |
| `apps/orbrun/src/settings.ts` | Supported preferences, defaults, numeric validation and compatible persistence |
| `apps/orbrun/src/audio/` | Optional OSP pack loading/caching, worker-isolated matching and bounded Web Audio effects |
| App controls/HUD/menu modules | Device normalization, contextual commands, menus, targeting, settings and accessibility |
| `apps/orbrun/src/menu-home.ts`, `menu-modal.ts`, `menu-backdrop.ts` | Persistent Polished Crawl home, shared accessible document modal, silent replay of spectator and staged gameplay recordings |
| `apps/orbrun/src/room/` | Saved scenery and tiles retained for rendering fixtures and static document artwork |
| Worker/proxy/build tools | Static hosting, bounded allowlisted proxies, source identity and incremental deployment |

## State and presentation

Decorated wall caps retain their confirmed artwork and overlays. Scene producers resolve matching plain wall materials for the lower faces of named torch/lamp and similar decorated variants; the 2.5D renderer reflects only that material, without overlays, under its static face shading. Tile names and version-specific IDs remain outside the renderer. Missing plain variants retain the original material.

The reducer mutates GameState; scene revisions and dirty-cell information drive incremental composition. Consumers must not mistake reused object identity for immutable history. Presentation snapshots only the identities, positions and visual fields needed for confirmed transitions.

Combat messages and state deltas drive effects. Named spell damage and native effect tiles share the DCSS presentation catalogue in `scene-webtiles/effect-types.ts` ([audit](COMBAT-ELEMENTS.md)). Explicit result classifications override ambiguous/reused native art; Searing Ray deliberately uses fire presentation without changing server damage mechanics. Named spell damage is classified before creature melee grammar, so Prism/force/energy and direct ability results retain their damage element without creating a physical attacker. Casting and status-only messages do not establish a damaging hit. An identified venom brand on the primary weapon is captured when a confirmed player weapon-hit message arrives, providing poison appearance even when lethal strikes omit the status follow-up; it does not assert extra damage or poisoning. Animation cannot delay command transmission, invent damage or hidden actors, change authoritative positions, or infer gameplay outcomes. Existing movement smoothing, wall/corridor behavior, visibility fading, spell traces and combat timing remain renderer responsibilities.

The 2.5D renderer fills the viewport with opaque black before painting confirmed terrain. The player sprite uses the same environmental lighting as other actors. Wall depth and contact shadows for other entities remain part of the 2.5D projection.

Confirmed travel adds bounded body gestures in the 2.5D renderer: walkers hop, oozes compress, serpents slither, small creatures scuttle, undead shuffle, and airborne or spectral creatures bank along their glide. Existing life traits select the gesture; player species and confirmed transformation artwork distinguish non-walking bodies, with actual flight status taking precedence. Ground travel, camera following, markers and authoritative cells remain independent of the body gesture. Rapid retargets preserve the current pose and settle by the end of the latest move. Visibility loss, level resets and disabled movement discard these gestures; flat maps retain their existing presentation.

LOS memory shading uses one brightness per confirmed cell across its terrain, wall faces and standing art. The optional temporal fade also adjusts light exposure. Fades reuse immutable rasters grouped by size under a two-megapixel pool budget, with a scratch-canvas fallback for overflow. Authoritative visibility governs interaction throughout the fade.

## Audio

Audio is opt-in and local to the listener, including spectators. Settings → Audio
downloads CNC Open Sound Pack explicitly or imports a ZIP, reads only root
`init.txt`, and provides master/effects volume, single/layered playback, a test
sound and cache removal. No pack assets or extension scripts ship with Orbrun.
Only `sound_file_path` and ordered `sound +=` / `sound ^=` rules are interpreted;
other RC directives, Lua, includes and music are ignored. Missing/invalid rules
are skipped with bounded diagnostics. This intentionally permits later valid
rules to supply a sound when a DWEM rule references a missing asset.

`message-occurrences.ts` shares initial-history and rollback-prefix bookkeeping
between combat and audio. Audio matches original plain-text lines but accepts
only matches intersecting newly received text. It never deduplicates by turn or
text alone, predicts from input, reads hidden positions, or waits for rendering.
Messages received while disabled, hidden, locked or loading are not replayed.
Session teardown invalidates queued matching/decoding; the app owns its one audio
context and reusable pack independently of renderer/map lifecycle.
Hidden tabs suspend it until another user gesture.

A disposable module worker parses ZIPs and runs regexes, with request deadlines
that terminate stuck workers. Limits: 64 MiB ZIP, 192 MiB expanded data, 4,096
entries, 8 MiB per entry, 512 KiB text files, 10,000 rules, 2,048-character regexes,
16,384-character messages, 32 pending message lines and 16 pending effects.
Effects older than 700 ms are dropped. The decoded cache retains at most 32 MiB;
samples exceeding 60 seconds or 32 MiB decoded are rejected after browser decode
(the browser controls temporary decoder allocation). At most eight voices play.
The selected archive and SHA-256 identity live in the separate `orbrun.audio`
IndexedDB database; preferences remain in `orbrun.settings`. Cache failures allow
session-only playback. Refresh replaces content explicitly; no automatic pack
update, arbitrary URL proxy, music or spatial audio is implemented.

## Views and controls

Dungeon (2.5D) is permanent gameplay. Flat rendering is a temporary supporting view, entered by level-map/overview state and restored on close. The optional minimap shows a flat WebTiles overview of the explored level, using server map features and RC colours. Its viewport outline tracks the projected dungeon viewport. Right-button inspection overrides the local camera until release. Nearby monsters default to visible on all devices. The minimap defaults to visible on all devices, with a transparent background and no outer border. Touch portrait anchors the minimap beneath the action panel at the upper left. Touch landscape and desktop default to a centered minimap within the sidebar and respect the saved alignment. Interface settings also control visibility, size, the outer border and background opacity. All sizes share the full-level raster above the configurable backdrop. GameScreen owns one presentation state (`dungeon` or `flat-map`) and one transition method. Server/overview state requests the transition; settings never choose a view. Settings changes and resize must apply safely while either view is active; repeated transitions preserve cursor/selection and clean up resources.

Input is compass-based across keyboard, gamepad and touch. Interface layout defaults to Auto and can be set to phone portrait, phone landscape, tablet portrait, tablet landscape or desktop. Touch layouts use the split eight-direction compass and retain the action panel and spell shortcuts. Short landscape layouts use a compact chat launcher when the sidebar cannot fit the caption. The Action panel preference is stored locally. `X` opens the level map and `Ctrl+X` opens the in-view list. Projection selection and first-person look/turn actions are removed. Existing menus, prompts, modifier keys and server commands remain contextual.

## Security boundaries

The gamedata parser accepts a bounded known grammar and fails closed on unsupported helpers. Transport and asset queues have explicit count/byte limits. The proxy permits exact bundled HTTPS hosts, rejects redirects and bounds request time/size/concurrency; browser game WebSockets use WSS directly. These controls and the restrictive CSP are independent of renderer choice. Deployment details and residual limits are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Combat presentation

Confirmed combat events drive player, enemy and ally body bumps, spell bursts, hit splashes and death effects. Weapon VFX, swing variations, artwork previews and their settings are removed; bump strength, speed and snap tune melee motion, while separate hit/death gore and outward-spray controls tune bounded material bursts. Hit and death splatters retain body material while mixing in debris from the confirmed damage element. Elemental stamps distinguish forked lightning, fire tongues, frost crystals, poison bubbles, acid streaks and magic glints; dense bursts reserve room for these signatures while retaining death floor splatter. Death attribution retains same-turn hit evidence briefly across message/frame boundaries; older turns and utility cues never supply a killing element. A shared VFX variation control adjusts stable per-spawn profiles around the saved density and spray baselines, with deterministic redraws and fixed particle caps. Misses, shield blocks and zero-damage attacks retain confirmed body bumps without impact VFX. Confirmed kills replace pending hit effects; they never predict death from damage or wounds. Bump contact, hit flash and hit spray share the same early contact clock. Creature melee requires an explicit physical attempt and a visible name-matched source within reported reach. When native messages omit attacker IDs, repeated same-name attempts in a turn are allocated deterministically across the least-used matching actors, including across rendered frames. This fallback affects visual attribution only: recipients remain unambiguous and each message still produces one attempt and its original result. Bump speed is captured per attack and scales the shared contact/recovery clock. Mutual attacks shorten their lunges smoothly as the opposing body approaches. Lunges blend across overlapping attacks; small receiver flinches preserve counterattack direction and never displace authoritative cells. They contain effect evidence and actor identity, not display labels or DOM positioning data. Floating combat text and its setting, stylesheet, icons, font, scheduler and offline damage-number patches have been removed. HP/status changes still feed the retained world effects; native server messages remain in the message log.

## Settings and layout

View settings offer movement duration and easing, plus independent controls for hop height, squash/stretch and sway/banking. Strengths range from off to 200%, with defaults of 40% hop height, 60% squash and 100% sway and apply immediately to body poses and contact shadows without changing travel, camera following or idle motion. Instant movement disables the dependent controls. Defaults preserve the authored gaits; existing custom durations remain valid between the menu's 10 ms steps.

`settings.ts` reads and writes only `orbrun.settings`. It preserves existing keys/defaults and legacy hint migration, ignores retired fields, normalizes finite numbers to documented supported domains, and stores only non-default values. Reading never rewrites storage. Server/account/save persistence remains in `servers.ts`.

HUD geometry uses available grid space. Narrow mouse windows receive readable top stats and full-width messages; input affordances still depend on the device. Existing phone portrait and wide desktop layout rules remain separate retained paths. GridHost measures glyph advances at actual displayed sizes, caches them and invalidates on font changes; it does not extrapolate small hinted text from a large font probe. Renderer algorithms and authored artwork are unchanged by stabilization.

## Verification

`npm run verify` runs incremental types and unit tests. Isolated Vitest projects separate ordinary units from real-Git deployment tooling. The browser smoke profile samples nine rendering concerns. The broader render suite and manually dispatched Verify workflow retain the complete matrix. PR CI routes checks by changed paths. The manual release workflow runs deployment tests and packages the Worker. See [RUNBOOK.md](RUNBOOK.md) and [AGENTS.md](../AGENTS.md) for selection limits and optional engine checks.

## Polished Crawl shell

FrontEnd exposes one remembered WebTiles login, plus one local profile in preview and development. Existing players keep their last-used offline profile and its save and RC locations. The Play menu opens RC files, additional server versions and morgues directly. Stable and Trunk share the offline RC file. HomeView owns the persistent compact header and keyed command rows; lobby updates preserve inputs, focus and row identity. Descent IDs are filtered only at the home offering boundary. MenuModal owns document focus containment, restoration and background inertness. About, /about/new and /whats-new enter that same modal; install/Steam remain static documents. News still uses orbrun.newsSeen.

MenuBackdrop owns the Orb of Zot loading vignette, on-demand recording/artwork loading, preference/visibility listeners and lifecycle. Covered/hidden menus pause the playback clock without catch-up and stop rendering. Teardown aborts loads and releases renderer/atlases.

MenuDemo owns a separate reducer/scene and the shared Render25d, CombatFeedback, presentCombat and dungeonOptions presentation. ReplayClock feeds ordered state batches, preserving their remaining delay across pauses. Spectator clips start from their preceding state deltas. Staged clips each start with a spectator snapshot from a local Crawl engine. Their frames contain the engine output from ordinary player actions. Each clip starts with fresh state and combat history; each loop clones messages because reduction may mutate them. The menu never creates an engine, GameScreen, Session, input handlers or audio. The normal home lobby is independent. Startup fetches the first shuffled clip and its pinned artwork from same-origin static files. Clip changes release the previous renderer and decoded atlases. A failed load exposes a retry below the Orb. The build verifies their sizes/hashes, with no engine preparation. HTTP caching uses immutable clip hashes and gamedata versions. The old menu-engine cache is cleaned up without touching development saves. See [recording provenance](../apps/orbrun/public/menu/README.md).

GridHost and HUD fonts/metrics are independent of shell typography. The menu canvas has a narrow fade to the black menu background. The separate Orb vignette is visible until gameplay appears.
