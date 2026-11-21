# ADR 0022 — One login per org, one platform admin

Status: accepted (2026-11-21)

## Context

The brief excludes team seats. The alternative was a role matrix (owner, admin,
operator, analyst, viewer) and an invite flow, which is a permission system, an
email flow, a seat counter and a UI before anyone can capture a password. Meanwhile
the only human running the platform needs cross-tenant support and cannot have
tenant roles.

## Decision

- An org has exactly one user: the one who signed up. `memberships` stays because it
  is already the join table, but it holds one `owner` row and nothing else.
- No invite UI, no seat counting, no role picker.
- Platform admin is `users.is_admin`, a boolean on the person, not a tenant role.
  Admin is cross-tenant, audited, and blind to captures (ADR 0017).

## Consequences

- Tenant permissions collapse to "the owner can do everything in their org".
- Admin becomes a second login (the human), gated by a passkey, not a role grant.
- Adding a second member later is a row, an invite flow and a seat check — no
  migration.
- Every existing permission name (`links:create`, `vault:export`, …) survives as a
  vocabulary for the API token scopes, even though no human role varies.

## Rejected

- **A role matrix at launch.** Five roles for one user per org is configuration
  theatre.
- **Admin as an org-level role.** It would have to be duplicated into every org, or
  added to each membership row.

## Reversal cost

Low for the single-login part. The role matrix is a map over a column that already
exists.

Last reviewed: 2026-11-21
