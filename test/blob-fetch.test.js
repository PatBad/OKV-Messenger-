'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { GifStore } = require('../src/main/gifs');
const { FileStore } = require('../src/main/files');
const { MessageStore } = require('../src/main/store');
const { Network } = require('../src/main/network');
const { tempDir, makeMessage, waitFor, makeGif } = require('./helpers');

// Beacons are slow here (like the app's real 8 s), so anything that arrives promptly was fetched on purpose,
// not picked up by a later tick.
function makeNode(name, dept) {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const gifs = new GifStore(dir);
  const files = new FileStore(dir);
  const network = new Network({
    store,
    gifs,
    files,
    fileRetentionDays: 7,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 60000,
    minSyncGapMs: 100,
  });
  return { name, store, gifs, files, net: network };
}

async function link(t, a, b) {
  for (const n of [a, b]) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => [a, b].forEach((n) => n.net.stop()));
  a.net.staticPeers = [{ address: '127.0.0.1', udpPort: b.udpPort }];
  b.net.staticPeers = [{ address: '127.0.0.1', udpPort: a.udpPort }];
  a.net._sendBeacon('hello');
  b.net._sendBeacon('hello');
  await waitFor(() => a.net.peerMap.size === 1 && b.net.peerMap.size === 1);
}

const gifMessage = (g) => makeMessage({ text: '[GIF]', gif: g, createdAt: Date.now() });

test('a computer that has gone quiet but is still listed does not hold up a GIF', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  await link(t, sender, receiver);

  // Accepts connections and never answers, like a PC that has just dropped off the network.
  const sockets = new Set();
  const hung = net.createServer((s) => sockets.add(s)).listen(0, '127.0.0.1');
  await new Promise((r) => hung.once('listening', r));
  t.after(() => {
    sockets.forEach((s) => s.destroy());
    hung.close();
  });
  const real = [...receiver.net.peerMap.entries()];
  receiver.net.peerMap.clear();
  receiver.net.peerMap.set('ghost', { id: 'ghost', address: '127.0.0.1', port: hung.address().port, known: {}, lastSeen: Date.now() + 1e9, host: 'GHOST' });
  for (const [k, v] of real) receiver.net.peerMap.set(k, v);

  const gif = sender.gifs.add(makeGif({ width: 40, height: 40, seed: 1 }));
  const [message] = sender.store.add([gifMessage(gif)], { local: true });
  const started = Date.now();
  sender.net.pushNow([message]);
  await waitFor(() => receiver.gifs.has(gif.hash), 4000);
  assert.ok(Date.now() - started < 3000, 'did not wait for the silent computer to time out');
});

test('a computer that cannot be reached is skipped for a while rather than asked for every GIF', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  await link(t, sender, receiver);

  // Nothing is listening on this port at all.
  const closed = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => closed.once('listening', r));
  const port = closed.address().port;
  await new Promise((r) => closed.close(r));
  receiver.net.peerMap.set('gone', { id: 'gone', address: '127.0.0.1', port, known: {}, lastSeen: Date.now() + 1e9, host: 'GONE' });

  const gif = sender.gifs.add(makeGif({ width: 40, height: 40, seed: 2 }));
  const [message] = sender.store.add([gifMessage(gif)], { local: true });
  sender.net.pushNow([message]);
  await waitFor(() => receiver.gifs.has(gif.hash), 4000);
  assert.ok(receiver.net.peerMap.get('gone').blobSkipUntil > Date.now(), 'the unreachable computer is skipped for now');
  assert.equal(receiver.net.peerMap.get(sender.net.peerId).blobSkipUntil || 0, 0, 'the one that answered is not');
});

test('a GIF that arrives while another is downloading is started at once', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  await link(t, sender, receiver);

  const big = sender.gifs.add(makeGif({ width: 40, height: 40, seed: 3 }));
  const small = sender.gifs.add(makeGif({ width: 40, height: 40, seed: 4 }));
  const [m1] = sender.store.add([gifMessage(big)], { local: true });
  const [m2] = sender.store.add([gifMessage(small)], { local: true });

  // Make the first download slow so the second message lands while it is still going.
  const original = receiver.net._requestBinary.bind(receiver.net);
  receiver.net._requestBinary = async (peer, route, ...rest) => {
    if (route.endsWith(big.hash)) await new Promise((r) => setTimeout(r, 1500));
    return original(peer, route, ...rest);
  };

  const started = Date.now();
  sender.net.pushNow([m1]);
  await waitFor(() => receiver.net.wanted.has(big.hash));
  sender.net.pushNow([m2]);
  await waitFor(() => receiver.gifs.has(small.hash), 4000);
  assert.ok(Date.now() - started < 1400, 'the second GIF did not wait for the first to finish');
  assert.equal(receiver.gifs.has(big.hash), false, 'the first was still downloading');
  await waitFor(() => receiver.gifs.has(big.hash), 4000);
});

