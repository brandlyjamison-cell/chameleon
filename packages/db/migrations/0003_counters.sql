-- 0003_counters.sql — slot counters, never trusted from the client (INV-DATA-05).

create function bump_slots() returns trigger language plpgsql security definer set search_path = public as $$
declare svc uuid; delta integer;
begin
  if tg_table_name = 'links' then
    svc := coalesce(new.service_id, old.service_id);
    delta := case
      when tg_op = 'INSERT' then 1
      when tg_op = 'DELETE' then -1
      when old.deleted_at is null and new.deleted_at is not null then -1
      when old.deleted_at is not null and new.deleted_at is null then 1
      else 0
    end;
    if delta <> 0 then
      perform 1 from services where id = svc for update;
      update services set link_slots_used = link_slots_used + delta where id = svc;
    end if;
  else
    svc := coalesce(new.service_id, old.service_id);
    delta := case
      when tg_op = 'INSERT' then 1
      when tg_op = 'DELETE' then -1
      when old.deleted_at is null and new.deleted_at is not null then -1
      when old.deleted_at is not null and new.deleted_at is null then 1
      else 0
    end;
    if delta <> 0 then
      perform 1 from services where id = svc for update;
      update services set domain_slots_used = domain_slots_used + delta where id = svc;
    end if;
  end if;
  return null;
end $$;

create trigger links_slots after insert or update of deleted_at or delete on links
  for each row execute function bump_slots();
create trigger domains_slots after insert or update of deleted_at or delete on domains
  for each row execute function bump_slots();

-- A link may only reference a domain of its own service.
create function assert_link_domain_service() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from domains d
    where d.id = new.domain_id and d.service_id = new.service_id and d.deleted_at is null
  ) then
    raise exception 'domain % does not belong to service %', new.domain_id, new.service_id;
  end if;
  return new;
end $$;
create trigger links_domain_service before insert or update of domain_id, service_id on links
  for each row execute function assert_link_domain_service();

-- The definer functions bypass RLS as the admin role (they run mid-transaction
-- from app_rw, which has no GUC error tolerance to spare).
alter function bump_slots() owner to app_admin;
