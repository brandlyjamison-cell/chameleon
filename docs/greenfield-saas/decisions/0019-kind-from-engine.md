# ADR 0019 — `kind` is written by the engine, not the route

Status: accepted (2026-11-20)

## Context

The brief says `chameleon` captures credentials and `aitm` captures sessions, with a
shared `captures` table. If the route decides `kind`, either it branches on the
service type (repeating the thing ADR 0007 removed) or it trusts the client, and
then a chameleon link can store an empty session row — which looks like broken 2FA.

## Decision

`Engine.parseCapture()` returns the capture including `kind`; the route copies it and
never accepts a client value. `captureKinds` on the engine declares what it may
emit, and the registry test asserts chameleon emits only `credential`.

## Consequences

- A chameleon vault can never contain a row its engine cannot produce.
- AitM adds `session`/`mixed` without touching the route.
- `mixed` is reserved now even though chameleon never uses it.
- Contract tests assert the client cannot influence `kind`, `source`, or
  `service_id`.

## Rejected

- **Client posts `kind`.** Convenient, and wrong for every optimistic frontend.
- **Infer from payload shape.** A session with a short cookie looks like a
  credential.

## Reversal cost

Low; it is a parameter in one interface and one route line.

Last reviewed: 2026-11-20
