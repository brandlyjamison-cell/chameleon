# Services

A service is a purchased instance of a service_type. Everything the tenant can
configure hangs off a service: tier, entitlement, expiry, domain slots, link
slots, gate mode, passcode, DEK, captures, vault. There is no org-level tier.

The engine is a property of the service_type, not of the service row. The
registry resolves `service_type → engine module`; the service row stores only
`service_type_id`, so nothing per-service can drift.

## The two types

|             | `chameleon`                           | `aitm`                                              |
| ----------- | ------------------------------------- | --------------------------------------------------- |
| Status      | ships first                           | ships later, interface only                         |
| Render      | static skeleton, server-rendered HTML | reverse proxy of the real IdP, rewritten HTML       |
| Captures    | `credential`                          | `session`, or `mixed`                               |
| OTP         | never rendered                        | relayed to the real IdP; the victim can complete it |
| Redirect    | 302 to the real login after submit    | 302 to the real app with the session                |
| Cost driver | render + one row                      | subrequests + R2 payload                            |

## One contract

Both types use the same link URL, the same `?email=` parameter, the same form
field names (`email`, then `password` on the password step), the same POST
endpoint shape (`POST /c/:token`), the same response (302), and the same
`captures` table. Only `kind` and the payload contents differ.

This is enforced by INV-ARCH-03. The contract tests in
`packages/contracts/test/` run against either fixture unmodified. Nothing in the
link table, the vault response, the CSV columns, or the webhook body branches on
service_type.

## Capture shape is per service_type, decided by the engine

The route does not decide `kind`. The engine does, from the registry row:

```ts
// packages/engine/types.ts — NORMATIVE
export interface Engine {
  readonly code: ServiceTypeCode; // 'chameleon' | 'aitm'
  readonly captureKinds: readonly CaptureKind[]; // ['credential'] | ['session','mixed']
  readonly defaultKind: CaptureKind;
  resolve(input: ResolveInput): Promise<ResolvedTemplate>;
  render(t: ResolvedTemplate): Promise<string>;
  parseCapture(form: FormData, prior: PriorCapture | null): EngineCapture;
  onConsumed?(row: CaptureRow, env: Env): Promise<void>;
}
```

`chameleon.parseCapture()` returns `{ kind: 'credential', fields: { username,
password } }`. It never returns `session`, so a chameleon vault can never contain
a row the service cannot produce. If the tenant starts an `aitm` service later,
its engine returns `session` (or `mixed` when a password step preceded the IdP)
and the same vault, CSV, and webhook code carry it untouched.

Why not lift `kind` into the route and infer it: a chameleon link posted a
`kind=session` by an optimistic client would store an empty session row, and
tenants would conclude chameleon does 2FA. The type owns it; the client is not
consulted.

## Adding a service type

1. Insert a `service_types` row: `code`, `engine_module`, `default_kind`,
   `status`. No route change.
2. Implement the engine in `packages/engine/<code>/`.
3. Seed tiers for it.
4. Add the contract fixture.
5. Enable in the dashboard catalogue.

A service type must not: add columns to `captures`, change the slug or URL
format, or introduce a second POST endpoint. If it needs any of those, that is
an ADR against INV-ARCH-03.

## Service lifecycle

`provisioning → active → past_due → expired → archived`

| Status       | Links serve | Writes (links/domains) | Vault read             |
| ------------ | ----------- | ---------------------- | ---------------------- |
| provisioning | no          | yes                    | no                     |
| active       | yes         | yes                    | yes                    |
| past_due     | yes (grace) | yes                    | yes                    |
| expired      | no (404)    | no                     | yes (read/export only) |
| archived     | no          | no                     | no                     |

Activation is the moment a service gets its passcode, its DEK, and its
entitlement flag. Without those three it cannot serve. Provisioning to active is
one server transaction plus a passcode set; a service that dies in between is
resumable, not half-live.

`archived` is reached 30 days after `expired` if unpaid; captures remain until
the tenant deletes them or the account is closed.

## Expiry detail

`services.expires_at` is a `timestamptz`, set from the paid period end and
extended only by a confirmed payment. Expiry is checked at the edge on every
request via the KV flag, purged by webhook, and swept every five minutes.
Warnings fire at T-7, T-3, T-1, T-0 to the owner's email and dashboard. The
dashboard shows a persistent banner and red service card from T-7.

Tier caps and expiry are independent: a service can be under its link cap and
still expire.

## Entitlement

Entitlement is derived, never stored as a permission:

```
entitled = status == 'active'
        && expires_at > now()
        && links_used < tier.link_cap   (for minting)
        && domains_used < tier.domain_cap (for adding)
        && captures_used < tier.capture_cap (for accepting, soft)
```

The edge resolves only the serve/deny part. The control plane evaluates the
write parts inside the transaction (INV-DATA-05).

## OPEN items

- `OPEN-SVC-01`: does a service keep its DEK and passcode across a downgrade, or
  is a Pro→Starter downgrade blocked while over the Starter cap? (See
  `plan/open-questions.md`.)
- `OPEN-SVC-02`: whether an `aitm` service may share a domain row with a
  chameleon service or owns separate domains per link host rules.

Last reviewed: 2026-11-20
