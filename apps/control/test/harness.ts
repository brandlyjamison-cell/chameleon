import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

export async function createService(jar: Agent, tier = "starter"): Promise<string> {
  const res = await jar.post("/api/services", { serviceType: "chameleon", tier });
  const location = res.headers.get("location") ?? "";
  const id = location.split("/").pop() ?? "";
  if (!id)
    throw new Error(`no service id, status ${res.status}, body ${await res.text()}`);
  return id;
}

export async function activate(
  jar: Agent,
  id: string,
  body: Record<string, string> = { passcode: "vault passcode 9", gateMode: "always" },
): Promise<Response> {
  return jar.post(`/api/services/${id}/activate`, body);
}
