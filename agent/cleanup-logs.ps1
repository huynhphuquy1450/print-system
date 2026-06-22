# Cleanup stale log + tmp files
# - Delete log files older than 30 days
# - Delete tmp PDF files older than 1 hour (in case of crash leftover)

$ErrorActionPreference = 'SilentlyContinue'

# Logs
$logDir = "C:\print-system\logs"
Get-ChildItem "$logDir\*.log" -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | ForEach-Object {
  Write-Host "Removing old log: $($_.FullName)"
  Remove-Item $_.FullName -Force
}

# Tmp PDFs
$tmpDir = "C:\print-system\agents\agent-01\tmp"
Get-ChildItem "$tmpDir\*.pdf" -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-1) } | ForEach-Object {
  Write-Host "Removing stale tmp: $($_.FullName)"
  Remove-Item $_.FullName -Force
}

Write-Host "Cleanup done at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"