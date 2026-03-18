#Requires -Version 5.1
# ==============================================================================
#  Vanguard OS — Windows Agent  v1.0.0
#  Collects system metrics and ships them to the Vanguard OS API.
#
#  Usage (direct):
#    .\vanguard-agent.ps1 -ApiBase "http://your-server:3001" `
#                         -AgentToken "your-token-here"
#
#  Usage (as service):
#    Run install-service.ps1 first — it registers this script with NSSM.
# ==============================================================================

param(
    [string]$ApiBase     = $env:VANGUARD_API_BASE     ?? "http://localhost:3001",
    [string]$AgentToken  = $env:VANGUARD_AGENT_TOKEN  ?? "REPLACE_WITH_YOUR_TOKEN",
    [string]$AgentId     = $env:VANGUARD_AGENT_ID     ?? $env:COMPUTERNAME,
    [int]   $IntervalSec = [int]($env:VANGUARD_INTERVAL ?? "60")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# ── Logging ───────────────────────────────────────────────────────────────────
$LogDir  = "$env:ProgramData\VanguardOS"
$LogFile = "$LogDir\agent.log"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

function Write-Log {
    param([ValidateSet('INFO','WARN','ERROR')][string]$Level = 'INFO', [string]$Msg)
    $line = "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ' -AsUTC)][$Level] $Msg"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red    }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        default { Write-Host $line }
    }
}

# ── API helper ────────────────────────────────────────────────────────────────
function Invoke-VanguardApi {
    param([string]$Endpoint, [string]$Method = 'POST', [hashtable]$Body = @{})
    $url  = "$ApiBase$Endpoint"
    $hdrs = @{ "X-Agent-Token" = $AgentToken; "Content-Type" = "application/json" }
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    try {
        if ($Method -eq 'GET') {
            return Invoke-RestMethod -Uri $url -Method GET -Headers $hdrs -TimeoutSec 15
        }
        return Invoke-RestMethod -Uri $url -Method POST -Headers $hdrs -Body $json -TimeoutSec 20
    } catch {
        Write-Log ERROR "API $Method $Endpoint failed: $($_.Exception.Message)"
        return $null
    }
}

# ── Metric collectors ─────────────────────────────────────────────────────────
function Get-CpuPct {
    try {
        $avg = (Get-WmiObject Win32_Processor |
                Measure-Object -Property LoadPercentage -Average).Average
        return [math]::Round([double]$avg, 2)
    } catch { return $null }
}

function Get-MemPct {
    try {
        $os    = Get-WmiObject Win32_OperatingSystem
        $total = $os.TotalVisibleMemorySize
        $free  = $os.FreePhysicalMemory
        return [math]::Round((($total - $free) / $total) * 100, 2)
    } catch { return $null }
}

function Get-DiskPct {
    try {
        $d = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='C:'"
        if (-not $d -or $d.Size -eq 0) { return $null }
        return [math]::Round((($d.Size - $d.FreeSpace) / $d.Size) * 100, 2)
    } catch { return $null }
}

function Get-NetKbps {
    try {
        $nics = Get-WmiObject Win32_PerfFormattedData_Tcpip_NetworkInterface |
                Where-Object { $_.Name -notmatch 'loopback|isatap' }
        $inKbps  = ($nics | Measure-Object -Property BytesReceivedPersec -Sum).Sum / 1024
        $outKbps = ($nics | Measure-Object -Property BytesSentPersec     -Sum).Sum / 1024
        return @{
            inKbps  = [math]::Round($inKbps,  2)
            outKbps = [math]::Round($outKbps, 2)
        }
    } catch { return @{ inKbps = $null; outKbps = $null } }
}

function Get-UptimeSec {
    try {
        $os   = Get-WmiObject Win32_OperatingSystem
        $boot = [System.Management.ManagementDateTimeConverter]::ToDateTime($os.LastBootUpTime)
        return [long](New-TimeSpan -Start $boot -End (Get-Date)).TotalSeconds
    } catch { return $null }
}

function Get-ProcessCount {
    try { return (Get-Process).Count } catch { return $null }
}

