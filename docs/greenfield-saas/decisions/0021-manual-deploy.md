# ADR 0021 — Manual deploy; the gate now also runs in CI

Status: accepted (2026-11-20)

## Context

The GitHub account available today has an unreliable Actions allowance. A pipeline
that silently does not run is worse than no pipeline: the docs would claim a gate
that is not there. The team is one engineer, so "manual" is not a coordination
cost.

## Decision

Amended 2026-11-21: the free Actions allowance proved usable (Workers Paid and a
second build pass since), so `.github/workflows/ci.yml` runs the same gate on pull
requests and `main`. **Deploy is still manual** — no workflow holds the VPS key.

The gate is `scripts/gate.mjs`, run by:

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
- A red PR is red on GitHub too; the local hook and CI run the same steps, so
  neither is stronger than the other.
- CI holds a dev-branch database, never production. Without the four repo secrets
  the db suites skip and the workflow still lints, typechecks and tests the rest.
- Deploy is a human at a terminal; every deploy is at least a minute of attention,
  which is acceptable at this size.
- Anything that truly needs a machine (nightly restore drill, synthetic checks)
  runs on the VPS cron, not on GitHub.

## Rejected

- ~~Actions with an unreliable account.~~ Re-evaluated 2026-11-21: the account
  works, and a PR check nobody can skip is worth it.
- **Self-hosted runner on the VPS.** A second moving part before there is a product.

## Trigger to revisit

Add Actions when any of: a second engineer, deploys more than daily, or a check
that must run on a machine other than the author's (restore drill, load test).

## Reversal cost

Low. The gate steps already exist as scripts; a workflow calls the same
`pnpm run ci`.

Last reviewed: 2026-11-21
