# ADR 0007 — Service types behind an engine registry

Status: accepted (2026-11-20)

## Context

`chameleon` ships first and `aitm` later. If chameleon is written into the routes,
aitm means a second codebase, a forked link table, or a `if (type === 'aitm')`
ladder that grows with every service type after that.

## Decision

`service_types` rows name an engine module, its `default_kind`, and its allowed
`captureKinds`. The route calls `engineFor(serviceType)` and never compares the
type. Adding a type is a registry insert, an engine module, tier seeds, and a
contract fixture (INV-ARCH-02/04).

The shared route passes a `ResolveInput` and receives a `ResolvedTemplate`, an HTML
string, and an `EngineCapture`.

## Consequences

- Chameleon assumptions must be expressed as data, not branches.
- A TypeScript interface is now a public contract; changes are ADR-worthy.
- A test-only `echo` engine must keep passing, so the seam stays honest.
- The registry is also the feature flag for launch of a new type.

## Rejected

- **Two routers.** Duplicated token, seal, and 302 logic.
- **Strategy only at the render call.** Leaves capture shape and redirect outside
  the seam, which is where aitm actually differs.

## Reversal cost

Medium. Collapsing the registry back into branches is mechanical until the third
type; after that it is a rewrite.

Last reviewed: 2026-11-20
