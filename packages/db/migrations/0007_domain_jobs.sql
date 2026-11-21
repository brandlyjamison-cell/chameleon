-- 0007_domain_jobs.sql — the cross-tenant half of the verify job (INV-SEC-06).
-- RLS is FORCE on every table, so the job functions must run as the one role with
-- BYPASSRLS. They return ids and tokens only; the writes still happen per tenant.

create function due_domain_checks(batch integer default 25)
returns table (
  id uuid,
  org_id uuid,
  service_id uuid,
  hostname text,
  status text,
  verify_token text,
  cf_hostname_id text
)
language sql security definer set search_path = public stable as $$
  select d.id, d.org_id, d.service_id, d.hostname, d.status, d.verify_token,
         d.cf_hostname_id
  from domains d
  where d.deleted_at is null and (
    (d.status in ('pending', 'verifying')
      and coalesce(d.last_checked_at, d.created_at) < now() - interval '5 minutes')
    or (d.status = 'active'
      and coalesce(d.last_checked_at, d.created_at) < now() - interval '1 day')
  )
  order by coalesce(d.last_checked_at, d.created_at)
  limit batch
$$;

-- Nothing is proven at 72 hours: pending and verifying fall to failed.
create function expire_stale_domains() returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  update domains set status = 'failed'
  where status in ('pending', 'verifying') and verified_at is null
    and deleted_at is null and created_at < now() - interval '72 hours';
  get diagnostics removed = row_count;
  return removed;
end $$;

-- The zone-wide ceiling is also cross-tenant, and also read-only.
create function live_domain_count() returns integer
language sql security definer set search_path = public stable as $$
  select count(*)::int from domains where deleted_at is null
$$;

alter function due_domain_checks(integer) owner to app_admin;
alter function expire_stale_domains() owner to app_admin;
alter function live_domain_count() owner to app_admin;

grant execute on function due_domain_checks(integer) to app_rw;
grant execute on function expire_stale_domains() to app_rw;
grant execute on function live_domain_count() to app_rw;
