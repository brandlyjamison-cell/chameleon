# ADR 0012 — The expiry 404 is unbranded and byte-exact

Status: accepted (2026-11-20)

## Context

A branded "this link expired" page with our logo tells a scanner, and the victim,
that the product exists and which vendor it is. It also adds assets to a page that
has nothing to sell. A blank 404 is indistinguishable from a host that was never
used, which is the correct story for a burned domain.

## Decision

Body is exactly `<!doctype html><title>Not Found</title>404 This link has expired.`
at status 404, with a five-header allow-list and no cookie, no analytics, no CSP,
no logo, no footer, no contact. One constant, imported everywhere (INV-EDGE-04).

`server: cloudflare` is accepted because it is unavoidable.

## Consequences

- Real 404 status: mail scanners treat it as dead and stop retrying.
- No state on the deny path, so denial is cheap under load (INV-EDGE-05).
- The dashboard must carry all the explanatory weight; the page cannot explain
  itself.
- A snapshot test guards byte drift and runs on every route change.

## Rejected

- **Branded expired page.** Tells the vendor, and adds asset latency to a page with
  no conversion.
- **Empty-body 404.** Some clients render nothing and look broken; one line of
  text is the minimum.

## Reversal cost

Low to change the bytes, medium to change tenant expectations; treat as fixed until
an ADR reverses it.

Last reviewed: 2026-11-20
