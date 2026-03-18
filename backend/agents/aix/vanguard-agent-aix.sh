#!/usr/bin/ksh
# ==============================================================================
#  Vanguard OS — AIX Agent  v1.0.0
#  Compatible with AIX 7.1, 7.2, 7.3
#  Requires: ksh, curl (or wget), awk, sed, lparstat, svmon, df, lsdev, lsattr
#
#  Install as an AIX SRC subsystem using install-src.sh
#  Or run directly:
#    VANGUARD_API_BASE="http://server:3001" \
#    VANGUARD_AGENT_TOKEN="token" \
#    ksh vanguard-agent-aix.sh
# ==============================================================================

# ── Configuration ─────────────────────────────────────────────────────────────
API_BASE="${VANGUARD_API_BASE:-http://localhost:3001}"
AGENT_TOKEN="${VANGUARD_AGENT_TOKEN:-REPLACE_WITH_YOUR_TOKEN}"
INTERVAL="${VANGUARD_INTERVAL:-60}"
AGENT_VERSION="1.0.0"
LOG_DIR="${VANGUARD_LOG_DIR:-/var/log/vanguard}"
STATE_FILE="${LOG_DIR}/state.json"
LOG_FILE="${LOG_DIR}/agent-aix.log"

mkdir -p "${LOG_DIR}"

# ── Logging ───────────────────────────────────────────────────────────────────
log() {
    local level="$1"; shift
    print "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')][${level}] $*" | tee -a "${LOG_FILE}"
}

# ── HTTP POST via curl (preferred) or wget ─────────────────────────────────────
api_post() {
    local endpoint="$1"
    local body="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -sf --max-time 20 \
            -X POST \
            -H "X-Agent-Token: ${AGENT_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "${body}" \
            "${API_BASE}${endpoint}" 2>/dev/null || true
    elif command -v wget >/dev/null 2>&1; then
        echo "${body}" | wget -q -O - \
            --timeout=20 \
            --header="X-Agent-Token: ${AGENT_TOKEN}" \
            --header="Content-Type: application/json" \
            --post-data="${body}" \
            "${API_BASE}${endpoint}" 2>/dev/null || true
    else
        log WARN "Neither curl nor wget found — cannot post to API"
    fi
}

api_get() {
    local endpoint="$1"
    if command -v curl >/dev/null 2>&1; then
        curl -sf --max-time 15 \
            -H "X-Agent-Token: ${AGENT_TOKEN}" \
            "${API_BASE}${endpoint}" 2>/dev/null || true
    fi
}

# ── CPU % (AIX lparstat) ──────────────────────────────────────────────────────
get_cpu_pct() {
    # lparstat 1 1 — sample once over 1 second
    local idle
    idle=$(lparstat 1 1 2>/dev/null | awk 'NR>2 && NF>0{idle=$NF} END{print idle+0}')
    if [[ -n "$idle" && "$idle" != "0" ]]; then
        awk -v i="$idle" 'BEGIN{printf "%.2f", 100 - i}'
    else
        # Fallback via vmstat
        vmstat 1 2 2>/dev/null | awk 'END{printf "%.2f", 100-$16}'
    fi
}

# ── Memory % (AIX svmon) ──────────────────────────────────────────────────────
get_mem_pct() {
    local total_pg used_pg
    total_pg=$(svmon -G 2>/dev/null | awk '/memory/{print $2; exit}')
    used_pg=$(svmon -G 2>/dev/null  | awk '/memory/{print $3; exit}')
    if [[ -n "$total_pg" && "$total_pg" -gt 0 ]]; then
        awk -v t="$total_pg" -v u="$used_pg" 'BEGIN{printf "%.2f", (u/t)*100}'
    else
        echo "0"
    fi
}

# ── Disk % ────────────────────────────────────────────────────────────────────
get_disk_pct() {
    df / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$4); print $4".00"}'
}

# ── Network kbps (AIX netstat) ────────────────────────────────────────────────
get_net_kbps() {
    # AIX netstat -I <iface> doesn't easily give per-second — use 1-sec iostat
    # fallback to 0 if not supported
    echo "0 0"
}

# ── Uptime seconds ────────────────────────────────────────────────────────────
get_uptime_sec() {
    local up
    up=$(uptime 2>/dev/null | awk -F',' '{print $1}' | \
         awk '{
           if ($3=="day" || $3=="days") days=$2
           if ($5~/^[0-9]+:[0-9]+/) { split($5,a,":"); hrs=a[1]; mins=a[2] }
           print (days*86400)+(hrs*3600)+(mins*60)
         }')
    print "${up:-0}"
}

# ── Process count ─────────────────────────────────────────────────────────────
get_process_count() {
    ps -e 2>/dev/null | wc -l | awk '{print $1}'
}

