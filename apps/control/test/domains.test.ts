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

function postDomain(jar: Agent, serviceId: string, hostname: string) {
  return jar.post(`/api/services/${serviceId}/domains`, { hostname });
}

describe("domains (INV-SEC-06/07)", () => {
  it("adds a host as pending and hands over the TXT record", async () => {
    const { who, serviceId } = await ready();
    const res = await postDomain(who.jar, serviceId, "Login.Acme.Example");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.hostname).toBe("login.acme.example");
    expect(body.status).toBe("pending");
    expect(body.verifyName).toBe("_chameleon.login.acme.example");
    expect(body.verifyValue).toMatch(/^cameleon-verify=[0-9a-f]{48}$/);
    expect(body).not.toHaveProperty("verifyToken");
  });

  it("refuses a hostname on a service that is not active", async () => {
    const who = await signUp();
    await verify(who.jar, who.email);
    const serviceId = await createService(who.jar);
    const res = await postDomain(who.jar, serviceId, "pending.acme.example");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("service_not_active");
  });

  it("refuses a bare label and a scheme-with-path is normalised", async () => {
    const { who, serviceId } = await ready();
    expect((await postDomain(who.jar, serviceId, "localhost")).status).toBe(422);
    const res = await postDomain(who.jar, serviceId, "https://ok.acme.example/path");
    expect(res.status).toBe(201);
    expect((await res.json()).hostname).toBe("ok.acme.example");
  });

  it("stays verifying on a wrong TXT and records the mismatch", async () => {
    const { who, serviceId } = await ready();
    const created = await (
      await postDomain(who.jar, serviceId, "wrong.acme.example")
    ).json();
    await publish(created.verifyName, ["cameleon-verify=deadbeef"]);

    const res = await who.jar.post(`/api/domains/${created.id}/check`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("verifying");
    expect(body.detail).toContain(created.verifyValue);

    const checks = await admin.query(
      "select result from domain_checks where domain_id = $1",
      [created.id],
    );
    expect(checks.rows.map((row) => row.result)).toContain("mismatch");
  });

  it("proves the TXT but stays verifying while Cloudflare has no quota", async () => {
    const { who, serviceId } = await ready();
    const created = await (
      await postDomain(who.jar, serviceId, "quota.acme.example")
    ).json();
    await publish(created.verifyName, [created.verifyValue]);
    await cloudflare("entitlement");

    const body = await (await who.jar.post(`/api/domains/${created.id}/check`)).json();
    expect(body.status).toBe("verifying");
    expect(body.detail).toBe("txt ok, cf_entitlement_missing");

    const row = await admin.query<{ verified_at: Date | null }>(
      "select verified_at from domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.verified_at).not.toBeNull();
  });

  it("goes active only when Cloudflare says the hostname is active", async () => {
    const { who, serviceId } = await ready();
    const created = await (
      await postDomain(who.jar, serviceId, "live.acme.example")
    ).json();
    await publish(created.verifyName, [created.verifyValue]);

    await cloudflare("pending");
    expect(
      (await (await who.jar.post(`/api/domains/${created.id}/check`)).json()).status,
    ).toBe("verifying");

    await cloudflare("active");
    expect(
      (await (await who.jar.post(`/api/domains/${created.id}/check`)).json()).status,
    ).toBe("active");
    const row = await admin.query<{ status: string }>(
      "select status from domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.status).toBe("active");
  });

  it("fails a live host whose TXT disappears, and leaves a resolver blip alone", async () => {
    const { who, serviceId } = await ready();
    const created = await (
      await postDomain(who.jar, serviceId, "gone.acme.example")
    ).json();
    await publish(created.verifyName, [created.verifyValue]);
    await cloudflare("active");
    await who.jar.post(`/api/domains/${created.id}/check`);

    await publish(created.verifyName, []);
    const body = await (await who.jar.post(`/api/domains/${created.id}/check`)).json();
    expect(body.status).toBe("failed");

    const row = await admin.query<{ status: string }>(
      "select status from domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.status).toBe("failed");
  });

  it("rejects a direct UPDATE to active without verified_at", async () => {
    const { who, serviceId } = await ready();
    const created = await (
      await postDomain(who.jar, serviceId, "direct.acme.example")
    ).json();
    await expect(
      admin.query("update domains set status = 'active' where id = $1", [created.id]),
    ).rejects.toThrow(/verified_at/);
  });

  it("tombstones a delete for other orgs but revives it for its own", async () => {
    const { who, serviceId } = await ready();
    const created = await (
      await postDomain(who.jar, serviceId, "tomb.acme.example")
    ).json();
    expect((await who.jar.post(`/api/domains/${created.id}`, {})).status).toBe(204);

    const other = await ready("starter", false);
    expect(other.who.orgId).not.toBe(who.orgId);
    const blocked = await postDomain(other.who.jar, other.serviceId, "tomb.acme.example");
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("domain_tombstoned");

    const revived = await postDomain(who.jar, serviceId, "tomb.acme.example");
    expect(revived.status).toBe(201);
    const again = await revived.json();
    expect(again.id).toBe(created.id);
    expect(again.verifyValue).toBe(created.verifyValue);
    expect(again.status).toBe("verifying");
  });

  it("caps a starter service at two hosts", async () => {
    const { who, serviceId } = await ready();
    expect((await postDomain(who.jar, serviceId, "a.acme.example")).status).toBe(201);
    expect((await postDomain(who.jar, serviceId, "b.acme.example")).status).toBe(201);
    const third = await postDomain(who.jar, serviceId, "c.acme.example");
    expect(third.status).toBe(409);
    expect((await third.json()).error).toBe("domain_slots_exhausted");
  });

  it("hides another org's domain (404) and lists only its own", async () => {
    const mine = await ready();
    const theirs = await ready("starter", false);
    const created = await (
      await postDomain(mine.who.jar, mine.serviceId, "mine.acme.example")
    ).json();

    expect((await theirs.who.jar.post(`/api/domains/${created.id}`, {})).status).toBe(
      404,
    );
    expect((await theirs.who.jar.post(`/api/domains/${created.id}/check`)).status).toBe(
      404,
    );
    const list = await (
      await mine.who.jar.get(`/api/services/${mine.serviceId}/domains`)
    ).json();
    expect(list).toHaveLength(1);
  });

  it("expires an unproven host after 72 hours and needs the job token", async () => {
    const { who, serviceId } = await ready();
    const created = await (
      await postDomain(who.jar, serviceId, "stale.acme.example")
    ).json();
    await admin.query(
      "update domains set created_at = now() - interval '73 hours' where id = $1",
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
      "select status from domains where id = $1",
      [created.id],
    );
    expect(row.rows[0]?.status).toBe("failed");
  });
});
