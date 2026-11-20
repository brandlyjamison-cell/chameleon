# Glossary

Fixed vocabulary. Code identifiers, DB columns, API fields, UI strings, and
commit messages use these words. Synonyms in the right column are banned.

| Term | Meaning | Banned |
| --- | --- | --- |
| tenant / org | The paying account. One `orgs` row. Owns users, services, billing, audit. | customer, account, company, workspace |
| service | A purchased instance of a `service_type`, with its own tier, entitlement, domains, links, captures, vault, gate mode. One `services` row. | instance, product, subscription, plan |
| service_type | `chameleon` or `aitm`. Registry row plus engine implementation. | engine (as a noun for the type), mode, product |
| tier | `starter` or `pro`, attached to a service. Caps that service. | plan, package, level |
| entitlement | The effective, derived permission of a service to serve traffic and accept writes. Tuple of status, expiry, tier caps, counters. | quota, allowance |
| link | A slug on a verified domain belonging to a service. One `links` row. | slug (as the object), campaign, tracking link |
| slug | The random short path segment on a link, e.g. `a7k2`. | code, hash, key |
| capture | One submitted `username`/`password` pair, or later one session payload. One `captures` row. | lead, result, credential row, submission |
| vault | The per-service capture list. UI tab and the API view over `captures`. | inbox, results, logs |
| gate | The passcode requirement on a vault. `always` \| `remember_30d` \| `off`. | lock, pin, password mode |
| passcode | The tenant-chosen secret that unwraps a service DEK. | vault password, PIN |
| brand map | Table mapping email domain to template. | brand list, mapping table |
| brand | A row in the brand map: name, email domains, template, assets. | target, vendor, company |
| profile | A generated per-domain template descriptor for a domain the brand map does not cover. | custom template, snapshot, scrape |
| skeleton | The single parameterised template all chameleon renders use. | shell, frame, layout |
| template | A brand's (or profile's) resolved parameter set for the skeleton. | theme, skin |
| pin | A link-level brand override. | force, override |
| resolution | Mapping request host + slug (+ email domain) to link, service, and template. | routing |
| data plane | Workers/Hono deployable serving links, renders, captures, 404s. | frontend, public app, worker (ambiguous) |
| control plane | Next.js deployable serving auth, dashboard, admin, API, billing. | backend, admin panel |
| control host | The dashboard hostname, e.g. `app.<platform>`. | dashboard domain |
| decoy | A scanner-facing render on a live link, captured and tagged `scanner`/`decoy`. | trap, honeypot |
| source | Capture provenance: `human` \| `decoy` \| `scanner`. | origin, type |
| kind | Capture mode: `credential` \| `session` \| `mixed`. | capture type |
| engine | The `service_type` implementation of render and capture. | driver, adapter, plugin |
| DEK | Per-service data encryption key. Wrapped, never stored raw. | data key, service key |
| KEK | Platform key-encryption key. Wraps DEKs when gate is `off`. | master key, root key |
| entitlement flag | KV value deciding allow/deny for a service at the edge. | gate flag, status flag |
| sweeper | Five-minute job that re-derives expiry and purges flags. | cron, reconciler |
| tombstone | A deleted hostname kept as a row so it cannot be re-claimed. | graveyard, cooldown |
| expiry | `services.expires_at`. Instant hard cutoff, unbranded 404. | lapse, end date |
| demo | The public fixed link on a throwaway tenant. | sandbox, playground, trial |
| admin | Platform staff account. Cross-tenant, cannot read captures. | superadmin, staff, operator (careful: operator is a tenant role) |
| audit | Append-only admin action log. | journal, trail |

## Disambiguation rules

- "Chameleon" capitalised = the platform. `chameleon` lowercase in backticks =
  the service_type.
- "Subscription" appears only when talking to NowPayments; in product language
  it is a service with an expiry.
- "Capture size" always means row count against the tier cap, never bytes.
- "Live" means served by the data plane. A row can exist and not be live.
- A link is not a URL until it has a domain. The URL is the rendering of a link.

Last reviewed: 2026-11-20