# ── Inventory collectors ──────────────────────────────────────────────────────
function Get-SystemInfo {
    try {
        $cs  = Get-WmiObject Win32_ComputerSystem
        $os  = Get-WmiObject Win32_OperatingSystem
        $cpu = Get-WmiObject Win32_Processor | Select-Object -First 1
        $disk = Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3" |
                Measure-Object -Property Size -Sum

        $ip = (Get-NetIPAddress -AddressFamily IPv4 |
               Where-Object { $_.InterfaceAlias -notmatch 'loopback' } |
               Select-Object -First 1).IPAddress

        $mac = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } |
                Select-Object -First 1).MacAddress

        return @{
            agentId      = $AgentId
            agentVersion = '1.0.0'
            hostname     = $env:COMPUTERNAME
            fqdn         = try { [System.Net.Dns]::GetHostEntry('').HostName } catch { $env:COMPUTERNAME }
            ipAddress    = $ip
            macAddress   = $mac
            osType       = 'windows'
            osVersion    = $os.Caption
            osBuild      = $os.BuildNumber
            cpuCores     = [int]$cs.NumberOfLogicalProcessors
            ramGb        = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
            diskGb       = [math]::Round($disk.Sum / 1GB, 2)
            manufacturer = $cs.Manufacturer
            model        = $cs.Model
            assetType    = 'server'
        }
    } catch {
        Write-Log ERROR "SystemInfo: $($_.Exception.Message)"
        return @{ agentId = $AgentId; hostname = $env:COMPUTERNAME; osType = 'windows'; assetType = 'server' }
    }
}

function Get-SoftwareList {
    $sw = [System.Collections.Generic.List[hashtable]]::new()
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($p in $paths) {
        try {
            Get-ItemProperty $p -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName } |
            ForEach-Object {
                $sw.Add(@{
                    name        = $_.DisplayName
                    version     = $_.DisplayVersion
                    publisher   = $_.Publisher
                    installDate = $_.InstallDate
                })
            }
        } catch {}
    }
    return $sw | Select-Object -First 300
}

function Get-OpenPorts {
    $ports = [System.Collections.Generic.List[hashtable]]::new()
    try {
        $connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
        $seen = @{}
        foreach ($c in $connections) {
            if (-not $seen.ContainsKey($c.LocalPort)) {
                $seen[$c.LocalPort] = $true
                $ports.Add(@{
                    port     = [int]$c.LocalPort
                    protocol = 'tcp'
                    state    = 'listening'
                })
            }
        }
    } catch {
        # Fallback: parse netstat
        netstat -ano 2>$null | Select-String 'LISTENING' | ForEach-Object {
            if ($_ -match ':(\d+)\s+0\.0\.0\.0:') {
                $p = [int]$Matches[1]
                if (-not $seen.ContainsKey($p)) {
                    $seen[$p] = $true
                    $ports.Add(@{ port = $p; protocol = 'tcp'; state = 'listening' })
                }
            }
        }
    }
    return $ports | Select-Object -First 100
}

function Get-EventLogs {
    $logs = [System.Collections.Generic.List[hashtable]]::new()
    try {
        $events = Get-WinEvent -LogName System -MaxEvents 50 -ErrorAction SilentlyContinue |
                  Where-Object { $_.LevelDisplayName -in @('Error','Warning','Critical') }
        foreach ($e in $events) {
            $logs.Add(@{
                source   = $e.ProviderName
                severity = switch ($e.LevelDisplayName) {
                    'Critical' { 'critical' }
                    'Error'    { 'error'    }
                    'Warning'  { 'warning'  }
                    default    { 'info'     }
                }
                message  = $e.Message.Substring(0, [Math]::Min(1000, $e.Message.Length))
                rawLog   = "EventId=$($e.Id) Source=$($e.ProviderName)"
            })
        }
    } catch {}
    return $logs
}

# ── State file (persists assetId across restarts) ─────────────────────────────
$StateFile = "$LogDir\state.json"

