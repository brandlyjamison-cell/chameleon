# Monorepo tree

One line per package, with the boundary stated. Turborepo, pnpm workspaces. The
boundary column is enforced by `eslint-plugin-boundaries` (INV-ARCH-01).

```
chameleon/
├── apps/
│   ├── control/            Next.js dashboard, auth, admin, public API, demo page.
│   │                       Boundary: may import contracts, skeleton (server-only),
│   │                       db, engine, crypto wrapper. Never imports cloudflare bindings.
│   ├── edge/               Workers + Hono. Resolution, render, capture POST, assets, 404,
│   │                       vault proxy handler. Boundary: may import contracts, skeleton,
│   │                       engine, crypto, db (edge_ro). Never imports next/*.
│   └── pipeline/           Workers, queue + cron. Capture consume, profile crawl, sweeper,
│                           webhook out, janitor, demo reset. Boundary: no HTTP surface;
│                           may import contracts, db, engine hooks, crypto.
├── packages/
│   ├── contracts/          Zod schemas + types for resolve, capture, vault, 404 constant.
│   │                       Boundary: zero runtime deps except zod; no bindings, no db.
│   ├── skeleton/           Pure renderer for the one/two-step shell. Boundary: sync,
│   │                       no fetch, no Date, no bindings; imported by edge and by control
│   │                       server components only.
│   ├── engine/             Engine interface, registry, chameleon impl, aitm stub, echo
│   │                       fixture. Boundary: the only place `serviceType` is compared.
│   ├── db/                 Drizzle schema, migrations, RLS assert, repos. Boundary:
│   │                       exports repos only; the raw client is internal.
│   ├── crypto/             Seal/open, token HMAC, passcode KDF, DEK wrap, webhook HMAC.
│   │                       Boundary: no db, no HTTP; all inputs/outputs are bytes.
│   ├── brandmap/           Brand seed data, colour extraction, label defaults, asset
│   │                       transforms. Boundary: data + pure functions; writes no KV.
│   ├── ui/                 Dashboard components, tokens, table primitives. Boundary:
│   │                       client-safe, no server imports.
│   ├── config/             tsconfig, eslint, tailwind presets, env schema. Boundary:
│   │                       build-time only.
│   └── testkit/            Factories, seeded orgs, fake bindings, clock. Boundary:
│                           dev-only; may import everything.
├── infra/
│   ├── cloudflare/         wrangler.jsonc per unit+env, KV/R2/Queue/DO declarations.
│   ├── vps/                Caddyfile, systemd units, release script, backup timer.
│   ├── neon/               project/role bootstrap, branch notes.
│   └── github/             workflow templates, CODEOWNERS.
├── docs/
│   └── greenfield-saas/    this tree
├── tools/                  seed-brands, assert-rls runner, load harness, key rotation job
├── .github/workflows/      ci, deploy-edge, deploy-pipeline, deploy-control, nightly
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Dependency rules

| Package | May import |
| --- | --- |
| contracts | zod |
| skeleton | contracts |
| engine | contracts, skeleton, brandmap |
| crypto | contracts |
| db | contracts |
| brandmap | contracts |
| ui | contracts, ui |
| control | contracts, db, engine, skeleton, crypto, ui, brandmap |
| edge | contracts, db, engine, skeleton, crypto, brandmap |
| pipeline | contracts, db, engine, crypto, brandmap |

Forbidden everywhere: `apps/*` importing another `apps/*`; `contracts` importing
anything but zod; `skeleton` importing db/crypto; anything but `control` importing
`ui`; `edge` importing `next/*`; `control` importing `cloudflare:*`.

## Why `brandmap` and `skeleton` are separate

Both are shared by the edge and the control preview, and both must stay
runtime-neutral. Splitting them keeps `engine` from becoming the only place third-
party data lives, and lets the brand seed job run without the edge bundle.

## Why `pipeline` is an app, not a package

It has its own deploy, its own secret set, and its own scaling. A package would
invite importing it from the edge and dragging `pg` into a render.

Last reviewed: 2026-11-20
