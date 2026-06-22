# Prompt gửi Agent Claude Code (client) — Build + Upload Agent code lên VPS

> Copy nội dung từ `## PROMPT BẮT ĐẦU` xuống dưới, paste vào Claude Code ở máy Windows.

---

## PROMPT BẮT ĐẦU

Tôi cần bạn build 1 thư mục sạch (không chứa secret) chứa toàn bộ code **Print Agent** đã chạy trên máy Windows này, rồi **upload lên VPS** để tôi gộp vào monorepo GitHub.

---

### 1. NHIỆM VỤ

Agent bạn đã build trước đó đang chạy tại `C:\print-system\` (gồm `agent.js`, `package.json`, `agent-01\`, `.env`, `ca.crt`, `tools\`, `scripts\`, `logs\`...).

Tôi cần bạn:

1. **Tạo folder mới** `C:\print-agent-clean\` chứa **code sạch** (KHÔNG có secret, KHÔNG có `.env`, KHÔNG có `ca.crt` thật)
2. **Replace secret bằng placeholder** trong tất cả file (nếu có)
3. **Upload folder đó lên VPS** `160.250.133.192` qua `scp`
4. **Báo lại** cho tôi kết quả

---

### 2. CẤU TRÚC FOLDER CẦN TẠO

Tạo folder `C:\print-agent-clean\` với cấu trúc:

```
C:\print-agent-clean\
├── agent.js                    ← Copy từ C:\print-system\agent.js (ĐÃ BUILD)
├── package.json                ← Copy từ package.json
├── README.md                   ← File này sẽ tôi viết sau, a tạo trống cũng OK
├── .env.example                ← TẠO MỚI (xem §3)
├── .gitignore                  ← TẠO MỚI (xem §4)
├── install-service.ps1         ← Copy từ C:\print-system\scripts\install-service-elevated.ps1 (hoặc tên tương tự)
├── check.ps1                   ← Copy từ C:\print-system\check.ps1
├── docs\
│   ├── README.md               ← Copy từ C:\print-system\README.md (nếu có)
│   └── ARCHITECTURE.md         ← Có thể tạo trống, tôi sẽ viết sau
└── tools\
    └── README.md               ← Giải thích cách cài SumatraPDF (KHÔNG copy exe vì >5MB)
```

---

### 3. FILE `.env.example` (TẠO MỚI)

Tạo file `C:\print-agent-clean\.env.example` với nội dung:

```bash
# Print Agent - Environment template
# Copy to .env and fill in real values from your team's secret manager (Bitwarden/1Password)

BRANCH_ID=br_001
AGENT_TOKEN=<paste_from_secret_manager>
MQTT_URL=mqtts://<server_host>:8883
MQTT_USER=<mqtt_user>
MQTT_PASS=<mqtt_pass>
MQTT_CA_FILE=C:\print-system\ca.crt
API_URL=http://<server_host>:3000
SUMATRA_PATH=C:\print-system\tools\SumatraPDF.exe
TMP_DIR=C:\print-system\agents\agent-01\tmp
LOG_DIR=C:\print-system\agents\agent-01\logs
# PRINTER_NAME=  (empty = default printer)
```

---

### 4. FILE `.gitignore` (TẠO MỚI)

Tạo file `C:\print-agent-clean\.gitignore`:

```
# Dependencies
node_modules/
npm-debug.log*
yarn-error.log*

# Env (NEVER commit real .env)
.env
.env.local
.env.*.local

# Logs
logs/
*.log

# Temp PDFs
tmp/
*.pdf

# Tools (downloaded separately)
tools/SumatraPDF.exe
tools/*.dll
tools/*.exe

# Certs (downloaded separately)
ca.crt
*.pem
*.key

# IDE
.vscode/
.idea/
*.swp
.DS_Store

# Scripts with passwords
scripts/*password*
scripts/*secret*
scripts/*token*
scripts/fetch-cert.py
scripts/query-vps-db.py
```

---

### 5. COPY CÁC FILE TỪ MÁY A

**Quan trọng**: Copy từ `C:\print-system\` sang `C:\print-agent-clean\`, **KHÔNG** copy:
- ❌ `.env` (chứa token thật)
- ❌ `ca.crt` (cert thật)
- ❌ `tools\SumatraPDF.exe` (>5MB binary)
- ❌ `logs\*.log` (log có thể chứa info nhạy cảm)
- ❌ `tmp\*.pdf` (PDF có thể chứa hợp đồng thật)
- ❌ Bất kỳ file nào có chứa "password" / "secret" / "token" trong tên hoặc nội dung

**File NÊN copy** (đã build & chạy ổn):
- ✅ `agent.js` (220 dòng main code)
- ✅ `package.json` (deps)
- ✅ `README.md` (nếu có)
- ✅ `check.ps1` (health check script)
- ✅ `install-service-elevated.ps1` (hoặc `install-service.ps1`)
- ✅ `start-service.ps1`, `fix-service.ps1`, `cleanup-logs.ps1` (nếu có)

**Kiểm tra trước khi copy**: Mở từng file, scan bằng mắt xem có chứa:
- Token hex 64 chars? (e.g., `d516647b21b0a5f7074105d5ae0f2d8ab41f1350ad8781dd0003425768b332a3`)
- MQTT password hex 32 chars?
- JWT_SECRET dài?
- Client secret?

Nếu có → xóa khỏi file trước khi copy, hoặc thay bằng `<PLACEHOLDER>`.

---

### 6. UPLOAD LÊN VPS

Sau khi tạo xong folder `C:\print-agent-clean\`, upload lên VPS:

```powershell
# Test SSH trước
ssh admin@160.250.133.192 "echo connected"

# Upload folder (sẽ hỏi password)
scp -r C:\print-agent-clean\* admin@160.250.133.192:/tmp/agent-upload/

# Verify
ssh admin@160.250.133.192 "ls -la /tmp/agent-upload/"
```

**Lưu ý**:
- User `admin` trên VPS có password (a nhập khi được hỏi)
- Destination: `/tmp/agent-upload/` — KHÔNG vào `/opt/print-system/` (chỗ đó là code server)
- Tôi sẽ move từ `/tmp/agent-upload/` sang monorepo sau

---

### 7. BÁO CÁO LẠI

Sau khi xong, báo tôi:

```
[1/4] Folder structure:
   - Liệt kê các file đã copy (agent.js, package.json, ...)
[2/4] Files KHÔNG copy (vì có secret):
   - Liệt kê (e.g., .env, ca.crt, ...)
[3/4] Secret scan:
   - Có tìm thấy secret nào còn sót không? (đã replace bằng <PLACEHOLDER>?)
[4/4] Upload status:
   - scp có thành công không?
   - File size ở VPS có khớp local không?
```

---

### 8. NẾU GẶP LỖI

| Lỗi | Cách xử lý |
|---|---|
| `scp: Permission denied` | Password sai hoặc user không có quyền SSH. Kiểm tra `ssh admin@160.250.133.192 "whoami"` |
| `Connection refused` | VPS offline hoặc firewall chặn port 22 |
| Folder C:\print-system không tồn tại | Kiểm tra agent đang chạy ở đâu: `Get-Service PrintAgent-br001` xem AppDirectory |
| Không tìm thấy file agent.js | File có thể ở `C:\print-system\agent-01\agent.js` thay vì `C:\print-system\agent.js` |
| Muốn upload ZIP thay vì scp folder | OK: `Compress-Archive C:\print-agent-clean C:\print-agent-clean.zip -Force` rồi `scp C:\print-agent-clean.zip admin@160.250.133.192:/tmp/` |

---

## PROMPT KẾT THÚC
