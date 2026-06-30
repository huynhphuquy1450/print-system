'use strict';

// Print Agent for branch br_001
// - Subscribes MQTT topic company/printer/br_001/jobs (metadata only, v2)
// - Downloads PDF via GET /api/print-jobs/:id/file, prints via SumatraPDF
// - POSTs status (printed/failed) back to Print Service
//
// Spec reference: SERVER_SPEC §12

// Handle --register BEFORE requiring env vars (the agent doesn't yet have
// BRANCH_ID/AGENT_TOKEN during first-time registration). Detected by
// presence of --register in argv; install JSON path is the next arg.
const REGISTER_MODE = process.argv.includes('--register');
if (REGISTER_MODE) {
 const _idx = process.argv.indexOf('--register');
 const _installPath = process.argv[_idx + 1];
 if (!_installPath) {
 console.error('Usage: agent --register <install.json>');
 process.exit(1);
 }
 // await + exit code rõ ràng; in ra stderr để không mất output khi chạy qua pipe (Windows).
 require('./register')(_installPath)
 .then((r) => {
 process.stderr.write(`\n✓ Registered as ${r.branch_id}\n✓ Saved to ${r.envPath}\n`);
 // setImmediate: thoát ở macro-task thay vì ngay trong Promise microtask để tránh
 // race condition libuv win/async.c trên Windows Node 24 (STATUS_STACK_BUFFER_OVERRUN).
 setImmediate(() => process.exit(0));
 })
 .catch((e) => {
 process.stderr.write(`✗ REGISTER_FAILED: ${e.message}\n`);
 setImmediate(() => process.exit(1));
 });
 // Không dùng top-level return (babel-jest cấm trong poll.test.js).
 // mqtt/axios được require có điều kiện bên dưới để giữ sạch trong register mode.
}

// Không require mqtt/axios trong register mode: tránh libuv handle tồn tại khi
// process.exit() gọi từ Promise .then() trên Windows (STATUS_STACK_BUFFER_OVERRUN).
const mqtt = REGISTER_MODE ? null : require('mqtt');
const axios = REGISTER_MODE ? null : require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
if (!REGISTER_MODE) require('dotenv').config();

const BRANCH_ID = process.env.BRANCH_ID;
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const MQTT_URL = process.env.MQTT_URL;
const MQTT_USER = process.env.MQTT_USER;
const MQTT_PASS = process.env.MQTT_PASS;
const MQTT_CA_FILE = process.env.MQTT_CA_FILE;
const API_URL = process.env.API_URL;
const SUMATRA_PATH = process.env.SUMATRA_PATH;
const TMP_DIR = process.env.TMP_DIR || path.join(__dirname, 'agents', 'agent-01', 'tmp');
const PRINTER_NAME = process.env.PRINTER_NAME; // optional, mặc định = Windows default printer
// Poll fallback: agent tự fetchPending mỗi POLL_INTERVAL giây, ĐỘC LẬP với MQTT (lưới an toàn
// khi broker sập). Đơn vị giây, mặc định 15.
const POLL_INTERVAL_MS = (parseInt(process.env.POLL_INTERVAL, 10) || 15) * 1000;
// Topic prefix khớp server (config.mqtt.topicPrefix). Mặc định 'company/printer'; đọc từ env để
// nếu HQ đổi prefix thì agent subscribe đúng topic (register.js ghi MQTT_TOPIC_PREFIX từ server).
const TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'company/printer';
// Xác thực cert MQTT: mặc định bật (true). Chỉ tắt khi MQTT_REJECT_UNAUTHORIZED=false (debug khẩn).
const MQTT_REJECT_UNAUTHORIZED = process.env.MQTT_REJECT_UNAUTHORIZED !== 'false';

// Validate required env (skip khi --register: agent chưa có các biến này lúc đăng ký lần đầu)
if (!REGISTER_MODE) {
 for (const [k, v] of Object.entries({
 BRANCH_ID, AGENT_TOKEN, MQTT_URL, MQTT_USER, MQTT_PASS,
 MQTT_CA_FILE, API_URL, SUMATRA_PATH,
 })) {
 if (!v) {
 console.error(`[FATAL] Missing env: ${k}`);
 process.exit(1);
 }
 }
}

