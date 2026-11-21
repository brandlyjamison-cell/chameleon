-- 0008_domain_tombstone_visibility.sql — the tombstone rule was RLS-blind.
-- `applicant` inserts run as app_rw, so a trigger reading `domains` could not see
-- another org's row and let a tombstoned hostname through for 30 days. The
-- trigger and the two lookups now run as the BYPASSRLS role (INV-SEC-06).

alter function assert_domain_not_tombstoned() security definer;
alter function assert_domain_not_tombstoned() set search_path = public;
alter function assert_domain_not_tombstoned() owner to app_admin;

create function find_live_domain(p_hostname text)
returns table (id uuid, org_id uuid, status text)
language sql security definer set search_path = public stable as $$
  select d.id, d.org_id, d.status
  from domains d
  where lower(d.hostname) = lower(p_hostname) and d.deleted_at is null
  limit 1
$$;

create function find_domain_tombstone(p_hostname text)
returns table (id uuid, org_id uuid)
language sql security definer set search_path = public stable as $$
  select d.id, d.org_id
  from domains d
  where lower(d.hostname) = lower(p_hostname) and d.deleted_at is not null
    and d.tombstoned_at > now() - interval '30 days'
  order by d.tombstoned_at desc
  limit 1
$$;

alter function find_live_domain(text) owner to app_admin;
alter function find_domain_tombstone(text) owner to app_admin;

grant execute on function find_live_domain(text) to app_rw;
grant execute on function find_domain_tombstone(text) to app_rw;
