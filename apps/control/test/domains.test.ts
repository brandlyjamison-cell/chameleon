import { describe, expect, it } from "vitest";
import { admin } from "../../../packages/db/test/helpers";
import {
  activate,
  createService,
  signUp,
  verify,
  type Agent,
  type SignedUp,
} from "./harness";

const UPSTREAM = "http://127.0.0.1:3199";

async function publish(name: string, records: string[]): Promise<void> {
  await fetch(`${UPSTREAM}/_txt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, records }),
  });
}

async function cloudflare(mode: "entitlement" | "pending" | "active"): Promise<void> {
  await fetch(`${UPSTREAM}/_cf`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

/** A signed-up, verified owner with one activated service. */
async function ready(
  tier = "starter",
  resetFirst = true,
): Promise<{ who: SignedUp; serviceId: string }> {
  const who = await signUp(resetFirst);
  await verify(who.jar, who.email);
  const serviceId = await createService(who.jar, tier);
  const res = await activate(who.jar, serviceId);
  expect(res.status).toBe(303);
  return { who, serviceId };
}

function postRoot(jar: Agent, root: string) {
  return jar.post("/api/domains", { root });
}

function postHostname(jar: Agent, serviceId: string, domainId: string, label: string) {
  return jar.post(`/api/services/${serviceId}/domains`, { domainId, label });
}

/** A root verified and routed, ready to carry hostnames. */
async function verifiedRoot(who: SignedUp): Promise<{ id: string; root: string }> {
  const root = `acme-${Math.random().toString(36).slice(2, 8)}.example`;
  const created = await (await postRoot(who.jar, root)).json();
  await publish(created.verifyName, [created.verifyValue]);
  await cloudflare("active");
  const res = await who.jar.post(`/api/domains/${created.id}/check`);
  expect((await res.json()).status).toBe("active");
  return { id: created.id, root };
}

describe("org domains (INV-SEC-06/07)", () => {
  it("adds a root as pending and hands over the ownership record", async () => {
    const { who } = await ready();
    const res = await postRoot(who.jar, "Acme.Example");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.root).toBe("acme.example");
    expect(body.status).toBe("pending");
    expect(body.verifyName).toBe("_chameleon.acme.example");
    expect(body.verifyValue).toMatch(/^cameleon-verify=[0-9a-f]{48}$/);
    expect(body).not.toHaveProperty("verifyToken");
  });

  it("refuses a subdomain and normalises a scheme-with-path", async () => {
    const { who } = await ready();
    expect((await postRoot(who.jar, "localhost")).status).toBe(422);

    const sub = await postRoot(who.jar, "login.acme.example");
    expect(sub.status).toBe(422);
    expect((await sub.json()).error).toBe("use_root_domain");

    const res = await postRoot(who.jar, "https://ok.acme.example/path");
    expect(res.status).toBe(201);
    expect((await res.json()).root).toBe("acme.example");
  });

  it("stays verifying on a wrong TXT and records the mismatch", async () => {
    const { who } = await ready();
    const created = await (await postRoot(who.jar, "wrong-acme.example")).json();
    await publish(created.verifyName, ["cameleon-verify=deadbeef"]);

    const res = await who.jar.post(`/api/domains/${created.id}/check`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("verifying");
    expect(body.detail).toContain(created.verifyValue);

    const checks = await admin.query(
      "select result from domain_checks where org_domain_id = $1",
      [created.id],
    );
    expect(checks.rows.map((row) => row.result)).toContain("mismatch");
  });

  it("proves the TXT but parks at routing while Cloudflare has no quota", async () => {
    const { who } = await ready();
    const created = await (await postRoot(who.jar, "quota-acme.example")).json();
    await publish(created.verifyName, [created.verifyValue]);
    await cloudflare("entitlement");

    const body = await (await who.jar.post(`/api/domains/${created.id}/check`)).json();
    expect(body.status).toBe("routing_waiting");
    expect(body.detail).toBe("txt ok, routing pending");

    const row = await admin.query<{ verified_at: Date | null }>(
      "select verified_at from org_domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.verified_at).not.toBeNull();
  });

  it("goes active only when Cloudflare says the wildcard is active", async () => {
    const { who } = await ready();
    const created = await (await postRoot(who.jar, "live-acme.example")).json();
    await publish(created.verifyName, [created.verifyValue]);

    await cloudflare("pending");
    expect(
      (await (await who.jar.post(`/api/domains/${created.id}/check`)).json()).status,
    ).toBe("routing_waiting");

    await cloudflare("active");
    expect(
      (await (await who.jar.post(`/api/domains/${created.id}/check`)).json()).status,
    ).toBe("active");
    const row = await admin.query<{ status: string }>(
      "select status from org_domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.status).toBe("active");
  });

  it("fails a live domain whose TXT disappears", async () => {
    const { who } = await ready();
    const created = await (await postRoot(who.jar, "gone-acme.example")).json();
    await publish(created.verifyName, [created.verifyValue]);
    await cloudflare("active");
    await who.jar.post(`/api/domains/${created.id}/check`);

    await publish(created.verifyName, []);
    const body = await (await who.jar.post(`/api/domains/${created.id}/check`)).json();
    expect(body.status).toBe("failed");

    const row = await admin.query<{ status: string }>(
      "select status from org_domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.status).toBe("failed");
  });

  it("rejects a direct UPDATE to active without verified_at", async () => {
    const { who } = await ready();
    const created = await (await postRoot(who.jar, "direct-acme.example")).json();
    await expect(
      admin.query("update org_domains set status = 'active' where id = $1", [created.id]),
    ).rejects.toThrow(/verified_at/);
  });

  it("tombstones a delete for other orgs but revives it for its own", async () => {
    const { who } = await ready();
    const created = await (await postRoot(who.jar, "tomb-acme.example")).json();
    expect((await who.jar.post(`/api/domains/${created.id}`, {})).status).toBe(204);

    const other = await ready("starter", false);
    expect(other.who.orgId).not.toBe(who.orgId);
    const blocked = await postRoot(other.who.jar, "tomb-acme.example");
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("domain_tombstoned");

    const revived = await postRoot(who.jar, "tomb-acme.example");
    expect(revived.status).toBe(201);
    const again = await revived.json();
    expect(again.id).toBe(created.id);
    expect(again.verifyValue).toBe(created.verifyValue);
    expect(again.status).toBe("verifying");
  });

  it("caps a starter service at two hostnames under one domain", async () => {
    const { who, serviceId } = await ready();
    const domain = await verifiedRoot(who);
    expect((await postHostname(who.jar, serviceId, domain.id, "a")).status).toBe(201);
    expect((await postHostname(who.jar, serviceId, domain.id, "b")).status).toBe(201);
    const third = await postHostname(who.jar, serviceId, domain.id, "c");
    expect(third.status).toBe(409);
    expect((await third.json()).error).toBe("hostname_slots_exhausted");
  });

  it("shares one verified domain across services without repeating DNS", async () => {
    const { who, serviceId } = await ready("pro");
    const domain = await verifiedRoot(who);
    expect((await postHostname(who.jar, serviceId, domain.id, "one")).status).toBe(201);

    const second = await createService(who.jar, "starter");
    const created = await postHostname(who.jar, second, domain.id, "two");
    expect(created.status).toBe(201);
    expect((await created.json()).fqdn).toBe(`two.${domain.root}`);
  });

  it("rejects a hostname on another org's domain", async () => {
    const mine = await ready();
    const theirs = await ready("starter", false);
    const domain = await verifiedRoot(mine.who);
    const res = await postHostname(
      theirs.who.jar,
      theirs.serviceId,
      domain.id,
      "foreign",
    );
    expect(res.status).toBe(404);
  });

  it("hides another org's domain (404) and lists only its own", async () => {
    const mine = await ready();
    const theirs = await ready("starter", false);
    const created = await (await postRoot(mine.who.jar, "private-acme.example")).json();

    expect((await theirs.who.jar.post(`/api/domains/${created.id}`, {})).status).toBe(
      404,
    );
    expect((await theirs.who.jar.post(`/api/domains/${created.id}/check`)).status).toBe(
      404,
    );
    const list = await (await mine.who.jar.get("/api/domains")).json();
    expect(list).toHaveLength(1);
  });

  it("expires an unproven domain after 72 hours and needs the job token", async () => {
    const { who } = await ready();
    const created = await (await postRoot(who.jar, "stale-acme.example")).json();
    await admin.query(
      "update org_domains set created_at = now() - interval '73 hours' where id = $1",
      [created.id],
    );

    const denied = await fetch("http://localhost:3100/api/jobs/domains", {
      method: "POST",
    });
    expect(denied.status).toBe(403);

    const res = await fetch("http://localhost:3100/api/jobs/domains", {
      method: "POST",
      headers: { "x-job-token": "test-job-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expired).toBeGreaterThanOrEqual(1);

    const row = await admin.query<{ status: string }>(
      "select status from org_domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.status).toBe("failed");
  });
});
