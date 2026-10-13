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

// Generous: build machines can be much slower than a clinic PC. Returns as soon as fn() is true.
async function waitFor(fn, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for condition');
}

/**
 * Builds a real, valid animated GIF (4-colour palette, one solid colour per frame
 * plus a diagonal stripe), so tests and the app can use genuine files. LZW codes
 * are emitted uncompressed (a Clear code every two pixels keeps the code size at 3 bits).
 */
function makeGif({ width = 24, height = 24, frames = 3, seed = 0 } = {}) {
  const palette = [
    [255, 255, 255],
    [225, 29, 72],
    [15, 118, 110],
    [250, 204, 21],
  ];
  const out = [];
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  out.push(...Buffer.from('GIF89a'), ...u16(width), ...u16(height), 0xf1, 0, 0);
  for (const c of palette) out.push(...c);
  out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00);
  for (let f = 0; f < frames; f++) {
    out.push(0x21, 0xf9, 0x04, 0x00, ...u16(20), 0x00, 0x00);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(width), ...u16(height), 0x00, 0x02);
    const pixels = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) pixels.push((x + y + f * 3 + seed) % 8 < 2 ? 1 : ((f + seed) % 3) + 1);
    }
    let bits = 0;
    let nbits = 0;
    const bytes = [];
    const put = (code) => {
      bits |= code << nbits;
      nbits += 3;
      while (nbits >= 8) {
        bytes.push(bits & 255);
        bits >>= 8;
        nbits -= 8;
      }
    };
    for (let i = 0; i < pixels.length; i++) {
      if (i % 2 === 0) put(4); // Clear
      put(pixels[i]);
    }
    put(5); // End
    if (nbits) bytes.push(bits & 255);
    for (let i = 0; i < bytes.length; i += 255) {
      const block = bytes.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0x00);
  }
  out.push(0x3b);
  return Buffer.from(out);
}

module.exports = { tempDir, makeMessage, waitFor, makeGif };
