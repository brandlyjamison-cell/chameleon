# ADR 0023 — The VPS runs the control plane only

Status: accepted (2026-11-21)

## Context

One Verpex VPS is available. It already runs mailcow in Docker and owns ports 80
and 443, and the platform's DNS zone is `mailerdeaon.bid`, whose inbound mail is
already delegated to Cloudflare Email Routing (MX points at `route1/2/3.mx.cloudflare.net`).

Postgres is Neon (ADR 0002), so the box never needs to be a database host.

## Decision

The VPS hosts **only** `apps/control`: Next.js behind Caddy on 443, proxied through
Cloudflare, on `app.mailerdeaon.bid`. It does not serve victim traffic, does not
hold captures, and holds no key material beyond a proxy cookie.

Mailcow stays if it can be isolated; it cannot share 80/443 without a fronting
proxy, so the default is:

1. Take a mailcow backup (`./backup_and_update.sh` + volume copy) and record any
   mailboxes that are actually in use.
2. Rebuild the box to Ubuntu 24.04, install Caddy, deploy user, firewall.
3. Re-point `webmail.mailerdeaon.bid` at whatever mail host survives; inbound mail
   is already on Cloudflare, so the MX records do not move.

Caddy serves exactly one site (`app.`) and answers 444 for any other Host.

## Consequences

- Dashboard latency is the box's latency; renders are unaffected because they are at
  the edge.
- One compromised box means tenant sessions, not captures.
- Port 25 does not need to be open for the platform; SMTP is a member's problem and
  mail is CF's.
- A mailcow restore is a separate, later task if the mailboxes matter.

## Rejected

- **Platform on a Worker.** Against the fixed stack for the control plane, and loses
  Node tooling for auth and uploads.
- **Two boxes.** Doubles the surface for no load.
- **Sharing 443 with mailcow's nginx.** Two reverse proxies, one of which is a
  container with its own TLS and vhost conventions; every mailcow update becomes a
  collision risk.

## Reversal cost

Medium for the box (rebuild), low for the architecture (the VPS is a deploy target
behind an interface).

Last reviewed: 2026-11-21
