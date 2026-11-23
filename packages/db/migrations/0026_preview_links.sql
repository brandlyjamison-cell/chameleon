-- 0026_preview_links.sql — one free preview link per service, and the assets a
-- cloned page needs to render without touching the tenant's DNS.
--
-- A preview link has no hostname: it lives on the platform path
-- `/p/<service preview_key>/<slug>` (ADR 0033). It never consumes a link slot and
-- it survives the tenant's hostname churn.

alter table links alter column hostname_id drop not null;
alter table links add column is_preview boolean not null default false;
alter table links add column profile_id uuid references profiles (id) on delete set null;

create unique index links_preview_per_service on links (service_id)
  where is_preview and deleted_at is null;

-- Preview rows are free: the counter only moves for addressable links.
create or replace function bump_slots() returns trigger
language plpgsql security definer set search_path = public as $$
declare svc uuid; delta integer;
begin
  svc := coalesce(new.service_id, old.service_id);
  if tg_table_name = 'links' then
    if coalesce(new.is_preview, old.is_preview) then return null; end if;
  end if;
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

create or replace function assert_link_hostname_service() returns trigger
language plpgsql as $$
begin
  if new.hostname_id is null then
    if not new.is_preview then
      raise exception 'link % needs a hostname unless it is a preview', new.id;
    end if;
    return new;
  end if;
  if not exists (
    select 1 from hostnames h
    where h.id = new.hostname_id and h.service_id = new.service_id
      and h.deleted_at is null
  ) then
    raise exception 'hostname % does not belong to service %', new.hostname_id, new.service_id;
  end if;
  return new;
end $$;

alter table links drop constraint if exists links_preview_shape;
alter table links add constraint links_preview_shape check (
  is_preview or hostname_id is not null
);

-- 2. Cloned-page assets ----------------------------------------------------

alter table profiles
  add column if not exists source_url text,
  add column if not exists brand_name text,
  add column if not exists screenshot_asset_id uuid,
  add column if not exists logo_asset_id uuid;

create table profile_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('logo', 'screenshot', 'favicon')),
  mime text not null,
  bytes bytea not null,
  sha256 bytea not null,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);
create index profile_assets_profile on profile_assets (profile_id);

alter table profile_assets enable row level security;
alter table profile_assets force row level security;
create policy tenant_isolation on profile_assets
  using (org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id = current_setting('app.org_id', true)::uuid);
grant select, insert, update, delete on profile_assets to app_rw, app_admin;

alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check
  check (status in ('generated', 'accepted', 'rejected', 'failed'));

-- 3. Anonymous reads -------------------------------------------------------

/**
 * One preview link by key and slug. Definitive on purpose: the visitor has no
 * session, so tenant policies would hide the row.
 */
create or replace function preview_link(p_key text, p_slug text)
returns table (
  link_id uuid,
  org_id uuid,
  service_id uuid,
  service_type text,
  status text,
  expires_at timestamptz,
  service_status text,
  brand_id uuid,
  profile_id uuid
)
language sql security definer set search_path = public stable as $$
  select l.id, l.org_id, l.service_id, st.code, l.status, s.expires_at,
         s.status, l.pinned_brand_id, l.profile_id
  from links l
  join services s on s.id = l.service_id
  join service_types st on st.id = s.service_type_id
  where l.slug = upper(p_slug) and l.is_preview and l.deleted_at is null
    and s.preview_key = p_key
    and s.status in ('provisioning', 'active', 'past_due')
  limit 1
$$;
alter function preview_link(text, text) owner to app_admin;
grant execute on function preview_link(text, text) to app_rw;

/**
 * Everything one preview render needs, with the pinned brand winning over a
 * profile, and cPanel as the last resort (ADR 0034). Assets come back as ids so
 * the route can point at the immutable asset URL.
 */
create or replace function preview_render(p_key text, p_slug text)
returns table (
  link_id uuid,
  org_id uuid,
  service_id uuid,
  service_type text,
  slug text,
  status text,
  expires_at timestamptz,
  source text,
  brand_slug text,
  template_key text,
  brand_name text,
  title text,
  step_count smallint,
  redirect_to text,
  palette jsonb,
  labels jsonb,
  logo_asset_id uuid,
  backdrop_asset_id uuid
)
language plpgsql security definer set search_path = public stable as $$
declare l record; b brands; p profiles;
begin
  select pl.* into l from preview_link(p_key, upper(p_slug)) pl;
  if not found or l.status <> 'active' then return; end if;

  if l.brand_id is not null then
    select br.* into b from brands br where br.id = l.brand_id and br.enabled;
  end if;

  if b.id is null then
    select pr.* into p from profiles pr
     where pr.org_id = l.org_id
       and (pr.id = l.profile_id or pr.service_id = l.service_id)
       and pr.status in ('generated', 'accepted')
       and pr.expires_at > now()
     order by (pr.id = l.profile_id) desc, pr.created_at desc
     limit 1;
  end if;

  if b.id is not null then
    return query select l.link_id, l.org_id, l.service_id, l.service_type, upper(p_slug),
      l.status, l.expires_at, 'pin', b.slug, b.template_key, b.name, b.name,
      b.step_count, b.login_url, b.palette, b.labels,
      case when b.logo_ref ~ '^[0-9a-f]{8}-' then b.logo_ref::uuid end,
      case when b.backdrop_ref ~ '^[0-9a-f]{8}-' then b.backdrop_ref::uuid end;
  elsif p.id is not null then
    return query select l.link_id, l.org_id, l.service_id, l.service_type, upper(p_slug),
      l.status, l.expires_at, 'profile',
      coalesce(p.profile->>'brand_slug', p.email_domain),
      coalesce(p.profile->>'template_key', 'generic'),
      coalesce(p.brand_name, p.email_domain),
      coalesce(p.profile->>'title', p.brand_name, p.email_domain),
      p.step_count, coalesce(p.profile->>'redirect_to', 'https://' || p.email_domain),
      coalesce(p.profile->'palette', '{}'::jsonb), coalesce(p.profile->'labels', '{}'::jsonb),
      p.logo_asset_id, p.screenshot_asset_id;
  else
    return query select l.link_id, l.org_id, l.service_id, l.service_type, upper(p_slug),
      l.status, l.expires_at, 'cpanel', 'cpanel', 'cpanel', 'cPanel', 'cPanel',
      1::smallint, 'https://cpanel.net/', '{}'::jsonb, '{}'::jsonb, null::uuid, null::uuid;
  end if;
end $$;
alter function preview_render(text, text) owner to app_admin;
grant execute on function preview_render(text, text) to app_rw;

/** Asset bytes for the public immutable route. */
create or replace function profile_asset(p_id uuid)
returns table (mime text, bytes bytea)
language sql security definer set search_path = public stable as $$
  select a.mime, a.bytes from profile_assets a where a.id = p_id
$$;
alter function profile_asset(uuid) owner to app_admin;
grant execute on function profile_asset(uuid) to app_rw;
