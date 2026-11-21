#!/usr/bin/env bash
# First-provision of the control host (Ubuntu 24.04). Idempotent. Run as root.
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN}"
ACME_EMAIL="${ACME_EMAIL:-ops@${DOMAIN}}"
DEPLOY_KEY="${DEPLOY_KEY:?set DEPLOY_KEY to the public key}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg gettext-base ufw fail2ban unattended-upgrades openssh-server

# Node 22 LTS from NodeSource.
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy from its own repository (distro Caddy is stale).
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

id -u deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -m 0755 -o deploy -g deploy /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
grep -qF "$DEPLOY_KEY" /home/deploy/.ssh/authorized_keys \
  || echo "$DEPLOY_KEY" >> /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# No password logins, no root login with a password.
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh

# Directories and units.
install -d -m 0755 -o deploy -g deploy /srv/chameleon
install -d -m 0750 -o root -g deploy /etc/chameleon
touch /etc/chameleon/env
chown root:deploy /etc/chameleon/env
chmod 0640 /etc/chameleon/env

install -D -m 0644 "$(dirname "$0")/systemd/chameleon.service" /etc/systemd/system/chameleon.service
systemctl daemon-reload
systemctl enable chameleon

ACME_EMAIL="$ACME_EMAIL" envsubst <"$(dirname "$0")/caddy/Caddyfile" >/etc/caddy/Caddyfile
systemctl enable --now caddy

# Firewall: SSH only from the operator, HTTP(S) only from Cloudflare.
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow from "${OPERATOR_IP:?set OPERATOR_IP}" to any port 22 proto tcp
for range in \
  173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
  141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
  197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 \
  104.24.0.0/14 172.64.0.0/13 131.0.72.0/22; do
  ufw allow from "$range" to any port 80 proto tcp
  ufw allow from "$range" to any port 443 proto tcp
done
ufw --force enable

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "provisioned. next: node scripts/deploy.mjs from the workstation"
