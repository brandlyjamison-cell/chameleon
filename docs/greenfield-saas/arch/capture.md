# Capture

The capture path is the product's only write and the only place a victim waits.
It is: verify token, parse with the engine, encrypt, enqueue, 302. Nothing else.

## Token

Every render embeds a token in the form action: `POST /c/<token>`.

Token = base64url(`v1.<link_id>.<iat>.<service_id>.<sig>`), `sig =
HMAC-SHA-256(service.token_secret, "v1|link_id|iat|service_id")`. 30-minute
validity, no single use (a resubmit is deduped anyway). The secret is per
service, 32 bytes, rotated on demand; rotation invalidates unredeemed tokens,
which is acceptable because renders are short-lived.

Invalid, expired, or wrong-service token → the same unbranded 404. No oracle
distinguishing "expired token" from "bad link".

`OPEN-CAP-01`: bind the token to the requesting cookie/session so a captured link
cannot be replayed by a third party. Cost: a cookie on the data plane, which we
currently avoid.

## Parse

`engine.parseCapture(form, prior)` is the only place that knows field names.
`chameleon` reads `email` (step 1) and `password` (step 2), keeps `email` in a
hidden field, and returns `{kind:'credential', fields:{username, password}}`. It
trims, caps `username` at 320 chars and `password` at 1024, and rejects an empty
password. A two-step form with no `prior` username is accepted with
`username=''` only if step 1 posted; otherwise 422 as a 404 page.

The engine also owns `redirectTarget()` — the real login URL. It is built from the
brand row (`login_url`), with the address appended when the brand supports
`?email=`. It is never a tenant-supplied URL.

## Encrypt

```
plain = cbor({username, password, submitted_at, kind, ua_class, source})
aad   = utf8(`${link_id}|${capture_id}|${email_hash_b64}`)
sealed= AES-256-GCM(dek, random 96-bit iv, plain, aad)
msg   = { v:1, capture_id, org_id, service_id, link_id, kind, source,
          email_hash, email_domain, received_at, sealed }
```

`capture_id` is a UUIDv7 minted at the edge so ordering and idempotency work
before Postgres. `email_hash` is computed at the edge with the service's dedupe
salt, which is part of the KV link doc's service bundle (not the secret DEK).

The DEK is resolved at the edge per request. For gate `off` it is unwrapped from
`dek_wrapped` with the KEK; for gate on it is unwrapped from the passcode key
cached in the service's Durable Object by a prior vault open. If neither is warm,
`OPEN-CAP-02`: block on unwrap, or enqueue plaintext to be sealed by the consumer
(today: block, it is one PBKDF2 and the 302 is still < 120ms).

The queue body is ciphertext. The consumer holds no key; it stores `fields` as
the envelope verbatim.

## Enqueue and respond

```ts
env.CAPTURE_QUEUE.send(msg);
ctx.waitUntil(emitAccessLog(...));
return redirect(redirectTarget, 302);
```

`send()` failure is caught and the response still 302s; a failed send bumps a
metric. No retry inline — a victim must not wait. A lost capture is accepted
(rare, and the alternative is a spinner).

302 target is `https://` only, built server-side. Cache headers on the 302:
`cache-control: no-store`.

## Queue consumer (`apps/pipeline`)

Batch ≤ 100, 4 consumers max, idempotent per `capture_id`.

1. `set local app.org_id = msg.org_id` in the transaction.
2. `insert ... on conflict (service_id, email_hash, dedupe_bucket) do nothing`.
3. On conflict, bump `captures_suppressed`, skip.
4. Read the service's cap from its tier; prune the oldest beyond cap into
   `prune_queue`.
5. Insert `outbox` row for webhook fan-out (Pro only).
6. Commit. Ack the batch.

Per-message failure: 5 attempts with backoff; then `captures_dead` table (same
shape) and an alarm. A poison payload must not stall the batch — `max_retries`
and a per-message try/catch.

Batching is by service so one transaction sets one `app.org_id`.

## Dedupe

15-minute bucket on `(service_id, email_hash, bucket)`, unique, at insert. Two
submits from the same address on the same link inside one bucket collapse. Across
links in one service they do not, because `link_id` is the real duplicate signal
and `OPEN-CAP-03` asks whether it should be.

Suppressed rows increment a counter only. The vault shows a small
"12 duplicates suppressed" note per service.

## Session payloads (`aitm`, later, already in the contract)

If `kind != 'credential'` or sealed size > 2KB: write `r2://captures/<service>/<capture_id>`
with the envelope bytes, set `payload_ref`, insert with `fields = '{}'`. R2 write
happens before the row insert; an orphan object is cleaned by the janitor.
5KB floor and 50KB ceiling are enforced at the edge (`413` as 404 page above the
ceiling).

The consumer does not parse the payload. It is opaque to the pipeline, which is
what keeps AitM out of the write path's shape.

## Pruning and deletion

- Cap prune: same transaction as insert, oldest by `(received_at, id)`, batches of
  500, rows appended to `prune_queue`.
- Owner delete: row delete + `prune_queue` row.
- Janitor (hourly, `apps/pipeline`): reads `prune_queue`, deletes the R2 object if
  `payload_ref`, deletes the queue row. Idempotent, safe on a missing object.
- An R2 orphan sweep runs daily against `captures` ids for `payload_ref` rows.

## Ordering and time

`received_at` is set at the edge (UTC ms) and stored; it is the prune order key.
Clock skew across Workers is < 1 s and irrelevant to a 15-minute bucket. Postgres
`now()` is used only for `updated_at` columns.

## Failure matrix

| Failure | Result |
| --- | --- |
| KV miss on link | 404, no capture |
| token invalid | 404, no capture |
| entitlement expired | 404, no capture |
| encrypt error | 302 still sent, metric increment (capture lost) |
| queue send error | 302 still sent, metric increment |
| consumer down | backlog, victims unaffected |
| Postgres down at consume | retries, `captures_dead` after 5 |
| R2 down | session captures stall, credential captures unaffected |

## Source classification

`source` is set at render time and carried in the token payload:

- `scanner` — UA matches a known scanner list, or the fetch has
  `sec-fetch-mode: navigate` absent with known prefetch headers, or no
  `Accept-Language`.
- `decoy` — the render reached via the cPanel fallback on a live link.
- `human` — everything else.

Misclassifying is cheap because the vault defaults to hiding only `scanner`, and
status is owner-controlled.

## What must never appear

- A password in a log line, in the queue body, or in `captures_suppressed`.
- A capture without `service_id` or `source`.
- An inline session payload.
- A client-supplied `kind`, `source`, `service_id`, or `received_at`.

Last reviewed: 2026-11-20
