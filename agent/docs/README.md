# Print Agent — Vận hành

Node.js agent chạy trên Windows tại mỗi chi nhánh: subscribe MQTT từ Print Service, tải PDF qua
API, in bằng SumatraPDF, báo trạng thái (`printed`/`failed`) về server.

## Cấu trúc thư mục (sau khi cài, trong `C:\print-system\`)

```
C:\print-system\
├── agent.js              # Vòng lặp chính: subscribe MQTT + fallback poll + spawn SumatraPDF
├── register.js            # `node agent.js --register install.json` — tự đăng ký chi nhánh
├── install.ps1             # Installer trọn gói (chạy 1 lần lúc cài máy mới)
├── install-service.ps1     # Cài/refresh Windows Service qua NSSM (installer gọi lại, có thể chạy tay)
├── check.ps1               # Health check nhanh (chạy tay khi nghi có sự cố)
├── package.json / package-lock.json
├── .env                     # Config runtime (BRANCH_ID, AGENT_TOKEN, MQTT_*, API_URL...) — KHÔNG commit git
├── root_ca.crt              # CA cert để agent trust MQTTS/HTTPS nội bộ (KHÔNG có trong repo, HQ IT cấp riêng)
├── node_modules/            # Deps (gitignore)
├── tools/
│   └── SumatraPDF.exe       # SumatraPDF portable, installer tự tải
├── agents/agent-01/
│   └── tmp/                 # PDF tạm lúc in, xoá sau khi xong
└── logs/
    ├── YYYY-MM-DD.log       # Log app theo ngày (UTC)
    ├── service-stdout.log   # stdout của NSSM service
    └── service-stderr.log   # stderr của NSSM service
```

## Yêu cầu

- **Windows 10/11**
- **Node.js v18+** (installer tự cài qua winget nếu thiếu)
- **SumatraPDF** portable (installer tự tải)
- **NSSM 2.24+** cho Windows Service (installer tự tải)
- **Network:** mở port 8883 (MQTTS) tới server, port 3000 hoặc 443 (API — xem `.env.example` để biết
  cổng thật đang dùng) tới cùng server

## Cài đặt — luồng thật (installer tự động)

Agent **không** cài bằng cách điền tay từng biến `.env`. Luồng chuẩn:

1. HQ IT/admin chạy **1 lần trên server**: `OUTPUT_FILE=install.json node scripts/gen-client.js "<tên client>"`
   → sinh `install.json` chứa `server_url`, `client_id`, `client_secret` + khối `agent_env` (MQTT_URL,
   MQTT_USER, MQTT_PASS, MQTT_CA_FILE, API_URL, SUMATRA_PATH...).
2. Gửi `install.json` + `root_ca.crt` (CA cert của server) cho chi nhánh qua kênh an toàn (không email
   thường, không chat công khai).
3. Tại máy Windows chi nhánh, copy nguyên thư mục `agent\` + `install.json` + `root_ca.crt` (đặt cạnh
   `install.ps1`), rồi chạy:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallJson .\install.json
   ```
   (tự xin quyền UAC nếu chưa chạy elevated). Có thể truyền sẵn tên/địa điểm để bỏ qua prompt tương tác:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallJson .\install.json -BranchName "Chi nhánh Quận 1" -Location "HCM"
   ```
4. `install.ps1` tự làm hết: kiểm tra/cài Node ≥ 18 → tạo cây thư mục `C:\print-system\` → copy mã
   agent → tải SumatraPDF → cài `root_ca.crt` vào Windows Trusted Root → cài NSSM → `npm install` →
   chạy `node agent.js --register install.json` (hỏi **Tên chi nhánh** + **Địa điểm**, gọi
   `POST /api/setup/register-branch`, nhận `branch_id` + `agent_token`, ghi đầy đủ vào `.env`) → cài
   Windows Service **tên động theo branch**: `PrintAgent-<branch_id>` → chạy `check.ps1` smoke test.
5. Kết thúc in dòng xanh `✓ Hoàn tất. Service 'PrintAgent-<branch_id>' đã chạy.` — nếu in dòng đỏ
   `⚠ CHƯA có root_ca.crt`, đặt `root_ca.crt` vào `C:\print-system` rồi `nssm restart PrintAgent-<branch_id>`.

Runbook đầy đủ (kèm bước xác minh từng PASS) xem `agent/docs/E2E-WINDOWS.md`. Một `install.json` có
thể dùng để đăng ký nhiều chi nhánh — chạy lại `node agent.js --register install.json` mỗi lần
1 chi nhánh mới.

## Cấu hình `.env`

Xem `agent/.env.example` — các field chính (phần lớn do `register.js` tự ghi, không cần điền tay):

| Biến | Nguồn | Ghi chú |
|---|---|---|
| `BRANCH_ID`, `AGENT_TOKEN` | `register.js` ghi sau khi đăng ký | Không set tay |
| `MQTT_URL`, `MQTT_USER`, `MQTT_PASS`, `MQTT_CA_FILE` | từ khối `agent_env` trong `install.json` | Broker MQTT của server (mặc định cert self-signed) |
| `API_URL` | từ `install.json` | Mặc định `http://<server>:3000`; chỉ HTTPS nếu server bật `HTTPS_ENABLED=true` |
| `SUMATRA_PATH` | từ `install.json` hoặc mặc định `C:\print-system\tools\SumatraPDF.exe` | |
| `PRINTER_NAME` | để trống = máy in mặc định | Đặt tên chính xác nếu muốn ép in ra máy khác |
| `PRINT_SETTINGS` | mặc định `1,a4,fit` | Khổ giấy + scaling cho SumatraPDF |
| `POLL_INTERVAL` | mặc định `15` giây | Fallback poll khi MQTT rớt |

