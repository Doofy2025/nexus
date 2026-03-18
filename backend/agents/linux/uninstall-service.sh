#!/usr/bin/env bash
set -euo pipefail
SERVICE_NAME="vanguard-agent"
INSTALL_DIR="/opt/vanguard-agent"
SERVICE_USER="vanguard"

[[ $EUID -ne 0 ]] && { echo "Run as root."; exit 1; }

echo "=== Vanguard OS Agent — Uninstaller ==="
systemctl stop    "${SERVICE_NAME}" 2>/dev/null || true
systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
rm -f /etc/vanguard-agent.env
systemctl daemon-reload
userdel "${SERVICE_USER}" 2>/dev/null || true
rm -rf "${INSTALL_DIR}"
echo "Agent removed. Logs remain at /var/log/vanguard"
echo "Remove logs with: rm -rf /var/log/vanguard"
echo "=== Done ==="
