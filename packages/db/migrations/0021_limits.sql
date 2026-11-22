-- 0021_limits.sql — a DB-backed fixed window, so a restart does not reset abuse
-- limits, plus the lifecycle sweep the app never had.

create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

create or replace function rate_hit(p_key text, p_limit integer, p_window interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare row rate_limits;
begin
  insert into rate_limits (key, hits) values (p_key, 1)
  on conflict (key) do update set
    hits = case when rate_limits.window_start < now() - p_window then 1
                else rate_limits.hits + 1 end,
    window_start = case when rate_limits.window_start < now() - p_window then now()
                        else rate_limits.window_start end
  returning * into row;
  return row.hits <= p_limit;
end $$;

alter function rate_hit(text, integer, interval) owner to app_admin;
grant execute on function rate_hit(text, integer, interval) to app_rw;

-- Entitlement follows `paid_until`, not the frozen activation clock. A lapsed
-- service is `past_due` for 7 days, then `expired`; links deny in both states.
create or replace function sweep_services()
returns table (past_due integer, expired integer)
language plpgsql security definer set search_path = public as $$
declare a integer; b integer;
begin
  update services set status = 'past_due'
   where status = 'active' and paid_until is not null and paid_until < now();
  get diagnostics a = row_count;
  update services set status = 'expired'
   where status = 'past_due' and paid_until < now() - interval '7 days';
  get diagnostics b = row_count;
  delete from rate_limits where window_start < now() - interval '1 day';
  return query select a, b;
end $$;

alter function sweep_services() owner to app_admin;
grant execute on function sweep_services() to app_rw;

create or replace function admin_audit_recent(p_limit integer default 50)
returns table (id bigint, actor_id uuid, action text, target_id text,
               detail jsonb, created_at timestamptz)
language sql security definer set search_path = public stable as $$
  select id, actor_id, action, target_id, after as detail, created_at
  from audit_log order by id desc limit least(greatest(p_limit, 1), 200)
$$;
