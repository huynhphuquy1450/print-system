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

# Từ đây làm việc với nssm (lệnh native). PS 5.1 + EAP='Stop' biến MỌI dòng stderr của native — kể cả
# thông báo vô hại như "SERVICE_START_PENDING" hay "Can't open service!" — thành lỗi terminating, giết
# script giữa chừng (2>$null / 2>&1 không chặn được ở tầng này). Chuyển 'Continue' để chạy trọn; kết
# quả thật được kiểm bằng Get-Service + dump log bên dưới.
$ErrorActionPreference = 'Continue'

# Remove old service if exists.
# nssm ghi "Can't open service!" ra STDERR khi service CHƯA tồn tại (cài lần đầu). Với
# $ErrorActionPreference='Stop', PowerShell 5.1 biến stderr của lệnh native thành lỗi terminating →
# giết script TRƯỚC khi kịp `nssm install` (2>$null không chặn được ở tầng EAP). Chỉ stop/remove khi
# service thật sự tồn tại để không sinh stderr đó.
if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
  & $NssmPath stop $ServiceName 2>&1 | Out-Null
  & $NssmPath remove $ServiceName confirm 2>&1 | Out-Null
}

# Install
Write-Host "Installing service..." -ForegroundColor Cyan
& $NssmPath install $ServiceName $NodeExe $AgentScript
& $NssmPath set $ServiceName AppDirectory $AppDir
# B4: Node KHÔNG đọc Windows cert store → set NODE_EXTRA_CA_CERTS để service tin Step-CA khi gọi API
# HTTPS nội bộ (axios cũng tự nạp CA này trong agent.js; đây là lớp phòng vệ thứ hai, bao cả fetch).
& $NssmPath set $ServiceName AppEnvironmentExtra "NODE_EXTRA_CA_CERTS=$(Join-Path $AppDir 'root_ca.crt')"
& $NssmPath set $ServiceName AppStdout (Join-Path $LogDir 'service-stdout.log')
& $NssmPath set $ServiceName AppStderr (Join-Path $LogDir 'service-stderr.log')
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName AppThrottle 10000

# Start (gộp stderr vào stdout để stderr không thành lỗi terminating dưới EAP=Stop → luôn chạy tiếp
# tới phần kiểm tra trạng thái + dump log bên dưới dù start có cảnh báo)
Write-Host "Starting service..." -ForegroundColor Cyan
& $NssmPath start $ServiceName 2>&1 | Write-Host
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
