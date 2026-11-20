# Billing

Crypto only, monthly, NowPayments. No cards, no trials, no proration. Each active
service is a subscription; the bill is the sum of its price.

## Why NowPayments and what it costs us

Operators pay in crypto and resent card declines. NowPayments gives hosted
invoices for ~40 coins and an IPN webhook. It does **not** give us a
subscription object, so recurring billing is ours: we invoice each period and
extend only on a confirmed payment. That is more state than Stripe and it is the
price of the audience.

`OPEN-BILL-01`: NowPayments has a recurring/`subscription` product — use it, or
keep our own period loop? Lean: own loop, because their recurrence is thin and
partial payments across coins get messy.

## Checkout

`POST /api/billing/checkout` (owner, authenticated):

1. Read `service_id` + `tier_id` from the form; load the tier row.
2. Sum the org's active services.
3. Create a `payments` row: `status='pending'`, price snapshot, `period_start =
   now()`, `period_end = now() + 1 month` (or from current end if renewing).
4. `POST https://api.nowpayments.io/v1/invoice` with `price_amount`, `order_id =
   payment.id`, `ipn_callback_url`, `success_url`, `cancel_url`.
5. Store `provider_invoice_id`, return the hosted URL.
6. Redirect the browser.

Amounts are read from the DB, never the client. Keys live in Worker secrets; the
control plane calls the Worker (`/internal/billing/*`) so keys never reach the
VPS. `OPEN-BILL-02`: acceptable hop, or hold a restricted NowPayments key on the
VPS?

## Payment states

```
pending → confirming → confirmed → (refunded)
                     ↘ failed
                     ↘ expired
```

Forward-only, enforced by a transition function with `for update`. `confirmed`
is the only state that extends a service, and only once per `payments` row
(`extended_at` non-null guard).

`provider_payment_id` is unique. A duplicate IPN is a no-op by unique violation,
not by a read-then-check.

## IPN webhook

`POST /internal/billing/ipn` on the edge:

1. Read raw body bytes before parsing.
2. Recompute HMAC-SHA-512 over the sorted-key JSON per NowPayments' scheme with
   the IPN secret; constant-time compare.
3. `insert into webhook_events (provider, provider_event_id) on conflict do
   nothing`; if no row returned, ack 200 and stop.
4. `GET /v1/payment/<payment_id>` from NowPayments. **Trust the API response, not
   the body** (INV-SEC-05).
5. Map API status: `finished`/`confirmed` → confirmed; `partially_paid` →
   confirming with a note; `failed`/`expired` → terminal.
6. On confirmed: extend `expires_at` from `max(now(), expires_at)`, set
   `ent=active` + purge, clear warnings, send receipt, audit.
7. Ack 200. On internal error, 500 and let them retry.

`OPEN-BILL-03`: underpayment tolerance (`partially_paid` within 2%? credit the
period or hold?). Lean: hold as `confirming`, surface in admin, never auto-credit.

## Renewal and dunning

A cron every hour finds services expiring within 24 h with no pending invoice and
mints one; the tenant gets an email with the pay link. Nothing auto-charges —
there is no stored mandate.

Warning ladder (owner email + dashboard banner): T-7, T-3, T-1, T-0. Copy is
short and states the exact 404 hour in the tenant's displayed timezone while the
math stays UTC.

`past_due` = `expires_at` passed with a pending/confirming payment. It still
serves for a 48-hour grace window `OPEN-BILL-04`, then `expired` and 404.

After 30 days expired, `archived`; captures stay readable for export for another
30 days, then the service is data-deleted on request or at 90 days.

## Refunds

Admin-initiated only, from the NowPayments dashboard, then recorded here with
`status='refunded'` and a `refund` event. Service is not shortened mid-period by
default `OPEN-BILL-05`; the next invoice is skipped.

## Sum and display

The billing page shows per-service price, next due, status, and a total. The total
is computed server-side from tiers and active services. A service in `pending` is
shown separately as "not started".

`OPEN-BILL-06`: does a Starter+Pro tenant on two services get a combined invoice
or one per service? Lean: one per service, because each has its own period and
tier, and combined invoices make partial cancellation a refund problem.

## Failure handling

| Case | Behaviour |
| --- | --- |
| IPN forged | 401, no state change, logged |
| IPN valid, API contradicts | follow API, log divergence |
| API unreachable | 500, retry |
| Double IPN | 200 no-op |
| Payment for an expired service, arrives late | confirm, reactivate, `expires_at` from now |
| Payment for a deleted service | confirm, park in admin queue for reassignment |
| Chargeback/refund after period start | refund recorded, period stands |

## Alarms

- IPN 5xx rate > 1% for 10 min.
- Any payment stuck `confirming` > 2 h.
- Confirmed payment whose service not extended within 60 s.
- Hourly renewal cron miss.

## Compliance surface

Crypto means no VAT engine in v1 `OPEN-BILL-07`. Receipts are a generated PDF in
R2 (invoice number, service, period, amount, org). No card data ever touches us.

Last reviewed: 2026-11-20
