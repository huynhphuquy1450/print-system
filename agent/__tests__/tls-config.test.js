'use strict';

// Tests for the .env.example template — these act as a config contract so
// future edits don't accidentally regress to HTTP / self-signed trust.
//
// We don't load the actual .env (CI uses a different file). We parse the
// template as a static document and assert:
//   1. API_URL uses https:// (agents must encrypt downloads)
//   2. MQTT_CA_FILE points at a root_ca.crt (Step-CA cert, not server.crt)
//   3. MQTT_REJECT_UNAUTHORIZED is NOT set to false in the example
//      (commented warnings are fine; uncommented "false" would be a regression)

const fs = require('fs');
const path = require('path');

const ENV_EXAMPLE = path.join(__dirname, '..', '.env.example');

function readEnvExample() {
  return fs.readFileSync(ENV_EXAMPLE, 'utf8');
}

describe('agent .env.example — TLS config', () => {
  test('API_URL uses https:// (agents must encrypt download traffic)', () => {
    const content = readEnvExample();
    // Match the line `API_URL=https://...` (uncommented)
    const match = content.match(/^API_URL=https:\/\/.+$/m);
    expect(match).not.toBeNull();
    // Sanity: no http:// API_URL line should exist in uncommented form
    const httpMatch = content.match(/^API_URL=http:\/\/.+$/m);
    expect(httpMatch).toBeNull();
  });

  test('MQTT_CA_FILE points at root_ca.crt (Step-CA cert, not server.crt)', () => {
    const content = readEnvExample();
    const match = content.match(/^MQTT_CA_FILE=(.+)$/m);
    expect(match).not.toBeNull();
    const caPath = match[1].trim();
    expect(caPath).toMatch(/root_ca\.crt$/);
    expect(caPath).not.toMatch(/server\.crt$/);
  });

  test('MQTT_REJECT_UNAUTHORIZED is NOT set to false (strict cert validation is required)', () => {
    const content = readEnvExample();
    // Find all uncommented lines (lines NOT starting with #) that mention
    // MQTT_REJECT_UNAUTHORIZED. Any such line with value "false" is a regression.
    const lines = content.split('\n');
    const violations = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed === '') continue;
      if (trimmed.startsWith('MQTT_REJECT_UNAUTHORIZED=')) {
        const value = trimmed.split('=')[1].trim().toLowerCase();
        if (value === 'false') {
          violations.push(trimmed);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('CA_INSTALL.md exists and explains the install steps', () => {
    const caInstallPath = path.join(__dirname, '..', 'CA_INSTALL.md');
    expect(fs.existsSync(caInstallPath)).toBe(true);
    const content = fs.readFileSync(caInstallPath, 'utf8');
    // Should mention key concepts
    // Match the key concepts (the prose wraps so we check for adjacent substrings)
    expect(content).toMatch(/Trusted Root/);
    expect(content).toMatch(/Certification Authorities/);
    expect(content).toMatch(/root_ca\.crt/);
    expect(content).toMatch(/certlm\.msc/);
    expect(content).toMatch(/Import-Certificate|Install Certificate/);
  });
});