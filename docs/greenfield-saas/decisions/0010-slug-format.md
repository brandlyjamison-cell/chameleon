# ADR 0010 — Slug format and minting

Status: accepted (2026-11-20)

## Context

Slugs go into blast text and get read by machines. They must be short, unambiguous
when read aloud, and unguessable enough that one tenant cannot probe another's.

Uniqueness scope drives the schema and the resolver key.

## Decision

Five characters from Crockford base32 minus `I L O U` (31-symbol alphabet), ~28.6M
combinations. Random, not sequential, not derived from the brand. Unique per
`(service_id)` among non-deleted links. Minted server-side in one transaction that
locks the service row and re-reads the counter.

Slug is immutable. A "rename" mints a new link and keeps the old slug as a 301 for
30 days. Vanity slugs allowed on Pro when free.

## Consequences

- Short enough for SMS and mail-body line wraps.
- Per-service uniqueness means two tenants can share a slug; the host disambiguates.
- Signed tokens carry the authority, so the slug is not security (INV-SEC-04).
- Five chars is 28.6M; a single service at 20 links will not collide, so retry is a
  rare loop with a 3-attempt cap.

## Rejected

- **Long slugs.** Shorter is better in a blast; entropy comes from the token.
- **Brand-derived slugs.** Leaks the template to anyone who reads the URL.
- **Global uniqueness.** Forces a global index and cross-tenant collisions.

## Reversal cost

Low while under ~1M links; a change after that is a redirect table plus every
tenant's cached mail.

Last reviewed: 2026-11-20
