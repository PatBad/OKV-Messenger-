'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { GifStore, inspectGif, sha256 } = require('../src/main/gifs');
const { MessageStore, sanitizeMessage } = require('../src/main/store');
const { Network } = require('../src/main/network');
const { LIMITS } = require('../src/main/constants');
const { tempDir, makeMessage, waitFor, makeGif } = require('./helpers');

test('inspectGif accepts real GIFs and rejects everything else', () => {
  const gif = makeGif({ width: 40, height: 30 });
  assert.deepEqual(inspectGif(gif), { width: 40, height: 30 });
  assert.ok(inspectGif(Buffer.concat([Buffer.from('GIF87a'), Buffer.alloc(20, 1)])), '87a is accepted too');

  assert.equal(inspectGif(Buffer.from('<html>not a gif</html>')), null);
  assert.equal(inspectGif(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0])), null, 'a PNG');
  assert.equal(inspectGif(gif.subarray(0, 8)), null, 'truncated header');
  assert.equal(inspectGif(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)])), null, 'zero size');
  assert.equal(inspectGif('GIF89a'), null, 'not bytes');
  const huge = Buffer.concat([gif, Buffer.alloc(LIMITS.GIF_BYTES)]);
  assert.equal(inspectGif(huge), null, 'over the size limit');
});

test('GifStore keeps each GIF once, named by its fingerprint', () => {
  const dir = tempDir();
  const store = new GifStore(dir);
  const gif = makeGif({ seed: 1 });
  const saved = store.add(gif);
  assert.equal(saved.hash, sha256(gif));
  assert.equal(saved.size, gif.length);
  assert.deepEqual([saved.w, saved.h], [24, 24]);
  assert.ok(store.has(saved.hash));
  assert.deepEqual(store.read(saved.hash), gif);
  assert.equal(store.add(gif).hash, saved.hash, 'adding it again changes nothing');
  assert.equal(fs.readdirSync(path.join(dir, 'gifs')).length, 1);

  assert.throws(() => store.add(Buffer.from('nope')), /isn’t a GIF/);
  assert.throws(() => store.add(Buffer.concat([gif, Buffer.alloc(LIMITS.GIF_BYTES)])), /too large/);
});

test('GifStore refuses a received file that is not the one asked for, and odd names', () => {
  const store = new GifStore(tempDir());
  const gif = makeGif({ seed: 2 });
  const other = makeGif({ seed: 3 });
  const added = [];
  store.on('added', (h) => added.push(h));

  assert.throws(() => store.addVerified(sha256(gif), other), /does not match/);
  assert.throws(() => store.addVerified(sha256(Buffer.from('x')), Buffer.from('x')), /does not match/);
  assert.equal(store.has(sha256(gif)), false);

  store.addVerified(sha256(gif), gif);
  store.addVerified(sha256(gif), gif); // already have it: no second announcement
  assert.deepEqual(added, [sha256(gif)]);

  for (const bad of ['../../config', '..\\..\\config.json', 'abc', sha256(gif).toUpperCase(), `${sha256(gif)}.gif`, '']) {
    assert.equal(store.has(bad), false, bad);
    assert.equal(store.read(bad), null, bad);
  }
});

test('a message keeps a valid GIF field and drops a malformed one without losing the message', () => {
  const gif = { hash: sha256(makeGif()), size: 1234, w: 24, h: 24 };
  const clean = sanitizeMessage({ ...makeMessage({ text: '[GIF]' }), gif: { ...gif, evil: 'x' } });
  assert.deepEqual(clean.gif, gif);

  const malformed = [
    null,
    'gif',
    { ...gif, hash: 'short' },
    { ...gif, size: 0 },
    { ...gif, size: LIMITS.GIF_BYTES + 1 },
    { ...gif, w: 0 },
    { ...gif, h: 1.5 },
  ];
  for (const bad of malformed) {
    const m = sanitizeMessage({ ...makeMessage({ text: '[GIF]' }), gif: bad });
    assert.ok(m, 'the message itself is kept');
    assert.equal('gif' in m, false);
  }
  assert.equal('gif' in sanitizeMessage(makeMessage()), false);
});

