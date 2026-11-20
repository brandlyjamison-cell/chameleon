# ADR 0017 — Admin is blind to capture plaintext

Status: accepted (2026-11-20)

## Context

Support will constantly want "just look at the row". Every tool that can read
captures becomes a copy of the vault: a laptop, a screenshot in a ticket, a CSV in a
DM. Admin is a cross-tenant DB role, so if admin can decrypt, one stolen session is
every credential.

## Decision

Admin routes never hold key material. The KEK is bound to `apps/edge` and
`apps/pipeline` only. Admin sees counts, sources, statuses, timestamps, and the
encrypted envelope. There is no decrypt button in v1; support gets plaintext by
asking the tenant for the passcode and using the normal vault path.

## Consequences

- Admin is genuinely unable to read, not just politely discouraged.
- Support conversations get one extra step, and the docs must say so on the admin
  page.
- Admin needs no key rotation story of its own.
- Cross-tenant debugging is still possible on metadata, which is enough for 95% of
  tickets.

## Rejected

- **Decrypt-in-admin behind a click.** Convenient, and re-creates the leak surface
  the gate exists to remove.
- **Separate admin DEK wrapping.** Doubles the wrap matrix for a feature support
  rarely needs.

## Reversal cost

Low to add later (bind the KEK to control and add an audited route); high to remove
once support depends on it.

Last reviewed: 2026-11-20
