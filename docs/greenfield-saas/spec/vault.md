# Vault and gate

Each service owns a vault: the list of its captures. The vault lives on the
control plane, is scoped to one service, and is opened through a gate. Gate mode
is per service.

## Gate modes

| Mode               | Behaviour                                                                 | DEK wrapped under |
| ------------------ | ------------------------------------------------------------------------- | ----------------- |
| `always` (default) | Passcode on every open. Short session (15 min, memory), re-prompt after.  | passcode          |
| `remember_30d`     | Passcode once per device, cookie remembers 30 days, revocable per device. | passcode          |
| `off`              | Platform login only.                                                      | KEK (server-side) |

The passcode is set when the service activates. It is stored (hashed) even if the
mode is later set to `off`, so re-arming needs no new passcode. Re-arming
requires the existing passcode once; forgetting it is `OPEN-VAULT-01`.

Semantics that make the modes real:

- In `always` and `remember_30d` the **passcode is the only thing that can open
  the DEK**. The platform stores a verifier, not a copy. Losing the passcode
  loses captures, and we say so at setup.
- Changing the mode `off → always` re-wraps under the passcode inside the same
  transaction as the verifier check, so there is no window where the DEK exists
  under neither.
- `remember_30d` device cookies are rows in `vault_devices` (`service_id`,
  `user_id`, `token_hash`, `ua`, `last_seen`, `expires_at`), listed and revocable
  in the vault. Revoking one does not disturb others.
- `off → always` also mints a fresh CSRF token and drops all device cookies,
  because their authority changed.

## Passcode rules

- 10 characters minimum, no composition rules, zxcvbn score ≥ 3, checked against
  a local dictionary. It is a shared secret, not an account password, so length
  beats symbols.
- PBKDF2-SHA-256, 310k iterations, 128-bit per-service salt, verified server-side
  in a Worker (the dashboard posts to the data plane for verification so the
  derivation never runs on the VPS). `OPEN-VAULT-02` covers moving to Argon2 via
  WASM.
- Six attempts per 15 minutes per service+IP, then exponential backoff; the
  attempt count is a Durable Object counter so it survives worker recycling.
- Rotation requires the current passcode. Rotation re-wraps the DEK; rows are not
  re-encrypted, because they are encrypted with the DEK, not the passcode.
- An admin cannot reset a passcode without the tenant's current one; an admin
  reset after proof of ownership is `OPEN-VAULT-03`.

## Vault session

A successful passcode unwraps the DEK into Worker memory for the request and
stores only a _handle_:

- `vault_session` row: `service_id`, `user_id`, `mode`, `expires_at`, `ua`,
  `ip_hash`.
- The handle is an opaque 32-byte cookie value; the session row is the authority.
- The DEK is never in the cookie and never in `localStorage`.
- Every vault read and export opens the DEK fresh at the data plane from
  `dek_wrapped` + the passcode, or from the KEK when `off`. This is deliberate:
  one derivation per request is cheap, and nothing long-lived sits in memory
  between requests.

`OPEN-VAULT-04`: for `always` with a 15-minute session, is one PBKDF2 per request
acceptable at 250k rows (export paging)? If not, cache the unwrapped DEK in the
Durable Object for the session's life.

## Vault list

Columns: `received_at`, `source`, `status`, `kind`, `username`, `password`
(credential) or `session size` (session), `link slug`, `brand`, `domain`.

- Default filter: `source in ('human','decoy')`, newest first, 50 per page,
  keyset cursor.
- Filters: source (incl. `scanner`), status, kind, brand, domain, link, date
  range, has-password.
- `scanner` rows are hidden by default but counted on the service card, so the
  decoy's value is visible without polluting the list.
- Row expand decrypts one row (or fetches its R2 payload) on demand.
- A session row (`aitm`, later) renders as a payload viewer plus "open real app".
  Same table, same actions, no separate tab.

## Owner actions

| Action               | Effect                                              | Gate                            |
| -------------------- | --------------------------------------------------- | ------------------------------- |
| mark valid / invalid | `status` write, audited in the service activity log | vault session                   |
| delete               | hard delete of the row + R2 object schedule         | vault session                   |
| delete all (filter)  | batched job, confirm by typing the service name     | vault session                   |
| export CSV           | streamed, current filter, `source` respected        | vault session                   |
| webhook forward      | Pro, per-service endpoint, HMAC signed              | vault session + `webhook:write` |
| re-arm gate          | `off → always`, rewrap, drop devices                | passcode                        |
| rotate passcode      | verify old, rewrap, drop devices                    | passcode                        |

Deleting a capture is permanent; there is no trash. The cap makes deletion a
normal operation, so the UI must not treat it as destructive theatre — one click,
undo affordance for 10 seconds by holding the ciphertext in the response only.

## Webhook forward

When enabled, each new capture is enqueued to the tenant endpoint after the row
commits: `POST`, body `{event, capture{id, kind, source, status, received_at,
fields}, link, service}`, `X-Signature: sha256=<hmac(secret, timestamp + raw
body)>`, `X-Timestamp`. Retries 8× exponential from 30s, then dead-letter and
notify. The secret is shown once at creation and rotatable with overlap.

The endpoint receives plaintext `fields` — that is the point of the integration —
so the webhook body is built after decrypt, on the data plane, from the consumer.

## Where the vault lives

Vault routes are control-plane routes (`/s/:serviceId/vault`), but passcode
verification and decryption are data-plane calls. This is the one deliberate
crack in the plane boundary: the control plane may not hold key material, so it
proxies to the Worker. Documented in `arch/security.md`; the proxy forwards only
the vault session cookie and never a platform session.

## Admin blindness

Admin `/admin/services/:id` shows: counters, gate mode, cap, source mix,
statuses, timestamps, and raw encrypted envelopes. No plaintext, no passcode.
Admin cannot export a tenant's vault. INV-SEC-01.

Last reviewed: 2026-11-20
