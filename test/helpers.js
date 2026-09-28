'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'okv-test-'));
}

let clock = Date.UTC(2026, 8, 1, 9, 0, 0);

function makeMessage(overrides = {}) {
  clock += 60000;
  return {
    id: crypto.randomUUID(),
    from: 'reception',
    to: 'all',
    author: '',
    host: 'TEST-PC',
    text: 'Hello',
    urgent: false,
    createdAt: clock,
    ...overrides,
  };
}

async function waitFor(fn, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for condition');
}

module.exports = { tempDir, makeMessage, waitFor };
