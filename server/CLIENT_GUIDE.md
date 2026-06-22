# SERVER SPEC — để build Agent (client) ghép vào

> File này tổng hợp **mọi thứ đã build & verify trên server**. A copy về máy Windows, dùng làm tài liệu chính thức khi code Agent.
> 
> **Server đang chạy ở:** VPS `160.250.133.192` (Ubuntu 24.04, user `admin`).
> **Ngày build:** 2026-06-21.
> **Trạng thái:** PM2 `online`, Mosquitto `active`, đã pass 11 test cases end-to-end (xem §11).

---

## 1. Kiến trúc 1 phút

```
[HQ ERP/CRM]
   │ POST /api/print-jobs (HTTPS API + JWT)
   ▼
[Print Service :3000] ──── save PDF to /opt/print-service/storage/ ──── insert jobs DB
   │
   │ publish (MQTTS :8883, TLS, ACL)
   ▼
[Mosquitto broker]
   │
   │ topic: company/printer/{branch_id}/jobs
   ▼
[Agent Windows] ──── decode PDF ──── SumatraPDF ──── máy in
   │
   │ POST /api/print-jobs/{id}/status (X-Agent-Token)
   ▼
[Print Service] ──── update DB ──── done
```

## 2. Endpoints (đã test pass)

### 2.1. Public
| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/health` | - | - | `{status, mqtt, db, uptime_seconds, env}` |

### 2.2. Auth
| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/login` | - | `{client_id, client_secret}` | `{token, token_type:"Bearer", expires_in:"7d"}` |
| GET | `/api/auth/me` | Bearer | - | `{client:{id, name}}` |

### 2.3. Print jobs (Client dùng — HQ)
| Method | Path | Auth | Body / Query | Response |
|---|---|---|---|---|
| POST | `/api/print-jobs` | Bearer | `{branch_id, printer?, pdf_base64, metadata?}` | 201 `{job_id, status:"queued"}` |
| GET | `/api/print-jobs/:id` | Bearer | - | `{id, branch_id, printer, file_path, status, metadata, error, created_at, sent_at, printed_at, failed_at, retry_count, client_id}` |
| GET | `/api/print-jobs?branch_id=X` | **Agent token** | - | `{jobs:[...]}` (pending+sent) |

### 2.4. Print jobs (Agent gọi — quan trọng nhất)
| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/print-jobs/:id/status` | **X-Agent-Token + X-Branch-Id** | `{status: "printed"\|"failed", error?}` | `{ok:true}` |
| GET | `/api/print-jobs/:id/file` | **X-Agent-Token + X-Branch-Id** | - | **200 application/pdf binary** (job pending/sent)<br>**410 Gone** (job đã printed/failed)<br>**403** (branch mismatch)<br>**404** (job/file không tồn tại) |

### 2.5. Branches (Client dùng — HQ)
| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/branches` | Bearer | - | `{branches:[{id, name, location, status, last_seen_at, created_at}]}` |
| POST | `/api/branches` | Bearer | `{name, location?, id?}` | 201 `{id, name, location, agent_token}` ← **token hiện 1 lần** |
| GET | `/api/branches/:id` | Bearer | - | `{...}` (KHÔNG có agent_token_hash) |
| POST | `/api/branches/:id/regen-token` | Bearer | - | `{id, name, agent_token (mới), warning}` |

### 2.6. Printers (Client dùng — HQ, optional cho GĐ1)
| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/printers?branch_id=X` | Bearer | - | `{printers:[...]}` |
| POST | `/api/printers` | Bearer | `{branch_id, name, is_default?}` | 201 `{id, branch_id, name, is_default}` |
| DELETE | `/api/printers/:id` | Bearer | - | `{ok:true}` |

### 2.7. Admin (Client dùng — bulk)
| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/admin/agents` | Bearer | `{count, prefix?, name_template?}` | 201 `{created, branches:[{id, name, agent_token}]}` |

## 3. Authentication

### 3.1. Client (HQ → server) — JWT Bearer
- Header: `Authorization: Bearer <jwt>`
- JWT ký bằng HS256, secret lưu ở `/opt/print-service/.env` (`JWT_SECRET`)
- Expire: 7 ngày
- Payload: `{sub: <client_id>, name, type:"client", iat, exp}`
- Login: POST `/api/auth/login` với `{client_id, client_secret}` → nhận token

