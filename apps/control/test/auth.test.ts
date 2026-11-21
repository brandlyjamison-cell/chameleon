import { describe, expect, it } from "vitest";
import { admin } from "../../../packages/db/test/helpers";
import {
  PASSWORD,
  activate,
  agent,
  createService,
  signUp,
  verify,
  type SignedUp,
} from "./harness";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

function sessionCookie(response: Response): string {
  return response.headers.getSetCookie().find((c) => c.includes("session_token")) ?? "";
}

describe.skipIf(!hasDb)("signup (stage 3 acceptance 5)", () => {
  it("provisions an org and sets a hardened cookie", async () => {
    const s = await signUp();
    expect(s.response.status).toBe(303);
    expect(s.response.headers.get("location")).toBe("/welcome");

    const cookie = sessionCookie(s.response);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");

    const orgs = await admin.query("select count(*)::int as n from orgs");
    expect(orgs.rows[0].n).toBe(1);
    const members = await admin.query("select role from memberships where user_id = $1", [
      s.userId,
    ]);
    expect(members.rows).toEqual([{ role: "owner" }]);
  });

  it("stores no plaintext password and requires 10 characters", async () => {
    const s = await signUp();
    const account = await admin.query<{ password: string }>(
      'select password from auth_account where "userId" = $1',
      [s.userId],
    );
    expect(account.rows[0]?.password).toMatch(/^[a-f0-9]{32}:[a-f0-9]+$/);

    const jar = agent();
    const short = await jar.post("/api/signup", {
      name: "Short",
      orgName: "Short",
      email: `short-${Date.now()}@example.test`,
      password: "short",
    });
    expect(short.headers.get("location")).toContain("error=invalid_input");
  });
});

describe.skipIf(!hasDb)("activation (acceptance 1/2/3/7)", () => {
  it("lets an unverified owner create a service but not activate it", async () => {
    const s = await signUp();
    const id = await createService(s.jar);

    const detail = await s.jar.get(`/api/services/${id}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { status: string }).status).toBe("provisioning");

    const res = await activate(s.jar, id);
    expect(res.headers.get("location")).toContain("error=email_unverified");

    const row = await admin.query<{ status: string; activated_at: Date | null }>(
      "select status, activated_at from services where id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "provisioning", activated_at: null });
  });

  it("activates in one transaction and stays idempotent on resume", async () => {
    const s = await signUp();
    await verify(s.jar, s.email);
    const id = await createService(s.jar);

    const first = await activate(s.jar, id);
    expect(first.headers.get("location")).toBe(`/services/${id}?activated=1`);

    const row = await admin.query<{
      status: string;
      dek_wrapped: Buffer | null;
      passcode_hash: Buffer | null;
      passcode_salt: Buffer | null;
      token_secret: Buffer | null;
      activated_at: Date | null;
    }>(
      "select status, dek_wrapped, passcode_hash, passcode_salt, token_secret, activated_at from services where id = $1",
      [id],
    );
    const after = row.rows[0]!;
    expect(after.status).toBe("active");
    expect(after.activated_at).not.toBeNull();
    expect(after.dek_wrapped?.byteLength).toBe(40); // AES-KW of 32 bytes
    expect(after.passcode_salt?.byteLength).toBe(16);
    expect(after.passcode_hash?.toString("utf8")).not.toBe("vault passcode 9");
    expect(after.token_secret?.byteLength).toBe(32);

    // Re-run: no second wrap, no duplicate row.
    const again = await activate(s.jar, id);
    expect(again.headers.get("location")).toContain("activated=1");
    const second = await admin.query<{ dek_wrapped: Buffer }>(
      "select dek_wrapped from services where id = $1",
      [id],
    );
    expect(Buffer.compare(second.rows[0]!.dek_wrapped, after.dek_wrapped!)).toBe(0);
    const count = await admin.query(
      "select count(*)::int as n from services where org_id = $1",
      [s.orgId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("refuses a different passcode on resume", async () => {
    const s = await signUp();
    await verify(s.jar, s.email);
    const id = await createService(s.jar);
    await activate(s.jar, id);

    // Force it back to half-provisioned to exercise the resume branch.
    await admin.query(
      "update services set status = 'provisioning', activated_at = null where id = $1",
      [id],
    );
    const res = await activate(s.jar, id, {
      passcode: "another pass 9",
      gateMode: "always",
    });
    expect(res.headers.get("location")).toContain("error=passcode_mismatch");
  });

  it("never returns dek_wrapped from the API", async () => {
    const s = await signUp();
    await verify(s.jar, s.email);
    const id = await createService(s.jar);
    await activate(s.jar, id);

    const one = await (await s.jar.get(`/api/services/${id}`)).text();
    const list = await (await s.jar.get("/api/services")).text();
    expect(one).not.toContain("dek_wrapped");
    expect(list).not.toContain("dek_wrapped");
    expect(JSON.parse(one).id).toBe(id);
  });
});

describe.skipIf(!hasDb)("authorisation (acceptance 4/6)", () => {
  it("403s a member that is not the owner", async () => {
    const s = await signUp();
    const memberEmail = `member-${Date.now()}@example.test`;
    const jar = agent();
    await jar.post("/api/signup", {
      name: "Member",
      orgName: "Member org",
      email: memberEmail,
      password: PASSWORD,
    });
    const member = await admin.query<{ id: string }>(
      "select id from users where email = $1",
      [memberEmail],
    );
    // Move them into the owner's org as a plain member.
    await admin.query("delete from memberships where user_id = $1", [member.rows[0]!.id]);
    await admin.query(
      "insert into memberships (org_id, user_id, role) values ($1, $2, 'member')",
      [s.orgId, member.rows[0]!.id],
    );

    const res = await jar.post("/api/services", {
      serviceType: "chameleon",
      tier: "starter",
    });
    expect(res.headers.get("location")).toContain("error=owner_only");
  });

  it("404s another org's service on the API and the page", async () => {
    const a = await signUp();
    const id = await createService(a.jar);

    const b = await signUp(false);
    const api = await b.jar.get(`/api/services/${id}`);
    expect(api.status).toBe(404);
    const page = await b.jar.get(`/services/${id}`);
    expect(page.status).toBe(404);
  });
});

describe.skipIf(!hasDb)("session lifetime (acceptance 5)", () => {
  async function expire(
    s: SignedUp,
    column: "expiresAt" | "createdAt",
    interval: string,
  ) {
    await admin.query(
      `update auth_session set "${column}" = now() - interval '${interval}' where "userId" = $1`,
      [s.userId],
    );
  }

  it("rejects a session idle past 30 minutes", async () => {
    const s = await signUp();
    await expire(s, "expiresAt", "31 minutes");
    const res = await s.jar.get("/api/services");
    expect(res.status).toBe(401);
  });

  it("rejects a session older than 12 hours and deletes the row", async () => {
    const s = await signUp();
    await expire(s, "createdAt", "13 hours");
    const res = await s.jar.get("/api/services");
    expect(res.status).toBe(401);
    const left = await admin.query(
      'select count(*)::int as n from auth_session where "userId" = $1',
      [s.userId],
    );
    expect(left.rows[0].n).toBe(0);
  });
});