## Format in ra giấy

Agent luôn ép về **A4 + fit-to-page** qua SumatraPDF `-print-settings "1,a4,fit"` (cấu hình được qua
`PRINT_SETTINGS` trong `.env`).

- **Khổ giấy**: A4 (mặc định). Có thể đổi: `a5`, `letter`, v.v.
- **Scaling**: `fit` (co/giãn vừa khổ). Giá trị khác: `shrink`, `noscale`.
- **Orientation**: theo PDF gốc (SumatraPDF không có flag ép portrait/landscape) — muốn ép portrait
  tuyệt đối thì phải xoay PDF trước khi gửi (xử lý ở phía HQ/client).

## Vận hành

### Kiểm tra trạng thái

```powershell
# Health check tổng hợp (tự suy ra tên service từ BRANCH_ID trong .env)
powershell -ExecutionPolicy Bypass -File C:\print-system\check.ps1

# Service status
Get-Service PrintAgent-*

# Log real-time
Get-Content "C:\print-system\logs\$(Get-Date -Format 'yyyy-MM-dd').log" -Wait
Get-Content C:\print-system\logs\service-stdout.log -Tail 30 -Wait
```

`check.ps1` in ra: service status, 10 dòng log gần nhất, file PDF tạm còn sót (nếu có nghĩa là job bị
kẹt), server có reachable không, và event log NSSM gần đây (restart/crash).

### Start / Stop / Restart

```powershell
# Qua NSSM (thay <branch_id> đúng của máy này — xem Get-Service PrintAgent-*)
C:\Tools\nssm.exe start PrintAgent-<branch_id>
C:\Tools\nssm.exe stop PrintAgent-<branch_id>
C:\Tools\nssm.exe restart PrintAgent-<branch_id>

# Hoặc qua PowerShell
Start-Service PrintAgent-<branch_id>
Stop-Service PrintAgent-<branch_id>
Restart-Service PrintAgent-<branch_id>
```

## Troubleshooting

| Vấn đề | Nguyên nhân | Cách fix |
|---|---|---|
| `Missing env: BRANCH_ID` / crash-loop lúc khởi động | `.env` thiếu field (thường do `install.json` cũ không có khối `agent_env`) | Tạo lại `install.json`: `OUTPUT_FILE=install.json node scripts/gen-client.js "<tên client>"`, chạy lại `install.ps1` |
| `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `unable to verify the first certificate` | Chưa cài `root_ca.crt`, hoặc cài sai store | Xem `agent/CA_INSTALL.md` — cài lại root CA vào Trusted Root (Local Machine) |
| `Not authorized` (MQTT) | `MQTT_USER`/`MQTT_PASS` sai hoặc đã bị rotate | Kiểm tra `.env`, yêu cầu HQ cấp lại `install.json`/thông tin MQTT mới |
| `SumatraPDF exit code khác 0` (không in được) | (1) `PRINTER_NAME` sai tên; (2) máy in offline/hết giấy | Kiểm tra tên máy in chính xác trong Windows "Printers"; đặt vào `PRINTER_NAME` trong `.env` rồi restart service |
| `HTTP 401` khi callback status | `AGENT_TOKEN` sai hoặc đã bị regen trên server | Yêu cầu admin regen token (`POST /api/branches/:id/regen-token`), cập nhật `.env`, restart service |
| Service crash liên tục / `AppDirectory` sai | Service chạy sai working directory | `C:\Tools\nssm.exe set PrintAgent-<branch_id> AppDirectory "C:\print-system"` rồi restart |
| Job kẹt ở `sent` | Agent không chạy hoặc callback status fail | `check.ps1` xem service status; xem log có lỗi không |
| Máy in tự phát hiện nhưng chưa xuất hiện job | Printer mới discover cần **approve** trên admin UI trước khi nhận job | Vào web admin duyệt máy in (`approved: 1`) |

Cần dán log để debug: `logs\service-stdout.log`, `logs\service-stderr.log`, output cửa sổ
`install.ps1` (nếu là lỗi lúc cài), output `Get-Service PrintAgent-*` và `check.ps1`.

## Bảo mật

- File `.env` chứa token, **KHÔNG commit git**, **KHÔNG share** qua chat.
- File `root_ca.crt` không nhạy cảm (public cert) nhưng cũng không cần share rộng rãi ngoài mục đích cài đặt.
- `AGENT_TOKEN` nên được regen định kỳ (qua API `POST /api/branches/:id/regen-token`).
- Nếu lộ token: regen token mới trên server, cập nhật `.env` trên máy chi nhánh, restart service.

## Tài liệu liên quan

- `agent/docs/E2E-WINDOWS.md` — runbook chạy thử E2E trên máy Windows test, có bước PASS/FAIL cụ thể
- `agent/docs/ARCHITECTURE.md` — luồng xử lý job trong agent
- `agent/CA_INSTALL.md` — cài root CA chi tiết (GUI/certlm/PowerShell)
- `docs/API.md` — API spec đầy đủ (server ↔ agent ↔ client)
