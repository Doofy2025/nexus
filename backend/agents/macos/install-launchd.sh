#!/usr/bin/env bash
# ==============================================================================
#  Vanguard OS — macOS LaunchDaemon Installer
#  Installs the agent as a system-level LaunchDaemon (starts at boot,
#  runs as root, survives user logout).
#
#  Run as root:
#    sudo bash install-launchd.sh \
#         --api-base "http://your-server:3001" \
#         --token    "your-agent-token"
# ==============================================================================

set -euo pipefail

API_BASE="http://localhost:3001"
AGENT_TOKEN="REPLACE_WITH_YOUR_TOKEN"
INTERVAL=60
INSTALL_DIR="/opt/vanguard-agent"
PLIST_LABEL="io.vanguardos.agent"
PLIST_PATH="/Library/LaunchDaemons/${PLIST_LABEL}.plist"

while [[ $# -gt 0 ]]; do
    case $1 in
        --api-base) API_BASE="$2";    shift 2 ;;
        --token)    AGENT_TOKEN="$2"; shift 2 ;;
        --interval) INTERVAL="$2";    shift 2 ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

[[ $EUID -ne 0 ]] && { echo "Run as root: sudo bash $0"; exit 1; }

echo "=== Vanguard OS Agent — macOS LaunchDaemon Installer ==="
echo "    API  : ${API_BASE}"
echo "    Label: ${PLIST_LABEL}"

# ── Install agent ─────────────────────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}" /var/log/vanguard
cp "$(dirname "$0")/vanguard-agent-macos.sh" "${INSTALL_DIR}/vanguard-agent-macos.sh"
chmod 750 "${INSTALL_DIR}/vanguard-agent-macos.sh"

# ── Remove existing daemon if present ────────────────────────────────────────
if [[ -f "${PLIST_PATH}" ]]; then
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
    rm -f "${PLIST_PATH}"
fi

# ── Write plist ───────────────────────────────────────────────────────────────
cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${INSTALL_DIR}/vanguard-agent-macos.sh</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>VANGUARD_API_BASE</key>
        <string>${API_BASE}</string>
        <key>VANGUARD_AGENT_TOKEN</key>
        <string>${AGENT_TOKEN}</string>
        <key>VANGUARD_INTERVAL</key>
        <string>${INTERVAL}</string>
        <key>VANGUARD_LOG_DIR</key>
        <string>/var/log/vanguard</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>/var/log/vanguard/agent-macos.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/vanguard/agent-macos.log</string>

    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
</dict>
</plist>
EOF

chmod 644 "${PLIST_PATH}"
chown root:wheel "${PLIST_PATH}"
echo "  ✓ LaunchDaemon plist: ${PLIST_PATH}"

# ── Load and start ────────────────────────────────────────────────────────────
launchctl load "${PLIST_PATH}"
sleep 2

if launchctl list | grep -q "${PLIST_LABEL}"; then
    echo "  ✅ Daemon is RUNNING"
else
    echo "  ❌ Daemon not found in launchctl list — check logs"
fi

echo ""
echo "  Commands:"
echo "    sudo launchctl start  ${PLIST_LABEL}"
echo "    sudo launchctl stop   ${PLIST_LABEL}"
echo "    sudo launchctl unload ${PLIST_PATH}"
echo "    tail -f /var/log/vanguard/agent-macos.log"
echo ""
echo "=== Installation complete ==="
