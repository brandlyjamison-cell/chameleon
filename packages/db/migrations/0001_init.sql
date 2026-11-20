-- 0001_init.sql — the whole schema. Forward-only; expand/contract from here.
-- gen_random_uuid() is core since PG13; pgcrypto is not needed.

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_demo boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_verified_at timestamptz,
  name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index users_email_lower on users (lower(email));

create table memberships (
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create unique index memberships_one_owner on memberships (org_id) where role = 'owner';

create table sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  token_hash bytea not null unique,
  actor_id uuid references users (id),
  expires_at timestamptz not null,
  ip_hash bytea,
  ua text,
  created_at timestamptz not null default now()
);

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  service_id uuid,
  created_by uuid not null references users (id),
  token_hash bytea not null unique,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Catalogue ---------------------------------------------------------------

create table service_types (
  id smallint primary key,
  code text not null unique check (code in ('chameleon', 'aitm')),
  engine_module text not null,
  default_kind text not null check (default_kind in ('credential', 'session', 'mixed')),
  status text not null default 'active' check (status in ('active', 'draft', 'retired'))
);

create table tiers (
  id smallint primary key,
  service_type_id smallint not null references service_types (id),
  code text not null check (code in ('starter', 'pro')),
  price_cents integer not null check (price_cents > 0),
  link_cap integer not null check (link_cap > 0),
  domain_cap integer not null check (domain_cap > 0),
  capture_cap integer not null check (capture_cap > 0),
  webhook_enabled boolean not null default false,
  api_enabled boolean not null default false,
  unique (service_type_id, code)
);

create table brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  email_domains text[] not null default '{}',
  template_key text not null,
  logo_ref text,
  favicon_ref text,
  backdrop_ref text,
  palette jsonb not null default '{}',
  labels jsonb not null default '{}',
  step_count smallint not null default 1 check (step_count in (1, 2)),
  login_url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Services ----------------------------------------------------------------

create table services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  service_type_id smallint not null references service_types (id),
  tier_id smallint not null references tiers (id),
  status text not null default 'provisioning'
    check (status in ('provisioning', 'active', 'past_due', 'expired', 'archived', 'suspended')),
  expires_at timestamptz,
  link_slots_used integer not null default 0 check (link_slots_used >= 0),
  domain_slots_used integer not null default 0 check (domain_slots_used >= 0),
  gate_mode text not null default 'always' check (gate_mode in ('always', 'remember_30d', 'off')),
  passcode_hash bytea,
  passcode_salt bytea,
  dek_wrapped bytea,
  dek_wrap_kind text check (dek_wrap_kind in ('passcode', 'kek')),
  dek_kid text,
  token_secret bytea,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (id, org_id)
);

create table service_events (
  id bigserial primary key,
  org_id uuid not null,
  service_id uuid not null references services (id) on delete cascade,
  kind text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Domains -----------------------------------------------------------------

create table domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  service_id uuid not null references services (id) on delete cascade,
  hostname text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'active', 'paused', 'failed')),
  verify_token text not null,
  verified_at timestamptz,
  verified_by text check (verified_by in ('txt', 'admin')),
  cf_hostname_id text,
  last_checked_at timestamptz,
  deleted_at timestamptz,
  tombstoned_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (service_id, org_id) references services (id, org_id)
);
create unique index domains_hostname_live on domains (lower(hostname)) where deleted_at is null;
create index domains_live_tombstones on domains (lower(hostname)) where deleted_at is not null;

create table domain_checks (
  id bigserial primary key,
  org_id uuid not null,
  domain_id uuid not null references domains (id) on delete cascade,
  result text not null check (result in ('match', 'mismatch', 'error')),
  detail text,
  created_at timestamptz not null default now()
);

-- Links, profiles ---------------------------------------------------------

