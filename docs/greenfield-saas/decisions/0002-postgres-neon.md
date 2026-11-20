# ADR 0002 — Postgres on Neon behind Hyperdrive

Status: accepted (2026-11-20)

## Context

Postgres over D1 is fixed. The open split was managed vs self-hosted. The data
plane must reach it from Workers and the control plane from a VPS, with RLS,
composite FKs, triggers, and PITR.

Self-hosting puts Postgres, the control app, and the queue backlog on one disk and
one blast radius, and makes the restore story ours to build.

## Decision

Neon, one project per environment, branching for preview and restore rehearsal.
Workers reach it through Hyperdrive (connection pooling survives Worker
concurrency). The VPS connects directly, pooled by PgBouncer in transaction mode.
Roles: `app_migrator`, `app_rw`, `edge_ro`, `app_admin`.

## Consequences

- RLS, triggers, and composite FKs all work as designed.
- PITR is a branch, so the restore rehearsal is cheap and real.
- Cost is compute-hours, not row count; the per-service capture cap keeps the row
  growth bounded.
- Vendor lock is low: plain Postgres, `pg_dump` works, Drizzle migrations are
  portable.
- Escape hatch documented: the same schema runs on self-hosted 16 with
  `pgbouncer`; only the DSN and Hyperdrive config change.

## Rejected

- **Self-hosted on the VPS.** One disk failure takes the dashboard and the
  database together, and the VPS has no independent PITR.
- **Supabase.** Adds an auth and storage product we would half-use.

## Reversal cost

Medium. A `pg_dump`/restore plus a Hyperdrive config change, then a DNS cutover;
budget one maintenance window.

Last reviewed: 2026-11-20
