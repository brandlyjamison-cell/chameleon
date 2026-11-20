-- 0004_capture.sql — 15-minute dedupe bucket and oldest-first pruning (INV-CAP-07/09).

create function set_capture_bucket() returns trigger language plpgsql as $$
begin
  new.dedupe_bucket := to_char(new.received_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:')
    || lpad(((extract(minute from new.received_at at time zone 'utc')::int / 15) * 15)::text, 2, '0');
  return new;
end $$;
create trigger captures_bucket before insert on captures
  for each row execute function set_capture_bucket();

create function prune_captures(p_service uuid, p_cap integer) returns integer
language plpgsql as $$
declare removed integer;
begin
  with doomed as (
    select id, payload_ref from captures
    where service_id = p_service
    order by received_at desc, id desc
    offset p_cap
  ), q as (
    insert into prune_queue (org_id, service_id, capture_id, payload_ref)
    select c.org_id, c.service_id, d.id, d.payload_ref
    from doomed d join captures c on c.id = d.id
    returning 1
  ), del as (
    delete from captures where id in (select id from doomed) returning 1
  )
  select count(*) into removed from del;
  return removed;
end $$;

create function suppress_capture(p_service uuid, p_bucket text) returns void
language sql as $$
  insert into captures_suppressed (org_id, service_id, bucket, count)
  select org_id, id, p_bucket, 1 from services where id = p_service
  on conflict (service_id, bucket) do update set count = captures_suppressed.count + 1, updated_at = now();
$$;

alter function prune_captures(uuid, integer) owner to app_admin;
alter function suppress_capture(uuid, text) owner to app_admin;
