# Chameleon

Multi-tenant link-rotation SaaS. Two service types (`chameleon` now, `aitm`
later), two planes, Postgres, Workers.

Docs are canonical and live in `docs/greenfield-saas/`. Read
`docs/greenfield-saas/README.md` before anything else; the repo is not
self-explanatory and the docs win over the code.

## Run

```sh
corepack enable
pnpm install          # also points git at .githooks
pnpm run ci               # the full gate: secrets, format, lint, boundaries, types, tests
```

The gate runs on commit (fast) and push (full). There is no CI pipeline;
deployment is manual by decision — see `decisions/0021-manual-deploy.md`.

```sh
node scripts/deploy.mjs edge staging --dry-run
```

## Status

Stage 1 of 10 (`docs/greenfield-saas/plan/stages.md`). Placeholder handlers
only; every request 404s until stage 5.

## Layout

Boundaries per package are in `docs/greenfield-saas/plan/repo-tree.md` and are
lint-enforced: `apps/*` never import each other, the edge never imports Next,
the control plane never imports a Worker binding.
