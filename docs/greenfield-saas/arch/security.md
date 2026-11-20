# Security

Assets in order of value: capture plaintext, tenant domains, tenant accounts,
platform availability.

## Threat model

| Adversary                  | Wants                         | Entry                            |
| -------------------------- | ----------------------------- | -------------------------------- |
| Curious tenant             | another tenant's captures     | IDOR, vault proxy, export        |
| Tenant who read the source | free service, forged captures | client-side trust, unsigned POST |
| Scanner/security vendor    | fingerprint us                | markers, headers, 404 shape      |
| Network attacker           | credentials in flight         | TLS only end to end              |
| Stolen staff laptop        | everything                    | admin routes, DB creds           |
| Cloudflare insider         | rows, not keys                | KV/R2/DB                         |
| Leaked link token holder   | replay a capture              | token scope, dedupe              |

Non-adversaries: the victim (has no account), the mail provider.

## Admin blindness (INV-SEC-01)

Admin is a cross-tenant DB role with `BYPASSRLS`. That is deliberate: support has
to see rows. What admin does not have is keys.

- KEK lives in Cloudflare Secrets Store, bound to `apps/edge` and
  `apps/pipeline` only. Admin routes run in `apps/control`, which has no binding.
- Capture plaintext therefore needs a DEK unwrap, which needs a passcode, which
  admin does not have.
- Admin shows envelope JSON, counts, statuses, and source mix. No "decrypt as
  admin" button in v1 `OPEN-SEC-01`.
- Admin materialises a vault only by asking the tenant for the passcode out of
  band, then using the normal vault path.

## Key hierarchy

```
Cloudflare Secrets Store
└── KEK (32B, AES-256-KW)                      rotation: yearly, versioned kid
    ├── wraps dek_wrapped when gate = off
    └── (never touches capture bodies directly)

service.passcode (tenant chosen)
└── PBKDF2-SHA-256(310k, 128b salt, 32B out) = PK
    └── wraps dek_wrapped when gate = always|remember_30d

service DEK (32B, AES-256-GCM)                 rotation: per-service, on demand
└── encrypts capture fields  (AAD binds link|capture|email_hash)
```

- DEK is generated at activation, never stored raw, and never leaves a Worker
  except inside a request.
- `dek_wrap_kind` records which key wraps it, so the read path knows what to
  unwrap without guessing. A mismatch is a hard error, not a fallback.
- Mode change rewrites `dek_wrap_kind` and the wrapped blob in one transaction.
- KEK rotation: decrypt-unwrap with old kid, rewrap with new, per service, batched;
  `kid` is stored on the row.
- DEK rotation: unwrap, re-encrypt rows in batches, swap; 250k rows is hours, so it
  is a job with a progress column and a read path that tries both `OPEN-SEC-02`.

Known limit: `off` means the platform can open the vault. That is the trade
stated at the mode switch.

## Platform auth

Better Auth: email + password (Argon2id), WebAuthn passkeys, email verification
before a service can activate, sessions as 32B tokens stored SHA-256, 30-min idle
/ 12-h absolute, rotation on privilege change. CSRF double-submit + `Origin`
check on every mutation. Admin needs passkey (second factor) beyond a password.

`OPEN-SEC-03`: single user per org at launch, or allow one invited member? The
brief excludes seats; the schema allows memberships, so the switch is product,
not schema.

## Tenant isolation

RLS (INV-DATA-01) is the backstop, repo discipline (INV-DATA-06/07) is the
primary. Both exist because RLS is one tested line away from a missing GUC, and
repo discipline is one fallible author away from a leaked row.

The vault proxy is the interesting seam: control plane → Worker. It forwards the
tenant session id in a header signed with a shared secret, plus the vault session
cookie. The Worker re-resolves `org_id` from the session row and re-checks
service ownership; it does not trust a `service_id` from the control plane alone.

## Link and capture integrity

- Slug alone is not authority; the signed token is (INV-SEC-04).
- Capture POST checks signature, service liveness, and IP rate limit before
  accepting.
- `kind`, `source`, `received_at`, `service_id` are server-set; a client can only
  ever supply `email`/`password`.
- Dedupe is server-side and per-service.

## Secrets

`wrangler secret` + Secrets Store; `.dev.vars` gitignored; one Cloudflare account
per environment (INV-SEC-08). DB roles are separate per plane: `app_rw` (RLS),
`app_admin`, `app_migrator`, `edge_ro` (select-only, RLS). No shared superuser.
SSH is key-only, no password auth, fail2ban, and the control host is behind
Cloudflare with a WAF allow-list for `/admin`.

## Supply chain

pnpm lockfile committed, `--frozen-lockfile` in CI, Renovate with a 3-day soak,
`pnpm audit --prod` blocking on high, no postinstall scripts outside an allow-list,
Dependabot alerts mirrored to Slack. Actions pinned by SHA.

## Logging hygiene

Never logged: passwords, session tokens, passcodes, full emails (only
`sha256(email)[:8]` and domain), full IPs (only /24 hash). Request bodies are not
logged. Error reports to Sentry scrub by key name allow-list.

## Render-side hardening

CSP as in `arch/system.md`, no external origins, `base-uri 'none'`,
`form-action 'self'`, `frame-ancestors 'none'`. The submit guard is the only JS and
is inlined with a hash, not `unsafe-inline` `OPEN-SEC-04` (inline wins for size;
needs a per-render hash).

## Known accepted risks

1. `off` gate = platform can read the vault.
2. Any holder of a live link URL can post a capture to it (no cookie binding).
3. Cloudflare terminates TLS and sees plaintext render HTML, never the vault.
4. The control plane is a single VPS: compromise means tenure-level DB access,
   not key access.
5. Profile crawling hits third-party sites with no contract; a brand can block us
   and we degrade to cPanel.

## Review triggers

Re-review this doc on: first aitm service, first enterprise-ish tenant, any admin
role beyond two people, any new subsystem that holds decrypted fields, or any
change to the key hierarchy.

Last reviewed: 2026-11-20
