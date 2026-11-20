-- 0005_domains.sql — activation and tombstoning rules (INV-SEC-06/07).

create function assert_domain_verified() returns trigger language plpgsql as $$
begin
  if new.status = 'active' and new.verified_at is null then
    raise exception 'domain % cannot be active without verified_at', new.id;
  end if;
  if new.deleted_at is not null and new.tombstoned_at is null then
    new.tombstoned_at := now();
  end if;
  return new;
end $$;
create trigger domains_verified before insert or update on domains
  for each row execute function assert_domain_verified();

-- A tombstone blocks another org for 30 days, but never its own revive.
create function assert_domain_not_tombstoned() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from domains d
    where lower(d.hostname) = lower(new.hostname)
      and d.deleted_at is not null
      and d.tombstoned_at > now() - interval '30 days'
      and d.org_id <> new.org_id
  ) then
    raise exception 'hostname % is tombstoned for another org', new.hostname;
  end if;
  return new;
end $$;
create trigger domains_tombstone before insert on domains
  for each row execute function assert_domain_not_tombstoned();
