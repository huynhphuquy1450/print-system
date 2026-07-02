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
  [string]$BranchName,
  [string]$Location,
  [string]$SumatraUrl = 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip'
)

$ErrorActionPreference = 'Stop'
# PS 5.1 mặc định có thể chỉ bật TLS1.0 → github.com / nssm.cc / sumatra (yêu cầu TLS1.2) sẽ fail
# "Could not create SSL/TLS secure channel". Ép TLS1.2 trước mọi Invoke-WebRequest. Tắt progress bar
# (IWR trên PS5.1 chậm 10-50x khi vẽ progress lúc tải file lớn).
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$ProgressPreference = 'SilentlyContinue'

# --- Resolve các đường dẫn tương đối TRƯỚC khi đổi thư mục / nâng quyền ---
$InstallJson = (Resolve-Path -LiteralPath $InstallJson).Path
if (-not $CaFile) {
  $candidate = Join-Path $PSScriptRoot 'root_ca.crt'
  if (Test-Path $candidate) { $CaFile = $candidate }
}

# --- Tự nâng quyền (forward params) ---
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Requesting UAC elevation..." -ForegroundColor Yellow
  $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -InstallJson `"$InstallJson`" -AppDir `"$AppDir`" -ServiceName `"$ServiceName`" -NssmPath `"$NssmPath`" -SumatraUrl `"$SumatraUrl`""
  if ($CaFile) { $arg += " -CaFile `"$CaFile`"" }
  if ($BranchName) { $arg += " -BranchName `"$BranchName`"" }
  if ($Location) { $arg += " -Location `"$Location`"" }
  # -PassThru + kiểm tra ExitCode: trước đây exit trơn nên cửa sổ nâng quyền chết giữa chừng
  # (vd install-service fail) mà shell gốc vẫn im lặng như thành công.
  $p = Start-Process -FilePath "powershell.exe" -ArgumentList $arg -Verb RunAs -Wait -PassThru
  $code = $p.ExitCode
  if ($null -eq $code) {
    # RunAs + PassThru trên PS 5.1 hiếm khi không đọc được ExitCode — hướng người dùng xem log
    Write-Host "Installer đã chạy xong (không đọc được exit code). Kiểm tra: Get-Service PrintAgent-* và log $AppDir\logs\install-*.log" -ForegroundColor Yellow
    exit 0
  }
  if ($code -ne 0) {
    Write-Host "INSTALLER THẤT BẠI (exit $code). Xem log: $AppDir\logs\install-*.log" -ForegroundColor Red
  } else {
    Write-Host "Installer hoàn tất OK." -ForegroundColor Green
  }
  exit $code
}

Write-Host "=== Print Agent installer (elevated) ===" -ForegroundColor Green
Write-Host "AppDir=$AppDir  Service=$ServiceName" -ForegroundColor DarkGray

