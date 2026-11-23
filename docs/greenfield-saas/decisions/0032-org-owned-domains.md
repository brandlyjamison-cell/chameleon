# 0032 — Domains belong to the org, hostnames belong to the service

Status: accepted (2026-11-22)

## Context

The first build made each hostname its own verified object with its own TXT
token, so a tenant with five services and one `acme.com` pasted five identical
wildcard records and re-proved the same root every time. Support saw the same
mistake repeatedly: a root typed where a host belonged, then a second root that
was really a subdomain. The DNS cost of the second service was the reason tenants
stopped at one.

## Decision

1. A **domain** is a registrable root (`acme.com`, `el-dept.co.uk`) owned by the
   org (`org_domains`). It is verified once, with one TXT record at the root.
2. A **hostname** (`portal.acme.com`) is a label under a verified domain, owned by
   exactly one service (`hostnames.domain_id` + `service_id`). It carries no
   verification of its own.
3. One wildcard `CNAME` per domain, set once. Every later hostname inherits it.
4. The tenant's quotas are hostnames per service (`tiers.hostname_cap`); there is
   no org-level domain cap in v1. The zone-wide ceiling stays 250 live roots.
5. Roots are parsed with a real public-suffix list (`tldts`), never by dot count.
   A pasted URL is reduced to its registrable root; a bare subdomain is rejected
   with `use_root_domain`.
6. Deletion tombstones the root for 30 days across orgs and revives it for its own
   org. Hostnames tombstone the same way.

## Consequences

- The second service on an existing domain costs no DNS work at all.
- The Domain page is a verification surface, not a per-service form.
- Moving a hostname between services is a column update, not a re-verification.
- Backfill had to guess roots from old hostnames; guesses are flagged
  `review_needed` and the UI says so.
- Cross-tenant lookups (`find_live_domain`, `find_domain_tombstone`) must be
  definer functions: forced RLS hides other orgs from the caller.

## Rejected

- Per-service verification kept as-is: the repeated DNS step is the complaint.
- A heuristic two-label split in the app: wrong for every `co.uk`-shaped root.

## Reversal cost

Medium. `hostnames` already holds an `fqdn`, so a migration could re-key links to
hostnames and drop the root table, at the cost of re-proving every domain.
