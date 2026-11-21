-- 0019_mail_lease.sql — reclaim rows whose worker died mid-send, and expose depth.

alter table email_queue add column if not exists claimed_at timestamptz;

drop function if exists claim_emails(integer);

create function claim_emails(p_limit integer default 20)
returns setof email_queue language sql security definer set search_path = public as $$
  update email_queue
     set status = 'sending', attempts = attempts + 1, claimed_at = now()
   where id in (
     select id from email_queue
      where (status = 'queued' and available_at <= now())
         or (status = 'sending' and claimed_at < now() - interval '5 minutes')
      order by available_at, id
      limit least(greatest(p_limit, 1), 100)
      for update skip locked
   )
  returning *
$$;

create or replace function mail_stats()
returns table (queued bigint, sending bigint, failed_24h bigint, oldest_queued_seconds bigint)
language sql security definer set search_path = public stable as $$
  select
    (select count(*) from email_queue where status = 'queued'),
    (select count(*) from email_queue where status = 'sending'),
    (select count(*) from email_queue where status = 'failed' and created_at > now() - interval '24 hours'),
    (select coalesce(extract(epoch from now() - min(created_at))::bigint, 0)
       from email_queue where status = 'queued')
$$;

alter function claim_emails(integer) owner to app_admin;
alter function mail_stats() owner to app_admin;
grant execute on function claim_emails(integer) to app_rw;
grant execute on function mail_stats() to app_rw;