**Đã có sẵn 1 client test:**
- `client_id`: `cli_3844de865fa7df32`
- `client_secret`: `<CLIENT_SECRET>`

### 3.2. Agent (Agent → server) — Device token
- Headers:
  - `X-Agent-Token: <token>`
  - `X-Branch-Id: <branch_id>`
- Token: hex 64 chars (32 bytes random), hash SHA256 lưu trong DB
- Verify flow: server hash token nhận được → so sánh với `branches.agent_token_hash` (constant-time compare) → check branch_id khớp
- 401 nếu token sai, 401 nếu branch_id không tồn tại, **403 nếu callback gọi job của branch khác**

**Đã có 3 branch test (br_001 đã rotate token, br_002/br_003 giữ token gốc):**
- `br_001` agent_token: `<AGENT_TOKEN>`
- `br_002` agent_token: (cần regen — xem §10)
- `br_003` agent_token: (cần regen — xem §10)

## 4. MQTT — giao thức

### 4.1. Connection
- URL: `mqtts://160.250.133.192:8883`
- TLS: self-signed cert. Agent PHẢI trust cert này (copy `ca.crt` về → trỏ `--cafile` hoặc trong code `fs.readFileSync`)
- Username/Password: mỗi user 1 cặp, lưu ở `/etc/mosquitto/passwd` (mosquitto hash bcrypt)

**MQTT users (a cần cho agent `.env`):**
- `printservice / <MQTT_PASS>` — service account (KHÔNG dùng cho agent)
- `br_001 / <BRANCH_MQTT_PASS_br_001>` ← **dùng cho agent br_001**
- `br_002 / <BRANCH_MQTT_PASS_br_002>` ← **dùng cho agent br_002**
- `br_003 / <BRANCH_MQTT_PASS_br_003>` ← **dùng cho agent br_003**

### 4.2. Topics
| Topic | Ai publish | Ai subscribe | Payload |
|---|---|---|---|
| `company/printer/{branch_id}/jobs` | Server (`printservice`) | **Agent `{branch_id}`** | `{job_id, pdf_base64, printer, metadata, created_at, retry_count?}` |
| `company/printer/status` | Agent | Server (log only) | optional, agent có thể gửi status real-time |

### 4.3. ACL (Mosquitto, đã config)
- `printservice`: readwrite `#` (toàn quyền)
- `br_XXX`: read `company/printer/br_XXX/#`, write `company/printer/status`
- **Đã test:** br_001 subscribe topic br_002 → KHÔNG nhận được gì. br_002 subscribe topic br_002 → nhận OK.

### 4.4. QoS
- Tất cả publish/subscribe dùng **QoS 1** (at-least-once). Job KHÔNG bị mất khi reconnect.

## 5. Job flow chi tiết (đã verify)

```
1. HQ POST /api/print-jobs
   body: {branch_id, pdf_base64, printer?, metadata?}
   ↓
2. Server validate:
   - branch_id exists in DB
   - pdf_base64 decode → Buffer
   - check magic bytes "%PDF-" (5 bytes đầu)
   ↓
3. Server save PDF → /opt/print-service/storage/{job_id}.pdf
   ↓
4. Server insert jobs row (status='pending')
   ↓
5. Server publish to MQTT topic company/printer/{branch_id}/jobs
   payload: {job_id, pdf_base64, printer, metadata, created_at}
   ↓
6. Server update jobs row (status='sent', sent_at=now)
   ↓
7. Response 201 {job_id, status:"queued"}
   ↓
   ─── MQTT ───
   ↓
8. Agent nhận payload via MQTT subscribe
   ↓
9. Agent decode base64 → file PDF tạm
   ↓
10. Agent in qua SumatraPDF silent
    ↓
11. Agent POST /api/print-jobs/{job_id}/status
    body: {status:"printed"} hoặc {status:"failed", error:"..."}
    ↓
12. Server update jobs row (status='printed'/'failed', printed_at/failed_at)
    ↓
13. Server update branches row (status='online', last_seen_at=now)
    ↓
14. Response 200 {ok:true}
```

## 6. Retry logic (cron server, đã build)

