-- 0022_rate_grant.sql — the definer function still needs the table grant for the
-- caller role in some setups; granting it is harmless and removes the doubt.
grant select, insert, update, delete on rate_limits to app_rw;
grant all on rate_limits to app_admin;
alter table rate_limits owner to app_admin;
