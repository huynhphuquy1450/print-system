# =====================================================================
# Print Agent — installer trọn gói 1 phát (Windows)
# =====================================================================
# Tự động hoá toàn bộ onboarding 1 máy chi nhánh:
#   1. (tự nâng quyền UAC)
#   2. kiểm tra Node >= 18 (thử cài qua winget nếu thiếu)
#   3. tạo cây thư mục C:\print-system\{tools, agents\agent-01\tmp, logs}
#   4. copy mã agent vào $AppDir
#   5. tải SumatraPDF portable -> tools\SumatraPDF.exe
#   6. cài root_ca.crt vào Trusted Root (Local Machine)
#   7. bảo đảm có nssm.exe
#   8. npm install --omit=dev
#   9. node agent.js --register <install.json>  (hỏi tên + địa điểm trạm,
#      ghi .env ĐẦY ĐỦ nhờ khối agent_env trong install.json)
#  10. cài + chạy Windows service qua install-service.ps1
#  11. smoke test bằng check.ps1
#
# Yêu cầu file đi kèm (đặt cạnh script này hoặc trong $AppDir):
#   - install.json   (HQ IT cấp từ gen-client.js — chứa client_id/secret + agent_env)
#   - root_ca.crt    (Step-CA root, distribute riêng — KHÔNG có trong repo)
#
# Chạy (PowerShell thường, sẽ tự xin UAC):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallJson .\install.json
# =====================================================================
param(
  [Parameter(Mandatory = $true)][string]$InstallJson,
  [string]$AppDir = 'C:\print-system',
  [string]$ServiceName = 'PrintAgent-br001',
  [string]$NssmPath = 'C:\Tools\nssm.exe',
  [string]$CaFile,
  [string]$SumatraUrl = 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip'
)

$ErrorActionPreference = 'Stop'

# --- Resolve các đường dẫn tương đối TRƯỚC khi đổi thư mục / nâng quyền ---
$InstallJson = (Resolve-Path -LiteralPath $InstallJson).Path
if (-not $CaFile) {
  $candidate = Join-Path $PSScriptRoot 'root_ca.crt'
  if (Test-Path $candidate) { $CaFile = $candidate }
}

