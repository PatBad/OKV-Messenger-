'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { LIMITS } = require('./constants');

const HASH = /^[0-9a-f]{64}$/;

/**
 * Checks that the bytes are a GIF within the size limit and returns its size
 * in pixels, or null. Looks at the file's own header, never its name.
 */
function inspectGif(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 14 || buf.length > LIMITS.GIF_BYTES) return null;
  const signature = buf.toString('latin1', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  return width && height ? { width, height } : null;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * GIF files kept on this computer, named by the SHA-256 of their contents.
 * Because the name is the fingerprint, the same GIF is only ever stored once
 * and a file received from another computer can be checked against the name
 * the message asked for.
 */
class GifStore extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = path.join(dir, 'gifs');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(hash) {
    if (!HASH.test(hash)) throw new Error('Not a valid GIF id');
    return path.join(this.dir, `${hash}.gif`);
  }

  has(hash) {
    return HASH.test(hash) && fs.existsSync(this._file(hash));
  }

  /** The file's bytes, or null if this computer doesn't have it. */
  read(hash) {
    if (!this.has(hash)) return null;
    try {
      return fs.readFileSync(this._file(hash));
    } catch {
      return null;
    }
  }

  _write(hash, buf) {
    const file = this._file(hash);
    if (fs.existsSync(file)) return false;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    return true;
  }

  /** Stores a GIF someone here chose to send. Returns its id, size and dimensions. */
  add(buf) {
    const info = inspectGif(buf);
    if (!info) {
      throw new Error(
        Buffer.isBuffer(buf) && buf.length > LIMITS.GIF_BYTES
          ? `That GIF is too large (the limit is ${LIMITS.GIF_BYTES / 1024 / 1024} MB)`
          : 'That file isn’t a GIF',
      );
    }
    const hash = sha256(buf);
    this._write(hash, buf);
    return { hash, size: buf.length, w: info.width, h: info.height };
  }

  /** Moves a GIF out of the live folder into archive/gifs/ (the tidy-up). Returns whether there was a file to move. */
  archive(hash) {
    if (!this.has(hash)) return false;
    const dest = path.join(this.dir, '..', 'archive', 'gifs');
    fs.mkdirSync(dest, { recursive: true });
    fs.renameSync(this._file(hash), path.join(dest, `${hash}.gif`));
    return true;
  }

  /** Deletes a GIF file for good (used for GIFs in messages that were deleted). */
  remove(hash) {
    if (!this.has(hash)) return false;
    fs.unlinkSync(this._file(hash));
    return true;
  }

  /** Stores a GIF received from another computer, but only if it's exactly the file that was asked for. */
  addVerified(hash, buf) {
    if (!HASH.test(hash) || !inspectGif(buf) || sha256(buf) !== hash) throw new Error('Received GIF does not match');
    if (this._write(hash, buf)) this.emit('added', hash);
  }
}

module.exports = { GifStore, inspectGif, sha256, HASH };
