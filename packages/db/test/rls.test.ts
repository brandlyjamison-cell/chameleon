import { describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
import { appRw, reset, seed } from "./helpers.js";
import { withTenant, type Ctx } from "../src/ctx.js";

const db = {
  get pool() {
    return appRw;
  },
};
const ctxOf = (s: { orgId: string }): Ctx => ({
  orgId: s.orgId,
  userId: null,
  role: "owner",
});

describe.skipIf(!hasDb)("RLS (INV-DATA-01, INV-DATA-07)", () => {
  it("returns zero rows with no tenant GUC", async () => {
    await reset();
    await seed();
    const { rows } = await appRw.query("select count(*)::int as n from services");
    expect(rows[0].n).toBe(0);
  });

  it("hides another org's rows even with a correct where clause", async () => {
    await reset();
    const s = await seed();
    const rows = await withTenant(db, ctxOf(s), async (c) => {
      const res = await c.query("select id from services where id = $1", [
        s.otherServiceId,
      ]);
      return res.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("cannot update a foreign row", async () => {
    await reset();
    const s = await seed();
    const { foreign, mine } = await withTenant(db, ctxOf(s), async (c) => {
      const res = await c.query("update services set status = 'paused' where id = $1", [
        s.otherServiceId,
      ]);
      const own = await c.query("select status from services where id = $1", [
        s.serviceId,
      ]);
      return { foreign: res.rowCount, mine: own.rows.length };
    });
    expect(foreign).toBe(0);
    expect(mine).toBe(1);
  });

  it("rejects an insert carrying a foreign org_id", async () => {
    await reset();
    const s = await seed();
    await expect(
      withTenant(db, ctxOf(s), (c) =>
        c.query(
          `insert into services (org_id, service_type_id, tier_id) values ($1, 1, 1)`,
          [s.otherOrgId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
