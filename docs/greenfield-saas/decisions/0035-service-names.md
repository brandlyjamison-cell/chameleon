# 0035 — A service has a tenant-chosen name, separate from type and plan

Status: accepted (2026-11-22)

## Context

Two Chameleon services on one account were indistinguishable: the list said
"chameleon" twice, the vault filter said "chameleon", and the overview headed
both cards the same. The type is the product and the tier is the price; neither
identifies the campaign.

## Decision

1. `services.name` is required, tenant-supplied, 2–60 characters, unique per org
   case-insensitively (`services_name_per_org`). A duplicate returns 409
   `name_taken`.
2. Creation stamps it from input; a missing name falls back to
   `<engine label> <Tier>` through `defaultServiceName`, so the API stays usable.
3. The name, not the type, is the title of the service page, the dashboard card,
   the services list and the admin tenant view. The type is shown beside it.
4. Type and plan remain separate pickers; an unavailable type (`aitm`) is shown
   disabled rather than hidden, so the roadmap is visible.

## Consequences

- Lists become scannable and the vault can be filtered by service unambiguously.
- A rename later is a single update; nothing keys off the name.
- Existing rows were backfilled with a numbered fallback and are renameable.

## Rejected

- Deriving the name from the hostname: it changes when a hostname moves.
- Letting names collide: two "Marketing" services would recreate the problem.

## Reversal cost

Low: drop the unique index to allow collisions; nothing else depends on it.
