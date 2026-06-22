# Fix service AppDirectory and restart
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait
  exit
}

$NSSM = "C:\Tools\nssm.exe"
Write-Host "=== Stopping service ===" -ForegroundColor Yellow
& $NSSM stop PrintAgent-br001
Start-Sleep -Seconds 2

Write-Host "=== Setting AppDirectory ===" -ForegroundColor Cyan
& $NSSM set PrintAgent-br001 AppDirectory "C:\print-system"

# Verify
Write-Host "Verify AppDirectory: $((& $NSSM get PrintAgent-br001 AppDirectory))" -ForegroundColor Cyan

# Set env so dotenv can find .env (alternative: set env var DOTENV_PATH)
# Actually agent.js uses require('dotenv').config() which looks in process.cwd() by default
# So AppDirectory is the right fix.

Write-Host "=== Starting service ===" -ForegroundColor Cyan
& $NSSM start PrintAgent-br001
Start-Sleep -Seconds 5

Write-Host "`n=== Service status ===" -ForegroundColor Green
Get-Service PrintAgent-br001 | Format-List Name, Status, StartType

Write-Host "`n=== Stdout log (last 15) ===" -ForegroundColor Green
if (Test-Path "C:\print-system\logs\service-stdout.log") {
  Get-Content "C:\print-system\logs\service-stdout.log" -Tail 15
}
Write-Host "`n=== Stderr log (last 15) ===" -ForegroundColor Yellow
if (Test-Path "C:\print-system\logs\service-stderr.log") {
  Get-Content "C:\print-system\logs\service-stderr.log" -Tail 15
}

Write-Host "`n=== Press any key ===" -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")