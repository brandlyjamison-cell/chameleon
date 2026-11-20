# ADR 0020 — Vault verification runs on the data plane

Status: accepted (2026-11-20)

## Context

ADR 0001 keeps the dashboard on the VPS. ADR 0017 keeps keys off it. Those two
conflict at exactly one point: the vault needs a passcode verified against
PBKDF2 and a DEK unwrapped, both of which need the key material.

## Decision

A vault handler runs in `apps/edge` on a control-host path (`/internal/vault/*`).
The control plane proxies to it with the platform session id in an HMAC header plus
the vault session cookie. The Worker re-resolves `org_id` from the session row and
re-checks service ownership, so a compromised control plane cannot ask for another
tenant's service by id alone.

The KEK binding exists only on the Worker. Nothing on the VPS can unwrap a DEK.

## Consequences

- Keys never leave Cloudflare.
- One narrow HTTP seam across the plane boundary, documented, and the only one.
- The control plane holds no plaintext beyond a proxied response, which it streams
  through without buffering where it can.
- The vault p95 is now a Worker + VPS round trip; RB-07 measures it.

## Rejected

- **KEK on the VPS.** Simple, and every admin-adjacent host becomes a key holder.
- **Move the whole dashboard to Workers.** Violates the stack constraint and loses
  Node tooling.

## Reversal cost

Medium. Moving it onto the VPS means shipping KEK handling there; the route shape is
unchanged.

Last reviewed: 2026-11-20
