'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { MessageStore, DropLog, sanitizeDropRecord } = require('../src/main/store');
const { FileStore, sha256 } = require('../src/main/files');
const { Network } = require('../src/main/network');
const { tempDir, waitFor, makePng, makePdf } = require('./helpers');

function drop(overrides = {}) {
  const buf = makePdf(crypto.randomUUID());
  return {
    type: 'drop',
    id: crypto.randomUUID(),
    from: 'reception',
    file: { hash: sha256(buf), size: buf.length, name: 'Rota.pdf', kind: 'file' },
    author: 'Thandi',
    host: 'PC',
    createdAt: Date.now(),
    ...overrides,
  };
}

function status(d, state, by, overrides = {}) {
  return { type: 'status', id: crypto.randomUUID(), target: d.id, status: state, by, byName: '', host: 'PC', createdAt: Date.now(), ...overrides };
}

test('sanitizeDropRecord accepts files and status changes, rejects bad ones', () => {
  const good = sanitizeDropRecord(drop({ author: '  Thandi ' }));
  assert.equal(good.author, 'Thandi');
  assert.equal(good.type, 'drop');
  assert.equal(good.file.name, 'Rota.pdf');

  assert.equal(sanitizeDropRecord(drop({ from: 'nobody' })), null);
  assert.equal(sanitizeDropRecord(drop({ author: 'x'.repeat(41) })), null);
  assert.equal(sanitizeDropRecord(drop({ file: null })), null, 'a drop needs a file');
  assert.equal(sanitizeDropRecord(drop({ file: { hash: 'abc', size: 4, name: 'a.pdf', kind: 'file' } })), null, 'the file needs a real fingerprint');
  assert.equal(sanitizeDropRecord(drop({ file: { hash: sha256(Buffer.from('x')), size: 4, name: 'invoice.pdf.exe', kind: 'file' } })), null, 'programs can’t be shared');
  assert.equal(sanitizeDropRecord(drop({ file: { hash: sha256(Buffer.from('x')), size: 4, name: 'page.html', kind: 'file' } })), null, 'neither can web pages');
  assert.equal(sanitizeDropRecord(drop({ file: { hash: sha256(Buffer.from('x')), size: 20 * 1024 * 1024, name: 'big.zip', kind: 'file' } })), null, 'or files over the limit');
  assert.equal(sanitizeDropRecord({ ...drop(), type: 'other' }), null);
  assert.equal(sanitizeDropRecord(drop({ id: 'x' })), null);

  const d = drop();
  assert.ok(sanitizeDropRecord(status(d, 'removed', 'clinical')));
  assert.ok(sanitizeDropRecord(status(d, 'open', 'clinical')));
  assert.equal(sanitizeDropRecord(status(d, 'deleted', 'clinical')), null);
  assert.equal(sanitizeDropRecord(status(d, 'removed', 'nobody')), null);
});

test('any department can take a file out and put it back; the latest change wins', () => {
  const dir = tempDir();
  const log = new DropLog(dir).load();
  const d = drop();
  const t0 = Date.now();
  log.add([d]);
  const out = () => Boolean(log.removal(log.drops.get(d.id)));
  assert.equal(out(), false);

  log.add([status(d, 'removed', 'clinical', { createdAt: t0 + 1 })]);
  assert.equal(out(), true);
  log.add([status(d, 'open', 'principal', { createdAt: t0 + 2 })]); // undo
  assert.equal(out(), false);
  log.add([status(d, 'removed', 'reception', { createdAt: t0 + 3 })]);
  assert.equal(out(), true);
  log.add([status(d, 'open', 'clinical', { createdAt: t0 - 100 })]); // an old undo arriving late
  assert.equal(out(), true);

  const reloaded = new DropLog(dir).load();
  assert.equal(reloaded.all().length, 1);
  assert.equal(reloaded.removal(reloaded.drops.get(d.id)).status, 'removed');
});

function makeNode(name, dept, { dropBox = true } = {}) {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const files = new FileStore(dir);
  const log = dropBox ? new DropLog(dir).load() : null;
  const net = new Network({
    store,
    drops: log,
    files,
    fileRetentionDays: 7,
    dropRetentionDays: 14,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
    minSyncGapMs: 100,
  });
  return { name, store, files, log, net };
}

async function startAll(t, nodes) {
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  for (const n of nodes) n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
}

/** Stores the file on `node` and makes the record that puts it in the Drop box. */
function dropOn(node, buf, name, overrides = {}) {
  const file = node.files.add(buf, name);
  return drop({ file, ...overrides });
}

test('a dropped file reaches every computer, bytes and all, and a removal follows it; older versions are never asked', async (t) => {
  const reception = makeNode('REC', 'reception');
  const clinical = makeNode('CLIN', 'clinical');
  const older = makeNode('OLD', 'principal', { dropBox: false });
  await startAll(t, [reception, clinical, older]);

  let dropRequests = 0;
  older.net.server.prependListener('request', (req) => {
    if (req.url.includes('/drops/')) dropRequests++;
  });

  const png = makePng({ width: 64, height: 48, seed: 5 });
  const [d] = reception.log.add([dropOn(reception, png, 'Bella x-ray.png')], { local: true });
  reception.net.pushNow([d], 'drops');
  await waitFor(() => clinical.log.drops.has(d.id));
  await waitFor(() => clinical.files.has(d.file.hash));
  assert.deepEqual(clinical.files.read(d.file.hash), png, 'byte for byte the same picture');
  assert.ok(!clinical.log.drops.get(d.id).local, 'it arrives as someone else’s file, which is what raises the notification');

  const [gone] = clinical.log.add([status(d, 'removed', 'clinical')], { local: true });
  clinical.net.pushNow([gone], 'drops');
  await waitFor(() => reception.log.removal(reception.log.drops.get(d.id)));
  assert.equal(reception.log.removal(d).by, 'clinical');

  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(dropRequests, 0);
});

test('a computer that was off catches up on the Drop box and its files', async (t) => {
  const early = makeNode('EARLY', 'reception');
  const late = makeNode('LATE', 'clinical');
  const pdf = makePdf('catch up');
  const [d] = early.log.add([dropOn(early, pdf, 'Rota.pdf')], { local: true });
  await startAll(t, [early, late]);
  await waitFor(() => late.log.drops.has(d.id));
  await waitFor(() => late.files.has(d.file.hash));
  assert.deepEqual(late.files.read(d.file.hash), pdf);
});

test('the Drop box keeps files longer than chat does, but not forever', async (t) => {
  const origin = makeNode('ORIGIN', 'reception');
  const wanter = makeNode('WANTER', 'clinical');
  const tenDays = Date.now() - 10 * 86400000;
  const pdf = makePdf('ten days old');
  // Ten days old: past a chat attachment's week, still inside the Drop box's fortnight.
  const d = dropOn(origin, pdf, 'Ten days.pdf', { createdAt: tenDays });
  origin.log.add([d]);
  wanter.log.add([d]);

  const ancient = dropOn(origin, makePdf('ancient'), 'Ancient.pdf', { createdAt: Date.now() - 20 * 86400000 });
  origin.log.add([ancient]);
  wanter.log.add([ancient]);

  await startAll(t, [origin, wanter]);
  await waitFor(() => wanter.files.has(d.file.hash));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(wanter.files.has(ancient.file.hash), false, 'nobody fetches a file that is due to be cleared');
});