- Mỗi **5 phút**, tìm jobs có `status='sent'` quá **5 phút** chưa callback → republish MQTT
- Tăng `retry_count`. Nếu `retry_count >= 5` → mark `failed` với error "Max retries reached"
- Đã test syntax, đã test publish thành công

## 6.1. Agent reconnect → fetchPending flow (cập nhật 2026-06-21)

Khi agent (re)connect MQTT thành công, nó cần fetch lại các job pending/sent đã miss (do agent offline lúc server publish). Flow đúng:

```
1. Agent reconnect MQTT → on('connect')
2. Agent subscribe topic company/printer/{branch_id}/jobs
3. Agent gọi GET /api/print-jobs?branch_id=X
   → server trả {jobs: [{id, branch_id, status, metadata, ...}]}  ← KHÔNG có pdf_base64, KHÔNG có file_path
4. Với MỖI job trong list:
   a. Agent gọi GET /api/print-jobs/{id}/file  (X-Agent-Token + X-Branch-Id)
      → server trả binary PDF (Content-Type: application/pdf)
      → HOẶC 410 Gone nếu job đã printed/failed (race condition với retry-stale cron)
      → HOẶC 404 nếu file đã bị cleanup xóa
   b. Agent save PDF vào TMP_DIR/{job_id}.pdf
   c. Agent in qua SumatraPDF
   d. Agent gọi POST /api/print-jobs/{id}/status {status:"printed"}
5. Done — DB update, branch last_seen updated
```

**Quan trọng:**
- KHÔNG dùng `file_path` từ list response để SFTP/local đọc file (file_path là `/opt/print-service/storage/...` trên VPS, agent ở Windows không truy cập được)
- LUÔN download qua `/api/print-jobs/:id/file`
- Nếu download trả 410 (job đã printed/failed trong lúc agent đang xử lý) → skip, không in, không báo failed
- Nếu download trả 404 → báo failed với error "PDF file missing on server"

## 7. Edge cases (đã verify trên server)

| Test | Kết quả |
|---|---|
| POST job với PDF invalid (không phải %PDF-) | 400 `{error:"Invalid PDF: missing %PDF- magic bytes"}` |
| POST job với branch không tồn tại | 404 `{error:"Branch 'br_999' not found"}` |
| POST job không có Authorization header | 401 `{error:"Missing Authorization header"}` |
| POST job với JWT sai | 401 `{error:"Invalid or expired token"}` |
| Agent callback với token sai | 401 `{error:"Invalid agent token"}` |
| Agent callback với branch_id khác job | 401 (defensive — branch phải tồn tại trước) |
| Agent callback status="invalid_value" | 400 `{error:"status must be 'printed' or 'failed'"}` |
| Rate limit login > 5 lần/phút | 429 Too Many Requests |
| PM2 restart | Graceful shutdown HTTP+MQTT, auto-restart OK |
| MQTT broker restart | Agent tự reconnect (mqtt lib có reconnectPeriod) |

## 8. Job states (DB)

| status | Ý nghĩa | Ai set |
|---|---|---|
| `pending` | Vừa insert, chưa publish MQTT thành công | Server insert |
| `sent` | Đã publish MQTT, chờ agent callback | Server sau publish OK |
| `printed` | Agent báo in xong | Server sau callback |
| `failed` | Lỗi (max retries / agent báo failed / MQTT publish fail nặng) | Server |

## 9. Server config (a không cần biết chi tiết, chỉ cần tham khảo nếu debug)

**File:** `/opt/print-service/.env` (chmod 600, KHÔNG share)
```
NODE_ENV=production
PORT=3000
DB_PATH=./data/jobs.db
STORAGE_PATH=./storage
STORAGE_RETENTION_DAYS=7
MQTT_URL=mqtts://160.250.133.192:8883
MQTT_USER=printservice
MQTT_PASS=<MQTT_PASS>
MQTT_CA_FILE=/etc/mosquitto/certs/server.crt
MQTT_REJECT_UNAUTHORIZED=true
MQTT_TOPIC_PREFIX=company/printer
MQTT_CLIENT_ID=print-service-prod
JWT_SECRET=<48-byte base64 random>
JWT_EXPIRES_IN=7d
AGENT_TOKEN_SECRET=<48-byte base64 random>
RETRY_INTERVAL_MIN=5
STALE_JOB_MIN=5
MAX_RETRIES=5
CLEANUP_HOUR=3
BACKUP_HOUR=2
AUTH_LOGIN_RATE_PER_MIN=5
```

