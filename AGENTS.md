# Working on Polished Crawl

Keep the existing 2.5D gameplay presentation and flat supporting maps. Preserve server-authoritative state, confirmed combat/visibility, storage compatibility, and production's online-only boundary. Start with the feature entry points in [ARCHITECTURE.md](project-notes/ARCHITECTURE.md#common-change-entry-points) and the verification commands in [RUNBOOK.md](project-notes/RUNBOOK.md).

## Working branches and releases

- Fetch `origin/preview`, branch from it and set `--base preview` explicitly on feature and fix PRs. Include a player-facing note and the checks actually run. Both protected branches require a green `baseline` and merge commits.
- A preview merge queues its own deployment. When asked to verify preview, match the successful Deploy preview run and the site's Source SHA, test the change there, and report the run URL, SHA and results.
- For release preparation, bump the app and lockfile together and curate the top `CHANGELOG.md` section in a PR to preview. Test the deployed result. Open the release PR into `main` from preview or from `release/<version>` pinned at the tested SHA. Include the preview run URL and manual acceptance.
- The owner publishes from **Release Polished Crawl** on main using the tested preview run ID. Treat production publication and rollback as explicit owner actions. A merged PR, tag, or green Verify alone is insufficient evidence of what is live. Confirm the custom-domain source and active Worker version before reporting deployment.
- Hotfixes follow the same tested path. For interrupted releases, inspect the tag and Cloudflare deployment before rerunning the original Action. The [deployment runbook](project-notes/DEPLOYMENT.md) covers held preview work, retry and rollback.

## Fast iteration

- Inspect `git status` first and preserve unrelated edits. Install dependencies only when missing or the lockfile changed. Chromium is needed only for browser checks.
- While editing, use `npm run test:changed` (changes since HEAD, including staged/unstaged/untracked files), `npm test -- <test-file-or-filter>`, or `npm run test:watch -- <filter>`. For committed changes, use `npx vitest run --changed origin/preview` for feature work or `origin/main` for release work.
- Prioritize fast iteration and manual verification. Run focused tests for changed behavior and typecheck when TypeScript changes; do not run full verification/release gates automatically for routine publishing.
- Visually inspect UI changes at desktop and narrow sizes, including loading where relevant. Use representative browser tests when they provide useful coverage, not the entire matrix by default.
- For deployment tooling, run the affected deployment tests. Reuse unchanged app builds and pinned engine artifacts. `npm run verify:release` remains an optional broad audit, not a publishing prerequisite.
- Changed-test selection follows imports and can miss CSS, assets, readFile fixtures and build configuration. Apply the broader commands above even when it selects zero tests. A zero-test run is not verification.
- Engine changes need the separately provisioned `REQUIRE_ENGINE=1 npm run e2e`. Missing artifacts are an explicit coverage limitation, not success.

## What deserves a test

Protect meaningful behavior: protocol/order, commands, persistence, scene/rendering, lifecycle, accessibility, security and deployment. Add the smallest regression that fails for the bug being fixed. Prefer observable results over private fields and call sequences. Do not add tests for cosmetic copy/order or trivial helpers solely to increase counts. Remove redundant cases when changing their area; keep meaningful boundaries and independent visual oracles. No coverage-percentage quota.

Keep isolated tests, deterministic fixtures and zero browser retries. Use fake time for unit timing; retain deliberate real-time observation windows that prove animation loops sleep. Avoid public-server dependencies in automated gates. Keep performance evidence outside the default suite; do not add wall-clock assertions to CI.

## Commands and reporting

project-notes/RUNBOOK.md is the command reference; project-notes/BASELINE.md records timings and coverage tradeoffs. Browser failures retain traces/screenshots under ignored test-results/. Keep strict loopback server ports so checks cannot accidentally use another checkout. Report commands, results, skips and limitations accurately. Never claim deployment or physical-device acceptance from local tests.
