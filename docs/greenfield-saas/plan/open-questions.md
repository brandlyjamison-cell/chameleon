# Open questions

Every `OPEN:` marker in the docs, aggregated. Each names what it blocks. A question
marked **launch-blocking** must be closed before stage 10 exits; the rest have a
lean and can ship on the lean with a note.

Rule: closing one means editing the owning doc, deleting it here, and writing an ADR
if it is irreversible.

## Template questions

### OPEN-TPL-01 — Domain match: public suffix or naive last-two-labels? (blocks 6)

`el-dept.co.uk` vs `co.uk` mis-matching is the classic. A PSL is a dependency and a
cache; naive is wrong for a chunk of the audience. Lean: PSL, cached daily.
Owner: PM + me.

### OPEN-TPL-02 — Reuse a profile across tenants, or scope per org? (blocks 6)

A brand is public, so generation is redundant work; tenant edits then collide. Lean:
reuse the generated row, scope edits to the org that made them, fall back on
conflict.

## Service questions

### OPEN-SVC-01 — Does a downgrade keep the DEK and passcode? (blocks 9)

Pro→Starter with 12 links: keep everything and block minting, or refuse the
downgrade? Lean: keep, prune to the new cap, never orphan a vault. **Launch-blocking**
because it is a money path.

### OPEN-SVC-02 — May an aitm service share a domain row with a chameleon service? (blocks post-launch)

One hostname can only resolve to one service in KV today. Lean: separate domains per
service; links are short enough that tenants can segment.

## Tier questions

### OPEN-TIER-01 — Are `valid`-marked captures exempt from pruning? (blocks 9)

Marked rows are the product's output; exemption complicates the cap invariant. Lean:
no exemption in v1, warn at 80%.

### OPEN-TIER-02 — At what count does export become a job plus a signed download? (blocks 8)

Streaming 250k rows through a Worker proxy will hit the 30s CPU/response ceiling.
Lean: job at 5,000 rows, signed R2 link, notify by email. **Launch-blocking** for Pro.

## Template and vault questions

### OPEN-VAULT-01 — Forgot passcode: is the vault recoverable? (blocks 8)

Today: no, and the setup copy says so. Alternative: escrow the DEK under the KEK in
gated modes, which weakens the gate. Lean: no escrow. **Launch-blocking** because it
changes the promise on the setup screen.

### OPEN-VAULT-02 — PBKDF2 or Argon2 via WASM? (blocks 8)

PBKDF2 is native and edge-safe; Argon2 is stronger against GPU. Lean: PBKDF2 at 310k
for v1, revisit with the DO caching decision.

### OPEN-VAULT-03 — Can admin reset a passcode after proof of ownership? (blocks 10)

Without it, a lost passcode is a lost vault. With it, admin needs a wrap path it
otherwise avoids. Lean: yes, a "tenant confirms via email + last-known capture
count" flow, audited.

### OPEN-VAULT-04 — Cache the unwrapped DEK in the DO for a session, or derive per request? (blocks 8)

Per request is simpler and leaks less; caching is faster for exports. Lean: derive
per request, cache only inside an export job.

### OPEN-VAULT-05 — Is `off` labelled "we can read your vault" in the UI? (blocks 8)

Honesty vs friction. Lean: yes, one line on the mode picker.

## Edge questions

### OPEN-EDGE-01 — Do 429s share the 404 body? (blocks 5)

Same body keeps the surface bare; a distinct page might explain "slow down" to a
human. Lean: same body, 429 status, `retry-after`.

### OPEN-EDGE-02 — Are apex hostnames supported? (blocks 4)

Apex cannot CNAME without flattening, which only works on Cloudflare-hosted zones.
Lean: apex only if the zone is on our Cloudflare account; say so in the UI.

### OPEN-EDGE-03 — Per-tenant sub-limit on the shared `go.` host? (blocks 5)

One noisy demo/brand tenant is invisible to per-service counters. Lean: yes, a host
bucket on top.

### OPEN-EDGE-04 — Cache renders publicly, keyed on host+slug+email-hash? (blocks 10)

Would cut edge CPU materially; risks a stale pin or a shared personalised page.
Lean: not for v1, but instrument the hit rate first.

### OPEN-EDGE-05 — Does the platform keep a shared `go.` host at all? (blocks 9)

It is convenient and it is the thing that burns. Lean: keep for demo only; paid links
must be on tenant domains.

## Capture questions

### OPEN-CAP-01 — Bind the capture token to a cookie? (blocks 7)

Stops a third party replaying a link; puts a cookie on the data plane and complicates
caching. Lean: no for v1, dedupe covers the realistic case.

### OPEN-CAP-02 — If no DEK is warm at capture time, block or enqueue plaintext? (blocks 7)

Blocking is one PBKDF2 (~120ms) and keeps ciphertext at rest. Lean: block, with a
DO-cached passcode key to avoid the KDF.

### OPEN-CAP-03 — Should dedupe be per link or per service? (blocks 7)

Per link misses cross-link duplicates in one blast; per service risks collapsing a
legitimate second submission. Lean: per link (as built), keep `email_hash` for later
analysis.

### OPEN-CAP-04 — What does a session capture above 50KB do? (post-launch)

Truncate to `invalid`, or split into parts? Lean: truncate, mark invalid, keep the
first 50KB.

## Billing questions

### OPEN-BILL-01 — Use NowPayments' recurrence, or own the period loop? (blocks 9)

Their recurrence is thin and partial payments across coins get messy. Lean: own loop.

