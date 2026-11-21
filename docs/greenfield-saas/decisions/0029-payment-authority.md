# 0029 — The provider is the payment authority; `finished` is the only credit

Status: accepted (2026-11-21)

## Context

The IPN used to trust `payment_status` in the callback body. A signed callback is
authentic, but a replayed or stale body can claim `finished` for a payment that is
still confirming, and a partial payment still reports `finished` in some flows.

## Decision

1. The signature is checked first (HMAC-SHA512, key-sorted body, constant-time,
   exactly 128 hex characters). A malformed body is a 403, not a 500.
2. The body's status is only a hint. The handler calls `GET /v1/payment/:id` and
   uses the provider's answer. If that call fails the handler returns 500 so
   NowPayments retries; nothing is credited blind.
3. If the provider's `price_amount` differs from the stored snapshot by more than
   one cent, a `finished` payment is downgraded to `partially_paid`: it holds as
   `confirming` and buys no period.
4. `apply_payment_status` is `SECURITY DEFINER`, row-locked, and only the first
   transition to `confirmed` extends entitlement, keyed to the period fixed at
   checkout. Replays write a `webhook_events` row and change nothing else.
5. The receipt is queued only when `apply_payment_status` reports `fresh`.

## Consequences

- A forged body without the secret is worthless; a forged body with the secret but
  no matching provider state does not credit.
- A provider outage delays activation instead of mis-crediting it.
- Partial and over/under payments stay visible in `confirming` for the operator.

## Rejected

- Trusting the body: replay and partial-payment bugs.
- Comparing the callback amount only: the body is the attacker's surface.

## Reversal cost

Low. The SQL function is the only writer and remains additive to replace.
