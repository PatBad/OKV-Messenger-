'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  MessageStore,
  ReactionLog,
  EditLog,
  ReceiptLog,
  PinLog,
  sanitizeEdit,
  sanitizeReceipt,
  sanitizePin,
  receiptId,
} = require('../src/main/store');
const { GifStore } = require('../src/main/gifs');
const { EDIT_WINDOW_MS } = require('../src/main/constants');
const { tempDir, makeMessage, makeGif } = require('./helpers');

const uuid = () => crypto.randomUUID();
const DAY = 86400000;

// ---------- edits ----------

const edit = (message, overrides = {}) => ({
  id: uuid(),
  target: message.id,
  text: 'Corrected text',
  by: message.from,
  host: 'PC',
  createdAt: message.createdAt + 60000,
  ...overrides,
});

test('an edit is honoured only from the sender’s department and only within the edit window', () => {
  const log = new EditLog(tempDir()).load();
  const msg = makeMessage({ from: 'reception', text: 'Recieved the lab result' });
  log.add([edit(msg, { text: 'Received the lab result' })]);
  assert.equal(log.latest(msg).text, 'Received the lab result');

  log.add([edit(msg, { by: 'clinical', text: 'Forged by another department' })]);
  assert.equal(log.latest(msg).text, 'Received the lab result', 'another department can’t edit it');

  log.add([edit(msg, { text: 'Too late', createdAt: msg.createdAt + EDIT_WINDOW_MS + 1 })]);
  assert.equal(log.latest(msg).text, 'Received the lab result', 'after the window it is ignored');

  log.add([edit(msg, { text: 'Second fix', createdAt: msg.createdAt + 120000 })]);
  assert.equal(log.latest(msg).text, 'Second fix', 'the latest edit wins');
  log.add([edit(msg, { text: 'Backdated', createdAt: msg.createdAt - 5000 })]);
  assert.equal(log.latest(msg).text, 'Second fix', 'an edit dated before the message is ignored');

  assert.equal(log.latest(makeMessage()), null);
  assert.equal(sanitizeEdit(edit(msg, { text: '   ' })), null);
  assert.equal(sanitizeEdit(edit(msg, { text: 'x'.repeat(4001) })), null);
});

// ---------- receipts ----------

test('one seen-receipt per department per message, with an id that can’t be faked', () => {
  const dir = tempDir();
  const log = new ReceiptLog(dir).load();
  const msg = makeMessage();
  const t0 = Date.now();
  const receipt = (by, at, overrides = {}) => ({ id: receiptId(msg.id, by), target: msg.id, by, host: 'PC', createdAt: at, ...overrides });

  log.add([receipt('clinical', t0 + 5)]);
  log.add([receipt('clinical', t0 + 9)]); // a second Clinical computer: same id, nothing new
  log.add([receipt('principal', t0 + 2)]);
  assert.equal(log.count, 2);
  assert.equal(log.hasSeen(msg.id, 'clinical'), true);
  assert.equal(log.hasSeen(msg.id, 'reception'), false);
  assert.deepEqual(log.seenBy(msg.id).map((s) => s.dept), ['principal', 'clinical'], 'earliest first');

  assert.equal(sanitizeReceipt(receipt('clinical', t0, { id: uuid() })), null, 'the id must be derived from message and department');
  assert.equal(sanitizeReceipt(receipt('nobody', t0)), null);

  const reloaded = new ReceiptLog(dir).load();
  assert.equal(reloaded.hasSeen(msg.id, 'principal'), true);
});

// ---------- pinned notice ----------

test('the pinned notice is the newest one, until it is cleared', () => {
  const log = new PinLog(tempDir()).load();
  const t0 = Date.now();
  const pin = (text, at, by = 'principal') => ({ type: 'pin', id: uuid(), text, by, byName: 'Andrew', host: 'PC', createdAt: at });
  assert.equal(log.current(), null);

  const a = pin('Power cut 2–3pm', t0);
  log.add([a]);
  assert.equal(log.current().text, 'Power cut 2–3pm');

  const b = pin('Dr Smith off Friday', t0 + 1000, 'reception');
  log.add([b]);
  assert.equal(log.current().text, 'Dr Smith off Friday', 'a newer notice replaces the older');

  log.add([{ type: 'clear', id: uuid(), target: b.id, by: 'clinical', byName: '', host: 'PC', createdAt: t0 + 2000 }]);
  assert.equal(log.current(), null, 'clearing the newest shows nothing, not the older one');

  log.add([pin('Back to normal', t0 + 3000)]);
  assert.equal(log.current().text, 'Back to normal');

  assert.equal(sanitizePin(pin('', t0)), null);
  assert.equal(sanitizePin(pin('x'.repeat(301), t0)), null);
  assert.equal(sanitizePin({ type: 'weird', id: uuid(), by: 'principal', createdAt: t0 }), null);
});

// ---------- tidy-up ----------

