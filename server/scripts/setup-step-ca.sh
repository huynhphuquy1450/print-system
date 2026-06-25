#!/usr/bin/env bash
# setup-step-ca.sh
#
# One-time Step-CA setup for print-service. Initializes an internal PKI,
# provisions certs for Mosquitto + Express HTTPS, and sets up the daily
# renewal cron.
#
# PREREQUISITES:
#   - Run as root (sudo) — we write to /etc/mosquitto and /var/lib/step-ca
#   - step-ca + step-cli installed. If missing, install:
#       Debian/Ubuntu: apt install -y step-cli step-ca
#       RHEL/Fedora:   dnf install -y step-cli step-ca
#       Manual:        https://github.com/smallstep/certificates/releases
#   - 160.250.133.192 (or whatever SAN you want) resolves to this host
#
# USAGE:
#   sudo bash scripts/setup-step-ca.sh
#
# This script is idempotent — re-running after the first time will:
#   - Skip `step ca init` if PKI already exists
#   - Re-provision certs (overwrites if still valid)
#   - Re-install the cron entry (crontab handles dedup)
#
# For agent-side cert distribution, see HANDOVER §10.2.

set -euo pipefail

# --- Configuration -----------------------------------------------------------

CA_NAME="Print System Internal CA"
CA_DNS="print-ca,localhost,127.0.0.1"
CA_ADDRESS=":8443"
CA_PROVISIONER="admin"
SERVER_SAN="160.250.133.192"   # Public IP that agents connect to
CERT_VALIDITY="2160h"          # 90 days — matches the renewal cadence
STEP_CA_DIR="/var/lib/step-ca"
MOSQ_CERT_DIR="/etc/mosquitto/certs"
EXPRESS_CERT_DIR="/opt/print-service/certs"
RENEW_SCRIPT="/opt/print-service/scripts/renew-step-certs.sh"
LOG_FILE="/var/log/step-renewal.log"

# --- Pre-flight checks -------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must run as root (sudo bash $0)" >&2
  exit 1
fi

if ! command -v step >/dev/null 2>&1; then
  cat >&2 <<EOF
ERROR: 'step' CLI not found.

Install with one of:
  Debian/Ubuntu:  apt install -y step-cli step-ca
  RHEL/Fedora:    dnf install -y step-cli step-ca
  Or download a release: https://github.com/smallstep/cli/releases

Then re-run this script.
EOF
  exit 1
fi

if ! command -v step-ca >/dev/null 2>&1; then
  echo "WARN: 'step-ca' server not found. Will need it to serve the CA." >&2
  echo "  Install with: apt install -y step-ca (or see https://github.com/smallstep/certificates)" >&2
fi

echo "==> Step-CA setup starting"
echo "    CA name:    $CA_NAME"
echo "    Server SAN: $SERVER_SAN"
echo "    Cert dir:   $EXPRESS_CERT_DIR"

# --- 1. Initialize PKI (idempotent) -----------------------------------------

if [[ ! -d "$STEP_CA_DIR/db" ]] || [[ ! -f "$STEP_CA_DIR/config/ca.json" ]]; then
  echo "==> Initializing Step-CA PKI at $STEP_CA_DIR"
  echo "    You will be prompted for:"
  echo "      - CA password (encrypts the CA private key on disk)"
  echo "      - Provisioner password (for 'admin' provisioner)"
  echo "    STORE THESE PASSWORDS in your secret manager — losing them = re-init."

  step ca init \
    --name "$CA_NAME" \
    --dns "$CA_DNS" \
    --address "$CA_ADDRESS" \
    --provisioner "$CA_PROVISIONER" \
    --deployment-type standalone \
    --acme \
    --root "$STEP_CA_DIR/certs/root_ca.crt" \
    --key "$STEP_CA_DIR/secrets/intermediate_key" \
    --password-file <(echo "") \
    --provisioner-password-file <(echo "") \
    || {
      # If user provided interactive passwords via stdin, fall back to plain init
      echo "    Re-running with interactive prompts..."
      step ca init \
        --name "$CA_NAME" \
        --dns "$CA_DNS" \
        --address "$CA_ADDRESS" \
        --provisioner "$CA_PROVISIONER" \
        --deployment-type standalone
    }
else
  echo "==> Step-CA PKI already initialized at $STEP_CA_DIR — skipping init"
fi

# --- 2. Start step-ca (if not already running) -------------------------------

if ! pgrep -f "step-ca" >/dev/null 2>&1; then
  echo "==> Starting step-ca service"
  # If step-ca package installed, prefer systemd. Otherwise launch manually.
  if systemctl list-unit-files step-ca.service >/dev/null 2>&1; then
    systemctl enable --now step-ca
  else
    echo "    (no systemd unit — start manually: step-ca $STEP_CA_DIR/config/ca.json &)"
    nohup step-ca "$STEP_CA_DIR/config/ca.json" >>"$LOG_FILE" 2>&1 &
    sleep 2
  fi
else
  echo "==> step-ca already running"
fi

