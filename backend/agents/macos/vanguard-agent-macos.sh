#!/usr/bin/env bash
# ==============================================================================
#  Vanguard OS — macOS Agent  v1.0.0
#  Compatible with macOS 12 Monterey, 13 Ventura, 14 Sonoma, 15 Sequoia
#  Requires: bash 3.2+, curl (built-in), system_profiler, vm_stat, iostat
#
#  Install as LaunchDaemon:
#    sudo bash install-launchd.sh --api-base "http://server:3001" --token "..."
#
#  Run directly:
#    VANGUARD_API_BASE="http://server:3001" \
#    VANGUARD_AGENT_TOKEN="token" \
#    bash vanguard-agent-macos.sh
# ==============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
API_BASE="${VANGUARD_API_BASE:-http://localhost:3001}"
AGENT_TOKEN="${VANGUARD_AGENT_TOKEN:-REPLACE_WITH_YOUR_TOKEN}"
AGENT_ID="${VANGUARD_AGENT_ID:-$(scutil --get ComputerName 2>/dev/null || hostname -s)}"
INTERVAL="${VANGUARD_INTERVAL:-60}"
AGENT_VERSION="1.0.0"
LOG_DIR="${VANGUARD_LOG_DIR:-/var/log/vanguard}"
STATE_FILE="${LOG_DIR}/state.json"
LOG_FILE="${LOG_DIR}/agent-macos.log"

mkdir -p "${LOG_DIR}"

# ── Logging ───────────────────────────────────────────────────────────────────
log() {
    local level="$1"; shift
    local ts
    ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
    echo "[${ts}][${level}] $*" | tee -a "${LOG_FILE}"
}
log_info()  { log "INFO"  "$@"; }
log_warn()  { log "WARN"  "$@"; }
log_error() { log "ERROR" "$@"; }

# ── API ───────────────────────────────────────────────────────────────────────
api_post() {
    local endpoint="$1" body="$2"
    curl -sf --max-time 20 \
        -X POST \
        -H "X-Agent-Token: ${AGENT_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "${body}" \
        "${API_BASE}${endpoint}" 2>/dev/null || true
}

api_get() {
    local endpoint="$1"
    curl -sf --max-time 15 \
        -H "X-Agent-Token: ${AGENT_TOKEN}" \
        "${API_BASE}${endpoint}" 2>/dev/null || true
}

# ── CPU % (via iostat) ────────────────────────────────────────────────────────
get_cpu_pct() {
    local idle
    idle=$(iostat -c 2 1 2>/dev/null | awk 'NR==4{print $NF}')
    if [[ -n "$idle" ]]; then
        awk -v i="$idle" 'BEGIN{printf "%.2f", 100-i}'
    else
        # Fallback: top snapshot
        top -l 2 -n 0 2>/dev/null | awk '/CPU usage/{gsub(/%/,"",$7); print 100-$7; exit}'
    fi
}

# ── Memory % (via vm_stat) ────────────────────────────────────────────────────
get_mem_pct() {
    local page_size=4096
    local pages_free pages_active pages_inactive pages_speculative pages_wired

    eval "$(vm_stat 2>/dev/null | awk '/Pages free/{printf "pages_free=%d\n",$3+0}
                                       /Pages active/{printf "pages_active=%d\n",$3+0}
                                       /Pages inactive/{printf "pages_inactive=%d\n",$3+0}
                                       /Pages speculative/{printf "pages_speculative=%d\n",$3+0}
                                       /Pages wired/{printf "pages_wired=%d\n",$4+0}')"

    local total_pages=$(( (pages_free + pages_active + pages_inactive + pages_speculative + pages_wired) ))
    local used_pages=$(( pages_active + pages_wired ))
    [[ $total_pages -eq 0 ]] && { echo "0"; return; }
    awk -v u="$used_pages" -v t="$total_pages" 'BEGIN{printf "%.2f", (u/t)*100}'
}

# ── Disk % ────────────────────────────────────────────────────────────────────
get_disk_pct() {
    df / | awk 'NR==2{gsub(/%/,"",$5); printf "%.2f", $5}'
}

