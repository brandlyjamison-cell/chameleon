-- 0025_domains_to_hostnames.sql — the org owns a domain; a service consumes a
-- hostname under it. Verification happens once per root, hostnames are rows.
--
-- Legacy rows are individual hostnames that each carried their own token. The
-- root is derived here (last two labels, three behind a known public suffix) and
-- flagged `review_needed` where the guess could be wrong. New roots are parsed
-- with a real PSL in the control plane.

-- 1. Root domains ---------------------------------------------------------

create table org_domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  root text not null,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'active', 'failed', 'routing_waiting')),
  verify_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  verified_at timestamptz,
  verified_by text check (verified_by in ('txt', 'admin')),
  routing_state text not null default 'dns_pending'
    check (routing_state in ('dns_pending', 'waiting', 'active')),
  wildcard_cf_id text,
  review_needed boolean not null default false,
  last_checked_at timestamptz,
  deleted_at timestamptz,
  tombstoned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, root)
);
create unique index org_domains_root_live on org_domains (lower(root)) where deleted_at is null;
create index org_domains_live_tombstones on org_domains (lower(root)) where deleted_at is not null;
create index org_domains_org on org_domains (org_id, created_at desc);

alter table org_domains enable row level security;
alter table org_domains force row level security;
create policy tenant_isolation on org_domains
  using (org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id = current_setting('app.org_id', true)::uuid);

grant select, insert, update, delete on org_domains to app_rw, app_admin;

-- The legacy heuristic. Only used for backfill; the app parses with a PSL.
create function derive_root(p_host text) returns text
language plpgsql immutable as $$
declare labels text[]; second text;
begin
  labels := string_to_array(lower(p_host), '.');
  if coalesce(array_length(labels, 1), 0) <= 2 then return lower(p_host); end if;
  second := labels[array_length(labels, 1) - 1] || '.' || labels[array_length(labels, 1)];
  if second in (
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
    'com.au', 'net.au', 'org.au', 'co.nz', 'net.nz', 'org.nz',
    'co.za', 'org.za', 'com.br', 'com.mx', 'com.ar', 'com.tr',
    'co.jp', 'co.kr', 'co.in', 'net.in', 'org.in', 'co.id', 'com.sg',
    'com.hk', 'com.tw', 'com.my', 'co.il', 'com.pl', 'com.ua', 'co.ke'
  ) then
    return array_to_string(labels[array_length(labels, 1) - 2:], '.');
  end if;
  return second;
end $$;

-- RLS is forced and the migrator is not the owner: read as the bypassing role.
set role app_admin;
insert into org_domains (org_id, root, status, verify_token, verified_at, verified_by,
                         review_needed, deleted_at, tombstoned_at, created_at, last_checked_at)
select d.org_id,
       derive_root(d.hostname),
       case
         when bool_or(d.status = 'active') then 'active'
         when bool_or(d.status in ('verifying', 'pending')) then 'verifying'
         else 'failed'
       end,
       (array_agg(d.verify_token order by d.created_at))[1],
       max(d.verified_at),
       case when bool_or(d.verified_at is not null) then 'txt' end,
       bool_or(
         array_length(string_to_array(d.hostname, '.'), 1) > 3
         and split_part(d.hostname, '.', array_length(string_to_array(d.hostname, '.'), 1) - 1)
             || '.' || split_part(d.hostname, '.', array_length(string_to_array(d.hostname, '.'), 1))
             not in ('co.uk','org.uk','ac.uk','gov.uk','me.uk','net.uk','sch.uk',
                     'com.au','net.au','org.au','co.nz','net.nz','org.nz',
                     'co.za','org.za','com.br','com.mx','com.ar','com.tr',
                     'co.jp','co.kr','co.in','net.in','org.in','co.id','com.sg',
                     'com.hk','com.tw','com.my','co.il','com.pl','com.ua','co.ke')
       ),
       case when bool_and(d.deleted_at is not null) then max(d.deleted_at) end,
       case when bool_and(d.deleted_at is not null) then max(d.tombstoned_at) end,
       min(d.created_at),
       max(d.last_checked_at)
from domains d
group by d.org_id, derive_root(d.hostname);
reset role;

-- 2. Hostnames ------------------------------------------------------------

alter table domains rename to hostnames;
alter table hostnames rename column hostname to fqdn;
alter table hostnames add column domain_id uuid references org_domains (id) on delete cascade;
alter table hostnames add column label text not null default '';
-- RLS is forced on the table, so a data update as the migrator (no app.org_id)
-- matches zero rows. Every row-level statement below runs as app_admin.
set role app_admin;
update hostnames set label = split_part(fqdn, '.', 1);
reset role;
alter table hostnames alter column label drop default;
alter table hostnames alter column verify_token drop not null;

set role app_admin;
update hostnames h
   set domain_id = od.id
  from org_domains od
 where od.org_id = h.org_id and od.root = derive_root(h.fqdn);
