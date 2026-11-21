-- 0015_throttle.sql — a provider 429 is not our failure.
-- Counting throttles against the six-try ceiling retired rows that were merely
-- early; now a throttle parks the row for 15 minutes and refunds the attempt.

alter table email_queue add column if not exists throttled_at timestamptz;

drop function if exists finish_email(bigint, boolean, text);

create function finish_email(p_id bigint, p_outcome text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_outcome = 'sent' then
    update email_queue set status = 'sent', sent_at = now(), last_error = null
     where id = p_id;
  elsif p_outcome = 'throttled' then
    update email_queue
       set status = 'queued',
           throttled_at = now(),
           last_error = coalesce(p_error, 'throttled'),
           attempts = greatest(attempts - 1, 0),
           available_at = now() + interval '15 minutes'
     where id = p_id;
  elsif (select attempts from email_queue where id = p_id) >= 6 then
    update email_queue set status = 'failed', last_error = p_error where id = p_id;
  else
    update email_queue
       set status = 'queued',
           last_error = p_error,
           available_at = now() + make_interval(mins => least(60, power(2, attempts))::int)
     where id = p_id;
  end if;
end $$;

/** Manual retry from the panel: resets the budget and makes it due now. */
create or replace function requeue_email(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update email_queue
     set status = 'queued', attempts = 0, available_at = now(), last_error = null
   where id = p_id and status in ('failed', 'queued')
$$;

alter function finish_email(bigint, text, text) owner to app_admin;
alter function requeue_email(bigint) owner to app_admin;
grant execute on function finish_email(bigint, text, text) to app_rw;
grant execute on function requeue_email(bigint) to app_rw;
