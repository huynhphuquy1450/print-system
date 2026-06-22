# HANDOVER REPORT — Hệ thống Print Service

> **Ngày handover:** 2026-06-22
> **Phiên bản:** v1.0.0 (Giai đoạn 1 — MVP)
> **Người bàn giao:** Admin (chủ dự án)
> **Trạng thái:** Production-ready cho 1 chi nhánh test (br_001), sẵn sàng scale

---

## 0. TÓM TẮT 1 PHÚT

Hệ thống in PDF hợp đồng từ xa cho công ty có trụ sở chính + 30+ chi nhánh toàn quốc:
- HQ upload PDF qua API → in tự động ra máy in chi nhánh được chỉ định → báo lại status
- Kiến trúc: 1 Print Service Node.js + Mosquitto broker trên VPS Ubuntu + Agent Windows ở mỗi chi nhánh
- Chi phí: ~$100/năm (~$5-10/tháng VPS) — tiết kiệm ~80% so với dịch vụ in đám mây
- Đã verify: 28 jobs end-to-end (22 in thành công ra giấy thật, 6 fail cố ý), uptime 12 giờ liên tục

---

## 1. KIẾN TRÚC

```
┌─────────────────┐
│   HQ ERP/CRM    │
└────────┬────────┘
         │ HTTPS API + JWT
         ▼
┌─────────────────────────────────────┐
│  VPS Ubuntu 160.250.133.192         │
│  ┌────────────────────────────────┐ │
│  │ Print Service :3000 (Node.js)  │ │
│  │ - Express + JWT                │ │
│  │ - SQLite (jobs.db)             │ │
│  │ - Cron: retry/cleanup/backup   │ │
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ Mosquitto broker :8883         │ │
│  │ - MQTTS (self-signed)          │ │
│  │ - ACL per-branch               │ │
│  └────────────────────────────────┘ │
│  ┌────────────────────────────────┐ │
│  │ PM2 + systemd auto-start       │ │
│  └────────────────────────────────┘ │
└────────┬────────────────────────────┘
         │ MQTTS qua internet (TLS)
         ▼
┌─────────────────────────────────────┐
│  Mỗi chi nhánh                     │
│  ┌────────────────────────────────┐ │
│  │ Agent Node.js (Windows)        │ │
│  │ - Subscribe MQTT               │ │
│  │ - Download PDF qua API         │ │
│  │ - SumatraPDF in silent         │ │
│  │ - NSSM service auto-start      │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Giao thức chính:**
- API: HTTPS REST + JWT (client) / X-Agent-Token (agent)
- MQTT: MQTTS port 8883, topic `company/printer/{branch_id}/jobs`, QoS 1
- DB: SQLite WAL mode
- File transfer: PDF binary qua HTTPS API

---

## 2. TRẠNG THÁI HIỆN TẠI

### 2.1. Server (đã chạy production)

| Component | Status | Detail |
|---|---|---|
| Print Service Node.js | ✅ Online | PID 3267171, uptime 12h+, memory 90MB, restart count 3 |
| Mosquitto broker | ✅ Active | TLS + ACL, 4 MQTT user, 5 branch rows |
| PM2 + systemd | ✅ Enabled | Auto-start on VPS reboot |
| UFW firewall | ✅ Active | Allow 22, 3000, 8883 |
| SQLite DB | ✅ OK | 28 jobs (22 printed + 6 failed), 5 branches, 1 client |
| Health endpoint | ✅ OK | `curl /health` → `{status:"ok",mqtt:"connected",db:"ok"}` |

### 2.2. Client (đã build & chạy trên máy Windows)

| Component | Status | Detail |
|---|---|---|
| Agent br_001 Node.js | ✅ Running | NSSM service "PrintAgent-br001" |
| SumatraPDF 3.6.1 | ✅ Installed | `C:\print-system\tools\SumatraPDF.exe` |
| CA cert | ✅ Installed | `C:\print-system\ca.crt` (self-signed) |
| Auto-restart | ✅ Yes | NSSM restart on crash, Auto-start on Windows boot |
| Test results | ✅ 5/5 PASS | In ra máy in Brother HL-L2360D thật |

### 2.3. Code statistics

```
src/       1,656 dòng JS (17 file)
scripts/     293 dòng JS/sh (5 file)
docs/        ~600 dòng markdown (6 file)
Tổng repo:   73 file (không tính node_modules, DB)
```

---

## 3. CẤU TRÚC REPO

```
/opt/print-service/                  # (sẽ chuyển sang monorepo Git)
├── src/                             # Server source code
│   ├── index.js                     # Entry point (HTTP + MQTT + cron + signals)
│   ├── app.js                       # Express setup + routes
│   ├── config.js                    # Đọc .env, validate required vars
│   ├── db.js                        # better-sqlite3, schema, prepared stmts
│   ├── mqtt-client.js               # MQTT wrapper (connect/publish/disconnect)
│   ├── logger.js                    # Winston (console + file rotation)
│   ├── api/
│   │   ├── health.js                # GET /health
│   │   ├── auth.js                  # POST /api/auth/login, /api/auth/me
│   │   ├── jobs.js                  # POST/GET /api/print-jobs, /:id/file, /:id/status
│   │   ├── branches.js              # CRUD /api/branches + regen-token
│   │   ├── printers.js              # CRUD /api/printers
│   │   └── admin.js                 # POST /api/admin/agents (bulk create)
│   ├── middleware/
│   │   ├── auth.js                  # verifyClient (JWT), verifyAgent (X-Agent-Token)
│   │   ├── validate.js              # Schema validator (viết tay, không dùng zod)
│   │   └── error.js                 # Error handler chuẩn
│   ├── services/
│   │   ├── job-service.js           # Core: createJob, getJob, listPending, updateJobStatus, getJobFileForAgent
│   │   ├── pdf-validator.js         # Check %PDF- magic bytes
│   │   ├── token-service.js         # generateAgentToken (SHA256), verifyAgentToken (timingSafeEqual)
│   │   └── auth-service.js          # verifyClientCredentials (bcrypt), issueClientJwt (HS256)
│   └── jobs/
│       ├── retry-stale.js           # Cron 5p: republish job 'sent' quá 5p
│       ├── cleanup-files.js         # Cron 3h: xóa PDF + rows > 7 ngày
│       └── backup-db.js             # Cron 2h: VACUUM INTO, giữ 30 ngày
├── scripts/
│   ├── gen-client.js                # Tạo client (id, secret) — in plaintext 1 lần
│   ├── gen-agents.js                # Tạo N branch + agent_token
│   ├── health-check.js              # Standalone CLI test
│   ├── send-job.sh                  # Bash: gửi PDF qua API (Mac/Linux/VPS)
│   └── send-job.bat                 # CMD wrapper cho send-job.ps1
├── data/
│   ├── jobs.db                      # SQLite (gitignored)
│   └── backups/                     # jobs-YYYY-MM-DD.db (giữ 30 ngày)
├── storage/                         # PDF files (gitignored, xóa sau 7 ngày)
├── logs/                            # app-*.log + pm2-*.log (gitignored)
├── certs/                           # Self-signed cert (gitignored)
├── .env                             # Secrets (chmod 600, gitignored)
├── .env.example                     # Template cho dev
├── .gitignore
├── ecosystem.config.js              # PM2 config
├── package.json
├── package-lock.json
├── VERIFICATION.md                  # Hướng dẫn vận hành server
├── CLIENT_GUIDE.md                  # Spec cho agent (đã cập nhật fetchPending flow)
├── CLIENT_REPLY.md                  # Trả lời option "download file" cho agent client
├── CLIENT_SEND_JOB.md               # Hướng dẫn gửi job qua API (3 cách)
├── CLIENT_SEND_JOB.ps1              # PowerShell test script
├── AGENT_BUILD_PROMPT.md            # Prompt đầy đủ để build agent
└── HANDOVER.md                      # File này
```

---

## 4. API ENDPOINTS (đã verify)

### 4.1. Public

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | - | Health check (status, mqtt, db, uptime) |

### 4.2. Auth (Client)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/login` | - | `{client_id, client_secret}` | `{token, token_type:"Bearer", expires_in:"7d"}` |
| GET | `/api/auth/me` | Bearer | - | `{client:{id, name}}` |

