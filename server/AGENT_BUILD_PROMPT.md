# Prompt gửi Agent Claude Code (client) — Build Print Agent

> Copy nội dung từ `## PROMPT BẮT ĐẦU` xuống dưới, paste vào Claude Code ở máy Windows của a.

---

## PROMPT BẮT ĐẦU

Tôi cần bạn build 1 **Print Agent** (Node.js) chạy trên Windows. Agent này là phần client của hệ thống in PDF từ xa: nhận job in qua MQTT, in ra máy in local qua SumatraPDF, báo lại status cho server qua HTTPS API.

**Bạn KHÔNG CẦN truy cập server** — toàn bộ thông số kỹ thuật, thông tin auth, code skeleton đã có trong prompt này.

---

### 1. MỤC TIÊU

Build 1 agent chạy được trên Windows, có thể:
- Subscribe MQTT topic `company/printer/{branch_id}/jobs` (TLS, có auth)
- Khi nhận job → in PDF ra máy in qua SumatraPDF
- Báo status về server (printed/failed)
- **Khi reconnect** → fetch danh sách job pending chưa xử lý từ server, **download PDF từng job qua API** rồi in
- Auto-reconnect khi mất mạng

---

### 2. SERVER (đã chạy sẵn, KHÔNG cần build)

**Endpoint:** `http://160.250.133.192:3000`
**MQTT broker:** `mqtts://160.250.133.192:8883`
**CA cert:** tôi sẽ cung cấp nội dung cert ở §3

**MQTT topic:**
- Subscribe: `company/printer/{branch_id}/jobs`
- Publish: `company/printer/status` (optional, server log only)

**Endpoints cần dùng (Agent auth — `X-Agent-Token` + `X-Branch-Id`):**

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/print-jobs?branch_id=X` | List job pending+sent (khi reconnect) — trả metadata, KHÔNG có pdf_base64 |
| GET | `/api/print-jobs/:id/file` | **Download PDF binary** (Content-Type: application/pdf) — chỉ job pending/sent mới download được, job printed/failed trả 410 |
| POST | `/api/print-jobs/:id/status` | Callback báo `{"status":"printed"}` hoặc `{"status":"failed","error":"..."}` |

---

### 3. CA CERT (self-signed)

Tạo file `C:\print-system\ca.crt` với nội dung sau (cert này đã có SAN cho IP `160.250.133.192`, `localhost`, `127.0.0.1`, `izigovn`):

```
<TLS_CERT_CONTENT>
```

**Bước tạo file:** dùng PowerShell:
```powershell
mkdir C:\print-system -Force
ni C:\print-system\ca.crt -Force
# Mở file bằng notepad, paste nội dung ở trên, Save (encoding UTF-8)
notepad C:\print-system\ca.crt
```

---

### 4. THÔNG TIN ĐĂNG NHẬP (chỉ dùng cho 1 agent test = br_001)

> **br_002 / br_003:** Tôi CHƯA có agent_token (đã bị mất trong quá trình test). Bạn chỉ cần build cho br_001. Sau khi xong tôi sẽ regen token cho 2 branch còn lại qua API.

**File `.env` cho `agent-01`:**
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
LOG_DIR=C:\print-system\agents\agent-01\logs
# PRINTER_NAME=  (bỏ trống = máy in mặc định của Windows)
```

---

### 5. CÀI SUMATRAPDF

Tải portable: https://www.sumatrapdfreader.org/download-free-pdf-viewer
- Chọn **SumatraPDF Portable** (file .zip, ~6MB)
- Giải nén vào `C:\print-system\tools\`
- Verify: `C:\print-system\tools\SumatraPDF.exe` tồn tại
- Test thử: `C:\print-system\tools\SumatraPDF.exe --help` phải in usage

**Nếu chưa có máy in thật:** vẫn build agent bình thường. Khi test in, có thể chọn "Microsoft Print to PDF" làm máy in mặc định để verify flow (file PDF sẽ được tạo ra, không in ra giấy thật nhưng vẫn pass flow).

---

### 6. CẤU TRÚC THƯ MỤC

Tạo:
```
C:\print-system\
├── ca.crt                              ← §3
├── tools\
│   └── SumatraPDF.exe                  ← §5
└── agents\
    └── agent-01\                       ← chỉ build 1 agent
        ├── agent.js
        ├── .env                        ← §4
        ├── package.json
        ├── tmp\                        ← file PDF tạm (tự tạo)
        └── logs\                       ← log theo ngày (tự tạo)
