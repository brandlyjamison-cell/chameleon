-- 0002_rls.sql — isolation is a database guarantee, not a filter (INV-DATA-01).

alter table captures_suppressed add column org_id uuid not null references orgs (id) on delete cascade;
alter table prune_queue add column org_id uuid not null references orgs (id) on delete cascade;
alter table prune_queue alter column service_id set not null;

grant select, insert, update, delete on all tables in schema public to app_rw;
grant select on all tables in schema public to edge_ro;
grant select, insert, update, delete on all tables in schema public to app_admin;
grant usage, select on all sequences in schema public to app_rw, app_admin, edge_ro;

do $$
declare t text;
begin
  foreach t in array array[
    'memberships', 'api_tokens', 'services', 'service_events', 'domains',
    'domain_checks', 'links', 'profiles', 'captures', 'captures_suppressed',
    'prune_queue', 'vault_devices', 'vault_sessions', 'payments', 'invoices'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (org_id = current_setting(''app.org_id'', true)::uuid) with check (org_id = current_setting(''app.org_id'', true)::uuid)',
      t
    );
  end loop;
end $$;

-- sessions exist before an org is chosen (login), so null is allowed.
alter table sessions enable row level security;
alter table sessions force row level security;
create policy tenant_isolation on sessions
  using (org_id is null or org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id is null or org_id = current_setting('app.org_id', true)::uuid);

-- audit_log is cross-tenant by nature; admin writes carry the target org.
alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy tenant_isolation on audit_log
  using (org_id is null or org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id is null or org_id = current_setting('app.org_id', true)::uuid);

-- edge_ro: select-only, scoped by service, never by org (the edge has no session).
do $$
declare t text;
begin
  foreach t in array array['domains', 'links', 'captures', 'profiles']
  loop
    execute format(
      'create policy edge_service on %I for select using (service_id = current_setting(''app.service_id'', true)::uuid)',
      t
    );
  end loop;
end $$;
create policy edge_service on services
  for select using (id = current_setting('app.service_id', true)::uuid);
create policy edge_service on captures_suppressed
  for select using (service_id = current_setting('app.service_id', true)::uuid);

-- Counter columns are trigger-owned (INV-DATA-04). Column grants, not table
-- grants: a column revoke co-exists with a table grant and is otherwise a no-op.
revoke update on services from app_rw;
grant update (
  org_id, service_type_id, tier_id, status, expires_at, gate_mode,
  passcode_hash, passcode_salt, dek_wrapped, dek_wrap_kind, dek_kid, token_secret,
  activated_at
) on services to app_rw;

-- Append-only tables (INV-OPS-02).
create function deny_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function deny_mutation();
create trigger invoices_append_only before update or delete on invoices
  for each row execute function deny_mutation();
create trigger webhook_events_append_only before update or delete on webhook_events
  for each row execute function deny_mutation();
