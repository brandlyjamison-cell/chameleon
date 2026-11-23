import { describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);
import { admin, appRw, reset, seed } from "./helpers";
import * as captures from "../src/repos/captures";
import * as links from "../src/repos/links";
import * as services from "../src/repos/services";
import * as domains from "../src/repos/domains";
import { CapError, NotFoundError, withTenant, type Ctx } from "../src/ctx";

const db = {
  get pool() {
    return appRw;
  },
};
const ctxOf = (s: { orgId: string; serviceId: string }): Ctx => ({
  orgId: s.orgId,
  userId: null,
  role: "owner",
  serviceId: s.serviceId,
});

async function insertCapture(
  s: Awaited<ReturnType<typeof seed>>,
  at: Date,
  email: string,
  source: "human" | "scanner" = "human",
) {
  return withTenant(db, ctxOf(s), (c) =>
    captures.consume(c, ctxOf(s), {
      id: crypto.randomUUID(),
      serviceId: s.serviceId,
      linkId: s.linkId,
      kind: "credential",
      fields: { v: 1, alg: "A256GCM", iv: "x", ct: "y" },
      emailHash: Buffer.from(email),
      source,
      receivedAt: at,
    }),
  );
}

describe.skipIf(!hasDb)("capture rules (INV-CAP-05/07/08/09)", () => {
  it("requires a source", async () => {
    await reset();
    const s = await seed();
    await expect(
      withTenant(db, ctxOf(s), (c) =>
        c.query(
          `insert into captures (id, org_id, service_id, link_id, kind, received_at)
           values ($1, $2, $3, $4, 'credential', now())`,
          [crypto.randomUUID(), s.orgId, s.serviceId, s.linkId],
        ),
      ),
    ).rejects.toThrow(/source/);
  });

  it("collapses a resubmit inside the 15-minute bucket", async () => {
    await reset();
    const s = await seed();
    const base = new Date("2026-11-20T10:02:00Z");
    expect((await insertCapture(s, base, "a@b.co")).inserted).toBe(true);
    expect(
      (await insertCapture(s, new Date("2026-11-20T10:09:00Z"), "a@b.co")).inserted,
    ).toBe(false);
    const later = await insertCapture(s, new Date("2026-11-20T10:16:00Z"), "a@b.co");
    expect(later.inserted).toBe(true);

    const suppressed = await admin.query("select count from captures_suppressed");
    expect(suppressed.rows[0].count).toBe(1);
  });

  it("prunes the oldest past the capture cap", async () => {
    await reset();
    const s = await seed();
    await admin.query("update tiers set capture_cap = 2 where id = 1");

    await insertCapture(s, new Date("2026-11-20T09:00:00Z"), "one@x.co");
    await insertCapture(s, new Date("2026-11-20T09:20:00Z"), "two@x.co");
    const third = await insertCapture(s, new Date("2026-11-20T09:40:00Z"), "three@x.co");
    expect(third.pruned).toBe(1);

    const { rows } = await admin.query("select count(*)::int as n from captures");
    expect(rows[0].n).toBe(2);
    const queue = await admin.query("select count(*)::int as n from prune_queue");
    expect(queue.rows[0].n).toBe(1);
    const oldest = await admin.query("select 1 from captures where email_hash = $1", [
      Buffer.from("one@x.co"),
    ]);
    expect(oldest.rowCount).toBe(0);
  });

  it("hides scanner rows from the vault by default", async () => {
    await reset();
    const s = await seed();
    await insertCapture(s, new Date("2026-11-20T09:00:00Z"), "h@x.co", "human");
    await insertCapture(s, new Date("2026-11-20T10:00:00Z"), "s@x.co", "scanner");
    const visible = await withTenant(db, ctxOf(s), (c) =>
      captures.listForService(c, s.serviceId),
    );
    expect(visible.map((r) => r.source)).toEqual(["human"]);
  });
});

describe.skipIf(!hasDb)("repos are tenant-scoped (INV-DATA-03/07)", () => {
  it("404s a foreign service", async () => {
    await reset();
    const s = await seed();
    await expect(
      withTenant(db, ctxOf(s), (c) => services.get(c, ctxOf(s), s.otherServiceId)),
    ).rejects.toThrow(NotFoundError);
  });

  it("404s a foreign link and domain", async () => {
    await reset();
    const s = await seed();
    await expect(
      withTenant(db, ctxOf(s), (c) => links.get(c, ctxOf(s), s.hostnameId)),
    ).rejects.toThrow(NotFoundError);
    await expect(
      withTenant(db, ctxOf(s), (c) => domains.getHostname(c, ctxOf(s), s.linkId)),
    ).rejects.toThrow(NotFoundError);
  });

  it("keeps lists to the caller's org", async () => {
    await reset();
    const s = await seed();
    const mine = await withTenant(db, ctxOf(s), (c) => services.list(c, ctxOf(s)));
    expect(mine.map((r) => r.org_id)).toEqual([s.orgId]);
  });
});

