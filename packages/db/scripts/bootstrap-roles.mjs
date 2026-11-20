#!/usr/bin/env node
/**
 * One-shot role bootstrap against a Neon branch. Idempotent for role existence;
 * credentials are rewritten to .env.db each run.
 *
 * Usage: node --env-file=../../.env scripts/bootstrap-roles.mjs <owner-uri> <label>
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";

const [, , ownerUri, label] = process.argv;
if (!ownerUri || !label) throw new Error("usage: bootstrap-roles <owner-uri> <label>");

const ROLES = [
  ["app_migrator", false],
  ["app_rw", false],
  ["edge_ro", false],
  ["app_admin", true],
];
const passwords = new Map(
  ROLES.map(([role]) => [role, randomBytes(24).toString("base64url")]),
);

const owner = new pg.Client({ connectionString: ownerUri });
await owner.connect();
for (const [role, bypass] of ROLES) {
  const { rowCount } = await owner.query("select 1 from pg_roles where rolname = $1", [
    role,
  ]);
  if (rowCount === 0) {
    await owner.query(`create role ${role} login password '${passwords.get(role)}'`);
  } else {
    await owner.query(`alter role ${role} password '${passwords.get(role)}'`);
  }
  if (bypass) await owner.query(`alter role ${role} bypassrls`);
}
await owner.query(
  "grant connect on database neondb to app_migrator, app_rw, edge_ro, app_admin",
);
await owner.query("grant create on database neondb to app_migrator");
await owner.query("grant app_admin to app_migrator");
await owner.query("grant create, usage on schema public to app_migrator, app_admin");
await owner.query("grant usage on schema public to app_rw, edge_ro, app_admin");
await owner.end();

const urlFor = (role) => {
  const u = new URL(ownerUri);
  u.username = role;
  u.password = passwords.get(role);
  return u.toString();
};

// Default privileges must be set by the role that will own the objects.
const migrator = new pg.Client({ connectionString: urlFor("app_migrator") });
await migrator.connect();
for (const [role, verbs] of [
  ["app_rw", "select, insert, update, delete"],
  ["edge_ro", "select"],
  ["app_admin", "select, insert, update, delete"],
]) {
  await migrator.query(
    `alter default privileges in schema public grant ${verbs} on tables to ${role}`,
  );
  await migrator.query(
    `alter default privileges in schema public grant usage, select on sequences to ${role}`,
  );
}
await migrator.end();

const keys = {
  app_migrator: "DATABASE_URL_MIGRATOR",
  app_rw: "DATABASE_URL_APP_RW",
  edge_ro: "DATABASE_URL_EDGE_RO",
  app_admin: "DATABASE_URL_ADMIN",
};
const lines = ROLES.map(([role]) => `${keys[role]}='${urlFor(role)}'`);
if (label === "dev") {
  lines.push(`DATABASE_URL_TEST='${urlFor("app_migrator")}'`);
  lines.push(`DATABASE_URL_DEV_OWNER='${ownerUri}'`);
}
writeFileSync(new URL("../../../.env.db", import.meta.url), `${lines.join("\n")}\n`);
process.stdout.write(`roles ready (${label})\n`);
