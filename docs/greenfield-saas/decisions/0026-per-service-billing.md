# ADR 0026 — Billing is per service, and money comes before keys

Status: accepted 2026-11-21. Supersedes nothing; narrows ADR 0009.

## Decision

A subscription is one service, not one org. Each service carries its own price,
its own period (`services.paid_until`), and its own NowPayments invoice. There is
no org-wide plan, no seat count and no bundle: a tenant with three services holds
three periods and can let one lapse without losing the others.

Activation is gated on a confirmed payment. `services.paid_until` must be in the
future before `activateIn` will wrap a DEK, so an unpaid service never holds a key
nobody invoiced for. The gate is inside the same transaction as the wrap.

The period is fixed when the invoice is created (`period_end` on the payment row).
An IPN can confirm the money; it can never lengthen the term, so a forged or
replayed body cannot buy time. Only `finished`/`confirmed` extend, and the
extension is written once per payment row.

Recurring billing is ours: nothing auto-charges, because NowPayments holds no
mandate. Renewal is another invoice. `OPEN-BILL-01` stays open but the loop is
ours regardless.

Refunds and comps are operator actions in the panel (`admin_extend_days`); a
comp never writes a fake `confirmed` payment, it moves `paid_until` and is
attributed in `admin_note`.

## Consequences

- An expired period stops new captures and makes the dashboard show a renewal;
  it does not delete the service or its vault.
- The activation form is hidden until paid, so "press activate, nothing happens"
  becomes a billing state, not a surprise error.
- Price is snapshotted onto `payments.price_cents`; a later tier change does not
  rewrite history.
- `partially_paid` holds as `confirming` (OPEN-BILL-03) and does not extend.
