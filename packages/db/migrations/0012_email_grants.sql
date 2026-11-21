-- 0012_email_grants.sql — the definer still needs privileges as its owner role.

grant select, insert, update, delete on email_queue to app_rw, app_admin;
grant usage, select on sequence email_queue_id_seq to app_rw, app_admin;
