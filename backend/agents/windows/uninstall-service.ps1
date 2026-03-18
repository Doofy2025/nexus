#Requires -RunAsAdministrator
param([string]$ServiceName = "VanguardOSAgent")

$NssmPath = (Get-Command nssm -ErrorAction SilentlyContinue)?.Source
if (-not $NssmPath) { $NssmPath = Join-Path $PSScriptRoot "nssm.exe" }

Write-Host "=== Vanguard OS Agent — Uninstaller ===" -ForegroundColor Cyan

Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
if (Test-Path $NssmPath) {
    & $NssmPath remove $ServiceName confirm
} else {
    sc.exe delete $ServiceName
}

# Remove env vars
foreach ($v in @('VANGUARD_API_BASE','VANGUARD_AGENT_TOKEN','VANGUARD_INTERVAL')) {
    [System.Environment]::SetEnvironmentVariable($v, $null, [System.EnvironmentVariableTarget]::Machine)
}

Write-Host "Service removed. Agent data remains at: $env:ProgramData\VanguardOS" -ForegroundColor Yellow
Write-Host "Remove manually with: Remove-Item -Recurse '$env:ProgramData\VanguardOS'" -ForegroundColor Yellow
Write-Host "=== Uninstall complete ===" -ForegroundColor Green
