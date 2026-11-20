# Data model

Postgres. Every tenant table carries `org_id uuid not null` and `FORCE ROW LEVEL
SECURITY`. Child rows also carry `service_id` and a composite FK, so a
mis-scoped read cannot join across services.

Migrations are numbered, forward-only, and reviewed by a second pass in CI
(`drizzle-kit generate` + `sqfluff`-style lint: no column drop in the same release
as its removal, new columns nullable or defaulted, indexes concurrent).

## Tables

Identity and tenancy:

```
orgs(id, name, slug, is_demo, status, created_at)
users(id, email, email_verified_at, name, passkeys, created_at)          -- Better Auth
memberships(org_id, user_id, role, created_at)                            -- owner | member
sessions(id, user_id, token_hash, expires_at, ip_hash, ua, actor_id)      -- Better Auth
api_tokens(id, org_id, service_id, created_by, token_hash, scopes[], last_used_at, expires_at)
```

Service and catalogue:

```
service_types(id, code unique, engine_module, default_kind, status)
tiers(id, service_type_id, code, price_cents, link_cap, domain_cap, capture_cap,
      webhook_enabled, api_enabled)
services(id, org_id, service_type_id, tier_id, status, expires_at,
         link_slots_used, domain_slots_used,
         gate_mode, passcode_hash, passcode_salt, dek_wrapped, dek_wrap_kind,
         token_secret, created_at, activated_at)
service_events(id, service_id, org_id, kind, data, created_at)            -- activity
```

Domains:

```
domains(id, org_id, service_id, hostname, status, verify_token, verified_at,
        verified_by, cf_hostname_id, last_checked_at, deleted_at, tombstoned_at)
domain_checks(id, domain_id, org_id, result, detail, created_at)
```

Links and templates:

```
links(id, org_id, service_id, domain_id, slug, pinned_brand_id, status,
      token_iat, deleted_at, created_at)
brands(id, slug, name, email_domains[], template_key, logo_ref, favicon_ref,
       backdrop_ref, palette jsonb, labels jsonb, step_count, enabled)
profiles(id, org_id, service_id, email_domain, profile jsonb, assets_prefix,
         status, step_count, fetched_from, expires_at, fail_reason, created_at)
```

Captures:

```
captures(id, org_id, service_id, link_id, kind, fields jsonb, payload_ref,
         email_hash bytea, dedupe_bucket text, source, status,
         received_at, client_ip_hash, ua_class)
captures_suppressed(service_id, bucket, count, updated_at)  -- counters only
prune_queue(id, service_id, capture_id, payload_ref, created_at)            -- R2 cleanup
vault_devices(id, service_id, org_id, user_id, token_hash, ua, last_seen, expires_at)
vault_sessions(id, service_id, org_id, user_id, expires_at, ip_hash, ua, device_id)
```

Money:

```
payments(id, org_id, service_id, tier_id, provider_payment_id unique,
         price_cents, status, period_start, period_end, raw jsonb, created_at)
webhook_events(id, provider, provider_event_id unique, received_at, body_hash)
invoices(id, org_id, payment_id, amount_cents, issued_at, pdf_ref)
```

Ops:

```
audit_log(id, actor_id, actor_kind, org_id, target_table, target_id,
          action, before jsonb, after jsonb, ip_hash, ua, created_at)
outbox(id, topic, payload, attempts, next_at, created_at)                   -- webhooks
idempotency(id, key, scope, response, created_at)
```

## Key constraints

| Constraint | Table |
| --- | --- |
| `unique (service_id, slug) where deleted_at is null` | links |
| `unique (lower(hostname)) where deleted_at is null` | domains |
| `unique (org_id, lower(email))` | users via memberships* |
| `unique (provider_payment_id)` | payments |
| `unique (provider, provider_event_id)` | webhook_events |
| `unique (service_id, email_hash, dedupe_bucket)` | captures |
| `fk (service_id, org_id) references services(id, org_id)` | every service child |
| `check kind in ('credential','session','mixed')` | captures |
| `check source in ('human','decoy','scanner')` | captures |
| `check status in ('new','valid','invalid')` | captures |
| `check gate_mode in ('always','remember_30d','off')` | services |

\* users are global; membership is `(org_id, user_id)`. One user may hold
memberships in several orgs, one org each for now.

## RLS

Every table with `org_id`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy

```sql
using (org_id = current_setting('app.org_id', true)::uuid)
with check (org_id = current_setting('app.org_id', true)::uuid)
```

`app_rw` is not the owner and cannot bypass. Migrations run as `app_migrator`
(owner, `BYPASSRLS` off but owner on its own objects). Admin routes run as
`app_admin` with `BYPASSRLS` — that is what makes admin cross-tenant, and it is
also why admin is refused capture plaintext (it has no keys, not no rows).

The Worker/pipeline connection sets `app.org_id` per transaction from the queue
message's `org_id` or from the resolved service. It never runs a multi-org query
without an explicit `set local`.

`packages/db/scripts/assert-rls.ts` walks `information_schema` and fails if any
table with `org_id` lacks a forced policy. Runs in CI on every migration.

## Counters

```sql
create function bump_slots() returns trigger ... as $$
  begin
    perform 1 from services where id = coalesce(new.service_id, old.service_id) for update;
    ... increment/decrement link_slots_used or domain_slots_used ...
  end $$;
create trigger links_slots after insert or update of deleted_at or delete on links ...
```

`app_rw` has `UPDATE` on `services` except on the two counter columns
(`REVOKE UPDATE (link_slots_used, domain_slots_used) ON services FROM app_rw`), so
an app write to them errors instead of drifting.

## Dedupe and pruning

- `email_hash = hmac_sha256(service_dedupe_salt, lower(trim(email)))` — per
  service, so the same address hashes differently across tenants.
- `dedupe_bucket = to_char(received_at, 'YYYY-MM-DD"T"HH24:') || (floor(extract(minute from received_at)/15)*15)::int`
  — gives 15-minute buckets; the unique index makes insert-time dedupe atomic.
  `ON CONFLICT DO NOTHING` + `RETURNING` tells the consumer to bump
  `captures_suppressed`.
- Pruning runs after insert in the same transaction: `delete from captures where
  id in (select id from captures where service_id = $1 order by received_at
  asc, id asc offset $cap)`, batched to 500, rows copied into `prune_queue`.

## Payloads

`fields jsonb` holds `{v:1, alg:'A256GCM', iv:b64, ct:b64}`. Credential payloads
are small and stay inline. `payload_ref` is used when the plaintext exceeds 2KB
or `kind != 'credential'`; session payloads are always `payload_ref` (INV-CAP-06)
with a 50KB reject above.

## Retention

| Data | Kept |
| --- | --- |
| captures | until pruned by cap or deleted by owner |
| captures of expired service | kept, read-only, 30 days after archive, then org-level retention |
| profiles | 30 days, refreshed on hit |
| links | soft-deleted 30 days, then hard |
| domains | tombstone 30 days after delete, then row hardened to hostname-only tombstone (1 year) |
| payments/invoices | 7 years |
| audit_log | 2 years |
| webhook_events | 90 days |
| access logs (Axiom) | 14 days |

## Deletion cascade

`orgs` delete is a job: revoke domains in Cloudflare for SaaS, purge KV prefixes,
delete R2 prefixes, then delete rows in FK order. Captures are hard-deleted
(no export obligation beyond what the tenant already ran). Domain tombstones
survive the org so a dangling CNAME stays safe.

Last reviewed: 2026-11-20
