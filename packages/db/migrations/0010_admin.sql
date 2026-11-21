-- 0010_admin.sql — the operator panel, and the unused passkey table goes.
-- ADR 0022: admin is a flag on the human, cross-tenant. Every read/write below is
-- SECURITY DEFINER because RLS is tenant-scoped by design.

drop table if exists passkey;

alter table services add column if not exists admin_note text;

-- Free time from the panel: never shortens, always extends from whichever is later.
create or replace function admin_extend_days(p_service uuid, p_days integer)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare until timestamptz;
begin
  if p_days <= 0 then raise exception 'days must be positive'; end if;
  update services
     set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => p_days)
   where id = p_service
  returning paid_until into until;
  return until;
end $$;

create or replace function admin_set_service_status(p_service uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('active', 'suspended', 'archived', 'provisioning', 'expired') then
    raise exception 'bad status %', p_status;
  end if;
  update services set status = p_status where id = p_service;
end $$;

create or replace function admin_set_note(p_service uuid, p_note text)
returns void language sql security definer set search_path = public as $$
  update services set admin_note = nullif(left(p_note, 500), '') where id = p_service
$$;

/** One service with everything the panel needs, including its payment history. */
create or replace function admin_service_detail(p_service uuid)
returns table (
  service_id uuid, org_id uuid, org_name text, owner_email text, status text,
  tier text, paid_until timestamptz, expires_at timestamptz, admin_note text,
  captures bigint, payments jsonb
)
language sql security definer set search_path = public stable as $$
  select s.id, s.org_id, o.name, u.email, s.status, t.code, s.paid_until,
         s.expires_at, s.admin_note,
         (select count(*) from captures c where c.service_id = s.id),
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', p.id, 'status', p.status, 'price', p.price_cents,
             'provider', p.provider_payment_id, 'created', p.created_at,
             'periodEnd', p.period_end) order by p.created_at desc)
           from payments p where p.service_id = s.id
         ), '[]'::jsonb)
  from services s
  join orgs o on o.id = s.org_id
  join tiers t on t.id = s.tier_id
  left join memberships m on m.org_id = s.org_id and m.role = 'owner'
  left join users u on u.id = m.user_id
  where s.id = p_service
$$;

alter function admin_extend_days(uuid, integer) owner to app_admin;
alter function admin_set_service_status(uuid, text) owner to app_admin;
alter function admin_set_note(uuid, text) owner to app_admin;
alter function admin_service_detail(uuid) owner to app_admin;

grant execute on function admin_extend_days(uuid, integer) to app_rw;
grant execute on function admin_set_service_status(uuid, text) to app_rw;
grant execute on function admin_set_note(uuid, text) to app_rw;
grant execute on function admin_service_detail(uuid) to app_rw;

-- Admin flag bootstrap is idempotent and email-driven (ADMIN_EMAILS).
create or replace function admin_set_by_email(p_email text)
returns void language sql security definer set search_path = public as $$
  update users set is_admin = true where lower(email) = lower(p_email)
$$;
alter function admin_set_by_email(text) owner to app_admin;
grant execute on function admin_set_by_email(text) to app_rw;
