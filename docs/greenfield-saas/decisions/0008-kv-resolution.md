# ADR 0008 — KV is the resolution authority; Postgres is truth

Status: accepted (2026-11-20)

## Context

A render cannot wait for a pooled database round trip per request, and the data
plane must survive Postgres being down. But expiry, domain status, and pinning are
relational facts.

## Decision

KV carries a complete resolution document per host and per link, plus one
entitlement flag per service. The request path reads KV only. Postgres writes on
the control plane, which then writes or purges the KV keys. A five-minute sweeper
re-derives KV from Postgres so a missed write self-heals.

Default deny: missing key, missing field, or unparsable value is a 404.

## Consequences

- Postgres outage degrades control-plane writes, not links.
- KV propagation (typically < 60 s) sits inside the entitlement promise; the
  sweeper is the guarantee, not the TTL.
- Every relational write needs a matching KV invalidation; that coupling is tested
  per write path.
- The KV value is a small schema of its own and needs versioning (`v`).

## Rejected

- **DB read per render.** Sub-100 ms is achievable but not during failover, and
  the whole point is availability.
- **Cache-aside with a DB miss path.** The miss path becomes the load path exactly
  when the DB is weakest.

## Reversal cost

Low to add a cache, high to make KV the authority after the fact — every write path
and the test suite assumes invalidation exists.

Last reviewed: 2026-11-20
