import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { admin, migrator } from "./helpers.js";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!hasDb)("assert-rls (INV-DATA-01)", () => {
  it("passes on the real schema", () => {
    const res = spawnSync(process.execPath, ["packages/db/scripts/assert-rls.mjs"], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("forced and policied");
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
