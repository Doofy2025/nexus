#!/usr/bin/ksh
# ==============================================================================
#  Vanguard OS — AIX SRC Subsystem Installer
#  Registers the agent as an AIX SRC subsystem so it can be managed
#  with startsrc / stopsrc / lssrc like any native AIX service.
#
#  Run as root:
#    ksh install-src.sh --api-base "http://server:3001" --token "your-token"
# ==============================================================================

API_BASE="http://localhost:3001"
AGENT_TOKEN="REPLACE_WITH_YOUR_TOKEN"
INTERVAL=60
SUBSYSTEM="vanguardagt"
INSTALL_DIR="/opt/vanguard-agent"
ENV_FILE="/etc/vanguard-agent.env"

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-base) API_BASE="$2";    shift 2 ;;
        --token)    AGENT_TOKEN="$2"; shift 2 ;;
        --interval) INTERVAL="$2";    shift 2 ;;
        *) print "Unknown: $1"; exit 1 ;;
    esac
done

[[ $(id -u) -ne 0 ]] && { print "Must run as root."; exit 1; }

print "=== Vanguard OS AIX SRC Installer ==="
print "    API   : ${API_BASE}"
print "    Subsys: ${SUBSYSTEM}"

# ── Install agent script ───────────────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}" /var/log/vanguard
cp "$(dirname "$0")/vanguard-agent-aix.sh" "${INSTALL_DIR}/vanguard-agent-aix.sh"
chmod 750 "${INSTALL_DIR}/vanguard-agent-aix.sh"

# ── Environment file ──────────────────────────────────────────────────────────
cat > "${ENV_FILE}" <<EOF
VANGUARD_API_BASE=${API_BASE}
VANGUARD_AGENT_TOKEN=${AGENT_TOKEN}
VANGUARD_INTERVAL=${INTERVAL}
VANGUARD_LOG_DIR=/var/log/vanguard
EOF
chmod 600 "${ENV_FILE}"

# ── Wrapper script (sources env then runs agent) ──────────────────────────────
cat > "${INSTALL_DIR}/run-agent.sh" <<'WRAPPER'
#!/usr/bin/ksh
. /etc/vanguard-agent.env
export VANGUARD_API_BASE VANGUARD_AGENT_TOKEN VANGUARD_INTERVAL VANGUARD_LOG_DIR
exec /usr/bin/ksh /opt/vanguard-agent/vanguard-agent-aix.sh
WRAPPER
chmod 750 "${INSTALL_DIR}/run-agent.sh"

# ── Remove existing subsystem if present ──────────────────────────────────────
if lssrc -s "${SUBSYSTEM}" >/dev/null 2>&1; then
    stopsrc -s "${SUBSYSTEM}" 2>/dev/null || true
    rmssys -s "${SUBSYSTEM}"  2>/dev/null || true
fi

# ── Register SRC subsystem ────────────────────────────────────────────────────
mkssys \
    -s "${SUBSYSTEM}" \
    -p "${INSTALL_DIR}/run-agent.sh" \
    -u 0 \
    -S \
    -n 15 \
    -f 9 \
    -a "" \
    -e /var/log/vanguard/agent-aix.log \
    -o /var/log/vanguard/agent-aix.log

print "  ✓ SRC subsystem '${SUBSYSTEM}' created"

# ── Add to /etc/inittab for boot start ────────────────────────────────────────
if ! grep -q "${SUBSYSTEM}" /etc/inittab 2>/dev/null; then
    chsubserver -a -v srcmstr -p "/usr/sbin/srcmstr" 2>/dev/null || true
    mkitab "${SUBSYSTEM}:2:once:/usr/bin/startsrc -s ${SUBSYSTEM} > /dev/console 2>&1"
    print "  ✓ Added to /etc/inittab"
fi

# ── Start now ─────────────────────────────────────────────────────────────────
startsrc -s "${SUBSYSTEM}"
sleep 2
lssrc -s "${SUBSYSTEM}"

print ""
print "  Commands:"
print "    startsrc -s ${SUBSYSTEM}   # start"
print "    stopsrc  -s ${SUBSYSTEM}   # stop"
print "    lssrc    -s ${SUBSYSTEM}   # status"
print "    tail -f /var/log/vanguard/agent-aix.log"
print ""
print "=== Installation complete ==="
