# Runbook — the control host

One Verpex VPS, one purpose: `apps/control` behind Caddy. Postgres is Neon, so the
box never carries data, only sessions.

## Shape

| Piece                 | Where                                        |
| --------------------- | -------------------------------------------- |
| `app.mailerdeaon.bid` | Cloudflare → this box, proxied               |
| Caddy                 | 443, one vhost, `444` for unknown hosts      |
| `chameleon.service`   | systemd, user `deploy`, loopback only        |
| Node                  | 22 LTS, from NodeSource                      |
| Environment           | `/etc/chameleon/env`, mode 0640, root:deploy |

Anything else on 80/443 is a conflict. mailcow's nginx is, so mailcow is wiped
(ADR 0023); inbound mail is Cloudflare Email Routing and does not touch the box.

## First provision

1. Reinstall Ubuntu 24.04 LTS from the Verpex panel; keep the same IP if offered.
2. Add the deploy key from `.env`/handoff (`chameleon_deploy.pub`) to
   `/root/.ssh/authorized_keys` during install or right after.
3. As root, run `ops/provision.sh`.
4. As `deploy`, `git clone` is not used: `scripts/deploy.mjs` pushes a build.

`provision.sh` is idempotent: apt packages, a `deploy` user, Caddyfile, systemd
unit, firewall (22 from the operator, 80/443 from Cloudflare ranges), fail2ban,
unattended upgrades, and `sysctl` for the file descriptors Next needs.

## Deploy

From the workstation, with `.env` filled (`Server_IP`, `Username`, `DOMAIN`):

```sh
pnpm run ci
node scripts/deploy.mjs
```

It builds, ships `.next/standalone`, writes the env file, restarts the unit and
polls `https://app.<domain>/api/health` until healthy. A failed health check
leaves the previous build in place (`/srv/chameleon.prev`).

## Rollback

```sh
ssh deploy@<ip> 'sudo systemctl stop chameleon && \
  rm -rf /srv/chameleon && mv /srv/chameleon.prev /srv/chameleon && \
  sudo systemctl start chameleon'
```

Migrations are forward-only; a rollback of code past a migration needs the
migration's own note.

## Secrets on the box

`/etc/chameleon/env` holds `DATABASE_URL` (the `app_rw` URL **with `sslmode=verify-full`**),
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `MAIL_SINK` is unset in production.
`app_migrator` and `app_admin` URLs stay on the workstation.

## Checks

- `curl -s https://app.<domain>/api/health`
- `systemctl status chameleon caddy`
- `journalctl -u chameleon -n 50`
- Caddy answers 444 to `curl -sk https://<ip>/ -H 'Host: bogus'`