### 4.3. Print Jobs — Client (HQ)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/print-jobs` | Bearer | `{branch_id, printer?, pdf_base64, metadata?:{user_id, user_name?, note?}}` | 201 `{job_id, status:"queued"}`<br>**429** nếu client vượt rate limit (xem §4.9) |
| GET | `/api/print-jobs/:id` | Bearer | - | Full job row + parsed metadata |
| GET | `/api/print-jobs` | Bearer | - | 200 jobs gần nhất (LIMIT 200) |

### 4.4. Print Jobs — Agent

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/print-jobs?branch_id=X` | **Agent token** | - | `{jobs:[...]}` (pending + sent) |
| GET | `/api/print-jobs/:id/file` | **Agent token** | - | 200 `application/pdf` binary<br>410 Gone (printed/failed)<br>403/401 (auth fail) |
| POST | `/api/print-jobs/:id/status` | **Agent token** | `{status:"printed"\|"failed", error?}` | `{ok:true}` |

### 4.5. Branches — Client (HQ)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/branches` | Bearer | - | List branches (KHÔNG có agent_token_hash) |
| POST | `/api/branches` | Bearer | `{name, location?, id?}` | 201 `{id, name, agent_token}` ← **token hiện 1 lần** |
| GET | `/api/branches/:id` | Bearer | - | `{...}` (no token hash) |
| POST | `/api/branches/:id/regen-token` | Bearer | - | `{id, name, agent_token (mới)}` |

