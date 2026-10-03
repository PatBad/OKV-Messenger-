'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { MessageStore, ReminderLog, sanitizeReminderRecord } = require('../src/main/store');
const { Network } = require('../src/main/network');
const { tempDir, waitFor } = require('./helpers');

function reminder(overrides = {}) {
  return {
    type: 'reminder',
    id: crypto.randomUUID(),
    from: 'reception',
    to: 'clinical',
    name: 'Mongi',
    author: 'Thandi',
    host: 'PC',
    text: 'Call Mrs Botha about Bella’s bloods',
    dueAt: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function status(r, status, by, overrides = {}) {
  return { type: 'status', id: crypto.randomUUID(), target: r.id, status, by, byName: '', host: 'PC', createdAt: Date.now(), ...overrides };
}

test('sanitizeReminderRecord accepts reminders and status changes, rejects bad ones', () => {
  const r = reminder({ text: '  trim me  ', name: ' Mongi ', dueAt: Date.now() + 3600e3 });
  const clean = sanitizeReminderRecord(r);
  assert.equal(clean.text, 'trim me');
  assert.equal(clean.name, 'Mongi');
  assert.equal(sanitizeReminderRecord(reminder({ dueAt: undefined })).dueAt, null);

  assert.equal(sanitizeReminderRecord(reminder({ to: 'all' })), null, 'a reminder is for one department');
  assert.equal(sanitizeReminderRecord(reminder({ text: '' })), null);
  assert.equal(sanitizeReminderRecord(reminder({ text: 'x'.repeat(1001) })), null);
  assert.equal(sanitizeReminderRecord(reminder({ dueAt: 'soon' })), null);
  assert.equal(sanitizeReminderRecord(reminder({ name: 'x'.repeat(41) })), null);
  assert.equal(sanitizeReminderRecord({ ...reminder(), type: 'other' }), null);

  assert.ok(sanitizeReminderRecord(status(r, 'done', 'clinical')));
  assert.equal(sanitizeReminderRecord(status(r, 'finished', 'clinical')), null);
  assert.equal(sanitizeReminderRecord(status(r, 'done', 'nobody')), null);
});

test('only the recipient can mark done, only the sender can cancel, either can reopen', () => {
  const dir = tempDir();
  const log = new ReminderLog(dir).load();
  const r = reminder();
  const t0 = Date.now();
  log.add([r]);
  const state = () => {
    const s = log.status(log.reminders.get(r.id));
    return s ? s.status : 'open';
  };

  log.add([status(r, 'done', 'principal', { createdAt: t0 + 1 })]);
  assert.equal(state(), 'open', 'a third department can’t close it');
  log.add([status(r, 'cancelled', 'clinical', { createdAt: t0 + 2 })]);
  assert.equal(state(), 'open', 'the recipient can’t cancel it');

  log.add([status(r, 'done', 'clinical', { createdAt: t0 + 3, byName: 'Mongi' })]);
  assert.equal(state(), 'done');
  assert.equal(log.status(r).byName, 'Mongi');

  log.add([status(r, 'open', 'reception', { createdAt: t0 + 4 })]); // sender reopens (undo)
  assert.equal(state(), 'open');
  log.add([status(r, 'cancelled', 'reception', { createdAt: t0 + 5 })]);
  assert.equal(state(), 'cancelled');
  log.add([status(r, 'open', 'clinical', { createdAt: t0 - 100 })]); // old record arriving late
  assert.equal(state(), 'cancelled');

  const reloaded = new ReminderLog(dir).load();
  assert.equal(reloaded.all().length, 1);
  assert.equal(reloaded.status(reloaded.reminders.get(r.id)).status, 'cancelled');
});

test('name suggestions are per department, most recent first, without repeats', () => {
  const log = new ReminderLog(tempDir()).load();
  const t0 = Date.now();
  log.add([
    reminder({ to: 'clinical', name: 'Mongi', createdAt: t0 }),
    reminder({ to: 'clinical', name: 'Kas', createdAt: t0 + 1 }),
    reminder({ to: 'clinical', name: 'mongi', createdAt: t0 + 2 }),
    reminder({ to: 'reception', name: 'Thandi', createdAt: t0 + 3 }),
    reminder({ to: 'clinical', name: '', createdAt: t0 + 4 }),
  ]);
  assert.deepEqual(log.namesFor('clinical'), ['mongi', 'Kas']);
  assert.deepEqual(log.namesFor('reception'), ['Thandi']);
  assert.deepEqual(log.namesFor('other'), []);
});

function makeNode(name, dept, { reminders = true } = {}) {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const log = reminders ? new ReminderLog(dir).load() : null;
  const net = new Network({
    store,
    reminders: log,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
    minSyncGapMs: 100,
  });
  return { name, store, log, net };
}

test('reminders and their status reach every computer; older versions are never asked', async (t) => {
  const reception = makeNode('REC', 'reception');
  const clinical = makeNode('CLIN', 'clinical');
  const older = makeNode('OLD', 'principal', { reminders: false });
  const nodes = [reception, clinical, older];

  let reminderRequests = 0;
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  older.net.server.prependListener('request', (req) => {
    if (req.url.includes('/reminders/')) reminderRequests++;
  });
  for (const n of nodes) {
    n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
  }

  const [r] = reception.log.add([reminder({ dueAt: Date.now() + 60e3 })], { local: true });
  reception.net.pushNow([r], 'reminders');
  await waitFor(() => clinical.log.reminders.has(r.id));

  clinical.log.add([status(r, 'done', 'clinical', { byName: 'Mongi' })], { local: true });
  await waitFor(() => reception.log.status(reception.log.reminders.get(r.id)) !== null);
  assert.equal(reception.log.status(r).status, 'done');

  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(reminderRequests, 0);
});
