'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeMessage } = require('./store');

/** Midnight at the start of the local day containing `ts`. */
const startOfDay = (ts) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** The time span an export covers: { from, to } in ms, and a label for the file name. */
function rangeBounds(range, now = Date.now()) {
  const today = startOfDay(now);
  const day = 86400000;
  const bounds = {
    today: { from: today, to: now + 1, label: 'today' },
    yesterday: { from: startOfDay(today - 1), to: today, label: 'yesterday' },
    '7days': { from: startOfDay(today - 6 * day), to: now + 1, label: 'last-7-days' },
    '14days': { from: startOfDay(today - 13 * day), to: now + 1, label: 'last-14-days' },
    all: { from: 0, to: now + 1, label: 'everything' },
  }[range];
  if (!bounds) throw new Error('Unknown export range');
  return bounds;
}

/** Messages moved to the archive folder by the tidy-up, as clean message objects (plus their edit time, if any). */
function readArchivedMessages(historyDir) {
  const dir = path.join(historyDir, 'archive');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^messages-\d{4}-\d{2}\.jsonl$/.test(f))) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let raw;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const m = sanitizeMessage(raw);
      if (m) out.push({ ...m, editedAt: Number.isFinite(raw.editedAt) ? raw.editedAt : null });
    }
  }
  return out;
}

/** Live and archived messages together, oldest first, each once. */
function mergeMessages(live, archived) {
  const byId = new Map();
  for (const m of [...archived, ...live]) byId.set(m.id, m); // a live copy wins over an archived duplicate
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * One CSV cell. Quotes are doubled, and a cell that a spreadsheet could read as a formula
 * (starting with = + - @) is made harmless, since message text is typed by anyone.
 */
function cell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV text for messages. \`labels\` turns a department id into its name; \`edited\` says if a message was edited.
 * The caller writes it with a byte-order mark so Excel opens the accents and emoji correctly.
 */
function toCsv(messages, { label = (id) => id, edited = () => false } = {}) {
  const rows = [['Date', 'Time', 'From', 'Name', 'To', 'Urgent', 'Message', 'GIF', 'Edited', 'Attachments']];
  for (const m of messages) {
    const d = new Date(m.createdAt);
    rows.push([
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      label(m.from),
      m.author,
      m.to === 'all' ? 'Everyone' : label(m.to),
      m.urgent ? 'Yes' : 'No',
      (m.gif && m.text === '[GIF]') || (m.attachments && m.text === '[Attachment]') ? '' : m.text,
      m.gif ? 'Yes' : 'No',
      edited(m) ? 'Yes' : 'No',
      (m.attachments || []).map((a) => a.name).join('; '),
    ]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Copies a folder (and everything in it) and reports how many files and bytes that was. */
function copyFolder(from, to) {
  fs.cpSync(from, to, { recursive: true });
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        files++;
        bytes += fs.statSync(p).size;
      }
    }
  };
  walk(to);
  return { files, bytes };
}

module.exports = { rangeBounds, readArchivedMessages, mergeMessages, toCsv, copyFolder, startOfDay };
