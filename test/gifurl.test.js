'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fetchGif, checkUrl, nameFromUrl } = require('../src/main/gifurl');
const { LIMITS } = require('../src/main/constants');
const { makeGif } = require('./helpers');

/** A stand-in for fetch() that answers with the given bytes. */
function fakeFetch(body, { status = 200, headers = {} } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return new Response(body, { status, headers });
  };
  impl.calls = calls;
  return impl;
}

test('only plain https links to named websites are followed', () => {
  assert.ok(checkUrl('https://media.tenor.com/abc/dog.gif'));
  for (const bad of [
    'http://media.tenor.com/x.gif',
    'https://127.0.0.1/x.gif',
    'https://192.168.1.5/x.gif',
    'https://localhost/x.gif',
    'https://printer.local/x.gif',
    'https://intranet/x.gif',
    'https://[::1]/x.gif',
    'https://user:pass@media.tenor.com/x.gif',
    'file:///C:/secret.gif',
    'javascript:alert(1)',
    'not a link',
    `https://example.com/${'a'.repeat(2100)}`,
  ]) {
    assert.throws(() => checkUrl(bad), undefined, bad);
  }
});

test('fetchGif returns a real GIF and refuses anything else', async () => {
  const gif = makeGif({ seed: 9 });
  const f = fakeFetch(gif);
  assert.deepEqual(await fetchGif('https://media.tenor.com/a/b.gif', f), gif);
  assert.equal(f.calls.length, 1);

  await assert.rejects(fetchGif('https://example.com/page', fakeFetch('<html>hello</html>')), /isn’t a GIF/);
  await assert.rejects(fetchGif('https://example.com/x.gif', fakeFetch('nope', { status: 404 })), /404/);
  await assert.rejects(fetchGif('https://example.com/x.gif', fakeFetch(gif, { headers: { 'content-length': String(LIMITS.GIF_BYTES + 1) } })), /too large/);
  await assert.rejects(fetchGif('https://example.com/x.gif', fakeFetch(Buffer.concat([gif, Buffer.alloc(LIMITS.GIF_BYTES)]))), /too large/);
  await assert.rejects(fetchGif('http://example.com/x.gif', f), /can’t be used/);
  assert.equal(f.calls.length, 1, 'a refused link is never requested');
});

test('nameFromUrl gives a tidy .gif name', () => {
  assert.equal(nameFromUrl('https://media.tenor.com/a/sleepy-dog.gif'), 'sleepy-dog.gif');
  assert.equal(nameFromUrl('https://media.tenor.com/a/sleepy%20dog.gif?x=1'), 'sleepy dog.gif');
  assert.equal(nameFromUrl('https://media.giphy.com/media/xyz/giphy'), 'giphy.gif');
  assert.equal(nameFromUrl('https://example.com/'), 'pasted.gif');
  assert.equal(nameFromUrl('nonsense'), 'pasted.gif');
});

test('GIFs from the web can be up to 15 MB (GIPHY results are often 4-6 MB), and a refusal says why', async () => {
  assert.equal(LIMITS.GIF_BYTES, 15 * 1024 * 1024);
  const gif = makeGif({ seed: 12 });
  const sixMegabytes = Buffer.concat([gif, Buffer.alloc(6 * 1024 * 1024)]);
  assert.equal((await fetchGif('https://media.giphy.com/a/giphy.gif', fakeFetch(sixMegabytes))).length, sixMegabytes.length);

  const huge = fakeFetch(Buffer.concat([gif, Buffer.alloc(LIMITS.GIF_BYTES)]));
  await assert.rejects(fetchGif('https://media.giphy.com/b/giphy.gif', huge), /too large: 15\.\d MB, and the limit is 15 MB/);
  await assert.rejects(
    fetchGif('https://media.giphy.com/c/giphy.gif', fakeFetch(gif, { headers: { 'content-length': String(20 * 1024 * 1024) } })),
    /too large: 20\.0 MB, and the limit is 15 MB/,
  );
});
