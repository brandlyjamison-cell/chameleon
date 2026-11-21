#!/usr/bin/env node
/**
 * The local gate. There is no CI/CD by decision (ADR 0021): this runs from the
 * pre-commit and pre-push hooks, and by hand. A red gate is a blocked commit.
 *
 * Full runs every check. Fast is what a commit pays for.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

for (const file of [".env", ".env.db"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}

const isWindows = process.platform === "win32";
const binDir = resolve("node_modules", ".bin");
const bin = (name) => (isWindows ? `${binDir}\\${name}.cmd` : `${binDir}/${name}`);

const full = process.argv.includes("--full");
const fast = !full;

const hasDb = Boolean(process.env.DATABASE_URL_TEST);

const steps = [
  ["secrets", "node", ["scripts/check-secrets.mjs"], true],
  ["format", bin("prettier"), ["--check", "."], false],
  ["lint", bin("eslint"), ["."], true],
  ["boundaries", "node", ["scripts/check-boundaries.mjs"], false],
  ["no-client-resolution", "node", ["scripts/check-no-client-resolution.mjs"], false],
  ...(hasDb
    ? [
        ["migrate", "node", ["packages/db/scripts/migrate.mjs"], false],
        ["rls", "node", ["packages/db/scripts/assert-rls.mjs"], false],
      ]
    : [
        [
          "db",
          "node",
          ["-e", 'console.log("no DATABASE_URL_TEST, db steps skipped")'],
          true,
        ],
      ]),
  ["typecheck", bin("tsc"), ["-p", "tsconfig.json"], true],
  ["typecheck-control", bin("tsc"), ["-p", "apps/control/tsconfig.json"], true],
  ["test", bin("vitest"), ["run"], false],
];

let failed = 0;
const results = [];

for (const [name, cmd, args, runsWhenFast] of steps) {
  if (fast && !runsWhenFast) continue;
  process.stdout.write(`\n▸ ${name}\n`);
  const started = Date.now();
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: isWindows });
  const ms = Date.now() - started;
  if (res.status === 0) {
    results.push(`  ok    ${name} (${ms}ms)`);
  } else {
    failed += 1;
    results.push(`  FAIL  ${name} (${ms}ms)`);
  }
}

process.stdout.write(`\n${"-".repeat(48)}\n${results.join("\n")}\n`);
if (failed > 0) {
  process.stdout.write(`\n${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\ngate green\n");
