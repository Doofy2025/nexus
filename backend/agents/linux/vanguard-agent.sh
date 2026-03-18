#!/usr/bin/env bash
# ==============================================================================
#  Vanguard OS — Linux Agent  v1.0.0
#  Supports: RHEL, CentOS, Ubuntu, Debian, SUSE, Amazon Linux, and derivatives.
#  Requires: bash 4+, curl, awk, sed, grep, /proc filesystem
#
#  Usage (direct):
#    VANGUARD_API_BASE="http://server:3001" \
#    VANGUARD_AGENT_TOKEN="your-token" \
#    bash vanguard-agent.sh
#
#  Usage (as systemd service):
#    Run install-service.sh first.
# ==============================================================================

set -euo pipefail

# ── Configuration (env vars override defaults) ─────────────────────────────────
API_BASE="${VANGUARD_API_BASE:-http://localhost:3001}"
AGENT_TOKEN="${VANGUARD_AGENT_TOKEN:-REPLACE_WITH_YOUR_TOKEN}"
AGENT_ID="${VANGUARD_AGENT_ID:-$(hostname -s)}"
INTERVAL="${VANGUARD_INTERVAL:-60}"
AGENT_VERSION="1.0.0"
LOG_DIR="${VANGUARD_LOG_DIR:-/var/log/vanguard}"
STATE_FILE="${LOG_DIR}/state.json"
LOG_FILE="${LOG_DIR}/agent.log"

mkdir -p "${LOG_DIR}"

# ── Logging ───────────────────────────────────────────────────────────────────
log() {
    local level="$1"; shift
    local msg="$*"
    local ts
    ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "[${ts}][${level}] ${msg}" | tee -a "${LOG_FILE}"
}
log_info()  { log "INFO"  "$@"; }
log_warn()  { log "WARN"  "$@"; }
log_error() { log "ERROR" "$@"; }

# ── API call ──────────────────────────────────────────────────────────────────
api_post() {
    local endpoint="$1"
    local body="$2"
    curl -sf \
        --max-time 20 \
        -X POST \
        -H "X-Agent-Token: ${AGENT_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "${body}" \
        "${API_BASE}${endpoint}" 2>/dev/null || true
}

api_get() {
    local endpoint="$1"
    curl -sf \
        --max-time 15 \
        -H "X-Agent-Token: ${AGENT_TOKEN}" \
        "${API_BASE}${endpoint}" 2>/dev/null || true
}

# ── Metric collectors ─────────────────────────────────────────────────────────
get_cpu_pct() {
    # Read two /proc/stat samples 1s apart for accuracy
    local s1 s2 idle1 total1 idle2 total2
    read -ra s1 <<< "$(grep '^cpu ' /proc/stat)"
    sleep 1
    read -ra s2 <<< "$(grep '^cpu ' /proc/stat)"

    local idle1=$((s1[4] + s1[5]))
    local total1=0
    for v in "${s1[@]:1}"; do (( total1 += v )) || true; done

    local idle2=$((s2[4] + s2[5]))
    local total2=0
    for v in "${s2[@]:1}"; do (( total2 += v )) || true; done

    local diff_idle=$(( idle2 - idle1 ))
    local diff_total=$(( total2 - total1 ))

    if [[ $diff_total -eq 0 ]]; then echo "0"; return; fi
    echo "scale=2; (1 - ${diff_idle}/${diff_total}) * 100" | bc
}

get_mem_pct() {
    awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{printf "%.2f", (1-(a/t))*100}' /proc/meminfo
}

get_disk_pct() {
    df / | awk 'NR==2{sub(/%/,"",$5); print $5".00"}'
}

get_net_kbps() {
    # Sample over 1 second
    local iface
    iface=$(ip route | awk '/default/{print $5; exit}')
    if [[ -z "$iface" ]]; then
        echo "0 0"; return
    fi

    local rx1 tx1 rx2 tx2
    rx1=$(awk -v i="$iface" '$1==i":"{print $2}' /proc/net/dev 2>/dev/null || echo 0)
    tx1=$(awk -v i="$iface" '$1==i":"{print $10}' /proc/net/dev 2>/dev/null || echo 0)
    sleep 1
    rx2=$(awk -v i="$iface" '$1==i":"{print $2}' /proc/net/dev 2>/dev/null || echo 0)
    tx2=$(awk -v i="$iface" '$1==i":"{print $10}' /proc/net/dev 2>/dev/null || echo 0)

    local in_kbps out_kbps
    in_kbps=$(echo "scale=2; (${rx2} - ${rx1}) / 1024" | bc)
    out_kbps=$(echo "scale=2; (${tx2} - ${tx1}) / 1024" | bc)
    echo "${in_kbps} ${out_kbps}"
}

