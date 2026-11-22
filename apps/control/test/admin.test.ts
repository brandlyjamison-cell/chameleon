import { describe, expect, it } from "vitest";
import { admin } from "../../../packages/db/test/helpers";
import { createService, signUp, verify, type SignedUp } from "./harness";

async function ready(): Promise<{ who: SignedUp; serviceId: string }> {
  const who = await signUp();
  await verify(who.jar, who.email);
  const serviceId = await createService(who.jar, "starter");
  return { who, serviceId };
}

async function asAdmin(who: SignedUp): Promise<void> {
  await admin.query("update users set is_admin = true where id = $1", [who.userId]);
}

describe("operator panel (ADR 0036)", () => {
  it("keeps a signed-in tenant out of the pages and the API", async () => {
    const { who, serviceId } = await ready();
    const page = await who.jar.get("/admin");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/dashboard");

    const api = await who.jar.postJson(`/api/admin/services/${serviceId}/status`, {
      status: "suspended",
    });
    expect(api.status).toBe(403);
    expect(((await api.json()) as { error: string }).error).toBe("admin_only");
  });

  it("lists and searches tenants by name and owner", async () => {
    const { who } = await ready();
    await asAdmin(who);
    const org = await admin.query<{ name: string }>(
      "select name from orgs where id = $1",
      [who.orgId],
    );
    const name = org.rows[0]!.name;

    const all = await who.jar.get("/admin");
    expect(all.status).toBe(200);

    const byName = await (
      await who.jar.get(`/admin?q=${encodeURIComponent(name)}`)
    ).text();
    expect(byName).toContain(name);

    const byOwner = await (
      await who.jar.get(`/admin?q=${encodeURIComponent(who.email)}`)
    ).text();
    expect(byOwner).toContain(who.email);

    const none = await (await who.jar.get("/admin?q=zzz-nobody")).text();
    expect(none).toContain("No tenant matches that.");
  });

  it("shows one tenant's whole account on its detail page", async () => {
    const { who, serviceId } = await ready();
    await asAdmin(who);
    await admin.query(
      `insert into org_domains (org_id, root, status, verified_at, verified_by)
       values ($1, 'acme-operator.example', 'active', now(), 'txt')`,
      [who.orgId],
    );
    const host = await admin.query<{ id: string }>(
      `insert into hostnames (org_id, domain_id, service_id, fqdn, label, verify_token, status)
       select $1, d.id, $2, 'login.acme-operator.example', 'login', 'tok', 'active'
       from org_domains d where d.org_id = $1 and d.root = 'acme-operator.example'
       returning id`,
      [who.orgId, serviceId],
    );
    expect(host.rowCount).toBe(1);

    const page = await who.jar.get(`/admin/tenants/${who.orgId}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(who.email);
    expect(html).toContain("acme-operator.example");
    expect(html).toContain("login.acme-operator.example");
    expect(html).toContain("Forwarding off");
  });

  it("404s an unknown tenant id", async () => {
    const { who } = await ready();
    await asAdmin(who);
    const page = await who.jar.get("/admin/tenants/00000000-0000-7000-8000-000000000000");
    expect(page.status).toBe(404);
  });

  it("comps days from the tenant page and records it", async () => {
    const { who, serviceId } = await ready();
    await asAdmin(who);
    await admin.query("update services set expires_at = now() where id = $1", [
      serviceId,
    ]);

    const before = await admin.query<{ paid_until: Date | null }>(
      "select paid_until from services where id = $1",
      [serviceId],
    );
    expect(before.rows[0]!.paid_until).toBeNull();

    const res = await who.jar.postJson(`/api/admin/services/${serviceId}/extend`, {
      days: 30,
    });
    expect(res.status).toBe(204);

    const after = await admin.query<{ paid_until: Date | null }>(
      "select paid_until from services where id = $1",
      [serviceId],
    );
    expect(after.rows[0]!.paid_until).not.toBeNull();
    const audit = await admin.query("select id from audit_log where target_id = $1", [
      serviceId,
    ]);
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
  });
});