**File:** `/etc/mosquitto/conf.d/print-service.conf`
```
listener 8883
protocol mqtt
cafile /etc/mosquitto/certs/server.crt
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key
tls_version tlsv1.2
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/acl
log_type error
log_type warning
log_type notice
log_type information
connection_messages true
log_timestamp true
```

**File:** `/etc/mosquitto/acl`
```
user printservice
topic readwrite #

user br_001
topic read company/printer/br_001/#
topic write company/printer/status

user br_002
topic read company/printer/br_002/#
topic write company/printer/status

user br_003
topic read company/printer/br_003/#
topic write company/printer/status
```

## 10. Cách regen token (a sẽ cần khi code xong agent)

```bash
# SSH vào VPS
ssh admin@160.250.133.192

# Login lấy JWT
JWT=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"cli_3844de865fa7df32","client_secret":"<CLIENT_SECRET>"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")

# Regen token cho br_002 (br_001 đã regen rồi)
curl -s -X POST http://localhost:3000/api/branches/br_002/regen-token \
  -H "Authorization: Bearer $JWT"
# → {"id":"br_002","name":"Branch 002","agent_token":"NEW_TOKEN_HEX","warning":"..."}

# Tương tự cho br_003
curl -s -X POST http://localhost:3000/api/branches/br_003/regen-token \
  -H "Authorization: Bearer $JWT"
```

## 11. Test cases server đã pass (kết quả thật)

1. ✅ Mosquitto broker active, TLS hoạt động, ACL chặn đúng giữa các branch
2. ✅ Print Service health endpoint: `{status:"ok", mqtt:"connected", db:"ok"}`
3. ✅ Client login → trả JWT hợp lệ
4. ✅ Tạo job với PDF hợp lệ → 201, lưu DB + publish MQTT
5. ✅ Subscribe br_001 nhận được job của mình, KHÔNG nhận job br_002 (ACL)
6. ✅ Agent callback `status:"printed"` → DB update, branch online
7. ✅ Agent callback `status:"failed"` với error → DB update, status=failed
8. ✅ Callback với token sai → 401
9. ✅ Callback với branch_id khác → 401
10. ✅ POST job với PDF không phải %PDF- → 400 rõ ràng
11. ✅ POST job với branch không tồn tại → 404
12. ✅ PM2 restart → graceful shutdown sạch, auto-restart OK
13. ✅ Backup DB thủ công (VACUUM INTO) tạo file OK
14. ✅ Bulk create 5 branches qua API
15. ✅ UFW firewall mở 22, 3000, 8883
16. ✅ PM2 systemd startup enabled → service tự chạy khi reboot
17. ✅ **GET /api/print-jobs/:id/file** (mới 2026-06-21): download PDF binary 425 bytes, content identical
18. ✅ Download job printed → 410 Gone (status filter hoạt động)
19. ✅ Download job sent → 200 OK (re-fetch sau reconnect)
20. ✅ Download với token sai / branch khác / job not found → 401/401/404

## 12. Code skeleton cho Agent (Node.js, copy về Windows chạy)

**File `agent.js`:**
```js
'use strict';

const mqtt = require('mqtt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const BRANCH_ID = process.env.BRANCH_ID;          // 'br_001'
const AGENT_TOKEN = process.env.AGENT_TOKEN;      // 64-char hex
const MQTT_URL = process.env.MQTT_URL;            // 'mqtts://160.250.133.192:8883'
const MQTT_USER = process.env.MQTT_USER;          // 'br_001'
const MQTT_PASS = process.env.MQTT_PASS;          // 32-char hex
const MQTT_CA_FILE = process.env.MQTT_CA_FILE;    // 'C:\\print-system\\ca.crt'
const API_URL = process.env.API_URL;              // 'http://160.250.133.192:3000'
const SUMATRA_PATH = process.env.SUMATRA_PATH;    // 'C:\\print-system\\tools\\SumatraPDF.exe'
const TMP_DIR = process.env.TMP_DIR || path.join(__dirname, 'tmp');
const PRINTER_NAME = process.env.PRINTER_NAME;    // optional, mặc định máy in default

// Validate required
for (const [k, v] of Object.entries({BRANCH_ID, AGENT_TOKEN, MQTT_URL, MQTT_USER, MQTT_PASS, API_URL, SUMATRA_PATH})) {
  if (!v) { console.error(`Missing env: ${k}`); process.exit(1); }
}

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

// Logger
function log(level, msg, meta = {}) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg} ${JSON.stringify(meta)}`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, 'logs', `${new Date().toISOString().slice(0,10)}.log`), line + '\n');
}

