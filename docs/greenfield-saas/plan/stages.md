# Stages

Ten stages. Each has a goal, a dependency, and acceptance criteria that a second
person can run. A stage is not done until every criterion passes on staging and
`pnpm run ci` is green.

No stage may "temporarily" skip an invariant it touches. If a criterion is
impossible yet, it is written as a manual check and named here, not dropped.

---

## Stage 1 — Repo, tooling, contracts

Goal: an empty but real monorepo that fails CI for the right reasons.

Depends: nothing.

Scope: pnpm workspaces, Turborepo, strict TS with `noUncheckedIndexedAccess`,
ESLint + boundary rules, Prettier, commitlint, GitHub Actions (lint, typecheck,
test, gitleaks, boundary check), `packages/contracts` with the 404 constant and the
zod schemas for link + capture, `packages/config` presets, `.env.example`, ADR
template, PR template that asks which invariants are touched.

Out: any runtime behaviour, any binding, any UI.

Acceptance:

1. `pnpm run ci` runs the local gate and fails on a deliberate `import 'next/server'`
   from `apps/edge`.
2. The 404 snapshot test asserts the exact 65 bytes and the five-header allow-list.
3. `pnpm check:no-client-resolution` exists and passes trivially.
4. Zod schemas for `LinkResolve`, `EngineCapture`, `CaptureRow` compile and have
   tests that reject a client-supplied `kind`.
5. A fresh clone reaches green in one `pnpm i && pnpm run ci` on Windows and Linux.
6. `main` is protected by a ruleset (no deletion, no force-push, PR required) and
   the pre-push hook installed by `pnpm install` is the gate (ADR 0021 — no CI
   pipeline).

Invariants touched: INV-ARCH-01, INV-CAP-03, INV-EDGE-04.

---

## Stage 2 — Schema, RLS, repos, counters

Goal: the database can hold every stage after this without a redesign, and leakage
is testable.

Depends: 1.

Scope: all migrations from `arch/data-model.md`, RLS enable/force, policies, roles
(`app_migrator`, `app_rw`, `edge_ro`, `app_admin`), counter triggers, dedupe index,
`assert-rls`, Drizzle schemas, repo layer with `requireCtx`, the two-org isolation
suite.

Out: endpoints, UI.

Acceptance:

1. `assert-rls` fails on a table with `org_id` and no forced policy, proven by a
   temp migration.
2. Two seeded orgs: every repo function returns nothing for the wrong org.
3. `app_rw` updating `link_slots_used` directly raises.
4. 30 concurrent link inserts against a cap of 20 leave exactly 20 rows and equal
   counters.
5. `insert into captures` without `source` fails.
6. `select` on every tenant table as `app_rw` with no GUC returns zero rows.
7. Restore rehearsal: Neon PITR branch reproduces a seeded row count.

Invariants: INV-DATA-01…08, INV-CAP-07…09.

---

## Stage 3 — Auth, org, service provisioning — done 2026-11-21

Goal: a human can sign up, create an org, and get a service in `provisioning`.

Depends: 2.

Scope: Better Auth, verification email, passkey enrolment, login throttling,
`memberships`, org creation, service create route, passcode set, DEK generation and
initial wrap, `ent=expired` until activation, service card shell.

Acceptance:

1. Unverified email can create a service but cannot activate it.
2. Activation is one transaction: passcode verifier, DEK wrap, `activated_at`,
   `status=active`.
3. Re-running activation on a half-provisioned service resumes, not duplicates.
4. Owner-only guard returns 403 for a non-owner on tier/host actions.
5. Session cookie is `HttpOnly; Secure; SameSite=Lax`, 30-min idle expiry enforced
   in a test with a frozen clock.
6. Foreign service id returns 404 on every service route (INV-DATA-07).
7. `dek_wrapped` is never returned by any API response.

Invariants: INV-SEC-02, INV-DATA-06/07, INV-OPS-02.

---

## Stage 4 — Domains — code done 2026-11-21, entitlement pending

Goal: a tenant can prove a hostname and get TLS.

Depends: 3.

Scope: add/verify/delete, TXT token, verify job (5 min, 72h), Cloudflare for SaaS
custom hostname, daily re-check, tombstone, slot enforcement, `d:` KV writes.

Acceptance:

1. A hostname goes `pending → verifying → active` only with matching TXT and a CF
   hostname status of active.
2. Wrong TXT stays `verifying` and expires at 72h.
3. Direct UPDATE to `active` without `verified_at` is rejected.
4. Delete then re-add by another org inside 30 days returns 409; same org revives
   with TXT re-check.
5. Third domain on Starter returns 409 `domain_slots_exhausted`.
6. A `failed` host 404s at the edge (with stage 5 wired, else the deny branch is
   unit-tested here).

Invariants: INV-SEC-06/07, INV-DATA-04/05, INV-EDGE-07.

---

## Stage 5 — Links, tokens, resolution, 404

Goal: a verified host serves a real link end to end, and a dead one serves the bare 404.

Depends: 4.

Scope: mint (transaction, counter lock), slug generator, signed token, `l:` KV,
resolution handler, entitlement gate, rate-limit DO, 404 constant wired to every
deny, control-host 404, link delete/soft-delete, 301 on re-slug.

Acceptance:

1. Minting at the cap returns 409 and does not create a row.
2. 30 parallel mints on a 20-cap service leave 20.
3. Forged, expired, and wrong-service tokens all return the exact 404 body.
4. Every deny reason (host, status, ent, token, limit) produces the same body and
   zero writes.
5. `/dashboard` on a data host and `/a7k2` on the control host both 404.
6. Control-host responses carry `x-robots-tag: noindex`.
7. 429 carries `retry-after` and the same body.

