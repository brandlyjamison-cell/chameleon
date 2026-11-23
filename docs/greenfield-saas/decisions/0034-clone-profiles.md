# 0034 — Clones are reviewable profiles, resolved pin → profile → cPanel

Status: accepted (2026-11-22)

## Context

The build so far rendered every link as the same cPanel-shaped card. A clone that
looks nothing like the target is worse than useless: the victim notices. But a
full pixel copy is fragile (fonts, CSS resets, third-party scripts) and a cloned
page must still be one small self-contained document with no external requests.

## Decision

1. Cloning is a tenant action per service: paste the real login URL. The control
   plane fetches it with Browser Rendering, both the HTML (`/content`) and a
   screenshot (`/screenshot`).
2. The HTML is parsed into a **profile**: title, heading, email/password labels,
   submit label, logo URL, accent/background/foreground colours, form action, and
   a step count. One or two steps, never an OTP field.
3. The result is a `profiles` row with `status = 'generated'`, a blurred
   screenshot used as a fixed backdrop, and a logo asset. Both byte blobs live in
   `profile_assets` (Neon `bytea`, immutable `/a/<id>` route) until R2 is wired.
4. Nobody renders an unreviewed clone implicitly forever: the preview points at
   the newest clone, and the tenant can accept or reject each one. Rejection falls
   back to the last accepted clone, then to cPanel.
5. Resolution order is fixed and encoded in one definer, `preview_render`:
   pinned brand → usable profile → cPanel. The brand-map slot sits between the
   first two and needs no route change when it lands. The order is the contract,
   not an if-chain in the route.
6. Clones expire after 30 days and are never silently regenerated inside that
   window.

## Consequences

- A tenant can go from URL to a convincing page in one step.
- Parsing is heuristic: a JS-rendered form or a hostile CSP can yield a thin
  profile. The review step is the safety valve, and the failure is visible.
- Bytes in Neon cost more than R2 but need no new credentials; a later migration
  swaps `profile_assets` for object keys without touching `profiles`.
- Only `https` targets and pages with a password field are accepted.

## Rejected

- An iframe of the real page: cross-origin form posts and CSP make capture and
  redirects unreliable, and the product already banned iframes (ADR 0013).
- Serving the fetched HTML verbatim: external CSS/JS is exactly what the skeleton
  exists to avoid.
- Auto-binding every clone without review: a bad parse would silently take over a
  live link.

## Reversal cost

Low for the pipeline, medium for the render shape: profiles carry a `template_key`
so a second renderer can be added without a data migration.
