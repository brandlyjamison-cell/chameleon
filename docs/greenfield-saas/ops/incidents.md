# Incidents

## Severity

| Sev | Definition | Response |
| --- | --- | --- |
| S1 | All links down; captures leaking across tenants; money state wrong in a way that grants free service | page immediately, all-hands, status page |
| S2 | One service or one region degraded; vault unreadable; billing webhooks failing | page on-call, hourly updates |
| S3 | Single tenant impact; profile generation down; export slow | next business hour, daily update |

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
