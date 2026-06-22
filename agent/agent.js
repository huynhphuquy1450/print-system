'use strict';

// Print Agent for branch br_001
// - Subscribes MQTT topic company/printer/br_001/jobs
// - Decodes base64 PDF, prints via SumatraPDF
// - POSTs status (printed/failed) back to Print Service
//
// Spec reference: SERVER_SPEC §12

const mqtt = require('mqtt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

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

// Validate required env
for (const [k, v] of Object.entries({
  BRANCH_ID, AGENT_TOKEN, MQTT_URL, MQTT_USER, MQTT_PASS,
  MQTT_CA_FILE, API_URL, SUMATRA_PATH,
})) {
  if (!v) {
    console.error(`[FATAL] Missing env: ${k}`);
    process.exit(1);
  }
}

const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

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
let busy = false;
function enqueue(job) {
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
    busy = false;
    drain();
  }
}

async function processJob(job) {
  const jobId = job.job_id || job.id;
  const { pdf_base64, printer, metadata } = job;
  log('info', 'Processing job', { job_id: jobId, retry: job.retry_count, source: pdf_base64 ? 'mqtt' : 'fetch', metadata });

  let tmpPath = null;

  try {
    if (pdf_base64) {
      // Job từ MQTT real-time - có sẵn base64
      let buf;
      try {
        buf = Buffer.from(pdf_base64, 'base64');
      } catch (e) {
        log('error', 'Base64 decode failed', { jobId, err: e.message });
        await reportStatus(jobId, 'failed', `Base64 decode failed: ${e.message}`);
        return;
      }
      if (buf.length < 5 || buf.subarray(0, 5).toString() !== '%PDF-') {
        log('error', 'Invalid PDF magic bytes', { jobId, head: buf.subarray(0, 8).toString('hex') });
        await reportStatus(jobId, 'failed', 'Invalid PDF: missing %PDF- magic bytes');
        return;
      }
      tmpPath = path.join(TMP_DIR, `${jobId}.pdf`);
      try {
        fs.writeFileSync(tmpPath, buf);
      } catch (e) {
        log('error', 'Tmp write failed', { jobId, err: e.message });
        await reportStatus(jobId, 'failed', `Tmp write failed: ${e.message}`);
        return;
      }
    } else {
      // Job từ fetchPending (sau reconnect) - phải download từ server
      tmpPath = await downloadJobFile(jobId);
      if (!tmpPath) {
        // 410/404 - skip im lặng (job đã in rồi hoặc file bị cleanup)
        log('info', 'Skipping job (410/404 from server)', { jobId });
        return;
      }
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

  const client = mqtt.connect(MQTT_URL, {
    clientId: `agent-${BRANCH_ID}-${process.pid}`,
    username: MQTT_USER,
    password: MQTT_PASS,
    ca,
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    keepalive: 60,    // chống TCP half-open
    clean: true,
  });

  client.on('connect', async () => {
    log('info', 'MQTT connected', { url: MQTT_URL });
    const topic = `company/printer/${BRANCH_ID}/jobs`;
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
      log('info', 'Job received', { job_id: job.job_id, retry: job.retry_count });
      enqueue(job);
    } catch (e) {
      log('error', 'Bad MQTT payload', { err: e.message, raw: payload.toString('utf8').slice(0, 200) });
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
    log('error', 'Fetch pending failed', { err: e.message, response: e.response?.data });
  }
}

// Graceful shutdown
function shutdown(signal) {
  log('info', `Received ${signal}, exiting`);
  process.exit(0);
}
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(s => process.on(s, () => shutdown(s)));

// Boot
log('info', 'Agent starting', { branch: BRANCH_ID, pid: process.pid, node: process.version });
cleanupStaleTmp();
connectMqtt();
