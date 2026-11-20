# ADR 0013 — Static skeleton, never iframes

Status: accepted (2026-11-20)

## Context

Embedding the real site is the obvious shortcut. `X-Frame-Options: DENY` and
`frame-ancestors` on nearly every identity provider kill it, including the ones
with the best conversion. Proxying is aitm's job, later.

## Decision

One parameterised skeleton, server-rendered HTML, brand values substituted as CSS
custom properties and text nodes. Logo, favicon, and a blurred backdrop screenshot
from R2. No external requests at render time.

## Consequences

- We control latency, markup, and every tell.
- The page does not track the real site's redesign; screenshots go stale and are
  refreshed with the brand seed.
- Field labels come from the brand row, so they can be wrong; they are editable per
  brand, not per render.
- The skeleton is isomorphic and testable without a browser.

## Rejected

- **Iframe with a fallback image.** Two render paths and an invisible branch.
- **A screenshot with an image map.** No focus, no password-manager support.

## Reversal cost

Low to restyle; the skeleton is one template and a slot schema.

Last reviewed: 2026-11-20
