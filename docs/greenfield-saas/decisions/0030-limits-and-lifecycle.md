# 0030 — DB-backed rate limits and a money-driven lifecycle sweep

Status: accepted (2026-11-21)

## Context

Signup, login and resend had no limit, so one script could mint accounts and mail.
Entitlement was also frozen at activation: `expires_at` never moved, so a renewed
service eventually reported "expired" while `paid_until` sat in the future, and a
refund never took anything away.

## Decision

1. `rate_limits` is a fixed-window table; `rate_hit(key, limit, window)` is a
   definer function. Signup allows 30/hour per IP, login 10/10 minutes per
   IP+email, resend 3/15 minutes per address. A missing table degrades to allow.
2. `sweep_services()` runs on the five-minute domain job. A lapsed `paid_until`
   moves a service to `past_due`; seven days later it becomes `expired`. Both
   states deny at the edge.
3. `paid_until` is the entitlement truth everywhere in the console; `expires_at`
   is only the original activation clock.
4. Operator actions write `audit_log` through `admin_audit`, surfaced at
   `/admin/audit`.

## Consequences

- A restart no longer resets abuse limits.
- Money drives state without a human, and a comped extension reverses it on the
  next sweep.
- The rate table is pruned by the same sweep after a day.

## Rejected

- In-memory counters: resets on every deploy and differs per process.
- A cron-only expiry with no grace: a slow payment would kill a live service.

## Reversal cost

Low. Delete the sweep call and the limit checks; no data depends on either.
