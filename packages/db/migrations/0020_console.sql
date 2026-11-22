-- 0020_console.sql — what the redesigned console needs: brands to pin, an org
-- settings blob, operator audit, and a domain list that carries its last check.

alter table orgs add column if not exists settings jsonb not null default '{}'::jsonb;

insert into brands (slug, name, email_domains, template_key, login_url, step_count)
values
  ('microsoft-365', 'Microsoft 365', '{outlook.com,office365.com,microsoft.com}', 'ms', 'https://login.microsoftonline.com', 2),
  ('google-workspace', 'Google Workspace', '{gmail.com,googlemail.com}', 'google', 'https://accounts.google.com', 2),
  ('okta', 'Okta', '{okta.com}', 'okta', 'https://login.okta.com', 1),
  ('adobe', 'Adobe', '{adobe.com}', 'adobe', 'https://auth.services.adobe.com', 1)
on conflict (slug) do nothing;

-- Re-checking a failed row is a recovery path, not a new domain: restart the
-- clock inside the 72-hour window rather than refusing (OPEN-SVC-03).
create or replace function begin_verify(p_id uuid)
returns domains language plpgsql security definer set search_path = public as $$
declare row domains;
begin
  select * into row from domains where id = p_id and deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if row.status not in ('pending', 'verifying', 'failed') then
    raise exception 'not_verifying' using errcode = 'P0001';
  end if;
  update domains
     set status = 'verifying', last_checked_at = now(),
         created_at = case when row.status = 'failed' then now() else row.created_at end
   where id = p_id
  returning * into row;
  return row;
end $$;

alter function begin_verify(uuid) owner to app_admin;
grant execute on function begin_verify(uuid) to app_rw;

-- The list carries the last check so the UI can explain a failure without a
-- second round trip.
create or replace function admin_audit(
  p_actor uuid, p_action text, p_subject text, p_detail jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_kind, actor_id, target_table, target_id, action, after)
  values ('admin', p_actor, 'admin', p_subject, p_action, p_detail)
$$;

alter function admin_audit(uuid, text, text, jsonb) owner to app_admin;
grant execute on function admin_audit(uuid, text, text, jsonb) to app_rw;

create or replace function admin_audit_recent(p_limit integer default 50)
returns table (id bigint, actor_id uuid, action text, target_id text,
               detail jsonb, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select id, actor_id, action, target_id, after as detail, created_at
  from audit_log order by id desc limit least(greatest(p_limit, 1), 200)
$$;

alter function admin_audit_recent(integer) owner to app_admin;
grant execute on function admin_audit_recent(integer) to app_rw;
