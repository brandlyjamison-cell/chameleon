-- 0006_auth.sql — platform identity (ADR 0016, ADR 0022).
--
-- Better Auth owns these tables. They are identity, not tenant data: there is no
-- org_id, so no tenant policy (RLS on them would break login, which happens
-- before any org is known). org_id lives in memberships, and users.id mirrors
-- auth_user.id, so one person is one row everywhere.
--
-- Columns are the library's camelCase names; the adapter has no casing option.

create table auth_user (
  id uuid primary key,
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create unique index auth_user_email_lower on auth_user (lower(email));

create table auth_session (
  id uuid primary key,
  "expiresAt" timestamptz not null,
  token text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid not null references auth_user (id) on delete cascade
);
create index auth_session_user on auth_session ("userId");
create index auth_session_expiry on auth_session ("expiresAt");

create table auth_account (
  id uuid primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" uuid not null references auth_user (id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("providerId", "accountId")
);
create index auth_account_user on auth_account ("userId");

create table auth_verification (
  id uuid primary key,
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index auth_verification_identifier on auth_verification (identifier);

-- A user row mirrors auth_user 1:1; the mirror is what memberships point at.
create unique index users_id_email on users (id);

-- WebAuthn credentials. The plugin owns this model ("passkey"), columns as-is.
create table passkey (
  id uuid primary key,
  name text,
  "publicKey" text not null,
  "userId" uuid not null references auth_user (id) on delete cascade,
  "credentialID" text not null unique,
  counter integer not null default 0,
  "deviceType" text not null,
  "backedUp" boolean not null default false,
  transports text,
  aaguid text,
  "createdAt" timestamptz not null default now()
);
create index passkey_user on passkey ("userId");

-- Login has no org yet, so a user must be able to see their own membership rows
-- with only `app.user_id` set. Policies are OR'd with tenant_isolation.
create policy self_membership on memberships
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

grant select, insert, update, delete on auth_user, auth_session, auth_account, auth_verification, passkey
  to app_rw, app_admin;

-- Housekeeping. Owned by app_admin so it can run cross-user from app_rw.
create function purge_expired_auth() returns integer language plpgsql
  security definer set search_path = public as $$
declare removed integer;
begin
  delete from auth_session where "expiresAt" < now();
  get diagnostics removed = row_count;
  delete from auth_verification where "expiresAt" < now() - interval '1 day';
  return removed;
end $$;
alter function purge_expired_auth() owner to app_admin;
grant execute on function purge_expired_auth() to app_rw;
