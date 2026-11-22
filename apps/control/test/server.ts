import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 3100;
const LOCAL = `http://localhost:${PORT}`;

/**
 * One stub for the two upstreams a domain check talks to: the DoH resolver and
 * the Cloudflare API. Deterministic, offline, and the test drives it over HTTP
 * because it lives in this process while tests run in a worker.
 */
const UPSTREAM = 3199;
const txt = new Map<string, string[]>();
let cfMode: "entitlement" | "pending" | "active" = "entitlement";
let upstream: Server | undefined;
export const invoices: Record<string, unknown>[] = [];
const paymentState = new Map<string, { status: string | null; price?: number }>();
let child: ChildProcess | undefined;

function startUpstream(): Promise<void> {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${UPSTREAM}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/dns-query") {
      const name = url.searchParams.get("name") ?? "";
      const answers = (txt.get(name) ?? []).map((data) => ({
        type: 16,
        data: `"${data}"`,
      }));
      return send(200, { Status: 0, Answer: answers });
    }
    if (url.pathname === "/_txt" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      return req.on("end", () => {
        const body = JSON.parse(raw) as { name: string; records: string[] };
        txt.set(body.name, body.records);
        send(200, { ok: true });
      });
    }
    if (url.pathname === "/_invoices") {
      return send(200, invoices);
    }
    if (url.pathname === "/_payment" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      return req.on("end", () => {
        const body = JSON.parse(raw) as {
          id: string;
          status: string | null;
          price?: number;
        };
        paymentState.set(
          body.id,
          body.price === undefined
            ? { status: body.status }
            : { status: body.status, price: body.price },
        );
        send(200, { ok: true });
      });
    }
    if (url.pathname.startsWith("/v1/payment/")) {
      const id = url.pathname.split("/").pop() ?? "";
      const state = paymentState.get(id);
      if (state?.status === null) return send(500, { message: "down" });
      const index = Number(id.split("_").pop()) - 1;
      const invoice = invoices[index] as { price_amount?: number } | undefined;
      return send(200, {
        payment_status: state?.status ?? "finished",
        price_amount: state?.price ?? invoice?.price_amount ?? 0,
      });
    }
    if (url.pathname === "/v1/invoice" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      return req.on("end", () => {
        invoices.push(JSON.parse(raw) as Record<string, unknown>);
        send(200, {
          id: `inv_${invoices.length}`,
          invoice_url: `http://127.0.0.1:${UPSTREAM}/pay/inv_${invoices.length}`,
        });
      });
    }
    if (url.pathname === "/_cf" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      return req.on("end", () => {
        cfMode = (JSON.parse(raw) as { mode: typeof cfMode }).mode;
        send(200, { ok: true });
      });
    }
    if (url.pathname.endsWith("/custom_hostnames") && req.method === "POST") {
      if (cfMode === "entitlement") {
        return send(200, {
          success: false,
          errors: [{ code: 1404, message: "no quota" }],
        });
      }
      return send(200, { success: true, result: { id: "ch_test", status: cfMode } });
    }
    if (url.pathname.endsWith("/custom_hostnames/ch_test")) {
      if (cfMode === "entitlement") {
        return send(200, {
          success: false,
          errors: [{ code: 1404, message: "no quota" }],
        });
      }
      return send(200, { success: true, result: { id: "ch_test", status: cfMode } });
    }
    send(404, { success: false, errors: [{ code: 7000, message: "no route" }] });
  });
  return new Promise((done) => upstream!.listen(UPSTREAM, "127.0.0.1", done));
}

async function waitForHealth(timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${LOCAL}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("control server did not come up");
}

export async function setup(): Promise<void> {
  for (const file of [".env", ".env.db"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // optional
    }
  }
  if (!process.env.DATABASE_URL_TEST) return; // db suites skip themselves
  process.env.DATABASE_URL ??= process.env.DATABASE_URL_APP_RW;
  process.env.BETTER_AUTH_SECRET ??= crypto.randomUUID().replace(/-/g, "");
  process.env.BETTER_AUTH_URL = LOCAL;
  const sinkDir = resolve("apps/control/test/.tmp");
  mkdirSync(sinkDir, { recursive: true });
  const sink = resolve(sinkDir, "mail.ndjson");
  writeFileSync(sink, "");
  process.env.MAIL_SINK = sink;
  // Keep the suite off Cloudflare: a real send is slow and rate-limited.
  delete process.env.CLOUDFLARE_EMAIL_API_TOKEN;
  process.env.MAIL_INLINE = "1";
  process.env.DNS_JSON_URL = `http://127.0.0.1:${UPSTREAM}/dns-query`;
  process.env.CF_API_BASE = `http://127.0.0.1:${UPSTREAM}/client/v4`;
  process.env.CLOUDFLARE_API_KEY = "test-token";
  process.env.CLOUDFLARE_ZONE_ID = "test-zone";
  process.env.JOBS_TOKEN = "test-job-token";
  process.env.NOWPAYMENTS_API_BASE = `http://127.0.0.1:${UPSTREAM}/v1`;
  process.env.NOWPAYMENTS_API_KEY = "test-key";
  process.env.NOWPAYMENTS_IPN_SECRET = "test-ipn";
  process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS ?? "operator@example.test";
  await startUpstream();

  child = spawn(
    process.execPath,
    [
      resolve("apps/control/node_modules/next/dist/bin/next"),
      "dev",
      "--port",
      String(PORT),
    ],
    {
      cwd: resolve("apps/control"),
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const tail: string[] = [];
  const remember = (chunk: Buffer) => {
    tail.push(chunk.toString());
    if (tail.length > 60) tail.shift();
  };
  child.stdout?.on("data", remember);
  child.stderr?.on("data", remember);
  (globalThis as { __tail?: string[] }).__tail = tail;
  child.on("error", (error) => tail.push(String(error)));
  try {
    await waitForHealth(120_000);
  } catch (error) {
    process.stderr.write(`
--- control log ---
${tail.join("")}
`);
    throw error;
  }
}

export async function teardown(): Promise<void> {
  const tail = (globalThis as { __tail?: string[] }).__tail;
  if (tail) {
    try {
      mkdirSync(resolve("apps/control/test/.tmp"), { recursive: true });
      writeFileSync(resolve("apps/control/test/.tmp/control.log"), tail.join(""));
    } catch {
      // best effort
    }
  }
  upstream?.close();
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
  }
}