const LOG_DIR = path.join(__dirname, 'logs');
// Chỉ tạo thư mục khi chạy thật; register mode chưa có .env nên không cần (tránh side-effect thừa).
if (!REGISTER_MODE) {
 fs.mkdirSync(TMP_DIR, { recursive: true });
 fs.mkdirSync(LOG_DIR, { recursive: true });
}

// HTTPS agent cho call API: Node KHÔNG dùng Windows cert store, nên khi API_URL là HTTPS ký bởi
// Step-CA nội bộ, axios sẽ fail TLS nếu thiếu CA. Nạp lại chính MQTT_CA_FILE (root_ca.crt mà
// installer đã copy) làm CA mặc định cho axios → chạy đúng cả HTTP lẫn HTTPS+Step-CA, không cần
// NODE_EXTRA_CA_CERTS. Bọc try/catch để không crash lúc load nếu CA chưa cài (connectMqtt() sẽ báo
// lỗi rõ + exit(1) ở bước boot). Set qua axios.defaults nên mọi call (download/status/poll/heartbeat)
// đều dùng — có guard axios.defaults để không vỡ unit test mock axios.
let apiHttpsAgent;
if (!REGISTER_MODE && MQTT_CA_FILE) {
 try {
 apiHttpsAgent = new https.Agent({ ca: fs.readFileSync(MQTT_CA_FILE) });
 } catch (e) {
 apiHttpsAgent = undefined;
 }
}
if (apiHttpsAgent && axios && axios.defaults) {
 axios.defaults.httpsAgent = apiHttpsAgent;
}

