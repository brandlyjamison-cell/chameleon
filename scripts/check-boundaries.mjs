#!/usr/bin/env node
/**
 * Proves the boundary rules actually fire, by linting throwaway violations and
 * asserting a non-zero exit. A rule nobody tests is a comment.
 */
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const eslintBin = resolve(
  dirname(require.resolve("eslint/package.json")),
  "bin/eslint.js",
);

const cases = [
  {
    name: "edge may not import next",
    file: "apps/edge/src/__boundary_next.ts",
    body: 'import "next/server";\nexport const ok = true;\n',
  },
  {
    name: "control may not import a worker binding",
    file: "apps/control/src/__boundary_cf.ts",
    body: 'import type { D1Database } from "cloudflare:workers";\nexport type Db = D1Database;\n',
  },
  {
    name: "apps may not import each other",
    file: "apps/edge/src/__boundary_app.ts",
    body: 'import "../../control/src/index.ts";\nexport const ok = true;\n',
  },
  {
    name: "contracts may not import workspace packages",
    file: "packages/contracts/src/__boundary_dep.ts",
    body: 'import "@chameleon/engine";\nexport const ok = true;\n',
  },
];

let failed = 0;

for (const c of cases) {
  try {
    writeFileSync(c.file, c.body);
    const res = spawnSync(process.execPath, [eslintBin, c.file], {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (res.error) throw res.error;
    if (res.status === 0) {
      process.stdout.write(`  MISS  ${c.name}\n`);
      failed += 1;
    } else {
      process.stdout.write(`  caught ${c.name}\n`);
    }
  } finally {
    rmSync(c.file, { force: true });
  }
}

if (failed > 0) {
  process.stdout.write(`${failed} boundary rule(s) did not fire\n`);
  process.exit(1);
}