Invariants: INV-EDGE-01…09, INV-SEC-04, INV-CAP-10.

---

## Stage 6 — Skeleton, brand map, profiles

Goal: a link renders a convincing page, including two-step brands.

Depends: 5.

Scope: skeleton one-step and two-step partials, CSS var slot schema, asset pipeline
(WebP, max dimensions, R2, immutable route), 30-brand seed with pinned assets,
resolution order, profile crawler, KV profile cache, dashboard accept/edit/reject.

Acceptance:

1. Each of the 30 brands renders with its own logo, palette, labels, and step count.
2. Two-step brand: step 1 email → step 2 password, no OTP input anywhere
   (`autocomplete="one-time-code"` absent).
3. Resolution order test: pin beats map beats profile beats cPanel.
4. Unknown domain renders cPanel in the same request and enqueues exactly one
   profile job.
5. Profile shorter than 30 days never regenerates; expired profile regenerates.
6. Screenshot stored blurred and dimmed; asset route is `immutable`.
7. Total render response < 6KB HTML and 0 external requests (parsed assertion).

Invariants: INV-CAP-04, INV-EDGE-01/02, INV-ARCH-04.

---

## Stage 7 — Capture pipeline

Goal: a password typed on a link becomes an encrypted row without a spinner.

Depends: 6 (can run parallel with 6 once 5 is done).

Scope: `POST /c/:token`, engine parse, seal with AAD, queue, consumer with
per-service batching, dedupe counter, cap prune, `prune_queue`, janitor, dead-letter
table, source classification, 302.

Acceptance:

1. With Postgres stopped, a valid POST still 302s and the message is on the queue.
2. Raw queue body contains no plaintext password.
3. Consumer writes a decryptable row; a second submit inside 15 min stores one row
   and increments suppressed.
4. Cap-10 service with 12 inserts ends at 10 rows, two oldest pruned, two queue rows.
5. A poison message dead-letters after 5 attempts without stalling the batch.
6. `source` is `human` for a browser UA, `scanner` for a curl-like UA.
7. `kind` is `credential` even when the form posts `kind=session`.

Invariants: INV-CAP-01…10.

---

## Stage 8 — Vault, gate, export

Goal: the tenant can open the vault behind a passcode and take rows out.

Depends: 5, 7.

Scope: vault proxy route, passcode verify on the data plane, DEK unwrap, vault
session and device cookies, gate modes, re-arm, rotate, list with filters, mark,
delete, export CSV, activity log.

Acceptance:

1. `always`: every open prompts; `remember_30d` remembers one device and not
   another; `off` needs no passcode.
2. `off → always` re-arms with the old passcode and drops device cookies.
3. Wiping the passcode makes decryption fail; restoring makes it succeed.
4. Export honours the current filter and excludes `scanner` by default.
5. Foreign service id through the proxy returns 404, and the proxy re-checks
   ownership even when called directly with a valid session header.
6. 6 wrong passcodes in 15 min triggers backoff.
7. Deleting a row enqueues its R2 object and the janitor removes it.

Invariants: INV-SEC-01/02/03, INV-DATA-03, INV-CAP-09.

---

## Stage 9 — Billing and expiry

Goal: money in, instant cutoff on money out.

Depends: 3 (not on 8).

Scope: checkout, NowPayments invoice, IPN with HMAC + API re-fetch, payments state
machine, renewal cron, warnings T-7/3/1/0, `ent` flags, sweeper, banners, red card.

Acceptance:

1. Forged IPN signature → 401, no state change.
2. Replayed valid IPN → one payment row, one extension.
3. Signature valid but API says pending → no extension.
4. Confirmed payment extends from `max(now, expires_at)` exactly once.
5. Expiry webhook makes the next request 404 before the response is acked.
6. With the webhook dropped, the sweeper 404s the service inside 5 min.
7. Warning emails fire at each threshold exactly once per period.
8. Tier downgrade prunes to the lower cap in one batch.

Invariants: INV-EDGE-06, INV-SEC-05, INV-OPS-02.

---

## Stage 10 — Demo, admin, hardening, launch

Goal: the funnel and the support surface exist, and the system is watchable.

Depends: 8, 9.

Scope: demo tenant and link, demo reveal, reset cron, admin (users, services, tiers,
due dates, domains, audit), Sentry, Axiom, alerts, synthetic checks, load test,
restore rehearsal, status page, subprocessor list.

Acceptance:

1. Demo runs the real capture path and shows the row once; nothing survives 24h.
2. 31st demo render in an hour from one IP 429s.
3. Every admin write produces an audit row with before/after.
4. Admin capture view shows ciphertext and no plaintext.
5. Every P0 invariant has a CI check (audit sheet signed).
6. 500 rps for 30 min: p95 < 400 ms, 5xx < 0.2%, yield > 39.5%.
7. Restore from PITR into staging reproduces a capture count.
8. One real tenant, one real domain, seven days of real mail.

Invariants: INV-OPS-01/03/04, INV-SEC-01, INV-DEMO-*, all P0 at once.

---

## Dependency notes

- 6 and 7 may run in parallel after 5; 8 needs 5 and 7.
- 9 needs only 3, so it can start while 6-8 finish, but not deploy before 8.
- 10 is strictly last.

## Stage exit checklist (all stages)

- [ ] criteria pass on staging
- [ ] `pnpm run ci` green
- [ ] invariants touched have a check
- [ ] docs updated, no stale claim
- [ ] `OPEN:` items added or closed
- [ ] rollback noted in the PR

Last reviewed: 2026-11-20
