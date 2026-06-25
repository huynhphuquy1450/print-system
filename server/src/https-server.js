'use strict';

// HTTPS server wrapper — starts an https.createServer alongside the HTTP one
// for agents accessing the API over the public internet.
//
// Why both HTTP and HTTPS in one process:
//   - HQ clients are on the LAN: HTTP (3000) is fine, no need for encryption
//     at the app layer (LAN is trusted).
//   - Agents connect over the internet: HTTPS (443) is required so download
//     payloads and auth headers don't traverse the public network in cleartext.
//
// Certs are loaded from disk (paths come from config.https.*). We watch the
// cert file and reload the HTTPS server in-place when it changes, so the
// step-ca renewal cron can rotate certs without a full app restart.
//
// Dev/CI: if HTTPS_ENABLED=false OR cert files are missing, we skip HTTPS
// silently and only HTTP binds. Production should always set HTTPS_ENABLED=true.

const fs = require('fs');
const https = require('https');

const logger = require('./logger');

let httpsServer = null;
let certWatcher = null;
let reloading = false; // mutex against concurrent reloads

/**
 * Read cert + key from disk and return a Node tls options object.
 * Returns null if either file is missing — caller should skip HTTPS in that case.
 */
function loadCertOptions(certFile, keyFile) {
  if (!certFile || !keyFile) return null;
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) return null;
  try {
    const cert = fs.readFileSync(certFile);
    const key = fs.readFileSync(keyFile);
    return { cert, key };
  } catch (e) {
    logger.warn('Failed to read HTTPS cert/key', {
      cert_file: certFile,
      key_file: keyFile,
      err: e.message,
    });
    return null;
  }
}

/**
 * Start an HTTPS server using the same Express `app` instance.
 * - If config.https.enabled is false → returns null (HTTP-only mode).
 * - If cert files are missing → logs a warning and returns null.
 * - Otherwise → binds httpsServer to config.https.port.
 *
 * Sets up a fs.watch on the cert file so renewal via step-ca rotates
 * the in-memory TLS context without dropping HTTP connections.
 */
function startHttpsServer(app, httpsConfig) {
  if (!httpsConfig || !httpsConfig.enabled) {
    logger.info('HTTPS disabled by config (HTTPS_ENABLED=false) — agents must use LAN access or external proxy');
    return null;
  }

  const opts = loadCertOptions(httpsConfig.certFile, httpsConfig.keyFile);
  if (!opts) {
    logger.warn('HTTPS enabled but cert files missing — skipping HTTPS server', {
      cert_file: httpsConfig.certFile,
      key_file: httpsConfig.keyFile,
    });
    return null;
  }

  httpsServer = https.createServer(opts, app);
  httpsServer.listen(httpsConfig.port, () => {
    logger.info(`HTTPS server listening on port ${httpsConfig.port} (for internet agents)`);
  });
  httpsServer.on('error', (err) => {
    logger.error('HTTPS server error', { err: err.message, code: err.code });
  });

  // Watch cert file for changes (step-ca renew writes a new file).
  // We debounce via a small timer since some editors / step-ca may emit
  // multiple events for a single atomic write.
  try {
    let debounceTimer = null;
    certWatcher = fs.watch(httpsConfig.certFile, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => reloadHttpsServer(app, httpsConfig), 500);
    });
    certWatcher.on('error', (err) => {
      logger.warn('Cert file watcher error (renewal auto-reload disabled)', { err: err.message });
    });
  } catch (e) {
    logger.warn('Failed to watch cert file (renewal auto-reload disabled)', { err: e.message });
  }

  return httpsServer;
}

/**
 * Reload the HTTPS server with fresh cert/key from disk.
 * Closes the existing server gracefully, opens a new one on the same port.
 * If a reload is already in progress, this call is a no-op (mutex).
 */
function reloadHttpsServer(app, httpsConfig) {
  if (reloading) return;
  reloading = true;
  logger.info('Reloading HTTPS cert...');

  const oldServer = httpsServer;
  const opts = loadCertOptions(httpsConfig.certFile, httpsConfig.keyFile);
  if (!opts) {
    logger.warn('Cert files disappeared during reload — skipping');
    reloading = false;
    return;
  }

  const newServer = https.createServer(opts, app);
  newServer.listen(httpsConfig.port, () => {
    logger.info(`HTTPS cert reloaded, server still listening on ${httpsConfig.port}`);
    if (oldServer) {
      oldServer.close(() => {
        reloading = false;
      });
    } else {
      reloading = false;
    }
  });
  newServer.on('error', (err) => {
    logger.error('HTTPS reload server error', { err: err.message });
    reloading = false;
  });

  httpsServer = newServer;
}

/**
 * Close the HTTPS server (used during graceful shutdown).
 * Stops the cert watcher first so we don't try to reload during shutdown.
 */
function closeHttpsServer() {
  return new Promise((resolve) => {
    if (certWatcher) {
      try {
        certWatcher.close();
      } catch (_) {
        // ignore — best effort
      }
      certWatcher = null;
    }
    if (httpsServer) {
      httpsServer.close(() => {
        logger.info('HTTPS server closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  startHttpsServer,
  closeHttpsServer,
  loadCertOptions,
  // exported for testing only
  _internal: { reloadHttpsServer },
};