# Observability

Sentry for exceptions, Axiom for events. Axiom is the system of record for what
happened; Postgres is the system of record for state. Nothing in a log line is a
secret.

## Field contract

Every event carries: `env`, `service`, `request_id`, `trace_id`, `plane`
(`control|edge|pipeline`), `status`, `ms`. Data-plane events add `host_hash`,
`service_id`, `link_id`, `ent`, `source_guess`. Control-plane events add `org_id`,
`user_id`, `route`. Never: email, password, IP (only /24 hash), passcode, tokens.

`request_id` is a ULID at ingress and is propagated to every downstream call,
including queue messages (`trace_id` on the message), so a victim 302 can be
joined to its consumed row.

## Events that matter

| Event | Fields | Use |
| --- | --- | --- |
| `render.ok` | tpl_source (pin/map/profile/cpanel), render_ms | resolution mix |
| `render.deny` | reason (host/status/ent/token/limit) | why links die |
| `capture.accepted` | kind, source, seal_ms, queue_ms | yield, latency |
| `capture.consumed` | capture_id, dup, prune_n | pipeline health |
| `capture.dead` | capture_id, error class | loss |
| `vault.open` | service_id, mode, derive_ms | gate health, cost |
| `vault.denied` | reason | support |
| `domain.verify` | result, attempt | rotation health |
| `profile.gen` | domain, ok, step_count, ms | template coverage |
| `billing.ipn` | payment_id, provider_status, divergence | money truth |
| `ent.flip` | from, to, cause (webhook/sweeper) | expiry proof |

## Dashboard panels

1. **Traffic** — renders, denies by reason, 4xx/5xx, p95 ms per plane.
2. **Entitlement** — active/expired services, sweeper lag, flips in the last hour.
3. **Capture** — accepted/min, consumed/min, queue depth, dead letters, dedupe rate.
4. **Money** — IPN failures, payments stuck confirming, confirmed-not-extended.
5. **Domains** — verify success rate, active vs failed per day.
6. **Vault** — opens, denials, p95 derive time.
7. **Profiles** — generation success, step-count distribution, cache hit rate.

## Alerts

Every alert names a runbook anchor and a rotation (INV-OPS-04).

| Severity | Condition | Runbook |
| --- | --- | --- |
| P1 page | 5xx > 2% over 10 min on edge | RB-01 |
| P1 page | queue depth > 5k for 5 min, or dead letters > 100/h | RB-02 |
| P1 page | confirmed payment not extended within 60 s | RB-03 |
| P1 page | any 404 body drift (snapshot mismatch) | RB-04 |
| P2 | sweeper lag > 7 min | RB-05 |
| P2 | domain verify success < 60% over 1 h | RB-06 |
| P2 | IPN 5xx > 1% 10 min | RB-03 |
| P2 | vault derive p95 > 800 ms | RB-07 |
| P3 | profile success < 50% 6 h | RB-08 |
| P3 | Sentry new-issue spike | RB-09 |

No alert on render latency alone; a slow render is visible and not paging.

## Sentry

Separate projects per plane and per environment, DSN per Worker via secret. PII
off, `sendDefaultPii: false`, `beforeSend` scrubs by key allow-list. Release is
the git SHA; source maps uploaded on deploy. Edge errors are sampled 100% at
first-error-per-fingerprint then 10%.

## Retention and access

Access logs 14 days, business events 90 days, money events 2 years. Axiom access is
two accounts (eng, founder); no per-tenant access. Queries saved per runbook so an
on-call can reach the same view without writing APL.

## Synthetic checks

Every 60 s, from two regions: a demo render and a seeded staging link must return
200 with the right template; the 404 constant must return 404 with the exact body.
Failure pages directly.

## Cost guard

Per-service event volume is capped by sampling: 100% for non-200 and capture
events, 10% for 200 renders. If monthly ingest exceeds the budget, reduce the 200
sample first, never the deny/capture events.

Last reviewed: 2026-11-20
