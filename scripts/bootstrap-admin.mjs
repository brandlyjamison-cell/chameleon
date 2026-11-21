#!/usr/bin/env node
/** Flips `users.is_admin` for every address in ADMIN_EMAILS. Idempotent. */
import pg from "pg";

const url = process.env.BOOTSTRAP_DB_URL;
if (!url) throw new Error("BOOTSTRAP_DB_URL is required");

const emails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (emails.length === 0) {
  console.log("  (no ADMIN_EMAILS set)");
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const email of emails) {
    const { rowCount } = await client.query("select admin_set_by_email($1)", [email]);
    console.log(`  ${email}: ${rowCount ? "ok" : "no match"}`);
  }
} finally {
  await client.end();
}
