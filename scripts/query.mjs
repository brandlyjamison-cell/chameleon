#!/usr/bin/env node
/** One-off prod read: node scripts/query.mjs '<sql>' — uses DATABASE_URL_ADMIN. */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(".env.prod", "utf8");
const url = env.match(/DATABASE_URL_ADMIN='([^']+)'/)?.[1];
if (!url) throw new Error("DATABASE_URL_ADMIN missing in .env.prod");

const sql = process.argv[2];
if (!sql) throw new Error("pass a SQL string");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const result = await client.query(sql);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
