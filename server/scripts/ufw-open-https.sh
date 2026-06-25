#!/usr/bin/env bash
# ufw-open-https.sh
#
# Opens TCP port 443 on the host firewall so internet agents can reach the
# Express HTTPS server. Idempotent — ufw will silently skip if the rule
# already exists.
#
# PREREQUISITES:
#   - ufw installed (apt install ufw)
#   - ufw enabled (ufw status shows "Status: active")
#
# USAGE:
#   sudo bash scripts/ufw-open-https.sh
#
# Note: only opens port 443 (HTTPS). The agent's HTTPS endpoint binds to
# 443 by default. The HQ LAN access (port 3000 HTTP) is assumed to be
# reachable via internal network and doesn't need a public firewall rule.

set -euo pipefail

HTTPS_PORT="${HTTPS_PORT:-443}"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (sudo bash $0)" >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "WARN: ufw not installed. Skipping firewall rule." >&2
  echo "  If using a different firewall (iptables/nftables/cloud security group)," >&2
  echo "  open TCP $HTTPS_PORT manually and re-verify." >&2
  exit 0
fi

echo "==> Opening TCP $HTTPS_PORT via ufw"
ufw allow "$HTTPS_PORT/tcp" comment "Print Service HTTPS (for internet agents)"

echo "==> Current ufw status:"
ufw status verbose

cat <<EOF

==> Done.

Verify connectivity from outside:
  curl --cacert /opt/print-service/certs/root_ca.crt \\
       https://160.250.133.192:$HTTPS_PORT/api/health

If port still unreachable, check:
  - Cloud provider security group (AWS/GCP/Azure/DO all have separate
    firewall in addition to ufw)
  - 'ss -tlnp | grep :$HTTPS_PORT' to confirm the Express HTTPS server
    actually bound
EOF