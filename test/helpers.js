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

/** A real, valid PNG (a colour gradient), so tests and the app can use genuine images. */
function makePng({ width = 64, height = 48, seed = 0 } = {}) {
  const zlib = require('zlib');
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + 1 + x * 3;
      raw[i] = (x * 4 + seed * 40) & 255;
      raw[i + 1] = (y * 5 + 60) & 255;
      raw[i + 2] = ((x + y) * 2 + seed * 20 + 40) & 255;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Just enough of a JPEG (header and frame marker) to read its size; not a picture that can be drawn. */
function makeJpegHeader({ width = 640, height = 480 } = {}) {
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0x00, 0x11, 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}

/** A small PDF-looking document: content doesn't matter, only that it's an ordinary file. */
const makePdf = (text = 'hello') => Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% ${text}\n%%EOF\n`);

module.exports = { tempDir, makeMessage, waitFor, makeGif, makePng, makeJpegHeader, makePdf };
