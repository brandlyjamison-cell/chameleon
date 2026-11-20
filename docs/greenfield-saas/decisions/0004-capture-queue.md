# ADR 0004 — Capture is enqueued, never written in-request

Status: accepted (2026-11-20)

## Context

The victim has just typed a password and will bounce the moment the page feels
slow. A capture write that awaits Postgres inherits every slow query, pool
exhaustion, and failover. The window to keep them is under a second.

## Decision

`POST /c/:token` validates, encrypts, `QUEUE.send()`, `waitUntil` the access log,
and returns 302. No database await in the request path (INV-CAP-01). A separate
`apps/pipeline` consumer batches into Postgres with per-message retries and a
dead-letter table.

## Consequences

- The victim always redirects, even when Postgres is down (RB-10).
- Capture must be encrypted before enqueue so the queue is untrusted
  (INV-CAP-02).
- A failed send loses one capture; accepted deliberately over a spinner.
- Ordering is per-batch, so `received_at` comes from the edge and pruning sorts on
  it.
- Consumer is a separate deployable, so a backlog cannot starve renders.

## Rejected

- **Inline insert with a short timeout.** Postgres failover alone blows the
  budget, and a timeout still loses the capture without the 302 guarantee.
- **Service binding to a single writer.** Same coupling, less buffering.

## Reversal cost

Medium. Removing the queue means rewriting the test suite's failure matrix;
nothing in the schema changes.

Last reviewed: 2026-11-20
