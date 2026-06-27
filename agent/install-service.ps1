# Self-elevating PowerShell script to install NSSM service
# Run this from normal PowerShell - it will re-launch itself elevated.
#
# Params (default = giá trị cũ → chạy không tham số vẫn y như trước):
#   -ServiceName  tên Windows service (NSSM)
#   -NssmPath     đường dẫn nssm.exe
#   -NodeExe      đường dẫn node.exe
#   -AppDir       thư mục agent (chứa agent.js, .env, logs/)
#   -NoPause      bỏ qua ReadKey cuối (để installer gọi không bị treo)
param(
  [string]$ServiceName = 'PrintAgent-br001',
  [string]$NssmPath = 'C:\Tools\nssm.exe',
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$AppDir = 'C:\print-system',
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

# If not admin, re-launch with UAC (forward params)
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Requesting UAC elevation..." -ForegroundColor Yellow
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ServiceName `"$ServiceName`" -NssmPath `"$NssmPath`" -NodeExe `"$NodeExe`" -AppDir `"$AppDir`""
  if ($NoPause) { $arg += " -NoPause" }
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait
  exit
}

# === Now we are elevated ===
Write-Host "=== Installing $ServiceName service (elevated) ===" -ForegroundColor Green

$AgentScript = Join-Path $AppDir 'agent.js'
$LogDir = Join-Path $AppDir 'logs'

# Check files exist
foreach ($f in @($NssmPath, $NodeExe, $AgentScript)) {
  if (-not (Test-Path $f)) {
    Write-Host "FATAL: Missing $f" -ForegroundColor Red
    if (-not $NoPause) { pause }
    exit 1
  }
}

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# Remove old service if exists
& $NssmPath stop $ServiceName 2>$null
& $NssmPath remove $ServiceName confirm 2>$null

# Install
Write-Host "Installing service..." -ForegroundColor Cyan
& $NssmPath install $ServiceName $NodeExe $AgentScript
& $NssmPath set $ServiceName AppDirectory $AppDir
& $NssmPath set $ServiceName AppStdout (Join-Path $LogDir 'service-stdout.log')
& $NssmPath set $ServiceName AppStderr (Join-Path $LogDir 'service-stderr.log')
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName AppThrottle 10000

# Start
Write-Host "Starting service..." -ForegroundColor Cyan
& $NssmPath start $ServiceName
Start-Sleep -Seconds 4

# Verify
Write-Host "`n=== Service status ===" -ForegroundColor Green
Get-Service $ServiceName | Format-List Name, Status, StartType

Write-Host "`n=== Recent log (stdout) ===" -ForegroundColor Green
$stdout = Join-Path $LogDir 'service-stdout.log'
if (Test-Path $stdout) {
  Get-Content $stdout -Tail 15
} else {
  Write-Host "(no stdout log yet)" -ForegroundColor Yellow
}

Write-Host "`n=== Done. ===" -ForegroundColor Green
if (-not $NoPause) {
  Write-Host "Press any key to close." -ForegroundColor Green
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
