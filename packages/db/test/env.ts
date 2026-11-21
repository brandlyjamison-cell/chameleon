// Load local secrets for the db and control suites; missing files are fine.
import { randomBytes } from "node:crypto";

for (const file of [".env", ".env.db"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // ignore
  }
}

// The control server talks as `app_rw` (RLS); helpers use the migrator URL.
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_APP_RW) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_APP_RW;
}
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL ??= "http://localhost:3100";
