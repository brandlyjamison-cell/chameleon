#!/usr/bin/env node
/**
 * Forward-only migration runner. One transaction per file, recorded in
 * _migrations. `--reset` drops and rebuilds the public schema (test/dev only).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "migrations");
const reset = process.argv.includes("--reset");
const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL_TEST;

if (!url) throw new Error("DATABASE_URL_MIGRATOR or DATABASE_URL_TEST required");

const client = new pg.Client({ connectionString: url });
await client.connect();

if (reset) {
  const ownerUrl = process.env.DATABASE_URL_DEV_OWNER;
  if (!ownerUrl) throw new Error("--reset needs DATABASE_URL_DEV_OWNER");
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("drop schema public cascade");
  await owner.query("create schema public");
  await owner.query("grant create, usage on schema public to app_migrator, app_admin");
  await owner.query("grant usage on schema public to app_rw, edge_ro, app_admin");
  await owner.end();
}

await client.query(`create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`);

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const file of files) {
  const { rowCount } = await client.query("select 1 from _migrations where name = $1", [
    file,
  ]);
  if (rowCount > 0) continue;
  const sql = readFileSync(join(dir, file), "utf8");
  process.stdout.write(`apply ${file}\n`);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migrations (name) values ($1)", [file]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    process.stderr.write(`FAILED ${file}: ${error.message}\n`);
    process.exit(1);
  }
}
await client.end();
process.stdout.write("migrations up to date\n");
