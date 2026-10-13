'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { LIMITS } = require('./constants');

const HASH = /^[0-9a-f]{64}$/;

// Files that run code, open web pages, or can carry macros. They can't be sent, and a message that
// arrives carrying one is shown without it, whatever the sending computer says.
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'com', 'scr', 'pif', 'bat', 'cmd', 'msi', 'msp', 'mst', 'dll', 'sys', 'cpl', 'ocx', 'drv',
  'ps1', 'psm1', 'ps2', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'wsc', 'hta', 'htm', 'html', 'xhtml', 'mht', 'mhtml',
  'lnk', 'url', 'scf', 'reg', 'inf', 'ins', 'isp', 'job', 'gadget', 'msc', 'application', 'appx', 'appxbundle', 'msix',
  'jar', 'jnlp', 'apk', 'app', 'command', 'sh', 'bash', 'py', 'pyw', 'rb', 'pl', 'php',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
  'iso', 'img', 'vhd', 'vhdx', 'dmg', 'svg', 'svgz', 'chm', 'lib', 'diagcab', 'library-ms', 'search-ms',
]);

/**
 * A safe file name for display and saving: no folders, no characters Windows won't allow,
 * no trailing dots or spaces, at most FILE_NAME characters (keeping the extension).
 */
function cleanFileName(raw) {
  let name = String(raw ?? '')
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/[‪-‮⁦-⁩]/g, '') // text-direction tricks that disguise an extension
    .trim()
    .replace(/[. ]+$/, '');
  if (!name || /^\.+$/.test(name)) name = 'file';
  if (name.length > LIMITS.FILE_NAME) {
    const ext = path.extname(name).slice(0, 12);
    name = name.slice(0, LIMITS.FILE_NAME - ext.length).trimEnd() + ext;
  }
  return name;
}

function extensionOf(name) {
  return path.extname(name).slice(1).toLowerCase();
}

const isBlockedName = (name) => BLOCKED_EXTENSIONS.has(extensionOf(name));

/** Programs, whatever they're called. */
function looksExecutable(buf) {
  if (buf.length < 4) return false;
  if (buf[0] === 0x4d && buf[1] === 0x5a) return true; // MZ: Windows programs and DLLs
  if (buf.readUInt32BE(0) === 0x7f454c46) return true; // ELF
  if ([0xcafebabe, 0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(buf.readUInt32BE(0))) return true; // Mach-O / Java class
  return false;
}

/** What the bytes are, going by their content and never the name: an image we can show, or an ordinary file. */
function detectKind(buf) {
  const info = { kind: 'file' };
  try {
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
      return { kind: 'image', mime: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { kind: 'image', mime: 'image/jpeg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return { kind: 'image', mime: 'image/jpeg' };
    }
    if (buf.length >= 30 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      const chunk = buf.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return { kind: 'image', mime: 'image/webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = buf.readUInt32LE(21);
        return { kind: 'image', mime: 'image/webp', w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { kind: 'image', mime: 'image/webp', w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
      return { kind: 'image', mime: 'image/webp' };
    }
    if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
      return { kind: 'image', mime: 'image/bmp', w: Math.abs(buf.readInt32LE(18)), h: Math.abs(buf.readInt32LE(22)) };
    }
    if (buf.length >= 10 && ['GIF87a', 'GIF89a'].includes(buf.toString('latin1', 0, 6))) {
      return { kind: 'image', mime: 'image/gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
  } catch {
    // a damaged header: treat it as an ordinary file
  }
  return info;
}

/** Whether these bytes may be kept and shared at all (size and content, not name). */
function checkBytes(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 1 && buf.length <= LIMITS.FILE_BYTES && !looksExecutable(buf);
}

/**
 * Checks a file someone wants to attach and works out how to show it. Throws an Error whose message
 * can be shown to the person (too big, not allowed, ...).
 */
function inspectFile(buf, rawName) {
  const name = cleanFileName(rawName);
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error(`“${name}” is empty`);
  if (buf.length > LIMITS.FILE_BYTES) throw new Error(`“${name}” is too large (the limit is ${LIMITS.FILE_BYTES / 1024 / 1024} MB)`);
  if (isBlockedName(name) || looksExecutable(buf)) throw new Error(`“${name}” can’t be sent: programs, scripts, web pages and macro files aren’t allowed`);
  const found = detectKind(buf);
  const meta = { name, size: buf.length, kind: found.kind };
  if (found.kind === 'image' && found.w > 0 && found.h > 0 && found.w <= 65535 && found.h <= 65535) {
    meta.w = found.w;
    meta.h = found.h;
  }
  return meta;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** The mime type to serve an image under, by content. Null if it isn't an image we show. */
function imageMime(buf) {
  const found = detectKind(buf);
  return found.kind === 'image' ? found.mime : null;
}

/**
 * Attached files kept on this computer, named by the SHA-256 of their contents (like GIFs): each file is
 * stored once, and a file fetched from another computer can be checked against the fingerprint the message gave.
 * The name people see lives in the message, never on disk.
 */
class FileStore extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = path.join(dir, 'files');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  _file(hash) {
    if (!HASH.test(hash)) throw new Error('Not a valid file id');
    return path.join(this.dir, hash);
  }

  has(hash) {
    return HASH.test(hash) && fs.existsSync(this._file(hash));
  }

  /** Where the file is, for opening or copying (null if this computer doesn't have it). */
  pathOf(hash) {
    return this.has(hash) ? this._file(hash) : null;
  }

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

  /** Stores a file someone here chose to send. Returns what the message needs to describe it. */
  add(buf, rawName) {
    const meta = inspectFile(buf, rawName);
    const hash = sha256(buf);
    this._write(hash, buf);
    return { hash, ...meta };
  }

  /** Stores a file received from another computer, but only if it's exactly the file that was asked for. */
  addVerified(hash, buf) {
    if (!HASH.test(hash) || !checkBytes(buf) || sha256(buf) !== hash) throw new Error('Received file does not match');
    if (this._write(hash, buf)) this.emit('added', hash);
  }

  /** Moves a file to archive/files/ (the tidy-up). Returns whether there was a file to move. */
  archive(hash) {
    if (!this.has(hash)) return false;
    const dest = path.join(this.dir, '..', 'archive', 'files');
    fs.mkdirSync(dest, { recursive: true });
    fs.renameSync(this._file(hash), path.join(dest, hash));
    return true;
  }

  remove(hash) {
    if (!this.has(hash)) return false;
    fs.unlinkSync(this._file(hash));
    return true;
  }
}

module.exports = {
  FileStore,
  HASH,
  cleanFileName,
  isBlockedName,
  extensionOf,
  looksExecutable,
  detectKind,
  imageMime,
  checkBytes,
  inspectFile,
  sha256,
  BLOCKED_EXTENSIONS,
};
