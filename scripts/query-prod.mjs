#!/usr/bin/env node
/**
 * One-off production read with one bind parameter: `node scripts/query-prod.mjs
 * '<sql with $1>' [param]`. Uses DATABASE_URL_ADMIN from `.env.prod`, verifies
 * the certificate, and prints rows as JSON. Handy for rehearsals and incident
 * checks where a shell-quoted literal gets unreadable.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(".env.prod", "utf8");
const url = env.match(/DATABASE_URL_ADMIN='([^']+)'/)?.[1];
if (!url) throw new Error("DATABASE_URL_ADMIN missing in .env.prod");

const sql = process.argv[2];
if (!sql) throw new Error("pass a SQL string");
const params = process.argv[3] === undefined ? [] : [process.argv[3]];

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true },
});
await client.connect();
try {
  const result = await client.query(sql, params);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