### 4.6. Printers — Client (HQ)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/printers?branch_id=X` | Bearer | - | `{printers:[...]}` |
| POST | `/api/printers` | Bearer | `{branch_id, name, is_default?}` | 201 `{id, branch_id, name, is_default}` |
| DELETE | `/api/printers/:id` | Bearer | - | `{ok:true}` |

### 4.7. Admin (bulk)

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/admin/agents` | Bearer | `{count, prefix?, name_template?}` | 201 `{created, branches:[{id, name, agent_token}]}` |

### 4.8. Audit trail (khuyến nghị cho HQ)

Để truy vết "ai in cái gì", mỗi `POST /api/print-jobs` nên truyền `metadata.user_id` (khuyến nghị) và `metadata.user_name` (tùy chọn, để hiển thị). Server lưu metadata vào DB dạng JSON, tra cứu qua `GET /api/print-jobs/:id` (response trả về `metadata` đã parse).

Ví dụ body:

```json
{
  "branch_id": "br_001",
  "pdf_base64": "JVBERi0xLjQK...",
  "metadata": {
    "user_id": "EMP-1234",
    "user_name": "Nguyễn Văn A",
    "note": "In hợp đồng HD-2026-0042"
  }
}
```

**Lưu ý:**

- Metadata là JSON tự do — server không validate nội dung, chỉ lưu trữ.
- Nếu thiếu `user_id` thì job vẫn chạy (status 201), nhưng sẽ không truy vết được sau này.
- Server cũng tự ghi `client_id` (ID của HQ client từ JWT) vào `jobs.client_id` — kết hợp với `metadata.user_id` để truy vết cả 2 chiều (HQ nào → user nào in).

### 4.9. Rate Limiting (429)

Có 2 lớp rate-limit (cả hai dùng `express-rate-limit`, store in-memory):

| Loại | Key | Default | Env | Áp dụng cho |
|---|---|---|---|---|
| Per-IP login | `req.ip` | 5 / phút | `AUTH_LOGIN_RATE_PER_MIN` | `POST /api/auth/login` — chống brute force password |
| Per-client write | `req.client.id` | 30 / phút | `CLIENT_WRITE_RATE_PER_MIN` | `POST /api/print-jobs` — chống HQ spam |

Response khi vượt limit:
```json
HTTP 429
{ "error": "Too many requests, slow down" }
```

Headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (`standardHeaders: 'draft-7'`).

**Lưu ý scale:** MemoryStore là in-process — nếu chạy nhiều node (horizontal scale) thì counters không chia sẻ giữa các node, một client có thể gửi N requests × số node. Khi đó cần đổi sang Redis store.

---

## 5. AUTHENTICATION

### 5.1. Client JWT (HQ → server)

- **Header:** `Authorization: Bearer <jwt>`
- **Algorithm:** HS256, 7 ngày expiry
- **Secret:** `JWT_SECRET` (48-byte base64) trong `.env`
- **Payload:** `{sub: <client_id>, name, type:"client", iat, exp}`
- **Issue qua:** `POST /api/auth/login` với `client_id` + `client_secret`

### 5.2. Agent device token (Agent → server)

- **Headers:** `X-Agent-Token` + `X-Branch-Id`
- **Token format:** hex 64 chars (32 bytes random)
- **Hash:** SHA256 lưu trong DB `branches.agent_token_hash`
- **Verify:** constant-time compare qua `crypto.timingSafeEqual`
- **403:** token khớp branch_id khác với job.branch_id

### 5.3. MQTT auth (Agent ↔ broker)

- 4 user: `printservice`, `br_001`, `br_002`, `br_003`
- Password: 32-char hex (16 bytes random)
- Lưu `/etc/mosquitto/passwd` (chown `mosquitto:mosquitto`, chmod 600)
- ACL `/etc/mosquitto/acl`: printservice = full, mỗi branch chỉ read topic của mình

---

## 6. CÀI ĐẶT MÔI TRƯỜNG DEV LOCAL

### 6.1. Yêu cầu

- **OS:** Ubuntu 22.04+ / macOS / Windows + WSL2
- **Node.js:** 18+ (đã test với 24.15.0)
- **RAM:** 512MB+ cho server
- **Disk:** 1GB+ (cho certs, storage, logs, backups)

### 6.2. Clone + setup server

```bash
# 1. Clone repo (sau khi setup git — xem §11)
git clone <repo-url> print-system
cd print-system/server