# ── Network kbps ──────────────────────────────────────────────────────────────
get_net_kbps() {
    local iface
    iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
    [[ -z "$iface" ]] && { echo "0 0"; return; }

    local rx1 tx1 rx2 tx2
    rx1=$(netstat -I "${iface}" -b 2>/dev/null | awk 'NR==2{print $7}')
    tx1=$(netstat -I "${iface}" -b 2>/dev/null | awk 'NR==2{print $10}')
    sleep 1
    rx2=$(netstat -I "${iface}" -b 2>/dev/null | awk 'NR==2{print $7}')
    tx2=$(netstat -I "${iface}" -b 2>/dev/null | awk 'NR==2{print $10}')

    local in_kbps out_kbps
    in_kbps=$(awk -v a="${rx2:-0}" -v b="${rx1:-0}" 'BEGIN{printf "%.2f", (a-b)/1024}')
    out_kbps=$(awk -v a="${tx2:-0}" -v b="${tx1:-0}" 'BEGIN{printf "%.2f", (a-b)/1024}')
    echo "${in_kbps} ${out_kbps}"
}

# ── Uptime ────────────────────────────────────────────────────────────────────
get_uptime_sec() {
    local boot
    boot=$(sysctl -n kern.boottime 2>/dev/null | awk '{gsub(/[^0-9]/," "); print $1}')
    local now
    now=$(date +%s)
    echo $(( now - boot ))
}

# ── Process count ─────────────────────────────────────────────────────────────
get_process_count() {
    ps aux 2>/dev/null | wc -l | tr -d ' '
}

# ── System info ───────────────────────────────────────────────────────────────
get_system_info() {
    local hostname fqdn ip mac os_version os_build cpu_cores ram_gb disk_gb model serial

    hostname=$(scutil --get ComputerName 2>/dev/null || hostname -s)
    fqdn=$(hostname -f 2>/dev/null || hostname)
    ip=$(ipconfig getifaddr en0 2>/dev/null || \
         ipconfig getifaddr en1 2>/dev/null || \
         ifconfig | awk '/inet /{print $2; exit}')
    mac=$(ifconfig en0 2>/dev/null | awk '/ether/{print $2; exit}')
    os_version=$(sw_vers -productName 2>/dev/null) 
    os_version="${os_version} $(sw_vers -productVersion 2>/dev/null)"
    os_build=$(sw_vers -buildVersion 2>/dev/null)
    cpu_cores=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 1)
    ram_gb=$(awk -v b="$(sysctl -n hw.memsize 2>/dev/null || echo 0)" \
             'BEGIN{printf "%.2f", b/1073741824}')
    disk_gb=$(df -g / | awk 'NR==2{printf "%.2f", $2}')
    model=$(system_profiler SPHardwareDataType 2>/dev/null | \
            awk '/Model Identifier/{print $3; exit}')
    serial=$(system_profiler SPHardwareDataType 2>/dev/null | \
             awk '/Serial Number/{print $4; exit}')

    cat <<EOF
{
  "agentId": "${AGENT_ID}",
  "agentVersion": "${AGENT_VERSION}",
  "hostname": "${hostname}",
  "fqdn": "${fqdn}",
  "ipAddress": "${ip}",
  "macAddress": "${mac}",
  "osType": "macos",
  "osVersion": "${os_version}",
  "osBuild": "${os_build}",
  "cpuCores": ${cpu_cores},
  "ramGb": ${ram_gb},
  "diskGb": ${disk_gb},
  "manufacturer": "Apple",
  "model": "${model}",
  "serialNumber": "${serial}",
  "assetType": "workstation"
}
EOF
}

# ── Software (macOS pkgutil) ──────────────────────────────────────────────────
get_software() {
    local sw='['
    local first=true
    while IFS= read -r pkg; do
        local version
        version=$(pkgutil --pkg-info "${pkg}" 2>/dev/null | awk '/version:/{print $2}')
        [[ -z "$version" ]] && continue
        local name="${pkg##*.}"
        name="${name//\"/\\\"}"
        [[ "$first" == true ]] && first=false || sw+=','
        sw+="{\"name\":\"${name}\",\"version\":\"${version}\",\"publisher\":\"${pkg%%.*}\"}"
    done < <(pkgutil --pkgs 2>/dev/null | head -200)
    sw+=']'
    echo "$sw"
}

# ── Open ports (macOS lsof / netstat) ────────────────────────────────────────
get_ports() {
    local ports='['
    local first=true
    local seen=()

    while IFS= read -r port; do
        [[ -z "$port" ]] && continue
        # Check not already in seen
        local dup=false
        for s in "${seen[@]:-}"; do [[ "$s" == "$port" ]] && dup=true; done
        $dup && continue
        seen+=("$port")

        [[ "$first" == true ]] && first=false || ports+=','
        ports+="{\"port\":${port},\"protocol\":\"tcp\",\"state\":\"listening\"}"
    done < <(netstat -anp tcp 2>/dev/null | awk '$6~/LISTEN/{print $4}' | \
             grep -oE '[0-9]+$' | sort -nu | head -50)

    ports+=']'
    echo "$ports"
}

