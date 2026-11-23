# Migration strategy — 0025 to 0027

The schema under the directive is destructive in one direction: `domains` is
renamed to `hostnames`, its `hostname` column becomes `fqdn`, and links are
re-keyed from `domain_id` to `hostname_id`. Production has 15 users, 3 seeded
links and 3 captures, and every old row has `cf_hostname_id = null`. The plan is
a rehearsal, then one apply, then a review pass.

## 1. Rehearse on a branch of `production`

Neon branches are copy-on-write, so the rehearsal runs against real rows without
touching live traffic.

1. Create a branch from `production` (`neonctl branches create`), name it
   `rehearsal/0025`.
2. Point a shell at its `postgresql://` DSN via `DATABASE_URL_MIGRATOR` and run
   `node --env-file=.env.rehearsal packages/db/scripts/migrate.mjs`.
3. Assert, before the backfill is trusted:
   - `select count(*) from hostnames` equals the old `select count(*) from domains`
     with `deleted_at is null`;
   - `select count(*) from links where hostname_id is null` is 0;
   - `select count(*) from org_domains where review_needed` is the same as the
     number of roots whose parse could not be confirmed (see 3);
   - no org has two live roots with the same `lower(root)`;
   - `select assert_rls()` passes with the new `org_domains`, `hostnames` and
     `profile_assets` tables counted.
4. Rehearse 0026 and 0027 on the same branch, then load `/dashboard`, `/services`,
   `/settings/domains` and `/admin` against it with a dev server.
5. Drop the branch.

`derive_root` is the backfill heuristic (last two labels, three behind a known
suffix). Anything it cannot be sure about gets `review_needed = true`, which the
Domain detail page surfaces as "confirm the root". A wrong root is fixable by
removing and re-adding the domain; no link is lost because `hostnames.fqdn` keeps
the full address.

## 2. Apply

1. Take a Neon branch named `pre-0025-<date>` as the rollback point.
2. Deploy the control code and the migrations together: the code reads
   `hostnames`, so it cannot lag the schema.
3. Run `packages/db/scripts/assert-rls.mjs` immediately after.
4. Smoke, in this order: `/api/health`, a login, `/dashboard`, `/settings/domains`,
   one service page, `/admin` with the operator account.

## 3. Data checks on production after the apply

```
select count(*) from org_domains where review_needed;
select lower(root), count(*) from org_domains
  where deleted_at is null group by 1 having count(*) > 1;
select count(*) from links where hostname_id is null;
select count(*) from services where name is null;
```

Expected: review count is small and each row is openable; no duplicate roots; zero
hostname-less links; zero unnamed services.

## 4. Roll back

Code and schema move together, so a rollback is the pre-0025 branch plus the
previous image. Re-applying 0025 later replays the same backfill from `domains`,
which still exists on that branch. Nothing in 0026/0027 is needed to serve a
tenant: preview links and the admin detail page are additive and 0025 alone keeps
the console working.

## 5. Known gaps

- The dev database is empty between suites, so the backfill path itself was never
  exercised locally against real data. The rehearsal in step 1 is the only place
  it runs with rows; treat it as mandatory.
- Migration reads under forced RLS need `set role app_admin;` around manual
  queries (the migrator is not the owner and `app_admin` has `BYPASSRLS`).
- 0025 is applied in one transaction. If it fails halfway, nothing commits; fix
  the file and rerun.

## 6. Rehearsal result — 2026-11-23 (branch `br-odd-mud-bdj7we9t`)

First real run of the backfill, on a Neon branch cloned from production
(`br-rough-glitter-bdto85ft`, schema 0024, 15 users / 15 orgs / 8 services /
7 hostnames / 3 links). It failed twice and both failures were real migration
bugs, not data problems:

1. `update hostnames set label ...` and the status map ran as `app_migrator`
   with no `app.org_id`. RLS is forced on the table, so both matched **zero**
   rows; the status map then left `verifying` behind and the new check constraint
   rejected the table. Fixed: every row-level statement runs inside
   `set role app_admin` / `reset role`.
2. The old `domains_status_check` forbids `provisioning`/`waiting`, so the map
   had to drop it before updating, and re-add the new one after (DDL as the
   owner, data as `app_admin`).

After the fix the run is clean: roots derived without duplicates
(`flowallet.net` and `cameleon.flowallet.net` collapse to one root), 7/7
hostnames bound and labelled, 3/3 links re-keyed, 8/8 services named with a
preview key, `assert-rls` reports 21 forced tables. The dev suite never caught
either bug because its database is empty between runs — this is exactly why the
rehearsal is mandatory.
