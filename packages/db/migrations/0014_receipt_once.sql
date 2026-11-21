-- 0014_receipt_once.sql — tell the caller whether this IPN actually confirmed.
-- Without the flag a provider replay would send a second receipt.

drop function if exists apply_payment_status(text, text, jsonb);

create function apply_payment_status(
  p_provider_id text,
  p_status text,
  p_raw jsonb
) returns table (
  service_id uuid, org_id uuid, status text, paid_until timestamptz, fresh boolean
)
language plpgsql security definer set search_path = public as $$
declare pay payments; did boolean := false;
begin
  select * into pay from payments where provider_payment_id = p_provider_id for update;
  if not found then return; end if;

  insert into webhook_events (provider, provider_event_id, body_hash)
  values (pay.provider, p_provider_id || ':' || p_status, sha256(convert_to(p_status || p_provider_id, 'utf8')))
  on conflict (provider, provider_event_id) do nothing;

  if p_status in ('finished', 'confirmed', 'partially_paid') then
    if pay.status <> 'confirmed' then
      update payments set status = 'confirmed', raw = p_raw, extended_at = now()
      where id = pay.id;
      perform extend_entitlement(pay.service_id, pay.period_end);
      did := true;
    end if;
    return query
      select s.id, s.org_id, 'confirmed', s.paid_until, did from services s where s.id = pay.service_id;
  elsif p_status = 'confirming' then
    update payments set status = 'confirming', raw = p_raw where id = pay.id;
    return query select s.id, s.org_id, 'confirming', s.paid_until, false from services s where s.id = pay.service_id;
  elsif p_status in ('failed', 'expired', 'refunded') then
    update payments set status = p_status, raw = p_raw where id = pay.id;
    return query select s.id, s.org_id, p_status, s.paid_until, false from services s where s.id = pay.service_id;
  end if;
  return query select s.id, s.org_id, pay.status, s.paid_until, false from services s where s.id = pay.service_id;
end $$;

alter function apply_payment_status(text, text, jsonb) owner to app_admin;
grant execute on function apply_payment_status(text, text, jsonb) to app_rw;
