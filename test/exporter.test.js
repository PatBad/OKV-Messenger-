'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { rangeBounds, readArchivedMessages, mergeMessages, toCsv, copyFolder, startOfDay } = require('../src/main/exporter');
const { tempDir, makeMessage } = require('./helpers');

test('export ranges start at local midnight', () => {
  const now = new Date(2026, 9, 14, 15, 30).getTime(); // 14 Oct 2026, 15:30 local
  const midnight = new Date(2026, 9, 14).getTime();
  assert.deepEqual(rangeBounds('today', now), { from: midnight, to: now + 1, label: 'today' });
  assert.equal(rangeBounds('yesterday', now).from, new Date(2026, 9, 13).getTime());
  assert.equal(rangeBounds('yesterday', now).to, midnight);
  assert.equal(rangeBounds('7days', now).from, new Date(2026, 9, 8).getTime());
  assert.equal(rangeBounds('14days', now).from, new Date(2026, 9, 1).getTime());
  assert.equal(rangeBounds('all', now).from, 0);
  assert.throws(() => rangeBounds('fortnight', now));
  assert.equal(startOfDay(now), midnight);
});

test('the CSV has one row per message and is safe to open in a spreadsheet', () => {
  const t = new Date(2026, 9, 14, 9, 5, 7).getTime();
  const messages = [
    makeMessage({ from: 'reception', to: 'clinical', author: 'Thandi', text: 'Room 2, "Bella" is here,\nand her owner', urgent: true, createdAt: t }),
    makeMessage({ from: 'clinical', to: 'all', text: '=HYPERLINK("http://evil","click")', createdAt: t + 1000 }),
    makeMessage({ from: 'principal', to: 'all', text: '[GIF]', gif: { hash: 'a'.repeat(64), size: 5, w: 2, h: 2 }, createdAt: t + 2000 }),
  ];
  const labels = { reception: 'Reception', clinical: 'Clinical Team', principal: 'Practice Principal' };
  const csv = toCsv(messages, { label: (id) => labels[id], edited: (m) => m.id === messages[0].id });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Date,Time,From,Name,To,Urgent,Message,GIF,Edited,Attachments');
  assert.ok(csv.includes('2026-10-14,09:05:07,Reception,Thandi,Clinical Team,Yes,"Room 2, ""Bella"" is here,\nand her owner",No,Yes'));
  assert.ok(csv.includes("'=HYPERLINK"), 'a formula is neutralised');
  assert.ok(!csv.includes(',=HYPERLINK'), 'and never starts a cell');
  assert.ok(csv.includes('Practice Principal,,Everyone,No,,Yes,No'), 'a GIF-only message has no text, just GIF = Yes');
  assert.ok(csv.endsWith('\r\n'));
});

test('archived messages are read back and merged with live ones, each once', () => {
  const dir = tempDir();
  const a = makeMessage({ text: 'archived one', createdAt: Date.UTC(2026, 8, 1) });
  const b = makeMessage({ text: 'archived two (edited)', createdAt: Date.UTC(2026, 8, 2) });
  const live = makeMessage({ text: 'live', createdAt: Date.UTC(2026, 9, 14) });
  fs.mkdirSync(path.join(dir, 'archive'));
  fs.writeFileSync(
    path.join(dir, 'archive', 'messages-2026-09.jsonl'),
    [JSON.stringify(a), JSON.stringify({ ...b, editedAt: 12345 }), 'not json', JSON.stringify({ id: 'x' }), JSON.stringify(a)].join('\n') + '\n',
  );
  fs.writeFileSync(path.join(dir, 'archive', 'reactions-2026-09.jsonl'), 'ignored\n');

  const archived = readArchivedMessages(dir);
  assert.deepEqual(archived.map((m) => m.text), ['archived one', 'archived two (edited)', 'archived one']);
  assert.equal(archived[1].editedAt, 12345);

  const merged = mergeMessages([live, { ...a, text: 'live copy wins' }], archived);
  assert.deepEqual(merged.map((m) => m.text), ['live copy wins', 'archived two (edited)', 'live']);
  assert.deepEqual(readArchivedMessages(tempDir()), [], 'no archive yet');
});

test('copyFolder makes a complete copy and reports its size', () => {
  const from = tempDir();
  fs.mkdirSync(path.join(from, 'gifs'));
  fs.writeFileSync(path.join(from, 'messages.jsonl'), 'x'.repeat(100));
  fs.writeFileSync(path.join(from, 'gifs', 'a.gif'), 'y'.repeat(50));
  const to = path.join(tempDir(), 'backup');
  assert.deepEqual(copyFolder(from, to), { files: 2, bytes: 150 });
  assert.equal(fs.readFileSync(path.join(to, 'gifs', 'a.gif'), 'utf8'), 'y'.repeat(50));
});
