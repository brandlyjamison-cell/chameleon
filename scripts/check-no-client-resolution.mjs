#!/usr/bin/env node
/**
 * INV-EDGE-01: resolution is server-side. Any control-plane module that touches
 * the engine, skeleton, or brand map must be server-only.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const SERVER_MARKER = /import\s+["']server-only["']/;
const RISKY = /from\s+["']@chameleon\/(engine|skeleton|brandmap)["']/;
const files = globSync("apps/control/src/**/*.{ts,tsx}");

const bad = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (RISKY.test(text) && !SERVER_MARKER.test(text)) bad.push(file);
}

if (bad.length > 0) {
  process.stdout.write(
    `control modules resolving templates must import "server-only":\n${bad
      .map((f) => `  ${f}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(`checked ${files.length} control modules\n`);
