# Invariants

Every invariant states a rule, where it is enforced, and how a reviewer or CI
proves it. `MUST` items block merge when violated. Each has a permanent id; PRs
quote the id.

Three severities:

- **P0** — a breach is a product-defining failure: leaks, dead links, or the
  tenant can pirate the product.
- **P1** — a breach corrupts accounting, isolation, or recovery.
- **P2** — a breach degrades operation but is repairable.

Nothing here is aspirational. If an invariant cannot be checked yet, the check is
`manual` and named in `plan/stages.md` as an acceptance criterion.

---

## Edge and resolution

### INV-EDGE-01 — Resolution is server-side only (P0)

Rule: The data plane resolves host → service → link → template. Client JS receives
only final HTML and may never derive a template, a target URL, or an entitlement
decision.
Enforced at: `apps/edge` render path; `packages/engine` is imported only by
Worker code.
Check: `pnpm check:no-client-resolution` greps the control app for brand-map or
engine imports outside server components/route handlers; a browser test with JS
disabled renders the full page.
Breaks as: A tenant scrapes a page and clones the product.

### INV-EDGE-02 — No entitlement logic in the client (P0)

Rule: Every allow/deny for a request is decided at the edge from KV + DB. The
dashboard renders what the edge decided; it never decides.
Enforced at: `apps/edge` middleware `entitlementGate` runs before routing.
Check: edge unit test hits each route with an expired service and expects 404
before any render function is called (spy assertions).
Breaks as: Links keep working after expiry because a cached page said so.

### INV-EDGE-03 — Default deny (P0)

Rule: Unknown host, missing KV flag, missing service, missing link, unparsable
token, or DB error all resolve to the unbranded 404. There is no "assume active"
branch.
Enforced at: `resolveRequest()` returns `Deny` unless every field is present and
fresh.
Check: table test of 12 partial inputs, all expect 404 and zero DB writes.
Breaks as: Spam scanners hit a branded page for a dead service and it looks live.

### INV-EDGE-04 — The 404 is byte-exact and unbranded (P1)

Rule: Body is exactly:
`<!doctype html><title>Not Found</title>404 This link has expired.`
with `Content-Type: text/html; charset=utf-8` (65 bytes), status 404, and no other headers
beyond `server`, `content-type`, `content-length`, `cache-control`,
`date`. No logo, footer, contact, analytics, cookies, or CSP nonce.
Enforced at: `packages/contracts/404.ts` is the single constant; renderers import
it.
Check: snapshot test on raw bytes and header allow-list; `Set-Cookie` absent.
Breaks as: A victim who has seen the page recognises it, or scanners fingerprint
the vendor.

### INV-EDGE-05 — 404 sets no state (P1)

Rule: The 404 path writes no cookie, no KV key, no DB row, and no log line beyond
the structured access log.
Enforced at: deny branch returns before any binding is touched.
Check: log-diff test asserting only the access log emitter ran.
Breaks as: Denial paths become a write amplifier under scanner load.

### INV-EDGE-06 — Expiry is instant and doubly enforced (P0)

Rule: The payment webhook purges `ent:<service_id>` synchronously before ack. A
five-minute sweeper re-derives expiry from `services.expires_at` and purges on
mismatch. Both paths set the flag to `expired`; neither deletes rows.
Enforced at: `apps/pipeline` sweeper + billing webhook handler.
Check: staging test expiring a service mid-flight: next request 404s within one
KV propagation, and with the webhook dropped the sweeper catches it inside five
minutes. Alarm fires if sweeper lag > 7 min.
Breaks as: A tenant runs a campaign on a lapsed service for free forever.

### INV-EDGE-07 — Only `active` + verified hosts serve (P0)

Rule: `domains.status = 'active'` and a non-null `verified_at` are required.
`pending`, `verifying`, `failed`, `paused`, `tombstoned` all 404.
Enforced at: resolution KV doc built from the domain row; deny on any other
status.
Check: matrix test over all status values.
Breaks as: A tenant points a CNAME at us and serves before proving ownership.

### INV-EDGE-08 — Planes never fall through (P0)

Rule: The control host never resolves links; a data host never serves dashboard
routes. Router picks by `Host` before anything else, and control responses carry
`X-Robots-Tag: noindex`.
Enforced at: separate deployables plus an explicit host allow-list in each.
Check: request `/dashboard` on a tenant domain and `/a7k2?email=` on the control
host; both must 404, not cross-serve.
Breaks as: A victim's visit can touch an authenticated session, and a dashboard
cookie leaks to a phishing page.