get_load_avg() {
    awk '{print $1, $2, $3}' /proc/loadavg
}

get_uptime_sec() {
    awk '{printf "%d", $1}' /proc/uptime
}

get_process_count() {
    ls /proc | grep -c '^[0-9]' || echo 0
}

# ── System info ───────────────────────────────────────────────────────────────
get_system_info() {
    local hostname fqdn ip mac os_type os_version os_build
    local cpu_cores ram_gb disk_gb manufacturer model

    hostname="$(hostname -s)"
    fqdn="$(hostname -f 2>/dev/null || hostname)"
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    mac="$(ip link show | awk '/ether/{print $2; exit}' 2>/dev/null || echo '')"

    os_type="linux"
    if   [[ -f /etc/os-release ]]; then
        os_version=$(. /etc/os-release && echo "${NAME} ${VERSION_ID}")
    elif [[ -f /etc/redhat-release ]]; then
        os_version=$(cat /etc/redhat-release)
    else
        os_version="Linux"
    fi
    os_build="$(uname -r)"

    cpu_cores=$(nproc)
    ram_gb=$(awk '/MemTotal/{printf "%.2f", $2/1048576}' /proc/meminfo)
    disk_gb=$(df / | awk 'NR==2{printf "%.2f", $2/1048576}')

    manufacturer=""; model=""
    if command -v dmidecode &>/dev/null; then
        manufacturer=$(dmidecode -s system-manufacturer 2>/dev/null || echo '')
        model=$(dmidecode -s system-product-name 2>/dev/null || echo '')
    elif [[ -f /sys/class/dmi/id/sys_vendor ]]; then
        manufacturer=$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || echo '')
        model=$(cat /sys/class/dmi/id/product_name 2>/dev/null || echo '')
    fi

    cat <<EOF
{
  "agentId": "${AGENT_ID}",
  "agentVersion": "${AGENT_VERSION}",
  "hostname": "${hostname}",
  "fqdn": "${fqdn}",
  "ipAddress": "${ip}",
  "macAddress": "${mac}",
  "osType": "${os_type}",
  "osVersion": "${os_version}",
  "osBuild": "${os_build}",
  "cpuCores": ${cpu_cores},
  "ramGb": ${ram_gb},
  "diskGb": ${disk_gb},
  "manufacturer": "${manufacturer}",
  "model": "${model}",
  "assetType": "server"
}
EOF
}

# ── Software inventory ────────────────────────────────────────────────────────
get_software() {
    local sw='['
    local first=true
    local pkgs

    if command -v rpm &>/dev/null; then
        pkgs=$(rpm -qa --queryformat '%{NAME}\t%{VERSION}\t%{VENDOR}\n' 2>/dev/null | head -200)
    elif command -v dpkg-query &>/dev/null; then
        pkgs=$(dpkg-query -W -f='${Package}\t${Version}\t${Maintainer}\n' 2>/dev/null | head -200)
    fi

    while IFS=$'\t' read -r name version publisher; do
        [[ -z "$name" ]] && continue
        name="${name//\"/\\\"}"
        version="${version//\"/\\\"}"
        publisher="${publisher//\"/\\\"}"
        [[ "$first" == true ]] && first=false || sw+=','
        sw+="{\"name\":\"${name}\",\"version\":\"${version}\",\"publisher\":\"${publisher}\"}"
    done <<< "$pkgs"

    sw+=']'
    echo "$sw"
}

# ── Open ports ────────────────────────────────────────────────────────────────
get_ports() {
    local ports='['
    local first=true

    if command -v ss &>/dev/null; then
        while IFS= read -r line; do
            local port
            port=$(echo "$line" | awk '{print $5}' | grep -oE '[0-9]+$')
            [[ -z "$port" ]] && continue
            [[ "$first" == true ]] && first=false || ports+=','
            ports+="{\"port\":${port},\"protocol\":\"tcp\",\"state\":\"listening\"}"
        done < <(ss -tlnH 2>/dev/null | head -50)
    elif command -v netstat &>/dev/null; then
        while IFS= read -r line; do
            local port
            port=$(echo "$line" | awk '{print $4}' | grep -oE '[0-9]+$')
            [[ -z "$port" ]] && continue
            [[ "$first" == true ]] && first=false || ports+=','
            ports+="{\"port\":${port},\"protocol\":\"tcp\",\"state\":\"listening\"}"
        done < <(netstat -tlnH 2>/dev/null | grep LISTEN | head -50)
    fi

    ports+=']'
    echo "$ports"
}

