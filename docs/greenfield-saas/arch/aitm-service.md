# AitM service (later)

Not built now. This doc exists so today's decisions do not have to be reversed
later. If a change in this doc would require editing `links`, `captures`, the
vault response, or the POST contract, the change is wrong.

`aitm` = adversary-in-the-middle. The service reverse-proxies the real identity
provider so the victim authenticates **on the real IdP**, completes its real OTP,
and we capture the resulting session cookie instead of a password.

## What is already reserved for it

| Today's decision                                       | Why it is aitm-ready                      |
| ------------------------------------------------------ | ----------------------------------------- |
| `captures.kind ∈ {credential, session, mixed}`         | session rows exist before the engine does |
| `captures.fields jsonb` envelope, no `password` column | session payloads are not passwords        |
| `payload_ref` + R2, 5-50KB rule                        | the session blob has a home               |
| `source`, `status` on captures                         | same triage applies to sessions           |
| `?email=` + `POST /c/:token` + 302                     | identical URL and response shape          |
| engine registry, `kind` from the engine                | chameleon is hard-coded nowhere           |
| service-scoped DEK, gate, vault                        | per-service key and gate already exist    |
| `service_types.engine_module`                          | adding the type is a row plus a module    |
| unbranded 404, KV resolution, slot counters            | inherited unchanged                       |

`mixed` exists for the case where an IdP asks for the password and _then_ an OTP:
we may capture a password at step N and a session at step N+2. One capture row can
be `mixed` with a credential part inline and the session in R2. It is reserved
now and unused by chameleon, which never writes `session` or `mixed`
(INV-CAP-03).

## What aitm does that chameleon cannot

- Relays a live page, so 2FA works. Victoria receives a real code from her
  provider and types it into our proxy.
- Captures the session cookie/JWT, so the tenant can open the real app as her,
  not just relogin later.
- Is stateful per visit: a visit needs a proxy session, upstream cookies, and a
  rewrite pass. Chameleon renders one static string and forgets.

That statefulness is the whole reason it cannot be bolted onto the render path
with an `if`.

## Engine interface fit

The interface in `spec/services.md` covers it:

- `resolve()` — for aitm, decides upstream host from the brand and mints a proxy
  session id.
- `render()` — returns rewritten HTML with `<base>` and a URL rewriter (chameleon
  returns a template string).
- `parseCapture()` — returns `session` when the upstream `Set-Cookie` proves auth,
  `mixed` when a password was seen earlier in the visit.
- `onConsumed()` — writes the session blob to R2 at the size the consumer expects
  and sets `payload_ref`.

The route calls `engine.parseCapture` and `sealCapture` the same way for both. The
only route-level branch permitted is token payload shape, which the engine owns.

## What the pipeline may need later (and must not need now)

- A `proxy_sessions` table (visit id, upstream host, cookie jar ref, expiry).
  New table, no column on `captures`, no change to the link contract.
- A Durable Object per proxy visit for the cookie jar. New DO namespace, not a
  change to `ServiceLimiter`.
- Streaming responses instead of a buffered string. `render()` is `Promise<string>`
  today; if streaming is faster for aitm, keep the string for chameleon and add
  `renderStream?()`, so the contract gains, not changes `OPEN-AITM-01`.
- HTML rewriting in `packages/engine/aitm/rewrite/`. Pure functions, testable,
  bundled only in the aitm path.

## Constraints on the design

- **No 2FA parsing.** The IdP does 2FA; the proxy only relays. Where a passkey
  challenge appears, degrade to password plus redirect, do not try to virtualise
  WebAuthn.
- **No OTP field on chameleon.** Restated because it is the commonest mistake:
  chameleon never shows a code box (INV-CAP-04).
- Session payload ceiling 50KB; a bigger cookie jar is truncated and the capture
  is `status='invalid'` with a note, not dropped.
- Session rows are not re-rendered by our skeleton. There is no lookalike; the
  page is the real page.
- One `aitm` service per domain set is fine; `OPEN-SVC-02` asks about sharing a
  domain row with a chameleon service.

## Domain and TLS note

AitM needs the same verified hostnames, so the domain feature and its tombstoning
carry over untouched. The difference is only that responses are proxied, not
composed. Cloudflare for SaaS already puts the Worker in front of the host, so no
routing change is needed.

`OPEN-AITM-02`: aitm proxies a third-party origin, so a tenant's `Origin`-bound
cookies may break. Decide the `Referer`/`Origin` rewrite policy before building,
and whether we need a per-brand "bridging" config (login-only vs full app).

## Explicitly out of scope, forever

- Virtualising WebAuthn/passkeys.
- Mobile app proxying (only the web IdP flow).
- Streaming video or non-auth pages beyond what the login flow needs.

## Stage placement

After launch, not a launch blocker. Target: the six weeks after the first 20
paying tenants, once the shared-domain burn rate is measured. No launch-stage work
may reference aitm except the reserved columns, `kind` values, and engine seam
listed above.

Last reviewed: 2026-11-20
