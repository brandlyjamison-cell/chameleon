# 0031 — Operator surfaces are a flag plus definer functions, not a second role

Status: accepted (2026-11-22)

## Context

The platform has one human operator and many tenants. A second database role
(`app_admin`) would double the deployment surface: two DSNs per request path,
two policy sets, and every new table needing a grant in both. The operator also
needs reads the tenant policies deliberately deny (cross-tenant counts, mail
bodies, money).

## Decision

1. There is exactly one runtime role, `app_rw`. Separation is application-level:
   every `/admin` page and `/api/admin/*` route calls `assertAdmin`, which reads
   `users.is_admin` from the session's user row. No tenant route checks the flag.
2. Cross-tenant reads and writes go through `SECURITY DEFINER` functions owned by
   `app_admin` with an explicit `org` or `service` argument (`admin_overview`,
   `admin_audit`, `list_orgs`, `admin_mail_stats`, `sweep_services`). A definer
   bypasses RLS, so an argument the caller could not read is the only way in.
3. The operator panel lives at `/admin` (rail group "Platform"), with
   `/admin/mail` for the queue and `/admin/audit` for the action log. Tenant
   pages never link into an operator action without the flag.
4. The panel is counts, state, money and mail headers. Capture plaintext stays
   unreadable to the operator by design; a decrypted view is a later feature.

## Consequences

- Adding an operator surface is a page plus one definer; no grant migration.
- A missed `assertAdmin` is a cross-tenant leak, so the flag check is the first
  line in every operator handler and `console.test.ts` asserts a tenant gets 307.
- Every definer that takes an id must also take `org_id` or `service_id`; a
  definer that trusts a bare id reintroduces the hole (see 0023).
- Audit rows are written by `admin_audit`, not by the page, so a bypassed page
  still logs.

## Rejected

- A second role: two DSNs and double grants for one operator.
- `is_admin` checks inside SQL policies: policies cannot see a request GUC for
  the flag without another `set_config` per request.

## Reversal cost

Medium. Introducing `app_admin` later means a DSN, a grant migration and moving
the definer call sites; the page structure and the audit log stay.
