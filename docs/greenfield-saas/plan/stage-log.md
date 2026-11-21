# Stage log

Append-only. One entry per stage: what shipped, what the gate proves, what was
deferred and why. Newest last.

## Stage 1 — complete 2026-11-20

Gate: secrets, format, lint, boundary self-test, no-client-resolution, typecheck,
19 tests. Fresh clone verified green into a temp dir.

Deferred: Linux run of the gate (no Linux host yet; the VPS at stage 4 carries it).

## Stage 2 — complete 2026-11-20

Shipped: full schema (23 tenant tables), forced RLS with per-tenant policies plus a
service-scoped `edge_ro` read policy, trigger-maintained slot counters, 15-minute
dedupe index, oldest-first prune with `prune_queue`, domain activation and
tombstone guards, append-only audit/invoice/webhook triggers, repos with
`withTenant`, `assert-rls`, migration runner, PITR rehearsal.

Gate proves: 24 tests — zero rows without a GUC, foreign rows invisible and
unwritable, foreign insert rejected, direct counter writes rejected, exactly 20 of
30 concurrent mints survive, cap kept on domains and captures, oldest pruned,
dedupe collapses a resubmit, tombstone blocks another org but not its own revive,
`assert-rls` fails on an unprotected table, PITR branch restores an exact count.

Notes and deviations:

- The Neon key is an **organisation key scoped to one existing project** (`cameleon`,
  `aws-us-east-2`, PG 18), so the project and its `production` branch were reused
  rather than created. A `dev` branch is the only branch with data.
- `pgcrypto` cannot be created by the project owner, so `gen_random_uuid()` (core
  since PG 13) is used instead.
- Counter and prune functions are `SECURITY DEFINER`, owned by `app_admin`, because
  the trigger fires as `app_rw` and that role has no update on the counter columns.
  `app_migrator` is a member of `app_admin` for ownership.
- Connection strings are generated into `.env.db` (gitignored) by
  `packages/db/scripts/bootstrap-roles.mjs`; they are not in `.env` because the
  bootstrap rotates them.

Deferred: staging branch (stage 9), Hyperdrive (edge deploy, stage 4), pooling
beyond the client pool, the counter trigger's `FOR UPDATE` contention at 250k-scale
services.

## Stage 3 � complete 2026-11-21

Shipped: Better Auth (email+password, passkeys, signed verification links), the
`auth_*` identity tables plus a `users` mirror, org provisioning on signup,
service creation in `provisioning`, single-transaction activation (passcode
verifier, AES-KW DEK wrap, `activated_at`, token secret, 30-day clock), the
resume path, owner guard, tenant-scoped service routes and the dashboard shell
(signup, login, welcome, list, card, passkeys).

Gate proves: 10 new tests � hardened cookie flags on signup, org + owner
membership created, no plaintext password, unverified can create but not
activate, activation is idempotent and a second passcode is refused,
`dek_wrapped` never leaves the API, member gets `403`, foreign id is `404` on API
and page, idle and absolute expiry both rejected. Existing 40 db tests still pass.

Notes and deviations:

- Session idle/absolute split is deliberate: 1800 s rolling token plus a 12-hour
  `createdAt` check in `requireSession` (ADR 0024).
- Password hashing is Better Auth's scrypt, not the Argon2id in
  `arch/security.md`; recorded in ADR 0024.
- Verification is a signed JWT, so no row exists; the link is teed to
  `MAIL_SINK` for tests instead of SMTP.
- `passkey`, `auth_*` are ungranted to `edge_ro`: the edge never needs identity.
- Route modules import `@chameleon/db` only via `apps/control/src/server/*`;
  Turbopack needs extensionless relative imports, so the workspace dropped `.js`
  specifiers.
- Tests boot `next dev` on 3100 from `globalSetup`; a missing `DATABASE_URL_TEST`
  skips the suite rather than failing the gate on a machine without a branch.

Deferred: SMTP delivery, passkey list/delete UI, passcode reset (needs the old
passcode until then), admin panel, VPS deploy (see `OPEN-OPS-05`).

## Stage 4 — code complete 2026-11-21

Shipped: hostname add/list/check/delete (`/api/services/:id/domains`,
`/api/domains/:id`, `/api/domains/:id/check`), the Domains panel on the service
page, DoH TXT checking, tombstone and live-name conflict handling across orgs, the
72-hour expiry, the token-guarded `/api/jobs/domains` route, and a systemd timer
that drives it every five minutes.

Gate proves (11 new tests, 61 total): TXT handed over on create and never the
stored token, bare label refused and a full URL normalised, wrong TXT stays
`verifying` and records a `mismatch`, TXT proven but `cf_entitlement_missing`
leaves the row `verifying` with `verified_at` written, `active` only when
Cloudflare reports the hostname active, direct UPDATE to `active` refused by the
trigger, delete tombstones other orgs for 30 days while the same org revives with
its token, third host on starter is `409 domain_slots_exhausted`, a foreign domain
is `404` on delete and on check and never appears in a list, 72-hour expiry plus
the job token (403 without it). A live host whose TXT disappears goes `failed`,
while an unreachable resolver changes nothing.

Notes and deviations:

- The tombstone rule was RLS-blind on the first cut: the app-side lookup and the
  `before insert` trigger both ran as `app_rw` and could not see another org's row,
  so the second org got `201`. Migration 0008 makes the trigger `SECURITY
DEFINER` owned by the bypassing role and adds two lookup functions (ADR 0025).
- Verification is DoH against `cloudflare-dns.com`, overridable with
  `DNS_JSON_URL`; the suite points it at a local stub that also stubs the
  Cloudflare API, so stage 4 runs offline and without quota.
- `arch/edge.md` says a missing TXT flips a host to `failed`; implemented, but
  only on a real mismatch — a resolver error leaves the status untouched.
- Adding a hostname requires an `active` service; provisioning alone is not enough.

Blocked on the operator: the Cloudflare for SaaS entitlement itself
(`OPEN-OPS-04`). Everything above works without it — rows simply stop at
`verifying` with the TXT proven, and promote by themselves once quota exists.
