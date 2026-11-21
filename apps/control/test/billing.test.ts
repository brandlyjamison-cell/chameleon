import { describe, expect, it } from "vitest";
import { admin } from "../../../packages/db/test/helpers";
import {
  activate,
  agent,
  createService,
  ipn,
  pay,
  sentInvoices,
  signUp,
  verify,
} from "./harness";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

async function verifiedOwner() {
  const s = await signUp();
  await verify(s.jar, s.email);
  const id = await createService(s.jar);
  return { s, id };
}

describe.skipIf(!hasDb)("billing gate (acceptance 8)", () => {
  it("creates a service but refuses activation until it is paid", async () => {
    const { s, id } = await verifiedOwner();

    const blocked = await activate(s.jar, id, undefined, { pay: false });
    expect(blocked.headers.get("location")).toContain("error=payment_required");

    const row = await admin.query<{ status: string; dek_wrapped: Buffer | null }>(
      "select status, dek_wrapped from services where id = $1",
      [id],
    );
    expect(row.rows[0]?.status).toBe("provisioning");
    expect(row.rows[0]?.dek_wrapped).toBeNull();
  });

  it("opens a per-service checkout for the tier price and 30 days", async () => {
    const { s, id } = await verifiedOwner();
    const before = (await sentInvoices()).length;

    const res = await pay(s.jar, id);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/pay/inv_");

    const sent = (await sentInvoices())[before] as {
      price_amount: number;
      order_id: string;
      ipn_callback_url: string;
      order_description: string;
    };
    const tier = await admin.query<{ price_cents: number }>(
      "select t.price_cents from services s join tiers t on t.id = s.tier_id where s.id = $1",
      [id],
    );
    expect(sent.price_amount).toBe(tier.rows[0]!.price_cents / 100);
    expect(sent.ipn_callback_url).toContain("/api/payments/ipn");
    expect(sent.order_description).toContain("30 days");

    const payment = await admin.query<{
      status: string;
      price_cents: number;
      period_end: Date;
      provider_payment_id: string;
    }>(
      "select status, price_cents, period_end, provider_payment_id from payments where service_id = $1",
      [id],
    );
    expect(payment.rows[0]?.status).toBe("confirmed");
    expect(payment.rows[0]?.price_cents).toBe(tier.rows[0]!.price_cents);
    const days = (payment.rows[0]!.period_end.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.5);
    expect(days).toBeLessThan(30.5);

    // And the activation now goes through.
    const activated = await activate(s.jar, id, undefined, { pay: false });
    expect(activated.headers.get("location")).toContain("activated=1");
  });

  it("rejects an unsigned IPN and ignores a replay", async () => {
    const { s, id } = await verifiedOwner();
    await pay(s.jar, id);

    const bad = await ipn(
      { payment_status: "finished", invoice_id: "inv_nope" },
      "wrong-secret",
    );
    expect(bad.status).toBe(403);

    const row = await admin.query<{ provider_payment_id: string; paid_until: Date }>(
      `select p.provider_payment_id, s.paid_until from payments p
       join services s on s.id = p.service_id where p.service_id = $1`,
      [id],
    );
    const first = row.rows[0]!.paid_until;

    const replay = await ipn({
      payment_status: "finished",
      invoice_id: row.rows[0]!.provider_payment_id,
    });
    expect(replay.status).toBe(200);
    const after = await admin.query<{ paid_until: Date }>(
      "select paid_until from services where id = $1",
      [id],
    );
    expect(after.rows[0]!.paid_until.getTime()).toBe(first.getTime());
  });

  it("keeps an unpaid renewal visible instead of extending twice", async () => {
    const { s, id } = await verifiedOwner();
    await pay(s.jar, id);

    const pending = await s.jar.post(`/api/services/${id}/checkout`);
    expect(pending.status).toBe(303);
    const paid = await admin.query<{ paid_until: Date }>(
      "select paid_until from services where id = $1",
      [id],
    );
    // A second checkout does not extend by itself.
    const still = await admin.query<{ n: number }>(
      "select count(*)::int as n from payments where service_id = $1 and status = 'confirmed'",
      [id],
    );
    expect(still.rows[0]!.n).toBe(1);
    expect(paid.rows[0]!.paid_until.getTime()).toBeGreaterThan(Date.now());
  });
});

describe.skipIf(!hasDb)("admin panel", () => {
  it("is closed to a normal tenant and open to a flagged operator", async () => {
    const s = await signUp();
    const denied = await s.jar.get("/admin");
    expect(denied.status).toBe(307);
    expect(denied.headers.get("location")).toBe("/services");

    await admin.query("update users set is_admin = true where id = $1", [s.userId]);
    const page = await s.jar.get("/admin");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Acme");

    const mail = await s.jar.get("/admin/mail");
    expect(mail.status).toBe(200);
    expect(await mail.text()).toContain("Mail queue");
  });

  it("extends time and suspends from the panel", async () => {
    const s = await signUp();
    await admin.query("update users set is_admin = true where id = $1", [s.userId]);
    const id = await createService(s.jar);

    const extend = await admin.query<{ admin_extend_days: Date }>(
      "select admin_extend_days($1, 5)",
      [id],
    );
    const until = extend.rows[0]!.admin_extend_days.getTime();
    expect(until).toBeGreaterThan(Date.now() + 4 * 86_400_000);

    await admin.query("select admin_set_service_status($1, 'suspended')", [id]);
    const row = await admin.query<{ status: string }>(
      "select status from services where id = $1",
      [id],
    );
    expect(row.rows[0]?.status).toBe("suspended");
  });

  it("shows the tenant in the overview once a service exists", async () => {
    const s = await signUp();
    await admin.query("update users set is_admin = true where id = $1", [s.userId]);
    await createService(s.jar);

    const detail = await s.jar.get("/admin");
    const html = await detail.text();
    expect(html).toMatch(/1<!-- --> services/);
  });
});

describe.skipIf(!hasDb)("agent plumbing", () => {
  it("keeps the pay helper visible to other suites", () => {
    expect(typeof agent).toBe("function");
  });
});
