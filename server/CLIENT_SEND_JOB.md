# Gửi file PDF qua API — Test từ máy bất kỳ

3 cách test gửi file PDF qua Print Service API → agent in ra máy in thật.

## 1. Windows PowerShell (khuyến nghị)

### Setup 1 lần

Mở PowerShell trên máy Windows a:

```powershell
mkdir C:\print-system\scripts -Force
scp <user>@<SERVER_IP>:<INSTALL_DIR>/CLIENT_SEND_JOB.ps1 C:\print-system\scripts\send-job.ps1
```

### Chạy

```powershell
# Cú pháp cơ bản
powershell -ExecutionPolicy Bypass -File C:\print-system\scripts\send-job.ps1 "C:\path\to\file.pdf"

# Đổi branch
powershell -ExecutionPolicy Bypass -File C:\print-system\scripts\send-job.ps1 "D:\contract.pdf" -BranchId br_002

# Đổi máy in cụ thể
powershell -ExecutionPolicy Bypass -File C:\print-system\scripts\send-job.ps1 "D:\contract.pdf" -PrinterName "Brother HL-L2360D series (Copy 1)"
```

### Output mẫu

```
[1/4] PDF OK: D:\contract.pdf (125840 bytes, magic=%PDF-)
[2/4] Login...
       OK (token type=Bearer, expires_in=7d)
[3/4] Encoding PDF...
       base64 length: 167792 chars
[4/4] Sending job...
================================
  JOB QUEUED SUCCESSFULLY
================================
  job_id:  job_1782063000123_abcd1234
  status:  queued
  branch:  br_001
```

## 2. Mac / Linux / WSL / VPS

### Setup 1 lần

```bash
# SSH vào VPS hoặc tải về máy local
scp <user>@<SERVER_IP>:<INSTALL_DIR>/scripts/send-job.sh ~/send-job.sh
chmod +x ~/send-job.sh
```

### Chạy

```bash
# Cú pháp cơ bản
./send-job.sh ~/Documents/contract.pdf

# Đổi branch
./send-job.sh contract.pdf -b br_002

# Đổi máy in cụ thể
./send-job.sh contract.pdf -b br_001 -p "Brother HL-L2360D"

# Test nhanh từ VPS (không cần copy file)
<INSTALL_DIR>/scripts/send-job.sh /tmp/test.pdf
```

## 3. Windows CMD (wrapper cho PowerShell)

Nếu thích CMD hơn PowerShell:

```cmd
:: Setup 1 lần
scp <user>@<SERVER_IP>:<INSTALL_DIR>/scripts/send-job.bat C:\print-system\scripts\send-job.bat

:: Chạy
C:\print-system\scripts\send-job.bat "C:\path\to\file.pdf"
C:\print-system\scripts\send-job.bat "D:\file.pdf" -b br_001
```

## 4. Test 1-dòng với curl (không cần file script)

Từ bất kỳ máy nào có `curl` + `base64` + `jq`:

```bash
# 1. Login -> lấy JWT
JWT=$(curl -s -X POST http://<SERVER_IP>:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"<CLIENT_ID>","client_secret":"<CLIENT_SECRET>"}' \
  | jq -r .token)

# 2. Encode PDF + gửi job
PDF_B64=$(base64 -w 0 contract.pdf)
curl -X POST http://<SERVER_IP>:3000/api/print-jobs \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d "{\"branch_id\":\"br_001\",\"pdf_base64\":\"$PDF_B64\",\"metadata\":{\"source\":\"curl\"}}"
```

PowerShell 1-dòng tương đương:

