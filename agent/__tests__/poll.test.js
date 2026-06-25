'use strict';

// Tests for the fallback poll path in agent/agent.js.
// Mục tiêu: chứng minh agent lấy + in được job HOÀN TOÀN qua HTTP, không cần sự kiện
// MQTT 'connect' (mô phỏng broker sập), và dedup theo job_id chặn in trùng nhưng vẫn
// cho server requeue cùng job_id về sau.

// Env phải set TRƯỚC khi require('../agent') vì agent.js validate env ở require-time.
process.env.BRANCH_ID = 'br_test';
process.env.AGENT_TOKEN = 'token_test';
process.env.MQTT_URL = 'mqtts://localhost:8883';
process.env.MQTT_USER = 'u';
process.env.MQTT_PASS = 'p';
process.env.MQTT_CA_FILE = '/tmp/fake-ca.crt';
process.env.API_URL = 'https://localhost';
process.env.SUMATRA_PATH = '/fake/SumatraPDF.exe';
process.env.TMP_DIR = '/tmp/agent-poll-test';

const { EventEmitter } = require('events');

// dotenv: đừng đọc .env thật của máy chạy test.
jest.mock('dotenv', () => ({ config: jest.fn() }));

// mqtt: agent.js require ở top; boot (connectMqtt) bị guard require.main nên không chạy
// trong test, nhưng vẫn mock cho an toàn — không kết nối thật.
jest.mock('mqtt', () => ({ connect: jest.fn() }));

// axios: get cho list + download file, post cho report status.
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

// fs: chỉ chặn các sync write agent dùng; giữ nguyên phần còn lại.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

// child_process: spawn SumatraPDF → giả lập tiến trình in exit code 0.
jest.mock('child_process', () => ({ spawn: jest.fn() }));

const axios = require('axios');
const { spawn } = require('child_process');
const agent = require('../agent');

function fakeProc(exitCode) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  // emit 'exit' ở tick sau để printPdf kịp gắn listener.
  setImmediate(() => proc.emit('exit', exitCode));
  return proc;
}

async function waitFor(cond, timeout = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const PDF = Buffer.from('%PDF-1.4 fake');

describe('agent fallback poll', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    axios.get.mockImplementation((url) => {
      if (url.endsWith('/file')) {
        return Promise.resolve({ status: 200, data: PDF });
      }
      // GET /api/print-jobs (list pending) — 1 job, không cần MQTT.
      return Promise.resolve({ data: { jobs: [{ job_id: 'j1', version: 2 }] } });
    });
    axios.post.mockResolvedValue({ status: 200, data: {} });
    spawn.mockImplementation(() => fakeProc(0));
  });

  test('MQTT down → poll fetchPending vẫn lấy + in job, report printed', async () => {
    // Gọi fetchPending trực tiếp = 1 nhịp poll. KHÔNG có sự kiện MQTT 'connect' nào.
    await agent.fetchPending();
    await waitFor(() => axios.post.mock.calls.length > 0);

    expect(spawn).toHaveBeenCalledTimes(1);
    const [statusUrl, body] = axios.post.mock.calls[0];
    expect(statusUrl).toContain('/api/print-jobs/j1/status');
    expect(body.status).toBe('printed');
  });

  test('dedup: enqueue trùng job_id chỉ in 1 lần; sau khi xong, cùng id in lại được', async () => {
    const job = { job_id: 'dup1', version: 2 };

    // Enqueue 2 lần liên tiếp khi job 1 còn inflight → bản 2 bị bỏ.
    agent.enqueue(job);
    agent.enqueue(job);
    await waitFor(() => axios.post.mock.calls.length >= 1);

    const fileGets1 = axios.get.mock.calls.filter((c) => c[0].endsWith('/file'));
    expect(fileGets1.length).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);

    // Job đã rời inflight → enqueue cùng id phải xử lý lại (KHÔNG phải Set vĩnh viễn).
    agent.enqueue(job);
    await waitFor(() => axios.post.mock.calls.length >= 2);

    const fileGets2 = axios.get.mock.calls.filter((c) => c[0].endsWith('/file'));
    expect(fileGets2.length).toBe(2);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
