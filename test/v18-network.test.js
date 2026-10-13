'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const crypto = require('crypto');
const { MessageStore, EditLog, ReceiptLog, PinLog, receiptId } = require('../src/main/store');
const { Network } = require('../src/main/network');
const { tempDir, makeMessage, waitFor } = require('./helpers');

const uuid = () => crypto.randomUUID();

function makeNode(name, dept, { version = '1.8.0', modern = true, retention = null, onDisk = [] } = {}) {
  const dir = tempDir();
  // History already on disk when the app starts, as on a computer that has been running for weeks.
  if (onDisk.length) fs.writeFileSync(`${dir}/messages.jsonl`, onDisk.map((m) => `${JSON.stringify(m)}\n`).join(''));
  const store = new MessageStore(dir).load();
  const edits = modern ? new EditLog(dir).load() : null;
  const receipts = modern ? new ReceiptLog(dir).load() : null;
  const pins = modern ? new PinLog(dir).load() : null;
  if (retention) store.retentionDays = retention;
  const net = new Network({
    store,
    edits,
    receipts,
    pins,
    version,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
    minSyncGapMs: 100,
  });
  return { name, dir, store, edits, receipts, pins, net };
}

async function startAll(t, nodes) {
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  for (const n of nodes) {
    n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
  }
}

test('edits, seen-receipts and pinned notices reach every computer, and each announces its version', async (t) => {
  const a = makeNode('A', 'reception', { version: '1.8.0' });
  const b = makeNode('B', 'clinical', { version: '1.8.0' });
  const old = makeNode('OLD', 'principal', { modern: false, version: null });
  await startAll(t, [a, b, old]);

  const msg = makeMessage({ from: 'reception', text: 'Recieved' });
  for (const n of [a, b, old]) n.store.add([msg]);

  const [edit] = a.edits.add([{ id: uuid(), target: msg.id, text: 'Received', by: 'reception', host: 'A', createdAt: msg.createdAt + 1000 }], { local: true });
  a.net.pushNow([edit], 'edits');
  b.receipts.add([{ id: receiptId(msg.id, 'clinical'), target: msg.id, by: 'clinical', host: 'B', createdAt: Date.now() }], { local: true });
  const [pin] = b.pins.add([{ type: 'pin', id: uuid(), text: 'Power cut 2–3pm', by: 'clinical', byName: '', host: 'B', createdAt: Date.now() }], { local: true });
  b.net.pushNow([pin], 'pins');

  await waitFor(() => b.edits.count === 1 && a.receipts.count === 1 && a.pins.current() !== null);
  assert.equal(b.edits.latest(msg).text, 'Received');
  assert.equal(a.pins.current().text, 'Power cut 2–3pm');
  assert.deepEqual(a.receipts.seenBy(msg.id).map((s) => s.dept), ['clinical']);

  // Versions are announced; a computer on an older version simply has none.
  await waitFor(() => a.net.peers().length === 2);
  const seen = Object.fromEntries(a.net.peers().map((p) => [p.host, p.ver]));
  assert.deepEqual(seen, { B: '1.8.0', OLD: null });

  // The older computer is unaffected: it never gets asked about the new collections.
  assert.equal(old.store.count, 1);
});

test('a computer that has tidied up old days is not sent them again, and does not offer them', async (t) => {
  // KEEPER still has a month-old message on disk (it hasn't run its tidy-up yet).
  const ancient = makeMessage({ text: 'a month ago', createdAt: Date.now() - 30 * 86400000 });
  const keeper = makeNode('KEEPER', 'reception', { retention: 14, onDisk: [ancient] });
  const tidy = makeNode('TIDY', 'clinical', { retention: 14 });
  assert.equal(keeper.store.count, 1);

  await startAll(t, [keeper, tidy]);
  const recent = makeMessage({ text: 'today', createdAt: Date.now() });
  keeper.store.add([recent], { local: true });
  keeper.net.pushNow([recent]);

  await waitFor(() => tidy.store.has(recent.id));
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(tidy.store.has(ancient.id), false, 'the old message was not pulled across');
  assert.equal(tidy.store.count, 1);

  // Once the keeper tidies up too, both hold exactly the same live messages.
  keeper.store.archiveOld();
  assert.equal(keeper.store.count, 1);
  assert.equal(keeper.store.digest().hash, tidy.store.digest().hash);
});