## Tenancy and data

### INV-DATA-01 — RLS on every tenant table (P0)

Rule: Every table with an `org_id` has `FORCE ROW LEVEL SECURITY`, a policy
`USING (org_id = current_setting('app.org_id')::uuid)`, and `WITH CHECK` on the
same. The runtime role is not the table owner.
Enforced at: migration `0002_rls.sql` plus `packages/db/scripts/assert-rls.ts`
which fails CI if any table with `org_id` lacks an enabled+forced policy.
Check: `packages/db/test/rls.test.ts` connects as `app_rw` with no GUC and gets
zero rows from every tenant table.
Breaks as: One forgotten `WHERE` leaks another tenant's vault.

### INV-DATA-02 — Postgres only (P0)

Rule: D1 is not used. All durable state is Postgres via Hyperdrive.
Enforced at: no `d1` binding in `wrangler.jsonc`; review check.
Check: `grep -r "D1Database"` empty.
Breaks as: Divergent SQL dialects and no RLS.

### INV-DATA-03 — Service scoping on every child row (P0)

Rule: Child tables carry `service_id` non-null, denormalised `org_id`, and a
composite FK to the parent's `(id, service_id)`. Cross-service reads inside one
org are equally forbidden: the vault of service A never shows service B.
Enforced at: schema FKs plus every repo taking `serviceId`.
Check: test seeds two services in one org; every repo call for A returns no B
rows.
Breaks as: A tenant's two services share a vault and one tier's cap governs both.

### INV-DATA-04 — Counters are trigger-maintained (P0)

Rule: `services.domain_slots_used` and `services.link_slots_used` are written
only by `AFTER INSERT/UPDATE/DELETE` triggers on `domains`/`links`, inside the
same transaction, with `SELECT ... FOR UPDATE` on the service row. Application
code never increments.
Enforced at: triggers in `0003_counters.sql`; a `REVOKE UPDATE (…counters…)`
on `services` for `app_rw` makes app writes fail loudly.
Check: concurrent-insert test of 30 links against a cap of 20 ends at exactly 20
rows and counters 20/20.
Breaks as: A race mints 40 links on a 20-link service.

### INV-DATA-05 — Never trust a count from the client (P0)

Rule: Minting and domain-add re-read the counter inside the transaction and
reject on `>= cap`. The UI number is advisory.
Enforced at: `mintLink()` / `addDomain()` transaction body.
Check: test posts `count=0` with a full service and still gets 409.
Breaks as: Editing a hidden form field buys free slots.

### INV-DATA-06 — Tenant id comes from the session, never the URL (P1)

Rule: `ctx.orgId` is set by `requireSession()`. Route params only ever identify a
row, which must then match `ctx.orgId`.
Enforced at: repo signatures require `ctx` first.
Check: lint rule bans `orgId` destructured from `params`.
Breaks as: `/orgs/:id/vault` style IDOR.

### INV-DATA-07 — Foreign ids 404, not 403 (P1)

Rule: A row belonging to another tenant returns 404 so ids are not enumerable.
Enforced at: `getOr404(ctx, id)` helper is the only fetcher.
Check: test fetches a known-good foreign id on ten routes, all 404.
Breaks as: Id enumeration reveals tenant count and growth.

### INV-DATA-08 — All time math is server-side UTC (P1)

Rule: `timestamptz` columns, `now()` in SQL or `Date.now()` on the server. No
client clock participates in expiry, dedupe windows, or pruning.
Enforced at: no `new Date(clientValue)` in entitlement or pruning code.
Check: test with the DB session TZ set to `Pacific/Kiritimati`.
Breaks as: A tenant in UTC+14 gets a day of free service, or loses one.

## Capture

### INV-CAP-01 — The POST never awaits a database write (P0)

Rule: The capture handler validates the token, encrypts, calls
`env.QUEUE.send()` and `ctx.waitUntil()`, and returns the 302. No `await` on
Postgres in the request path.
Enforced at: `apps/edge/routes/capture.ts`; the module does not import `db`.
Check: bundle assertion — `capture.ts` graph contains no `pg`/`drizzle` import;
staging test with Postgres stopped still 302s and enqueues.
Breaks as: One slow query shows a spinner to the victim, who bails.

### INV-CAP-02 — Encrypt before enqueue (P0)

Rule: The queue message carries AES-256-GCM ciphertext with AAD
`link_id|capture_id|email_hash`. The queue and its consumer can read no plaintext
before decryption with the service DEK.
Enforced at: `packages/crypto/sealCapture()` is the only producer of queue
bodies.
Check: unit test decrypts only with the DEK; a consumer log redaction test shows
no `password` in the raw message.
Breaks as: Cloudflare queue internals or a log sink hold plaintext passwords.