```

---

### 7. CODE SKELETON ĐẦY ĐỦ

**`C:\print-system\agents\agent-01\package.json`:**
```json
{
  "name": "print-agent-01",
  "version": "1.0.0",
  "private": true,
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "dotenv": "^16.4.5",
    "mqtt": "^5.10.1"
  }
}
```

**`C:\print-system\agents\agent-01\agent.js`:**
```js
'use strict';

const mqtt = require('mqtt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ===== Config =====
const BRANCH_ID    = process.env.BRANCH_ID;
const AGENT_TOKEN  = process.env.AGENT_TOKEN;
const MQTT_URL     = process.env.MQTT_URL;
const MQTT_USER    = process.env.MQTT_USER;
const MQTT_PASS    = process.env.MQTT_PASS;
const MQTT_CA_FILE = process.env.MQTT_CA_FILE;
const API_URL      = process.env.API_URL;
const SUMATRA_PATH = process.env.SUMATRA_PATH;
const TMP_DIR      = process.env.TMP_DIR || path.join(__dirname, 'tmp');
const LOG_DIR      = process.env.LOG_DIR || path.join(__dirname, 'logs');
const PRINTER_NAME = process.env.PRINTER_NAME || null; // null = default

const REQUIRED = { BRANCH_ID, AGENT_TOKEN, MQTT_URL, MQTT_USER, MQTT_PASS, MQTT_CA_FILE, API_URL, SUMATRA_PATH };
for (const [k, v] of Object.entries(REQUIRED)) {
  if (!v) { console.error(`[FATAL] Missing env: ${k}`); process.exit(1); }
}

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

// ===== Logger =====
function log(level, msg, meta = {}) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg} ${JSON.stringify(meta)}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`), line + '\n');
  } catch (e) { /* ignore */ }
}

// ===== Job queue =====
const queue = [];
let busy = false;

function enqueue(job) {
  queue.push(job);
  log('debug', 'Job enqueued', { job_id: job.job_id || job.id, queue_size: queue.length });
  drain();
}

async function drain() {
  if (busy) return;
  if (queue.length === 0) return;
  busy = true;
  const job = queue.shift();
  try {
    await processJob(job);
  } catch (e) {
    log('error', 'processJob unhandled error', { err: e.message, stack: e.stack });
  } finally {
    busy = false;
    setImmediate(drain);
  }
}

// ===== Process 1 job =====
async function processJob(job) {
  // job từ MQTT:    {job_id, pdf_base64, printer, metadata, ...}
  // job từ fetch:   {id, branch_id, status, metadata, ...} (không có pdf_base64)
  const jobId  = job.job_id || job.id;
  const printer = job.printer || null;
  const source = job.pdf_base64 ? 'mqtt' : 'fetch';
  log('info', 'Processing job', { job_id: jobId, source, printer });

  let tmpPath = null;
  try {
    // Lấy PDF binary
    if (job.pdf_base64) {
      // Từ MQTT — đã có base64
      const buf = Buffer.from(job.pdf_base64, 'base64');
      if (buf.length < 8 || buf.subarray(0, 5).toString('utf8') !== '%PDF-') {
        throw new Error('Invalid PDF magic bytes (from MQTT payload)');
      }
      tmpPath = path.join(TMP_DIR, `${jobId}.pdf`);
      fs.writeFileSync(tmpPath, buf);
    } else {
      // Từ fetchPending — download qua API
      tmpPath = await downloadJobFile(jobId);
      if (!tmpPath) return; // 410/404 — skip im lặng
    }

    // In qua SumatraPDF
    await printPdf(tmpPath, printer);
    log('info', 'Printed OK', { job_id: jobId });

    // Báo status
    await reportStatus(jobId, 'printed', null);
  } catch (e) {
    log('error', 'Print failed', { job_id: jobId, err: e.message });
    await reportStatus(jobId, 'failed', e.message);
  } finally {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch (e) {} }
  }
}

// ===== Download PDF từ server =====
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
      validateStatus: () => true, // mình check tay
    });

    if (r.status === 200) {
      const buf = Buffer.from(r.data);
      if (buf.length < 8 || buf.subarray(0, 5).toString('utf8') !== '%PDF-') {
        throw new Error('Downloaded file is not a valid PDF');
      }
      fs.writeFileSync(tmpPath, buf);
      log('debug', 'Downloaded file', { job_id: jobId, size: buf.length });
      return tmpPath;
    }
    if (r.status === 410) {
      log('info', 'Job already finished, skip', { job_id: jobId });
      return null;
    }
    if (r.status === 404) {
      log('warn', 'PDF file missing on server (likely cleanup), skip', { job_id: jobId });
      return null;
    }
    if (r.status === 401 || r.status === 403) {
      throw new Error(`Auth failed (HTTP ${r.status}) — check AGENT_TOKEN and BRANCH_ID`);
    }
    throw new Error(`Download HTTP ${r.status}`);
  } catch (e) {
    if (e.code === 'ECONNABORTED') throw new Error('Download timeout 30s');
    if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') throw new Error(`Cannot reach server: ${e.message}`);
    throw e;
  }
}

// ===== In PDF qua SumatraPDF =====
function printPdf(pdfPath, printer) {
  return new Promise((resolve, reject) => {
    const targetPrinter = printer || PRINTER_NAME;
    const args = [];
    if (targetPrinter) {
      args.push('-print-to', targetPrinter);
    }
    args.push('-silent', '-exit-when-done', pdfPath);

    log('debug', 'SumatraPDF args', { args: args.slice(0, 3), file: path.basename(pdfPath) });

    const proc = spawn(SUMATRA_PATH, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stdout.on('data', () => {}); // drain

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('Print timeout 120s'));
    }, 120000);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      // SumatraPDF exit codes: 0 = OK, 1 = error, null = killed
      if (code === 0) resolve();
      else reject(new Error(`SumatraPDF exit ${code}${stderr ? ': ' + stderr.trim() : ''}`));
    });
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`SumatraPDF spawn error: ${e.message} (is SUMATRA_PATH correct?)`));
    });
  });
}

// ===== Báo status về server =====
async function reportStatus(jobId, status, errorMessage) {
  for (let i = 1; i <= 3; i++) {
    try {
      await axios.post(
        `${API_URL}/api/print-jobs/${jobId}/status`,
        { status, error: errorMessage },
        {
          headers: {
            'X-Agent-Token': AGENT_TOKEN,
            'X-Branch-Id': BRANCH_ID,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
          validateStatus: (s) => s === 200,
        }
      );
      log('info', 'Status reported', { job_id: jobId, status, attempt: i });
      return;
    } catch (e) {
      log('warn', 'Status report failed', { job_id: jobId, attempt: i, err: e.message });
      if (i < 3) await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
  log('error', 'Status report gave up after 3 retries', { job_id: jobId });
}

// ===== Fetch pending jobs khi (re)connect =====
async function fetchPending() {
  try {
    const r = await axios.get(`${API_URL}/api/print-jobs`, {
      params: { branch_id: BRANCH_ID },
      headers: {
        'X-Agent-Token': AGENT_TOKEN,
        'X-Branch-Id': BRANCH_ID,
      },
      timeout: 10000,
      validateStatus: (s) => s === 200,
    });
    const jobs = r.data.jobs || [];
    log('info', 'Fetched pending jobs (after reconnect)', { count: jobs.length });
    jobs.forEach((j) => enqueue(j));
  } catch (e) {
    log('error', 'Fetch pending failed', { err: e.message });
  }
}

// ===== MQTT client =====
let mqttClient = null;

function connectMqtt() {
  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: `agent-${BRANCH_ID}-${process.pid}`,
    username: MQTT_USER,
    password: MQTT_PASS,
    ca: fs.readFileSync(MQTT_CA_FILE),
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    clean: true,
  });

  mqttClient.on('connect', async () => {
    log('info', 'MQTT connected', { url: MQTT_URL });
    const topic = `company/printer/${BRANCH_ID}/jobs`;
    mqttClient.subscribe(topic, { qos: 1 }, (err) => {
      if (err) log('error', 'MQTT subscribe failed', { err: err.message });
      else log('info', 'Subscribed', { topic });
    });
    // Sau khi (re)connect → fetch lại job pending
    await fetchPending();
  });

  mqttClient.on('reconnect', () => log('debug', 'MQTT reconnecting...'));
  mqttClient.on('close', () => log('warn', 'MQTT closed'));
  mqttClient.on('offline', () => log('warn', 'MQTT offline'));
  mqttClient.on('error', (e) => log('error', 'MQTT error', { err: e.message }));

  mqttClient.on('message', (topic, payload) => {
    try {
      const job = JSON.parse(payload.toString('utf8'));
      log('info', 'Job received via MQTT', { job_id: job.job_id, retry: job.retry_count || 0 });
      enqueue(job);
    } catch (e) {
      log('error', 'Bad MQTT payload', { err: e.message });
    }
  });
}

// ===== Graceful shutdown =====
function shutdown(signal) {
  log('info', `Received ${signal}, shutting down...`);
  if (mqttClient) mqttClient.end(false);
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => log('error', 'uncaughtException', { err: e.message, stack: e.stack }));
process.on('unhandledRejection', (r) => log('error', 'unhandledRejection', { reason: String(r) }));

// ===== Start =====
log('info', 'Agent starting', { branch: BRANCH_ID, pid: process.pid });
connectMqtt();
```

