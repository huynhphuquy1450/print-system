'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

// We need a real Express app to pass to startHttpsServer. Use a minimal
// mock that responds 200 to any request.
const express = require('express');

// Suppress logger output during tests
jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const httpsServer = require('../https-server');

function makeTempCertPair() {
  // Generate a self-signed cert + key using openssl, written to a temp dir.
  // (We use openssl because Node has no built-in self-signed cert API; this
  // matches what step-ca produces structurally — PEM cert + PEM key.)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'https-test-'));
  const certFile = path.join(dir, 'server.crt');
  const keyFile = path.join(dir, 'server.key');
  // Use openssl via child_process — it ships on Linux/macOS dev boxes and
  // is a build dep of Node, so CI runners almost always have it.
  const { execFileSync } = require('child_process');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyFile, '-out', certFile,
    '-days', '1', '-nodes', '-subj', '/CN=localhost',
  ], { stdio: 'pipe' });
  return { dir, certFile, keyFile };
}

function makeApp() {
  const app = express();
  app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));
  return app;
}

describe('https-server', () => {
  let tempDir;
  let tempCert;

  afterEach(async () => {
    // Clean up any HTTPS server left running
    await httpsServer.closeHttpsServer();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('loadCertOptions returns null when cert files do not exist', () => {
    const result = httpsServer.loadCertOptions('/nonexistent/cert', '/nonexistent/key');
    expect(result).toBeNull();
  });

  test('loadCertOptions returns null when args are null/undefined', () => {
    expect(httpsServer.loadCertOptions(null, '/tmp/k')).toBeNull();
    expect(httpsServer.loadCertOptions('/tmp/c', null)).toBeNull();
  });

  test('loadCertOptions reads cert and key from disk and returns PEM buffers', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'https-test-'));
    const certFile = path.join(tempDir, 'c.pem');
    const keyFile = path.join(tempDir, 'k.pem');
    fs.writeFileSync(certFile, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----');
    fs.writeFileSync(keyFile, '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----');

    const result = httpsServer.loadCertOptions(certFile, keyFile);
    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result.cert)).toBe(true);
    expect(Buffer.isBuffer(result.key)).toBe(true);
    expect(result.cert.toString()).toContain('BEGIN CERTIFICATE');
    expect(result.key.toString()).toContain('PRIVATE KEY');
  });

  test('startHttpsServer returns null when HTTPS is disabled (enabled=false)', () => {
    const app = makeApp();
    const result = httpsServer.startHttpsServer(app, {
      enabled: false,
      port: 443,
      certFile: '/nonexistent',
      keyFile: '/nonexistent',
    });
    expect(result).toBeNull();
  });

  test('startHttpsServer returns null and warns when cert files missing (enabled=true)', () => {
    const app = makeApp();
    const result = httpsServer.startHttpsServer(app, {
      enabled: true,
      port: 443,
      certFile: '/nonexistent/cert.pem',
      keyFile: '/nonexistent/key.pem',
    });
    expect(result).toBeNull();
    // We don't strictly assert on the logger call (mocked), but the contract
    // is "skip silently with a warning" — null return is the testable part.
  });

  test('startHttpsServer binds to port and serves HTTPS requests when certs valid', async () => {
    tempCert = makeTempCertPair();
    tempDir = tempCert.dir;

    const app = makeApp();
    const httpsInstance = httpsServer.startHttpsServer(app, {
      enabled: true,
      port: 0, // ephemeral port
      certFile: tempCert.certFile,
      keyFile: tempCert.keyFile,
    });
    expect(httpsInstance).not.toBeNull();

    // Wait for listen to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const port = httpsInstance.address().port;

    // Make an HTTPS request to the server, ignoring cert errors (self-signed)
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'localhost',
        port,
        path: '/api/health',
        method: 'GET',
        rejectUnauthorized: false,
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: 'ok' });
  });

  test('HTTPS request fails when client has no root CA and rejectUnauthorized=true (validates the cert chain)', async () => {
    // This test demonstrates the *problem we're solving*: without trust, HTTPS
    // fails. After the agent installs root_ca.crt, this should pass.
    tempCert = makeTempCertPair();
    tempDir = tempCert.dir;

    const app = makeApp();
    const httpsInstance = httpsServer.startHttpsServer(app, {
      enabled: true,
      port: 0,
      certFile: tempCert.certFile,
      keyFile: tempCert.keyFile,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const port = httpsInstance.address().port;

    await expect(new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'localhost',
        port,
        path: '/api/health',
        method: 'GET',
        rejectUnauthorized: true, // strict — no trust for self-signed
      }, (res) => resolve(res));
      req.on('error', reject);
      req.end();
    })).rejects.toThrow();
  });
});
