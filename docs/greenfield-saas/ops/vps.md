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

From the workstation, with `.env` filled (`Server_IP`, `DEPLOY_USER`, `DOMAIN`):

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

## The 444 rule and the proxy

Caddy answers `444` to any Host it has no vhost for, but only the origin can show
that. Through Cloudflare a request with a foreign Host is rejected at the edge with
Cloudflare's own `403`, because the name is not on the zone. So the check is
`curl -sk -o /dev/null -w "%{http_code}" --resolve app.<domain>:443:<ip>
https://app.<domain>/ -H 'Host: bogus'` and it must print `444`. Custom hostnames
(stage 4) do reach the origin with their own Host, but a Worker holds the route, so
the vhost list on the box stays `app.` only.

`Server: cloudflare` is always present while proxied; `-Server` in Caddy removes
the origin's own, which is the part we control.

## Domain job

Both units ship with every deploy (they live in the release, not only in
provisioning) and the deploy fails if a run does not answer.

`chameleon-domains.timer` runs `chameleon-domains.service` every five minutes,
which POSTs to `/api/jobs/domains` on loopback with `JOBS_TOKEN`. It expires
72-hour-unproven hostnames, re-checks pending ones every five minutes and active
ones daily. Watch it with `journalctl -u chameleon-domains`; a `403` means
`JOBS_TOKEN` in `/etc/chameleon/env` and in the unit disagree.

## Checks

- `curl -s https://app.<domain>/api/health`
- `systemctl status chameleon caddy`
- `journalctl -u chameleon -n 50`
- Caddy answers 444 to `curl -sk https://<ip>/ -H 'Host: bogus'`
