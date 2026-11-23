# Incidents

## Severity

| Sev | Definition                                                                                           | Response                                 |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| S1  | All links down; captures leaking across tenants; money state wrong in a way that grants free service | page immediately, all-hands, status page |
| S2  | One service or one region degraded; vault unreadable; billing webhooks failing                       | page on-call, hourly updates             |
| S3  | Single tenant impact; profile generation down; export slow                                           | next business hour, daily update         |

## Roles

- **IC** — drives, decides, does not type fixes.
- **Scribe** — timeline in `#incident`, timestamps UTC.
- **Comms** — status page and, if a tenant is affected, a direct email.
- **Fixer** — hands on keyboard.

One person may hold several roles below S2. The IC never also fixes on S1.

## Timeline format

```
13:04Z  IC      declared S1, links 404ing across hosts
13:06Z  Fixer   Axiom: 100% deny reason=ent after 13:02 deploy
13:09Z  IC      rollback authorised
```

## Specific playbooks

### Cross-tenant data visible (S1)

1. Freeze writes: revoke `app_rw` write grants (`alter role app_rw nologin` after
   drain) `OPEN-INC-01`.
2. Determine scope: which table, which GUC, which route. `assert-rls` on the
   current schema; check the route's `ctx`.
3. Confirm the leak with two seeded orgs; do not trust a single sample.
4. Fix, deploy, re-test, then notify affected tenants with concrete ranges —
   "captures between X and Y may have been visible" beats "some data".
5. Postmortem within 72 h; add an isolation test that fails on the old code.

### Captures leaking to a third party

Suspects, in order: webhook fan-out to a wrong endpoint, the vault proxy signed
header, a CSV with the wrong filter, Sentry serialising `fields`. Trace one
capture id end to end in Axiom.

### Links 404 everywhere (S1)

RB-01 and RB-05. If the cause is the `ent` flag, confirm whether Postgres or KV is
wrong before flipping anything; the sweeper is the repair, a manual flip is the
tourniquet.

### Billing grants free service

Stop the IPN endpoint (`return 503`) so retries buffer at NowPayments, fix, then
replay. Recompute affected services from payments, not from intuition.

### Domain hijack suspicion

Check `domains` for duplicate `lower(hostname)` incl. tombstones, and the CF
custom hostname owner. A tombstoned row must block re-claim; if it did not, it is
S1 for that domain.

### Key material exposure (KEK/DEK)

Rotation, in order: DEK for affected services (rewrap + re-encrypt), KEK if the
platform key is exposed. DEK rotation rewrites rows, so it is slow; announce it.
Passcodes are not rotated unless the wrap blobs leaked with them.

## Comms templates

- **First (S1, ≤ 15 min):** "We are investigating failed links on all domains.
  Captures are still being accepted where pages load. Next update in 30 min."
- **Tenant, data:** "Between HH:MM and HH:MM UTC, captures on your services may
  have been briefly visible to another tenant. We have the exact list and will
  send it within 24 h."
- **Resolution:** what broke, what we did, what changed, when it started and
  ended. No blame, no "human error" as the whole cause.

## Postmortem

Within 72 h for S1/S2. Blameless, but concrete: contributing factors, the detection
gap (why not earlier), the invariant that should have caught it, the test that now
does. Action items get owners and dates in the same doc; an action without an
owner is deleted.

## What we do not do

- No silent fixes: if a tenant could have noticed, they get told.
- No chasing a root cause before the bleeding stops on S1.
- No rotating keys mid-incident unless exposure is confirmed.
- No incident channel cleanup until the postmortem is merged.

Last reviewed: 2026-11-20

## INC-01 — control host dark (S1, open) — 2026-11-22 20:31Z

**Status:** open. Declared 2026-11-23 13:15Z by the incoming CTO after the fact;
the outage ran undetected for ~17 h because nothing pages on 522.

**Timeline (UTC, from Cloudflare edge logs and the workstation shell history):**

```
2026-11-22 20:24  last file write on the workstation (a scratch query helper, now
                  `scripts/query-prod.mjs`); no deploy running
2026-11-22 20:29  last assistant action in the build session
2026-11-22 20:31  first 522 on app.mailerdeaon.bid — origin unreachable
2026-11-22 20:40  Neon autosuspends the prod compute (no more connections)
2026-11-23 13:00  check-host.net from 8 countries: 522 on app/go/assets, all ~19.7 s
2026-11-23 13:06  /api/health unreachable; 25/22/23/25/443/80/587/465 all time out
2026-11-23 13:13  Cloudflare GraphQL: every status since 20:31 is 522; the only
                 200s are the 522 page's own /cdn-cgi assets
```

**Shape:** total loss of the VPS `65.98.5.195` (Verpex). Not an app error: ICMP,
SSH and every TCP port are dead from three independent networks, `assets.` and
`go.` are dead with `app.`, and the reverse DNS is a stranger's domain. The
control app cannot produce 522 on its own — 522 is Cloudflare failing to open
the TCP connection.

**What is safe:** Postgres is Neon, not the box. Production branch
`br-rough-glitter-bdto85ft` is healthy: 15 users, 15 orgs, 8 services, 3 links,
3 captures, 0 queued mail; schema at 0024 (the destructive 0025-0027 have **not**
run in prod). `/etc/chameleon/env` is rebuilt by `scripts/deploy.mjs`, so a
rebuilt host needs no secret restore — only the deploy public key.

**What is lost:** the release in `/srv/chameleon` and the journal. Nothing else
was on the box; the deploy is from git.

**Bleeding stopped?** No. Needs the Verpex client area (`clients.verpex.com`) to
see whether the VPS is stopped, suspended, or on a failed node, and to
reboot/console/reinstall.

**Recovery path:** panel → power/console. If the node or disk is gone, reinstall
Ubuntu 24.04 at the same IP, add `chameleon_deploy.pub`, run `ops/provision.sh`,
`node scripts/deploy.mjs`.

**Detection gap:** `chameleon-mail.timer`/`domains.timer` only run on the box, so
a dark box takes its own alarms with it. Action: external uptime probe on
`/api/health` (both planes), owned before this incident closes.
