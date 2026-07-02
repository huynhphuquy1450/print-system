# Fix service AppDirectory and restart
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

Write-Host "=== Stopping service ===" -ForegroundColor Yellow
& $NssmPath stop $ServiceName
Start-Sleep -Seconds 2

Write-Host "=== Setting AppDirectory ===" -ForegroundColor Cyan
& $NssmPath set $ServiceName AppDirectory $AppDir

# Verify
Write-Host "Verify AppDirectory: $((& $NssmPath get $ServiceName AppDirectory))" -ForegroundColor Cyan

# Set env so dotenv can find .env (alternative: set env var DOTENV_PATH)
# Actually agent.js uses require('dotenv').config() which looks in process.cwd() by default
# So AppDirectory is the right fix.

Write-Host "=== Starting service ===" -ForegroundColor Cyan
& $NssmPath start $ServiceName
Start-Sleep -Seconds 5

Write-Host "`n=== Service status ===" -ForegroundColor Green
Get-Service $ServiceName | Format-List Name, Status, StartType

Write-Host "`n=== Stdout log (last 15) ===" -ForegroundColor Green
$stdoutLog = Join-Path $AppDir 'logs\service-stdout.log'
if (Test-Path $stdoutLog) {
  Get-Content $stdoutLog -Tail 15
}
Write-Host "`n=== Stderr log (last 15) ===" -ForegroundColor Yellow
$stderrLog = Join-Path $AppDir 'logs\service-stderr.log'
if (Test-Path $stderrLog) {
  Get-Content $stderrLog -Tail 15
}

Write-Host "`n=== Press any key ===" -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