# Transcript log — lỗi ở cửa sổ nâng quyền (tự đóng) vẫn truy được nguyên nhân từ file
try {
  $null = New-Item -ItemType Directory -Force -Path (Join-Path $AppDir 'logs')
  Start-Transcript -Path (Join-Path $AppDir ("logs\install-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))) | Out-Null
} catch {}

# Lỗi bất kỳ: hiện rõ + dừng chờ đọc rồi mới đóng cửa sổ (trap chạy với EAP=Stop ở trên)
trap {
  Write-Host "`nLỖI: $_" -ForegroundColor Red
  Write-Host ($_.ScriptStackTrace) -ForegroundColor DarkGray
  try { Stop-Transcript | Out-Null } catch {}
  if (-not $BranchName) { Read-Host "Nhấn Enter để đóng" | Out-Null }
  exit 1
}

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
  try {
    Invoke-WebRequest -Uri $SumatraUrl -OutFile $zip -TimeoutSec 120
    Expand-Archive $zip -DestinationPath (Join-Path $AppDir 'tools') -Force
    $exe = Get-ChildItem -Path (Join-Path $AppDir 'tools') -Filter 'SumatraPDF-*.exe' | Select-Object -First 1
    if ($exe) { Move-Item $exe.FullName $sumatra -Force }
  } catch {
    Write-Host "  Tải SumatraPDF thất bại: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  if (-not (Test-Path $sumatra)) {
    Write-Host "FATAL: Không lấy được SumatraPDF.exe. Tải thủ công SumatraPDF portable 64-bit, đổi tên thành SumatraPDF.exe, đặt vào $sumatra rồi chạy lại." -ForegroundColor Red
    exit 1
  }
}

# --- 5) Root CA -> Trusted Root (Local Machine) ---
# Lưu ý: import vào Windows Trusted Root giúp trình duyệt/WinHTTP, KHÔNG giúp Node (agent dùng CA này
# qua MQTT_CA_FILE + axios httpsAgent). Quan trọng là COPY file root_ca.crt vào $AppDir để runtime đọc.
$caInstalled = $false
if ($CaFile -and (Test-Path $CaFile)) {
  Write-Host "Cài root CA vào Trusted Root..." -ForegroundColor Cyan
  Copy-Item $CaFile -Destination (Join-Path $AppDir 'root_ca.crt') -Force
  Import-Certificate -FilePath (Join-Path $AppDir 'root_ca.crt') -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  $caInstalled = $true
} else {
  Write-Host "CẢNH BÁO: không tìm thấy root_ca.crt — agent SẼ LỖI MQTTS/HTTPS lúc chạy (không online). Cài tay theo CA_INSTALL.md." -ForegroundColor Yellow
}

# --- 6) NSSM ---
# Chỉ tải từ nssm.cc chính thức — KHÔNG dùng mirror GitHub cá nhân (rủi ro chuỗi cung ứng: binary
# không rõ nguồn gốc/toàn vẹn). Dừng ngay khi $NssmPath đã có.
if (-not (Test-Path $NssmPath)) {
  Write-Host "Tải NSSM..." -ForegroundColor Cyan

  # Zip chính thức từ nssm.cc (giải nén lấy win64\nssm.exe)
  try {
    $nzip = Join-Path $env:TEMP 'nssm.zip'
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $nzip -TimeoutSec 30
    $ndir = Join-Path $env:TEMP 'nssm-extract'
    Expand-Archive $nzip -DestinationPath $ndir -Force
    $nexe = Get-ChildItem -Path $ndir -Recurse -Filter 'nssm.exe' | Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
    if ($nexe) { Copy-Item $nexe.FullName $NssmPath -Force; Write-Host "  NSSM từ nssm.cc OK" -ForegroundColor DarkGray }
  } catch {
    Write-Host "  Tải NSSM từ nssm.cc thất bại: $($_.Exception.Message)" -ForegroundColor Yellow
  }

  if (-not (Test-Path $NssmPath)) {
    Write-Host "FATAL: Không tải được nssm.exe từ nssm.cc." -ForegroundColor Red
    Write-Host "Vui lòng tải thủ công:" -ForegroundColor Red
    Write-Host "  1. Vào https://nssm.cc/download, tải bản 2.24 (hoặc mới hơn)." -ForegroundColor Red
    Write-Host "  2. Giải nén, lấy file win64\nssm.exe." -ForegroundColor Red
    Write-Host "  3. Đặt file vào: $NssmPath" -ForegroundColor Red
    Write-Host "  4. Chạy lại installer." -ForegroundColor Red
    exit 1
  }
}

# --- 7) npm install ---
Write-Host "npm install..." -ForegroundColor Cyan
Push-Location $AppDir
try {
  & npm install --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm install lỗi ($LASTEXITCODE)" }

  # --- 8) Đăng ký branch (hỏi tên + địa điểm, ghi .env đầy đủ) ---
  Write-Host "`n=== Đăng ký trạm ===" -ForegroundColor Green
  # B4: cho fetch của register (Node) tin Step-CA khi server_url là HTTPS nội bộ — Node KHÔNG đọc
  # Windows cert store. root_ca.crt đã copy vào $AppDir ở bước 5 (nếu có CA).
  $caRuntime = Join-Path $AppDir 'root_ca.crt'
  if (Test-Path $caRuntime) { $env:NODE_EXTRA_CA_CERTS = $caRuntime }
  # B11: hỗ trợ cài không tương tác — nếu truyền -BranchName/-Location thì bỏ qua prompt readline.
  if ($BranchName) { $env:REGISTER_BRANCH_NAME = $BranchName }
  if ($Location) { $env:REGISTER_LOCATION = $Location }
  & node agent.js --register $InstallJson
  if ($LASTEXITCODE -ne 0) { throw "Đăng ký branch thất bại ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

# --- 9) Cài service ---
# B6: đặt tên service theo BRANCH_ID thật (server cấp động) để cài nhiều agent không đè nhau và để
# check.ps1 / Get-Service tìm đúng. Chỉ tự suy khi người dùng KHÔNG override -ServiceName.
if ($ServiceName -eq 'PrintAgent-br001') {
  $envPath = Join-Path $AppDir '.env'
  if (Test-Path $envPath) {
    $branchLine = Select-String -Path $envPath -Pattern '^BRANCH_ID=(.+)$' | Select-Object -First 1
    if ($branchLine) {
      $bid = $branchLine.Matches[0].Groups[1].Value.Trim()
      if ($bid) { $ServiceName = "PrintAgent-$bid" }
    }
  }
}
Write-Host "Service name: $ServiceName" -ForegroundColor DarkGray

$NodeExe = (Get-Command node).Source
# Gọi qua process con (-File) thay vì `&`: install-service.ps1 có nhiều nhánh `exit 1` —
# chạy inline thì exit đó giết luôn installer giữa chừng, không kịp báo lỗi/smoke test.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AppDir 'install-service.ps1') `
  -ServiceName $ServiceName -NssmPath $NssmPath -NodeExe $NodeExe -AppDir $AppDir -NoPause
if ($LASTEXITCODE -ne 0) { throw "install-service.ps1 thất bại (exit $LASTEXITCODE) — xem thông báo đỏ phía trên." }

# Kiểm chứng service thật sự tồn tại + Running (chờ tối đa 20s) — không tin exit code suông
$svcOk = $false
for ($i = 0; $i -lt 10; $i++) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -eq 'Running') { $svcOk = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $svcOk) {
  Write-Host "Service '$ServiceName' KHÔNG chạy. Cài lại thủ công bằng:" -ForegroundColor Red
  Write-Host "  powershell -ExecutionPolicy Bypass -File $AppDir\install-service.ps1 -ServiceName $ServiceName -NoPause" -ForegroundColor Yellow
  throw "Service không ở trạng thái Running sau khi cài."
}
Write-Host "✓ Service '$ServiceName' đang Running." -ForegroundColor Green

# --- 10) Smoke test ---
$check = Join-Path $AppDir 'check.ps1'
if (Test-Path $check) {
  Write-Host "`n=== Smoke test (check.ps1) ===" -ForegroundColor Green
  & powershell -ExecutionPolicy Bypass -File $check -ServiceName $ServiceName -AppDir $AppDir
}

if ($caInstalled) {
  Write-Host "`n✓ Hoàn tất. Service '$ServiceName' đã chạy. In thử 1 job từ ERP để xác nhận." -ForegroundColor Green
} else {
  Write-Host "`n⚠ Cài XONG nhưng CHƯA có root_ca.crt → service sẽ lỗi TLS (MQTTS/HTTPS) và KHÔNG online." -ForegroundColor Red
  Write-Host "  Đặt root_ca.crt vào $AppDir theo CA_INSTALL.md rồi chạy: nssm restart $ServiceName" -ForegroundColor Red
}
try { Stop-Transcript | Out-Null } catch {}
Write-Host "Press any key to close." -ForegroundColor Green
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
