'use strict';

const { inspectGif } = require('./gifs');
const { LIMITS } = require('./constants');

const TIMEOUT_MS = 15000;

/** A GIF link is only followed if it's a plain https address of a named website (never an IP address or this computer). */
function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Not a valid link');
  }
  const host = url.hostname.toLowerCase();
  const bad =
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    raw.length > 2000 ||
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(':') ||
    host.startsWith('[');
  if (bad) throw new Error('That link can’t be used');
  return url;
}

/**
 * Downloads a GIF from a link (e.g. one pasted from the Windows emoji panel's GIF tab or a web page).
 * Returns the file's bytes, only if it really is a GIF within the size limit.
 * `fetchImpl` is injectable for tests.
 */
async function fetchGif(raw, fetchImpl = fetch) {
  const url = checkUrl(raw);
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'image/gif,*/*' } });
  if (!res.ok) throw new Error(`The site answered ${res.status}`);
  const declared = Number(res.headers.get('content-length'));
  if (declared > LIMITS.GIF_BYTES) throw new Error('That GIF is too large');

  const chunks = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LIMITS.GIF_BYTES) {
      await reader.cancel();
      throw new Error('That GIF is too large');
    }
    chunks.push(Buffer.from(value));
  }
  const buf = Buffer.concat(chunks);
  if (!inspectGif(buf)) throw new Error('That link isn’t a GIF');
  return buf;
}

/** A sensible file name for a downloaded GIF. */
function nameFromUrl(raw) {
  try {
    const last = decodeURIComponent(new URL(raw).pathname.split('/').filter(Boolean).pop() || '');
    const clean = last.replace(/[^\w.\- ]+/g, '').slice(0, 60);
    return /\.gif$/i.test(clean) ? clean : `${clean || 'pasted'}.gif`;
  } catch {
    return 'pasted.gif';
  }
}

module.exports = { fetchGif, checkUrl, nameFromUrl };