create table links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  service_id uuid not null references services (id) on delete cascade,
  domain_id uuid not null references domains (id) on delete restrict,
  slug text not null check (slug ~ '^[0-9A-HJ-NP-TV-Z]{5}$'),
  pinned_brand_id uuid references brands (id),
  status text not null default 'active' check (status in ('active', 'paused')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (service_id, org_id) references services (id, org_id)
);
create unique index links_slug_live on links (service_id, slug) where deleted_at is null;
create index links_domain on links (domain_id);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  service_id uuid references services (id) on delete cascade,
  email_domain text not null,
  profile jsonb not null default '{}',
  assets_prefix text,
  status text not null default 'generated'
    check (status in ('generated', 'accepted', 'rejected')),
  step_count smallint not null default 1 check (step_count in (1, 2)),
  fetched_from text,
  expires_at timestamptz not null default now() + interval '30 days',
  fail_reason text,
  created_at timestamptz not null default now()
);
create index profiles_domain on profiles (email_domain);

-- Captures ----------------------------------------------------------------

create table captures (
  id uuid primary key,
  org_id uuid not null,
  service_id uuid not null references services (id) on delete cascade,
  link_id uuid not null references links (id) on delete cascade,
  kind text not null check (kind in ('credential', 'session', 'mixed')),
  fields jsonb not null default '{}'::jsonb,
  payload_ref text,
  email_hash bytea,
  dedupe_bucket text,
  source text not null check (source in ('human', 'decoy', 'scanner')),
  status text not null default 'new' check (status in ('new', 'valid', 'invalid')),
  received_at timestamptz not null,
  client_ip_hash bytea,
  ua_class text,
  foreign key (service_id, org_id) references services (id, org_id)
);
create unique index captures_dedupe on captures (service_id, email_hash, dedupe_bucket)
  where email_hash is not null;
create index captures_service_recent on captures (service_id, received_at desc, id desc);
create index captures_org on captures (org_id);

create table captures_suppressed (
  service_id uuid not null references services (id) on delete cascade,
  bucket text not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (service_id, bucket)
);

create table prune_queue (
  id bigserial primary key,
  service_id uuid not null,
  capture_id uuid not null,
  payload_ref text,
  created_at timestamptz not null default now()
);

create table vault_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  service_id uuid not null references services (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  token_hash bytea not null unique,
  ua text,
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null
);

create table vault_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  service_id uuid not null references services (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  device_id uuid references vault_devices (id) on delete set null,
  ip_hash bytea,
  ua text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Money -------------------------------------------------------------------

create table payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  tier_id smallint not null references tiers (id),
  provider_payment_id text unique,
  price_cents integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirming', 'confirmed', 'failed', 'expired', 'refunded')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  extended_at timestamptz,
  raw jsonb,
  created_at timestamptz not null default now()
);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  body_hash bytea not null,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  payment_id uuid not null references payments (id),
  amount_cents integer not null,
  issued_at timestamptz not null default now(),
  pdf_ref text
);

-- Ops ---------------------------------------------------------------------

create table audit_log (
  id bigserial primary key,
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'system', 'tenant')),
  org_id uuid,
  target_table text not null,
  target_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  ip_hash bytea,
  ua text,
  created_at timestamptz not null default now()
);

create table outbox (
  id bigserial primary key,
  topic text not null,
  payload jsonb not null,
  attempts integer not null default 0,
  next_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table idempotency (
  key text primary key,
  scope text not null,
  response jsonb,
  created_at timestamptz not null default now()
);

-- Seed: the registry is data, not code (INV-ARCH-02).
insert into service_types (id, code, engine_module, default_kind, status) values
  (1, 'chameleon', '@chameleon/engine/chameleon', 'credential', 'active'),
  (2, 'aitm', '@chameleon/engine/aitm', 'session', 'draft');

insert into tiers (id, service_type_id, code, price_cents, link_cap, domain_cap, capture_cap, webhook_enabled, api_enabled) values
  (1, 1, 'starter', 1900, 5, 2, 50000, false, false),
  (2, 1, 'pro', 4900, 20, 5, 250000, true, true),
  (3, 2, 'starter', 1900, 5, 2, 50000, false, false),
  (4, 2, 'pro', 4900, 20, 5, 250000, true, true);