```powershell
$env:JWT = (Invoke-RestMethod -Uri "http://<SERVER_IP>:3000/api/auth/login" -Method POST -ContentType "application/json" -Body '{"client_id":"<CLIENT_ID>","client_secret":"<CLIENT_SECRET>"}').token
$env:B64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes("C:\path\to\file.pdf"))
Invoke-RestMethod -Uri "http://<SERVER_IP>:3000/api/print-jobs" -Method POST -Headers @{Authorization="Bearer $env:JWT"} -ContentType "application/json" -Body "{`"branch_id`":`"br_001`",`"pdf_base64`":`"$env:B64`"}"
```

## 5. Tùy chọn (parameters)

Cả 3 cách đều dùng chung:

| Flag | Mặc định | Ý nghĩa |
|---|---|---|
| `-b` / `-BranchId` | `br_001` | Branch ID (cần agent đang subscribe topic này) |
| `-p` / `-PrinterName` | `""` (default) | Tên máy in cụ thể (vd: `"Brother HL-L2360D series (Copy 1)"`). Bỏ trống = default printer |
| `-a` / `-ApiBase` | `http://<SERVER_IP>:3000` | URL server (đổi khi test local) |
| `-ClientId` / `-ClientSecret` | giá trị test | Credentials (đổi khi có client thật của HQ) |

Env vars (cho Bash):

```bash
export API_BASE="http://my-server:3000"
export CLIENT_ID="cli_xxx"
export CLIENT_SECRET="yyy"
./send-job.sh file.pdf
```

## 6. Flow xảy ra sau khi a chạy lệnh

```
[Your machine]                  [VPS <SERVER_IP>]              [Agent br_001 machine]
   |                                    |                                    |
   |-- POST /api/print-jobs (PDF) ----->|                                    |
   |                                    |-- insert DB                       |
   |                                    |-- save file to storage/           |
   |                                    |-- publish MQTT ---- topic: br_001/jobs
   |<-- 201 {job_id} -------------------|                                    |
   |                                    |                                    |
   |                                    |<----- MQTT message ---------------|
   |                                    |                                    |-- download PDF
   |                                    |                                    |-- in qua máy in
   |                                    |                                    |
   |                                    |<-- POST /:id/status {printed} ----|
   |                                    |-- update DB                       |
```

## 7. Verify sau khi gửi

**Trên server (VPS):**
```bash
# Check job status (sau 1-2s)
sqlite3 <INSTALL_DIR>/data/jobs.db "SELECT id, status, printed_at FROM jobs ORDER BY created_at DESC LIMIT 1"

# Realtime log
pm2 logs print-service --raw
```

**Trên máy agent (Windows):**
```powershell
# Log agent realtime
Get-Content C:\print-system\logs\2026-06-21.log -Tail 20 -Wait
```

## 8. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `[FATAL] File not found` | Sai đường dẫn | Dùng đường dẫn tuyệt đối, kiểm tra file tồn tại |
| `[FATAL] File phải là .pdf` | Extension sai | Đổi tên `.pdf` (không cần nội dung thật) |
| `[FATAL] File không phải PDF hợp lệ` | Magic bytes sai | Mở file → Save As → PDF (qua Word/Acrobat/Chrome Print) |
| `[FATAL] Login fail` | Sai client_id/secret, hoặc VPS offline | `Test-NetConnection <SERVER_IP> -Port 3000` (Windows) / `nc -zv <SERVER_IP> 3000` (Linux) |
| `Send fail: HTTP 404` | Branch không tồn tại | Check `curl http://<SERVER_IP>:3000/api/branches -H "Authorization: Bearer $JWT"` |
| `Send fail: HTTP 429` | Login rate-limit (5/phút) | Đợi 1 phút |
| Job in OK nhưng ở máy in khác | Nhiều agent subscribe cùng br_001 | Tắt các agent test khác |
| Job không in, status stuck `sent` | Agent offline hoặc không chạy | Start NSSM service, check log agent |

## 9. File locations

**Trên VPS** (`<INSTALL_DIR>/`):
- `scripts/send-job.sh` — Bash script (Mac/Linux/WSL)
- `CLIENT_SEND_JOB.ps1` — PowerShell script (Windows)
- `CLIENT_SEND_JOB.md` — File này

**Trên máy a (Windows)** sau khi setup:
- `C:\print-system\scripts\send-job.ps1` — bản copy
- `C:\print-system\scripts\send-job.bat` — wrapper CMD