describe.skipIf(!hasDb)("minting (INV-DATA-05)", () => {
  it("throws CapError at the cap and creates nothing", async () => {
    await reset();
    const s = await seed();
    await admin.query("update tiers set link_cap = 1 where id = 1");
    await admin.query("delete from links where service_id = $1", [s.serviceId]);
    await withTenant(db, ctxOf(s), (c) =>
      links.mint(c, ctxOf(s), { serviceId: s.serviceId, hostnameId: s.hostnameId }),
    );
    await expect(
      withTenant(db, ctxOf(s), (c) =>
        links.mint(c, ctxOf(s), { serviceId: s.serviceId, hostnameId: s.hostnameId }),
      ),
    ).rejects.toThrow(CapError);
    const { rows } = await admin.query("select count(*)::int as n from links");
    expect(rows[0].n).toBe(1);
  });

  it("refuses a hostname from another service", async () => {
    await reset();
    const s = await seed();
    const other = await admin.query(
      `insert into org_domains (org_id, root, status, verified_at, verified_by)
       values ($1, 'other.example.test', 'active', now(), 'txt') returning id`,
      [s.otherOrgId],
    );
    const host = await admin.query(
      `insert into hostnames (org_id, domain_id, service_id, fqdn, label, verify_token, status, verified_at)
       values ($1, $2, $3, 'x.other.example.test', 'x', 't', 'active', now()) returning id`,
      [s.otherOrgId, other.rows[0].id, s.otherServiceId],
    );
    await expect(
      withTenant(db, ctxOf(s), (c) =>
        links.mint(c, ctxOf(s), { serviceId: s.serviceId, hostnameId: host.rows[0].id }),
      ),
    ).rejects.toThrow(/does not belong/);
  });
});

describe.skipIf(!hasDb)("org domains and hostnames (INV-SEC-06/07)", () => {
  it("cannot be activated without verification", async () => {
    await reset();
    const s = await seed();
    const d = await admin.query(
      `insert into org_domains (org_id, root) values ($1, 'x.example.test') returning id`,
      [s.orgId],
    );
    await expect(
      admin.query("update org_domains set status = 'active' where id = $1", [
        d.rows[0].id,
      ]),
    ).rejects.toThrow(/verified_at/);
  });

  it("blocks another org by tombstone, allows its own revive", async () => {
    await reset();
    const s = await seed();
    await admin.query(
      `insert into org_domains (org_id, root, status, verified_at, verified_by, deleted_at, tombstoned_at)
       values ($1, 'dead.example.test', 'failed', now(), 'txt', now(), now())`,
      [s.orgId],
    );
    await expect(
      admin.query(
        `insert into org_domains (org_id, root) values ($1, 'DEAD.example.test')`,
        [s.orgId],
      ),
    ).resolves.toBeTruthy();
    await expect(
      admin.query(
        `insert into org_domains (org_id, root) values ($1, 'dead.example.test')`,
        [s.otherOrgId],
      ),
    ).rejects.toThrow(/tombstoned/);
  });

  it("enforces the hostname slot cap per service", async () => {
    await reset();
    const s = await seed();
    const ctx = ctxOf(s);
    const domain = await admin.query<{ id: string }>(
      `select domain_id as id from hostnames where id = $1`,
      [s.hostnameId],
    );
    const domainId = domain.rows[0]!.id;
    const cap = await admin.query<{ hostname_cap: number }>(
      `select t.hostname_cap from services s join tiers t on t.id = s.tier_id where s.id = $1`,
      [s.serviceId],
    );
    // The seed already uses one slot, so `cap - 1` more fit.
    for (let i = 1; i < cap.rows[0]!.hostname_cap; i += 1) {
      await withTenant(db, ctx, (c) =>
        domains.addHostname(c, ctx, {
          serviceId: s.serviceId,
          domainId,
          label: `h${i}`,
          fqdn: `h${i}.example.test`,
        }),
      );
    }
    await expect(
      withTenant(db, ctx, (c) =>
        domains.addHostname(c, ctx, {
          serviceId: s.serviceId,
          domainId,
          label: "over",
          fqdn: "over.example.test",
        }),
      ),
    ).rejects.toThrow(CapError);
  });
});
