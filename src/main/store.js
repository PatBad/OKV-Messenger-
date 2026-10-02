'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { DEPARTMENT_IDS, TO_ALL, LIMITS } = require('./constants');

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const validId = (id) => typeof id === 'string' && ID_PATTERN.test(id);
const validTime = (t) => Number.isFinite(t) && t >= LIMITS.MIN_TS && t <= LIMITS.MAX_TS;
const validHost = (h) => typeof h === 'string' && h.length <= LIMITS.HOST;

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

  if (!validId(id)) return null;
  if (!DEPARTMENT_IDS.includes(from)) return null;
  if (to !== TO_ALL && !DEPARTMENT_IDS.includes(to)) return null;
  if (typeof text !== 'string') return null;
  const cleanText = text.trim();
  if (!cleanText || cleanText.length > LIMITS.TEXT) return null;
  if (typeof author !== 'string' || author.length > LIMITS.AUTHOR) return null;
  if (!validHost(host)) return null;
  if (typeof urgent !== 'boolean') return null;
  if (!validTime(createdAt)) return null;

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

/**
 * A "delete for everyone" (deleted: true) or its undo (deleted: false) for
 * one message, made by department `by`. Like messages, these are immutable
 * records that every computer collects.
 */
function sanitizeDeletion(d) {
  if (!d || typeof d !== 'object') return null;
  const { id, target, deleted, by, createdAt } = d;
  const host = d.host ?? '';
  if (!validId(id) || !validId(target)) return null;
  if (typeof deleted !== 'boolean') return null;
  if (!DEPARTMENT_IDS.includes(by)) return null;
  if (!validHost(host)) return null;
  if (!validTime(createdAt)) return null;
  return { v: 1, id, target, deleted, by, host, createdAt: Math.floor(createdAt) };
}

/**
 * Department `by` adding (on: true) or removing (on: false) an emoji reaction
 * on one message. Any short emoji is accepted, so a later version can offer
 * more without older computers rejecting them.
 */
function sanitizeReaction(r) {
  if (!r || typeof r !== 'object') return null;
  const { id, target, emoji, on, by, createdAt } = r;
  const host = r.host ?? '';
  if (!validId(id) || !validId(target)) return null;
  if (typeof emoji !== 'string' || !emoji || emoji.length > 16 || /\s/.test(emoji)) return null;
  if (typeof on !== 'boolean') return null;
  if (!DEPARTMENT_IDS.includes(by)) return null;
  if (!validHost(host)) return null;
  if (!validTime(createdAt)) return null;
  return { v: 1, id, target, emoji, on, by, host, createdAt: Math.floor(createdAt) };
}