// Logger
function log(level, msg, meta = {}) {
 const line = `[${new Date().toISOString()}] [${level}] ${msg} ${JSON.stringify(meta)}`;
 console.log(line);
 const logFile = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.log`);
 try {
 fs.appendFileSync(logFile, line + '\n');
 } catch (e) {
 // Log file write failed - print to stderr but don't crash
 console.error(`[WARN] Cannot write log: ${e.message}`);
 }
}

// Cleanup tmp files left from previous crashes (>1 hour old)
function cleanupStaleTmp() {
 try {
 const files = fs.readdirSync(TMP_DIR);
 const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
 let removed = 0;
 for (const f of files) {
 if (!f.endsWith('.pdf')) continue;
 const fp = path.join(TMP_DIR, f);
 const stat = fs.statSync(fp);
 if (stat.mtimeMs < cutoff) {
 fs.unlinkSync(fp);
 removed++;
 }
 }
 if (removed > 0) log('info', 'Cleaned stale tmp files', { count: removed });
 } catch (e) {
 log('warn', 'Tmp cleanup failed', { err: e.message });
 }
}

// Job queue (sequential)
const queue = [];
// Dedup theo job_id: chặn enqueue trùng khi MQTT message + poll/fetchPending cùng thấy 1 job
// (poll trả cả job 'sent' đang in dở). Xóa khỏi inflight khi xử lý XONG (kể cả lỗi) → server
// requeue cùng job_id về sau vẫn nhận; KHÔNG dùng Set "đã thấy" vĩnh viễn.
const inflight = new Set();
let busy = false;
function enqueue(job) {
 const jobId = job.job_id || job.id;
 if (inflight.has(jobId)) {
 log('debug', 'Dedup: job already queued/processing', { job_id: jobId });
 return;
 }
 inflight.add(jobId);
 queue.push(job);
 drain();
}
async function drain() {
 if (busy || queue.length === 0) return;
 busy = true;
 const job = queue.shift();
 try {
 await processJob(job);
 } catch (e) {
 log('error', 'drain unhandled error', { err: e.message, stack: e.stack });
 } finally {
 inflight.delete(job.job_id || job.id);
 busy = false;
 drain();
 }
}

async function processJob(job) {
 const jobId = job.job_id || job.id;
 const { printer, metadata } = job;
 log('info', 'Processing job', { job_id: jobId, retry: job.retry_count, source: 'fetch', metadata });

 let tmpPath = null;

 try {
 // Luôn tải PDF từ server qua HTTP — một code path duy nhất (cả MQTT real-time
 // và reconnect/fetchPending đều dùng). Tránh base64 + 50MB frames qua MQTT.
 tmpPath = await downloadJobFile(jobId);
 if (!tmpPath) {
 // 410/404 - skip im lặng (job đã in rồi hoặc file bị cleanup)
 log('info', 'Skipping job (410/404 from server)', { jobId });
 return;
 }

 // Print
 try {
 await printPdf(tmpPath, printer);
 log('info', 'Printed', { jobId, printer: printer || PRINTER_NAME || '(default)' });
 await reportStatus(jobId, 'printed');
 } catch (e) {
 log('error', 'Print failed', { jobId, err: e.message });
 await reportStatus(jobId, 'failed', e.message);
 }
 } finally {
 if (tmpPath) {
 try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
 }
 }
}

// Download PDF từ server endpoint /api/print-jobs/:id/file
// Return: tmpPath nếu OK, null nếu 410/404 (skip), throw nếu lỗi khác
async function downloadJobFile(jobId) {
 const tmpPath = path.join(TMP_DIR, `${jobId}.pdf`);
 let r;
 try {
 r = await axios.get(`${API_URL}/api/print-jobs/${jobId}/file`, {
 headers: {
 'X-Agent-Token': AGENT_TOKEN,
 'X-Branch-Id': BRANCH_ID,
 },
 responseType: 'arraybuffer',
 timeout: 30000,
 validateStatus: () => true, // tự xử lý status
 });
 } catch (e) {
 // Lỗi mạng tạm thời: throw → job rời inflight. KHÔNG requeue tức thì ở đây — poll định kỳ
 // (POLL_INTERVAL) sẽ tự nhặt lại vì server vẫn giữ job ở 'sent'/'pending' tới khi printed.
 throw new Error(`Download request failed: ${e.message}`);
 }

 if (r.status === 200) {
 const buf = Buffer.from(r.data);
 if (buf.length < 5 || buf.subarray(0, 5).toString() !== '%PDF-') {
 throw new Error(`Downloaded file invalid PDF magic (${buf.length} bytes)`);
 }
 fs.writeFileSync(tmpPath, buf);
 return tmpPath;
 }
 if (r.status === 410 || r.status === 404) return null;

 // Lỗi khác - log body để debug
 let body = '';
 try { body = Buffer.from(r.data).toString('utf8').slice(0, 300); } catch (e) {}
 throw new Error(`Download HTTP ${r.status}: ${body}`);
}

// Force in về A4 + fit (scale PDF cho vừa khổ giấy máy in)
// Format SumatraPDF: "<from_page>,<paper_size>,<scaling>"
// Lưu ý: SumatraPDF KHÔNG có flag ép portrait - orientation theo PDF gốc
const PRINT_SETTINGS = process.env.PRINT_SETTINGS || '1,a4,fit';

function printPdf(pdfPath, printer) {
 return new Promise((resolve, reject) => {
 const targetPrinter = printer || PRINTER_NAME;

 const args = [
 '-silent',
 '-exit-when-done',
 '-print-settings', PRINT_SETTINGS,
 ];
 if (targetPrinter) {
 args.push('-print-to', targetPrinter);
 } else {
 // PRINTER_NAME rỗng + job không kèm printer = in ra MÁY IN MẶC ĐỊNH (đúng như .env.example mô tả).
 // SumatraPDF BẮT BUỘC có lệnh in: thiếu cả -print-to lẫn -print-to-default thì nó chỉ MỞ trình xem
 // PDF rồi treo (process không thoát) → agent timeout 120s. -print-to-default mới thực sự in.
 args.push('-print-to-default');
 }
 args.push(pdfPath);

 log('debug', 'Spawning SumatraPDF', { args });

 let proc;
 try {
 proc = spawn(SUMATRA_PATH, args, { windowsHide: true });
 } catch (e) {
 reject(new Error(`Cannot spawn SumatraPDF: ${e.message}`));
 return;
 }

 let stderr = '';
 proc.stderr.on('data', d => { stderr += d.toString(); });

 const timer = setTimeout(() => {
 try { proc.kill('SIGKILL'); } catch (e) {}
 reject(new Error('Print timeout 120s'));
 }, 120000);

 proc.on('exit', (code) => {
 clearTimeout(timer);
 if (code === 0 || code === null) {
 resolve();
 } else {
 reject(new Error(`SumatraPDF exit ${code}: ${stderr.trim().slice(0, 500)}`));
 }
 });
 proc.on('error', (e) => {
 clearTimeout(timer);
 reject(e);
 });
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
 log('info', 'Status reported', { jobId, status, attempt: i, http: r.status });
 return r.data;
 } catch (e) {
 log('warn', 'Status report failed', { jobId, attempt: i, err: e.message });
 if (i < 3) await new Promise(r => setTimeout(r, i * 2000));
 }
 }
 log('error', 'Status report gave up after 3 retries', { jobId, status });
}

// MQTT client
function connectMqtt() {
 let ca;
 try {
 ca = fs.readFileSync(MQTT_CA_FILE);
 } catch (e) {
 log('error', 'Cannot read CA file', { path: MQTT_CA_FILE, err: e.message });
 process.exit(1);
 }

 if (!MQTT_REJECT_UNAUTHORIZED) {
 log('warn', 'MQTT_REJECT_UNAUTHORIZED=false — TẮT xác thực cert MQTT (chỉ để debug khẩn cấp, KHÔNG để ở production)');
 }
 const client = mqtt.connect(MQTT_URL, {
 clientId: `agent-${BRANCH_ID}-${process.pid}`,
 username: MQTT_USER,
 password: MQTT_PASS,
 ca,
 rejectUnauthorized: MQTT_REJECT_UNAUTHORIZED,
 reconnectPeriod: 5000,
 connectTimeout: 30000,
 keepalive: 60, // chống TCP half-open
 clean: true,
 });

 client.on('connect', async () => {
 log('info', 'MQTT connected', { url: MQTT_URL });
 const topic = `${TOPIC_PREFIX}/${BRANCH_ID}/jobs`;
 client.subscribe(topic, { qos: 1 }, (err) => {
 if (err) {
 log('error', 'MQTT subscribe failed', { err: err.message });
 } else {
 log('info', 'Subscribed', { topic });
 }
 });
 // Sau khi (re)connect → fetch job pending chưa xử lý
 await fetchPending();
 });

 client.on('reconnect', () => log('debug', 'MQTT reconnecting'));
 client.on('close', () => log('warn', 'MQTT closed'));
 client.on('offline', () => log('warn', 'MQTT offline'));
 client.on('error', (e) => log('error', 'MQTT error', { err: e.message }));

 client.on('message', (topic, payload) => {
 try {
 const job = JSON.parse(payload.toString('utf8'));
 // Skip nếu không phải protocol v2 — tránh crash nếu server cũ gửi job có pdf_base64
 if (job.version !== 2) {
 log('warn', 'Unknown job version, skipping', { job_id: job.job_id, version: job.version });
 return;
 }
 log('info', 'Job received', { job_id: job.job_id });
 enqueue(job);
 } catch (e) {
 log('error', 'Bad MQTT payload', { err: e.message, raw: payload.toString('utf8').slice(0, 200) });
 }
 });
}

// Guard: poll định kỳ + event MQTT 'connect' có thể gọi fetchPending trùng lúc — bỏ qua nếu
// đang có một request fetch dở (dedup ở enqueue vẫn chặn job trùng, đây chỉ tránh GET thừa).
let fetchInFlight = false;
async function fetchPending() {
 if (fetchInFlight) return;
 fetchInFlight = true;
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
 log('error', 'Fetch pending failed', { err: e.message, response: e.response?.data });
 } finally {
 fetchInFlight = false;
 }
}

// Probe trạng thái máy in Windows qua PowerShell/WMI.
// Fail mềm trên Linux (ENOENT powershell) hoặc khi gặp lỗi bất kỳ → trả [].
async function probePrinters() {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Printer | Select-Object Name,DetectedErrorState,WorkOffline | ConvertTo-Json -Compress',
      ], { windowsHide: true });
    } catch (e) {
      // ENOENT trên Linux — bình thường, không phải lỗi thật
      log('warn', 'probePrinters: không thể spawn powershell', { err: e.message });
      return resolve([]);
    }

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    // Timeout 15s phòng powershell treo
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) {}
      log('warn', 'probePrinters: timeout 15s, kill process');
      resolve([]);
    }, 15000);

    proc.on('error', (e) => {
      clearTimeout(timer);
      log('warn', 'probePrinters: spawn error', { err: e.message });
      resolve([]);
    });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        log('warn', 'probePrinters: powershell exit != 0', { code, stderr: stderr.trim().slice(0, 200) });
        return resolve([]);
      }
      const raw = stdout.trim();
      if (!raw) {
        log('warn', 'probePrinters: stdout rỗng');
        return resolve([]);
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        log('warn', 'probePrinters: JSON parse failed', { err: e.message, raw: raw.slice(0, 200) });
        return resolve([]);
      }
      // ConvertTo-Json trả object đơn nếu chỉ có 1 máy in → chuẩn hoá về mảng
      const printersRaw = Array.isArray(parsed) ? parsed : [parsed];
      // Bỏ máy in ảo của Windows (PDF/XPS/OneNote/Fax) — không phải máy in vật lý, chỉ làm nhiễu
      // danh sách auto-discovery chờ HQ duyệt.
      const VIRTUAL = /Microsoft Print to PDF|Microsoft XPS Document Writer|OneNote|Fax|PDF24|CutePDF/i;
      const printers = printersRaw.filter(p => !VIRTUAL.test(p.Name || ''));
      const result = printers.map(p => {
        const name = p.Name || '(unknown)';
        // WorkOffline hoặc DetectedErrorState=9 → offline
        if (p.WorkOffline === true || p.DetectedErrorState === 9) return { name, status: 'offline' };
        switch (p.DetectedErrorState) {
          case 3: // Low Paper
          case 4: return { name, status: 'out_of_paper' }; // No Paper
          case 8: return { name, status: 'paper_jam' };
          default:
            // 2 = No Error; 0/null/undefined = driver không báo lỗi → coi như online (đang sẵn sàng).
            if (p.DetectedErrorState === 2 || p.DetectedErrorState === 0
                || p.DetectedErrorState === null || p.DetectedErrorState === undefined) {
              return { name, status: 'online' };
            }
            return { name, status: 'unknown' };
        }
      });
      resolve(result);
    });
  });
}

// Lấy trạng thái máy in rồi POST lên server (heartbeat).
// Fail mềm: lỗi chỉ log, không crash agent.
async function reportPrinterStatus() {
  const printers = await probePrinters();
  if (printers.length === 0) return; // Linux dev hoặc không có máy in → bỏ qua

  for (let i = 1; i <= 2; i++) {
    try {
      const r = await axios.post(
        `${API_URL}/api/printers/heartbeat`,
        { printers },
        {
          headers: {
            'X-Agent-Token': AGENT_TOKEN,
            'X-Branch-Id': BRANCH_ID,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      log('info', 'Printer heartbeat sent', { count: printers.length, http: r.status });
      return;
    } catch (e) {
      log('warn', 'Printer heartbeat failed', { attempt: i, err: e.message });
      if (i < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
  log('error', 'Printer heartbeat gave up after 2 retries');
}

// Graceful shutdown
let pollTimer = null;
function shutdown(signal) {
 log('info', `Received ${signal}, exiting`);
 if (pollTimer) clearInterval(pollTimer);
 process.exit(0);
}
if (!REGISTER_MODE) {
 ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(s => process.on(s, () => shutdown(s)));
}

// Boot — chỉ chạy khi thực thi trực tiếp (không khi require từ test, không khi --register)
if (require.main === module && !REGISTER_MODE) {
 log('info', 'Agent starting', { branch: BRANCH_ID, pid: process.pid, node: process.version });
 cleanupStaleTmp();
 connectMqtt();
 // Poll fallback ĐỘC LẬP với MQTT: MQTT sập hẳn vẫn lấy + in được job qua HTTP.
 // reportPrinterStatus chạy cùng nhịp để không tạo timer thừa.
 pollTimer = setInterval(() => { fetchPending(); reportPrinterStatus(); }, POLL_INTERVAL_MS);
 log('info', 'Poll fallback started', { intervalMs: POLL_INTERVAL_MS });
 // Báo trạng thái máy in ngay khi khởi động, không chờ nhịp poll đầu tiên
 reportPrinterStatus();
}

module.exports = { enqueue, drain, processJob, fetchPending, probePrinters, reportPrinterStatus };
