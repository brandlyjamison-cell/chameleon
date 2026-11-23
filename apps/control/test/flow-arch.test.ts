import { describe, expect, it } from "vitest";
import { admin } from "../../../packages/db/test/helpers";
import { createService, signUp, verify, type SignedUp } from "./harness";

async function ready(resetFirst = true): Promise<{ who: SignedUp; serviceId: string }> {
  const who = await signUp(resetFirst);
  await verify(who.jar, who.email);
  const serviceId = await createService(who.jar, "starter");
  return { who, serviceId };
}

/** A root the org owns and one live hostname under it. */
async function liveHost(who: SignedUp, serviceId: string, fqdn: string) {
  const root = fqdn.split(".").slice(-2).join(".");
  const domain = await admin.query<{ id: string }>(
    `insert into org_domains (org_id, root, verify_token, status, verified_at, verified_by)
     values ($1, $2, 'tok', 'active', now(), 'txt')
     on conflict (org_id, root) do update set root = excluded.root returning id`,
    [who.orgId, root],
  );
  const host = await admin.query<{ id: string }>(
    `insert into hostnames (org_id, domain_id, service_id, fqdn, label, verify_token, status, verified_at)
     values ($1, $2, $3, $4, 'login', 'tok', 'active', now()) returning id`,
    [who.orgId, domain.rows[0]!.id, serviceId, fqdn],
  );
  return { domainId: domain.rows[0]!.id, hostId: host.rows[0]!.id };
}

describe("directive scenarios", () => {
  it("holds a deleted hostname for 30 days and revives the same row", async () => {
    const { who, serviceId } = await ready();
    const host = await liveHost(who, serviceId, "login.acme-scope.test");
    const second = await createService(who.jar, "starter");

    const gone = await who.jar.post(`/api/hostnames/${host.hostId}`, {});
    expect(gone.status).toBe(204);

    // A different service in the same org may take the label back immediately.
    const revived = await who.jar.postJson(`/api/services/${second}/domains`, {
      domainId: host.domainId,
      label: "login",
    });
    expect(revived.status).toBe(201);
    const body = (await revived.json()) as { id: string; status: string };
    expect(body.id).toBe(host.hostId);
    expect(body.status).toBe("provisioning");

    const row = await admin.query<{ service_id: string; deleted_at: Date | null }>(
      "select service_id, deleted_at from hostnames where id = $1",
      [host.hostId],
    );
    expect(row.rows[0]!.service_id).toBe(second);
    expect(row.rows[0]!.deleted_at).toBeNull();
    const count = await admin.query("select id from hostnames where fqdn = $1", [
      "login.acme-scope.test",
    ]);
    expect(count.rowCount).toBe(1);
  });

  it("keeps a tombstoned domain from another org for 30 days", async () => {
    const mine = await ready();
    const host = await liveHost(mine.who, mine.serviceId, "login.acme-scope.test");
    await mine.who.jar.post(`/api/hostnames/${host.hostId}`, {});
    await mine.who.jar.post(`/api/domains/${host.domainId}`, {});

    const other = await ready(false);
    const blocked = await other.who.jar.postJson("/api/domains", {
      root: "acme-scope.test",
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toBe("domain_tombstoned");
  });

  it("leaves capture forwarding off until the tenant turns it on", async () => {
    const { who } = await ready();
    const row = await admin.query<{ notify_enabled: boolean }>(
      "select notify_enabled from orgs where id = $1",
      [who.orgId],
    );
    expect(row.rows[0]!.notify_enabled).toBe(false);

    const page = await who.jar.get("/settings/forwarding");
    const html = await page.text();
    expect(html).toContain("off");
    expect(html).not.toMatch(/checked/);
  });

  it("shows the unconfirmed pill, not a DNS state, for a new address", async () => {
    const { who } = await ready();
    const address = `desk-${Date.now()}@example.test`;
    await who.jar.post("/api/forwards", { email: address });
    const html = await (await who.jar.get("/settings/forwarding")).text();
    expect(html).toContain("Awaiting confirmation");
  });

  it("never asks a comped service to resume payment", async () => {
    const { who, serviceId } = await ready();
    await admin.query(
      `update services set activated_at = now(), status = 'active',
         paid_until = now() + interval '30 days' where id = $1`,
      [serviceId],
    );
    const comped = await (await who.jar.get(`/services/${serviceId}`)).text();
    expect(comped).not.toContain("Payment required");

    await admin.query(
      "update services set paid_until = now() - interval '1 day' where id = $1",
      [serviceId],
    );
    const lapsed = await (await who.jar.get(`/services/${serviceId}`)).text();
    expect(lapsed).toContain("Payment required");
  });

  it("keeps mail delivery out of the tenant rail and the operator rail out of the footer", async () => {
    const { who } = await ready();
    const html = await (await who.jar.get("/dashboard")).text();
    expect(html).toContain("Organization");
    expect(html).toContain("General");
    expect(html).toContain("Domains");
    expect(html).toContain("Forwarding");
    expect(html).toContain("Vault");
    expect(html).not.toContain("Mail delivery");
    expect(html).not.toContain("Operator panel");
  });

  it("gives the operator its own rail on every admin page", async () => {
    const { who } = await ready();
    await admin.query("update users set is_admin = true where id = $1", [who.userId]);
    for (const path of ["/admin", "/admin/mail", "/admin/audit"]) {
      const res = await who.jar.get(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html).toContain("Tenants");
      expect(html).toContain("Mail queue");
      expect(html).toContain("Audit log");
    }
  });
});
