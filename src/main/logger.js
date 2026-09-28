'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 1024 * 1024;

/** Minimal file logger with a single rotated backup (okv.log, okv.old.log). */
function createLogger(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'okv.log');

  function write(level, args) {
    const line = `${new Date().toISOString()} [${level}] ${util.format(...args)}\n`;
    if (!process.env.OKV_QUIET) process.stdout.write(line);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
        fs.renameSync(file, path.join(dir, 'okv.old.log'));
      }
      fs.appendFileSync(file, line);
    } catch {
      // logging must never crash the app
    }
  }

  return {
    file,
    debug: () => {},
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
  };
}

module.exports = { createLogger };