# 2. Cài deps
npm install --no-audit --no-fund

# 3. Cài Mosquitto (Ubuntu/Debian)
sudo apt install -y mosquitto mosquitto-clients openssl

# 4. Tạo .env (KHÔNG copy từ production!)
cp .env.example .env
# Generate secrets:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('base64'))" >> .env
node -e "console.log('AGENT_TOKEN_SECRET=' + require('crypto').randomBytes(48).toString('base64'))" >> .env
# Generate MQTT pass
node -e "console.log('MQTT_PASS=' + require('crypto').randomBytes(16).toString('hex'))" >> .env
# Sửa các giá trị khác cho local (API_URL=http://localhost:3000, etc.)

chmod 600 .env

# 5. Setup Mosquitto local
mkdir -p /tmp/mosquitto-dev
openssl req -new -x509 -days 365 -nodes \
  -keyout /tmp/mosquitto-dev/server.key -out /tmp/mosquitto-dev/server.crt \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# Tạo user MQTT dev
PASS=$(grep MQTT_PASS .env | cut -d= -f2)
mosquitto_passwd -c -b /tmp/mosquitto-dev/passwd printservice "$PASS"

# Tạo file config riêng cho dev
cat > /tmp/mosquitto-dev/mosquitto.conf <<EOF
listener 8883
cafile /tmp/mosquitto-dev/server.crt
certfile /tmp/mosquitto-dev/server.crt
keyfile /tmp/mosquitto-dev/server.key
allow_anonymous false
password_file /tmp/mosquitto-dev/passwd
acl_file /tmp/mosquitto-dev/acl
EOF

# ACL đơn giản cho dev
cat > /tmp/mosquitto-dev/acl <<EOF
user printservice
topic readwrite #
EOF

# Chạy Mosquitto dev (không dùng systemd)
mosquitto -c /tmp/mosquitto-dev/mosquitto.conf &

# 6. Generate client + branches test
node scripts/gen-client.js dev-erp
node scripts/gen-agents.js 3

# 7. Start server
pm2 start ecosystem.config.js --env development
pm2 logs print-service
```

### 6.3. Clone + setup agent (Windows)

```powershell
# 1. Clone repo (sau khi setup git)
git clone <repo-url> print-system
cd print-system\agent

# 2. Cài deps
npm install

# 3. Cài SumatraPDF (portable)
# Tải từ https://www.sumatrapdfreader.org/download-free-pdf-viewer
# Giải nén vào C:\print-system\tools\SumatraPDF.exe

# 4. Copy CA cert từ VPS (hoặc dev server)
# scp admin@<server>:/path/to/server.crt C:\print-system\ca.crt

# 5. Tạo .env (KHÔNG copy từ production)
# Bước 5a: Tạo branch mới qua API (dev server)
#   curl -X POST http://localhost:3000/api/auth/login -d '{...}' -> JWT
#   curl -X POST http://localhost:3000/api/branches -H "Bearer $JWT" -d '{"name":"My Branch"}'
# Bước 5b: Copy agent_token vào .env

# 6. Chạy thử (console)
node agent.js

# 7. Cài NSSM service
# Tải NSSM từ https://nssm.cc/download
# nssm install PrintAgent-br001 "C:\Program Files\nodejs\node.exe" "C:\path\to\agent.js"
# nssm set PrintAgent-br001 AppDirectory "C:\path\to\agent"
# nssm set PrintAgent-br001 AppEnvironmentExtra BRANCH_ID=br_001
# nssm set PrintAgent-br001 Start SERVICE_AUTO_START
# nssm start PrintAgent-br001
```

### 6.4. Công cụ dev hữu ích

```bash
# Test health
curl -s http://localhost:3000/health | jq

