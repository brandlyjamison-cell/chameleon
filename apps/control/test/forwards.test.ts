import { describe, expect, it } from "vitest";
import { admin } from "../../../packages/db/test/helpers";
import {
  activate,
  createService,
  ipn,
  pay,
  seedCapture,
  signUp,
  verificationUrl,
  verify,
} from "./harness";

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

async function liveService() {
  const s = await signUp();
  await verify(s.jar, s.email);
  const id = await createService(s.jar);
  await pay(s.jar, id);
  await activate(s.jar, id, undefined, { pay: false });
  return { s, id };
}

describe.skipIf(!hasDb)("platform mail queue", () => {
  it("queues verification instead of sending inside the request", async () => {
    const s = await signUp();
    const row = await admin.query<{ kind: string; status: string; to_address: string }>(
      "select kind, status, to_address from email_queue order by id desc limit 1",
    );
    expect(row.rows[0]).toEqual({
      kind: "verify",
      status: "sent",
      to_address: s.email.toLowerCase(),
    });
    expect(verificationUrl(s.email)).toContain("/api/auth/verify-email");
  });

  it("sends a receipt when a payment confirms", async () => {
    const s = await signUp();
    await verify(s.jar, s.email);
    const id = await createService(s.jar);
    await pay(s.jar, id);

    const receipt = await admin.query<{
      kind: string;
      to_address: string;
      sent_at: Date;
    }>(
      "select kind, to_address, sent_at from email_queue where kind = 'receipt' order by id desc limit 1",
    );
    expect(receipt.rows[0]?.to_address).toBe(s.email.toLowerCase());
    expect(receipt.rows[0]?.sent_at).not.toBeNull();

    // A provider replay must not send a second receipt.
    const count = await admin.query<{ n: number }>(
      "select count(*)::int as n from email_queue where kind = 'receipt'",
    );
    const payment = await admin.query<{ provider_payment_id: string }>(
      "select provider_payment_id from payments where service_id = $1",
      [id],
    );
    await ipn({
      payment_status: "finished",
      invoice_id: payment.rows[0]!.provider_payment_id,
    });
    const after = await admin.query<{ n: number }>(
      "select count(*)::int as n from email_queue where kind = 'receipt'",
    );
    expect(after.rows[0]!.n).toBe(count.rows[0]!.n);
  });

  it("refuses the job without the token", async () => {
    const plain = await fetch("http://localhost:3100/api/jobs/mail", { method: "POST" });
    expect(plain.status).toBe(403);
    const withToken = await fetch("http://localhost:3100/api/jobs/mail", {
      method: "POST",
      headers: { "x-job-token": "test-job-token" },
    });
    expect(withToken.status).toBe(200);
    expect(await withToken.json()).toHaveProperty("sent");
  });
});

describe.skipIf(!hasDb)("capture forwarding", () => {
  it("treats the signup address as already proven", async () => {
    const { s, id } = await liveService();
    const res = await s.jar.post("/api/forwards", { email: s.email, serviceId: id });
    expect(res.headers.get("location")).toContain("forward_added=1");

    const row = await admin.query<{ status: string }>(
      "select status from forward_addresses where email = $1",
      [s.email.toLowerCase()],
    );
    expect(row.rows[0]?.status).toBe("verified");
  });

  it("makes an external address prove itself before receiving capture mail", async () => {
    const { s, id } = await liveService();
    const external = `desk-${Date.now()}@example.test`;

    const added = await s.jar.post("/api/forwards", { email: external, serviceId: id });
    expect(added.headers.get("location")).toContain("forward_added=1");
    const pending = await admin.query<{ id: string; status: string }>(
      "select id, status from forward_addresses where email = $1",
      [external],
    );
    expect(pending.rows[0]?.status).toBe("pending");

    await seedCapture(s.orgId, id);
    const blocked = await s.jar.post(`/api/services/${id}/forward`, {
      addressId: pending.rows[0]!.id,
    });
    expect(blocked.headers.get("location")).toContain("error=address_unverified");

    // The queue wrote a verification link; follow it like a mail client would.
    const url = new URL(verificationUrl(external));
    const verified = await s.jar.get(`${url.pathname}${url.search}`);
    expect(verified.headers.get("location")).toContain("forward=verified");
    const after = await admin.query<{ status: string }>(
      "select status from forward_addresses where email = $1",
      [external],
    );
    expect(after.rows[0]?.status).toBe("verified");

    const sent = await s.jar.post(`/api/services/${id}/forward`, {
      addressId: pending.rows[0]!.id,
    });
    expect(sent.headers.get("location")).toContain("forwarded=1");
    const mail = await admin.query<{ subject: string; text_body: string; sent_at: Date }>(
      "select subject, text_body, sent_at from email_queue where kind = 'forward' and to_address = $1 order by id desc limit 1",
      [external],
    );
    expect(mail.rows[0]?.subject).toContain("Capture");
    expect(mail.rows[0]?.text_body).toContain("hunter2");
    expect(mail.rows[0]?.sent_at).not.toBeNull();
  });

  it("caps forwarding addresses", async () => {
    const { s, id } = await liveService();
    for (let i = 0; i < 5; i += 1) {
      await s.jar.post("/api/forwards", {
        email: `f${i}-${Date.now()}@example.test`,
        serviceId: id,
      });
    }
    const res = await s.jar.post("/api/forwards", {
      email: `over-${Date.now()}@example.test`,
      serviceId: id,
    });
    expect(res.headers.get("location")).toContain("error=address_cap");
  });
});
