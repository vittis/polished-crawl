# Building and deploying the optional offline engine

Use this guide for engine work. The hosted client offers Stable and Trunk as optional device downloads. Its preview and production releases follow the [client deployment runbook](../project-notes/DEPLOYMENT.md).

Nothing here vendors Crawl source. The stable/trunk channels follow upstream. There are two
channels, both resolved on upstream at build time: **trunk** is `master`, and
**stable** is the newest numeric release tag.
`build.sh` fetches the commit, applies `patches/`, adds `wasm/`, and builds;
each channel's `engine.json` records the commit it built. One patch series
serves both.

```sh
engine/build.sh              # stable and trunk
engine/build.sh stable       # one channel
engine/build.sh 0.34.1       # or any crawl tag, branch or commit
node engine/smoke.mjs        # play every built channel under node
```

Needs emsdk active (`em++` on PATH), node 25+ (JSPI), python3 with PyYAML,
and what a native `make WEBTILES=y` needs. Each channel builds in its own
worktree of one clone under `engine/.work/`, and lands in
`engine/dist/builds/<commit>-<recipe>/`, its gamedata in `engine/dist/gamedata/<commit>/`,
with `engine/dist/<channel>/engine.json` pointing at them (all gitignored).
Builds live under their commit so a device can download the next one beside
the one it plays (`@orbrun/offline` `EngineStore`):

| File | What |
|---|---|
| `crawl.js`, `crawl.wasm` | The engine: an ES module factory and its wasm |
| `crawl.data` | `dat/` and `docs/`, preloaded read-only |
| `prewarm/` | The first-boot caches, baked at build time (`wasm/bake-caches.mjs`) |
| `../gamedata/<commit>/` | The atlas sheets and tile info a server serves as `/gamedata/<version>/`, beside the builds so one base URL serves every channel |
| `../<channel>/engine.json` | The channel, the crawl commit built, its version string, the cache stamp, its gamedata version, the recipe (`recipe.mjs`: a hash of `patches/`, `wasm/` and `build.sh`), and every file of the build and its gamedata with its size (`pointer.mjs`) |

A host gives each release, and trunk, its own save dir (`Module.saveDir`, e.g.
`/crawl-0.34`, `/crawl-trunk`): IDBFS names its IndexedDB database after the
mount point, and a save carried into a newer crawl never loads in an older one.

## How it differs from the server build

The binary normally sends JSON over a Unix datagram socket and takes keys from
a pty. Here it runs headless, and `wasm/bridge.h` + `wasm/pre.js` put a JS
queue where the socket was:

| | Server build | This build |
|---|---|---|
| Output | `sendto()` in `finish_message` | `Module.onBridgeOutput(lines)` |
| Control in | `recvfrom()` | `Module.bridge.pushControl(json)` |
| Typed keys | pty | `Module.bridge.pushKeys(text)`, sent as `text_input` |
| Waiting for input | `pselect()` | JSPI or Asyncify suspension while awaiting the next command |
| Terminal | ncurses | `wasm/fake-curses.h`, inert |
| Saves | files | IDBFS at the save dir, flushed at each save commit |

A host must send `{"msg":"attach","primary":true}` after boot, as the server
does, or the engine never sends the map.

The bridge emits `checkpoint` when a save reaches IndexedDB, `ending` when the end of a character reaches disk, and `persist_failed` when a write fails. The host can request a checkpoint when the tab goes into the background. Crawl saves once the player has control.

## Patches

One per crawl file, each saying what it does at the top, every change behind
`#ifdef __EMSCRIPTEN__` so the native build compiles upstream's code.
`tileweb.cc` carries the socket swap; the rest fix headless play for a
watching client (popups painted, pre-game messages sent), keep the caches
valid across boots, and make saves land in IndexedDB whole.

When upstream moves, `build.sh` names the patch that no longer applies.
Fix it against the new source, regenerate it with `git diff` from the
channel's worktree in `.work/<channel>`, and keep the header.

## Packaging and verification

Each channel manifest records its upstream commit, recipe, both runtimes and SHA-256 checksums. The JSPI glue and binary are in the build root and Asyncify is under `asyncify/`. The variants share the game data, prewarm pack and artwork. The installer detects the runtime in a module worker.

```sh
sh engine/build.sh
node engine/smoke.mjs
ENGINE_VARIANT=asyncify node engine/smoke.mjs
REQUIRE_ENGINE=1 npm run e2e
npx playwright install chromium firefox webkit
npm run test:offline-browser
```

On a push to `preview`, Deploy preview restores the previous successful run’s engine pair and tests it with the app before publishing. Manual runs on `preview` and the daily refresh also check upstream and build any changed channels. Run a manual refresh to pick up engine recipe changes or replace a missing or expired artifact. The existing app Worker serves ordinary files. Files over 24 MiB are staged in parts and reconstructed during installation. The owner selects the accepted preview run when releasing to production.

The browser suite uses a production build on a dedicated loopback server. For physical-device acceptance, install a channel on an iOS and an Android device, create a character, save, close the app, enable airplane mode and reopen. Verify the saved turn, movement, the level map and another save.
