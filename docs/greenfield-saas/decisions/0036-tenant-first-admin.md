# 0036 — The operator panel is tenant-first, with its own rail

Status: accepted (2026-11-22)

## Context

The first panel was a flat wall of every service and every org on one page. The
operator's actual question is "what is going on with this account", and answering
it meant scanning three tables and matching ids by eye. Being reachable only from
the tenant's own footer also implied the panel was a tenant feature.

## Decision

1. `/admin` is a **tenant list**: searchable by org name, owner email or exact
   tenant id, with per-tenant counts. `/admin/tenants/<org>` is the detail page.
2. The detail page carries the whole account: services with caps and quotas,
   domains, hostnames, forwarding addresses, and the audit tail. Every action
   (comp days, suspend/restore, note) sits on the row it affects.
3. Admin pages have their own horizontal rail (Tenants, Mail queue, Audit log,
   Back to console) rendered by `app/admin/layout.tsx`, which also performs the
   admin guard. The tenant sidebar no longer shows an operator entry.
4. Backend authorisation is unchanged and independent of the UI: every page calls
   `requireAdminPage` and every `/api/admin/*` route re-checks `is_admin` itself.
   A hidden link is never the control (ADR 0031).
5. Cross-tenant reads are definer functions (`admin_tenants`, `admin_org_detail`)
   so forced RLS cannot hide the rows the operator is looking for.
6. Service detail keeps its URL (`/admin/<serviceId>`) and now breadcrumbs back
   through the tenant.

## Consequences

- Finding a tenant is one search instead of a scroll, and every fact about it is
  on one screen.
- Two more definer functions to keep argument-scoped (ADR 0021/0031).
- The admin rail duplicates three links; that is cheaper than a second shell.

## Rejected

- Keeping the flat service wall with a filter: still starts from the wrong
  object.
- One giant `/admin` page with expandable rows: deep links and audit trails get
  muddy.

## Reversal cost

Low. The routes are additive; deleting the layout restores the flat list.
