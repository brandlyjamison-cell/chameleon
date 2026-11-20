# Credentials and access

What the human must provide, with the exact scope and the stage it blocks. Least
privilege: each item is the narrowest scope that works, and no personal account is
used where a service account can exist.

Nothing below is a shared password. Keys go into the agreed secret store, not chat.

## Now (stage 1)

### 1. GitHub

- A **private** repo `chameleon` under an org (not a personal account), with me as a
  write collaborator.
- Branch protection on `main`: 1 review, CI required, no force-push, linear history.
- Actions enabled with a budget cap of $20/mo.
- Why: every stage gate is a PR.
- Deferrable: no.

### 2. Secret store

- One vault (1Password/Bitwarden) shared with me, folders `prod`, `staging`,
  `vendor`. Every key below lands here.
- Why: secrets in chat are secrets in three places.

### 3. Local toolchain on the machine

- Node 22, pnpm 9 (corepack), Git identity, Docker Desktop **or** a WSL2 distro, and
  a working `git` credential helper.
- Why: `pnpm run ci` and local Miniflare need them. `pnpm` is currently absent on this
  Windows host.

## Stage 2-3

### 4. Neon

- One organisation, role **Admin** for setup, then a project-scoped **Developer**
  token for me.
- Projects `chameleon-dev`, `chameleon-staging`, `chameleon-prod` (free tier is fine
  for dev/staging; prod needs the paid compute tier).
- Why: schema, branches, PITR.
- Deferrable: prod project until stage 9; dev and staging now.

### 5. Cloudflare — account A (prod) and account B (staging)

- Account-level: **Workers**, **KV**, **R2**, **Queues**, **Durable Objects**,
  **Hyperdrive**, **Cloudflare for SaaS** (custom hostnames entitlement), **Browser
  Rendering**, **Secrets Store**.
- A scoped API token per environment: `Workers Scripts:Edit`, `Workers KV:Edit`,
  `R2:Edit`, `Queues:Edit`, `Cloudflare for SaaS:Edit`, `Zone:DNS:Edit` on the
  platform zone only. No global key.
- Why: the whole data plane.
- Deferrable: Browser Rendering until 6; CF for SaaS until 4; prod account until 9.

### 6. Platform domain

- One registrable domain for the platform (`app.`, `go.`, `assets.`, `links.`), on
  Cloudflare DNS, plus a wildcard for staging.
- Why: control host, data host, fallback origin.
- Deferrable: no.

### 7. VPS

- Ubuntu 24.04, 4 vCPU / 8GB, 80GB SSD, one region near the audience.
- SSH key-only, sudo for my key, and a **deploy user** with a systemd unit scope.
- Why: control plane and Postgres fallback.
- Deferrable: can start on a $12 box; the above is the launch size.

### 8. Transactional email

- One ESP account (Postmark or Resend), a dedicated sending subdomain, and a scoped
  API key with send-only permission.
- Why: verification, expiry warnings, receipts. A platform that cannot email cannot
  onboard or warn.
- Deferrable: no for stage 3.

## Stage 9-10

### 9. NowPayments

- Sandbox account now; production account with **API key** (invoice create + payment
  read) and the **IPN secret** at stage 9.
- Payout wallet address, and the account's 2FA confirmed by the human.
- Why: the only revenue path.
- Deferrable: sandbox at 9, live keys at launch.

### 10. Sentry

- Org, one project per plane per environment, DSNs, `event:write` token for uploads.
- Why: error truth.
- Deferrable: stage 10.

### 11. Axiom

- Dataset per environment, ingest token (`ingest`), query token (read-only) for me.
- Why: the observability contract depends on it.
- Deferrable: stage 10.

### 12. Status page

- One page (Instatus/BetterStack) with an API key, or a Cloudflare-hosted static page
  we control.
- Why: incident comms without a tenant mail-merge.
- Deferrable: stage 10.

## Access I do not need

- Registrar login (DNS API token is enough).
- Cloudflare global key.
- Any tenant's passcode.
- NowPayments payout signing (human holds it).
- Neon org owner (Developer is enough after setup).

## Rotation and ownership

- Every key is created under a service account or the org, never the human's
  personal account, so departure is survivable.
- `prod` keys are separate from `staging` values for every item (INV-SEC-08).
- I get a read-only vendor list in the secret store for audits; write access to prod
  keys stays with the human plus one break-glass copy.

Last reviewed: 2026-11-20
