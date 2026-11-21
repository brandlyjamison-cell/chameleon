import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { admin, migrator } from "./helpers";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!hasDb)("assert-rls (INV-DATA-01)", () => {
  it("passes on the real schema", () => {
    const res = spawnSync(process.execPath, ["packages/db/scripts/assert-rls.mjs"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("forced and policied");
  });

  it("keeps the cross-tenant job helpers with the bypassing role (INV-SEC-06)", async () => {
    const { rows } = await admin.query<{
      proname: string;
      owner: string;
      secdef: boolean;
    }>(
      `select p.proname, r.rolname as owner, p.prosecdef as secdef
       from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.proname in ('due_domain_checks', 'expire_stale_domains',
                           'live_domain_count', 'find_live_domain',
                           'find_domain_tombstone', 'assert_domain_not_tombstoned')`,
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.owner).toBe("app_admin");
      // `assert_domain_verified` is not cross-tenant, so only these six count.
      expect(row.secdef).toBe(true);
    }
  });

  it("fails on a tenant table with no policy", async () => {
    await admin.query(
      `create table if not exists rls_fixture (id uuid primary key default gen_random_uuid(), org_id uuid not null)`,
    );
    try {
      const res = spawnSync(process.execPath, ["packages/db/scripts/assert-rls.mjs"], {
        encoding: "utf8",
      });
      expect(res.status).toBe(1);
      expect(res.stdout).toContain("rls_fixture");
    } finally {
      await migrator.query("drop table if exists rls_fixture");
    }
  });
});
