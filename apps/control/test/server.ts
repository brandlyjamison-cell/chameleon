import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 3100;
const URL = `http://localhost:${PORT}`;
let child: ChildProcess | undefined;

async function waitForHealth(timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${URL}/api/health`);
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
  process.env.BETTER_AUTH_URL = URL;
  const sinkDir = resolve("apps/control/test/.tmp");
  mkdirSync(sinkDir, { recursive: true });
  const sink = resolve(sinkDir, "mail.ndjson");
  writeFileSync(sink, "");
  process.env.MAIL_SINK = sink;

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
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    child.kill("SIGTERM");
  }
}
