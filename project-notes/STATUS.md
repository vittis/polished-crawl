# Current status

Use `apps/orbrun/package.json` and the top section of [CHANGELOG.md](../CHANGELOG.md) to identify the release prepared in the current checkout. For the live version, follow the source link on [polished-crawl.com](https://polished-crawl.com/) and check Cloudflare Deployments. [DEPLOYMENT.md](DEPLOYMENT.md) describes how to publish and verify a release.

Dungeon (2.5D) is the sole gameplay presentation. Flat tiles remain supporting maps/minimap. Floating combat popups, their setting/assets and dedicated engine patches are removed; confirmed world combat and spell effects remain. Existing renderer artwork and algorithms are preserved.

Everyday checks use incremental TypeScript, focused unit tests, representative browser smoke checks and change-aware pull-request CI. See [RUNBOOK.md](RUNBOOK.md) for command selection and [BASELINE.md](BASELINE.md) for measured timings and coverage tradeoffs.

Production play remains online-only on bundled servers. The menu plays curated gameplay recordings through the shared renderer and keeps a static entrance fallback. Development retains optional offline and custom-server capabilities. Physical devices, authenticated acceptance and broader compatibility remain in [BACKLOG.md](BACKLOG.md).

The [0.3.69 release record](releases/0.3.69.md) preserves the earlier stabilization and its exact test and deployment evidence.
