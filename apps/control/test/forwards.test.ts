import { describe, expect, it } from "vitest";
import { admin, appRw } from "../../../packages/db/test/helpers";
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

  it("parks a throttled row instead of spending its tries", async () => {
    const created = await admin.query<{ id: string }>(
      "select enqueue_email(null, 'system', 'park@example.test', 's', 't', null) as id",
    );
    const id = created.rows[0]!.id;
    await admin.query("select claim_emails(100)");
    await admin.query("select finish_email($1, 'throttled', 'throttled by provider')", [
      id,
    ]);

    const row = await admin.query<{
      status: string;
      attempts: number;
      available_at: Date;
    }>("select status, attempts, available_at from email_queue where id = $1", [id]);
    expect(row.rows[0]?.status).toBe("queued");
    expect(row.rows[0]?.attempts).toBe(0);
    // The park path must name the throttle, not reuse the generic refusal text.
    const parked = await admin.query<{ last_error: string }>(
      "select coalesce(last_error, '') as last_error from email_queue where id = $1",
      [id],
    );
    expect(parked.rows[0]?.last_error).toBe("throttled by provider");
    const minutes = (row.rows[0]!.available_at.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(13);

    await admin.query("select requeue_email($1)", [id]);
    const due = await admin.query<{ available_at: Date }>(
      "select available_at from email_queue where id = $1",
      [id],
    );
    expect(due.rows[0]!.available_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("reads tenant tables with an empty app.org_id", async () => {
    // A pooled session can carry the GUC as ''; the policy nulls it instead of
    // casting '' to uuid and throwing.
    const res = await appRw.query<{ n: number }>(
      "select count(*)::int as n from email_queue",
    );
    expect(res.rows[0]?.n).toBeGreaterThanOrEqual(0);
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
