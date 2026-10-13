'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { FileStore, sha256 } = require('../src/main/files');
const { GifStore } = require('../src/main/gifs');
const { MessageStore } = require('../src/main/store');
const { Network } = require('../src/main/network');
const { tempDir, makeMessage, waitFor, makePng, makePdf, makeGif } = require('./helpers');

function makeNode(name, dept, { files = true, gifs = true, retention = 7, onDisk = [] } = {}) {
  const dir = tempDir();
  if (onDisk.length) fs.writeFileSync(path.join(dir, 'messages.jsonl'), onDisk.map((m) => `${JSON.stringify(m)}\n`).join(''));
  const store = new MessageStore(dir).load();
  const fileStore = files ? new FileStore(dir) : null;
  const gifStore = gifs ? new GifStore(dir) : null;
  const net = new Network({
    store,
    files: fileStore,
    gifs: gifStore,
    fileRetentionDays: retention,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
    minSyncGapMs: 100,
  });
  return { name, dir, store, files: fileStore, gifs: gifStore, net };
}

async function startAll(t, nodes) {
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  for (const n of nodes) n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
}

// Dated now (the helper's usual dates are old enough that files would already count as archived).
const withFiles = (list, overrides = {}) => makeMessage({ text: '[Attachment]', attachments: list, createdAt: Date.now(), ...overrides });

test('an attached image and document sent from one computer arrive on the others', async (t) => {
  const sender = makeNode('SEND', 'reception');
  const receiver = makeNode('RECV', 'clinical');
  const older = makeNode('OLD', 'principal', { files: false, gifs: false });
  await startAll(t, [sender, receiver, older]);

  const png = makePng({ width: 80, height: 60, seed: 2 });
  const pdf = makePdf('estimate');
  const a = sender.files.add(png, 'Bella x-ray.png');
  const b = sender.files.add(pdf, 'Estimate.pdf');
  const [message] = sender.store.add([withFiles([a, b])], { local: true });
  sender.net.pushNow([message]);

  await waitFor(() => receiver.store.has(message.id));
  await waitFor(() => receiver.files.has(a.hash) && receiver.files.has(b.hash));
  assert.deepEqual(receiver.files.read(a.hash), png, 'byte for byte the same image');
  assert.deepEqual(receiver.files.read(b.hash), pdf);
  assert.deepEqual(receiver.store.byId.get(message.id).attachments, [a, b]);

  // A computer on an older version still gets the message (as "[Attachment]") and stays in step.
  await waitFor(() => older.store.has(message.id));
  assert.equal(older.store.byId.get(message.id).text, '[Attachment]');
});

test('a computer that was off catches up on files too', async (t) => {
  const early = makeNode('EARLY', 'reception');
  const late = makeNode('LATE', 'clinical');
  const pdf = makePdf('catch up');
  const saved = early.files.add(pdf, 'Rota.pdf');
  early.store.add([withFiles([saved])], { local: true });
  await startAll(t, [early, late]);
  await waitFor(() => late.files.has(saved.hash));
  assert.deepEqual(late.files.read(saved.hash), pdf);
});

test('files for messages already past their week are not fetched, and not served once archived', async (t) => {
  const origin = makeNode('ORIGIN', 'reception');
  const wanter = makeNode('WANTER', 'clinical');
  const pdf = makePdf('old');
  const saved = origin.files.add(pdf, 'Old.pdf');
  const old = withFiles([saved], { createdAt: Date.now() - 9 * 86400000 });
  origin.store.add([old]);
  wanter.store.add([old]);

  await startAll(t, [origin, wanter]);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(wanter.files.has(saved.hash), false, 'nobody fetches a file that is due to be archived');
  assert.equal(wanter.net.wanted.size, 0);

  // The same file attached to a recent message is fetched normally.
  const recent = withFiles([saved]);
  origin.store.add([recent], { local: true });
  origin.net.pushNow([recent]);
  await waitFor(() => wanter.files.has(saved.hash));

  origin.files.archive(saved.hash);
  const fresh = makePdf('another');
  const other = origin.files.add(fresh, 'Other.pdf');
  assert.equal(origin.files.has(saved.hash), false);
  assert.equal(origin.files.has(other.hash), true);
});

test('the files route serves only exact fingerprints, as a download, and a mismatched file is refused', async (t) => {
  const node = makeNode('SERVER', 'reception');
  await startAll(t, [node]);
  const saved = node.files.add(makePdf('served'), 'Served.pdf');
  fs.writeFileSync(path.join(node.dir, 'secret.txt'), 'private');

  const get = (route, headers = { 'x-okv-app': 'okv-messenger' }) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: node.net.tcpPort, path: `/okv/v1${route}`, headers }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        })
        .on('error', reject);
    });

  const ok = await get(`/files/${saved.hash}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'application/octet-stream', 'never served as something a browser would run or render');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(ok.body, node.files.read(saved.hash));

  assert.equal((await get(`/files/${sha256(Buffer.from('nothing'))}`)).status, 404);
  for (const bad of ['/files/../secret.txt', '/files/..%2Fsecret.txt', '/files/%2e%2e/secret.txt', '/files/', '/files/abc', `/files/${saved.hash}.pdf`, `/files/${saved.hash}/x`]) {
    const r = await get(bad);
    assert.notEqual(r.status, 200, bad);
    assert.ok(!r.body.includes('private'), bad);
  }
  assert.equal((await get(`/files/${saved.hash}`, {})).status, 400, 'needs the app header like every other route');

  // GIFs and files are separate: a GIF's fingerprint isn't found under /files, nor the reverse.
  const gif = node.gifs.add(makeGif({ seed: 31 }));
  assert.equal((await get(`/files/${gif.hash}`)).status, 404);
  assert.equal((await get(`/gifs/${saved.hash}`)).status, 404);
  assert.equal((await get(`/gifs/${gif.hash}`)).status, 200);
});

test('a message carrying a blocked file type is delivered without that file', async (t) => {
  const a = makeNode('A', 'reception');
  const b = makeNode('B', 'clinical');
  await startAll(t, [a, b]);
  const good = a.files.add(makePdf('fine'), 'Fine.pdf');
  // A rogue or older computer sends a program in its list; the others never accept it.
  const evil = { hash: sha256(Buffer.from('evil')), size: 4, name: 'invoice.pdf.exe', kind: 'file' };
  const [message] = a.store.add([withFiles([good])], { local: true });
  a.net.pushNow([{ ...message, id: crypto_id(), attachments: [evil, good] }]);
  await waitFor(() => b.store.count === 1);
  const got = [...b.store.byId.values()][0];
  assert.deepEqual(got.attachments, [good]);
});

function crypto_id() {
  return require('crypto').randomUUID();
}