function toWire(record) {
  const { receivedAt, local, ...wire } = record;
  return wire;
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Order-independent fingerprint of a set of record ids (count + XOR of hashes). */
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

function compareRecords(a, b) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Append-only set of immutable records, kept in memory and in a JSON-lines
 * file. Because records never change, two computers sync by simply copying
 * the ones the other doesn't have. Subclasses add their own indexes via
 * _track().
 */
class RecordLog extends EventEmitter {
  constructor(dir, fileName, sanitize) {
    super();
    this.dir = dir;
    this.file = path.join(dir, fileName);
    this.sanitize = sanitize;
    this.byId = new Map();
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
      const record = this.sanitize(raw);
      if (!record || this.byId.has(record.id)) continue;
      record.receivedAt = Number.isFinite(raw.receivedAt) ? raw.receivedAt : record.createdAt;
      if (raw.local === true) record.local = true;
      this._index(record, true);
    }
    this._loaded();
    return this;
  }

  _index(record, loading) {
    this.byId.set(record.id, record);
    this.total.add(record.id);
    const day = dayKey(record.createdAt);
    if (!this.days.has(day)) this.days.set(day, { digest: new Digest(), ids: [] });
    const entry = this.days.get(day);
    entry.digest.add(record.id);
    entry.ids.push(record.id);
    this._track(record, loading);
  }

  /** Subclass hook: called for every record, with `loading` true during load(). */
  _track() {}

  /** Subclass hook: called once load() has read the whole file. */
  _loaded() {}

  has(id) {
    return this.byId.has(id);
  }

  /**
   * Adds records that are not already stored. Returns the newly added ones.
   * `local` marks records created on this computer.
   */
  add(records, { local = false } = {}) {
    const added = [];
    const seen = new Set();
    const now = Date.now();
    for (const raw of records) {
      const record = this.sanitize(raw);
      if (!record || this.byId.has(record.id) || seen.has(record.id)) continue;
      seen.add(record.id);
      record.receivedAt = now;
      if (local) record.local = true;
      added.push(record);
    }
    if (!added.length) return added;

    fs.appendFileSync(this.file, added.map((r) => JSON.stringify(r)).join('\n') + '\n');
    for (const record of added) this._index(record, false);
    this.emit('added', added);
    return added;
  }

  get count() {
    return this.total.count;
  }

  /** Just the overall fingerprint, cheap enough to send in every beacon. */
  summary() {
    return { count: this.total.count, hash: this.total.hash.toString('hex') };
  }

  /** Fingerprint per day, used to find which days two computers disagree on. */
  digest() {
    const days = {};
    for (const [day, entry] of this.days) days[day] = entry.digest.toString();
    return { ...this.summary(), days };
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
      const r = this.byId.get(id);
      if (r) out.push(toWire(r));
    }
    return out;
  }
}

/** Every message this computer knows about, including deleted ones. */
class MessageStore extends RecordLog {
  constructor(dir) {
    super(dir, 'messages.jsonl', sanitizeMessage);
    this.sorted = [];
  }

  _track(msg, loading) {
    if (loading) this.sorted.push(msg);
    else this._insertSorted(msg);
  }

  _loaded() {
    this.sorted.sort(compareRecords);
  }

  _insertSorted(msg) {
    // New messages almost always belong at the end; fall back to binary search.
    const list = this.sorted;
    if (!list.length || compareRecords(list[list.length - 1], msg) <= 0) {
      list.push(msg);
      return;
    }
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compareRecords(list[mid], msg) <= 0) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, msg);
  }

  /**
   * Returns up to `limit` messages matching the filter, oldest first, that sort
   * before the `before` cursor ({createdAt, id}). `more` says whether older
   * matches exist. Messages for which `exclude` returns true are skipped, and
   * `after` (a timestamp) leaves out anything older.
   */
  query({ filter = 'all', department = null, search = '', before = null, after = null, limit = 200, exclude = null } = {}) {
    const needle = search.trim().toLowerCase();
    const out = [];
    let more = false;
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const m = this.sorted[i];
      if (after !== null && m.createdAt < after) break;
      if (before && compareRecords(m, before) >= 0) continue;
      if (filter === 'to-us' && m.to !== department) continue;
      if (filter === 'from-us' && m.from !== department) continue;
      if (filter === 'urgent' && !m.urgent) continue;
      if (needle && !m.text.toLowerCase().includes(needle) && !m.author.toLowerCase().includes(needle)) continue;
      if (exclude && exclude(m)) continue;
      if (out.length === limit) {
        more = true;
        break;
      }
      out.push(m);
    }
    return { messages: out.reverse(), more };
  }

  /** Messages from other computers, addressed to us, that arrived after lastReadAt. */
  unread({ department, lastReadAt, since, exclude = null }) {
    let count = 0;
    let urgent = false;
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const m = this.sorted[i];
      if (m.createdAt < since) break;
      if (isUnread(m, { department, lastReadAt, since }) && !(exclude && exclude(m))) {
        count++;
        urgent = urgent || m.urgent;
      }
    }
    return { count, urgent };
  }
}

/** "Delete for everyone" records, shared between computers. */
class DeletionLog extends RecordLog {
  constructor(dir) {
    super(dir, 'deletions.jsonl', sanitizeDeletion);
    this.byTarget = new Map();
  }

