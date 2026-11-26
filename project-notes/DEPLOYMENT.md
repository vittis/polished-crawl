# Production deployment

Production is served by the **dcss-client** Worker at [polished-crawl.com](https://polished-crawl.com/) and [dcss-client.vittis.workers.dev](https://dcss-client.vittis.workers.dev/). Preview uses **dcss-client-preview** at [preview.polished-crawl.com](https://preview.polished-crawl.com/). Both deploy from `vittis/polished-crawl`. The [legacy repository](https://github.com/vittis/orbrun) preserves historical source and CI links.

## Scope and safeguards

The app Worker serves the client, the bounded gamedata/morgue proxies, and the tested Stable and Trunk engine pair as static files under `/engine/`. Public WebSockets connect directly to the bundled servers. Players install the device engines through **Play Offline**. Offline characters stay in the browser on the origin where they were created. The recorded menu uses `/menu/` independently. The retired `/menu-engine/` route returns 404.

Each successful Deploy preview run retains its verified engine pair as the `offline-engines` artifact for 30 days. A push to `preview` restores and tests that pair with the new app. Manual runs and the daily refresh check upstream and build any changed channels. The schedule is 04:37 UTC and takes effect once the refresh workflow reaches the default branch. Pushes and refreshes share the same deployment queue. Run `gh workflow run preview.yml --ref preview` to check for engine updates or replace a missing or expired preview artifact. The production release downloads the pair from the owner-selected preview run. If its artifact has expired, verify a fresh preview candidate. [Building and verifying the engines](../engine/DEPLOYMENT.md)

Preserve `apps/orbrun/public/_headers`: same-origin executable scripts, blocked inline script attributes, objects and frames, no JavaScript `unsafe-eval`, Wasm compilation restricted to the dedicated engine worker, nosniff and referrer restrictions. Preserve the Acorn MIT notice at `/licenses/acorn.txt`, all font/DCSS/upstream notices and the exact corresponding-source offer. Packed-art rectangle/version provenance is not a per-tile license certification; [ATTRIBUTION.md](../ATTRIBUTION.md) retains this limitation.

The proxy validates exact bundled HTTPS host:port destinations before cache lookup, rejects redirects, drops query variants from cache identity and applies deadlines, byte/concurrency limits and bounded development caching. Parser, transport and session queues remain bounded. Residual limits: bundled-host DNS/TLS trust, no DNS pinning, no distributed abuse budget, and no exhaustive semantic validation of every nested protocol field. Generated gamedata syntax/helper changes fail closed. These are independent of renderer choice.

## Feature work and preview

1. Give parallel feature agents separate worktrees and branches. Run `git fetch origin preview` first. For a new worktree, for example, use `git worktree add -b codex/map-keys ../crawl-map-keys origin/preview`. In an existing clean, detached worktree, use `git switch -c codex/map-keys origin/preview`. Choose a unique branch name for each task. Open the feature or fix PR with `--base preview`, including for small changes. Include focused verification and a player-facing note. Version and changelog changes belong in release preparation.
2. Both long-lived branches require a PR, a green GitHub Actions `baseline` check and a merge commit. The solo owner can merge their own PR. Verify selects checks from the diff. A prose-only green can mean that no app tests ran.
3. A push to `preview` queues the preview Worker deployment. The job checks the remote tip before invoking Wrangler. Old reruns fail if superseded. A newer pending run can replace an older pending run. Wait for the run for the commit you intend to test.
4. You can merge several ready PRs and test the combined result. Open the preview site, match its Source link to the successful run for that combined commit, and test the affected behavior. Keep the run URL, tested SHA and observations together. The automated probe checks the homepage, its `noindex` header and the JavaScript entry asset. Preview disables production analytics and offers both device play and connections to real DCSS servers. For online checks, use anonymous spectating or an authorized test character.

[Hosted preview](https://preview.polished-crawl.com/) · [Deploy preview runs](https://github.com/vittis/polished-crawl/actions/workflows/preview.yml)

## Prepare and publish a batch

1. Identify the live source from the production homepage and active Cloudflare version. Review changes since that tag. Open a release-preparation PR into `preview` with a fresh version and curated notes. For a patch use `npm version patch --workspace apps/orbrun --no-git-tag-version`; the app and lockfile must agree. Start `CHANGELOG.md` with `## <version> — YYYY-MM-DD`. The in-app What’s New and the GitHub Release use that file.
2. After the preparation PR merges, test its deployed SHA as above. Open the release PR into `main` from `preview`. If more work is landing, create a short-lived `release/<version>` branch **at the tested SHA** and use that as the PR head. Put the preview run URL, full SHA, included changes and manual results in the PR. Recheck the head before merging. Any new candidate needs its own preview run and acceptance.
3. Merge with **Create a merge commit**. Verify checks that the proposed merge tree equals the candidate tree. If integrating `main` or resolving conflicts changes the result, bring that change through preview and test it. Merging to main prepares production for the owner.
4. When ready to go live, the owner opens **Actions → Release Polished Crawl → Run workflow**, selects **main**, and enters the numeric ID at the end of the accepted Deploy preview run URL. An agent acting on an explicit publish request must be authenticated as the owner. This dispatch publishes. It checks the run, the merge’s second parent and the complete Git tree, validates the version and notes, runs deployment tests, and packages the production Worker with its own build settings. For a local packaging rehearsal, provision both channels in `engine/dist` from the tested preview artifact or the engine build, then use `npm run deploy:check -- --env=""`.
5. The publisher reserves an annotated `polished-crawl-v<version>` tag at the main merge, deploys, confirms the public source link, indexing header, entry module and 100% Worker version, then creates the GitHub Release. The tag stores the previous deployment and rollback version IDs. The run summary records them along with the new serving version. Record the affected production smoke checks in the release PR.

The preview and production artifacts differ in source links, analytics and indexing configuration. The merge check establishes identical tracked source. The hosted probe establishes a responding app entry point. Exercise changed behavior on the actual site.

[Release Polished Crawl](https://github.com/vittis/polished-crawl/actions/workflows/release.yml) · [Production](https://polished-crawl.com/)

## Urgent fixes

Use the same preview evidence and release path for a small hotfix. Start by identifying the live tag and which changes would ship with the fix. If preview contains unfinished features, save its tip on a short-lived branch and use a reviewed PR to take the unfinished changes out of the candidate. Include the hotfix, fresh version and notes, test preview, then promote it normally. Reintroduce the held changes through a PR that retains the hotfix. Apply the same procedure when main contains a prepared but unpublished batch. If players need immediate relief, use the known-good Cloudflare version below while preparing the fix.

## Failed publication and rollback

Check the run summary, the tag (`git fetch origin tag polished-crawl-vX.Y.Z` followed by `git for-each-ref --format='%(contents)' refs/tags/polished-crawl-vX.Y.Z`), the production Source link, and **Cloudflare → Workers & Pages → dcss-client → Deployments**. A failed Action can coincide with a live release.

| Observed state | Owner action |
|---|---|
| Failure before tag reservation | Correct the cause. Rerun the original release for the same candidate while its merge remains current. |
| Tag reserved, original Cloudflare deployment still active | Rerun the original Action. It uses the existing tag and uploads only while the selected merge is still the tip of main. |
| Tagged version already serving, hosted check or GitHub publication failed | Rerun the original Action. It verifies the active version and public asset, then creates any missing Release. This can finish after main advances. An existing matching Release completes successfully. |
| Cloudflare deployment changed, traffic is split, or tag/Release metadata conflicts | Inspect history before proceeding. An intentional rollback gets its own deployment ID. Keep protected source tags in place and use a fresh version for a corrected candidate. |

To roll back, select the **previous Worker version ID** from the release summary or tag in **dcss-client → Deployments → ⋯ → Rollback**. Verify that version serves 100%, check the source and affected behavior on **polished-crawl.com**, and record the decision in the release PR. The custom domain and the workers.dev address are separate entry points. A GitHub Release records what was published; after rollback Cloudflare and the custom domain identify what serves. If an active publish is still running, stop it and confirm its state before the rollback.

## Authority and configuration

- Each GitHub environment allows only its corresponding branch (`preview` or `main`) and contains its own account ID and Worker-scoped Cloudflare Editor token. The custom domains are attached in Cloudflare. Keep automatic production Git builds disconnected. Keep `PRODUCTION_RELEASE_ENABLED=true` in production when manual publishing is enabled.
- Preview has a read-only repository token. Production publication requires the original and rerunning actor to be the repository owner. Only the publishing job requests repository write access. Review changes to workflows and invoked build scripts as deployment-authority changes.
- The repository rulesets protect `main` and `preview` against direct pushes, force pushes and deletion. Their required check is `baseline` from GitHub Actions. In the **Preserve release tags** ruleset, include `polished-crawl-v*` alongside `v*` and `cloudflare-online-*`. Restrict updates and deletions, and allow the publishing workflow to create tags. Manage the public analytics settings through the repository Actions variables `VITE_UMAMI_WEBSITE_ID` and optional `VITE_CF_BEACON_TOKEN`.

[Repository rules](https://github.com/vittis/polished-crawl/settings/rules) · [GitHub environments](https://github.com/vittis/polished-crawl/settings/environments) · [Cloudflare Worker permissions](https://developers.cloudflare.com/workers/authorization/)

## Production checks

Check root and About, the intended version and immutable source links, 2.5D replay menu/gameplay, anonymous lobby/spectating, supporting flat maps and restoration where local/production fixtures permit, and desktop/narrow layouts. Retrieve a representative real versioned gamedata file. Confirm response CSP and rejection of an unlisted proxy host. Avoid disruptive public tests, chat sends and credential use.

Report hardware, authenticated-play, unavailable live games and unprovisioned development-engine checks honestly. Capture small evidence without secrets. Do not call deployment successful without observed hosted identity matching the intended release.

## Release records

Find release notes and tagged commits in [GitHub Releases](https://github.com/vittis/polished-crawl/releases) after the cutover. The [build changelog archive](releases/legacy-changelog.md) preserves numbering from before the `0.1.1` release. Use Cloudflare Deployments and the hosted link to establish what's live, including after rollback. Historical evidence is retained for [0.3.69](releases/0.3.69.md), [0.3.68](releases/0.3.68.md) and [0.3.67](releases/0.3.67.md).