reset role;

alter table hostnames alter column domain_id set not null;
create index hostnames_domain on hostnames (domain_id);

alter table hostnames drop constraint if exists domains_hostname_live;
drop index if exists domains_hostname_live;
drop index if exists domains_live_tombstones;
create unique index hostnames_fqdn_live on hostnames (lower(fqdn)) where deleted_at is null;
create index hostnames_fqdn_tombstones on hostnames (lower(fqdn)) where deleted_at is not null;
create index hostnames_org on hostnames (org_id, created_at desc);

-- The old check does not allow the new state names, so it goes before the map.
alter table hostnames drop constraint if exists domains_status_check;
set role app_admin;
update hostnames set status = case status
  when 'pending' then 'provisioning' when 'verifying' then 'waiting' else status end;
reset role;
alter table hostnames add constraint hostnames_status_check
  check (status in ('provisioning', 'waiting', 'active', 'paused', 'failed'));

-- 3. References -----------------------------------------------------------

alter table links rename column domain_id to hostname_id;
alter table domain_checks rename column domain_id to org_domain_id;
alter table domain_checks drop constraint if exists domain_checks_domain_id_fkey;
alter table domain_checks add constraint domain_checks_org_domain_fkey
  foreign key (org_domain_id) references org_domains (id) on delete cascade;

alter table tiers rename column domain_cap to hostname_cap;
alter table services rename column domain_slots_used to hostname_slots_used;

-- 4. Rules, triggers ------------------------------------------------------

create or replace function bump_slots() returns trigger
language plpgsql security definer set search_path = public as $$
declare svc uuid; delta integer;
begin
  svc := coalesce(new.service_id, old.service_id);
  delta := case
    when tg_op = 'INSERT' then 1
    when tg_op = 'DELETE' then -1
    when old.deleted_at is null and new.deleted_at is not null then -1
    when old.deleted_at is not null and new.deleted_at is null then 1
    else 0
  end;
  if delta <> 0 then
    perform 1 from services where id = svc for update;
    if tg_table_name = 'links' then
      update services set link_slots_used = link_slots_used + delta where id = svc;
    else
      update services set hostname_slots_used = hostname_slots_used + delta where id = svc;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists links_slots on links;
create trigger links_slots after insert or update of deleted_at or delete on links
  for each row execute function bump_slots();

drop trigger if exists domains_slots on hostnames;
create trigger hostnames_slots after insert or update of deleted_at or delete on hostnames
  for each row execute function bump_slots();

create or replace function assert_link_hostname_service() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from hostnames h
    where h.id = new.hostname_id and h.service_id = new.service_id
      and h.deleted_at is null
  ) then
    raise exception 'hostname % does not belong to service %', new.hostname_id, new.service_id;
  end if;
  return new;
end $$;

drop trigger if exists links_domain_service on links;
create trigger links_hostname_service before insert or update of hostname_id, service_id on links
  for each row execute function assert_link_hostname_service();

drop trigger if exists domains_verified on hostnames;
create or replace function assert_domain_verified() returns trigger
language plpgsql as $$
begin
  if new.status = 'active' and new.verified_at is null then
    raise exception 'domain % cannot be active without verified_at', new.id;
  end if;
  if new.deleted_at is not null and new.tombstoned_at is null then
    new.tombstoned_at := now();
  end if;
  return new;
end $$;
create trigger org_domains_verified before insert or update on org_domains
  for each row execute function assert_domain_verified();

drop trigger if exists domains_tombstone on hostnames;
create or replace function assert_domain_not_tombstoned() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from org_domains d
    where lower(d.root) = lower(new.root)
      and d.deleted_at is not null
      and d.tombstoned_at > now() - interval '30 days'
      and d.org_id <> new.org_id
  ) then
    raise exception 'domain % is tombstoned for another org', new.root;
  end if;
  return new;
end $$;
alter function assert_domain_not_tombstoned() owner to app_admin;
create trigger org_domains_tombstone before insert on org_domains
  for each row execute function assert_domain_not_tombstoned();

create or replace function find_live_domain(p_hostname text)
returns table (id uuid, org_id uuid, status text)
language sql security definer set search_path = public stable as $$
  select d.id, d.org_id, d.status
  from org_domains d
  where lower(d.root) = lower(p_hostname) and d.deleted_at is null
  limit 1
$$;

create or replace function find_domain_tombstone(p_hostname text)
returns table (id uuid, org_id uuid)
language sql security definer set search_path = public stable as $$
  select d.id, d.org_id
  from org_domains d
  where lower(d.root) = lower(p_hostname) and d.deleted_at is not null
    and d.tombstoned_at > now() - interval '30 days'
  order by d.tombstoned_at desc
  limit 1
$$;