# ── System inventory ──────────────────────────────────────────────────────────
get_system_info() {
    local hostname ip os_version cpu_cores ram_gb disk_gb manufacturer model

    hostname=$(hostname -s 2>/dev/null || hostname)
    ip=$(host "$hostname" 2>/dev/null | awk '/address/{print $NF; exit}' || \
         ifconfig -a 2>/dev/null | awk '/inet /{print $2; exit}')

    os_version="AIX $(oslevel -r 2>/dev/null || oslevel 2>/dev/null)"

    # CPU from lsdev/lsattr
    cpu_cores=$(lsdev -Cc processor 2>/dev/null | wc -l | awk '{print $1}')
    [[ "${cpu_cores}" == "0" ]] && cpu_cores=1

    # RAM in GB from bootinfo
    local ram_mb
    ram_mb=$(bootinfo -r 2>/dev/null || echo 1024)
    ram_gb=$(awk -v m="$ram_mb" 'BEGIN{printf "%.2f", m/1024}')

    disk_gb=$(df -m / 2>/dev/null | awk 'NR==2{printf "%.2f", $2/1024}')

    manufacturer="IBM"
    model=$(lsattr -El sys0 -a modelname 2>/dev/null | awk '{print $2}' || echo "pSeries")

    print "{\"agentId\":\"${AGENT_ID}\",\"agentVersion\":\"${AGENT_VERSION}\",\"hostname\":\"${hostname}\",\"ipAddress\":\"${ip}\",\"osType\":\"aix\",\"osVersion\":\"${os_version}\",\"cpuCores\":${cpu_cores},\"ramGb\":${ram_gb},\"diskGb\":${disk_gb},\"manufacturer\":\"${manufacturer}\",\"model\":\"${model}\",\"assetType\":\"server\"}"
}

# ── Installed software (AIX lslpp) ────────────────────────────────────────────
get_software() {
    local sw='['
    local first=1
    lslpp -L 2>/dev/null | awk 'NR>2 && NF>=3{print $1"\t"$2}' | head -200 | \
    while IFS=$'\t' read -r name version; do
        [[ "$first" -eq 1 ]] && first=0 || sw+=','
        sw+="{\"name\":\"${name}\",\"version\":\"${version}\"}"
        print "$sw" > /tmp/vanguard_sw_buf
    done
    cat /tmp/vanguard_sw_buf 2>/dev/null | awk '{print $0"]"}' || print '[]'
}

# ── Open ports (AIX netstat) ──────────────────────────────────────────────────
get_ports() {
    local ports='['
    local first=1
    netstat -an 2>/dev/null | awk '$1~/tcp/ && $NF~/LISTEN/{print $4}' | \
    grep -oE '[0-9]+$' | sort -nu | head -50 | \
    while read -r port; do
        [[ "$first" -eq 1 ]] && first=0 || ports+=','
        ports+="{\"port\":${port},\"protocol\":\"tcp\",\"state\":\"listening\"}"
        print "$ports" > /tmp/vanguard_ports_buf
    done
    cat /tmp/vanguard_ports_buf 2>/dev/null | awk '{print $0"]"}' || print '[]'
}

# ── State ─────────────────────────────────────────────────────────────────────
AGENT_ID="${VANGUARD_AGENT_ID:-$(hostname -s)}"

read_asset_id() {
    [[ -f "$STATE_FILE" ]] && grep -o '"assetId":"[^"]*"' "$STATE_FILE" | cut -d'"' -f4
}

save_asset_id() {
    print "{\"assetId\":\"$1\"}" > "$STATE_FILE"
}

# ── Register ──────────────────────────────────────────────────────────────────
register_agent() {
    log INFO "Registering with ${API_BASE} …"
    local info resp asset_id
    info=$(get_system_info)
    resp=$(api_post '/api/agent/register' "${info}")
    asset_id=$(print "$resp" | grep -o '"assetId":"[^"]*"' | cut -d'"' -f4)
    if [[ -n "$asset_id" ]]; then
        log INFO "Registered: assetId=${asset_id}"
        save_asset_id "$asset_id"
        print "$asset_id"
    else
        log ERROR "Registration failed: ${resp}"
        print ""
    fi
}

# ── Heartbeat ─────────────────────────────────────────────────────────────────
send_heartbeat() {
    local asset_id="$1"
    local cpu mem disk uptime procs
    cpu=$(get_cpu_pct)
    mem=$(get_mem_pct)
    disk=$(get_disk_pct)
    uptime=$(get_uptime_sec)
    procs=$(get_process_count)

    local body
    body="{\"assetId\":\"${asset_id}\",\"agentId\":\"${AGENT_ID}\",\"status\":\"online\",\"cpuPct\":${cpu},\"memPct\":${mem},\"diskPct\":${disk},\"uptimeSeconds\":${uptime},\"processCount\":${procs},\"ts\":\"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\"}"

    local resp
    resp=$(api_post '/api/agent/heartbeat' "${body}")
    log INFO "Heartbeat cpu=${cpu}% mem=${mem}% disk=${disk}%"
}

# ── Main ──────────────────────────────────────────────────────────────────────
log INFO "==================================="
log INFO " Vanguard OS AIX Agent v${AGENT_VERSION}"
log INFO " API: ${API_BASE}   Interval: ${INTERVAL}s"
log INFO "==================================="

ASSET_ID=$(read_asset_id)
CYCLE=0

while true; do
    if [[ -z "${ASSET_ID}" ]]; then
        ASSET_ID=$(register_agent)
    fi

    if [[ -n "${ASSET_ID}" ]]; then
        send_heartbeat "${ASSET_ID}"

        if (( CYCLE % 10 == 0 )); then
            log INFO "Pushing inventory …"
            SW=$(get_software)
            PORTS=$(get_ports)
            api_post '/api/agent/inventory' \
                "{\"assetId\":\"${ASSET_ID}\",\"software\":${SW},\"ports\":${PORTS}}" > /dev/null
        fi

        (( CYCLE % 2 == 0 )) && api_get "/api/agent/commands?assetId=${ASSET_ID}" > /dev/null
    fi

    (( CYCLE++ )) || true
    sleep "${INTERVAL}"
done
