# ADR 0024 — Sessions, passcodes and email verification

Status: accepted (2026-11-21)

## Context

Stage 3 turns Better Auth on. Three choices must be made explicit: how long a
session lives, how email is proven, and how a passcode is turned into a key.

`arch/security.md` already fixes the shape: 30-minute idle, 12-hour absolute,
`HttpOnly; Secure; SameSite=Lax`, PBKDF2-SHA-256 at 310k, and no plaintext
passcode stored. What it does not say is where each is enforced.

## Decision

- **Idle expiry is the library's.** `expiresIn = 1800`, `updateAge = 60`: the
  token dies 30 minutes after the last refresh and refreshes at most once a
  minute. **Absolute expiry is ours**: `requireSession` compares
  `session.createdAt` with 12 hours and revokes past it, because Better Auth has
  one rolling clock, not two.
- **Cookies** are `__Secure-` prefixed (`useSecureCookies`), `HttpOnly`,
  `SameSite=Lax`, `Path=/`, no `Domain`. Localhost counts as a secure context, so
  development keeps the same flags as production.
- **Verification is a signed token, not a stored one.** Better Auth signs a JWT
  containing the email and user id; no row is written. Stage 3 therefore has no
  delivery channel and tees the link to a sink file (`MAIL_SINK`) that the tests
  read. SMTP replaces the sink, not the token.
- **Password hashing is the library's scrypt** (`salt:hash`), not Argon2id as
  `arch/security.md` says. Better Auth's default is scrypt with a 16-byte salt;
  switching to Argon2 is a config change and an upgrade of existing hashes.
- **The passcode is never stored.** PBKDF2-SHA-256 (310k, 16-byte per-service
  salt) derives a 32-byte key; that key is stored as the verifier and used
  directly as the AES-KW wrapping key for the DEK. Verifier and wrap key being the
  same value is deliberate: one derivation per unlock instead of two.
- **A different passcode on a half-provisioned service is refused**
  (`passcode_mismatch`) rather than silently rewrapping. Rewrapping needs the old
  passcode and belongs to the reset flow, not to resume.
- Signup creates `auth_user`, mirrors a `users` row by hook, then provisions the
  org in a separate transaction. A crash between them is repaired on next login
  (`ensureOrg`), which is what makes acceptance 3 (resume, not duplicate) real.

## Consequences

- The control plane is the only holder of sessions; the edge sees a signed
  session id, never the cookie.
- `users` is a mirror: auth columns live in `auth_*` tables and are never
  duplicated.
- Around expiry, a request can arrive with a token the server is about to revoke;
  it is re-issued rather than rejected, which is the point of a rolling window.
- The mail sink is a file, so a lost sink means "resend", not "broken account".

## Rejected

- **Absolute expiry in a cron job.** Two clocks, two failure modes for one rule.
- **Storing the PBKDF2 output as the only verifier and deriving a second key for
  the wrap.** Doubles activation cost for no isolation: both come from the same
  passcode and salt.
- **Argon2id now.** It means a native dependency on a box that is also a reverse
  proxy; scrypt is already memory-hard and is the library default.

## Reversal cost

Low. Session windows and cookie flags are constants; scrypt→Argon2 is a
per-user rehash on next login.

Last reviewed: 2026-11-21
