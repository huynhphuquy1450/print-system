# Restart service (elevated)
param(
  [string]$ServiceName = '',
  [string]$AppDir = 'C:\print-system',
  [string]$NssmPath = ''
)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ServiceName `"$ServiceName`" -AppDir `"$AppDir`" -NssmPath `"$NssmPath`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait
  exit
}

# Đọc .env do install.ps1 / register.js ghi để suy ra tên service (PrintAgent-<BRANCH_ID>) và tìm
# nssm.exe — tránh hardcode theo trạm cài đầu tiên (br001) trong khi mỗi trạm có BRANCH_ID riêng.
function Get-EnvValue {
  param([string]$EnvPath, [string]$Key)
  if (-not (Test-Path $EnvPath)) { return $null }
  $line = Select-String -Path $EnvPath -Pattern "^$Key=(.+)$" | Select-Object -First 1
  if ($line) { return $line.Matches[0].Groups[1].Value.Trim() }
  return $null
}

$envPath = Join-Path $AppDir '.env'
if (-not $ServiceName) {
  $branchId = Get-EnvValue -EnvPath $envPath -Key 'BRANCH_ID'
  if ($branchId) {
    $ServiceName = "PrintAgent-$branchId"
  } else {
    Write-Host "LỖI: Không tìm thấy BRANCH_ID trong $envPath — dùng -ServiceName để chỉ định tên service." -ForegroundColor Red
    exit 1
  }
}

if (-not $NssmPath) {
  foreach ($c in @('C:\Tools\nssm.exe', (Join-Path $AppDir 'tools\nssm.exe'))) {
    if (Test-Path $c) { $NssmPath = $c; break }
  }
  if (-not $NssmPath) {
    Write-Host "LỖI: Không tìm thấy nssm.exe (đã thử C:\Tools\nssm.exe và $AppDir\tools\nssm.exe). Dùng -NssmPath để chỉ định." -ForegroundColor Red
    exit 1
  }
}

Write-Host "Restarting $ServiceName..." -ForegroundColor Cyan
& $NssmPath restart $ServiceName
Start-Sleep -Seconds 4
Get-Service $ServiceName | Format-List Status
Write-Host "`nPress any key..." -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
