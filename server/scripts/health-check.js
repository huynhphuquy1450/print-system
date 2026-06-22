#!/usr/bin/env node
'use strict';

/**
 * Standalone health check - gọi từ command line hoặc cron
 * Usage: node scripts/health-check.js [host:port]
 * Default: localhost:3000
 */

const http = require('http');

const target = process.argv[2] || 'localhost:3000';
const [host, port] = target.split(':');

const req = http.request(
  { host, port: parseInt(port, 10), path: '/health', timeout: 5000 },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      console.log(`Status: ${res.statusCode}`);
      try {
        const obj = JSON.parse(data);
        console.log(JSON.stringify(obj, null, 2));
        if (obj.status !== 'ok') process.exit(1);
      } catch (e) {
        console.log(data);
        process.exit(1);
      }
    });
  }
);
req.on('error', (e) => {
  console.error('Health check failed:', e.message);
  process.exit(1);
});
req.on('timeout', () => {
  console.error('Health check timeout');
  req.destroy();
  process.exit(1);
});
req.end();