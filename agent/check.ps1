# Health check for Print Agent
# Run this when something seems wrong

$ErrorActionPreference = 'Continue'

Write-Host "=== Print Agent Health Check ===" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# 1. Service status
Write-Host "1. Windows Service Status:" -ForegroundColor Yellow
$svc = Get-Service PrintAgent-br001 -ErrorAction SilentlyContinue
if ($svc) {
  $svc | Format-List Name, Status, StartType
  if ($svc.Status -ne 'Running') {
    Write-Host "  *** SERVICE NOT RUNNING! Try: nssm start PrintAgent-br001 ***" -ForegroundColor Red
  }
} else {
  Write-Host "  Service not installed!" -ForegroundColor Red
}
Write-Host ""

# 2. Recent log lines
Write-Host "2. Last 10 log lines (today/yesterday):" -ForegroundColor Yellow
$logFile = "C:\print-system\logs\$(Get-Date -Format 'yyyy-MM-dd').log"
if (-not (Test-Path $logFile)) {
  $logFile = "C:\print-system\logs\$(Get-Date).AddDays(-1).ToString('yyyy-MM-dd').log"
}
if (Test-Path $logFile) {
  Get-Content $logFile -Tail 10
} else {
  Write-Host "  (no log file)" -ForegroundColor DarkYellow
}
Write-Host ""

# 3. Pending tmp files
Write-Host "3. Pending tmp files:" -ForegroundColor Yellow
$tmpDir = "C:\print-system\agents\agent-01\tmp"
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
try {
  $h = Invoke-RestMethod "http://160.250.133.192:3000/health" -TimeoutSec 5
  Write-Host "  HTTP /health: status=$($h.status), mqtt=$($h.mqtt), db=$($h.db), uptime=$($h.uptime_seconds)s" -ForegroundColor Green
} catch {
  Write-Host "  *** Server unreachable: $($_.Exception.Message) ***" -ForegroundColor Red
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