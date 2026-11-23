# 0033 — A free preview link lives on a platform path

Status: accepted (2026-11-22)

## Context

A new tenant wants to see the page before buying DNS. Waiting for a custom
hostname means waiting for the tenant's own zone, and under a Free Cloudflare
zone that wait is indefinite (OPEN-OPS-04). The CTO also asked for one free link
on a `workers.dev`-style host per service, without a custom domain.

One Worker on `*.workers.dev` cannot serve per-service _subdomains_ without extra
`workers.dev` tricks, and the edge already routes by path for `/c/:token`.

## Decision

1. Every service gets exactly one preview link at
   `/p/<services.preview_key>/<slug>` on the platform host. `preview_key` is
   12 random hex characters, stable per service, and never a secret.
2. A preview link is a `links` row with `is_preview = true` and a null
   `hostname_id`. A partial unique index enforces one live preview per service.
3. Preview links do not touch `link_slots_used`. The mint happens inside service
   creation, and `ensurePreviewLink` is idempotent.
4. The anonymous route reads through definer functions (`preview_link`,
   `preview_render`) because the visitor has no session and forced RLS would hide
   the row. The function also applies the service-lifecycle gate: only
   `provisioning`, `active` and `past_due` serve.
5. Every deny returns the constant 65-byte 404; the preview never leaks whether a
   key exists.
6. Captures from a preview are stored synchronously through the same
   `captures.consume` path as real links, so the vault and dedupe behave alike.

## Consequences

- A tenant can prove the whole product before paying or touching DNS.
- The preview survives hostname deletion, because it depends on neither.
- One more public path to rate-limit and one more anonymous reader to keep
  definer-only.
- When the edge ships, `/p/*` must proxy to control until the edge can render.

## Rejected

- A per-service `workers.dev` subdomain: not possible without a custom domain per
  service or an account-level wildcard.
- A signed preview token in the URL: rotation would invalidate links already
  shared, and the key is not a secret anyway.
- Counting the preview against the link cap: the free link is a product promise.

## Reversal cost

Low. Dropping `is_preview` and the route leaves the rows as ordinary links that
then need a hostname.