# Tail log
pm2 logs print-service --raw

# Xem jobs trong DB
sqlite3 data/jobs.db "SELECT id, status, branch_id FROM jobs ORDER BY created_at DESC LIMIT 10"

# Subscribe MQTT test (cùng terminal)
mosquitto_sub -h 127.0.0.1 -p 8883 -u printservice -P "$MQTT_PASS" \
  --cafile /tmp/mosquitto-dev/server.crt \
  -t "company/printer/#" -v

# Gửi job test (cùng folder server)
./scripts/send-job.sh /path/to/test.pdf
```

---

## 7. DEPLOY LÊN PRODUCTION (VPS Ubuntu)

### 7.1. Yêu cầu VPS

- Ubuntu 22.04+ (đã test 24.04)
- User với sudo
- IP public
- Mở port: 22 (SSH), 3000 (API), 8883 (MQTTS)

### 7.2. Setup lần đầu (xem VERIFICATION.md đầy đủ)

```bash
# SSH vào VPS
ssh admin@160.250.133.192

# Cài deps
sudo apt update && sudo apt install -y mosquitto mosquitto-clients openssl ufw curl git

# Setup Mosquitto (xem §5.3)
sudo cp /opt/print-service/certs/* /etc/mosquitto/certs/
sudo cp /opt/print-service/scripts/setup/* /etc/mosquitto/  # nếu có
sudo systemctl restart mosquitto

# Mở firewall
sudo ufw allow 22/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 8883/tcp
sudo ufw --force enable

# Setup PM2 startup
pm2 startup systemd -u admin --hp /home/admin
pm2 save

# Verify
pm2 status
curl -s http://localhost:3000/health
```

### 7.3. Deploy update mới

```bash
# Từ máy dev
git pull
cd print-system/server
npm install --production
pm2 restart print-service
pm2 logs print-service --lines 30

# Verify
./scripts/health-check.js
./scripts/send-job.sh /tmp/test.pdf
```

---

## 8. SECRET MANAGEMENT

### 8.1. Phân loại secret

| Loại | Mức độ nhạy | Lưu trữ |
|---|---|---|
| `JWT_SECRET` | **CRITICAL** | Bitwarden team vault (1 chỗ duy nhất) |
| `AGENT_TOKEN_SECRET` | **CRITICAL** | Bitwarden team vault |
| `client_secret` (HQ) | **HIGH** | Bitwarden team vault, share với ERP team |
| `agent_token` (mỗi branch) | **HIGH** | Bitwarden share riêng cho mỗi chi nhánh |
| `MQTT_PASS` (4 user) | **MEDIUM** | Trong `.env` production + dev docs |
| TLS cert | **MEDIUM** | Repo (public cert) + Bitwarden (private key) |

### 8.2. Quy tắc

1. **KHÔNG BAO GIỜ** commit `.env` lên git
2. **KHÔNG BAO GIỜ** paste secret plaintext vào file `.md` trong repo
3. **KHÔNG BAO GIỜ** share secret qua chat (kể cả internal)
4. Mỗi dev có **secret riêng** cho local dev (gen qua `scripts/setup-dev.sh`)
5. Production secret chỉ trong **Bitwarden team vault** + `.env` trên VPS
6. **Rotate định kỳ** (khuyến nghị 90 ngày): client_secret, agent_token, MQTT_PASS
7. Khi dev nghỉ việc → **rotate TẤT CẢ** secret + revoke quyền Bitwarden

### 8.3. Setup Bitwarden team (TODO — a tạo)

1. Tạo organization "Print System Team" trên https://vault.bitwarden.com
2. Tạo collections: `Production Secrets`, `Dev Secrets`, `Agent Tokens`
3. Invite team dev với quyền read-only (trừ a = admin)
4. Lưu TẤT CẢ secret vào đây
5. Chia sẻ `Agent Tokens/br_001` cho agent owner (1 người cụ thể)

### 8.4. Rotate secret

```bash
# Trên server production, SSH vào VPS
ssh admin@160.250.133.192

# 1. Rotate JWT_SECRET (khuyến nghị 90 ngày)
NEW_JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_JWT|" /opt/print-service/.env
# Lưu $NEW_JWT vào Bitwarden

# 2. Rotate agent_token cho 1 branch (qua API)
JWT=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"...","client_secret":"..."}' | jq -r .token)
NEW_TOKEN=$(curl -s -X POST http://localhost:3000/api/branches/br_001/regen-token \
  -H "Authorization: Bearer $JWT" | jq -r .agent_token)
# Lưu $NEW_TOKEN vào Bitwarden → share với agent owner

# 3. Update agent .env (trên máy Windows)
# Agent owner nhận token mới từ Bitwarden, update file .env, restart service:
#   sc stop PrintAgent-br001 && sc start PrintAgent-br001

# 4. Verify
pm2 restart print-service
sleep 3
curl -s http://localhost:3000/health
```

---

## 9. QUY TRÌNH PHÁT TRIỂN

### 9.1. Workflow chuẩn

```
Dev sửa code → push branch → tạo PR
   ↓
CI tự động:
   - Lint server (eslint)
   - Lint agent (eslint)
   - Compile check (node --check)
   - Integration test: spawn server local + agent local + Mosquitto local
     - Gửi job qua API → verify in (mock printer)
   ↓ pass
Reviewer (a) review code
   ↓ approved
Merge vào main
   ↓
A deploy thủ công lên VPS (chưa có auto-deploy)
   ↓
A verify trên production (smoke test)
```

### 9.2. Coding conventions

- **Style:** CommonJS, 2 spaces indent, single quotes, semicolons
- **Naming:** camelCase cho variables/functions, PascalCase cho classes
- **Error handling:** throw HttpError từ services, middleware catch chuẩn
- **Logging:** dùng `logger` (Winston), không `console.log` trong production
- **Async:** async/await, không callback
- **DB:** luôn dùng prepared statements (xem `src/db.js`)

### 9.3. Test cases phải có khi sửa API

Khi sửa API, dev PHẢI update `CLIENT_GUIDE.md` (nếu agent bị ảnh hưởng) và thêm test case vào:

```bash
# Smoke test sau khi sửa
./scripts/health-check.js
./scripts/send-job.sh /tmp/test.pdf
# Check log
pm2 logs print-service --lines 30
# Check DB
sqlite3 data/jobs.db "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 3"
```

### 9.4. Quy tắc bảo mật cho dev

1. **KHÔNG** log secret (password, token, JWT) ra console
2. **KHÔNG** commit `.env` (đã có `.gitignore`)
3. **KHÔNG** test trực tiếp trên production server (luôn dùng local dev env)
4. **KHÔNG** dùng `curl` với secret trong command history — dùng `.env` file hoặc biến shell

---

## 10. KNOWN ISSUES + LIMITATIONS

### 10.1. Đã biết (chưa fix)

| # | Vấn đề | Impact | Workaround |
|---|---|---|---|
| 1 | PDF base64 trong JSON → request lớn, tốn RAM | Memory peak ~50MB/job | Giới hạn 50MB qua express.json limit |
| 2 | SQLite single-file → không scale > 100 jobs/phút | DB lock khi concurrent | OK cho MVP, cần PostgreSQL khi scale |
| 3 | Cert self-signed → client phải `--cafile` hoặc `rejectUnauthorized:false` | Dev friction | Sẽ mua domain + Let's Encrypt (GĐ2) |
| 4 | Không có HTTPS cho API (chỉ HTTP) | Insecure trên internet | OK vì VPN hoặc local; cần nginx reverse proxy + certbot khi public |
| 5 | ~~Không có rate-limit per-client (chỉ per-IP login)~~ | ~~HQ spam được~~ | ✅ **Đã fix**: middleware `clientRateLimit` (`server/src/middleware/rate-limit-client.js`), key theo `req.client.id`, default `CLIENT_WRITE_RATE_PER_MIN=30` (env). Áp dụng cho `POST /api/print-jobs`. Nếu scale horizontal → đổi sang Redis store. |
| 6 | Không có audit log ai in cái gì | Đã có guidance cho HQ (xem §4.8) | HQ cần truyền `metadata.user_id` khi POST job |
| 7 | ~~Cron `cleanup-files` xóa PDF > 7 ngày — không audit~~ | ~~Mất data nếu cần reprint~~ | ✅ **Đã fix**: bảng `cleanup_audit` (`server/src/db.js`) ghi mỗi lần xóa (job_id, file_path, branch_id, reason, deleted_at, size_bytes) — `server/src/services/cleanup-audit.js` được gọi trong `db.transaction()` với `deleteJobById`, đảm bảo atomic (audit fail → delete roll back). Truy vết qua `SELECT * FROM cleanup_audit WHERE deleted_at > ?`. Schema + retention policy xem §10.3. |

### 10.2. Cần monitor thường trực

- **Disk usage** `/opt/print-service/storage/` — cleanup cron đã lo nhưng check `df -h` mỗi tuần
- **Log size** `/opt/print-service/logs/` — rotate qua winston-daily-rotate-file, kiểm tra `du -sh`
- **MQTT connection** — health endpoint, log "MQTT disconnected"
- **Job stuck** ở status `sent` > 5 phút — retry-stale cron sẽ lo, nhưng nếu retry_count >= 5 → mark failed
- **PM2 status** — uptime, memory, restart count

### 10.3. Bảng `cleanup_audit` (mới, §10.1 #7 fix)

Bảng `cleanup_audit` được tạo tự động bởi `db.exec(...)` ở lần khởi động server đầu tiên (idempotent — `CREATE TABLE IF NOT EXISTS`). Mỗi lần cron `cleanup-files` xóa một PDF/job, một row audit được ghi **trước** khi job row bị xóa — cả hai nằm trong cùng `db.transaction()`, nên nếu audit fail thì delete roll back (job vẫn còn, retry lần sau).

#### Schema

| Column | Type | Nullable | Default | Mô tả |
|---|---|---|---|---|
| `id` | INTEGER | NO | autoincrement | PK, sequential |
| `job_id` | TEXT | NO | - | ID job bị xóa (job row không còn — không FK) |
| `file_path` | TEXT | YES | NULL | Absolute path lúc xóa (NULL nếu file đã missing) |
| `branch_id` | TEXT | YES | NULL | Branch sở hữu job (NULL nếu job không gắn branch) |
| `reason` | TEXT | NO | `'retention'` | `'retention'` (bình thường) \| `'file-missing'` (file đã gone trước đó) |
| `deleted_at` | INTEGER | NO | - | ms epoch (timestamp lúc xóa) |
| `size_bytes` | INTEGER | YES | NULL | Kích thước file (bytes) trước khi unlink — NULL nếu file missing |

Index: `idx_cleanup_audit_deleted_at` (DESC), `idx_cleanup_audit_branch`.

#### Retention policy

**Không auto-purge** trong code. Audit sống độc lập với `jobs` (FK không tồn tại cố ý — nếu có FK thì audit sẽ bị cascade-delete theo job, vô hiệu hóa mục đích). Nếu DB phình:

- Khuyến nghị: `VACUUM` thủ công mỗi 6 tháng, hoặc
- Script `DELETE FROM cleanup_audit WHERE deleted_at < ?` theo policy riêng (chưa có trong cron — TODO §11).

#### Query mẫu

```sql
-- Audit trong 30 ngày qua (recent reprints? investigate "lost" PDFs)
SELECT * FROM cleanup_audit
 WHERE deleted_at > strftime('%s','now','-30 days') * 1000
 ORDER BY deleted_at DESC;

-- Storage freed theo branch (MB) — capacity planning
SELECT branch_id,
 SUM(size_bytes) / 1024.0 / 1024.0 AS mb_freed
 FROM cleanup_audit
 WHERE deleted_at > ?
 GROUP BY branch_id
 ORDER BY mb_freed DESC;

-- Top 10 deletions gần nhất
SELECT job_id, file_path, reason, deleted_at, size_bytes
 FROM cleanup_audit
 ORDER BY deleted_at DESC
 LIMIT 10;
```

---

## 11. ROADMAP

### Giai đoạn 1 — MVP (✅ HOÀN THÀNH)

- ✅ Server + Mosquitto trên VPS
- ✅ API đầy đủ (auth, jobs, branches, printers, admin)
- ✅ Agent br_001 in được trên Windows
- ✅ NSSM service auto-restart
- ✅ Cron retry/cleanup/backup
- ✅ End-to-end test 5/5

### Giai đoạn 1.5 — Team handoff (⏳ ĐANG LÀM)

- ⏳ Setup Git monorepo
- ⏳ Setup Bitwarden team vault
- ⏳ Setup CI/CD (GitHub Actions)
- ⏳ Setup secret rotation procedure
- ⏳ Dev team onboard (1-2 tuần)

### Giai đoạn 2 — Scale lên 30 chi nhánh (2-3 tháng)

- Mua domain (~$10/năm)
- Cài Let's Encrypt + nginx reverse proxy cho HTTPS API
- Bỏ self-signed cert
- Bulk tạo 30 branch qua `POST /api/admin/agents`
- Test với 5-10 chi nhánh thật trước
- Monitoring: Grafana + Prometheus (optional)
- Alerting: PagerDuty / email khi service down

### Giai đoạn 3 — Scale out (6-12 tháng, optional)

- Retention policy cho bảng `cleanup_audit` (§10.3) — script tự động VACUUM hoặc `DELETE` cũ
- PostgreSQL thay SQLite (nếu > 100 jobs/phút)
- Redis cache cho job metadata
- Multi-region VPS (failover)
- Web UI cho HQ (xem job history, retry manual)
- Mobile app cho chi nhánh (báo in xong, báo lỗi giấy)
- Tích hợp ERP qua webhook (thay vì HQ call API)

---

## 12. LIÊN HỆ + ESCALATION

| Vấn đề | Liên hệ |
|---|---|
| Server down / không vào được VPS | A (admin hệ thống) |
| API contract / schema thay đổi | A review + approve trước khi merge |
| Bug trong agent | Team dev → a review |
| Secret bị lộ (compromised) | **A rotate ngay lập tức**, audit log |
| Cần thêm chi nhánh mới | A tạo qua API, dev hỗ trợ deploy agent |
| Yêu cầu tính năng mới | Tạo GitHub issue, team dev estimate |

---

## 13. CHECKLIST CHO TEAM DEV NHẬN BÀN GIAO

- [ ] Đọc hết file này (đặc biệt §4 API, §9 Workflow, §10 Known issues)
- [ ] Setup môi trường dev local theo §6
- [ ] Chạy `./scripts/send-job.sh /tmp/test.pdf` thành công → in ra giấy thật
- [ ] Verify end-to-end: HQ → server → agent → giấy
- [ ] Đọc source code `src/` (1,656 dòng), hiểu cấu trúc
- [ ] Đọc `src/services/job-service.js` — đây là core logic
- [ ] Yêu cầu a cấp Bitwarden access cho team
- [ ] Test rotate secret procedure theo §8.4
- [ ] Khi nhận task mới: tạo branch, code, test local, PR, chờ review

---

## 14. APPENDIX: Tất cả file trong repo

### Code (chạy production)
- `src/index.js`, `src/app.js`, `src/config.js`, `src/db.js`, `src/mqtt-client.js`, `src/logger.js`
- `src/api/health.js`, `auth.js`, `jobs.js`, `branches.js`, `printers.js`, `admin.js`
- `src/middleware/auth.js`, `validate.js`, `error.js`
- `src/services/job-service.js`, `pdf-validator.js`, `token-service.js`, `auth-service.js`
- `src/jobs/retry-stale.js`, `cleanup-files.js`, `backup-db.js`

### Scripts
- `scripts/gen-client.js` — Tạo client mới
- `scripts/gen-agents.js` — Tạo N branch
- `scripts/health-check.js` — Test health CLI
- `scripts/send-job.sh` — Bash: gửi PDF qua API
- `scripts/send-job.bat` — CMD wrapper

### Config
- `ecosystem.config.js` — PM2
- `package.json`, `package-lock.json`
- `.env.example`, `.gitignore`

### Docs (KHÔNG chứa secret)
- `HANDOVER.md` (file này)
- `VERIFICATION.md` — Hướng dẫn vận hành server
- `CLIENT_GUIDE.md` — Spec cho agent + API contract
- `CLIENT_REPLY.md` — Trả lời option cho agent client
- `CLIENT_SEND_JOB.md` — Hướng dẫn gửi job qua API (3 cách)
- `CLIENT_SEND_JOB.ps1` — PowerShell test
- `AGENT_BUILD_PROMPT.md` — Prompt đầy đủ để build agent

### Gitignored (KHÔNG commit)
- `.env` (chmod 600)
- `data/` (SQLite + backups)
- `storage/` (PDF files)
- `logs/` (app + pm2)
- `certs/` (TLS)
- `node_modules/`

---

**Kết thúc báo cáo.** Chúc team dev làm việc hiệu quả!

Nếu có câu hỏi, ping a hoặc comment trên GitHub issue. Mọi thay đổi quan trọng phải qua review của a trước khi merge.
