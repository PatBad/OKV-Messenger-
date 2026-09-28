'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { DEPARTMENT_IDS, TO_ALL, LIMITS } = require('./constants');

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Validates a message received from anywhere (disk, network, renderer) and
 * returns a clean copy containing only the shared "wire" fields, or null.
 * Every computer runs the same rules, so they all agree on what is valid.
 */
function sanitizeMessage(m) {
  if (!m || typeof m !== 'object') return null;
  const { id, from, to, text, createdAt } = m;
  const author = m.author ?? '';
  const host = m.host ?? '';
  const urgent = m.urgent ?? false;

  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
  if (!DEPARTMENT_IDS.includes(from)) return null;
  if (to !== TO_ALL && !DEPARTMENT_IDS.includes(to)) return null;
  if (typeof text !== 'string') return null;
  const cleanText = text.trim();
  if (!cleanText || cleanText.length > LIMITS.TEXT) return null;
  if (typeof author !== 'string' || author.length > LIMITS.AUTHOR) return null;
  if (typeof host !== 'string' || host.length > LIMITS.HOST) return null;
  if (typeof urgent !== 'boolean') return null;
  if (!Number.isFinite(createdAt) || createdAt < LIMITS.MIN_TS || createdAt > LIMITS.MAX_TS) return null;

  return {
    v: 1,
    id,
    from,
    to,
    author: author.trim(),
    host,
    text: cleanText,
    urgent,
    createdAt: Math.floor(createdAt),
  };
}

function toWire(m) {
  const { receivedAt, local, ...wire } = m;
  return wire;
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Order-independent fingerprint of a set of message ids (count + XOR of hashes). */
class Digest {
  constructor() {
    this.count = 0;
    this.hash = Buffer.alloc(8);
  }

  add(id) {
    const h = crypto.createHash('sha1').update(id).digest();
    for (let i = 0; i < 8; i++) this.hash[i] ^= h[i];
    this.count++;
  }

  toString() {
    return `${this.count}:${this.hash.toString('hex')}`;
  }
}

function compareMessages(a, b) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Append-only message history for this computer, kept in memory and in a
 * JSON-lines file. Messages are immutable, so syncing is simply "copy the
 * ones you don't have".
 */
class MessageStore extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'messages.jsonl');
    this.byId = new Map();
    this.sorted = [];
    this.total = new Digest();
    this.days = new Map();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) return this;
    const lines = fs.readFileSync(this.file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let raw;
      try {
        raw = JSON.parse(line);
      } catch {
        continue; // a half-written line from a crash; skip it
      }
      const msg = sanitizeMessage(raw);
      if (!msg || this.byId.has(msg.id)) continue;
      msg.receivedAt = Number.isFinite(raw.receivedAt) ? raw.receivedAt : msg.createdAt;
      if (raw.local === true) msg.local = true;
      this._index(msg);
      this.sorted.push(msg);
    }
    this.sorted.sort(compareMessages);
    return this;
  }

  _index(msg) {
    this.byId.set(msg.id, msg);
    this.total.add(msg.id);
    const day = dayKey(msg.createdAt);
    if (!this.days.has(day)) this.days.set(day, { digest: new Digest(), ids: [] });
    const entry = this.days.get(day);
    entry.digest.add(msg.id);
    entry.ids.push(msg.id);
  }

  _insertSorted(msg) {
    // New messages almost always belong at the end; fall back to binary search.
    const list = this.sorted;
    if (!list.length || compareMessages(list[list.length - 1], msg) <= 0) {
      list.push(msg);
      return;
    }
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareMessages(list[mid], msg) <= 0) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, msg);
  }

  has(id) {
    return this.byId.has(id);
  }

  /**
   * Adds messages that are not already stored. Returns the newly added ones.
   * `local` marks messages written on this computer.
   */
  add(messages, { local = false } = {}) {
    const added = [];
    const seen = new Set();
    const now = Date.now();
    for (const raw of messages) {
      const msg = sanitizeMessage(raw);
      if (!msg || this.byId.has(msg.id) || seen.has(msg.id)) continue;
      seen.add(msg.id);
      msg.receivedAt = now;
      if (local) msg.local = true;
      added.push(msg);
    }
    if (!added.length) return added;

    fs.appendFileSync(this.file, added.map((m) => JSON.stringify(m)).join('\n') + '\n');
    for (const msg of added) {
      this._index(msg);
      this._insertSorted(msg);
    }
    this.emit('added', added);
    return added;
  }

  get count() {
    return this.total.count;
  }

  /** Summary used to detect whether two computers hold the same history. */
  digest() {
    const days = {};
    for (const [day, entry] of this.days) days[day] = entry.digest.toString();
    return { count: this.total.count, hash: this.total.hash.toString('hex'), days };
  }

  idsForDays(days) {
    const ids = [];
    for (const day of days) {
      const entry = this.days.get(day);
      if (entry) ids.push(...entry.ids);
    }
    return ids;
  }

  getWire(ids) {
    const out = [];
    for (const id of ids) {
      const m = this.byId.get(id);
      if (m) out.push(toWire(m));
    }
    return out;
  }

  /**
   * Returns up to `limit` messages matching the filter, oldest first, that sort
   * before the `before` cursor ({createdAt, id}). `more` says whether older
   * matches exist.
   */
  query({ filter = 'all', department = null, search = '', before = null, limit = 200 } = {}) {
    const needle = search.trim().toLowerCase();
    const out = [];
    let more = false;
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const m = this.sorted[i];
      if (before && compareMessages(m, before) >= 0) continue;
      if (filter === 'to-us' && !(m.to === TO_ALL || m.to === department)) continue;
      if (filter === 'from-us' && m.from !== department) continue;
      if (filter === 'urgent' && !m.urgent) continue;
      if (needle && !m.text.toLowerCase().includes(needle) && !m.author.toLowerCase().includes(needle)) continue;
      if (out.length === limit) {
        more = true;
        break;
      }
      out.push(m);
    }
    return { messages: out.reverse(), more };
  }

  /** Messages from other computers, addressed to us, that arrived after lastReadAt. */
  unread({ department, lastReadAt, since }) {
    let count = 0;
    let urgent = false;
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const m = this.sorted[i];
      if (m.createdAt < since) break;
      if (isUnread(m, { department, lastReadAt, since })) {
        count++;
        urgent = urgent || m.urgent;
      }
    }
    return { count, urgent };
  }
}

function isUnread(m, { department, lastReadAt, since }) {
  return (
    !m.local &&
    m.receivedAt > lastReadAt &&
    m.createdAt >= since &&
    (m.to === TO_ALL || m.to === department)
  );
}

module.exports = { MessageStore, sanitizeMessage, toWire, dayKey, isUnread };