### INV-CAP-03 — Capture shape is owned by the service_type (P0)

Rule: `kind` is written by the engine from the service_type registry, never by
the client, never defaulted in the route. `chameleon` writes only
`kind='credential'`. `aitm` writes `session`, or `mixed` when a password was
captured before the session.
Enforced at: `Engine.parseCapture()` returns the `kind`; the route copies it.
Check: registry test asserts `chameleon.captureKinds === ['credential']`; a
request posting `kind=session` to a chameleon link still stores `credential`.
Breaks as: The vault shows empty session rows on a service that cannot make them,
and tenants think chameleon does 2FA.

### INV-CAP-04 — `chameleon` never renders an OTP field (P1)

Rule: No chameleon template shows a code input. Two-step mode means email step
then password step; step two stops and 302s. If the crawl sees only a
code-consuming second step, the profile degrades to one step.
Enforced at: skeleton partials — `otp` partial is imported only by the aitm
engine.
Check: template lint walks all chameleon partial sets for an `autocomplete="one-time-code"`
input.
Breaks as: The victim waits for a code that never arrives, then abandons.

### INV-CAP-05 — No dedicated password column (P1)

Rule: Credentials live in `captures.fields jsonb` as an encrypted envelope
`{v,alg,iv,ct}`. There is no `password` column, now or after AitM.
Enforced at: schema review; `fields` is the only payload column.
Check: migration test asserts no column named `password`/`username` on
`captures`.
Breaks as: Every new capture mode needs a migration and AitM breaks the contract.

### INV-CAP-06 — Session payloads go to R2, never Postgres (P1)

Rule: Payloads 5-50KB are written to `r2://captures/<service_id>/<capture_id>`
and referenced by `payload_ref`. Credential payloads may also use `payload_ref`
when over 2KB; the column is the only pointer.
Enforced at: consumer branches on `kind` and size.
Check: consumer test with a 12KB session writes a row with `payload_ref` and a
`fields` of `{}` envelope.
Breaks as: Postgres TOAST bloat and slow vault queries.

### INV-CAP-07 — Dedupe window on `(link_id, email_hash)` (P1)

Rule: A rolling 15-minute window per pair suppresses duplicate submissions,
counted at queue-consume time, before insert. Suppressed rows are counted in
`captures_suppressed`, not stored.
Enforced at: consumer `INSERT ... ON CONFLICT` against a partial unique index on
a `dedupe_bucket` expression.
Check: two submits 2 min apart yield one row; after bucket rollover, two rows.
Breaks as: Resubmits and scanner replays burn the capture cap.

### INV-CAP-08 — Every capture carries `source`; vault defaults to `human` (P1)

Rule: `source` is required, set by the route from the resolution decision:
real visit → `human`, known scanner UA or prefetch → `scanner`, decoy render →
`decoy`. Vault query defaults to `source in ('human','decoy')` unless filtered.
Enforced at: `captures.source` NOT NULL, no default; vault repo applies the
default filter.
Check: insert without `source` fails; default vault counts exclude `scanner`.
Breaks as: Scanner noise buries real captures and inflates the cap.

### INV-CAP-09 — Pruning is oldest-first at the cap (P1)

Rule: After insert, if `count(service_id) > tier.capture_cap`, delete oldest rows
by `received_at` down to the cap, in the same transaction, batched. R2 objects
for pruned rows are deleted by a follow-up job keyed on a tombstone list.
Enforced at: consumer pruning step; `tier.capture_cap` read from the service's
tier row, not the request.
Check: cap-10 service, insert 12, expect 10 rows and the two oldest gone.
Breaks as: A burst silently stops capturing.

### INV-CAP-10 — A capture is bound to the live link token (P1)

Rule: The POST `link_id` and signature must match the token minted for that
render, be unexpired (30 min), and the service must still be live. Token re-use
is allowed inside the window only.
Enforced at: `verifyLinkToken()` before enqueue; denies with the same 404 body.
Check: tampered signature, and a token from an expired service, both 404.
Breaks as: Bots post garbage into vaults.

## Security and crypto

### INV-SEC-01 — Admin cannot read captures, in any mode (P0)

