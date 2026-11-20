# ADR 0015 — Browser Rendering for profile capture

Status: accepted (2026-11-20)

## Context

Profiles need a screenshot plus computed palette from pages that are frequently
JS-heavy. A plain `fetch` gets markup but not the rendered colours or the paint.

## Decision

Cloudflare Browser Rendering from the profile consumer: one session per domain,
5s budget, 1MB cap, screenshot 1280×800, then WebP through `sharp-wasm`. Crawl order
is fixed in `spec/templates.md`. Fall back to `fetch`-only extraction if the binding
fails, and to cPanel if both fail.

## Consequences

- Rendered screenshots match what a victim sees, including CSS-in-JS brands.
- Browser sessions are the slowest, most expensive part of the pipeline; it runs
  off the request path and is capped per day.
- Some brands block headless; the fallback is text-only and flagged.
- Screenshots are pinned in R2, so a block later does not break a live profile.

## Rejected

- **Third-party screenshot API.** Another credential and per-shot cost, and no
  computed palette.
- **`fetch` + regex only.** Misses most modern login pages.

## Reversal cost

Low. The profile consumer is isolated; swapping the renderer touches one module.

Last reviewed: 2026-11-20
