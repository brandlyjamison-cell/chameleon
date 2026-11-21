-- 0023_begin_verify_org.sql — the definer bypasses RLS, so the caller's org must
-- be an explicit argument, and an active row keeps `active` through a re-check.

drop function if exists begin_verify(uuid);

create function begin_verify(p_id uuid, p_org uuid)
returns domains language plpgsql security definer set search_path = public as $$
declare row domains;
begin
  select * into row from domains
   where id = p_id and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if row.status not in ('pending', 'verifying', 'failed', 'active') then
    raise exception 'not_verifying' using errcode = 'P0001';
  end if;
  update domains
     set status = case when row.status = 'active' then 'active' else 'verifying' end,
         last_checked_at = now(),
         created_at = case when row.status = 'failed' then now() else row.created_at end
   where id = p_id
  returning * into row;
  return row;
end $$;

alter function begin_verify(uuid, uuid) owner to app_admin;
grant execute on function begin_verify(uuid, uuid) to app_rw;