// Queue xử lý tuần tự
const queue = [];
let busy = false;
function enqueue(job) { queue.push(job); drain(); }
async function drain() {
  if (busy || queue.length === 0) return;
  busy = true;
  const job = queue.shift();
  try { await processJob(job); } catch (e) { log('error', 'drain error', { err: e.message }); }
  finally { busy = false; drain(); }
}

async function processJob(job) {
  // job có thể đến từ 2 nguồn:
  //   - MQTT payload: {job_id, pdf_base64, printer, metadata, ...}  (full)
  //   - fetchPending (sau reconnect): {id, branch_id, status, metadata, ...}  (không có pdf_base64)
  const job_id = job.job_id || job.id;
  const printer = job.printer;
  log('info', 'Processing job', { job_id, source: job.pdf_base64 ? 'mqtt' : 'fetch' });

  let tmpPath;
  try {
    // Lấy PDF binary
    if (job.pdf_base64) {
      // Từ MQTT — đã có base64
      const buf = Buffer.from(job.pdf_base64, 'base64');
      if (buf.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error('Invalid PDF magic bytes (from MQTT payload)');
      }
      tmpPath = path.join(TMP_DIR, `${job_id}.pdf`);
      fs.writeFileSync(tmpPath, buf);
    } else {
      // Từ fetchPending — phải download qua API
      tmpPath = await downloadJobFile(job_id);
      if (!tmpPath) return; // 410/404 — job đã in hoặc file mất, skip
    }

    // In qua SumatraPDF
    await printPdf(tmpPath, printer);
    log('info', 'Printed', { job_id });
    await reportStatus(job_id, 'printed');
  } catch (e) {
    log('error', 'Print failed', { job_id, err: e.message });
    await reportStatus(job_id, 'failed', e.message);
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (e) {} }
  }
}

/**
 * Download PDF từ server qua API. Trả về đường dẫn file tạm, hoặc null nếu skip.
 *   200: file OK → trả path
 *   410: job đã printed/failed (race condition) → trả null, skip im lặng
 *   404: file đã cleanup xóa → trả null, log warn
 *   403/401: auth fail → throw (sẽ bị catch ở processJob → báo failed)
 */
async function downloadJobFile(jobId) {
  const tmpPath = path.join(TMP_DIR, `${jobId}.pdf`);
  try {
    const r = await axios.get(`${API_URL}/api/print-jobs/${jobId}/file`, {
      headers: {
        'X-Agent-Token': AGENT_TOKEN,
        'X-Branch-Id': BRANCH_ID,
      },
      responseType: 'arraybuffer',
      timeout: 30000,
      // KHÔNG validate status — để mình check rõ ràng từng case
      validateStatus: () => true,
    });
    if (r.status === 200) {
      fs.writeFileSync(tmpPath, Buffer.from(r.data));
      log('debug', 'Downloaded file', { jobId, size: r.data.byteLength });
      return tmpPath;
    }
    if (r.status === 410) {
      log('info', 'Job already finished, skip', { jobId, status: r.data?.error });
      return null;
    }
    if (r.status === 404) {
      log('warn', 'PDF file missing on server (likely cleanup)', { jobId });
      return null;
    }
    throw new Error(`Download HTTP ${r.status}: ${r.data?.error || 'unknown'}`);
  } catch (e) {
    throw new Error(`Download failed: ${e.message}`);
  }
}

