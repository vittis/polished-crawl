# Engineering guide

Start with the [agent workflow](../AGENTS.md) for branch choice, PR handoff and release authority. Use the page for the task at hand.

| Task | Where to start |
|---|---|
| Find the code and tests for a feature | [Architecture and common change entry points](ARCHITECTURE.md#common-change-entry-points) |
| Start the app, select checks or reproduce a browser failure | [Development and verification runbook](RUNBOOK.md) |
| Verify shared preview, prepare a batch, publish or recover a release | [Deployment runbook](DEPLOYMENT.md) |
| Build or test the optional offline engine locally | [Engine build instructions](../engine/DEPLOYMENT.md) |
| Profile a rendering or latency regression | [Benchmark commands and historical measurements](BASELINE.md) |
| Investigate known coverage gaps or compatibility limits | [Backlog](BACKLOG.md) |
| Check bundled artwork or recording provenance | [Attribution](../ATTRIBUTION.md), [room fixtures](../apps/orbrun/public/room/README.md), [menu recordings](../apps/orbrun/public/menu/README.md) |

## Identify a version

For the current checkout, compare the [app version](../apps/orbrun/package.json) with the top [changelog section](../CHANGELOG.md). For shared preview, match the site's Source SHA to a successful Deploy preview run. For production, match the Source tag on polished-crawl.com to the active Cloudflare Worker version. After a rollback, the latest GitHub Release can differ from what players see.

## Historical references

[Release records](releases/) preserve checks and screenshots for specific builds. The [0.3.68 stabilization report](STABILIZATION.md) records that project's assignments and outcomes. The [menu design references](design/polished-crawl-menu/) show the original mockup. For current menu behavior, use the [shell architecture](ARCHITECTURE.md#polished-crawl-shell).
