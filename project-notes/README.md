# Current engineering baseline

Start with [feature entry points](ARCHITECTURE.md#common-change-entry-points) and the [runbook](RUNBOOK.md). [STATUS.md](STATUS.md) explains how to identify the checked-out and deployed versions. Historical release evidence lives under `releases/`.

| Document | Purpose |
|---|---|
| [STATUS.md](STATUS.md) | Current implementation/release state and limitations |
| [../AGENTS.md](../AGENTS.md) | Fast iteration policy for coding agents |
| [STABILIZATION.md](STABILIZATION.md) | Completed 0.3.68 stabilization scope and review |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Package responsibilities and state/presentation boundaries |
| [DECISIONS.md](DECISIONS.md) | Decisions introduced by the simplification |
| [BASELINE.md](BASELINE.md) | Current validation results and coverage limits |
| [RUNBOOK.md](RUNBOOK.md) | Development and verification commands |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production safeguards, source identity, release and rollback |
| [BACKLOG.md](BACKLOG.md) | Remaining actionable work and known limits |

Before continuing: inspect repository and ancestor instructions, status, HEAD and remotes; preserve unrelated work. Never infer current test results or deployment identity from historical releases. Keep server state authoritative and record measured checks and untested cases separately. No credentials, tokens, raw private recordings or local environment files belong in Git.
