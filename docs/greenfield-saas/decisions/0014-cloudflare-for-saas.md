# ADR 0014 — Cloudflare for SaaS for hostnames

Status: accepted (2026-11-20), amended 2026-11-22 by 0032

## Context

Tenants bring arbitrary hostnames. Each needs a certificate, a Worker route, and a
mapping to a service. Doing this by hand or with a per-host certificate script does
not survive a rotation-heavy customer.

## Decision

Cloudflare for SaaS custom hostnames. The tenant CNAMEs to the platform fallback
origin; CF issues TLS after TXT validation, routes to the Worker, and gives us a
hostname API with status. We store `cf_hostname_id` and treat CF status as a second
verification gate alongside our TXT.

## Consequences

- TLS is theirs; no cert storage, no renewal job.
- Hostname state has two sources of truth (our row and CF); the verify job requires
  both before `active`.
- CF downtime is our outage for new hostnames, not existing ones.
- Cost is per custom hostname; the domain caps bound it.

## Rejected

- **Own certbot/ACME.** Renewal jobs and cert storage on a single VPS.
- **`*.tenant.com` only.** Tenants want apex and arbitrary subdomains.

## Reversal cost

Medium. Alternate is an ACME pipeline plus a proxy layer; the domain schema already
allows a different `tls_ref`.

Last reviewed: 2026-11-20

## Amendment 2026-11-22

The SaaS entitlement is not on the account yet: the zone is Free and
`/custom_hostnames` returns `1404`. The wildcard `CNAME` is still the tenant's
one-time setup and is safe to add before routing exists. A root whose TXT is
proven parks at `routing_waiting`; a capability probe plus the 15-minute reconcile
promotes it to `active` on the first check after the zone is upgraded, with no
code change. Preview links (ADR 0033) do not depend on any of this.