# --- Tự nâng quyền (forward params) ---
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Requesting UAC elevation..." -ForegroundColor Yellow
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -InstallJson `"$InstallJson`" -AppDir `"$AppDir`" -ServiceName `"$ServiceName`" -NssmPath `"$NssmPath`""
  if ($CaFile) { $arg += " -CaFile `"$CaFile`"" }
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait
  exit
}

Write-Host "=== Print Agent installer (elevated) ===" -ForegroundColor Green
Write-Host "AppDir=$AppDir  Service=$ServiceName" -ForegroundColor DarkGray

# --- 1) Node >= 18 ---
function Get-NodeMajor {
  try {
    $v = (& node -v) 2>$null
    if ($v -match 'v(\d+)\.') { return [int]$Matches[1] }
  } catch {}
  return 0
}
$nodeMajor = Get-NodeMajor
if ($nodeMajor -lt 18) {
  Write-Host "Node >= 18 không tìm thấy (thấy major=$nodeMajor). Thử cài qua winget..." -ForegroundColor Yellow
  try {
    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
  } catch {
    Write-Host "winget thất bại." -ForegroundColor Red
  }
  $nodeMajor = Get-NodeMajor
  if ($nodeMajor -lt 18) {
    Write-Host "FATAL: Cần Node.js >= 18. Cài thủ công từ https://nodejs.org rồi chạy lại." -ForegroundColor Red
    exit 1
  }
}
Write-Host "Node OK (major=$nodeMajor)" -ForegroundColor Green

# --- 2) Cây thư mục ---
foreach ($d in @($AppDir, (Join-Path $AppDir 'tools'), (Join-Path $AppDir 'agents\agent-01\tmp'), (Join-Path $AppDir 'logs'), 'C:\Tools')) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# --- 3) Copy mã agent vào $AppDir (nếu chạy từ thư mục khác) ---
if ($PSScriptRoot -and ((Resolve-Path $PSScriptRoot).Path -ne (Resolve-Path $AppDir).Path)) {
  Write-Host "Copy mã agent -> $AppDir" -ForegroundColor Cyan
  foreach ($item in @('agent.js', 'register.js', 'package.json', 'package-lock.json')) {
    $src = Join-Path $PSScriptRoot $item
    if (Test-Path $src) { Copy-Item $src -Destination $AppDir -Force }
  }
  Get-ChildItem -Path $PSScriptRoot -Filter '*.ps1' | ForEach-Object { Copy-Item $_.FullName -Destination $AppDir -Force }
}

# --- 4) SumatraPDF ---
$sumatra = Join-Path $AppDir 'tools\SumatraPDF.exe'
if (Test-Path $sumatra) {
  Write-Host "SumatraPDF đã có, bỏ qua tải." -ForegroundColor DarkGray
} else {
  Write-Host "Tải SumatraPDF..." -ForegroundColor Cyan
  $zip = Join-Path $env:TEMP 'SumatraPDF.zip'
  Invoke-WebRequest -Uri $SumatraUrl -OutFile $zip
  Expand-Archive $zip -DestinationPath (Join-Path $AppDir 'tools') -Force
  $exe = Get-ChildItem -Path (Join-Path $AppDir 'tools') -Filter 'SumatraPDF-*.exe' | Select-Object -First 1
  if ($exe) { Move-Item $exe.FullName $sumatra -Force }
  if (-not (Test-Path $sumatra)) { Write-Host "FATAL: Không lấy được SumatraPDF.exe" -ForegroundColor Red; exit 1 }
}

# --- 5) Root CA -> Trusted Root (Local Machine) ---
if ($CaFile -and (Test-Path $CaFile)) {
  Write-Host "Cài root CA vào Trusted Root..." -ForegroundColor Cyan
  Copy-Item $CaFile -Destination (Join-Path $AppDir 'root_ca.crt') -Force
  Import-Certificate -FilePath (Join-Path $AppDir 'root_ca.crt') -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
} else {
  Write-Host "CẢNH BÁO: không tìm thấy root_ca.crt — kết nối TLS có thể lỗi. Cài tay theo CA_INSTALL.md." -ForegroundColor Yellow
}

# --- 6) NSSM ---
# nssm.cc hay 503 → thử lần lượt: zip chính thức, rồi mirror GitHub (nssm.exe win64 trực tiếp),
# cuối cùng winget. Dừng ngay khi $NssmPath đã có.
if (-not (Test-Path $NssmPath)) {
  Write-Host "Tải NSSM..." -ForegroundColor Cyan

  # 6a) Zip chính thức từ nssm.cc (giải nén lấy win64\nssm.exe)
  try {
    $nzip = Join-Path $env:TEMP 'nssm.zip'
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $nzip -TimeoutSec 30
    $ndir = Join-Path $env:TEMP 'nssm-extract'
    Expand-Archive $nzip -DestinationPath $ndir -Force
    $nexe = Get-ChildItem -Path $ndir -Recurse -Filter 'nssm.exe' | Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
    if ($nexe) { Copy-Item $nexe.FullName $NssmPath -Force; Write-Host "  NSSM từ nssm.cc OK" -ForegroundColor DarkGray }
  } catch {
    Write-Host "  nssm.cc thất bại ($($_.Exception.Message)), thử mirror GitHub..." -ForegroundColor Yellow
  }

  # 6b) Mirror GitHub — tải thẳng nssm.exe (win64 2.24, 331264 bytes)
  if (-not (Test-Path $NssmPath)) {
    $mirrors = @(
      'https://github.com/zhiyunai/nssm-2.24/raw/master/win64/nssm.exe',
      'https://github.com/imvickykumar999/Non-Sucking-Service-Manager/raw/main/win64/nssm.exe'
    )
    foreach ($m in $mirrors) {
      try {
        Invoke-WebRequest -Uri $m -OutFile $NssmPath -TimeoutSec 30
        if (Test-Path $NssmPath) { Write-Host "  NSSM từ mirror OK: $m" -ForegroundColor DarkGray; break }
      } catch {
        Write-Host "  Mirror thất bại: $m" -ForegroundColor Yellow
      }
    }
  }

  # 6c) winget (chốt chặn cuối)
  if (-not (Test-Path $NssmPath)) {
    Write-Host "  Thử winget..." -ForegroundColor Yellow
    & winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements
  }

  if (-not (Test-Path $NssmPath)) { Write-Host "FATAL: Không có nssm.exe tại $NssmPath" -ForegroundColor Red; exit 1 }
}

# --- 7) npm install ---
Write-Host "npm install..." -ForegroundColor Cyan
Push-Location $AppDir
try {
  & npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm install lỗi ($LASTEXITCODE)" }

  # --- 8) Đăng ký branch (hỏi tên + địa điểm, ghi .env đầy đủ) ---
  Write-Host "`n=== Đăng ký trạm ===" -ForegroundColor Green
  & node agent.js --register $InstallJson
  if ($LASTEXITCODE -ne 0) { throw "Đăng ký branch thất bại ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

# --- 9) Cài service ---
$NodeExe = (Get-Command node).Source
& (Join-Path $AppDir 'install-service.ps1') -ServiceName $ServiceName -NssmPath $NssmPath -NodeExe $NodeExe -AppDir $AppDir -NoPause

# --- 10) Smoke test ---
$check = Join-Path $AppDir 'check.ps1'
if (Test-Path $check) {
  Write-Host "`n=== Smoke test (check.ps1) ===" -ForegroundColor Green
  & powershell -ExecutionPolicy Bypass -File $check
}

Write-Host "`n✓ Hoàn tất. Service '$ServiceName' đã chạy. In thử 1 job từ ERP để xác nhận." -ForegroundColor Green
Write-Host "Press any key to close." -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
