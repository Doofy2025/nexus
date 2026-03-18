#!/usr/bin/env bash
set -euo pipefail
PLIST_LABEL="io.vanguardos.agent"
PLIST_PATH="/Library/LaunchDaemons/${PLIST_LABEL}.plist"
[[ $EUID -ne 0 ]] && { echo "Run as root."; exit 1; }
echo "=== Vanguard OS Agent — macOS Uninstaller ==="
launchctl unload "${PLIST_PATH}" 2>/dev/null || true
rm -f "${PLIST_PATH}"
rm -rf /opt/vanguard-agent
echo "Agent removed. Logs remain at /var/log/vanguard"
echo "=== Done ==="