function printPdf(pdfPath, printer) {
  return new Promise((resolve, reject) => {
    const args = ['-print-to', printer || PRINTER_NAME || '', '-silent', '-exit-when-done', pdfPath];
    // Nếu không có printer cụ thể, để SumatraPDF dùng default
    if (!printer && !PRINTER_NAME) args.splice(1, 2);

    const proc = spawn(SUMATRA_PATH, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', d => stderr += d.toString());

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Print timeout 120s'));
    }, 120000);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) resolve();
      else reject(new Error(`SumatraPDF exit ${code}: ${stderr}`));
    });
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function reportStatus(jobId, status, error = null) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await axios.post(
        `${API_URL}/api/print-jobs/${jobId}/status`,
        { status, error },
        {
          headers: {
            'X-Agent-Token': AGENT_TOKEN,
            'X-Branch-Id': BRANCH_ID,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      log('info', 'Status reported', { jobId, status, attempt: i });
      return r.data;
    } catch (e) {
      log('warn', 'Status report failed', { jobId, attempt: i, err: e.message });
      if (i < 3) await new Promise(r => setTimeout(r, i * 2000));
    }
  }
  log('error', 'Status report gave up after 3 retries', { jobId });
}

// MQTT client
function connectMqtt() {
  const client = mqtt.connect(MQTT_URL, {
    clientId: `agent-${BRANCH_ID}-${process.pid}`,
    username: MQTT_USER,
    password: MQTT_PASS,
    ca: fs.readFileSync(MQTT_CA_FILE),
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    clean: true,
  });

  client.on('connect', async () => {
    log('info', 'MQTT connected');
    const topic = `company/printer/${BRANCH_ID}/jobs`;
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) log('error', 'MQTT subscribe failed', { err: err.message });
      else log('info', 'Subscribed', { topic });
    });
    // Sau khi (re)connect → fetch job pending chưa xử lý
    await fetchPending();
  });

  client.on('reconnect', () => log('debug', 'MQTT reconnecting'));
  client.on('close', () => log('warn', 'MQTT closed'));
  client.on('error', (e) => log('error', 'MQTT error', { err: e.message }));

  client.on('message', (topic, payload) => {
    try {
      const job = JSON.parse(payload.toString('utf8'));
      log('info', 'Job received', { job_id: job.job_id, retry: job.retry_count });
      enqueue(job);
    } catch (e) {
      log('error', 'Bad MQTT payload', { err: e.message });
    }
  });
}

async function fetchPending() {
  try {
    const r = await axios.get(`${API_URL}/api/print-jobs`, {
      params: { branch_id: BRANCH_ID },
      headers: {
        'X-Agent-Token': AGENT_TOKEN,
        'X-Branch-Id': BRANCH_ID,
      },
      timeout: 10000,
    });
    const jobs = r.data.jobs || [];
    log('info', 'Fetched pending jobs', { count: jobs.length });
    jobs.forEach(enqueue);
  } catch (e) {
    log('error', 'Fetch pending failed', { err: e.message });
  }
}

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => {
  log('info', `Received ${s}, exiting`);
  process.exit(0);
}));

log('info', 'Agent starting', { branch: BRANCH_ID });
connectMqtt();
```

**File `.env` mẫu (Windows, mỗi agent 1 file):**
```
BRANCH_ID=br_001
AGENT_TOKEN=<AGENT_TOKEN>
MQTT_URL=mqtts://160.250.133.192:8883
MQTT_USER=br_001
MQTT_PASS=<BRANCH_MQTT_PASS_br_001>
MQTT_CA_FILE=C:\print-system\ca.crt
API_URL=http://160.250.133.192:3000
SUMATRA_PATH=C:\print-system\tools\SumatraPDF.exe
TMP_DIR=C:\print-system\agents\agent-01\tmp
# PRINTER_NAME=  (bỏ trống = máy in mặc định của Windows)
```

**File `package.json` agent:**
```json
{
  "name": "print-agent",
  "version": "1.0.0",
  "main": "agent.js",
  "scripts": { "start": "node agent.js" },
  "dependencies": {
    "axios": "^1.7.0",
    "dotenv": "^16.4.5",
    "mqtt": "^5.10.1"
  }
}
```

## 13. Checklist test agent khi xong code

Từ máy Windows của a, sau khi code xong:

```powershell
# 1. Test subscribe (phải thấy "Subscribed")
node agent.js
# → "Agent starting" "MQTT connected" "Subscribed"