function Read-State {
    if (Test-Path $StateFile) {
        try { return Get-Content $StateFile | ConvertFrom-Json } catch {}
    }
    return $null
}

function Save-State([string]$AssetId) {
    @{ assetId = $AssetId } | ConvertTo-Json | Set-Content $StateFile -Encoding UTF8
}

# ── Registration ──────────────────────────────────────────────────────────────
function Register-Agent {
    Write-Log INFO "Registering with Vanguard OS at $ApiBase …"
    $info = Get-SystemInfo
    $resp = Invoke-VanguardApi -Endpoint '/api/agent/register' -Body $info
    if ($resp -and $resp.assetId) {
        Write-Log INFO "Registered: assetId=$($resp.assetId) status=$($resp.status)"
        Save-State -AssetId $resp.assetId
        return $resp.assetId
    }
    Write-Log ERROR "Registration failed — will retry next cycle"
    return $null
}

# ── Main loop ─────────────────────────────────────────────────────────────────
Write-Log INFO "============================================"
Write-Log INFO " Vanguard OS Agent  v1.0.0  starting"
Write-Log INFO " ApiBase    : $ApiBase"
Write-Log INFO " AgentId    : $AgentId"
Write-Log INFO " Interval   : ${IntervalSec}s"
Write-Log INFO "============================================"

$assetId = (Read-State)?.assetId
$cycle   = 0

while ($true) {
    try {
        # Register / re-register if needed
        if (-not $assetId) {
            $assetId = Register-Agent
        }

        if ($assetId) {
            # ── Heartbeat every cycle ──────────────────────────────────────
            $net  = Get-NetKbps
            $hb   = @{
                assetId       = $assetId
                agentId       = $AgentId
                status        = 'online'
                cpuPct        = Get-CpuPct
                memPct        = Get-MemPct
                diskPct       = Get-DiskPct
                netInKbps     = $net.inKbps
                netOutKbps    = $net.outKbps
                uptimeSeconds = Get-UptimeSec
                processCount  = Get-ProcessCount
                ts            = (Get-Date -AsUTC).ToString('o')
            }
            $r = Invoke-VanguardApi -Endpoint '/api/agent/heartbeat' -Body $hb
            if ($r) { Write-Log INFO "Heartbeat OK  cpu=$($hb.cpuPct)%  mem=$($hb.memPct)%  disk=$($hb.diskPct)%" }

            # ── Full inventory every 10 cycles (~10 min at 60s) ────────────
            if ($cycle % 10 -eq 0) {
                Write-Log INFO "Pushing inventory …"
                $inv = @{
                    assetId  = $assetId
                    software = @(Get-SoftwareList)
                    ports    = @(Get-OpenPorts)
                }
                $r2 = Invoke-VanguardApi -Endpoint '/api/agent/inventory' -Body $inv
                if ($r2) { Write-Log INFO "Inventory OK  sw=$($inv.software.Count) ports=$($inv.ports.Count)" }
            }

            # ── Ship event logs every 5 cycles ────────────────────────────
            if ($cycle % 5 -eq 0) {
                $eventLogs = Get-EventLogs
                if ($eventLogs.Count -gt 0) {
                    $lr = Invoke-VanguardApi -Endpoint '/api/agent/logs' -Body @{
                        assetId = $assetId; logs = @($eventLogs)
                    }
                    if ($lr) { Write-Log INFO "Logs shipped: $($eventLogs.Count) entries" }
                }
            }

            # ── Poll for commands ──────────────────────────────────────────
            if ($cycle % 2 -eq 0) {
                $cmds = Invoke-VanguardApi -Endpoint "/api/agent/commands?assetId=$assetId" -Method GET
                if ($cmds -and $cmds.commands -and $cmds.commands.Count -gt 0) {
                    Write-Log INFO "Received $($cmds.commands.Count) command(s)"
                    # Phase 3: execute commands here
                }
            }
        }
    } catch {
        Write-Log ERROR "Main loop: $($_.Exception.Message)"
        $assetId = $null   # force re-registration on next cycle
    }

    $cycle++
    Start-Sleep -Seconds $IntervalSec
}
