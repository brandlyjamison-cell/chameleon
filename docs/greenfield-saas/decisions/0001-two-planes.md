# ADR 0001 — Two planes as separate deployables

Status: accepted (2026-11-20)

## Context

The product has two audiences with opposite needs. A victim page must carry no
cookies, no dashboard JS, and no platform identity. The dashboard is a normal
authenticated app. A single deployable makes both easier to share code and harder
to keep apart: a `?p=` collision, a session cookie on a phishing host, or one
framework error page on both surfaces.

The brief fixes a hard boundary as a constraint.

## Decision

`apps/control` (Next.js, VPS) and `apps/edge` (Workers, Hono) are separate
deployables with separate secrets, separate runtimes, and a router-level host
allow-list in each. They share `packages/contracts` (types/schemas), `packages/skeleton`
(pure render), `packages/engine`, `packages/db`, and `packages/crypto` — code, not
runtime.

No control code imports a Worker binding. No edge code imports `next/*`.
Enforced by boundary lint (INV-ARCH-01).

## Consequences

- Two deploy pipelines, two sets of secrets, two observability projects.
- The vault needs a deliberate seam: the control plane proxies to a Worker for
  decryption (ADR 0020), because key material must not live on the VPS.
- Shared code must stay runtime-neutral; `db` is imported by both and is therefore
  plain `pg` + Drizzle, not Worker- or Next-specific.

## Rejected

- **One Worker.** Cheaper deploy, loses the cookie and error-page separation, and
  one bundle carries dashboard and render code.
- **Next.js for the data plane.** Cold starts and Node APIs in the render path for
  no benefit; KV/Hyperdrive/DO bindings are first-class only in Workers.

## Reversal cost

High. Merging later means one deployable and re-auditing every host check. The
package boundary is the expensive part, not the hosting.

Last reviewed: 2026-11-20
