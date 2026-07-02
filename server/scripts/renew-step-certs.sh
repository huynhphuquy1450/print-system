#!/usr/bin/env bash
# renew-step-certs.sh
#
# Daily cron job (runs at 03:00) that renews all Step-CA-issued certs:
#   - Mosquitto server cert → systemctl reload mosquitto
#   - Express HTTPS cert    → fs.watch in https-server.js picks it up
#
# Idempotent. Safe to run multiple times — step ca renew only rotates if
# the cert is within the renewal window (default: 2/3 of validity).
#
# PREREQUISITES:
#   - Step-CA PKI initialized (see setup-step-ca.sh)
#   - step CLI installed
#   - Provisioner password available — by default Step-CA looks for
#     $STEPPATH/config/password.txt or interactive prompt. For cron, the
#     cleanest approach is to set the provisioner password via a file
#     readable only by root: /root/.step/provisioner_password.
#
# USAGE:
#   sudo bash scripts/renew-step-certs.sh

set -euo pipefail

LOG_PREFIX="$(date '+%Y-%m-%d %H:%M:%S') [renew]"
echo "$LOG_PREFIX starting cert renewal"

# --- Configuration -----------------------------------------------------------

CA_URL="https://localhost:8443"
ROOT_CA="/var/lib/step-ca/certs/root_ca.crt"
PROVISIONER="admin"
PROVISIONER_PASSWORD_FILE="${STEPPATH:-/root/.step}/provisioner_password"

MOSQ_CERT_DIR="/etc/mosquitto/certs"
EXPRESS_CERT_DIR="<INSTALL_DIR>/certs"

# Helper: step CLI flags for non-interactive renew
step_renew_flags=()
if [[ -f "$PROVISIONER_PASSWORD_FILE" ]]; then
  step_renew_flags+=(--provisioner-password-file "$PROVISIONER_PASSWORD_FILE")
fi
step_renew_flags+=(--ca-url "$CA_URL" --root "$ROOT_CA" --provisioner "$PROVISIONER")

# --- 1. Renew Mosquitto cert -----------------------------------------------

MOSQ_CERT="$MOSQ_CERT_DIR/server.crt"
MOSQ_KEY="$MOSQ_CERT_DIR/server.key"
if [[ -f "$MOSQ_CERT" ]] && [[ -f "$MOSQ_KEY" ]]; then
  echo "$LOG_PREFIX renewing mosquitto cert: $MOSQ_CERT"
  step ca renew "$MOSQ_CERT" "$MOSQ_KEY" "${step_renew_flags[@]}"
  chown mosquitto:mosquitto "$MOSQ_CERT" "$MOSQ_KEY"
  chmod 644 "$MOSQ_CERT"
  chmod 640 "$MOSQ_KEY"

  echo "$LOG_PREFIX reloading mosquitto (graceful — existing connections keep TLS)"
  if systemctl reload mosquitto 2>/dev/null; then
    echo "$LOG_PREFIX mosquitto reload OK"
  elif systemctl restart mosquitto 2>/dev/null; then
    # Fallback if 'reload' isn't supported by the mosquitto service unit
    echo "$LOG_PREFIX mosquitto reload unsupported — restarted (brief disconnect)"
  else
    echo "$LOG_PREFIX WARN: failed to reload/restart mosquitto — check 'systemctl status mosquitto'" >&2
  fi
else
  echo "$LOG_PREFIX SKIP: mosquitto certs not found at $MOSQ_CERT_DIR"
fi

# --- 2. Renew Express HTTPS cert -------------------------------------------

EXPRESS_CERT="$EXPRESS_CERT_DIR/server.crt"
EXPRESS_KEY="$EXPRESS_CERT_DIR/server.key"
if [[ -f "$EXPRESS_CERT" ]] && [[ -f "$EXPRESS_KEY" ]]; then
  echo "$LOG_PREFIX renewing express cert: $EXPRESS_CERT"
  step ca renew "$EXPRESS_CERT" "$EXPRESS_KEY" "${step_renew_flags[@]}"
  chmod 644 "$EXPRESS_CERT"
  chmod 640 "$EXPRESS_KEY"

  # Express https-server.js watches $EXPRESS_CERT for changes and reloads
  # the in-memory TLS context automatically. No pm2 restart needed.
  echo "$LOG_PREFIX express cert renewed — https-server.js will pick it up via fs.watch"
else
  echo "$LOG_PREFIX SKIP: express certs not found at $EXPRESS_CERT_DIR"
fi

echo "$LOG_PREFIX cert renewal complete"