# Wait for step-ca to be ready
echo "==> Waiting for step-ca at https://localhost:$CA_ADDRESS ..."
for i in {1..30}; do
  if step ca health --ca-url "https://localhost:$CA_ADDRESS" --root "$STEP_CA_DIR/certs/root_ca.crt" >/dev/null 2>&1; then
    echo "    step-ca is ready"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "ERROR: step-ca did not become healthy in 30s — check $LOG_FILE" >&2
    exit 1
  fi
done

# --- 3. Provision Mosquitto cert --------------------------------------------

echo "==> Provisioning Mosquitto cert (CN=$SERVER_SAN, validity=$CERT_VALIDITY)"
mkdir -p "$MOSQ_CERT_DIR"
step ca certificate "$SERVER_SAN" \
  "$MOSQ_CERT_DIR/server.crt" \
  "$MOSQ_CERT_DIR/server.key" \
  --not-after "$CERT_VALIDITY" \
  --kty RSA \
  --ca-url "https://localhost:$CA_ADDRESS" \
  --root "$STEP_CA_DIR/certs/root_ca.crt" \
  --provisioner "$CA_PROVISIONER"

# Mosquitto runs as user `mosquitto` and needs read access
chown mosquitto:mosquitto "$MOSQ_CERT_DIR/server.crt" "$MOSQ_CERT_DIR/server.key"
chmod 644 "$MOSQ_CERT_DIR/server.crt"
chmod 640 "$MOSQ_CERT_DIR/server.key"

# --- 4. Provision Express HTTPS cert ----------------------------------------

echo "==> Provisioning Express HTTPS cert (CN=$SERVER_SAN, validity=$CERT_VALIDITY)"
mkdir -p "$EXPRESS_CERT_DIR"
step ca certificate "$SERVER_SAN" \
  "$EXPRESS_CERT_DIR/server.crt" \
  "$EXPRESS_CERT_DIR/server.key" \
  --not-after "$CERT_VALIDITY" \
  --kty RSA \
  --ca-url "https://localhost:$CA_ADDRESS" \
  --root "$STEP_CA_DIR/certs/root_ca.crt" \
  --provisioner "$CA_PROVISIONER"

# Express reads as the deploy user (admin or print-service). 644 is fine for
# both cert and key IF the file is in a user-owned dir; we restrict to 640.
chmod 644 "$EXPRESS_CERT_DIR/server.crt"
chmod 640 "$EXPRESS_CERT_DIR/server.key"

# --- 5. Distribute root CA for agents ---------------------------------------

echo "==> Copying root CA cert for agent distribution"
cp "$STEP_CA_DIR/certs/root_ca.crt" "$EXPRESS_CERT_DIR/root_ca.crt"
chmod 644 "$EXPRESS_CERT_DIR/root_ca.crt"

# --- 6. Install renewal cron -----------------------------------------------

if [[ -f "$RENEW_SCRIPT" ]] && [[ -x "$RENEW_SCRIPT" ]]; then
  CRON_LINE="0 3 * * * $RENEW_SCRIPT >> $LOG_FILE 2>&1"
  if crontab -l 2>/dev/null | grep -qF "$RENEW_SCRIPT"; then
    echo "==> Renewal cron already installed"
  else
    echo "==> Installing renewal cron (daily at 03:00)"
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
  fi
else
  echo "WARN: $RENEW_SCRIPT not found or not executable — install it first, then re-run" >&2
  echo "  See server/scripts/renew-step-certs.sh in the repo" >&2
fi

# --- 7. Summary / next steps -----------------------------------------------

cat <<EOF

==> Step-CA setup complete!

    Mosquitto cert:  $MOSQ_CERT_DIR/server.crt (owned by mosquitto:mosquitto)
    Express cert:    $EXPRESS_CERT_DIR/server.crt
    Root CA (agents): $EXPRESS_CERT_DIR/root_ca.crt

==> Next steps (manual):

    1. Open HTTPS port on firewall:
         sudo bash scripts/ufw-open-https.sh

    2. Replace Mosquitto config:
         sudo cp server/src/mosquitto/mosquitto.conf.example /etc/mosquitto/conf.d/step-ca.conf
         sudo systemctl restart mosquitto

    3. Update /opt/print-service/.env:
         HTTPS_ENABLED=true
         HTTPS_PORT=443
         HTTPS_CERT_FILE=$EXPRESS_CERT_DIR/server.crt
         HTTPS_KEY_FILE=$EXPRESS_CERT_DIR/server.key
         MQTT_CA_FILE=$MOSQ_CERT_DIR/server.crt

    4. Restart print-service:
         pm2 restart print-service

    5. Verify:
         curl http://$SERVER_SAN:3000/api/health          # HQ LAN HTTP — should work
         curl --cacert $EXPRESS_CERT_DIR/root_ca.crt \\
              https://$SERVER_SAN:443/api/health          # Agent HTTPS — should work

    6. Distribute root_ca.crt to pilot agents (see HANDOVER §10.2):
         - Each Windows agent: install root_ca.crt into
           "Trusted Root Certification Authorities" (Local Machine store)
         - Step-by-step: agent/CA_INSTALL.md

EOF

echo "==> Done"