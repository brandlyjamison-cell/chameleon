# Product

## Positioning

Sold to cold-email and affiliate operators. They are judged by click-to-capture
rate and by how long a link survives. They already own domains, already have
lists, and already tolerate breakage. We sell them **rotation that survives
scanner burn** and **a vault that fills itself**, priced low enough to be an
operating expense.

We are not selling polish. The competitor is a free PHP script, a $9 clone, and
"just link to the real site".

## The mechanic

1. Tenant buys a service (`chameleon` today).
2. Tenant adds a domain they control and passes TXT verification.
3. Tenant mints a link: a short slug on that domain.
4. Tenant mails `https://their-domain.com/a7k2?email=victim@netflix.com`.
5. Victim clicks. The data plane resolves `netflix.com` to a template, renders
   the skeleton as Netflix with the address prefilled.
6. Victim types the password. We capture `username`/`password`, enqueue, 302 to
   `https://netflix.com/login` before they notice.
7. The pair sits in that service's vault.

A link without `?email=` still renders — the cPanel fallback — so a link is never
wasted on a recipient whose brand we cannot resolve.

## Why the domain feature exists

Shared platform domains are burned by mail scanners within days under heavy use.
Scanners fetch every URL in a message, so one blast converts a fresh domain into
a known fingerprint. Tenant-owned domains outlive this because each tenant's
rotation is separate and disposable. Domain rotation is the product; links are
its payload.

## Actors

- **Tenant owner** — buys, sets the passcode, adds domains, mints links, works
  the vault, exports.
- **Victim** — has no account. Sees only a branded page and a redirect.
- **Scanner** — automated, fetches links from mail. Gets the decoy and, by
  default, becomes a capture.
- **Admin** — platform staff. Fixes tiers, due dates, domains, users. Cannot read
  captures.
- **Demo visitor** — anonymous, one fixed link, sees one row of their own capture.

## Surfaces

| Surface                                  | Host                                  | Audience         |
| ---------------------------------------- | ------------------------------------- | ---------------- |
| Dashboard                                | control host                          | tenant           |
| Links (resolution, render, capture, 404) | tenant domains                        | victim, scanner  |
| Vault                                    | control host, within dashboard, gated | tenant           |
| Demo                                     | control host (public route)           | prospect         |
| Admin                                    | control host, `/admin`                | staff            |
| API                                      | control host, `/api/v1`               | Pro tenants      |
| Webhooks                                 | egress from platform                  | tenant endpoints |

## Scope at launch

In: chameleon service, two tiers, domain verification, link minting, brand map
with 30 brands, profile generation, skeleton with one- and two-step modes,
capture pipeline, vault with gate modes, CSV export, Pro webhook + API, expiry
enforcement, demo, admin, billing.

Out for now: `aitm` service implementation, 2FA/OTP capture, mobile apps, card
payments, team seats beyond an owner plus an optional member, tenant template
uploads, custom grading/analytics beyond counts, white-label.

## Commercial shape

$19 Starter / $49 Pro per service per month, crypto only, monthly. No free tier,
no trial. The sum of active services is the bill. The demo is the only free
surface. A tenant can run several services later, and can be Pro on one and
Starter on another; tiers never live on the org.

## Success measures

- Median link lifetime before scanner flag: > 30 days on tenant domains.
- Capture yield per 1,000 clicks: > 40 on mailed human traffic.
- Time from signup to first live link: < 20 minutes.
- Expiry to 404 propagation: < 5 minutes worst case, instant on webhook.
- Vault open to first row read: < 2 clicks after passcode.

## Failure modes we design around

- A blast goes out and every link is dead → rotation is per-domain and cheap.
- A victim bails at the password prompt → render must look right, and must not
  show an OTP field we cannot serve.
- A scanner eats the link → the decoy is the cPanel template and stores the
  scanner's own submission tagged `scanner`.
- A tenant cancels and keeps using it → expiry 404s, enforced at the edge.
- A tenant's DB row count explodes → per-service cap, oldest-first prune, never
  a write stall on the victim's path.

## Non-goals

- Not a CRM. No contact records, no sequences.
- Not a mail sender. We never touch SMTP.
- Not a page builder. Templates are ours.
- Not a general proxy. Only the login step.
- Not a data broker. Captures belong to the tenant until deleted.

Last reviewed: 2026-11-20
