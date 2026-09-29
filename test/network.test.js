'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const { MessageStore, DeletionLog, ReactionLog } = require('../src/main/store');
const { Network, isPrivateAddress } = require('../src/main/network');
const { tempDir, makeMessage, waitFor } = require('./helpers');

// Port 0 lets Windows pick a free port, so tests never collide with ports
// that are in use or reserved on the machine running them.
// `features` mimics older versions: [] is 1.0.x, ['deletions'] is 1.1.0.
function makeNode(name, dept, { features = ['deletions', 'reactions'] } = {}) {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const deletions = features.includes('deletions') ? new DeletionLog(dir).load() : null;
  const reactions = features.includes('reactions') ? new ReactionLog(dir).load() : null;
  const net = new Network({
    store,
    deletions,
    reactions,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
    minSyncGapMs: 100,
  });
  return { name, store, deletions, reactions, net };
}

function reaction(message, by, emoji, overrides = {}) {
  return { id: crypto.randomUUID(), target: message.id, emoji, on: true, by, host: 'TEST-PC', createdAt: Date.now(), ...overrides };
}

function deletion(message, overrides = {}) {
  return {
    id: crypto.randomUUID(),
    target: message.id,
    deleted: true,
    by: message.from,
    host: 'TEST-PC',
    createdAt: Date.now(),
    ...overrides,
  };
}

async function start(...nodes) {
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
    n.tcpPort = n.net.tcpPort;
  }
}

// Call after start(), once each node's real ports are known.
function link(nodes) {
  for (const n of nodes) {
    n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
  }
}

const sameHistory = (nodes) => nodes.every((n) => n.store.digest().hash === nodes[0].store.digest().hash);

test('isPrivateAddress only allows local network ranges', () => {
  for (const ok of ['192.168.1.5', '10.0.0.1', '172.20.1.1', '127.0.0.1', '::ffff:192.168.75.65', '::1']) {
    assert.equal(isPrivateAddress(ok), true, ok);
  }
  for (const bad of ['8.8.8.8', '172.32.0.1', '1.2.3.4', '', undefined, 'fe80::1']) {
    assert.equal(isPrivateAddress(bad), false, String(bad));
  }
});

test('three computers discover each other and converge on the same history', async (t) => {
  const a = makeNode('A', 'reception');
  const b = makeNode('B', 'clinical');
  const c = makeNode('C', 'principal');
  const nodes = [a, b, c];

  // Each starts with history the others have never seen (e.g. they were offline).
  a.store.add([makeMessage({ text: 'from A 1' }), makeMessage({ text: 'from A 2' })], { local: true });
  b.store.add([makeMessage({ from: 'clinical', text: 'from B' })], { local: true });
  const shared = makeMessage({ text: 'both A and C' });
  a.store.add([shared]);
  c.store.add([shared, makeMessage({ from: 'principal', text: 'from C' })], { local: true });

  await start(...nodes);
  t.after(() => nodes.forEach((n) => n.net.stop()));
  link(nodes);

  await waitFor(() => nodes.every((n) => n.net.peers().length === 2));
  await waitFor(() => sameHistory(nodes) && a.store.count === 5);

  const peerOfA = a.net.peers().find((p) => p.id === 'peer-B');
  assert.equal(peerOfA.dept, 'clinical');
  assert.equal(peerOfA.host, 'B');

  // A new message reaches everyone.
  const [fresh] = b.store.add([makeMessage({ from: 'clinical', text: 'new one' })], { local: true });
  b.net.pushNow([fresh]);
  await waitFor(() => a.store.has(fresh.id) && c.store.has(fresh.id));
  assert.equal(a.store.byId.get(fresh.id).local, undefined, 'received messages are not marked local');
});

test('a computer that cannot accept connections still syncs both ways', async (t) => {
  const open = makeNode('OPEN', 'reception');
  const closed = makeNode('CLOSED', 'clinical');
  open.store.add([makeMessage({ text: 'on open' })]);
  closed.store.add([makeMessage({ from: 'clinical', text: 'on closed' })]);

  await start(open, closed);
  t.after(() => [open, closed].forEach((n) => n.net.stop()));
  // Simulate a firewall on CLOSED: its sync server refuses everything.
  closed.net.server.removeAllListeners('request');
  closed.net.server.on('request', (req, res) => req.socket.destroy());
  // And OPEN never starts a sync itself.
  open.net._maybeSync = () => {};
  link([open, closed]);

  await waitFor(() => sameHistory([open, closed]) && open.store.count === 2);
});

