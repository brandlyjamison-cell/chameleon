-- 0016_rls_empty_guc.sql — a pooled connection can carry `app.org_id = ''`.
-- `''::uuid` throws, so every tenant policy now nulls it first, and the admin
-- queue read gets a definer function because it is cross-tenant anyway.

do $$
declare t text;
begin
  foreach t in array array[
    'memberships', 'api_tokens', 'services', 'service_events', 'domains',
    'domain_checks', 'links', 'profiles', 'captures', 'captures_suppressed',
    'prune_queue', 'vault_devices', 'vault_sessions', 'payments', 'invoices',
    'forward_addresses', 'email_queue'
  ]
  loop
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format(
      'create policy tenant_isolation on %I using (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid) with check (org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  end loop;
end $$;

create or replace function admin_emails(p_limit integer default 100)
returns table (
  id bigint, kind text, to_address text, subject text, status text,
  attempts smallint, last_error text, available_at timestamptz,
  created_at timestamptz, sent_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select id, kind, to_address, subject, status, attempts, last_error,
         available_at, created_at, sent_at
  from email_queue order by id desc limit least(greatest(p_limit, 1), 500)
$$;

alter function admin_emails(integer) owner to app_admin;
grant execute on function admin_emails(integer) to app_rw;