### OPEN-BILL-02 — Do billing calls hop through the Worker, or does the VPS hold a restricted key? (blocks 9)

The hop keeps keys off the VPS and adds a dependency. Lean: hop.

### OPEN-BILL-03 — Underpayment policy? (blocks 9)

Lean: hold `confirming`, surface in admin, never auto-credit. **Launch-blocking.**

### OPEN-BILL-04 — Grace window before expiry? (blocks 9)

Brief says instant cutoff. A 48h grace is friendlier and confusing with "instant".
Lean: 0 grace, instant (as briefed), pending payment shown as `past_due` before the
deadline only.

### OPEN-BILL-05 — Does a refund shorten the period? (blocks 9)

Lean: no, skip the next invoice.

### OPEN-BILL-06 — Combined or per-service invoices? (blocks 9)

Lean: per service, since periods and tiers differ and partial cancel becomes a
refund problem.

### OPEN-BILL-07 — VAT/sales tax in v1? (blocks 10)

Crypto and a mostly-non-EU audience. Lean: no tax engine, one line on the invoice.

## Security questions

### OPEN-SEC-01 — An admin "decrypt this row" button in v1? (blocks 10)

Lean: no; keep admin blind and get plaintext through the tenant.

### OPEN-SEC-02 — DEK rotation requires a dual-read path; build it in v1? (blocks 10)

Lean: yes, but do not expose rotation in the UI until needed.

### OPEN-SEC-03 — closed 2026-11-21: one login per org; admin is a flag

ADR 0022: an org is exactly one person. No invite, no seats, no role picker. Admin
is `users.is_admin` on the human, cross-tenant and passkey-gated.

### OPEN-SEC-04 — CSP `unsafe-inline` for the submit guard, or a per-render hash? (blocks 6)

Hash is stricter and costs a token substitution. Lean: hash.

### OPEN-SEC-05 — Is the passcode a shared secret across the owner's devices, with no 2FA on it? (blocks 8)

Lean: yes, plus the login session.

## Demo questions

### OPEN-DEMO-01 — Show the captured password masked with a reveal, or in the clear? (blocks 10)

Lean: clear, the reveal is the demo.

### OPEN-DEMO-02 — Turnstile behind a flag, or tighten the IP limit, if demo volume costs? (blocks 10)

Lean: tighten the limit first; Turnstile only as a `?ts=1` fallback.

## AitM questions (post-launch, recorded so the seam is honest)

### OPEN-AITM-01 — Does the engine interface need `renderStream?()` alongside `render()`, or is a buffered string enough? (post-launch)

Lean: keep `render()` returning a string for chameleon and add an optional streaming method, so the contract gains rather than changes.

### OPEN-AITM-02 — What is the `Origin`/`Referer` rewrite policy for proxied origins, and does it need a per-brand bridging config? (post-launch)

IdP cookies can be origin-bound. Lean: rewrite both to the tenant host, per-brand override where login-only is not enough.

## Ops and legal questions

### OPEN-OPS-01 — Who is on call at launch? (blocks 10)

One person cannot page themselves usefully for 24h. Lean: founder + me, 12h splits,
P1 only pages.

### OPEN-OPS-02 — Axiom 14-day retention enough for a money dispute? (blocks 10)

Lean: 90 days for money events, 14 for access.

### OPEN-LEGAL-01 — Entity, DPA, subprocessor list? (blocks 10)

Needed before a real tenant with real captures. Lean: draft from templates, publish
the subprocessor list, no entity gymnastics before revenue.

### OPEN-OPS-03 — closed 2026-11-20: repo made public, ruleset active

Private repos on the free plan have no branch protection or rulesets, so `main` is
guarded only by the local pre-push hook. Lean: pay for Pro; public is not viable
while the schema and docs describe the product.

### OPEN-ARCH-01 — closed 2026-11-21: the box already exists, same country as Neon

`65.98.5.195` (Verpex). Vault calls are one crossing, not two; revisit at 20 tenants.

### OPEN-OPS-04 — Cloudflare for SaaS is not provisioned (blocks 4)

The zone `mailerdeaon.bid` is active on the Free plan. `/zones/:id/custom_hostnames`
answers `1404 No quota has been allocated` and `/zones/:id/subscription` says the
zone has no active core subscription, so Cloudflare for SaaS cannot be enabled
until the zone is at least Pro. Workers Paid is a separate need for Queues,
Durable Objects and Browser Rendering (stages 6-9). Everything else is reachable
with the current token. Lean: Pro before the first custom-hostname attach, Workers
Paid before stage 6.

### OPEN-OPS-05 — mailcow shares the box and owns 80/443 (blocks deploy)

Proven: `http://65.98.5.195` answers a `Server: nginx` 301 from mailcow. Mail to
the domain arrives through Cloudflare Email Routing and the MX records are
Cloudflare's, so wiping the box moves no mail; only mailcow's mailboxes die.
Lean: dump mailcow first, then reinstall Ubuntu 24.04 and run `ops/provision.sh`;
if the mailboxes matter, a second box re-opens ADR 0023.

### OPEN-INC-01 — Does freezing `app_rw` writes during a leak need a drain step? (blocks 10)

In-flight workers hold connections. Lean: revoke, wait 60s, then confirm.

## Deferred by design (not questions, recorded here)

- AitM build, 2FA capture, card payments, seats, tenant template uploads, mobile apps.
- Anything in `arch/aitm-service.md`'s "later" list.

Last reviewed: 2026-11-20
