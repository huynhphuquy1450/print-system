# Chạy thử Print Agent end-to-end trên máy Windows test

Runbook để **bạn tự chạy** trên 1 máy Windows test trước khi triển khai thật cho chi nhánh.
Mỗi bước ghi rõ kết quả mong đợi (PASS). Dán log lại nếu có bước FAIL.

> Bản fix này (PR `fix/installer-windows-e2e`) sửa các bug khiến E2E từng không chạy được:
> SERVER_PUBLIC_URL=localhost, winget NSSM, thiếu TLS1.2, agent không trust CA nội bộ cho API HTTPS,
> tên service không gắn branch_id, **B20** stderr nssm giết installer lúc cài máy sạch, **B21** job
> không kèm máy in treo 120s (thiếu `-print-to-default`), v.v. — đã verify E2E thật 2026-06-30 (PASS).
>
> ⚠️ **TRANSPORT THEO SERVER THỰC TẾ:** deployment hiện tại chạy print-service trên **HTTP:3000**
> (`HTTPS_ENABLED=false` ở server/.env); cổng 443 là app khác. MQTT broker 8883 dùng cert **self-signed**
> (KHÔNG phải Step-CA), `root_ca.crt` = chính cert broker. → dùng nhánh **HTTP** bên dưới. Nhánh HTTPS
> chỉ áp dụng khi server đã bật `HTTPS_ENABLED=true` + cấp cert nội bộ cho print-service.

---

## 0) Trên server (Linux, HQ) — tạo install.json

⚠️ **BẮT BUỘC set `SERVER_PUBLIC_URL`** (nếu không, install.json trỏ `localhost` → máy chi nhánh không
kết nối được; gen-client giờ sẽ **chặn** và báo lỗi).

```bash
cd /opt/print-system-github/server
# HTTP — ĐÚNG server hiện tại (HTTPS_ENABLED=false; print-service chỉ chạy 3000):
SERVER_PUBLIC_URL=http://<SERVER_IP>:3000 \
  OUTPUT_FILE=install.json node scripts/gen-client.js "Client Test"
# CHỈ dùng HTTPS khi server đã bật HTTPS_ENABLED=true + cấp cert nội bộ cho print-service:
# SERVER_PUBLIC_URL=https://<SERVER_IP>:443 OUTPUT_FILE=install.json node scripts/gen-client.js "Client Test"
```
Lấy `root_ca.crt` = cert broker MQTT (self-signed). Trên server:
`cp /etc/mosquitto/certs/server.crt root_ca.crt` (hoặc theo `agent/CA_INSTALL.md`).

**PASS:** in ra `install file: .../install.json`; mở file thấy `server_url` + `agent_env` (MQTT_URL,
API_URL, MQTT_CA_FILE...) đúng host thật (KHÔNG phải localhost).

---

## 1) Copy sang máy Windows test
Copy nguyên thư mục `agent\` + `install.json` + `root_ca.crt` (đặt cạnh `install.ps1`).

---

## 2) Chạy installer
Tương tác (hỏi tên/địa điểm):
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallJson .\install.json
```
Hoặc không tương tác (mới — B11):
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallJson .\install.json -BranchName "Chi nhánh Q1" -Location "HCM"
```
**PASS:** kết thúc in dòng xanh `✓ Hoàn tất. Service 'PrintAgent-br_xxxx' đã chạy.`
(Nếu in dòng đỏ `⚠ CHƯA có root_ca.crt` → thiếu CA, đặt root_ca.crt vào `C:\print-system` rồi
`nssm restart`.)

---

## 3) Xác minh — chạy từng lệnh, đối chiếu PASS

**a) .env đầy đủ:**
```powershell
Get-Content C:\print-system\.env
```
PASS: có đủ `BRANCH_ID, AGENT_TOKEN, MQTT_URL, MQTT_USER, MQTT_PASS, MQTT_CA_FILE, API_URL, SUMATRA_PATH`.

**b) Service chạy (tên = PrintAgent-<BRANCH_ID> động):**
```powershell
Get-Service PrintAgent-*
Get-Content C:\print-system\logs\service-stdout.log -Tail 30
```
PASS: `Status = Running`; log có `Agent starting` + `MQTT connected` + `Subscribed`; KHÔNG lặp
`[FATAL]`/crash-loop.

**c) Health check tổng hợp:**
```powershell
$bid = (Select-String C:\print-system\.env -Pattern '^BRANCH_ID=(.+)$').Matches[0].Groups[1].Value
powershell -ExecutionPolicy Bypass -File C:\print-system\check.ps1 -ServiceName "PrintAgent-$bid"
```
PASS: mục 1 service Running, mục 4 server reachable.

**d) Branch online ở server (chạy trên server hoặc qua API):**
```bash
# trên server, đổi <BRANCH_ID> cho khớp:
curl -s "http://localhost:3000/api/branches" | grep -i "<BRANCH_ID>"
```
PASS: branch mới có `status: online` (verifyAgent set ngầm khi agent heartbeat/poll).

**e) Máy in tự discover:**
```bash
curl -s "http://localhost:3000/api/printers?branch_id=<BRANCH_ID>"
```
PASS: máy in vật lý local xuất hiện `source: discovered`, `approved: 0` (máy in ảo PDF/XPS/Fax đã
được agent lọc bỏ — B15).

**f) In thử 1 job từ ERP** (gửi job qua API/ERP tới branch này):
PASS: SumatraPDF in ra giấy; log agent có `Printed`; job ở server chuyển `status: printed`.

**g) Offline detection:**
```powershell
Stop-Service PrintAgent-$bid   # tắt > 120s
```
PASS: sau ~120s, cron `mark-offline` hạ branch về `offline` + bắn alert. Bật lại:
`Start-Service PrintAgent-$bid` → online lại.

---

## Cần dán lại nếu có FAIL
- `C:\print-system\logs\service-stdout.log` và `service-stderr.log`
- Toàn bộ output cửa sổ `install.ps1`
- Output `Get-Service PrintAgent-*` và `check.ps1`
