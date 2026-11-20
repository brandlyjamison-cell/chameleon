# ADR 0016 — Better Auth for platform identity

Status: accepted (2026-11-20)

## Context

Platform auth is not the product. It still needs sessions, verification, passkeys,
and CSRF, and hand-rolling it is the classic week lost followed by two latent bugs.

## Decision

Better Auth on the control plane, Postgres adapter, email+password (Argon2id) with
passkeys as an optional second factor, required for admin. Session rows and cookies
as in `arch/security.md`. A `memberships` join table from day one so the schema
supports a second member later.

## Consequences

- Battle-tested session, CSRF, and passkey plumbing.
- Better Auth owns its own tables; ours reference `users.id` and never duplicate
  auth columns.
- Upgrades are a dependency to track, not a rewrite.
- The library lives only on the control plane, keeping the Worker bundle free of it.

## Rejected

- **Hand-rolled sessions.** Fine for one dev until passkeys and CSRF arrive.
- **Hosted identity (Clerk etc.).** Another tenant-data processor and a per-MAU
  cost for an audience we bill at $19.

## Reversal cost

Medium. Export users, re-hash, and rewrite the session layer; the `memberships`
shape survives.

Last reviewed: 2026-11-20
