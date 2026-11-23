# ADR 0025 — Domain verification: DoH, SECURITY DEFINER lookups, and no quota

Status: accepted (2026-11-21), refined 2026-11-22 by 0032

## Context

Stage 4 attaches tenant hostnames. Three sub-decisions matter more than they look:
where TXT is resolved, how a tombstone can block another org at all, and what
happens while Cloudflare for SaaS has no quota (`OPEN-OPS-04`).

The tombstone rule (INV-SEC-07) is the interesting one. `domains` is under FORCE
row-level security, and inserts arrive as `app_rw` with `app.org_id` set, so both
the app-side lookup and the `before insert` trigger could only see the caller's
own rows. The first implementation therefore let a tombstoned hostname through:
proven by test, the second org got `201` where it should get `409`.

## Decision

- **TXT is resolved over DNS-over-HTTPS** (`cloudflare-dns.com`), not a local
  resolver. The box has no stub resolver we control, DoH is one HTTPS call, and it
  makes the check testable: the suite points `DNS_JSON_URL` at a local stub.
- **Cross-tenant reads go through `SECURITY DEFINER` SQL**, owned by the
  BYPASSRLS role: `find_live_domain`, `find_domain_tombstone`, and the tombstone
  trigger itself (0008). Everything else stays under a tenant GUC.
- **The job is a token-guarded route called by a systemd timer**, not a queue
  consumer. One box, five-minute cadence, and the token is compared in constant
  time. It expires 72-hour-unproven hosts, re-checks pending hosts every five
  minutes and active hosts daily.
- **A missing TXT on an active host flips it to `failed`** (links 404 at the
  edge); an unreachable resolver changes nothing, so a DoH blip is not an outage.
- **No Cloudflare quota is not a failure.** The TXT is proven and `verified_at`
  is written, but the row stays `verifying` with detail
  `txt ok, cf_entitlement_missing`. When the zone is upgraded the next pass
  creates the custom hostname and promotes. Nothing in stage 4 else is blocked.
- **Deleting tombstones for 30 days for every other org** and is revivable by the
  same org, which keeps its token and restarts the clock.

## Consequences

- `app_rw` gains `execute` on four functions; none of them can be tricked into
  returning another tenant's token because the caller already knows the hostname.
- `verified_at` without `active` is a legitimate state (TXT proven, TLS pending)
  and the schema already allows it; the trigger still blocks `active` without it.
- The edge (stage 5) must treat `failed` and `pending` alike: 404.

## Rejected

- **`RESOLVE` through `pg` or a shell `dig`.** A shell call per domain, and a
  dependency on whatever the box resolves with.
- **Disabling RLS on `domains`.** It is the table tenants read most.
- **`BYPASSRLS` on `app_rw`.** Then every other query loses its tenant fence.
- **Refusing to add a hostname while SaaS is unprovisioned.** It would hide the
  whole stage from the operator for a billing delay.

## Reversal cost

Low for DoH and the route; the functions are migration 0008 and can be dropped
once custom hostnames live in a table the job owns.

Last reviewed: 2026-11-21

## Refinement 2026-11-22

The verified object is now the org's root domain, not an individual hostname
(ADR 0032). The TXT lives at `_chameleon.<root>` and proves the whole root once;
hostnames under it carry no token. The tombstone, 72-hour expiry and
`assert_domain_verified` trigger all move with it.