# 2. Mở terminal khác, gửi job từ máy a (hoặc từ VPS)
#    - Từ VPS:
#      curl -X POST http://localhost:3000/api/print-jobs -H "Authorization: Bearer $JWT" \
#        -H 'Content-Type: application/json' \
#        -d "{\"branch_id\":\"br_001\",\"pdf_base64\":\"$(base64 -w 0 test.pdf)\"}"

# 3. Agent log phải in: "Job received" → "Processing" → "Printed" → "Status reported"
# 4. Máy in phải in ra giấy thật
# 5. Check DB trên VPS: jobs.status phải = 'printed', branches.last_seen_at updated
```

## 14. Common pitfalls (đã gặp khi build server)

| # | Vấn đề | Cách tránh |
|---|---|---|
| 1 | `mosquitto` không đọc được cert (permission denied) | Move cert sang `/etc/mosquitto/certs/` owner `mosquitto:mosquitto` |
| 2 | `Protocol error` khi `mosquitto_pub` tới `localhost` | Cert SAN phải có `localhost`/`127.0.0.1` |
| 3 | `require('./config')` sai path từ `src/services/*.js` | Phải `require('../config')` |
| 4 | `EADDRINUSE :::3000` do crash loop | `fuser -k 3000/tcp` rồi `pm2 delete` + start lại |
| 5 | Forgot `chmod 600 .env` | Secret lộ khi backup |
| 6 | `password_file` chưa `chown mosquitto:mosquitto` | Mosquitto không đọc được, login fail |

## 15. File server summary (cho a tham khảo)

```
/opt/print-service/
├── src/                  (17 files - logic server)
│   ├── index.js          (entry, signal handling)
│   ├── app.js            (Express setup)
│   ├── config.js         (env validation)
│   ├── db.js             (SQLite + prepared stmts)
│   ├── mqtt-client.js    (MQTT wrapper)
│   ├── logger.js         (Winston)
│   ├── api/              (6 files: health, auth, jobs, branches, printers, admin)
│   ├── middleware/       (3 files: auth, validate, error)
│   ├── services/         (4 files: job, auth, token, pdf-validator)
│   └── jobs/             (3 files: retry-stale, cleanup-files, backup-db)
├── scripts/              (3 files: gen-client, gen-agents, health-check)
├── data/                 (jobs.db, backups/)
├── storage/              (PDFs)
├── logs/                 (app + pm2 logs)
├── .env                  (chmod 600)
├── ecosystem.config.js   (PM2)
├── package.json
├── VERIFICATION.md       (hướng dẫn vận hành server)
└── CLIENT_GUIDE.md       (file này - cho a build agent)
```

## 16. Nếu agent không hoạt động — debug checklist

1. **MQTT connect fail**: Check `ca.crt` đúng file, đúng đường dẫn. Thử `mosquitto_sub` bằng tay xem pass.
2. **HTTP 401 khi callback**: Token sai (đã regen?) hoặc branch_id sai format (phải `br_001` không phải `Branch 001`).
3. **SumatraPDF in không ra giấy**: 
   - Thử mở SumatraPDF bằng tay in 1 file PDF trước xem máy in OK không
   - Tên printer phải khớp CHÍNH XÁC (mở `Printers and Faxes` xem tên)
   - Test: `SumatraPDF.exe -print-to "Tên_Máy_In" -silent -exit-when-done test.pdf`
4. **Job stuck ở 'sent'**: Agent không chạy, hoặc callback fail. Check log + thử `fetchPending` thủ công.
5. **VPS từ chối kết nối**: `sudo ufw status` xem 3000 + 8883 còn open không.

---

**Tóm lại a cần nhớ:**
- Server chạy ở `http://160.250.133.192:3000` + `mqtts://160.250.133.192:8883`
- Agent subscribe topic `company/printer/{branch_id}/jobs`
- Agent callback `POST /api/print-jobs/{job_id}/status` với `X-Agent-Token` + `X-Branch-Id`
- Token đã regen cho br_001, br_002/br_003 cần regen khi a cần
- Đã có sẵn 1 client test (`cli_3844de865fa7df32`) dùng để gửi job từ HQ

Khi a build xong agent, gặp vấn đề gì thì SSH vào VPS check log + DB, hoặc nhắn tôi hỗ trợ.