test('a delete for everyone reaches every computer, including ones that were offline', async (t) => {
  const a = makeNode('A', 'reception');
  const b = makeNode('B', 'clinical');
  const c = makeNode('C', 'principal');
  const msg = makeMessage({ from: 'reception', text: 'wrong room, ignore' });
  for (const n of [a, b, c]) n.store.add([msg]);

  // C is "offline" when A deletes and then un-deletes a second message.
  await start(a, b);
  t.after(() => [a, b, c].forEach((n) => n.net.stop()));
  link([a, b]);

  const [del] = a.deletions.add([deletion(msg)], { local: true });
  a.net.pushNow([del], 'deletions');
  await waitFor(() => b.deletions.isDeleted(b.store.byId.get(msg.id)));

  const other = makeMessage({ from: 'reception', text: 'keep me' });
  for (const n of [a, b, c]) n.store.add([other]);
  a.deletions.add([deletion(other, { createdAt: Date.now() - 10 })]);
  a.deletions.add([deletion(other, { deleted: false })]); // undo
  await waitFor(() => b.deletions.count === 3);
  assert.equal(b.deletions.isDeleted(other), false, 'the undo wins');

  // C comes online and catches up from either computer.
  await start(c);
  link([a, b, c]);
  await waitFor(() => c.deletions.count === 3);
  assert.equal(c.deletions.isDeleted(msg), true);
  assert.equal(c.deletions.isDeleted(other), false);
});

test('computers on 1.0.x keep syncing messages with newer ones', async (t) => {
  const modern = makeNode('NEW', 'reception');
  const legacy = makeNode('OLD', 'clinical', { features: [] });
  modern.store.add([makeMessage({ text: 'from new' })]);
  legacy.store.add([makeMessage({ from: 'clinical', text: 'from old' })]);
  const msg = makeMessage({ text: 'deleted on new' });
  modern.store.add([msg]);
  modern.deletions.add([deletion(msg)]);

  let deletionRequests = 0;
  await start(modern, legacy);
  t.after(() => [modern, legacy].forEach((n) => n.net.stop()));
  legacy.net.server.prependListener('request', (req) => {
    if (req.url.includes('/deletions/')) deletionRequests++;
  });
  link([modern, legacy]);

  await waitFor(() => sameHistory([modern, legacy]) && legacy.store.count === 3);
  const [fresh] = modern.store.add([makeMessage({ text: 'pushed' })], { local: true });
  modern.net.pushNow([fresh]);
  await waitFor(() => legacy.store.has(fresh.id));
  // Give a few more sync rounds a chance to (wrongly) ask about deletions.
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(deletionRequests, 0, 'never asks an old computer about deletions');
});

test('reactions reach every computer, and 1.1.0 computers are never asked about them', async (t) => {
  const a = makeNode('A', 'reception');
  const b = makeNode('B', 'clinical');
  const v110 = makeNode('V110', 'principal', { features: ['deletions'] });
  const msg = makeMessage({ from: 'principal', text: 'Staff meeting at 5' });
  for (const n of [a, b, v110]) n.store.add([msg]);

  let reactionRequests = 0;
  await start(a, b, v110);
  t.after(() => [a, b, v110].forEach((n) => n.net.stop()));
  v110.net.server.prependListener('request', (req) => {
    if (req.url.includes('/reactions/')) reactionRequests++;
  });
  link([a, b, v110]);

  const [thumb] = a.reactions.add([reaction(msg, 'reception', '👍')], { local: true });
  a.net.pushNow([thumb], 'reactions');
  b.reactions.add([reaction(msg, 'clinical', '👍'), reaction(msg, 'clinical', '😂')]);
  await waitFor(() => a.reactions.count === 3 && b.reactions.count === 3);
  assert.deepEqual(a.reactions.forMessage(msg.id, ['👌', '👍', '😂', '😅']), [
    { emoji: '👍', by: ['reception', 'clinical'] },
    { emoji: '😂', by: ['clinical'] },
  ]);

  // Messages still flow to and from the 1.1.0 computer.
  const [fresh] = v110.store.add([makeMessage({ from: 'principal', text: 'from 1.1.0' })], { local: true });
  v110.net.pushNow([fresh]);
  await waitFor(() => a.store.has(fresh.id) && b.store.has(fresh.id));
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(reactionRequests, 0);
});

test('sync server moves on to the next port when one is taken', async (t) => {
  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const taken = blocker.address().port;
  t.after(() => blocker.close());

  const node = makeNode('BUSY', 'reception');
  node.net.tcpPorts = [taken, 0];
  await start(node);
  t.after(() => node.net.stop());
  assert.notEqual(node.tcpPort, taken);
  assert.ok(node.tcpPort > 0);
});

test('sync server rejects requests without the app header and bad messages', async (t) => {
  const node = makeNode('SOLO', 'reception');
  await start(node);
  t.after(() => node.net.stop());

  const status = await new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: node.tcpPort, path: '/okv/v1/digest' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(status, 400);

  const peer = { address: '127.0.0.1', port: node.tcpPort };
  const res = await node.net._request(peer, 'POST', '/push', {
    messages: [makeMessage({ from: 'nobody' }), makeMessage({ text: '' }), makeMessage({ text: 'fine' })],
  });
  assert.equal(res.accepted, 1);
  assert.equal(node.store.count, 1);
});
