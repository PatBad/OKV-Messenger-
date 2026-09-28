'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { MessageStore } = require('../src/main/store');
const { Network, isPrivateAddress } = require('../src/main/network');
const { tempDir, makeMessage, waitFor } = require('./helpers');

// Port 0 lets Windows pick a free port, so tests never collide with ports
// that are in use or reserved on the machine running them.
function makeNode(name, dept) {
  const store = new MessageStore(tempDir()).load();
  const net = new Network({
    store,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
  });
  return { name, store, net };
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