test('records older than the retention period are archived, not deleted, and everything else carries on', () => {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  store.retentionDays = 14;
  const now = Date.UTC(2026, 9, 20, 12, 0, 0);
  const at = (daysAgo) => now - daysAgo * DAY;
  const old1 = makeMessage({ text: 'old one', createdAt: at(30) });
  const old2 = makeMessage({ text: 'old two', createdAt: at(20) });
  const edge = makeMessage({ text: 'just inside', createdAt: at(14) });
  const fresh = makeMessage({ text: 'fresh', createdAt: at(1) });
  // Written before retention was switched on, as on a computer that has been running for months.
  fs.appendFileSync(store.file, [old1, old2, edge, fresh].map((m) => JSON.stringify(m)).join('\n') + '\n');
  const before = new MessageStore(dir).load();
  before.retentionDays = 14;
  assert.equal(before.count, 4);

  const archived = before.archiveOld(now);
  assert.deepEqual(archived.map((m) => m.text).sort(), ['old one', 'old two']);
  assert.deepEqual(before.query().messages.map((m) => m.text), ['just inside', 'fresh']);
  assert.equal(before.count, 2);
  assert.deepEqual(Object.keys(before.digest().days).sort(), [new Date(at(14)).toISOString().slice(0, 10), new Date(at(1)).toISOString().slice(0, 10)]);

  // The live file shrank; the archive holds the rest, one file per month.
  assert.equal(fs.readFileSync(before.file, 'utf8').trim().split('\n').length, 2);
  const archiveFiles = fs.readdirSync(path.join(dir, 'archive'));
  assert.ok(archiveFiles.every((f) => /^messages-\d{4}-\d{2}\.jsonl$/.test(f)), archiveFiles.join(','));
  const archivedText = archiveFiles.map((f) => fs.readFileSync(path.join(dir, 'archive', f), 'utf8')).join('');
  assert.ok(archivedText.includes('old one') && archivedText.includes('old two') && !archivedText.includes('fresh'));

  // Old records are no longer accepted (e.g. from a computer that hasn't tidied up yet), new ones still are.
  const reloaded = new MessageStore(dir).load();
  reloaded.retentionDays = 14;
  assert.equal(reloaded.count, 2);
  assert.equal(reloaded.add([old1], { now }).length, 0);
  assert.equal(reloaded.add([makeMessage({ text: 'ancient', createdAt: at(400) })]).length, 0);
  assert.equal(reloaded.add([makeMessage({ text: 'today', createdAt: Date.now() })]).length, 1);
  assert.equal(reloaded.archiveOld(now).length, 0, 'nothing more to do');

  // Switching retention off keeps everything.
  const keepAll = new MessageStore(tempDir()).load();
  keepAll.add([old1]);
  assert.equal(keepAll.archiveOld(now).length, 0);
  assert.equal(keepAll.count, 1);
});

test('indexes are rebuilt after archiving, and discarded records are not written to the archive', () => {
  const dir = tempDir();
  const log = new ReactionLog(dir).load();
  const now = Date.UTC(2026, 9, 20);
  const old = makeMessage({ createdAt: now - 40 * DAY });
  const recent = makeMessage({ createdAt: now - DAY });
  fs.appendFileSync(log.file, '');
  const reaction = (m, emoji, createdAt) => ({ id: uuid(), target: m.id, emoji, on: true, by: 'clinical', host: 'PC', createdAt });
  const records = [reaction(old, '👍', old.createdAt + 1000), reaction(recent, '😂', recent.createdAt + 1000), reaction(old, '👌', old.createdAt + 2000)];
  fs.writeFileSync(log.file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const loaded = new ReactionLog(dir).load();
  loaded.retentionDays = 14;
  const archived = loaded.archiveOld(now, { drop: (r) => r.emoji === '👌' });
  assert.equal(archived.length, 2);
  assert.deepEqual(loaded.forMessage(recent.id), [{ emoji: '😂', by: ['clinical'] }]);
  assert.deepEqual(loaded.forMessage(old.id), []);
  const archiveText = fs.readdirSync(path.join(dir, 'archive')).map((f) => fs.readFileSync(path.join(dir, 'archive', f), 'utf8')).join('');
  assert.ok(archiveText.includes('👍'));
  assert.ok(!archiveText.includes('👌'), 'a dropped record is gone for good');
});

test('GIF files move to the archive folder', () => {
  const dir = tempDir();
  const gifs = new GifStore(dir);
  const saved = gifs.add(makeGif({ seed: 11 }));
  assert.equal(gifs.archive(saved.hash), true);
  assert.equal(gifs.has(saved.hash), false);
  assert.ok(fs.existsSync(path.join(dir, 'archive', 'gifs', `${saved.hash}.gif`)));
  assert.equal(gifs.archive(saved.hash), false, 'nothing left to move');
});

test('search and quotes use the edited text when asked to', () => {
  const store = new MessageStore(tempDir()).load();
  const msg = makeMessage({ text: 'Recieved the bloods', author: 'Thandi' });
  store.add([msg]);
  const textOf = () => 'Received the bloods';
  assert.equal(store.query({ search: 'received', textOf }).messages.length, 1);
  assert.equal(store.query({ search: 'received' }).messages.length, 0);
  assert.equal(store.quote(msg.id, null, textOf).text, 'Received the bloods');
});