test('a GIF nobody has yet is retried on the next tick and then arrives', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  await link(t, sender, receiver);

  const gif = makeGif({ width: 40, height: 40, seed: 5 });
  const info = sender.gifs.add(gif);
  const held = sender.gifs.read(info.hash);
  sender.gifs.remove(info.hash); // the sender doesn't have the file yet when the message lands
  const [message] = sender.store.add([gifMessage(info)], { local: true });
  sender.net.pushNow([message]);
  await waitFor(() => receiver.store.has(message.id));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(receiver.gifs.has(info.hash), false);
  assert.equal(receiver.net.wanted.has(info.hash), true, 'still wanted');

  sender.gifs.addVerified(info.hash, held);
  receiver.net._tick();
  await waitFor(() => receiver.gifs.has(info.hash), 4000);
  assert.equal(receiver.net.wanted.size, 0);
});

test('a GIF that no computer can supply is reported as failed after a while, and Retry asks again', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  await link(t, sender, receiver);

  const info = sender.gifs.add(makeGif({ width: 40, height: 40, seed: 6 }));
  const held = sender.gifs.read(info.hash);
  sender.gifs.remove(info.hash); // nobody has the file
  const [message] = sender.store.add([gifMessage(info)], { local: true });
  sender.net.pushNow([message]);
  await waitFor(() => receiver.net.blobState(info.hash) === 'loading');

  let changes = 0;
  receiver.net.on('blobs-changed', () => changes++);
  receiver.net._sweepFailedBlobs();
  assert.equal(receiver.net.blobState(info.hash), 'loading', 'not failed straight away');
  assert.equal(changes, 0);

  receiver.net.wanted.get(info.hash).since -= 61000; // it has now been wanted for over a minute
  receiver.net._sweepFailedBlobs();
  assert.equal(receiver.net.blobState(info.hash), 'failed');
  assert.equal(changes, 1, 'the page is told to redraw');
  receiver.net._sweepFailedBlobs();
  assert.equal(changes, 1, 'only once');

  // The file turns up on the sender, and the person presses Retry.
  sender.gifs.addVerified(info.hash, held);
  receiver.net.retryBlob(info.hash);
  assert.equal(receiver.net.blobState(info.hash), 'loading', 'back to loading while it tries again');
  await waitFor(() => receiver.gifs.has(info.hash), 4000);
  assert.equal(receiver.net.blobState(info.hash), null, 'nothing left to wait for once it is here');
});

test('an attached file nobody has fails and retries the same way as a GIF', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  await link(t, sender, receiver);

  const data = Buffer.from('some document contents');
  const hash = require('crypto').createHash('sha256').update(data).digest('hex');
  // The receiver learns of the file from a message, but the sender can't supply it yet.
  const message = makeMessage({ text: '[Attachment]', attachments: [{ hash, size: data.length, name: 'Rota.pdf', kind: 'file' }], createdAt: Date.now() });
  receiver.store.add([message]);
  await waitFor(() => receiver.net.blobState(hash) === 'loading');

  receiver.net.wanted.get(hash).since -= 61000;
  receiver.net._sweepFailedBlobs();
  assert.equal(receiver.net.blobState(hash), 'failed');

  receiver.net.retryBlob(hash);
  assert.equal(receiver.net.blobState(hash), 'loading');
});

test('the clock for "couldn’t load" starts when a file is first wanted, not each time it is mentioned again', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  await link(t, sender, receiver);
  const info = sender.gifs.add(makeGif({ width: 40, height: 40, seed: 7 }));
  sender.gifs.remove(info.hash);
  const message = gifMessage(info);
  receiver.store.add([message]);
  await waitFor(() => receiver.net.wanted.has(info.hash));
  const first = receiver.net.wanted.get(info.hash).since;
  receiver.net.wanted.get(info.hash).since = first - 5000;
  receiver.net._wantBlobs([message]); // e.g. the same message seen again during a sync
  assert.equal(receiver.net.wanted.get(info.hash).since, first - 5000);
});
