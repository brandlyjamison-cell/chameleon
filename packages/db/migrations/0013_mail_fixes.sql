-- 0013_mail_fixes.sql — the receipt path is cross-tenant, and the verifier writes.

grant update on forward_addresses to app_admin;

create or replace function receipt_target(p_provider_id text)
returns table (org_id uuid, price_cents integer, period_end timestamptz, service_type text, email text)
language sql security definer set search_path = public stable as $$
  select p.org_id, p.price_cents, p.period_end, st.code, u.email
  from payments p
  join services s on s.id = p.service_id
  join service_types st on st.id = s.service_type_id
  join memberships m on m.org_id = p.org_id and m.role = 'owner'
  join users u on u.id = m.user_id
  where p.provider_payment_id = p_provider_id
$$;

alter function receipt_target(text) owner to app_admin;
grant execute on function receipt_target(text) to app_rw;
