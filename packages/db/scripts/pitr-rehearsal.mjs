#!/usr/bin/env node
/**
 * Restore rehearsal (stage 2 acceptance). Branches the dev branch at a point in
 * time, counts rows on the branch, then deletes it. No production traffic.
 *
 * Needs NEON_API_KEY, NEON_PROJECT_ID and DATABASE_URL_TEST.
 */
import pg from "pg";

const key = process.env.NEON_API_KEY;
const project = process.env.NEON_PROJECT_ID;
if (!key || !project) throw new Error("NEON_API_KEY and NEON_PROJECT_ID required");

const api = (path, init) =>
  fetch(`https://console.neon.tech/api/v2/projects/${project}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

const source = new pg.Client({ connectionString: process.env.DATABASE_URL_TEST });
await source.connect();
const { rows } = await source.query("select count(*)::int as n from orgs");
const expected = rows[0].n;
const { rows: b } = await source.query(
  "select current_setting('neon.branch_id', true) as id",
);
await source.end();
if (expected === 0) throw new Error("orgs is empty; seed something first");

const branchId = b[0]?.id;
if (!branchId) throw new Error("could not read branch id");

const created = await api("/branches", {
  method: "POST",
  body: JSON.stringify({
    branch: {
      name: `pitr-${Date.now()}`,
      parent_id: branchId,
      parent_timestamp: new Date().toISOString(),
    },
    endpoints: [{ type: "read_only" }],
  }),
});
const body = await created.json();
if (!created.ok) throw new Error(`branch failed: ${JSON.stringify(body)}`);
const restoredId = body.branch.id;

const uriRes = await api(
  `/connection_uri?branch_id=${restoredId}&database_name=neondb&role_name=app_migrator&pooled=false`,
);
const uri = (await uriRes.json()).uri;

const restored = new pg.Client({ connectionString: uri });
await restored.connect();
const { rows: after } = await restored.query("select count(*)::int as n from orgs");
await restored.end();

await api(`/branches/${restoredId}`, { method: "DELETE" });

if (after[0].n !== expected) {
  throw new Error(`restore mismatch: expected ${expected}, got ${after[0].n}`);
}
process.stdout.write(`pitr rehearsal ok (${expected} orgs restored, branch deleted)\n`);