  _track(record) {
    const list = this.byTarget.get(record.target);
    if (list) list.push(record);
    else this.byTarget.set(record.target, [record]);
  }

  /**
   * Whether `message` has been deleted for everyone. Only the department that
   * sent a message may delete it, and the latest delete or undo wins. A
   * deletion can arrive before its message; it applies once both are here.
   */
  isDeleted(message) {
    const list = this.byTarget.get(message.id);
    if (!list) return false;
    let latest = null;
    for (const r of list) {
      if (r.by === message.from && (!latest || compareRecords(r, latest) > 0)) latest = r;
    }
    return latest !== null && latest.deleted;
  }
}

/** Emoji reactions on messages, shared between computers. */
class ReactionLog extends RecordLog {
  constructor(dir) {
    super(dir, 'reactions.jsonl', sanitizeReaction);
    this.byTarget = new Map();
  }

  _track(record) {
    const list = this.byTarget.get(record.target);
    if (list) list.push(record);
    else this.byTarget.set(record.target, [record]);
  }

  /** Whether department `by` currently has reacted to `messageId` with `emoji`. */
  hasReacted(messageId, by, emoji) {
    return this._current(messageId).get(`${by} ${emoji}`) === true;
  }

  /** Latest on/off per "department emoji" for one message. */
  _current(messageId) {
    const latest = new Map();
    for (const r of this.byTarget.get(messageId) || []) {
      const key = `${r.by} ${r.emoji}`;
      const prev = latest.get(key);
      if (!prev || compareRecords(r, prev) > 0) latest.set(key, r);
    }
    const on = new Map();
    for (const [key, r] of latest) on.set(key, r.on);
    return on;
  }

  /**
   * Reactions to show on a message: [{ emoji, by: [departments] }], emojis in
   * `order` first, then any others, departments in the order they reacted.
   */
  forMessage(messageId, order = []) {
    const list = this.byTarget.get(messageId);
    if (!list) return [];
    const current = this._current(messageId);
    const byEmoji = new Map();
    for (const r of [...list].sort(compareRecords)) {
      if (current.get(`${r.by} ${r.emoji}`) !== true) continue;
      if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
      const depts = byEmoji.get(r.emoji);
      if (!depts.includes(r.by)) depts.push(r.by);
    }
    const rank = (e) => (order.includes(e) ? order.indexOf(e) : order.length);
    return [...byEmoji]
      .map(([emoji, by]) => ({ emoji, by }))
      .sort((a, b) => rank(a.emoji) - rank(b.emoji));
  }
}

/** Messages hidden on this computer only ("delete for me"). Never shared. */
class LocalHides {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'hidden.jsonl');
    this.ids = new Set();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) return this;
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (!entry || !validId(entry.id)) continue;
      if (entry.hidden) this.ids.add(entry.id);
      else this.ids.delete(entry.id);
    }
    return this;
  }

  has(id) {
    return this.ids.has(id);
  }

  /** Hides (or un-hides) a message. Returns whether anything changed. */
  set(id, hidden) {
    return this.setMany([id], hidden);
  }

  /** Hides (or un-hides) several messages in one write. Returns whether anything changed. */
  setMany(ids, hidden) {
    const changing = [...new Set(ids)].filter((id) => validId(id) && this.ids.has(id) !== hidden);
    if (!changing.length) return false;
    const at = Date.now();
    fs.appendFileSync(this.file, changing.map((id) => JSON.stringify({ id, hidden, at })).join('\n') + '\n');
    for (const id of changing) {
      if (hidden) this.ids.add(id);
      else this.ids.delete(id);
    }
    return true;
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

module.exports = {
  MessageStore,
  DeletionLog,
  ReactionLog,
  LocalHides,
  sanitizeMessage,
  sanitizeDeletion,
  sanitizeReaction,
  toWire,
  dayKey,
  isUnread,
};