# ── Syslog tail ───────────────────────────────────────────────────────────────
get_logs() {
    local logs='['
    local first=true
    local log_src="/var/log/syslog"
    [[ -f /var/log/messages ]] && log_src="/var/log/messages"

    if [[ -f "$log_src" ]]; then
        while IFS= read -r line; do
            local severity="info"
            echo "$line" | grep -qiE 'error|fail' && severity="error"
            echo "$line" | grep -qiE 'warn'        && severity="warning"
            echo "$line" | grep -qiE 'crit|emerg'  && severity="critical"
            [[ "$severity" == "info" ]] && continue   # only ship warnings+

            line="${line//\\/\\\\}"
            line="${line//\"/\\\"}"
            line="${line:0:500}"

            [[ "$first" == true ]] && first=false || logs+=','
            logs+="{\"source\":\"syslog\",\"severity\":\"${severity}\",\"message\":\"${line}\"}"
        done < <(tail -20 "$log_src" 2>/dev/null)
    fi

    logs+=']'
    echo "$logs"
}

# ── State persistence ─────────────────────────────────────────────────────────
read_asset_id() {
    if [[ -f "$STATE_FILE" ]]; then
        grep -o '"assetId":"[^"]*"' "$STATE_FILE" | cut -d'"' -f4
    fi
}

save_asset_id() {
    echo "{\"assetId\":\"$1\"}" > "$STATE_FILE"
}

# ── Registration ──────────────────────────────────────────────────────────────
register_agent() {
    log_info "Registering with Vanguard OS at ${API_BASE} …"
    local info
    info="$(get_system_info)"
    local resp
    resp="$(api_post '/api/agent/register' "${info}")"
    local asset_id
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

    local cpu mem disk uptime procs load1 load5 load15
    cpu="$(get_cpu_pct)"
    mem="$(get_mem_pct)"
    disk="$(get_disk_pct)"
    uptime="$(get_uptime_sec)"
    procs="$(get_process_count)"

    read -r load1 load5 load15 <<< "$(get_load_avg)"

    # Net is sampled over 1s inside get_net_kbps — skip during startup
    local net_in=0 net_out=0
    read -r net_in net_out <<< "$(get_net_kbps)" || true

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
  "loadAvg1": ${load1},
  "loadAvg5": ${load5},
  "loadAvg15": ${load15},
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
    else
        log_warn "Heartbeat response: ${resp}"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
log_info "============================================"
log_info " Vanguard OS Agent  v${AGENT_VERSION}"
log_info " API     : ${API_BASE}"
log_info " AgentId : ${AGENT_ID}"
log_info " Interval: ${INTERVAL}s"
log_info "============================================"

ASSET_ID="$(read_asset_id)"
CYCLE=0

while true; do
    # Register / re-register
    if [[ -z "$ASSET_ID" ]]; then
        ASSET_ID="$(register_agent)"
    fi

    if [[ -n "$ASSET_ID" ]]; then
        # Heartbeat every cycle
        send_heartbeat "$ASSET_ID" || { log_error "Heartbeat failed"; ASSET_ID=""; }

        # Inventory every 10 cycles
        if (( CYCLE % 10 == 0 )); then
            log_info "Pushing inventory …"
            SW="$(get_software)"
            PORTS="$(get_ports)"
            RESP="$(api_post '/api/agent/inventory' \
                "{\"assetId\":\"${ASSET_ID}\",\"software\":${SW},\"ports\":${PORTS}}")"
            log_info "Inventory response: ${RESP}"
        fi

        # Logs every 5 cycles
        if (( CYCLE % 5 == 0 )); then
            LOGS="$(get_logs)"
            if [[ "$LOGS" != "[]" ]]; then
                api_post '/api/agent/logs' \
                    "{\"assetId\":\"${ASSET_ID}\",\"logs\":${LOGS}}" > /dev/null
                log_info "Logs shipped"
            fi
        fi

        # Poll commands every 2 cycles
        if (( CYCLE % 2 == 0 )); then
            api_get "/api/agent/commands?assetId=${ASSET_ID}" > /dev/null
        fi
    fi

    (( CYCLE++ )) || true
    sleep "${INTERVAL}"
done
