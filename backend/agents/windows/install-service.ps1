#Requires -RunAsAdministrator
# ==============================================================================
#  Vanguard OS — Windows Service Installer
#  Uses NSSM (Non-Sucking Service Manager) to run the agent as a Windows service.
#
#  Prerequisites:
#    1. Download NSSM: https://nssm.cc/download
#    2. Place nssm.exe in the same folder as this script OR on your PATH.
#    3. Set $ApiBase and $AgentToken below (or use environment variables).
#
#  Run:
#    .\install-service.ps1
# ==============================================================================

param(
    [string]$ServiceName = "VanguardOSAgent",
    [string]$ApiBase     = "http://REPLACE_WITH_YOUR_SERVER:3001",
    [string]$AgentToken  = "REPLACE_WITH_YOUR_AGENT_TOKEN",
    [int]   $IntervalSec = 60
)

$AgentDir  = "$env:ProgramData\VanguardOS"
$AgentScript = Join-Path $AgentDir "vanguard-agent.ps1"
$NssmPath    = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
if (-not $NssmPath) { $NssmPath = Join-Path $PSScriptRoot "nssm.exe" }

Write-Host "=== Vanguard OS Agent — Service Installer ===" -ForegroundColor Cyan

# ── Stop & remove existing service ───────────────────────────────────────────
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Stopping existing service …"
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & $NssmPath remove $ServiceName confirm
    Start-Sleep -Seconds 2
}

# ── Create agent directory and copy script ────────────────────────────────────
Write-Host "Installing agent files to $AgentDir …"
New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "vanguard-agent.ps1") -Destination $AgentScript -Force

# ── Validate NSSM ────────────────────────────────────────────────────────────
if (-not (Test-Path $NssmPath)) {
    Write-Host ""
    Write-Host "ERROR: nssm.exe not found." -ForegroundColor Red
    Write-Host "Download from https://nssm.cc/download and place nssm.exe here: $PSScriptRoot" -ForegroundColor Yellow
    exit 1
}

# ── Install service ───────────────────────────────────────────────────────────
Write-Host "Creating service '$ServiceName' …"
$pwshPath = (Get-Command powershell.exe).Source

& $NssmPath install $ServiceName $pwshPath
& $NssmPath set $ServiceName AppParameters `
    "-NonInteractive -ExecutionPolicy Bypass -File `"$AgentScript`" -ApiBase `"$ApiBase`" -AgentToken `"$AgentToken`" -IntervalSec $IntervalSec"
& $NssmPath set $ServiceName AppDirectory         $AgentDir
& $NssmPath set $ServiceName DisplayName          "Vanguard OS Monitoring Agent"
& $NssmPath set $ServiceName Description          "Ships metrics, inventory and logs to Vanguard OS."
& $NssmPath set $ServiceName Start                SERVICE_AUTO_START
& $NssmPath set $ServiceName ObjectName           LocalSystem

# Restart on failure
& $NssmPath set $ServiceName AppExit   Default   Restart
& $NssmPath set $ServiceName AppRestartDelay      5000

# Stdout / stderr logging
& $NssmPath set $ServiceName AppStdout "$AgentDir\service-stdout.log"
& $NssmPath set $ServiceName AppStderr "$AgentDir\service-stderr.log"
& $NssmPath set $ServiceName AppStdoutCreationDisposition 4
& $NssmPath set $ServiceName AppStderrCreationDisposition 4
& $NssmPath set $ServiceName AppRotateFiles        1
& $NssmPath set $ServiceName AppRotateSeconds      86400
& $NssmPath set $ServiceName AppRotateBytes        10485760

# Set environment variables on the service
[System.Environment]::SetEnvironmentVariable("VANGUARD_API_BASE",    $ApiBase,     [System.EnvironmentVariableTarget]::Machine)
[System.Environment]::SetEnvironmentVariable("VANGUARD_AGENT_TOKEN", $AgentToken,  [System.EnvironmentVariableTarget]::Machine)
[System.Environment]::SetEnvironmentVariable("VANGUARD_INTERVAL",    "$IntervalSec", [System.EnvironmentVariableTarget]::Machine)

# ── Start ─────────────────────────────────────────────────────────────────────
Write-Host "Starting service …"
Start-Service -Name $ServiceName

Start-Sleep -Seconds 3
$svc = Get-Service -Name $ServiceName
Write-Host ""
Write-Host "Service status: $($svc.Status)" -ForegroundColor $(if ($svc.Status -eq 'Running') { 'Green' } else { 'Red' })
Write-Host ""
Write-Host "Log file : $AgentDir\agent.log"
Write-Host "To view  : Get-Content '$AgentDir\agent.log' -Tail 50 -Wait"
Write-Host ""
Write-Host "=== Installation complete ===" -ForegroundColor Green