# ── System logs (macOS unified log) ──────────────────────────────────────────
get_logs() {
    local logs='['
    local first=true
    # Pull last 5 minutes of errors/faults from unified log
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        line="${line//\\/\\\\}"
        line="${line//\"/\\\"}"
        line="${line:0:500}"
        [[ "$first" == true ]] && first=false || logs+=','
        logs+="{\"source\":\"unified_log\",\"severity\":\"error\",\"message\":\"${line}\"}"
    done < <(log show --last 5m --predicate 'messageType == fault OR messageType == error' \
             --style compact 2>/dev/null | tail -30 || true)
    logs+=']'
    echo "$logs"
}

# ── State ─────────────────────────────────────────────────────────────────────
read_asset_id() {
    [[ -f "$STATE_FILE" ]] && grep -o '"assetId":"[^"]*"' "$STATE_FILE" | cut -d'"' -f4
}

save_asset_id() {
    echo "{\"assetId\":\"$1\"}" > "$STATE_FILE"
}

# ── Register ──────────────────────────────────────────────────────────────────
register_agent() {
    log_info "Registering with Vanguard OS at ${API_BASE} …"
    local info resp asset_id
    info="$(get_system_info)"
    resp="$(api_post '/api/agent/register' "${info}")"
    asset_id="$(echo "${resp}" | grep -o '"assetId":"[^"]*"' | cut -d'"' -f4)"
    if [[ -n "$asset_id" ]]; then
        log_info "Registered: assetId=${asset_id}"
        save_asset_id "$asset_id"
        echo "$asset_id"
    else
        log_error "Registration failed: ${resp}"
        echo ""
    fi
}

# ── Heartbeat ─────────────────────────────────────────────────────────────────
send_heartbeat() {
    local asset_id="$1"
    local cpu mem disk uptime procs net_in net_out

    cpu="$(get_cpu_pct)"
    mem="$(get_mem_pct)"
    disk="$(get_disk_pct)"
    uptime="$(get_uptime_sec)"
    procs="$(get_process_count)"
    read -r net_in net_out <<< "$(get_net_kbps)" || net_in=0; net_out=0

    local body
    body=$(cat <<EOF
{
  "assetId": "${asset_id}",
  "agentId": "${AGENT_ID}",
  "status": "online",
  "cpuPct": ${cpu},
  "memPct": ${mem},
  "diskPct": ${disk},
  "netInKbps": ${net_in},
  "netOutKbps": ${net_out},
  "uptimeSeconds": ${uptime},
  "processCount": ${procs},
  "ts": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
}
EOF
)
    local resp
    resp="$(api_post '/api/agent/heartbeat' "${body}")"
    if echo "${resp}" | grep -q '"ok":true'; then
        log_info "Heartbeat OK  cpu=${cpu}%  mem=${mem}%  disk=${disk}%"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
log_info "============================================"
log_info " Vanguard OS macOS Agent v${AGENT_VERSION}"
log_info " API     : ${API_BASE}"
log_info " AgentId : ${AGENT_ID}"
log_info " Interval: ${INTERVAL}s"
log_info "============================================"

ASSET_ID="$(read_asset_id)"
CYCLE=0

while true; do
    [[ -z "${ASSET_ID}" ]] && ASSET_ID="$(register_agent)"

    if [[ -n "${ASSET_ID}" ]]; then
        send_heartbeat "${ASSET_ID}" || { log_error "Heartbeat failed"; ASSET_ID=""; }

        if (( CYCLE % 10 == 0 )); then
            log_info "Pushing inventory …"
            SW="$(get_software)"
            PORTS="$(get_ports)"
            api_post '/api/agent/inventory' \
                "{\"assetId\":\"${ASSET_ID}\",\"software\":${SW},\"ports\":${PORTS}}" > /dev/null
            log_info "Inventory pushed"
        fi

        if (( CYCLE % 5 == 0 )); then
            LOGS="$(get_logs)"
            [[ "$LOGS" != "[]" ]] && \
                api_post '/api/agent/logs' \
                    "{\"assetId\":\"${ASSET_ID}\",\"logs\":${LOGS}}" > /dev/null
        fi

        (( CYCLE % 2 == 0 )) && api_get "/api/agent/commands?assetId=${ASSET_ID}" > /dev/null
    fi

    (( CYCLE++ )) || true
    sleep "${INTERVAL}"
done