create or replace function find_live_hostname(p_fqdn text)
returns table (id uuid, org_id uuid, status text)
language sql security definer set search_path = public stable as $$
  select h.id, h.org_id, h.status
  from hostnames h
  where lower(h.fqdn) = lower(p_fqdn) and h.deleted_at is null
  limit 1
$$;

create or replace function find_hostname_tombstone(p_fqdn text)
returns table (id uuid, org_id uuid)
language sql security definer set search_path = public stable as $$
  select h.id, h.org_id
  from hostnames h
  where lower(h.fqdn) = lower(p_fqdn) and h.deleted_at is not null
    and h.tombstoned_at > now() - interval '30 days'
  order by h.tombstoned_at desc
  limit 1
$$;

alter function find_live_hostname(text) owner to app_admin;
alter function find_hostname_tombstone(text) owner to app_admin;
grant execute on function find_live_hostname(text) to app_rw;
grant execute on function find_hostname_tombstone(text) to app_rw;

-- 5. Jobs -----------------------------------------------------------------

drop function if exists begin_verify(uuid, uuid);
create function begin_verify(p_id uuid, p_org uuid)
returns org_domains language plpgsql security definer set search_path = public as $$
declare row org_domains;
begin
  select * into row from org_domains
   where id = p_id and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if row.status not in ('pending', 'verifying', 'failed', 'active', 'routing_waiting') then
    raise exception 'not_verifying' using errcode = 'P0001';
  end if;
  update org_domains
     set status = case
           when row.status in ('active', 'routing_waiting') then row.status
           else 'verifying'
         end,
         last_checked_at = now(),
         created_at = case when row.status = 'failed' then now() else row.created_at end
   where id = p_id
  returning * into row;
  return row;
end $$;

alter function begin_verify(uuid, uuid) owner to app_admin;
grant execute on function begin_verify(uuid, uuid) to app_rw;

drop function if exists due_domain_checks(integer);
create function due_domain_checks(batch integer default 25)
returns table (
  id uuid,
  org_id uuid,
  root text,
  status text,
  verify_token text,
  wildcard_cf_id text,
  routing_state text
)
language sql security definer set search_path = public stable as $$
  select d.id, d.org_id, d.root, d.status, d.verify_token, d.wildcard_cf_id,
         d.routing_state
  from org_domains d
  where d.deleted_at is null and (
    (d.status in ('pending', 'verifying')
      and coalesce(d.last_checked_at, d.created_at) < now() - interval '5 minutes')
    or (d.status = 'active' and d.routing_state = 'waiting')
    or (d.status = 'active'
      and coalesce(d.last_checked_at, d.created_at) < now() - interval '1 day')
  )
  order by coalesce(d.last_checked_at, d.created_at)
  limit batch
$$;

create or replace function expire_stale_domains() returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  update org_domains set status = 'failed'
  where status in ('pending', 'verifying') and verified_at is null
    and deleted_at is null and created_at < now() - interval '72 hours';
  get diagnostics removed = row_count;
  return removed;
end $$;

-- The sweeps and lookups run with no tenant set, so the policies would hide
-- every row: they execute as the bypassing role instead.
alter function find_live_domain(text) owner to app_admin;
alter function find_domain_tombstone(text) owner to app_admin;
alter function due_domain_checks(integer) owner to app_admin;
alter function expire_stale_domains() owner to app_admin;
alter function live_domain_count() owner to app_admin;
grant execute on function find_live_domain(text) to app_rw;
grant execute on function find_domain_tombstone(text) to app_rw;
grant execute on function due_domain_checks(integer) to app_rw;
grant execute on function expire_stale_domains() to app_rw;
grant execute on function live_domain_count() to app_rw;

create or replace function live_domain_count() returns integer
language sql security definer set search_path = public stable as $$
  select count(*)::int from org_domains where deleted_at is null
$$;

-- 6. Service identity and notification destination ------------------------

alter table services add column name text;
set role app_admin;
update services s
   set name = initcap(st.code) || ' ' || initcap(t.code)
     || case when n.rn = 1 then '' else ' ' || n.rn::text end
  from service_types st, tiers t,
       (select id, row_number() over (partition by org_id order by created_at) as rn
          from services) n
 where st.id = s.service_type_id and t.id = s.tier_id and n.id = s.id;
reset role;
alter table services alter column name set not null;
create unique index services_name_per_org on services (org_id, lower(name));

alter table services add column preview_key text not null
  default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
create unique index services_preview_key on services (preview_key);

alter table orgs
  add column notify_email text,
  add column notify_enabled boolean not null default false,
  add column notify_token_hash bytea,
  add column notify_verified_at timestamptz;

set role app_admin;
update orgs o
   set notify_email = f.email, notify_verified_at = f.verified_at, notify_enabled = false
  from (
    select distinct on (org_id) org_id, email, verified_at
      from forward_addresses where status = 'verified'
     order by org_id, created_at
  ) f
 where f.org_id = o.id;
reset role;
