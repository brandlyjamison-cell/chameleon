-- 0024_rate_fix.sql — 0021 shipped before two corrections and is already recorded
-- on production. Recreate the function and ownership here rather than editing a
-- migration that has run.

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
grant all on rate_limits to app_admin;
grant select, insert, update, delete on rate_limits to app_rw;
alter table rate_limits owner to app_admin;