Rule: Admin routes never decrypt. Admin DB access is SQL-level only; the
platform root key is not in any admin tool. Admin sees counts, sources, statuses,
timestamps, and the encrypted envelope.
Enforced at: no admin module imports `packages/crypto` decrypt; key lives in
Cloudflare Secrets Store bound only to Workers.
Check: script greps admin routes for `openCapture(`; and a signed-in admin
fetching `/admin/services/:id/captures` returns rows with `fields.ct` and no
plaintext.
Breaks as: One compromised staff laptop reads every tenant's credentials.

### INV-SEC-02 — DEK is wrapped under the passcode whenever the gate is on (P0)

Rule: In `always` and `remember_30d`, `services.dek_wrapped` is wrapped with a
PBKDF2-SHA-256 (310k iterations, 128-bit per-service salt) derived key. The
platform holds enough to validate the passcode, not to open captures without it.
Enforced at: `packages/crypto/wrap.ts`; activation writes only the wrapped form.
Check: test wipes the passcode, asserts decrypt fails, restores it, asserts
success.
Breaks as: The passcode becomes decoration.

### INV-SEC-03 — Passcode and wrap survive `off` (P1)

Rule: Setting gate to `off` re-wraps the DEK under the KEK but keeps
`passcode_hash`, `passcode_salt`, and the last passcode-wrapped blob, so `off →
always` re-arms with the existing passcode and no re-entry. Setting a new
passcode always requires the old one (or an admin reset that orphans nothing).
Enforced at: `setGateMode()` writes both wrap forms on the `always` transition.
Check: round-trip test `always → off → always` with the same passcode decrypts.
Breaks as: Turning the gate off destroys access to the vault.

### INV-SEC-04 — Link URLs are signed, never guessable state (P1)

Rule: Links carry an HMAC token over `link_id|slug|iat|service_id` so the edge
trusts the link without a DB read; signature failures 404. Token secret is
per-service, rotated with the service.
Enforced at: `mintLinkToken()` / `verifyLinkToken()`; KV doc stores the token,
not the secret.
Check: forged token 404s; rotated secret invalidates old tokens only after KV
re-render.
Breaks as: Slugs are enumerable across tenants.

### INV-SEC-05 — Webhooks are HMAC-verified and re-fetched (P0)

Rule: NowPayments IPN: verify `x-nowpayments-sig` over the raw body with the IPN
secret, then re-fetch the payment by id from the API and act on the API's state,
not the body. Unique on `payments.provider_payment_id`; duplicate delivery is a
no-op.
Enforced at: `apps/pipeline/webhooks/nowpayments.ts`.
Check: replayed body with a valid old signature changes nothing; a valid
signature with a body claiming a status the API contradicts follows the API.
Breaks as: A forged IPN grants a free Pro service.

### INV-SEC-06 — TXT verification precedes `active` (P1)

Rule: `domains.status` reaches `active` only through the verify job matching the
stored token to a TXT record. A manual admin override is audited and sets
`verified_by='admin'`.
Enforced at: state transition guard on the domains repo.
Check: direct UPDATE to `active` without a token is rejected by a trigger.
Breaks as: Tenants serve on hostnames they do not own.

### INV-SEC-07 — Hostnames are unique and tombstoned (P0)

Rule: `domains.hostname` is globally unique, case-folded. Delete sets
`deleted_at` + `tombstoned_at` and keeps the row for 30 days; re-add by the same
org inside the window revives it, by another org it is refused.
Enforced at: partial unique index on `lower(hostname) WHERE deleted_at IS NULL`,
plus a tombstone check in `addDomain()`.
Check: org B adding a hostname org A deleted yesterday gets 409 with a revive
path.
Breaks as: A dangling customer CNAME serves someone else's links.

### INV-SEC-08 — Secrets are per-environment and never in the repo (P0)

Rule: One Cloudflare account per environment (or distinct Workers + KV + R2 +
Hyperdrive config), secrets via `wrangler secret` / Secrets Store, `.dev.vars`
gitignored, CI uses OIDC-scoped tokens.
Enforced at: config review; `pnpm check:secrets` runs `gitleaks` on CI.
Check: staging and prod secret names identical, values distinct; a prod DSN in
staging env fails a startup assertion.
Breaks as: A staging deploy writes to prod vaults.

### INV-SEC-09 — Rate limits are per-service and per-IP (P1)

Rule: Durable Object `ServiceLimiter` allows 600 req/min per service and 120
req/min per IP with a small burst; capture POST is 20/min/IP. Refusals are 429
with the 404 body and `Retry-After`.
Enforced at: edge middleware before render.
Check: load test at 700 rps stores one 429 per excess bucket; DO storage bounded.
Breaks as: One blast saturates a shared Worker and starves other tenants.

