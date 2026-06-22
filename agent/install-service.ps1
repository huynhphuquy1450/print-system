# Self-elevating PowerShell script to install NSSM service
# Run this from normal PowerShell - it will re-launch itself elevated

$ErrorActionPreference = 'Stop'

# If not admin, re-launch with UAC
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Requesting UAC elevation..." -ForegroundColor Yellow
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait
  exit
}

# === Now we are elevated ===
Write-Host "=== Installing PrintAgent-br001 service (elevated) ===" -ForegroundColor Green

$NSSM = "C:\Tools\nssm.exe"
$NodeExe = "C:\Program Files\nodejs\node.exe"
$AgentScript = "C:\print-system\agent.js"
$AppDir = "C:\print-system"

# Check files exist
foreach ($f in @($NSSM, $NodeExe, $AgentScript)) {
  if (-not (Test-Path $f)) {
    Write-Host "FATAL: Missing $f" -ForegroundColor Red
    pause
    exit 1
  }
}

# Remove old service if exists
& $NSSM stop PrintAgent-br001 2>$null
& $NSSM remove PrintAgent-br001 confirm 2>$null

# Install
Write-Host "Installing service..." -ForegroundColor Cyan
& $NSSM install PrintAgent-br001 $NodeExe $AgentScript
& $NSSM set PrintAgent-br001 AppDirectory $AppDir
& $NSSM set PrintAgent-br001 AppStdout "C:\print-system\logs\service-stdout.log"
& $NSSM set PrintAgent-br001 AppStderr "C:\print-system\logs\service-stderr.log"
& $NSSM set PrintAgent-br001 AppRotateFiles 1
& $NSSM set PrintAgent-br001 AppRotateBytes 10485760
& $NSSM set PrintAgent-br001 Start SERVICE_AUTO_START
& $NSSM set PrintAgent-br001 AppRestartDelay 5000
& $NSSM set PrintAgent-br001 AppThrottle 10000

# Start
Write-Host "Starting service..." -ForegroundColor Cyan
& $NSSM start PrintAgent-br001
Start-Sleep -Seconds 4

# Verify
Write-Host "`n=== Service status ===" -ForegroundColor Green
Get-Service PrintAgent-br001 | Format-List Name, Status, StartType

Write-Host "`n=== Recent log (stdout) ===" -ForegroundColor Green
if (Test-Path "C:\print-system\logs\service-stdout.log") {
  Get-Content "C:\print-system\logs\service-stdout.log" -Tail 15
} else {
  Write-Host "(no stdout log yet)" -ForegroundColor Yellow
}

Write-Host "`n=== Done. Press any key to close. ===" -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
