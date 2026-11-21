#!/usr/bin/env node
/**
 * Manual deploy of the control plane (ADR 0021): no CI/CD, no registry, no
 * containers. Builds locally, ships the standalone output over SSH, swaps it in,
 * restarts, and only then reports success. The previous build stays as
 * /srv/chameleon.prev for a one-command rollback.
 *
 * Needs .env: Server_IP, DEPLOY_USER, DOMAIN, and the key at ~/.ssh/chameleon_deploy.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { resolve } from "node:path";

for (const file of [".env", ".env.db"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}

const host = process.env.Server_IP;
// `Username` collides with the Windows USERNAME variable, so DEPLOY_USER wins.
const user = process.env.DEPLOY_USER ?? "deploy";
const domain = process.env.DOMAIN;
const key =
  process.env.DEPLOY_KEY_PATH ??
  resolve(process.env.USERPROFILE ?? process.env.HOME, ".ssh", "chameleon_deploy");
const target = `${user}@${host}`;
const win = platform() === "win32";

if (!host || !domain) throw new Error("Server_IP and DOMAIN are required in .env");
if (!existsSync(key)) throw new Error(`ssh key not found at ${key}`);

const sshBase = [
  "-i",
  key,
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "BatchMode=yes",
];

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: win, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

function ssh(remote, { input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "ssh",
      [...sshBase, "-o", "ServerAliveInterval=15", target, remote],
      {
        stdio: [input ? "pipe" : "ignore", "inherit", "inherit"],
      },
    );
    // ssh waits on stdin until EOF; without this the env step hangs forever.
    if (input) child.stdin.end(input);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(remote)),
    );
  });
}

async function ship(dir, remote = "/srv/chameleon.stage") {
  await new Promise((resolvePromise, reject) => {
    const tar = spawn("tar", ["-cf", "-", "-C", dir, "."], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const remoteProc = spawn("ssh", [...sshBase, target, `tar -xf - -C ${remote}`], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    tar.stdout.pipe(remoteProc.stdin);
    remoteProc.on("error", reject);
    remoteProc.on("close", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`tar over ssh into ${remote}`)),
    );
  });
}

console.log(`→ deploy to ${domain} (${target})`);

if (process.argv.includes("--skip-gate")) {
  console.log("→ gate (skipped)");
} else {
  console.log("→ gate");
  sh(win ? "pnpm.cmd" : "pnpm", ["run", "ci"]);
}

console.log("→ build");
sh(win ? "pnpm.cmd" : "pnpm", ["--filter", "@chameleon/control", "build"]);

console.log("→ env on host");
await ssh("sudo install -d -m 0750 -o root -g deploy /etc/chameleon");
await ssh(
  `sudo tee /etc/chameleon/env >/dev/null && sudo chown root:deploy /etc/chameleon/env && sudo chmod 0640 /etc/chameleon/env`,
  {
    input: [
      "NODE_ENV=production",
      "PORT=3000",
      `DATABASE_URL=${(process.env.DATABASE_URL_APP_RW ?? "").replace("sslmode=require", "sslmode=verify-full")}`,
      `BETTER_AUTH_SECRET=${process.env.BETTER_AUTH_SECRET ?? ""}`,
      `BETTER_AUTH_URL=https://app.${domain}`,
      `JOBS_TOKEN=${process.env.JOBS_TOKEN ?? ""}`,
      `CLOUDFLARE_ZONE_ID=${process.env.CLOUDFLARE_ZONE_ID ?? ""}`,
      `CLOUDFLARE_API_KEY=${process.env.CLOUDFLARE_API_KEY ?? ""}`,
      "",
    ].join("\n"),
  },
);

console.log("→ stage");
// `install -d -o` needs root; the tree must end up owned by deploy so tar can
// write into it.
await ssh(
  "sudo rm -rf /srv/chameleon.stage && sudo install -d -o deploy -g deploy /srv/chameleon.stage",
);
const standalone = resolve("apps/control/.next/standalone");
await ship(standalone);
await ssh("sudo install -d -o deploy -g deploy /srv/chameleon.stage/apps/control/.next");
await new Promise((resolvePromise, reject) => {
  const tar = spawn("tar", ["-cf", "-", "-C", "apps/control/.next", "static"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const remote = spawn(
    "ssh",
    [...sshBase, target, "tar -xf - -C /srv/chameleon.stage/apps/control/.next"],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  tar.stdout.pipe(remote.stdin);
  remote.on("error", reject);
  remote.on("close", (code) =>
    code === 0 ? resolvePromise() : reject(new Error("static over ssh")),
  );
});

console.log("→ swap");
await ssh(
  "sudo rm -rf /srv/chameleon.prev && (sudo mv /srv/chameleon /srv/chameleon.prev || true) && " +
    "sudo mv /srv/chameleon.stage /srv/chameleon && sudo chown -R deploy:deploy /srv/chameleon",
);
await ssh("sudo systemctl restart chameleon");

// The job units are part of the release, not of provisioning: a first deploy can
// land after provision, and a unit change must ship with the code that needs it.
console.log("→ job units");
await ssh("sudo install -d -m 0755 -o deploy -g deploy /tmp/chameleon-ops");
await ship(resolve("ops"), "/tmp/chameleon-ops");
await ssh(
  "sudo install -m 0644 /tmp/chameleon-ops/systemd/chameleon-domains.service /etc/systemd/system/ && " +
    "sudo install -m 0644 /tmp/chameleon-ops/systemd/chameleon-domains.timer /etc/systemd/system/ && " +
    "sudo systemctl daemon-reload && sudo systemctl enable --now chameleon-domains.timer",
);
// Prove the token path here rather than trusting the unit file.
await ssh("sudo systemctl start chameleon-domains");
const job = await new Promise((done) => {
  const child = spawn(
    "ssh",
    [...sshBase, target, "sudo journalctl -u chameleon-domains -n 5 --no-pager -o cat"],
    {
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  let out = "";
  child.stdout?.on("data", (chunk) => (out += chunk));
  child.on("close", () => done(out));
});
if (!/"checked"/.test(job)) {
  console.error(`✗ domain job did not answer: ${job.trim().slice(-200)}`);
  process.exit(1);
}

console.log("→ health");
let healthy = false;
for (let i = 0; i < 30; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const res = await fetch(`https://app.${domain}/api/health`);
    if (res.ok) {
      healthy = true;
      break;
    }
  } catch {
    // still starting
  }
}

if (!healthy) {
  console.error("✗ health failed; previous build is at /srv/chameleon.prev");
  process.exit(1);
}
console.log(`✓ live at https://app.${domain}`);
