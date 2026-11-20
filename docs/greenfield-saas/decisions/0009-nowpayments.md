# ADR 0009 — Crypto-only billing via NowPayments

Status: accepted (2026-11-20)

## Context

The audience pays in crypto and shares card-decline pain. Card billing needs
PCI-adjacent process, currency and VAT handling, and a provider that dislikes
high-dispute merchants. Crypto removes disputes entirely.

## Decision

NowPayments, monthly, hosted invoices, IPN webhook. One payment row per service
period; service extends only on confirmed payment, verified by HMAC then by a
server-side API re-fetch (INV-SEC-05). No stored mandate: renewal is a cron that
mints a fresh invoice (RB-03).

## Consequences

- Every period needs an active payment; there is no silent auto-charge.
- Volatility is theirs (fixed at invoice creation, short expiry).
- Refunds are manual, on their dashboard, recorded here.
- Partial payment needs a policy (`OPEN-BILL-03`).
- No card data, no PCI scope, no chargebacks.

## Rejected

- **Stripe.** Card declines and disputes the audience resents; adds card data
  handling. Revisit as a secondary provider, not a replacement.
- **Own wallets and a chain watcher.** More fraud surface and reorg handling.

## Reversal cost

Medium. A second provider fits behind the same `payments` row if `provider` becomes
a column; the expiry semantics do not change.

Last reviewed: 2026-11-20
