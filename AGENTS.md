# Working on Polished Crawl

Keep the existing 2.5D gameplay presentation and flat supporting maps. Preserve server-authoritative state, confirmed combat/visibility, storage compatibility, and production's online-only boundary. Start with the feature entry points in [ARCHITECTURE.md](project-notes/ARCHITECTURE.md#common-change-entry-points) and the verification commands in [RUNBOOK.md](project-notes/RUNBOOK.md).

## From feature worktree to production

| Assignment | What to do and hand back |
|---|---|
| **Develop a feature or fix** | Give each independent task its own worktree and `codex/<topic>` branch from freshly fetched `origin/preview`. Commit to that branch and open a PR with `--base preview`, even for a one-line fix. Include the PR link, checks run and a player-facing note when applicable. Leave the version and changelog for release preparation. |
| **Verify preview** | The owner can merge several ready PRs and test them together. Wait for **Deploy preview** on the combined commit. Match its full SHA to the Source link on the shared preview site and record the run URL, SHA and observations. If the site advances during testing, identify which build you actually accepted. |
| **Prepare a release** | One agent collects the batch notes and opens a version, lockfile and changelog PR into `preview`. After it merges, get acceptance for that deployed candidate. Open the release PR into `main` with the accepted run URL, full SHA and manual results. When features keep landing, use `release/<version>` pinned at the accepted SHA as the PR head. |
| **Publish a release** | After the release PR merges and the owner explicitly asks to publish, dispatch **Release Polished Crawl** on `main` under the owner's GitHub identity with the accepted preview run ID. Report the GitHub Release URL, verified production source and active Cloudflare Worker version. |

Both protected branches require a PR, a green `baseline` check and a merge commit. The owner can merge their own PR. Use the [deployment runbook](project-notes/DEPLOYMENT.md) for commands, urgent fixes, interrupted publishes and owner-directed rollback.

## Branch and worktree cleanup

When cleanup is requested, follow the [repository cleanup runbook](project-notes/RUNBOOK.md#clean-up-branches-and-worktrees). Keep `main`, `preview`, release tags, branches or detached heads with unique commits, and worktrees with local changes. End a merged task by identifying its disposable branch and idle worktree in the handoff. Archive Codex-managed worktrees through Codex.

## Fast iteration

- Inspect `git status` first and preserve unrelated edits. Install dependencies only when missing or the lockfile changed. Chromium is needed only for browser checks.
- While editing, use `npm run test:changed` (changes since HEAD, including staged/unstaged/untracked files), `npm test -- <test-file-or-filter>`, or `npm run test:watch -- <filter>`. For committed changes, use `npm run test:since -- origin/preview` for feature work or `origin/main` for release work. `npm run verify:scope -- origin/preview` lists the applicable CI commands.
- Prioritize fast iteration and manual verification. Run focused tests for changed behavior and typecheck when TypeScript changes; do not run full verification/release gates automatically for routine publishing.
- Visually inspect UI changes at desktop and narrow sizes, including loading where relevant. Use representative browser tests when they provide useful coverage, not the entire matrix by default.
- For deployment tooling, run the affected deployment tests. Reuse unchanged app builds and pinned engine artifacts. `npm run verify:release` remains an optional broad audit, not a publishing prerequisite.
- Changed-test selection follows imports and can miss CSS, assets, readFile fixtures and build configuration. Apply the broader commands above even when it selects zero tests. A zero-test run is not verification.
- Engine changes need the separately provisioned `REQUIRE_ENGINE=1 npm run e2e`. Missing artifacts are an explicit coverage limitation, not success.

## What deserves a test

Protect meaningful behavior: protocol/order, commands, persistence, scene/rendering, lifecycle, accessibility, security and deployment. Add the smallest regression that fails for the bug being fixed. Prefer observable results over private fields and call sequences. Do not add tests for cosmetic copy/order or trivial helpers solely to increase counts. Remove redundant cases when changing their area; keep meaningful boundaries and independent visual oracles. No coverage-percentage quota.

Keep isolated tests, deterministic fixtures and zero browser retries. Use fake time for unit timing; retain deliberate real-time observation windows that prove animation loops sleep. Avoid public-server dependencies in automated gates. Keep performance evidence outside the default suite; do not add wall-clock assertions to CI.

## Commands and reporting

Use the [engineering guide](project-notes/README.md) for task-specific references and the [benchmark record](project-notes/BASELINE.md) for historical timings and coverage tradeoffs. Browser failures retain traces/screenshots under ignored test-results/. Keep strict loopback server ports so checks cannot accidentally use another checkout. Report commands, results, skips and limitations accurately. Never claim deployment or physical-device acceptance from local tests.
