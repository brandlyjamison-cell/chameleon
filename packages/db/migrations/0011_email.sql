-- 0011_email.sql — one queue for every message, and verified forward targets.
-- The queue is a table, not an in-process array: a restart must not lose a
-- verification link, and a provider outage must retry instead of dropping.

create table email_queue (
  id bigserial primary key,
  org_id uuid references orgs (id) on delete cascade,
  kind text not null
    check (kind in ('verify', 'invoice', 'receipt', 'forward', 'warning', 'system')),
  to_address text not null,
  subject text not null,
  text_body text not null,
  html_body text,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts smallint not null default 0,
  last_error text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_queue_due on email_queue (available_at) where status = 'queued';
create index email_queue_org on email_queue (org_id, created_at desc);

alter table email_queue enable row level security;
alter table email_queue force row level security;
create policy tenant_isolation on email_queue
  using (org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id = current_setting('app.org_id', true)::uuid);

create table forward_addresses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'verified')),
  token_hash bytea,
  expires_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

alter table forward_addresses enable row level security;
alter table forward_addresses force row level security;
create policy tenant_isolation on forward_addresses
  using (org_id = current_setting('app.org_id', true)::uuid)
  with check (org_id = current_setting('app.org_id', true)::uuid);

create index forward_addresses_org on forward_addresses (org_id, created_at desc);

/**
 * Platform mail may have no org (a verification before the org exists), so the
 * insert is a definer function rather than a policy-shaped insert.
 */
create or replace function enqueue_email(
  p_org uuid,
  p_kind text,
  p_to text,
  p_subject text,
  p_text text,
  p_html text
) returns bigint language sql security definer set search_path = public as $$
  insert into email_queue (org_id, kind, to_address, subject, text_body, html_body)
  values (p_org, p_kind, lower(p_to), p_subject, p_text, p_html)
  returning id
$$;

/** One batch, locked so two workers cannot send the same row. */
create or replace function claim_emails(p_limit integer default 20)
returns setof email_queue language sql security definer set search_path = public as $$
  update email_queue
     set status = 'sending', attempts = attempts + 1
   where id in (
     select id from email_queue
      where status = 'queued' and available_at <= now()
      order by available_at, id
      limit least(greatest(p_limit, 1), 100)
      for update skip locked
   )
  returning *
$$;

/** Backoff: 1, 2, 4 … 60 minutes, then permanent fail after 6 tries. */
create or replace function finish_email(p_id bigint, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ok then
    update email_queue set status = 'sent', sent_at = now(), last_error = null
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

/** Cross-tenant because the link carries no session. Returns the org to bounce back to. */
create or replace function verify_forward_token(p_hash bytea)
returns text language sql security definer set search_path = public as $$
  update forward_addresses
     set status = 'verified', verified_at = now(), token_hash = null, expires_at = null
   where token_hash = p_hash and status = 'pending' and expires_at > now()
  returning org_id::text
$$;

alter function verify_forward_token(bytea) owner to app_admin;
grant execute on function verify_forward_token(bytea) to app_rw;

alter function enqueue_email(uuid, text, text, text, text, text) owner to app_admin;
alter function claim_emails(integer) owner to app_admin;
alter function finish_email(bigint, boolean, text) owner to app_admin;

grant execute on function enqueue_email(uuid, text, text, text, text, text) to app_rw;
grant execute on function claim_emails(integer) to app_rw;
grant execute on function finish_email(bigint, boolean, text) to app_rw;

grant select, insert, update, delete on forward_addresses to app_rw;
grant select on forward_addresses to app_admin;
grant select on email_queue to app_admin;
