# Runbook

Anchors referenced by `ops/observability.md`. Each is written for a tired person
at 03:00: what you are looking at, what to check, what to do, when to stop.

Access prerequisites are in `plan/credentials.md`. Nothing here needs a key that
only the founder holds except the KEK rotation.

## Global first moves

1. `openstatus` — is the control host up, is the demo link 200?
2. Axiom → **Traffic** panel, last 15 min.
3. `wrangler tail` is the last resort; it drops under high volume. Prefer Axiom
   queries saved per anchor.
4. Announce in `#incident` with severity and the anchor id. Do not diagnose
   silently.

## RB-01 — Edge 5xx

- Check Cloudflare status page before touching code.
- Axiom: group 5xx by `route` and `service_id`. One service → suspect data; all
  services → suspect a deploy or a binding.
- If it started within 15 min of a deploy: roll back (`wrangler rollback`) first,
  diagnose second.
- If one service: check its KV `l:`/`ent:` docs and rate-limiter DO for a
  pathological value. A malformed KV doc that throws → `wrangler kv key delete`.
- A Worker CPU-limit storm shows as 1102 in `wrangler tail`; roll back.
- Stop when 5xx < 0.5%. Do not restart DO or wipe KV without noting it.

## RB-02 — Queue backlog or dead letters

- Depth only: scale the consumer (`max_concurrency` up), watch Postgres CPU. Do
  not disable pruning to "catch up".
- Dead letters: `select * from captures_dead order by id desc limit 50`, group by
  error class. Schema-shaped → fix and requeue. Payload-shaped → mark and skip.
- A poison batch pins the queue: confirm `max_retries` fired, then purge the
  message in the dashboard (note the offset first).
- If depth keeps climbing because Postgres is down, obey RB-10.

## RB-03 — Billing integrity

- Confirmed payment not extended: open the payment row, call NowPayments
  `GET /v1/payment/<id>` directly. API says confirmed → apply the extension by
  hand with `applyPayment()`, which is idempotent. Divergence → record it.
- IPN 5xx storm: check signature failures separately from handler errors. A
  signature storm with a valid secret means a scheme change; read their docs
  before editing the verifier.
- Never hand-edit `expires_at` without a payment or an audited admin override.

## RB-04 — 404 drift

- Fetch any dead link, diff against the constant. Any wrapper, footer, or 200 is a
  P1.
- Usual causes: a new route added before the deny check, a framework error page,
  a CDN transformation rule.
- Fix forward; the body is one constant, so the diff is visible in review.

## RB-05 — Sweeper lag

- Check the cron trigger and last run. Missed run > 10 min → trigger manually.
- Verify with `select count(*) from services where expires_at <= now() and
ent_flag <> 'expired'`; a non-zero count after a manual run means the query or
  the KV write is broken.
- While lagging, extend nothing by hand; the flag is the truth and the sweeper is
  the repair.

## RB-06 — Domain verify failures

- Group by failure detail. A CA/TLS problem is Cloudflare for SaaS, not us: check
  custom-hostname status in the CF API and the fallback origin cert.
- A TXT mismatch across many tenants at once → check the resolver (`1.1.1.1` vs
  authoritative) and the record name we hand out.
- One tenant: confirm the record spelling and whether their DNS provider
  flattens the TXT.

## RB-07 — Vault derive slow

- p95 > 800 ms means PBKDF2 cost or DO contention.
- Check DO instance count and the limiter: one hot service with many devices is
  expected to serialize.
- Confirm `dek_wrap_kind` matches the gate mode; a mismatch forces the slow path.
- Short term: reduce iteration count only with an ADR (it re-wraps nothing, it
  changes verification time).

## RB-08 — Profile generation failing

- A single brand blocking the crawler is normal. A site-wide collapse means the
  fetcher or Browser Rendering is down.
- Confirm the cPanel fallback is serving (it should be, by design) so tenants are
  not blocked; this is P3 for that reason.
- Disable generation for a domain via admin, record it.

## RB-09 — Sentry spike

- Group by fingerprint before reading any stack. A single noisy fingerprint is
  usually a browser quirk on the submit guard; silence it, keep the work.
- An edge fingerprint that repeats per host is a resolution bug; move to RB-01.

## RB-10 — Postgres unavailable

- Data plane keeps serving from KV and capture queues buffer; do nothing to the
  edge. Control plane shows the maintenance page.
- Confirm the Hyperdrive origin (Neon status / VPS disk/CPU).
- Do **not** restart the control app until the DB is reachable; it will crashloop.
- On recovery, watch RB-02 for the drain, then confirm no `captures_dead` growth.

## Deploy

```
pnpm run ci                       # lint, typecheck, tests, isolation, boundaries
pnpm deploy:<unit>:staging    # then smoke
pnpm deploy:<unit>:production # after staging smoke is green
```

The CI gate and a local `pnpm run ci` hit the **same dev branch**. Two suites
at once truncate each other and produce a wall of false failures (mail never
arrives, org rows vanish under an FK, checkout 405s). Never run a local gate
while a CI run is in flight, and re-run before believing a red result.

Migrations ship before code and are backward-compatible for one release
(expand/contract). A migration that cannot be backward-compatible needs a
maintenance window announced in `#incident` at least 1 h ahead.

Rollback: control = symlink switch to the previous release; edge/pipeline =
`wrangler rollback <version>`. Never roll back a migration in place; ship a
forward fix.

## Key rotation

- **Passcode**: tenant-initiated in the vault, rewraps only.
- **DEK**: admin job with a progress row; read path tries old and new kid during
  the run. Do not start while a capture backlog exists.
- **KEK**: yearly, versioned kid, unwrap/rewrap per service in batches, one
  environment at a time. Only the founder holds the Secrets Store write scope.
- **Link token secret**: per service, rotating invalidates unredeemed tokens
  (~30 min). Do it outside a campaign window.

## Tenant suspension / kill switches

- `services.status='suspended'` + `ent='expired'` → links 404 for one service.
- Global data-plane kill switch: a KV `global:pause` key short-circuits all renders
  to 404 with no deploy.
- Global brand kill: `brands.enabled=false` → resolution falls to cPanel.

## Restore

- Neon PITR to a branch, verify counts, then promote. Record the target timestamp
  before touching anything.
- R2 versioning off by default; a deleted payload is gone, so export matters.
- Restoring does not restore KV: rebuild by running the sweeper twice and
  re-verifying domains.

Last reviewed: 2026-11-20
