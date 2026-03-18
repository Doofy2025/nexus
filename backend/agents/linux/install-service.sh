#!/usr/bin/env bash
# ==============================================================================
#  Vanguard OS — Linux systemd Service Installer
#  Tested on: RHEL 7/8/9, CentOS, Ubuntu 18+, Debian 10+, Amazon Linux 2/2023
#
#  Run as root:
#    sudo bash install-service.sh \
#         --api-base "http://your-server:3001" \
#         --token    "your-agent-token"
# ==============================================================================

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
API_BASE="http://localhost:3001"
AGENT_TOKEN="REPLACE_WITH_YOUR_TOKEN"
INTERVAL=60
INSTALL_DIR="/opt/vanguard-agent"
SERVICE_NAME="vanguard-agent"
SERVICE_USER="vanguard"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-base) API_BASE="$2";    shift 2 ;;
        --token)    AGENT_TOKEN="$2"; shift 2 ;;
        --interval) INTERVAL="$2";    shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

echo "=== Vanguard OS Agent — systemd Installer ==="
echo "    API Base : ${API_BASE}"
echo "    Interval : ${INTERVAL}s"
echo ""

# ── Must be root ──────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: Run as root (sudo)." >&2
    exit 1
fi

# ── Create service user ───────────────────────────────────────────────────────
if ! id "${SERVICE_USER}" &>/dev/null; then
    useradd -r -s /sbin/nologin -d "${INSTALL_DIR}" "${SERVICE_USER}"
    echo "  ✓ Created user: ${SERVICE_USER}"
fi

# ── Install agent ─────────────────────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}" /var/log/vanguard
cp "$(dirname "$0")/vanguard-agent.sh" "${INSTALL_DIR}/vanguard-agent.sh"
chmod 750 "${INSTALL_DIR}/vanguard-agent.sh"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}" /var/log/vanguard
echo "  ✓ Installed agent to ${INSTALL_DIR}"

# ── Environment file ──────────────────────────────────────────────────────────
cat > /etc/vanguard-agent.env <<EOF
VANGUARD_API_BASE=${API_BASE}
VANGUARD_AGENT_TOKEN=${AGENT_TOKEN}
VANGUARD_INTERVAL=${INTERVAL}
VANGUARD_LOG_DIR=/var/log/vanguard
EOF
chmod 640 /etc/vanguard-agent.env
chown root:${SERVICE_USER} /etc/vanguard-agent.env
echo "  ✓ Environment file: /etc/vanguard-agent.env"

# ── systemd unit ──────────────────────────────────────────────────────────────
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Vanguard OS Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
EnvironmentFile=/etc/vanguard-agent.env
ExecStart=/usr/bin/bash ${INSTALL_DIR}/vanguard-agent.sh
Restart=always
RestartSec=10s
StandardOutput=append:/var/log/vanguard/agent.log
StandardError=append:/var/log/vanguard/agent.log

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/log/vanguard ${INSTALL_DIR}

[Install]
WantedBy=multi-user.target
EOF

echo "  ✓ systemd unit created"

# ── Enable and start ──────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"
sleep 2

STATUS=$(systemctl is-active "${SERVICE_NAME}" 2>/dev/null || echo "unknown")
echo ""
if [[ "$STATUS" == "active" ]]; then
    echo "  ✅ Service is RUNNING"
else
    echo "  ❌ Service status: ${STATUS}"
    echo "     Check logs: journalctl -u ${SERVICE_NAME} -n 30"
fi

echo ""
echo "  Useful commands:"
echo "    systemctl status  ${SERVICE_NAME}"
echo "    systemctl restart ${SERVICE_NAME}"
echo "    journalctl -u ${SERVICE_NAME} -f"
echo "    tail -f /var/log/vanguard/agent.log"
echo ""
echo "=== Installation complete ==="
