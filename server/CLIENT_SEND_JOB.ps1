# Send-JobToPrinter.ps1
# Gửi file PDF qua Print Service API -> agent in ra máy in thật
# Chạy từ bất kỳ máy Windows nào (cùng VPN/internet tới VPS)

param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$PdfPath,

  [Parameter(Mandatory=$false)]
  [string]$BranchId = "br_001",

  [Parameter(Mandatory=$false)]
  [string]$PrinterName = "",   # để trống = máy in default của agent

  [Parameter(Mandatory=$false)]
  [string]$ApiBase = "http://160.250.133.192:3000",

  [Parameter(Mandatory=$false)]
  [string]$ClientId = "cli_3844de865fa7df32",

  [Parameter(Mandatory=$false)]
  [string]$ClientSecret = "<CLIENT_SECRET>"
)

$ErrorActionPreference = 'Stop'

# === Validate input ===
if (-not (Test-Path -LiteralPath $PdfPath -PathType Leaf)) {
  Write-Host "[FATAL] File not found: $PdfPath" -ForegroundColor Red
  exit 1
}

$ext = [System.IO.Path]::GetExtension($PdfPath).ToLower()
if ($ext -ne ".pdf") {
  Write-Host "[FATAL] File phải là .pdf (hiện tại: $ext)" -ForegroundColor Red
  exit 1
}

# === Validate PDF magic bytes ===
$firstBytes = [System.IO.File]::ReadAllBytes($PdfPath)[0..4] | ForEach-Object { [char]$_ }
$magic = -join $firstBytes
if ($magic -ne "%PDF-") {
  Write-Host "[FATAL] File không phải PDF hợp lệ (magic: '$magic', phải là '%PDF-')" -ForegroundColor Red
  exit 1
}

$fileSize = (Get-Item -LiteralPath $PdfPath).Length
Write-Host "[1/4] PDF OK: $PdfPath ($fileSize bytes, magic=$magic)" -ForegroundColor Green

# === Login -> JWT ===
Write-Host "[2/4] Login..." -ForegroundColor Cyan
$loginBody = @{ client_id = $ClientId; client_secret = $ClientSecret } | ConvertTo-Json
try {
  $loginResp = Invoke-RestMethod -Uri "$ApiBase/api/auth/login" `
    -Method POST -ContentType "application/json" -Body $loginBody -TimeoutSec 10
}
catch {
  Write-Host "[FATAL] Login fail: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
$jwt = $loginResp.token
Write-Host "       OK (token type=$($loginResp.token_type), expires_in=$($loginResp.expires_in))" -ForegroundColor Green

# === Encode PDF -> base64 ===
Write-Host "[3/4] Encoding PDF..." -ForegroundColor Cyan
$pdfBytes = [System.IO.File]::ReadAllBytes($PdfPath)
$pdfB64 = [Convert]::ToBase64String($pdfBytes)
Write-Host "       base64 length: $($pdfB64.Length) chars" -ForegroundColor Green

# === Send job ===
Write-Host "[4/4] Sending job..." -ForegroundColor Cyan
$body = @{
  branch_id  = $BranchId
  pdf_base64 = $pdfB64
  metadata   = @{
    source = "send-job.ps1"
    file   = Split-Path $PdfPath -Leaf
    size   = $fileSize
    sent_at = (Get-Date).ToString("o")
  }
}
if ($PrinterName) { $body.printer = $PrinterName }

$jsonBody = $body | ConvertTo-Json -Depth 5 -Compress
$headers = @{ Authorization = "Bearer $jwt"; "Content-Type" = "application/json" }

try {
  $resp = Invoke-RestMethod -Uri "$ApiBase/api/print-jobs" `
    -Method POST -Headers $headers -Body $jsonBody -TimeoutSec 30
}
catch {
  Write-Host "[FATAL] Send fail: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    Write-Host "       Response: $($reader.ReadToEnd())" -ForegroundColor Red
  }
  exit 1
}

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "  JOB QUEUED SUCCESSFULLY" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host "  job_id:  $($resp.job_id)" -ForegroundColor White
Write-Host "  status:  $($resp.status)" -ForegroundColor White
Write-Host "  branch:  $BranchId" -ForegroundColor White
Write-Host ""
Write-Host "Theo dõi:" -ForegroundColor Cyan
Write-Host "  - Agent log (trên máy có agent): Get-Content C:\print-system\logs\`$(Get-Date -Format yyyy-MM-dd).log -Tail 20 -Wait" -ForegroundColor Gray
Write-Host "  - Job status (sau vài giây):" -ForegroundColor Gray
Write-Host "      `$jwt = '$($jwt.Substring(0,30))...'" -ForegroundColor Gray
Write-Host "      Invoke-RestMethod -Uri '$ApiBase/api/print-jobs/$($resp.job_id)' -Headers @{Authorization=`"Bearer `$jwt`"}" -ForegroundColor Gray
