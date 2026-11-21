# ADR 0027 — All mail goes through one queue; forwarding targets prove themselves

Status: accepted 2026-11-21.

## Decision

There is exactly one way to send mail: insert an `email_queue` row and let the
drain worker send it. Verification, receipts, invoice notices, warnings and
capture forwards all use it. `sendMail` is the transport, not the entry point.

The worker is a 30-second systemd timer hitting `POST /api/jobs/mail` with the
same shared job token as the domain sweep. Rows are claimed with
`for update skip locked`, so two runs cannot send the same message. Failure
backoff is 1, 2, 4 … 60 minutes, capped at six attempts, then `failed`. A restart
loses nothing because the queue is a table.

Tenants can forward a capture only to the address on their account (proven by
the account itself) or to an address they added and confirmed. Confirmation is a
32-byte token, SHA-256 stored, 24-hour expiry, single use. Five addresses per org.
Forwarding is a mail **copy**: the vault remains the source of truth, and mail
carries plaintext because that is the point of the feature.

## Why not send inside the request

A signup must not wait on a provider, and a payment webhook must not fail because
Cloudflare had a bad second. Inline sending also makes retries somebody's manual
job. The queue turns both into a row plus a timer.

`MAIL_INLINE=1` keeps the suite honest: the same `enqueueEmail` path drains
immediately in tests, so the sink stays deterministic without sleeping on a
timer.

## Consequences

- Mail can be a minute late; nothing in the product depends on sub-minute
  delivery except the user staring at an inbox.
- A broken provider produces `failed` rows instead of silence. Admin can read
  `email_queue` (no plaintext captures leak there — only the copy that was
  already going to mail).
- Forwarding an external address needs a second inbox action. That friction is
  the feature: a typo cannot swallow a capture.
- The queue has no per-tenant rate limit yet; the 6-try cap bounds a stuck row,
  not a burst. Revisit when the capture API can enqueue in bulk.
