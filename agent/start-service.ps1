# Just start the service (no install)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait
  exit
}

Write-Host "=== Starting PrintAgent-br001 ===" -ForegroundColor Green
& "C:\Tools\nssm.exe" start PrintAgent-br001
Start-Sleep -Seconds 4
Get-Service PrintAgent-br001 | Format-List Name, Status, StartType
Write-Host "=== Done. Press any key ===" -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")