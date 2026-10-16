'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { MessageStore, MedicationLog, sanitizeMedicationRecord } = require('../src/main/store');
const { Network } = require('../src/main/network');
const { tempDir, waitFor } = require('./helpers');

function request(overrides = {}) {
  return {
    type: 'med',
    id: crypto.randomUUID(),
    from: 'reception',
    patient: 'Bella Botha',
    items: [{ name: 'Prednisolone 5mg', qty: '30 tabs' }],
    author: 'Thandi',
    host: 'PC',
    createdAt: Date.now(),
    ...overrides,
  };
}

function status(m, status, by, overrides = {}) {
  return { type: 'status', id: crypto.randomUUID(), target: m.id, status, by, byName: '', host: 'PC', createdAt: Date.now(), ...overrides };
}

test('sanitizeMedicationRecord accepts requests and status changes, rejects bad ones', () => {
  const clean = sanitizeMedicationRecord(
    request({ patient: '  Bella Botha ', items: [{ name: ' Apoquel 16mg ', qty: ' 60 tabs ' }, { name: 'Fortekor 5mg' }] }),
  );
  assert.equal(clean.patient, 'Bella Botha');
  assert.deepEqual(clean.items, [
    { name: 'Apoquel 16mg', qty: '60 tabs' },
    { name: 'Fortekor 5mg', qty: '' },
  ]);

  assert.equal(sanitizeMedicationRecord(request({ patient: '' })), null);
  assert.equal(sanitizeMedicationRecord(request({ patient: 'x'.repeat(81) })), null);
  assert.equal(sanitizeMedicationRecord(request({ from: 'nobody' })), null);
  assert.equal(sanitizeMedicationRecord(request({ items: [] })), null, 'a request needs a medication');
  assert.equal(sanitizeMedicationRecord(request({ items: 'Apoquel' })), null);
  assert.equal(sanitizeMedicationRecord(request({ items: [{ name: '', qty: '10' }] })), null);
  assert.equal(sanitizeMedicationRecord(request({ items: [{ name: 'x'.repeat(81), qty: '1' }] })), null);
  assert.equal(sanitizeMedicationRecord(request({ items: [{ name: 'A', qty: 'x'.repeat(41) }] })), null);
  assert.equal(sanitizeMedicationRecord(request({ items: Array.from({ length: 11 }, () => ({ name: 'A', qty: '1' })) })), null);
  assert.ok(sanitizeMedicationRecord(request({ items: Array.from({ length: 10 }, () => ({ name: 'A', qty: '1' })) })));
  assert.equal(sanitizeMedicationRecord({ ...request(), type: 'other' }), null);

  const m = request();
  assert.ok(sanitizeMedicationRecord(status(m, 'done', 'clinical')));
  assert.equal(sanitizeMedicationRecord(status(m, 'finished', 'clinical')), null);
  assert.equal(sanitizeMedicationRecord(status(m, 'done', 'nobody')), null);
});

test('any department can tick a request off, only the one that logged it can cancel, latest wins', () => {
  const dir = tempDir();
  const log = new MedicationLog(dir).load();
  const m = request();
  const t0 = Date.now();
  log.add([m]);
  const state = () => {
    const s = log.status(log.meds.get(m.id));
    return s ? s.status : 'open';
  };
  assert.equal(state(), 'open');

  log.add([status(m, 'cancelled', 'clinical', { createdAt: t0 + 1 })]);
  assert.equal(state(), 'open', 'the vets can’t cancel a request reception logged');

  log.add([status(m, 'done', 'clinical', { createdAt: t0 + 2, byName: 'Dr Mongi' })]);
  assert.equal(state(), 'done');
  assert.equal(log.status(m).byName, 'Dr Mongi');
  assert.equal(log.status(m).by, 'clinical');

  log.add([status(m, 'open', 'reception', { createdAt: t0 + 3 })]); // undo
  assert.equal(state(), 'open');
  log.add([status(m, 'cancelled', 'reception', { createdAt: t0 + 4 })]);
  assert.equal(state(), 'cancelled');
  log.add([status(m, 'done', 'clinical', { createdAt: t0 - 100 })]); // old record arriving late
  assert.equal(state(), 'cancelled');

  const reloaded = new MedicationLog(dir).load();
  assert.equal(reloaded.all().length, 1);
  assert.deepEqual(reloaded.meds.get(m.id).items, m.items);
  assert.equal(reloaded.status(reloaded.meds.get(m.id)).status, 'cancelled');
});

function makeNode(name, dept, { medications = true } = {}) {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const log = medications ? new MedicationLog(dir).load() : null;
  const net = new Network({
    store,
    medications: log,
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

test('requests and ticks reach every computer; older versions are never asked', async (t) => {
  const reception = makeNode('REC', 'reception');
  const clinical = makeNode('CLIN', 'clinical');
  const older = makeNode('OLD', 'principal', { medications: false });
  const nodes = [reception, clinical, older];

  let medicationRequests = 0;
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  older.net.server.prependListener('request', (req) => {
    if (req.url.includes('/medications/')) medicationRequests++;
  });
  for (const n of nodes) {
    n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
  }

  const [m] = reception.log.add([request()], { local: true });
  reception.net.pushNow([m], 'medications');
  await waitFor(() => clinical.log.meds.has(m.id));
  assert.ok(!clinical.log.meds.get(m.id).local, 'it arrives as someone else’s request');

  const [tick] = clinical.log.add([status(m, 'done', 'clinical', { byName: 'Dr Mongi' })], { local: true });
  clinical.net.pushNow([tick], 'medications');
  await waitFor(() => reception.log.status(reception.log.meds.get(m.id)) !== null);
  const arrived = reception.log.status(m);
  assert.equal(arrived.status, 'done');
  assert.ok(!arrived.local, 'the tick arrives at reception as someone else’s, which is what raises the blue notification');

  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(medicationRequests, 0);
});
