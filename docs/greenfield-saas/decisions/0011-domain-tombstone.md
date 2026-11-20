# ADR 0011 — Hostnames are tombstoned, not freed

Status: accepted (2026-11-20)

## Context

A tenant deletes `mail.acme.com` and leaves the CNAME in place. Another tenant adds
the same hostname, serves links on it, and the first tenant's live mail keeps
pointing there. Worse, the second tenant can then intercept links the first is
still mailing.

## Decision

Delete sets `deleted_at` + `tombstoned_at` and keeps the row. Tombstones do not
consume a slot, are excluded from `active`, and block re-add by another org for 30
days. The same org can revive inside the window (row restored, TXT re-verified).
After 30 days the row is reduced to hostname + tombstone date and kept a year.

## Consequences

- A dangling CNAME can never be silently re-claimed.
- Support gets a routine "can you release this hostname" request; there is no
  release in v1, only waiting.
- Revival re-runs TXT, so a revived hostname is never live on a stale claim.
- The unique index is partial on `deleted_at is null`, so tombstone rows do not
  block their own revive check.

## Rejected

- **Hard delete.** Simple, and the CNAME re-claim bug is real and invisible.
- **Permanent tombstone.** Hostnames would accumulate forever; a year is enough
  for a dead campaign.

## Reversal cost

Low to extend the window, high to remove tombstones once tenants rely on the
protection.

Last reviewed: 2026-11-20
