# Restart service (elevated)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait
  exit
}

Write-Host "Restarting PrintAgent-br001..." -ForegroundColor Cyan
& "C:\Tools\nssm.exe" restart PrintAgent-br001
Start-Sleep -Seconds 4
Get-Service PrintAgent-br001 | Format-List Status
Write-Host "`nPress any key..." -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")