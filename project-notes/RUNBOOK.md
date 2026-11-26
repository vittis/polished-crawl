# Development and verification runbook

Run commands from the repository root. Start with the [feature entry points](ARCHITECTURE.md#common-change-entry-points) and read [DEPLOYMENT.md](DEPLOYMENT.md) for release work. Do not commit `.env`, credentials, tokens, raw recordings or generated logs.

## Inspect and install

```sh
git status --short --branch
git remote -v
git rev-parse HEAD
node --version
npm --version
```

Run `npm ci --include=dev` when dependencies are missing or the lockfile has changed. The verified web toolchain is Node 24.11.1/npm 11.6.2. Vite requires Node ^20.19.0 or >=22.12.0; Wrangler requires >=22. The optional WASM engine has separate requirements below. Preserve unrelated edits. Fetch `origin/preview` before branching or opening a feature PR. Fetch `origin/main` for release work. Codex worktrees may be detached and local branches may lag. `origin` is `vittis/polished-crawl`; `upstream` is Caeous's repository.

## Clean up branches and worktrees

Review the finished task after its PR merges. During a repository sweep, refresh `origin` and list candidates before deleting anything.

```sh
git fetch --prune --no-tags origin
git worktree list --porcelain
git branch --merged origin/main
git branch --merged origin/preview
git branch --remotes --merged origin/main 'origin/*'
git branch --remotes --merged origin/preview 'origin/*'
```

1. Keep `main`, `preview`, release tags, active release heads, open PR heads and any branch whose tip has commits outside both integration branches. Verify each local and GitHub tip independently. A shared branch name, a gone upstream or an old merge record does not establish that the current tip is merged. Preserve branches with commits outside both histories for review, including after a squash merge or rebase.
2. Check `git -C <worktree> status --short --untracked-files=all --ignored=matching` for every candidate. Keep worktrees that are active or locked, have tracked or untracked changes, or point to a detached commit outside both integration branches. Save any needed ignored files, including local configuration and review evidence under `test-results/`. Archive idle worktrees through Codex when it manages them. For older checkouts that Codex cannot archive, save the original path, branch, commit and needed ignored files in a verified local archive before using `git worktree remove <path>` without `--force`. Use `git worktree prune --dry-run --verbose` to inspect stale registrations for missing checkouts.
3. Delete only the verified topic refs covered by the cleanup request. Remove checked-out worktrees before deleting their local branches. Prefer `git branch -d <branch>`. Recheck ancestry and the exact tip if Git's upstream check refuses. Use an explicit expected tip when deleting remote branches so a concurrent push is preserved. Refresh with `git fetch --prune --no-tags origin` after remote deletions and verify the remaining branches, worktrees and tags.

The repository owner can enable **Automatically delete head branches** on GitHub. Keep branch protections for both `preview` and `main` in place. Record cleanup exceptions in the handoff and review accumulated branches and idle worktrees periodically.

## Run locally

```sh
npm run dev -w apps/orbrun -- --host 127.0.0.1
```

Open [development](http://127.0.0.1:5173/). Keep development listeners loopback-only. The production bundle is built and served separately:

```sh
npm run build
npm run preview -w apps/orbrun -- --host 127.0.0.1
```

Open [local Vite preview](http://127.0.0.1:4173/). Use the [deployment runbook](DEPLOYMENT.md#feature-work-and-preview) to verify a deployed Worker on the shared preview domain. Vite preview includes the gamedata proxy. `apps/orbrun/dist` is generated. The menu's curated recordings and matching artwork are bundled and verified directly from source; the hosted deployment stages its verified engine pair separately. For local offline play, provision both channels, run `npm run build && node engine/package.mjs`, then start Vite preview. The development server does not precache an app shell. Network/listener/keychain sandbox refusals must be distinguished from application failures.

## Choose checks for the change

Run focused tests while editing. For TypeScript changes also run `npm run typecheck`. Select additional checks by the behavior affected.

| Change or question | Command | Coverage |
|---|---|---|
| A specific regression | `npm test -- <unit-test-filter>` or `npm run test:watch -- <filter>` | Matching unit tests |
| Uncommitted edits | `npm run test:changed` | Unit and deployment tests selected by imports since HEAD |
| Types and all ordinary unit tests | `npm run verify` | Incremental workspace and verification-tool types, then the unit suite |
| UI, input, layout or lifecycle | `npm run verify:browser` | Representative Chromium interactions tagged `@smoke` and checks from every raster lane |
| A specific browser feature | `BROWSER_SUITE=full npm run verify:browser -- tests/browser/game-input.spec.ts` | Every browser case in the selected spec |
| Renderer, scene or artwork | `npm run verify:render` | Full raster matrix and interaction tests |
| Worker, build flags or embedded pages | `npm run verify:production` | Build once and exercise the online shell on local Vite preview |
| Deployment tooling | `npm run test:deploy` | Real Git remotes, candidate identity, hosted checks and partial-release recovery with simulated external writes |
| Broad audit | `npm run verify:release` | Forced types, both Vitest projects, one production build and full browser suites |
| Optional engine changes | `REQUIRE_ENGINE=1 npm run e2e` | Requires the provisioned stable engine. Report missing artifacts as a coverage limitation. |

For committed feature work fetch the base and run `npm run test:since -- origin/preview`. Use `origin/main` for a release PR. The command checks that Git can resolve a common ancestor before starting Vitest. A zero-test selection provides no verification. CSS, assets, files read at runtime and build configuration can escape the import graph. Use `npm run verify:scope -- origin/preview` to list the CI checks for your branch and working-tree changes, including untracked files. Omit the base to inspect edits since HEAD.

Install Chromium once with `npx playwright install chromium` when browser checks are needed. The browser suites use strict loopback ports 5286 (dev) and 5287 (built app), isolated contexts and zero retries. Failure traces, screenshots and reports are under `test-results/`. Public WebSockets are intercepted in production tests.

PR CI selects gates by changed path. Code PRs into `preview` also restore the last verified engine pair and run the same engine and session tests as Deploy preview. If the pair expires, dispatch Deploy preview to refresh it. Repository prose can pass without installing dependencies. The embedded About, Install, Steam and changelog pages get a production build. Manual **Verify** runs the broad audit. **Release Polished Crawl** handles publication. [CI scope selector](../tools/testing/change-scope.mjs) · [Verify workflow](../.github/workflows/verify.yml)

## Browser acceptance

For UI changes, inspect desktop and narrow layouts. Choose the flows affected by the change:

1. Confirm the Polished Crawl recorded gameplay/static entrance, inline login, document modals, settings, resize and repeated navigation lifecycle. Check modal coverage and hidden-tab suspension. No projection selector or first-person setting should remain.
2. Confirm fresh settings and migrated saved projection settings use Dungeon (2.5D), preserving unrelated preferences.
3. Open `/watch/cdi`, wait for the anonymous lobby and spectate an active player when available. Check real tiles, HUD, messages, minimap and server-driven updates. Never send chat or gameplay commands to another player's session.
4. Use deterministic local fixtures to check level-map entry/exit, repeated transitions, cursor/selection, settings changes while open and resize. Check `X` separately from `Ctrl+X`.
5. Check compass movement and targeting through keyboard/gamepad/touch simulation, then report hardware coverage separately.
6. Check visibility, wall/corridor behavior, confirmed combat effects and cleanup. Inspect console and failed network requests.
7. Run retained development rendering fixtures such as `/testbed/dungeon.html`, `/testbed/dungeon-checks.html`, `/testbed/impact-checks.html`, `/testbed/projectile-checks.html`, `/testbed/room.html` and `/testbed/combat.html`. Record current results, not historical counts.
8. Repeat representative shell, settings and spectating checks against production preview; this verifies production flags and emitted assets.

DOM/canvas mocks do not prove raster correctness. Spectating does not prove login, character creation, save/restore or physical-controller behavior. Obtain explicitly authorized disposable-account coverage separately, with secrets entered securely and never stored in evidence.

Audio checks use an authored WAV in a synthetic OSP-format ZIP, intercepted HTTP,
real module workers, IndexedDB and Web Audio decoding/playback. They cover volume
persistence, cache restore/removal, local import, message rollback and teardown;
production acceptance applies the shipped CSP explicitly because Vite preview
does not serve Cloudflare's `_headers`. For a manual check, open Settings → Audio,
enable Sound effects, download OSP (about 45 MB) or import its ZIP, and select Test
sound. Pack diagnostics report missing/invalid rules. Check speakers/headphones
and mobile browser unlocking separately; automated source starts do not prove
physical audio output. Never add public pack downloads to the automated gates.

## Fixtures and optional engine

`npm run record -- wss://crawl.dcss.io/socket 60 out.ndjson` captures anonymous spectating. `node tools/record/menus.mjs wss://crawl.dcss.io/socket 30 outdir` records menus. Keep recordings small and free of private credentials/chat where possible. Do not inject malformed traffic into public servers; use mocks.

Read [engine deployment](../engine/DEPLOYMENT.md) before provisioning: emsdk 6.0.10, Node 25+ JSPI, PyYAML and native build prerequisites are separate from the web toolchain. `engine/build.sh stable`, `node engine/smoke.mjs` and `npm run e2e` are the optional workflow. Engine scripts manage/clean their own worktrees; never point `ENGINE_WORK` at user work. Record resolved source identity and artifact recipe. For engine changes also exercise the built app using `npm run test:offline-browser` with Chromium, Firefox and WebKit installed. Record physical-device acceptance separately.

`npm run e2e` collects the real-engine tests under app and package `test/e2e` directories. `npm test` runs the mocked offline boundary tests regardless of installed artifacts. For manual describe recordings use `E2E_RECORD=1 npm run e2e -- record-describes`. For releases and recovery use the [deployment runbook](DEPLOYMENT.md).

## Retained browser fixtures

Use this checkout's actual Vite port (another checkout may occupy 5173).

- `/testbed/dungeon-checks.html`: full raster acceptance matrix. On constrained browsers use `?lane=tiles`, `markers`, `surfaces`, `movement`, `depth`, `visibility`, `coherence`, and `corridors`; together these execute the same assertions. The full profile is the manual fixture default and release/render gate; routine browser checks explicitly select smoke. `&profile=smoke` is explicitly representative, never reported as full acceptance. `&capture=1` retains visual captures; default runs release canvases and yield between bounded cases. JSON in `#result`/`window.__orbrunFixture` reports status, profile, checks, failures and duration.
- `/testbed/living-checks.html`: Dungeon and flat atmosphere, paused rendering and impact at desktop and narrow/DPR sizes, plus independent foliage sway in the Dungeon.
- `/testbed/live-animation.html`: actual GameScreen scheduler and combat receipt timing. Pixel sampling is opt-in and bounded (`sample=1`), so the probe does not stall the scheduler.
- `/testbed/map-lifecycle.html`: local message-driven GameScreen transitions, overview hold, cursor, settings changes, cleanup and input evidence. The renderer factory receives the actual presentation requested by GameScreen, supplies fixture tiles and reports applied Dungeon options. Production preview separately exercises default selection.
- `/testbed/room.html`: authored 2.5D scenery/flat overview; `?poster` for committed poster/card generation.

Never treat simulated controller input or these local server fixtures as authenticated play or physical-controller validation.