---

### 8. YÊU CẦU CỤ THỂ

1. **Tạo file `.env`** ở `C:\print-system\agents\agent-01\.env` với nội dung §4
2. **Tạo `package.json`** theo §7
3. **Tạo `agent.js`** theo §7 (copy nguyên khối)
4. **Chạy `npm install`** trong folder `C:\print-system\agents\agent-01\`
5. **Test syntax:** `node --check agent.js`
6. **Tạo file `ca.crt`** ở `C:\print-system\ca.crt` theo §3
7. **Verify setup** bằng cách chạy `node agent.js` — phải thấy log:
   ```
   Agent starting {branch:"br_001", pid:...}
   MQTT connected {url:"mqtts://160.250.133.192:8883"}
   Subscribed {topic:"company/printer/br_001/jobs"}
   Fetched pending jobs (after reconnect) {count:0}
   ```

Nếu thấy các log trên → agent đã connect thành công. **KHÔNG CẦN in giấy thật** để verify (có thể dùng "Microsoft Print to PDF" làm default printer để test).

---

### 9. TEST FLOW (verify agent hoạt động end-to-end)

Sau khi `node agent.js` chạy, mở PowerShell khác, gửi job test (tôi sẽ chạy lệnh này từ server, bạn chỉ cần theo dõi log agent):

**Test case 1 — Job từ MQTT (real-time):**
- PowerShell khác (tôi chạy trên VPS): `curl -X POST ...` gửi job br_001
- Agent log phải in: `Job received via MQTT` → `Processing job {source:"mqtt"}` → `Printed OK` → `Status reported`

**Test case 2 — Job từ fetchPending (sau reconnect):**
- Tôi sẽ gửi job br_001 (agent vẫn đang chạy, nhận qua MQTT — để test case này đúng, tôi sẽ **tắt agent**, gửi job, **bật lại agent**, agent sẽ thấy `Fetched pending jobs {count:1}` → download file → in)

---

### 10. XỬ LÝ LỖI (bạn sẽ tự debug, không cần hỏi tôi)

| Lỗi có thể gặp | Cách fix |
|---|---|
| `Error: ENOENT spawn C:\print-system\tools\SumatraPDF.exe` | Tải SumatraPDF về đúng đường dẫn §5 |
| `Error: unable to verify the first certificate` (MQTT) | Cert `ca.crt` sai nội dung hoặc sai path. Verify lại §3 |
| `Error: Connection refused` (MQTT) | Server firewall chặn. Tôi sẽ check (không phải việc của bạn) |
| `HTTP 401 Invalid agent token` | `AGENT_TOKEN` trong `.env` sai. Copy lại §4 |
| `HTTP 401 Missing X-Branch-Id` | `BRANCH_ID` trong `.env` sai. Copy lại §4 |
| `SumatraPDF exit 1` | Sai tên printer. Thử bỏ `PRINTER_NAME` để dùng default |
| `Cannot reach server` | `API_URL` sai hoặc VPS offline |

---

### 11. BÁO CÁO LẠI

Sau khi xong, báo tôi:
1. Agent log khi start (3-4 dòng đầu)
2. Kết quả test case 1 (log agent + có in ra file PDF/giấy không)
3. Kết quả test case 2 (sau reconnect, có download + in không)
4. Có lỗi gì không (nếu có, paste full error + stack trace)

---

## PROMPT KẾT THÚC
