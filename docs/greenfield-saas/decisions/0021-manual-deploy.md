# ADR 0021 — Manual deploy and a local gate, no CI pipeline

Status: accepted (2026-11-20)

## Context

The GitHub account available today has an unreliable Actions allowance. A pipeline
that silently does not run is worse than no pipeline: the docs would claim a gate
that is not there. The team is one engineer, so "manual" is not a coordination
cost.

## Decision

No `.github/workflows`. The gate is `scripts/gate.mjs`, run by:

- `pre-commit` → fast subset (secrets, lint, typecheck).
- `pre-push` → full (adds format, boundary self-test, client-resolution check,
  tests).
- `pnpm run ci` by hand before any push.

Deployment is `scripts/deploy.mjs <unit> <env>`, one unit at a time, staging
before production. The script prints its plan, runs the gate, and refuses to
continue on a red tree.

Branch protection needs GitHub Pro on a private repo (403 from both the protection
and ruleset APIs). Resolved 2026-11-20 by making the repo public: a ruleset blocks
deletion and force-push on `main` and requires a pull request, with zero required
approvals because there is one account.

## Consequences

- The gate cannot be skipped by pushing a branch; only `--no-verify` can, and that
  is visible in the log.
- No green checkmark on GitHub. Status lives in the PR body checklist.
- Deploy is a human at a terminal; every deploy is at least a minute of attention,
  which is acceptable at this size.
- Anything that truly needs a machine (nightly restore drill, synthetic checks)
  runs on the VPS cron, not on GitHub.

## Rejected

- **Actions with an unreliable account.** Red builds that nobody sees train people
  to ignore red.
- **Self-hosted runner on the VPS.** A second moving part before there is a product.

## Trigger to revisit

Add Actions when any of: a second engineer, deploys more than daily, or a check
that must run on a machine other than the author's (restore drill, load test).

## Reversal cost

Low. The gate steps already exist as scripts; a workflow calls the same
`pnpm run ci`.

Last reviewed: 2026-11-20
