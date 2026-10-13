'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { listMedia } = require('../src/main/media');
const { toCsv } = require('../src/main/exporter');
const { makeMessage } = require('./helpers');

const att = (name, kind = 'file', n = 1) => ({ hash: String(n).repeat(64).slice(0, 64), size: 1000 * n, name, kind, ...(kind === 'image' ? { w: 640, h: 480 } : {}) });
const NOW = Date.now();
const DAY = 86400000;

function sample() {
  return [
    makeMessage({ text: '[Attachment]', author: 'Thandi', from: 'reception', attachments: [att('Estimate.pdf', 'file', 1), att('x-ray.png', 'image', 2)], createdAt: NOW - 9 * DAY }),
    makeMessage({ text: 'text only', createdAt: NOW - 3 * DAY }),
    makeMessage({ text: '[GIF]', author: 'Mongi', from: 'clinical', gif: { hash: 'a'.repeat(64), size: 5000, w: 200, h: 150 }, createdAt: NOW - 2 * DAY }),
    makeMessage({ text: 'Scans attached', author: 'Mongi', from: 'clinical', attachments: [att('Bella scan.jpg', 'image', 3), att('Rota.xlsx', 'file', 4)], createdAt: NOW - DAY }),
  ];
}

test('the Media tab lists attachments and GIFs from live messages, newest first', () => {
  const { items, counts } = listMedia(sample(), { now: NOW });
  // Newest message first; the attachments of one message stay in the order they were sent.
  assert.deepEqual(items.map((i) => i.name), ['Bella scan.jpg', 'Rota.xlsx', 'GIF', 'Estimate.pdf', 'x-ray.png']);
  assert.deepEqual(counts, { all: 5, images: 3, files: 2 });
  const gif = items.find((i) => i.kind === 'gif');
  assert.deepEqual([gif.from, gif.author, gif.w, gif.h], ['clinical', 'Mongi', 200, 150]);
});

test('files past their week are marked archived; recent ones are not', () => {
  const { items } = listMedia(sample(), { now: NOW, retentionDays: 7 });
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(byName['Estimate.pdf'].archived, true);
  assert.equal(byName['x-ray.png'].archived, true);
  assert.equal(byName['Rota.xlsx'].archived, false);
  assert.equal(byName.GIF.archived, false, 'GIFs follow the message, not the one-week rule');
});

test('deleted and hidden messages never appear; missing files are marked not present', () => {
  const messages = sample();
  const hidden = messages[3].id;
  const { items } = listMedia(messages, { now: NOW, isRemoved: (m) => m.id === hidden, hasFile: (h) => h !== att('Estimate.pdf', 'file', 1).hash });
  assert.deepEqual(items.map((i) => i.name), ['GIF', 'Estimate.pdf', 'x-ray.png']);
  assert.equal(items.find((i) => i.name === 'Estimate.pdf').present, false);
  assert.equal(items.find((i) => i.name === 'x-ray.png').present, true);
});

test('filters and search narrow the list, and the counts follow the search', () => {
  const messages = sample();
  assert.deepEqual(listMedia(messages, { now: NOW, filter: 'images' }).items.map((i) => i.name), ['Bella scan.jpg', 'GIF', 'x-ray.png']);
  assert.deepEqual(listMedia(messages, { now: NOW, filter: 'files' }).items.map((i) => i.name), ['Rota.xlsx', 'Estimate.pdf']);
  const found = listMedia(messages, { now: NOW, search: 'MONGI' });
  assert.deepEqual(found.items.map((i) => i.name), ['Bella scan.jpg', 'Rota.xlsx', 'GIF']);
  assert.deepEqual(found.counts, { all: 3, images: 2, files: 1 });
  assert.deepEqual(listMedia(messages, { now: NOW, search: 'scan' }).items.map((i) => i.name), ['Bella scan.jpg']);
  assert.equal(listMedia(messages, { now: NOW, search: 'nothing like this' }).items.length, 0);
  const capped = listMedia(messages, { now: NOW, limit: 2 });
  assert.equal(capped.items.length, 2);
  assert.equal(capped.more, true);
});

test('the export lists attachment names', () => {
  const messages = sample().filter((m) => m.attachments);
  const csv = toCsv(messages, { label: (id) => id });
  assert.ok(csv.split('\r\n')[0].endsWith(',Attachments'));
  assert.ok(csv.includes('Estimate.pdf; x-ray.png'));
  assert.ok(csv.includes('Bella scan.jpg; Rota.xlsx'));
  assert.ok(/,,No,No,"?Estimate\.pdf; x-ray\.png"?\r\n/.test(csv) || csv.includes('Estimate.pdf; x-ray.png'), 'an attachment-only message has no text');
});
