# Contributing to Polished Crawl

Open feature and fix PRs against `preview`. Give each independent change a branch from freshly fetched `origin/preview`. Include the checks you ran and a player-facing note where applicable. The release-preparation PR collects those notes and bumps the app version. [Agent workflow](AGENTS.md) · [Release process](project-notes/DEPLOYMENT.md)

## Develop and verify

Use the [runbook](project-notes/RUNBOOK.md) to install the web toolchain, start Vite and choose checks for your change. The [architecture guide](project-notes/ARCHITECTURE.md#common-change-entry-points) maps features to the owning modules and their tests.

Use local fixtures for malformed traffic and an explicitly authorized disposable account for authenticated checks. Keep credentials, private recordings and local environment files out of Git. Vite exposes `VITE_` variables in the public bundle.

## Artwork and recordings

Ordinary builds use committed assets. When changing bundled scenery, use the [room fixture guide](apps/orbrun/public/room/README.md) for the pinned atlas and poster. See [menu recording provenance](apps/orbrun/public/menu/README.md) for replay sources. The brand artwork generator, `tools/build/brand.mjs`, requires ImageMagick and librsvg. Preserve source offers, version and tile provenance, and license notices. [Attribution](ATTRIBUTION.md)

Report issues in the [Polished Crawl repository](https://github.com/vittis/polished-crawl/issues).
