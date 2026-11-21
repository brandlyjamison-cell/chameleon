-- 0009_billing.sql — payment before activation, and the operator flag (ADR 0026).
-- Money rules live here, not in a route: the IPN is anonymous, so the write path
-- is a SECURITY DEFINER function owned by the bypassing role.

alter table payments add column if not exists provider text not null default 'nowpayments';
alter table payments add column if not exists checkout_url text;
alter table services add column if not exists paid_until timestamptz;

-- Only `confirmed` buys entitlement; the period is fixed at checkout so an IPN
-- can never invent a longer term.
create or replace function extend_entitlement(p_service uuid, p_end timestamptz)
returns void language sql as $$
  update services set paid_until = greatest(coalesce(paid_until, p_end), p_end)
  where id = p_service
$$;

/**
 * Applies one provider status to one payment. Idempotent: a repeated `confirmed`
 * does not double-extend, because the extension is keyed to the stored period.
 */
create or replace function apply_payment_status(
  p_provider_id text,
  p_status text,
  p_raw jsonb
) returns table (service_id uuid, org_id uuid, status text, paid_until timestamptz)
language plpgsql security definer set search_path = public as $$
declare pay payments;
begin
  select * into pay from payments where provider_payment_id = p_provider_id for update;
  if not found then return; end if;

  insert into webhook_events (provider, provider_event_id, body_hash)
  values (pay.provider, p_provider_id || ':' || p_status, sha256(convert_to(p_status || p_provider_id, 'utf8')))
  on conflict (provider, provider_event_id) do nothing;

  if p_status in ('finished', 'confirmed', 'partially_paid') then
    if pay.status <> 'confirmed' then
      update payments set status = 'confirmed', raw = p_raw, extended_at = now()
      where id = pay.id;
      perform extend_entitlement(pay.service_id, pay.period_end);
    end if;
    return query
      select s.id, s.org_id, 'confirmed', s.paid_until from services s where s.id = pay.service_id;
  elsif p_status = 'confirming' then
    update payments set status = 'confirming', raw = p_raw where id = pay.id;
    return query select s.id, s.org_id, 'confirming', s.paid_until from services s where s.id = pay.service_id;
  elsif p_status in ('failed', 'expired', 'refunded') then
    update payments set status = p_status, raw = p_raw where id = pay.id;
    return query select s.id, s.org_id, p_status, s.paid_until from services s where s.id = pay.service_id;
  end if;
  return query select s.id, s.org_id, pay.status, s.paid_until from services s where s.id = pay.service_id;
end $$;

-- Admin reads are cross-tenant by definition.
create or replace function admin_overview()
returns table (orgs bigint, services bigint, active bigint, unpaid bigint, captures bigint)
language sql security definer set search_path = public stable as $$
  select
    (select count(*) from orgs),
    (select count(*) from services),
    (select count(*) from services where status = 'active'),
    (select count(*) from services where paid_until is null or paid_until < now()),
    (select count(*) from captures)
$$;

create or replace function admin_orgs()
returns table (
  org_id uuid, org_name text, owner_email text, created_at timestamptz,
  services bigint, captures bigint, paid bigint
)
language sql security definer set search_path = public stable as $$
  select o.id, o.name, u.email, o.created_at,
         (select count(*) from services s where s.org_id = o.id),
         (select count(*) from captures c where c.org_id = o.id),
         (select coalesce(sum(p.price_cents) filter (where p.status = 'confirmed'), 0) from payments p where p.org_id = o.id)
  from orgs o
  left join memberships m on m.org_id = o.id and m.role = 'owner'
  left join users u on u.id = m.user_id
  order by o.created_at desc
$$;

create or replace function admin_services()
returns table (
  service_id uuid, org_name text, owner_email text, status text, tier text,
  expires_at timestamptz, paid_until timestamptz, captures bigint, created_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select s.id, o.name, u.email, s.status, t.code, s.expires_at, s.paid_until,
         (select count(*) from captures c where c.service_id = s.id), s.created_at
  from services s
  join orgs o on o.id = s.org_id
  join tiers t on t.id = s.tier_id
  left join memberships m on m.org_id = s.org_id and m.role = 'owner'
  left join users u on u.id = m.user_id
  where s.status <> 'archived'
  order by s.created_at desc
  limit 200
$$;

alter function apply_payment_status(text, text, jsonb) owner to app_admin;
alter function admin_overview() owner to app_admin;
alter function admin_orgs() owner to app_admin;
alter function admin_services() owner to app_admin;

grant execute on function apply_payment_status(text, text, jsonb) to app_rw;
grant execute on function admin_overview() to app_rw;
grant execute on function admin_orgs() to app_rw;
grant execute on function admin_services() to app_rw;

-- The operator flag is on the mirror row; admins are set by email at signup.
alter table users add column if not exists is_admin boolean not null default false;
create index if not exists users_is_admin on users (is_admin) where is_admin;
