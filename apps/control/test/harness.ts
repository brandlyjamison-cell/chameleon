import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import { admin, reset } from "../../../packages/db/test/helpers";

export const BASE = process.env.SERVER_URL ?? "http://localhost:3100";

export interface Agent {
  cookies: string[];
  post(path: string, form?: Record<string, string>): Promise<Response>;
  get(path: string): Promise<Response>;
}

/** Minimal cookie jar; redirects are never followed automatically. */
export function agent(): Agent {
  const self: Agent = {
    cookies: [],
    async post(path, form = {}) {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: {
          cookie: self.cookies.join("; "),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form),
        redirect: "manual",
      });
      for (const cookie of res.headers.getSetCookie()) {
        const pair = cookie.split(";")[0] ?? "";
        const name = pair.split("=")[0] ?? "";
        self.cookies = self.cookies.filter((c) => !c.startsWith(`${name}=`));
        self.cookies.push(pair);
      }
      return res;
    },
    async get(path) {
      return fetch(`${BASE}${path}`, {
        headers: { cookie: self.cookies.join("; ") },
        redirect: "manual",
      });
    },
  };
  return self;
}

let seq = 0;
export function address(): string {
  seq += 1;
  return `owner${seq}-${Date.now()}@example.test`;
}

export const PASSWORD = "correct horse 42";

export interface SignedUp {
  jar: Agent;
  email: string;
  userId: string;
  orgId: string;
  response: Response;
}

export async function signUp(resetFirst = true): Promise<SignedUp> {
  if (resetFirst) await reset();
  const jar = agent();
  const email = address();
  const response = await jar.post("/api/signup", {
    name: "Owner",
    orgName: "Acme",
    email,
    password: PASSWORD,
  });
  if (response.status !== 303)
    throw new Error(`signup ${response.status}: ${await response.text()}`);
  const row = await admin.query<{ id: string }>("select id from users where email = $1", [
    email,
  ]);
  const membership = await admin.query<{ org_id: string }>(
    "select org_id from memberships where user_id = $1",
    [row.rows[0]?.id],
  );
  return {
    jar,
    email,
    userId: row.rows[0]?.id ?? "",
    orgId: membership.rows[0]?.org_id ?? "",
    response,
  };
}

/** The signed link the handler wrote to the sink file. */
export function verificationUrl(email: string): string {
  const file = process.env.MAIL_SINK ?? resolve("apps/control/test/.tmp/mail.ndjson");
  const line = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((row) => JSON.parse(row) as { to: string; url: string })
    .filter((row) => row.to === email)
    .pop();
  if (!line) throw new Error(`no verification mail for ${email}`);
  return line.url;
}

export async function verify(jar: Agent, email: string): Promise<Response> {
  const url = new URL(verificationUrl(email));
  return jar.get(`${url.pathname}${url.search}`);
}

/** A domain, a link and one capture, seeded under the bypassing role. */
export async function seedCapture(orgId: string, serviceId: string): Promise<string> {
  const root = `seed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.test`;
  const domain = await admin.query<{ id: string }>(
    `insert into org_domains (org_id, root, status, verified_at, verified_by)
     values ($1, $2, 'active', now(), 'txt') returning id`,
    [orgId, root],
  );
  const host = await admin.query<{ id: string }>(
    `insert into hostnames (org_id, domain_id, service_id, fqdn, label, verify_token, status, verified_at)
     values ($1, $2, $3, $4, 'login', 't', 'active', now()) returning id`,
    [orgId, domain.rows[0]!.id, serviceId, `login.${root}`],
  );
  const link = await admin.query<{ id: string }>(
    "insert into links (org_id, service_id, hostname_id, slug) values ($1, $2, $3, $4) returning id",
    [orgId, serviceId, host.rows[0]!.id, "ABCDE"],
  );
  const capture = await admin.query<{ id: string }>(
    `insert into captures (id, org_id, service_id, link_id, kind, fields, source, received_at)
     values (gen_random_uuid(), $1, $2, $3, 'credential', $4, 'human', now()) returning id`,
    [
      orgId,
      serviceId,
      link.rows[0]!.id,
      JSON.stringify({ username: "victim@x.test", password: "hunter2" }),
    ],
  );
  return capture.rows[0]!.id;
}

export async function createService(jar: Agent, tier = "starter"): Promise<string> {
  const name = `Svc ${Math.random().toString(36).slice(2, 8)}`;
  const res = await jar.post("/api/services", { serviceType: "chameleon", tier, name });
  const location = res.headers.get("location") ?? "";
  const id = location.split("/").pop() ?? "";
  if (!id)
    throw new Error(`no service id, status ${res.status}, body ${await res.text()}`);
  return id;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** Overrides what the stub payment endpoint will report for an invoice. */
export async function providerSays(
  paymentId: string,
  status: string | null,
  price?: number,
): Promise<void> {
  await fetch("http://127.0.0.1:3199/_payment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: paymentId, status, price }),
  });
}

/** Posts an IPN exactly as NowPayments signs it. */
export async function ipn(
  body: Record<string, unknown>,
  secret = "test-ipn",
): Promise<Response> {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha512", secret)
    .update(JSON.stringify(sortKeys(body)))
    .digest("hex");
  return fetch(`${BASE}/api/payments/ipn`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nowpayments-sig": signature },
    body: raw,
    redirect: "manual",
  });
}

/** Invoice bodies the stub received, in order (the stub lives in the setup process). */
export async function sentInvoices(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`http://127.0.0.1:3199/_invoices`);
  return (await res.json()) as Record<string, unknown>[];
}

/**
 * Runs the real checkout against the stub, then confirms the invoice over IPN.
 * Returns the checkout response so a test can assert on the redirect.
 */
export async function pay(jar: Agent, id: string): Promise<Response> {
  const res = await jar.post(`/api/services/${id}/checkout`);
  if (res.status !== 303) throw new Error(`checkout ${res.status}: ${await res.text()}`);
  const row = await admin.query<{ provider_payment_id: string }>(
    "select provider_payment_id from payments where service_id = $1 order by created_at desc limit 1",
    [id],
  );
  const provider = row.rows[0]?.provider_payment_id;
  if (!provider) throw new Error("checkout stored no provider id");
  const n = provider.split("_").pop();
  const confirmed = await ipn({
    payment_status: "finished",
    invoice_id: provider,
    payment_id: `pay_inv_${n}`,
  });
  if (!confirmed.ok)
    throw new Error(`ipn ${confirmed.status}: ${await confirmed.text()}`);
  return res;
}

export async function activate(
  jar: Agent,
  id: string,
  body: Record<string, string> = { passcode: "4821", gateMode: "always" },
  options: { pay?: boolean } = {},
): Promise<Response> {
  if (options.pay !== false) await pay(jar, id);
  return jar.post(`/api/services/${id}/activate`, body);
}