function makeNode(name, dept, { gifs = true } = {}) {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const gifStore = gifs ? new GifStore(dir) : null;
  const net = new Network({
    store,
    gifs: gifStore,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
    minSyncGapMs: 100,
  });
  return { name, store, gifs: gifStore, net };
}

function link(nodes) {
  for (const n of nodes) {
    n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
  }
}

async function startAll(t, nodes) {
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  link(nodes);
}

const gifMessage = (saved, overrides = {}) => makeMessage({ text: '[GIF]', ...overrides, gif: saved });

test('a GIF sent from one computer arrives on the others, which fetch the file themselves', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  const older = makeNode('OLD', 'principal', { gifs: false });
  await startAll(t, [sender, receiver, older]);

  const gif = makeGif({ width: 32, height: 20, seed: 4 });
  const saved = sender.gifs.add(gif);
  const [message] = sender.store.add([gifMessage(saved)], { local: true });
  sender.net.pushNow([message]);

  await waitFor(() => receiver.store.has(message.id));
  await waitFor(() => receiver.gifs.has(saved.hash));
  assert.deepEqual(receiver.gifs.read(saved.hash), gif, 'byte for byte the same file');
  assert.deepEqual(receiver.store.byId.get(message.id).gif, saved);

  // The computer without GIF support still gets the message (as "[GIF]") and stays in sync.
  await waitFor(() => older.store.has(message.id));
  assert.equal(older.store.byId.get(message.id).text, '[GIF]');
});

test('a computer that was off catches up on the GIF as well as the message', async (t) => {
  const early = makeNode('EARLY', 'reception');
  const late = makeNode('LATE', 'clinical');
  const gif = makeGif({ seed: 5 });
  const saved = early.gifs.add(gif);
  early.store.add([gifMessage(saved)], { local: true });

  await startAll(t, [early, late]);
  await waitFor(() => late.gifs.has(saved.hash));
  assert.deepEqual(late.gifs.read(saved.hash), gif);
});

test('a computer asks around until it finds one that has the GIF', async (t) => {
  const origin = makeNode('ORIGIN', 'reception');
  const bystander = makeNode('BYSTANDER', 'principal');
  const wanter = makeNode('WANTER', 'clinical');
  const gif = makeGif({ seed: 6 });
  const saved = origin.gifs.add(gif);
  const message = gifMessage(saved);
  origin.store.add([message]);
  bystander.store.add([message]); // has the message but not the file
  wanter.store.add([message]);

  await startAll(t, [bystander, wanter]);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(wanter.gifs.has(saved.hash), false, 'nobody online has the file yet');

  // The one that has it comes online later.
  await origin.net.start();
  origin.udpPort = origin.net.udp.address().port;
  t.after(() => origin.net.stop());
  link([origin, bystander, wanter]);
  await waitFor(() => wanter.gifs.has(saved.hash));
  assert.deepEqual(wanter.gifs.read(saved.hash), gif);
});

test('the GIF route only serves GIFs by exact fingerprint', async (t) => {
  const node = makeNode('SERVER', 'reception');
  await startAll(t, [node]);
  const saved = node.gifs.add(makeGif({ seed: 7 }));
  // A file next to the GIF folder that must never be reachable.
  fs.writeFileSync(path.join(node.gifs.dir, '..', 'secret.txt'), 'private');

  const get = (route, headers = { 'x-okv-app': 'okv-messenger' }) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: node.net.tcpPort, path: `/okv/v1${route}`, headers }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
        })
        .on('error', reject);
    });

  const ok = await get(`/gifs/${saved.hash}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.type, 'image/gif');
  assert.deepEqual(ok.body, node.gifs.read(saved.hash));

  assert.equal((await get(`/gifs/${sha256(Buffer.from('missing'))}`)).status, 404);
  const attempts = ['/gifs/../secret.txt', '/gifs/..%2Fsecret.txt', '/gifs/%2e%2e/secret.txt', '/gifs/', '/gifs/abc', `/gifs/${saved.hash}.gif`];
  for (const bad of attempts) {
    const r = await get(bad);
    assert.notEqual(r.status, 200, bad);
    assert.ok(!r.body.includes('private'), bad);
  }
  assert.equal((await get(`/gifs/${saved.hash}`, {})).status, 400, 'needs the app header like every other route');
});
