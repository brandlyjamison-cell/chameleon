# 0028 — Console information architecture and white service surfaces

Status: accepted (2026-11-21)

## Context

The console grew by feature: one service detail page held identity, billing,
activation, domains, forwarding and errors in a single document. Navigation was a
top bar with two links. Tenants had no overview, no vault entry point and no place
for org-wide configuration, so every surface was either the service page or the
operator panel.

## Decision

1. The signed-in shell is a left rail with four groups: Overview, Products &
   services, Data (vault), Configuration (organisation, domains, forwarding,
   delivery). The operator panel is a fifth group, shown only with the admin flag.
   Account and sign-out sit at the foot.
2. Every page has one header band: breadcrumb, title, one sentence of purpose and
   at most two primary actions. Detail pages split into a main column and a 320px
   summary column; settings sit in stacked hairline cards.
3. Surfaces are predominantly white with hairline borders and one emerald accent.
   Status is a tokenised pill, not coloured prose.
4. Service pages are organised by what the service does, not by database column:
   links, hostnames with copyable records, captures, forwarding, and an
   `Advanced` block for identity and gate.
5. Destructive actions confirm; copy actions confirm inline for 1.6s; empty
   states name the next action.

## Consequences

- A tenant can answer "what is broken, what is new, what do I do next" from the
  overview without reading a wall of settings.
- The rail is a fixed contract: adding a surface means deciding its group first.
- DNS values are individually copyable with type, name, value and TTL, which
  removes the largest support cost in hostname setup.

## Rejected

- Tabs on the service page: they hide the relationship between a host, a link and
  a capture, and tabs rot into arbitrary buckets.
- A dark treatment: the operator's reference (Verpex) and long record values read
  better on white.

## Reversal cost

Low. Class names are semantic, pages are server components, and no schema depends
on the layout.
