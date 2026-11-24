# Test suite review

Reviewed 2026-11-24 against `43270cb`. The suite is strongest where it checks what Crawl sent, what commands the client emitted, what was saved, and what Chromium actually drew. Repeated replay and setup accounted for most of the unit runtime removed in this pass. The old browser smoke profile reduced the raster combinations but still ran the whole interaction suite.

## Coverage by suite

| Suite | High-value checks to keep | Where to trim or consolidate |
|---|---|---|
| WebTiles | Wire order, reconnect, map deltas, rollback, visibility and recorded protocol compatibility | Assert multiple outcomes from one recording pass. Use short message sequences for flags, menu transitions and ambiguous inputs. |
| Gamedata | Bounded parser, official-table parity, error diagnostics, cancellation and atlas disposal | Compare every official value with less assertion overhead. Share a loader pass when checking the signal and disposal on the same cancellation. |
| Scene WebTiles | Independent tile and badge expectations, confirmed actor visibility, and incremental versus fresh builds | Use explicit cells for travel arrows, overlays, corpse placement and damage badges. Check real recorded composition during the existing incremental replay. |
| Shared scene, 2.5D and 2D renderers | Motion endpoints, depth and picking, LOS, bounded effects, and flat map semantics | Keep the projection matrix and independent Canvas checks. Aggregate numeric errors when thousands of checks share one tolerance. |
| Vault and offline packages | Restricted room grammar, packed atlas compatibility, save isolation, resumable installs, offline lifecycle | Reuse read-only tile tables within a file. Run the real-engine connection journeys with the app engine tests. |
| App unit and DOM integration | Command sequencing, combat receipt, settings migration, accessibility, auth, audio teardown and proxy boundaries | Keep settings validation and reset behavior. Drop exact group ordering, repeated document jump checks and duplicate level-up expiry. Validate every bundled replay once and exercise repeated delivery with a small clock fixture. |
| Browser and production preview | Real input and focus, loading and resize, Web Audio and IndexedDB, online-only production behavior under CSP, and pixel-level raster oracles | Smoke exercises representative workflows. Full keeps device combinations and settings details. Remove unchecked success screenshots, redundant chooser permutations and the ember color/position threshold. Preserve real observation windows where the test proves work stays parked. |
| Deployment and verification tooling | Real Git branch freshness, clean build reuse, release notes, and conservative CI scope | Keep real Git checks in their dedicated project. Route changes to the raw gamedata fixtures through the full raster gate because both spell and scenery tests import them. |
| Optional engine E2E | Stable/trunk connection, character creation and saves, native menu and command outcomes, and deterministic replay parity | Review shard balance with built engine timings before changing it. Keep manual recording outside acceptance. |

The production font check now requires Chromium to load registered font faces under the shipped CSP. The replay chooser checks the exact recording path and the set of requested gamedata versions when switching within a version and across versions.

## Follow-up priorities

1. **Test through feature entry points.** When touching tests that construct `GameScreen` with `Object.create(GameScreen.prototype)`, prefer a small typed fixture around its normal constructor or an existing testbed. Drive public inputs and compare emitted commands, visible state and cleanup. The prototype fixtures couple tests to private field names and bypass lifecycle wiring.
2. **Keep one owner per invariant.** Use Vitest for message order, settings validation and boundaries. Use Chromium for real layout, focus, pointer delivery, pixels and Web APIs. In browser specs, retain the alternate device case when it exercises a different input path or layout constraint. Use one representative case when the logic is shared.
3. **Make fixture dependencies explicit.** Prefer imports and small synthetic fixtures for focused tests. Preserve one representative recording and an independent reference for real integration. For raw assets and configuration, keep path-based CI routing and run the explicit profile when import-based selection is insufficient.
4. **Add static checking to app test helpers incrementally.** The regular TypeScript command checks app source, browser specs and verification tooling. Vitest transpiles the app unit fixtures without typechecking them. Start with shared helpers as they are touched, using the actual message and fixture types.
5. **Measure the expensive lanes from reports.** Use Vitest and Playwright JSON durations to review the slowest cases periodically. Profile the 18-second full movement raster case and time provisioned engine shards before changing concurrency or matrices. Maintain isolated files, zero browser retries and descriptive timing reports.

See the [runbook](RUNBOOK.md#choose-checks-for-the-change) for focused commands and the [baseline](BASELINE.md#test-suite-cleanup--2026-11-24) for measurements.
