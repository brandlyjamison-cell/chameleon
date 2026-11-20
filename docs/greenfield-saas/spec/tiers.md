# Tiers

Tiers attach to a service. Never to an org. A tenant can be Pro on one
`chameleon` service and Starter on a second, and pay both. Total bill is the sum
of active services, computed server-side at checkout time from the tier rows.

Two tiers. No free tier, no trial. Card payments are out of scope; NowPayments
crypto only, monthly.

| | Starter | Pro |
| --- | --- | --- |
| Price | $19/mo | $49/mo |
| Links (slots) | 5 | 20 |
| Domains (slots) | 2 | 5 |
| Capture cap (rows, live) | 50,000 | 250,000 |
| CSV export | yes | yes |
| Webhook + API | no | yes |
| Gate modes | all | all |
| Brands | all 30 | all 30 |

No other lines. Nothing is metered by bytes, clicks, or visits in v1. Rendering
is the cost centre and it is not counted.

## Caps are slot caps, not rate caps

- **Link slots** = rows in `links` for the service with `deleted_at is null`.
  Minting at the cap returns `409 link_slots_exhausted` and offers delete-then-
  create. Existing links keep serving, always, even at or over cap.
- **Domain slots** = rows in `domains` for the service not `deleted_at`.
  Tombstoned rows do not count against the slot; they still block re-claim.
- **Capture cap** = rows in `captures` for the service. Past the cap the oldest
  rows are pruned on insert (INV-CAP-09). Serving never stops.

Counters are trigger-maintained columns on `services`
(`link_slots_used`, `domain_slots_used`) — INV-DATA-04. The UI may display them;
the transaction re-reads them.

## Capture cap behaviour

Storage is unbounded in *time* — nothing expires out from under the owner — but
bounded by row count, oldest first. Consequences, stated plainly so support can
quote them:

- Row 50,001 on Starter deletes the oldest row in the same transaction.
- A pruned capture cannot be recovered. Export is the only backup.
- Pruning happens per service; a second service never prunes a first.
- R2 payloads of pruned rows are deleted within 24h by the prune janitor.
- Cap pressure is shown at 80% and 100% on the service card.

`OPEN-TIER-01`: whether a capture the owner marked `valid` is exempt from
pruning until the cap is exceeded by a reserve factor. Arguments both ways:
marked rows are the product's output; exemption complicates the invariant.

## Export

CSV, streamed, always available on both tiers, gated by the vault passcode
session, capped only by the cap itself. Columns:
`received_at, source, status, kind, username, password, link_slug, brand, domain`.
`fields` extras go in one trailing `json` column so AitM needs no header change.

`OPEN-TIER-02`: export of 250k rows needs a job plus a signed R2 download rather
than a streamed response; decide the threshold (5k? 50k?) and whether the job
blocks the request.

## Webhook and API

Pro only, per service. Starter tenants can still read and export; their
integrations are manual.

- API tokens are downscoped principals: `org_id`, `service_id`, scopes subset of
  `links:write`, `vault:read`, `vault:export`. A token never spans services.
- Webhook endpoint per service: `POST` with `X-Signature: sha256=<hmac>` over
  `timestamp + body`, 8 retries with exponential backoff, disable after 24h of
  failures and notify.
- Fan-out is enqueued from the consumer, never from the victim's request.

Downgrade Pro→Starter with 12 live links: nothing is deleted, minting is blocked
until under 5, and the capture cap becomes 50k with an immediate prune batch.
`OPEN-SVC-01` covers whether downgrade is blocked outright.

## Tier change semantics

| Change | Effect |
| --- | --- |
| Starter → Pro | counters untouched, caps raised on payment confirm |
| Pro → Starter | caps lowered, prune batch, mint blocked over cap |
| Renewal | `expires_at` extended by one month from max(now, current end) |
| Lapse | no change to data, links 404 (INV-EDGE-06) |

Tier price is snapshotted onto the payment row at checkout, so a later price
change does not rewrite history.

## Enforcing the price

Checkout is a server route that reads `tiers` by id, sums active service
subscriptions for the org, and creates one NowPayments invoice per service
period. The client sends `service_id` + `tier_id` only; amounts are never sent.

## Who can change a tier

Owner only, and only to a tier of the same service_type. Every change is audited
by INV-OPS-01. Admin can override a tier for support (audited, with a reason
string) and can set `override_until` to comp a period without a payment row.

Last reviewed: 2026-11-20