### INV-SEC-10 — The demo is isolated and cannot be used for real (P1)

Rule: Demo link belongs to a `is_demo` tenant marked read-only, is IP limited
(30/hr), purges on a 24h timer, and after submit shows the captured row once with
a "sign up" CTA. Demo captures never count against a paid cap.
Enforced at: demo tenant flag + `apps/pipeline/demoReset`.
Check: demo page shows the row for exactly one render and is empty after reset.
Breaks as: Operators run production traffic through the free demo.

## Architecture

### INV-ARCH-01 — Two planes, one hard boundary (P0)

Rule: Control (Next.js, VPS) and data (Workers, Hono) are separate deployables
with separate secrets. They share only `packages/contracts` (types + zod) and
`packages/skeleton` (pure render). No control code imports a Worker binding; no
edge code imports Next.
Enforced at: package boundary lint (`eslint-plugin-boundaries`) with an explicit
allow-list matrix in `eslint.config.js`.
Check: CI fails on an import of `next/*` from `apps/edge` and of `cloudflare:*`
from `apps/control`.
Breaks as: One deployable and one blast radius, and the phishing host starts
serving dashboard JS.

### INV-ARCH-02 — Service types are registry rows behind an engine interface (P0)

Rule: `service_types` rows name an engine module. Adding a type is: registry
insert + engine implementation + tier seed. No route, no table, no capture code
changes.
Enforced at: `packages/engine/registry.ts` is the only switch; routes call
`engineFor(serviceType)`.
Check: a test-only `echo` engine registered in fixtures serves a link end-to-end
with zero edits outside `packages/engine` and the seed.
Breaks as: AitM means a second codebase and a fork of the link table.

### INV-ARCH-03 — Link and capture contracts are frozen for AitM (P0)

Rule: The public link URL, `?email=` param, POST field names, `captures` columns,
and vault response shape are identical across service types. `kind` and
`payload_ref` exist from day one and are used by chameleon as `credential` /
null.
Enforced at: contract test snapshots in `packages/contracts/test/`.
Check: the same test suite runs against a chameleon and an aitm fixture and must
pass unmodified.
Breaks as: Launching AitM forces a migration and breaks every tenant's links.

### INV-ARCH-04 — The engine decides render; the route does not (P1)

Rule: `resolveTemplate()` and `render()` belong to the engine. Shared code may
fetch link/service/template state and pass it in, but no `if (serviceType ===`
appears outside `packages/engine`.
Enforced at: boundary lint `no-restricted-syntax` on `serviceType ===`.
Check: grep in `apps/edge` for `serviceType` comparisons is empty.
Breaks as: Chameleon assumptions get hard-coded into the resolver and AitM
inherits them.

## Ops

### INV-OPS-01 — Every admin write is audited (P1)

Rule: `audit_log` gets actor, target table, target id, before/after JSON, IP, and
UA in the same transaction as the write. A trigger blocks admin writes without an
audit row.
Enforced at: `adminWrite()` wrapper (single exit) + deferred constraint trigger.
Check: test writes as admin without the wrapper and expects the transaction to
abort.
Breaks as: A support action becomes unprovable.

### INV-OPS-02 — Money state is idempotent and append-only (P0)

Rule: `payments` unique on provider id; state transitions only forward
(`pending → confirming → confirmed → failed/expired/refunded`); `invoices` and
`audit_log` are append-only via trigger.
Enforced at: transition guard function + unique index.
Check: concurrent duplicate webhooks produce one payment row and one service
extension.
Breaks as: Double credit on retry.

### INV-OPS-03 — Staging exists and is exercised (P1)

Rule: Every stage ships to staging first; staging has its own Cloudflare account,
KV, R2, DO, Queue, and Neon branch.
Enforced at: deploy workflow requires `environment: staging` before `production`
job.
Check: workflow YAML review; staging smoke suite green.
Breaks as: Every deploy is a production experiment.

### INV-OPS-04 — Every alarm has an owner and a runbook anchor (P2)

Rule: Each alert in `ops/observability.md` links a `ops/runbook.md` section and a
rotation. Alerts without both are disabled.
Enforced at: `ops/alerts.yaml` schema check in CI.
Check: `pnpm check:alerts` resolves every `runbook:` key.
Breaks as: Nobody knows what the page means at 03:00.

---

## Change log

| Date       | Change                                       |
| ---------- | -------------------------------------------- |
| 2026-11-20 | Initial set, derived from the product brief. |

Last reviewed: 2026-11-20
