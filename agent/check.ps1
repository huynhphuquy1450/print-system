# Health check for Print Agent
# Run this when something seems wrong
param(
  [string]$ServiceName = '',
  [string]$AppDir = 'C:\print-system'
)

$ErrorActionPreference = 'Continue'

# .env do install.ps1 / register.js ghi (cùng đường dẫn mà agent.js đọc lúc chạy): dùng để suy ra
# tên service thật (PrintAgent-<BRANCH_ID>) và API_URL thay vì hardcode theo trạm đầu tiên (br001).
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
    Write-Host "CẢNH BÁO: Không tìm thấy BRANCH_ID trong $envPath — dùng -ServiceName để chỉ định tên service." -ForegroundColor Red
  }
}

Write-Host "=== Print Agent Health Check ===" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# 1. Service status
Write-Host "1. Windows Service Status:" -ForegroundColor Yellow
if ($ServiceName) {
  $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
  if ($svc) {
    $svc | Format-List Name, Status, StartType
    if ($svc.Status -ne 'Running') {
      Write-Host "  *** SERVICE NOT RUNNING! Try: nssm start $ServiceName ***" -ForegroundColor Red
    }
  } else {
    Write-Host "  Service not installed!" -ForegroundColor Red
  }
} else {
  Write-Host "  Bỏ qua: không rõ tên service (không có BRANCH_ID và không truyền -ServiceName)." -ForegroundColor Red
}
Write-Host ""

# 2. Recent log lines
Write-Host "2. Last 10 log lines (today/yesterday):" -ForegroundColor Yellow
# Agent đặt tên log theo UTC (toISOString) — dùng UtcNow để khớp, tránh false alarm lúc giao ngày.
$today = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
$logFile = Join-Path $AppDir "logs\$today.log"
if (-not (Test-Path $logFile)) {
  $yest = [DateTime]::UtcNow.AddDays(-1).ToString('yyyy-MM-dd')
  $logFile = Join-Path $AppDir "logs\$yest.log"
}
if (Test-Path $logFile) {
  Get-Content $logFile -Tail 10
} else {
  Write-Host "  (no log file)" -ForegroundColor DarkYellow
}
Write-Host ""

# 3. Pending tmp files
Write-Host "3. Pending tmp files:" -ForegroundColor Yellow
$tmpDir = Join-Path $AppDir 'agents\agent-01\tmp'
$tmpFiles = Get-ChildItem "$tmpDir\*.pdf" -File -ErrorAction SilentlyContinue
if ($tmpFiles) {
  $tmpFiles | Format-Table Name, @{N='Size(KB)';E={[math]::Round($_.Length/1KB,1)}}, LastWriteTime
  if ($tmpFiles.Count -gt 0) {
    Write-Host "  *** Stale tmp files - run scripts\cleanup-logs.ps1 ***" -ForegroundColor Red
  }
} else {
  Write-Host "  (clean)" -ForegroundColor Green
}
Write-Host ""

# 4. Server reachable
Write-Host "4. Server reachability:" -ForegroundColor Yellow
$apiUrl = Get-EnvValue -EnvPath $envPath -Key 'API_URL'
if ($apiUrl) {
  try {
    $h = Invoke-RestMethod "$apiUrl/health" -TimeoutSec 5
    Write-Host "  HTTP /health: status=$($h.status), mqtt=$($h.mqtt), db=$($h.db), uptime=$($h.uptime_seconds)s" -ForegroundColor Green
  } catch {
    Write-Host "  *** Server unreachable ($apiUrl): $($_.Exception.Message) ***" -ForegroundColor Red
  }
} else {
  Write-Host "  *** Không tìm thấy API_URL trong $envPath — bỏ qua kiểm tra server (không đoán URL để tránh ping nhầm server khác). ***" -ForegroundColor Red
}
Write-Host ""

# 5. Recent errors in event log
Write-Host "5. Recent NSSM events (errors/restarts):" -ForegroundColor Yellow
$events = Get-EventLog -LogName Application -Newest 20 -Source 'nssm' -ErrorAction SilentlyContinue | Where-Object { $_.Message -match "PrintAgent" -and ($_.Message -match "exited" -or $_.Message -match "less than") }
if ($events) {
  $events | Select-Object -First 5 | ForEach-Object {
    Write-Host "  $($_.TimeWritten) - $($_.Message.Substring(0, [Math]::Min(100, $_.Message.Length)))..." -ForegroundColor DarkYellow
  }
} else {
  Write-Host "  (no recent errors)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan