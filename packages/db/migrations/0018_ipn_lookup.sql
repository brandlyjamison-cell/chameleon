-- 0018_ipn_lookup.sql — the IPN has no tenant GUC, so its lookups are definer.

create or replace function payment_price(p_provider_id text)
returns integer language sql security definer set search_path = public stable as $$
  select price_cents from payments where provider_payment_id = p_provider_id
$$;

alter function payment_price(text) owner to app_admin;
grant execute on function payment_price(text) to app_rw;
