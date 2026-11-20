# Roadmap

Ten stages to a launchable chameleon service, then aitm. Every stage is shippable
to staging, has acceptance criteria, and leaves the product in a state a tenant
could survive. Nothing is "done" until its criteria pass on staging and the doc it
touches is current.

## Shape

| Stage | Name                        | Ships                                         |
| ----- | --------------------------- | --------------------------------------------- |
| 1     | Skeleton repo and contracts | workspace, CI, 404 constant, contract tests   |
| 2     | Schema, RLS, repos          | migrations, isolation suite, counters         |
| 3     | Auth and org                | Better Auth, orgs, service provisioning shell |
| 4     | Domains                     | TXT verify, CF for SaaS, tombstones           |
| 5     | Links and resolution        | minting, signed tokens, KV, unbranded 404     |
| 6     | Templates                   | skeleton, brand map (30), assets, profiles    |
| 7     | Capture pipeline            | seal, queue, consumer, dedupe, prune          |
| 8     | Vault and gate              | passcode, DEK wrap, vault, export             |
| 9     | Billing and expiry          | NowPayments, flags, sweeper, warnings         |
| 10    | Demo, admin, hardening      | demo, admin, observability, launch            |

## Release gates

A stage does not start until the previous one's criteria pass. Two stages may run
in parallel only where the dependency graph in `plan/stages.md` allows it (6 and
7 do; 5 and 8 do not).

Launch (end of stage 10) requires, without exception:

1. All P0 invariants have an automated check that runs in CI.
2. A full campaign run on a real domain by a real tenant for 7 days.
3. Expiry proven by dropping webhooks and letting the sweeper fire.
4. A restore rehearsal from Neon PITR.
5. Load test: 500 rps sustained for 30 min with capture yield > 39.5%.
6. Every `OPEN:` that blocks launch closed.

## Post-launch order

1. AitM engine (six weeks after 20 paying tenants), behind a feature flag on the
   service catalogue. No link or capture contract change; see
   `arch/aitm-service.md`.
2. Profile editing UI for tenants (`OPEN-TPL-02` decision first).
3. Optional one invited member per org.
4. Combined invoicing if churn analysis says multi-service tenants are real.
5. Shared-domain pool for the demo and as a paid add-on.

## What 1.0 means

One tenant, one chameleon service, Starter or Pro, can:

- verify two domains,
- mint five links,
- mail them,
- collect captures into a gated vault,
- export them,
- and lose it all cleanly at expiry with a bare 404.

AitM, seats, card payments, and tenant-uploaded templates are not 1.0.

## Sequencing risks

- **Stage 2 before any UI.** Retrofitting RLS after dashboard code is how leaks
  happen; the isolation suite must exist before a route does.
- **Stage 7 before stage 8's cap work.** The cap and prune are consumer-side; the
  vault read path assumes pruning already exists.
- **Stage 9 late but not last.** Expiry is the commercial teeth; if it slips past
  the first paying tenant, the product is free.
- **Stage 6 profile generation can slip** to a fast follow if the 30 brands land;
  the cPanel fallback covers unmapped domains meanwhile.

## Cost checkpoints

Review at stage 4, 7, and 10: R2 egress for assets, Worker subrequests per render,
Neon compute hours, Axiom ingest. If a render exceeds 12 ms CPU p50 or 60 KB, cut
the backdrop layer before cutting the capture path.

Last reviewed: 2026-11-20
