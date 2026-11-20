# Edge

The edge is the only thing a victim or a scanner ever touches. It runs on
Workers, has no session, sets no cookies on render, and must stay correct with
Postgres unavailable.

## Host routing

NORMATIVE, in order, before any other code:

```
if host == CONTROL_HOST                      -> 404 (data plane does not proxy the dashboard)
if host is in RESERVED (platform hosts)      -> reserved map: go.<p> ok, app.<p> 404, assets.<p> asset route
lookup domain by host in KV                  -> miss = 404
if domain.status != 'active'                 -> 404
```

The control deployable does the mirror check and 404s anything that is not the
control host, so neither plane ever falls through (INV-EDGE-08).

## KV layout

All edge state is derived and disposable. A full KV wipe degrades to a rebuild,
not data loss.

| Key                   | Value                                                 | TTL    | Written by                 |
| --------------------- | ----------------------------------------------------- | ------ | -------------------------- |
| `d:<hostname>`        | `{domain_id, service_id, org_id, status, verify_exp}` | 5 min  | domain verify job, sweeper |
| `l:<hostname>:<slug>` | `{link_id, service_id, org_id, pin, token, status}`   | 1 h    | mint, edit, sweeper        |
| `ent:<service_id>`    | `'active' \| 'expired' \| 'past_due'`                 | 10 min | billing webhook, sweeper   |
| `prof:<sha1(domain)>` | `{profile, assets_prefix, step_count}`                | 30 d   | profile generator          |
| `brands:v<n>`         | full brand map, one blob                              | 1 h    | seed/publish               |
| `neg:<hostname>`      | `'1'` for unknown hosts                               | 60 s   | edge on miss               |

`ent` is checked with `!= 'active'` → 404, so a missing key denies (INV-EDGE-03).

Writes are done only from `apps/pipeline` and the control plane; the edge reads.
Single-key writes are cheap, but a bulk edit bumps and rewrites each affected
`l:` key; the sweeper repairs drift within five minutes.

## Entitlement flags

`ent:<service_id>` is the enforcement point:

- Payment confirmed → `active`, expiry extended, `l:` keys untouched.
- Expiry (webhook or sweeper) → `expired` → every request 404s.
- `past_due` → still serves (grace), card shows a warning, writes blocked.
- Flag write is followed by a `waitUntil` purge of `ent` so the next request
  rereads; KV propagation is typically < 60 s global, which is why the TTL is 10
  min and the sweeper exists.

The sweeper derives truth from Postgres: `select id from services where
expires_at <= now() and ent_flag != 'expired'` and the inverse. It also re-derives
`d:` statuses. It runs every 5 minutes, alarms if it misses two in a row
(INV-EDGE-06).

## Unbranded 404

Exact body (INV-EDGE-04), one constant, no branch:

```html
<!doctype html><title>Not Found</title>404 This link has expired.
```

Headers, complete allow-list:

```
content-type: text/html; charset=utf-8
content-length: 65
cache-control: public, max-age=30
x-robots-tag: noindex
```

No `Set-Cookie`, no `Referer` echo, no `Server` override, no CSP, no logo, no
footer, no analytics beacon, no platform name. `server: cloudflare` remains and is
accepted.

Status is 404. A scanner that gets 200 on a dead link is a fingerprint.

`OPEN-EDGE-01`: should the same body serve a 429 (with `Retry-After`) or a
distinct one? Lean: 429 status, same body, so the page never looks branded.

## Domain lifecycle

`pending → verifying → active → paused|failed`, plus `deleted` (tombstone).

1. Tenant adds the hostname in the dashboard. Server allocates
   `cameleon-verify=<32B>` and returns the TXT name plus the CNAME target.
2. Verify job checks TXT every 5 min for 72 h. Match → `verified_at`, then create
   the Cloudflare for SaaS custom hostname (TLS auto).
3. `active` only after both TXT and CF hostname are ready (INV-SEC-06).
4. Daily re-check; a missing TXT flips to `failed`, and links on it 404.
5. Delete → `deleted_at` + `tombstoned_at`, CF hostname removed, tombstone held
   30 days (INV-SEC-07).

Cloudflare for SaaS is the TLS and routing mechanism: the tenant CNAMEs to our
fallback origin, so the Worker sees the tenant host in `Host` and we hold the
hostname→service mapping. `OPEN-EDGE-02`: apex domains (no CNAME possible) are
supported via CF `A` flattening only on CF-hosted zones — confirm before promising
apex in marketing.

## Rate limits

Durable Object `ServiceLimiter`, one instance per service, `idFromName(service_id)`:

- 600 req/min/service, burst 60.
- 120 req/min/IP, burst 20. IP from `CF-Connecting-IP`, never a header the client
  controls.
- 20/min/IP on capture POST.
- Demo: 30/h/IP, 60/h//24 (separate DO).

Fixed window of 60s in DO storage, no sliding log, because the point is load
shedding not fairness. Over the limit: 429 + `retry-after`, same 404 body.

`OPEN-EDGE-03`: does a shared platform host (`go.<p>`) need a _per-tenant_ sub
limit on top of per-service, since one noisy tenant on the shared host is
invisible to per-service counters? Lean: yes, `svc:<id>` bucket as today, plus a
host bucket.

## Caching

- Render HTML: `cache-control: private, max-age=0, must-revalidate`. Personalised
  by `email`, and pinning can change under a slug, so public cache is unsafe
  until `OPEN-EDGE-04` (cache keyed on host+slug+email-hash).
- Assets (`/a/<brand>/<file>`): `public, max-age=31536000, immutable`, served from
  R2 through the Worker with an ETag, no cookie.
- The 404: 30 s public.

## What the edge may not do

- No DB write. Only reads, and only via Hyperdrive with the `edge` role.
- No session checks. No dashboard routes.
- No brand-map mutation.
- No key unwrapping for vault reads — that route is proxied to the Worker's
  vault handler, which is on a control-host path but still runs here.

## Signals the edge emits

One structured access log line per request (Axiom): request id, host hash,
service id, link id, status, ms, country, UA class, `source` guess, `ent` flag
read. No email, no IP (only /24 hash). Sampled 100% for 4xx/5xx, 10% for 200s.

Last reviewed: 2026-11-20
