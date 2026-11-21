import { describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
import { admin, appRw, reset, seed, tenantClient } from "./helpers";

describe.skipIf(!hasDb)("slot counters (INV-DATA-04, INV-DATA-05)", () => {
  it("refuses a direct counter write from app_rw", async () => {
    await reset();
    const s = await seed();
    const c = await tenantClient(s.orgId);
    try {
      await expect(
        c.query("update services set link_slots_used = 99 where id = $1", [s.serviceId]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("counts inserts and soft deletes through the trigger", async () => {
    await reset();
    const s = await seed();
    await admin.query("update services set tier_id = 2 where id = $1", [s.serviceId]);
    await admin.query("delete from links where service_id = $1", [s.serviceId]);
    expect(
      (
        await admin.query("select link_slots_used from services where id = $1", [
          s.serviceId,
        ])
      ).rows[0].link_slots_used,
    ).toBe(0);

    await admin.query(
      `insert into links (org_id, service_id, domain_id, slug) values ($1, $2, $3, 'AAAAA')`,
      [s.orgId, s.serviceId, s.domainId],
    );
    expect(
      (
        await admin.query("select link_slots_used from services where id = $1", [
          s.serviceId,
        ])
      ).rows[0].link_slots_used,
    ).toBe(1);

    await admin.query("update links set deleted_at = now() where service_id = $1", [
      s.serviceId,
    ]);
    expect(
      (
        await admin.query("select link_slots_used from services where id = $1", [
          s.serviceId,
        ])
      ).rows[0].link_slots_used,
    ).toBe(0);
  });

  it("holds exactly at the cap under 30 concurrent mints", async () => {
    await reset();
    const s = await seed();
    await admin.query("update services set tier_id = 2 where id = $1", [s.serviceId]);
    await admin.query("delete from links where service_id = $1", [s.serviceId]);

    const results = await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        const c = await appRw.connect();
        try {
          await c.query("begin");
          await c.query("select set_config('app.org_id', $1, true)", [s.orgId]);
          const caps = await c.query(
            `select t.link_cap, s.link_slots_used from services s join tiers t on t.id = s.tier_id where s.id = $1 for update of s`,
            [s.serviceId],
          );
          const row = caps.rows[0];
          if (row.link_slots_used >= row.link_cap) {
            await c.query("commit");
            return false;
          }
          await c.query(
            `insert into links (org_id, service_id, domain_id, slug) values ($1, $2, $3, $4)`,
            [s.orgId, s.serviceId, s.domainId, `B${String(i).padStart(4, "0")}`],
          );
          await c.query("commit");
          return true;
        } finally {
          c.release();
        }
      }),
    );

    const { rows } = await admin.query(
      "select count(*)::int as n, (select link_slots_used from services where id = $1) as used from links where service_id = $1",
      [s.serviceId],
    );
    expect(rows[0].n).toBe(20);
    expect(rows[0].used).toBe(20);
    expect(results.filter(Boolean)).toHaveLength(20);
  });
});
