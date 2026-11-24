# Production deployment

Production is served by the **dcss-client** Worker at [polished-crawl.com](https://polished-crawl.com/) and [dcss-client.vittis.workers.dev](https://dcss-client.vittis.workers.dev/). Preview uses **dcss-client-preview** at [preview.polished-crawl.com](https://preview.polished-crawl.com/). Both deploy from `vittis/polished-crawl`. The [legacy repository](https://github.com/vittis/orbrun) preserves historical source and CI links.

## Scope and safeguards

Production serves the client and bounded gamedata/morgue proxies. It offers online play and anonymous spectating on bundled HTTPS/WSS servers. Offline/custom-server UI, ENGINE binding and EVENTS dataset are disabled. Development retains its optional offline integration. The menu serves bundled recordings and matching artwork at `/menu/*`; both `/engine/*` and the retired `/menu-engine/*` return 404. Browser game WebSockets connect directly to DCSS; accounts and saves stay there. Deployment and anonymous smoke checks need no player's credentials.

Preserve `apps/orbrun/public/_headers`: same-origin executable scripts, blocked inline script attributes, objects and frames, no JavaScript `unsafe-eval`, no Wasm evaluation permission, nosniff and referrer restrictions. Preserve the Acorn MIT notice at `/licenses/acorn.txt`, all font/DCSS/upstream notices and the exact corresponding-source offer. Packed-art rectangle/version provenance is not a per-tile license certification; [ATTRIBUTION.md](../ATTRIBUTION.md) retains this limitation.

The proxy validates exact bundled HTTPS host:port destinations before cache lookup, rejects redirects, drops query variants from cache identity and applies deadlines, byte/concurrency limits and bounded development caching. Parser, transport and session queues remain bounded. Residual limits: bundled-host DNS/TLS trust, no DNS pinning, no distributed abuse budget, and no exhaustive semantic validation of every nested protocol field. Generated gamedata syntax/helper changes fail closed. These are independent of renderer choice.

## Preview deployment

Feature and fix PRs target `preview`. The preview Worker builds each push to that branch. The site's Source link names the exact deployed commit. Preview uses the production-shaped online app and connects directly to real DCSS servers. Use anonymous spectating or a test character. The build omits production analytics and preview pages carry `X-Robots-Tag: noindex`.

The [Deploy preview workflow](https://github.com/vittis/polished-crawl/actions/workflows/preview.yml) runs on pushes to `preview`. Its GitHub environment permits only that branch and holds `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` with Editor access to **dcss-client-preview**. The custom domain is attached to that Worker in Cloudflare. CI updates the Worker and verifies the deployed commit and `noindex` header. `npm run deploy:preview -- --dry-run` packages the preview locally. [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) · [Cloudflare Worker permissions](https://developers.cloudflare.com/workers/authorization/)

## Production cutover

1. Verify the preview environment independently. Before merging the manual release workflow into `main`, disconnect **dcss-client** from Git under **Settings → Builds**. Let any active deployment finish and record the serving Worker version ID for rollback. [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/#disconnecting-builds)
2. In GitHub create the **production** Actions environment and limit deployment branches to `main`. Add `CLOUDFLARE_ACCOUNT_ID` and a separate `CLOUDFLARE_API_TOKEN` with Editor access to **dcss-client**. Copy the existing public analytics values into repository Actions variables `VITE_UMAMI_WEBSITE_ID` and, if configured, `VITE_CF_BEACON_TOKEN`. [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) · [Cloudflare credentials for GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/#1-authentication)
3. After confirming the Git integration is disconnected, set the `production` environment variable `PRODUCTION_RELEASE_ENABLED` to `true`. The default dispatch is a dry run. Enable GitHub immutable releases if available and protect `main` with review and the Verify check where appropriate.

## Batch and release changes

1. Merge feature and fix PRs into `preview` after review and the relevant checks. Collect player-facing notes in the PR descriptions.
2. When ready to ship, prepare the candidate on `preview`. Review changes since the last deployed tag and bump the app and lockfile together with `npm version patch --workspace apps/orbrun --no-git-tag-version` for a patch release. Add a top section to `CHANGELOG.md` headed `## <version> — YYYY-MM-DD` with the curated notes. Pause other preview merges while testing that deployed commit. Use the preview site's Source link to confirm the candidate.
3. Open a release PR from `preview` to `main`, link the included PRs and merge with **Create a merge commit** to preserve branch ancestry. If an urgent fix goes directly to `main`, merge it into `preview` before preparing the next batch. Use [Release Polished Crawl](https://github.com/vittis/polished-crawl/actions/workflows/release.yml) on `main` with the prepared version and **publish** unchecked. The workflow checks the release metadata, runs deployment tests and performs a Wrangler dry run. The changelog section becomes the in-app What's New and the GitHub Release body.
4. Run the workflow with **publish** checked and paste the full commit SHA from the dry-run summary into **source_sha**. The workflow checks `main` again, reserves `v<version>` at the selected source commit, deploys with Wrangler, checks the hosted source link, and publishes the matching [GitHub Release](https://github.com/vittis/polished-crawl/releases). If additional PRs land after the release PR, reconcile the notes and scope before dispatching again. New tags use the app version. Historical `cloudflare-online-*` tags remain valid.
5. Check the affected behavior in production and record the run, Cloudflare version ID and any manual checks in the release PR or a linked issue. The Action log contains Wrangler's version ID and the Action summary links to the public release.

For local preparation verification, `node tools/build/release-notes.mjs <version>` prints the notes the workflow will publish. Wrangler uses `tools/build/deploy-build.mjs` to reuse the app bundle between the dry run and deploy when the inputs match. The menu recordings and pinned artwork are checked in and verified during the build.

## Recover from a partial release

If the Action stops after reserving the tag, check the live source link and Cloudflare deployment history. With the same commit still at the tip of `main` and no published GitHub Release, rerun the workflow for that version. It can reuse the same tag and may deploy that commit again. If `main` has changed and the tagged version is already verified live, finish the GitHub Release from the existing tag with the changelog section at that tag. If a code fix is needed, prepare a new version. Keep all source tags at their original commits.

## Production checks

Check root and About, the intended version and immutable source links, 2.5D replay menu/gameplay, anonymous lobby/spectating, supporting flat maps and restoration where local/production fixtures permit, and desktop/narrow layouts. Retrieve a representative real versioned gamedata file. Confirm response CSP and rejection of an unlisted proxy host. Avoid disruptive public tests, chat sends and credential use.

Report hardware, authenticated-play, unavailable live games and unprovisioned development-engine checks honestly. Capture small evidence without secrets. Do not call deployment successful without observed hosted identity matching the intended release.

## Rollback

In Cloudflare Workers → dcss-client → Deployments, select a previously verified deployment. Confirm its source/version and repeat essential smoke checks. Do not move source tags or force-push history. Disabling this Worker's workers.dev route takes only this app offline if necessary. Keep the repository/main and deployed rollback decision documented, and avoid overwriting a newer healthy release from an older checkout.

## Release records

Find release notes and tagged commits in [GitHub Releases](https://github.com/vittis/polished-crawl/releases) after the cutover. Use Cloudflare Deployments and the hosted link to establish what's live, including after rollback. Historical evidence is retained for [0.3.69](releases/0.3.69.md), [0.3.68](releases/0.3.68.md) and [0.3.67](releases/0.3.67.md).
