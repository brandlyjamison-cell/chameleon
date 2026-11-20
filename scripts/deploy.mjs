#!/usr/bin/env node
/**
 * Manual deploy (ADR 0021). One unit, one environment, no pipeline.
 *
 *   node scripts/deploy.mjs edge staging --dry-run
 *   node scripts/deploy.mjs control production
 *
 * Real deploys are wired at the stage that first needs them; until then the run
 * prints the plan and exits non-zero so nobody thinks it shipped.
 */
import { spawnSync } from "node:child_process";

const [, , unit, env, ...flags] = process.argv;
const dry = flags.includes("--dry-run");
const units = ["control", "edge", "pipeline"];
const envs = ["staging", "production"];

if (!units.includes(unit) || !envs.includes(env)) {
  process.stdout.write(
    `usage: deploy <${units.join("|")}> <${envs.join("|")}> [--dry-run]\n`,
  );
  process.exit(1);
}

const steps = {
  control: [
    "pnpm run ci",
    "pnpm --filter @chameleon/control build",
    "rsync release to vps:/srv/chameleon/releases/<sha>",
    "run migrations (expand-only)",
    "switch current symlink",
    "health check /healthz, rollback symlink on failure",
  ],
  edge: [
    "pnpm run ci",
    "wrangler deploy --env <env> --dry-run",
    "wrangler deploy --env <env>",
  ],
  pipeline: [
    "pnpm run ci",
    "wrangler deploy --env <env> --dry-run",
    "wrangler deploy --env <env>",
  ],
}[unit];

process.stdout.write(`deploy ${unit} → ${env}\n`);
for (const [i, step] of steps.entries()) process.stdout.write(`  ${i + 1}. ${step}\n`);

if (dry) process.exit(0);

const res = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" });
process.stdout.write(`head ${res.stdout.trim()}\n`);
process.stdout.write(`not wired yet — deploy scripts land with stage 4\n`);
process.exit(1);
