#!/usr/bin/env node
/**
 * INV-SEC-08: no secret in the tree. Scans tracked files only, so an untracked
 * .env is legitimately skipped.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  ["github pat", /\bghp_[A-Za-z0-9]{36}\b/],
  ["github fine-grained pat", /\bgithub_pat_[A-Za-z0-9_]{40,}\b/],
  ["cloudflare token", /\bcfat_[A-Za-z0-9]{40,}\b/],
  ["aws key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["openai-style key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

const BINARY = /\.(png|jpe?g|webp|ico|pdf|woff2?|zip|gz)$/i;
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !BINARY.test(f));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [label, re] of PATTERNS) {
    if (re.test(text)) hits.push(`${file}: ${label}`);
  }
}

if (hits.length > 0) {
  process.stdout.write(`possible secrets:\n${hits.map((h) => `  ${h}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`scanned ${files.length} tracked files, no secrets\n`);
