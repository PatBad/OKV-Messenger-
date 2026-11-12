'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const { EventEmitter } = require('events');
const { NETWORK, DEPARTMENT_IDS, LIMITS } = require('./constants');
const { HASH } = require('./gifs');

const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

const API = '/okv/v1';
const HEADER = 'x-okv-app';

/** Only computers on the clinic's own (private) network may talk to us. */
function isPrivateAddress(address) {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (a === '::1') return true;
  const parts = a.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [p0, p1] = parts;
  return (
    p0 === 10 ||
    p0 === 127 ||
    (p0 === 172 && p1 >= 16 && p1 <= 31) ||
    (p0 === 192 && p1 === 168) ||
    (p0 === 169 && p1 === 254)
  );
}

function normaliseAddress(address) {
  return address && address.startsWith('::ffff:') ? address.slice(7) : address;
}

/** Directed broadcast address for every IPv4 network this computer is on. */
function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family !== 'IPv4' && iface.family !== 4) continue;
      if (iface.internal || !iface.netmask) continue;
      const ip = iface.address.split('.').map(Number);
      const mask = iface.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  return [...out];
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Peer-to-peer sync over the local network. No server is needed:
 *
 *  - Discovery: every computer broadcasts a small UDP "hello" beacon with a
 *    fingerprint of its history. Others answer with a direct "reply".
 *  - Sync: when fingerprints differ, the computer that notices asks the other
 *    (over HTTP) which messages it has, downloads what it is missing and
 *    uploads what the other is missing. Because either side can complete a
 *    full two-way sync on its own, a computer whose firewall blocks incoming
 *    connections still sends and receives messages.
 *  - New messages are also pushed straight to every known computer so they
 *    show up instantly.
 */
class Network extends EventEmitter {
  constructor({
    store,
    deletions = null,
    reactions = null,
    reminders = null,
    medications = null,
    drops = null,
    appointments = null,
    edits = null,
    receipts = null,
    pins = null,
    version = null,
    gifs = null,
    files = null,
    fileRetentionDays = null,
    dropRetentionDays = null,
    shouldFetch = null,
    peerId,
    getProfile,
    log,
    bindAddress = '0.0.0.0',
    udpPort = NETWORK.UDP_PORT,
    tcpPorts = NETWORK.TCP_PORTS,
    staticPeers = [],
    broadcast = true,
    beaconIntervalMs = NETWORK.BEACON_INTERVAL_MS,
    minSyncGapMs = NETWORK.MIN_SYNC_GAP_MS,
  }) {
    super();
    // What gets synced. Messages keep the original routes and beacon fields
    // (count/hash) so computers on 1.0.x carry on syncing with us. Each newer
    // collection has its own routes and beacon fields (e.g. dcount/dhash) and
    // is only exchanged with computers whose beacons announce it; older
    // versions simply ignore fields they don't know.
    this.collections = [{ name: 'messages', store, prefix: '', key: 'messages', beacon: '' }];
    if (deletions) {
      this.collections.push({ name: 'deletions', store: deletions, prefix: '/deletions', key: 'records', beacon: 'd' });
    }
    if (reactions) {
      this.collections.push({ name: 'reactions', store: reactions, prefix: '/reactions', key: 'records', beacon: 'r' });
    }
    if (reminders) {
      this.collections.push({ name: 'reminders', store: reminders, prefix: '/reminders', key: 'records', beacon: 'rm' });
    }
    if (medications) {
      this.collections.push({ name: 'medications', store: medications, prefix: '/medications', key: 'records', beacon: 'md' });
    }
    if (drops) {
      this.collections.push({ name: 'drops', store: drops, prefix: '/drops', key: 'records', beacon: 'dr' });
    }
    if (appointments) {
      this.collections.push({ name: 'appointments', store: appointments, prefix: '/appointments', key: 'records', beacon: 'ap' });
    }
    if (edits) this.collections.push({ name: 'edits', store: edits, prefix: '/edits', key: 'records', beacon: 'e' });
    if (receipts) this.collections.push({ name: 'receipts', store: receipts, prefix: '/receipts', key: 'records', beacon: 'sn' });
    if (pins) this.collections.push({ name: 'pins', store: pins, prefix: '/pins', key: 'records', beacon: 'pn' });
    // This app's version, announced in every beacon so computers can see who has updated.
    this.version = version;
    this.store = store;
    // GIFs and attached files. Messages only carry a file's fingerprint; the file itself is fetched
    // from whichever computer has it (GET /gifs/<fingerprint> or /files/<fingerprint>).
    this.blobs = {};
    if (gifs) this.blobs.gifs = { store: gifs, max: LIMITS.GIF_BYTES, type: 'image/gif' };
    if (files) this.blobs.files = { store: files, max: LIMITS.FILE_BYTES, type: 'application/octet-stream' };
    // Attached files are only kept for this many days, so none are fetched for older messages.
    this.fileRetentionDays = fileRetentionDays;
    // Files in the Drop box come the same way, and are kept for their own number of days.
    this.drops = drops;
    this.dropRetentionDays = dropRetentionDays;
    // Lets the app say a message's files are no longer wanted (e.g. it was deleted for everyone).
    this.shouldFetch = shouldFetch;
    this.wanted = new Map(); // fingerprint -> { kind: 'gifs' | 'files', createdAt }
    this._fetchingBlobs = false;
    this._fetchBlobsTimer = null;
    this.peerId = peerId;
    this.getProfile = getProfile;
    this.log = log || { info() {}, warn() {}, error() {} };
    this.bindAddress = bindAddress;
    this.udpPort = udpPort;
    this.tcpPorts = tcpPorts;
    this.staticPeers = staticPeers.map(parseStaticPeer).filter(Boolean);
    this.broadcast = broadcast && bindAddress !== '127.0.0.1';
    this.beaconIntervalMs = beaconIntervalMs;
    this.minSyncGapMs = minSyncGapMs;
    this.peerMap = new Map();
    this.tcpPort = null;
    this.timers = [];
    this.stopped = false;
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
    this._beaconSoonTimer = null;
    this._onStoreAdded = () => this.announce();
    for (const c of this.collections) c.store.on('added', this._onStoreAdded);
    this._onMessagesAdded = (messages) => this._wantBlobs(messages);
    store.on('added', this._onMessagesAdded);
    this._onDropsAdded = (records) => this._wantDropFiles(records);
    if (drops) drops.on('added', this._onDropsAdded);
  }

  async start() {
    await this._startHttp();
    await this._startUdp();
    this._wantBlobs(this.store.sorted || []);
    if (this.drops) this._wantDropFiles(this.drops.all());
    this.timers.push(setInterval(() => this._tick(), this.beaconIntervalMs));
    return this;
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    clearTimeout(this._beaconSoonTimer);
    for (const c of this.collections) c.store.off('added', this._onStoreAdded);
    this.store.off('added', this._onMessagesAdded);
    if (this.drops) this.drops.off('added', this._onDropsAdded);
    clearTimeout(this._fetchBlobsTimer);
    if (this.udp) this.udp.close();
    if (this.server) this.server.close();
    this.agent.destroy();
  }

  /** Computers currently visible on the network. */
  peers() {
    return [...this.peerMap.values()]
      .map(({ id, dept, host, address, port, lastSeen, reachable, ver }) => ({ id, dept, host, address, port, lastSeen, reachable, ver }))
      .sort((a, b) => (a.host || '').localeCompare(b.host || ''));
  }

  /** Sends freshly written records (messages by default) straight to every known computer. */
  pushNow(records, name = 'messages') {
    const c = this._collection(name);
    for (const peer of this.peerMap.values()) {
      if (!this._peerHas(peer, c)) continue;
      // Receivers take at most CHUNK records per request (e.g. deleting a busy day).
      for (const part of chunk(records, NETWORK.CHUNK)) {
        this._request(peer, 'POST', `${c.prefix}/push`, { from: this._self(), [c.key]: part })
          .then(() => this._markReachable(peer, true))
          .catch(() => this._markReachable(peer, false)); // they'll pick it up on their next sync
      }
    }
    this.announce();
  }

  _collection(name) {
    return this.collections.find((c) => c.name === name);
  }

  /** Every computer syncs messages; newer collections only with computers that announce them. */
  _peerHas(peer, c) {
    return c.name === 'messages' || Boolean(peer.known[c.name]);
  }

  // ---------- HTTP server ----------

  async _startHttp() {
    for (const port of this.tcpPorts) {
      const server = http.createServer((req, res) => this._handle(req, res));
      server.keepAliveTimeout = 5000;
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, this.bindAddress, resolve);
        });
        server.on('error', (err) => this.log.error('http server error', err));
        this.server = server;
        this.tcpPort = server.address().port; // the real port when 0 (any free port) was asked for
        this.log.info(`sync server listening on ${this.bindAddress}:${this.tcpPort}`);
        return;
      } catch (err) {
        this.log.warn(`port ${port} unavailable: ${err.code || err.message}`);
      }
    }
    throw new Error('No free port for the sync server');
  }

  async _handle(req, res) {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (!isPrivateAddress(req.socket.remoteAddress)) return send(403, { error: 'forbidden' });
      // A custom header can't be sent cross-site without a CORS preflight, which
      // we never approve, so web pages can't post to us.
      if (req.headers[HEADER] !== NETWORK.APP_ID) return send(400, { error: 'bad client' });

      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith(API)) return send(404, { error: 'not found' });
      const rest = url.pathname.slice(API.length);

      // A GIF or attached file, by its fingerprint. Anything that isn't exactly 64 hex characters is refused,
      // so a request can never name a file outside the folder.
      const blobRoute = req.method === 'GET' ? /^\/(gifs|files)\/(.*)$/.exec(rest) : null;
      if (blobRoute) {
        const blob = this.blobs[blobRoute[1]];
        const file = blob && HASH.test(blobRoute[2]) ? blob.store.read(blobRoute[2]) : null;
        if (!file) return send(404, { error: 'not found' });
        res.writeHead(200, { 'content-type': blob.type, 'content-length': file.length, 'x-content-type-options': 'nosniff' });
        return res.end(file);
      }
      const c = this.collections.find((x) => x.prefix && rest.startsWith(`${x.prefix}/`)) || this.collections[0];
      const route = `${req.method} ${rest.slice(c.prefix.length)}`;
      const address = normaliseAddress(req.socket.remoteAddress);

      if (route === 'GET /digest') {
        return send(200, { id: this.peerId, ...c.store.digest() });
      }
      const body = await readJson(req);
      if (route === 'POST /ids') {
        const days = Array.isArray(body.days) ? body.days.filter((d) => typeof d === 'string').slice(0, 5000) : [];
        return send(200, { ids: c.store.idsForDays(days) });
      }
      if (route === 'POST /get') {
        const ids = Array.isArray(body.ids) ? body.ids.filter((d) => typeof d === 'string').slice(0, NETWORK.CHUNK) : [];
        return send(200, { [c.key]: c.store.getWire(ids) });
      }
      if (route === 'POST /push') {
        if (body.from) this._seePeer(body.from, address);
        const records = Array.isArray(body[c.key]) ? body[c.key].slice(0, NETWORK.CHUNK) : [];
        const added = c.store.add(records);
        return send(200, { accepted: added.length });
      }
      return send(404, { error: 'not found' });
    } catch (err) {
      this.log.warn('request failed', err.message);
      if (!res.headersSent) send(400, { error: 'bad request' });
    }
  }

  _request(peer, method, route, body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          host: peer.address,
          port: peer.port,
          method,
          path: API + route,
          agent: this.agent,
          timeout: NETWORK.REQUEST_TIMEOUT_MS,
          headers: {
            [HEADER]: NETWORK.APP_ID,
            ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          },
        },
        (res) => {
          readJson(res)
            .then((json) => (res.statusCode === 200 ? resolve(json) : reject(new Error(`HTTP ${res.statusCode}`))))
            .catch(reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end(payload);
    });
  }

  /**
   * Downloads a file (up to maxBytes) from a computer; rejects on any non-200 answer. Gives up quickly on a
   * computer that can't be connected to or doesn't start answering, and stops at once if `signal` is aborted.
   */
  _requestBinary(peer, route, maxBytes, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new Error('cancelled'));
      let startTimer = null;
      const done = (fn, value) => {
        clearTimeout(startTimer);
        if (signal) signal.removeEventListener('abort', onAbort);
        fn(value);
      };
      const req = http.request(
        {
          host: peer.address,
          port: peer.port,
          method: 'GET',
          path: API + route,
          agent: this.agent,
          timeout: NETWORK.REQUEST_TIMEOUT_MS * 4,
          headers: { [HEADER]: NETWORK.APP_ID },
        },
        (res) => {
          clearTimeout(startTimer);
          if (res.statusCode !== 200) {
            res.resume();
            done(reject, new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size > maxBytes) req.destroy(new Error('file too large'));
            else chunks.push(c);
          });
          res.on('end', () => done(resolve, Buffer.concat(chunks)));
          res.on('error', (err) => done(reject, err));
        },
      );
      const onAbort = () => req.destroy(new Error('cancelled'));
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      // From asking until the first answer: connecting (3 s) plus the other computer starting to reply (5 s in all).
      startTimer = setTimeout(() => req.destroy(new Error('no answer')), NETWORK.RESPONSE_TIMEOUT_MS);
      req.once('socket', (socket) => {
        if (!socket.connecting) return;
        const connectTimer = setTimeout(() => req.destroy(new Error('could not connect')), NETWORK.CONNECT_TIMEOUT_MS);
        socket.once('connect', () => clearTimeout(connectTimer));
        req.once('close', () => clearTimeout(connectTimer));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (err) => done(reject, err));
      req.end();
    });
  }

  // ---------- GIFs and attached files ----------

  /** Adds a file to the wanted list, keeping when it was first wanted (so "couldn't load" is judged from the start). */
  _want(hash, entry) {
    if (!this.wanted.has(hash)) this.wanted.set(hash, { ...entry, since: Date.now(), failed: false });
  }

  /** null if there's nothing to wait for, 'loading' while it's on its way, 'failed' once no computer has supplied it for a while. */
  blobState(hash) {
    const w = this.wanted.get(hash);
    return !w ? null : w.failed ? 'failed' : 'loading';
  }

  /** The Retry button: starts the wait afresh, forgets which computers were being skipped, and asks again now. */
  retryBlob(hash) {
    const w = this.wanted.get(hash);
    if (!w) return;
    w.since = Date.now();
    w.failed = false;
    this._blobTried?.delete(hash);
    for (const peer of this.peerMap.values()) peer.blobSkipUntil = 0;
    this._fetchBlobsSoon();
    this.emit('blobs-changed');
  }

  /** Marks files that have been wanted for too long as failed, and says so. */
  _sweepFailedBlobs() {
    let any = false;
    for (const w of this.wanted.values()) {
      if (!w.failed && Date.now() - w.since >= NETWORK.BLOB_FAIL_MS) {
        w.failed = true;
        any = true;
      }
    }
    if (any) this.emit('blobs-changed');
  }

  /** Notes which files just put in the Drop box this computer doesn't have yet, and goes to get them. */
  _wantDropFiles(records) {
    if (!this.blobs.files || !this.dropRetentionDays) return;
    let any = false;
    for (const r of records) {
      if (r.type !== 'drop' || this.blobs.files.store.has(r.file.hash)) continue;
      if (dayOf(r.createdAt) < dayOf(Date.now() - this.dropRetentionDays * 86400000)) continue;
      this._want(r.file.hash, { kind: 'files', createdAt: r.createdAt, days: this.dropRetentionDays });
      any = true;
    }
    if (any) this._fetchBlobsSoon();
  }

  /** Notes which of these messages' GIFs and files this computer doesn't have yet, and goes to get them. */
  _wantBlobs(messages) {
    const cutoff = this.fileRetentionDays ? dayOf(Date.now() - this.fileRetentionDays * 86400000) : null;
    let any = false;
    for (const m of messages) {
      if (this.shouldFetch && !this.shouldFetch(m)) continue;
      if (m.gif && this.blobs.gifs && !this.blobs.gifs.store.has(m.gif.hash)) {
        this._want(m.gif.hash, { kind: 'gifs', createdAt: m.createdAt });
        any = true;
      }
      if (m.attachments && this.blobs.files && !(cutoff && dayOf(m.createdAt) < cutoff)) {
        for (const a of m.attachments) {
          if (this.blobs.files.store.has(a.hash)) continue;
          this._want(a.hash, { kind: 'files', createdAt: m.createdAt });
          any = true;
        }
      }
    }
    if (any) this._fetchBlobsSoon();
  }

  _fetchBlobsSoon() {
    // A download round is already running: put any idle helper to work on what's just been asked for.
    if (this._fetchingBlobs) {
      this._startBlobWorkers();
      return;
    }
    if (this._fetchBlobsTimer || this.stopped) return;
    this._fetchBlobsTimer = setTimeout(() => {
      this._fetchBlobsTimer = null;
      this._fetchBlobs();
    }, 150);
  }

  /**
   * Fetches everything still missing, a few at a time. Whatever can't be found is retried on the next tick,
   * and anything that becomes wanted while this is running is started straight away.
   */
  async _fetchBlobs() {
    if (this._fetchingBlobs || this.stopped) return;
    this._fetchingBlobs = true;
    this._blobTried = new Set(); // each is tried once per round; failures wait for the next tick
    this._blobWorkers = 0;
    await new Promise((resolve) => {
      this._blobRoundDone = () => {
        this._fetchingBlobs = false; // at once, so anything wanted from here on starts a fresh round
        resolve();
      };
      this._startBlobWorkers();
      if (!this._blobWorkers) this._blobRoundDone();
    });
  }

  /** Starts helpers (up to BLOB_PARALLEL) for as long as there is something wanted that hasn't been tried this round. */
  _startBlobWorkers() {
    const next = () => {
      for (const entry of this.wanted) if (!this._blobTried.has(entry[0])) return entry;
      return null;
    };
    while (this._blobWorkers < NETWORK.BLOB_PARALLEL && !this.stopped && next()) {
      this._blobWorkers++;
      (async () => {
        try {
          for (let entry = next(); entry && !this.stopped; entry = next()) {
            this._blobTried.add(entry[0]);
            await this._fetchOne(...entry);
          }
        } finally {
          if (--this._blobWorkers === 0) this._blobRoundDone();
        }
      })();
    }
  }

  /**
   * Gets one GIF or file by asking every computer at the same time and taking the first good answer, so a
   * computer that has gone to sleep or left the network can't hold it up.
   */
  async _fetchOne(hash, { kind, createdAt, days }) {
    const blob = this.blobs[kind];
    const keepDays = days || this.fileRetentionDays;
    const cutoff = keepDays ? dayOf(Date.now() - keepDays * 86400000) : null;
    if (!blob || blob.store.has(hash) || (kind === 'files' && cutoff && dayOf(createdAt) < cutoff)) {
      this.wanted.delete(hash); // already here, or too old to be worth fetching now
      return;
    }
    const now = Date.now();
    const peers = [...this.peerMap.values()].filter((p) => !(p.blobSkipUntil > now));
    if (!peers.length) return;
    const cancel = new AbortController();
    try {
      const { peer, file } = await Promise.any(
        peers.map(async (peer) => {
          const file = await this._download(peer, `/${kind}/${hash}`, blob.max, cancel.signal);
          blob.store.addVerified(hash, file); // throws unless it's exactly the file that was asked for
          return { peer, file };
        }),
      );
      cancel.abort();
      this.wanted.delete(hash);
      this.log.info(`received a ${kind === 'gifs' ? 'GIF' : 'file'} (${Math.round(file.length / 1024)} KB) from ${peer.host || peer.address}`);
    } catch {
      // none of them has it yet; it stays wanted and is tried again
    }
  }

  /** One download from one computer. A computer that can't be reached is left alone for a while; one that simply lacks the file isn't. */
  async _download(peer, route, maxBytes, signal) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._requestBinary(peer, route, maxBytes, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        // A kept-alive connection the other side had just closed: try again on a fresh one.
        if (attempt === 0 && /ECONNRESET|socket hang up/.test(`${err.code} ${err.message}`)) continue;
        if (!/^HTTP /.test(err.message)) peer.blobSkipUntil = Date.now() + NETWORK.PEER_SKIP_MS;
        throw err;
      }
    }
  }

  // ---------- Sync ----------

  async syncWith(peer) {
    if (peer.syncing) {
      peer.resync = true;
      return;
    }
    peer.syncing = true;
    peer.lastSyncAttempt = Date.now();
    try {
      do {
        peer.resync = false;
        await this._syncOnce(peer);
      } while (peer.resync && !this.stopped);
      this._markReachable(peer, true);
    } catch (err) {
      this._markReachable(peer, false);
      this.log.warn(`sync with ${peer.host || peer.address} failed: ${err.message}`);
    } finally {
      peer.syncing = false;
    }
  }

  async _syncOnce(peer) {
    for (const c of this.collections) {
      if (this._peerHas(peer, c)) await this._syncCollection(peer, c);
    }
  }

  async _syncCollection(peer, c) {
    const remote = await this._request(peer, 'GET', `${c.prefix}/digest`);
    const local = c.store.digest();
    peer.known[c.name] = { count: remote.count, hash: remote.hash };
    if (remote.count === local.count && remote.hash === local.hash) return;

    const remoteDays = remote.days && typeof remote.days === 'object' ? remote.days : {};
    const mismatched = [];
    const theyLack = [];
    for (const day of new Set([...Object.keys(remoteDays), ...Object.keys(local.days)])) {
      if (remoteDays[day] === local.days[day]) continue;
      if (c.store.isOldDay(day)) continue; // past the tidy-up cutoff: not ours to exchange any more
      if (remoteDays[day] === undefined) theyLack.push(day);
      else mismatched.push(day);
    }

    // Download what we're missing.
    const theirIds = new Set();
    for (const days of chunk(mismatched, 200)) {
      const { ids } = await this._request(peer, 'POST', `${c.prefix}/ids`, { days });
      if (Array.isArray(ids)) ids.forEach((id) => theirIds.add(id));
    }
    const missing = [...theirIds].filter((id) => !c.store.has(id));
    for (const ids of chunk(missing, NETWORK.CHUNK)) {
      const response = await this._request(peer, 'POST', `${c.prefix}/get`, { ids });
      if (Array.isArray(response[c.key])) c.store.add(response[c.key]);
    }

    // Upload what they're missing.
    const toSend = c.store
      .idsForDays(mismatched)
      .filter((id) => !theirIds.has(id))
      .concat(c.store.idsForDays(theyLack));
    for (const ids of chunk(toSend, NETWORK.CHUNK)) {
      await this._request(peer, 'POST', `${c.prefix}/push`, { from: this._self(), [c.key]: c.store.getWire(ids) });
    }
    if (missing.length || toSend.length) {
      this.log.info(`synced ${c.name} with ${peer.host || peer.address}: got ${missing.length}, sent ${toSend.length}`);
    }
  }

  _maybeSync(peer) {
    const stale = this.collections.some((c) => {
      if (!this._peerHas(peer, c)) return false;
      const known = peer.known[c.name];
      const local = c.store.summary();
      return !known || known.count !== local.count || known.hash !== local.hash;
    });
    if (!stale) return;
    if (peer.syncing) {
      peer.resync = true;
      return;
    }
    if (Date.now() - (peer.lastSyncAttempt || 0) < this.minSyncGapMs) return;
    this.syncWith(peer);
  }

  // ---------- Discovery ----------

  _self() {
    const profile = this.getProfile();
    return { id: this.peerId, dept: profile.department, host: profile.host, port: this.tcpPort, ver: this.version };
  }

  /** Resolves once the discovery socket is listening, or has failed and a retry is scheduled. */
  _startUdp() {
    return new Promise((resolve) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (buf, rinfo) => this._onBeacon(buf, rinfo));
      sock.on('error', (err) => {
        this.log.error('discovery socket error', err.message);
        try {
          sock.close();
        } catch {
          // already closed
        }
        if (this.udp === sock) this.udp = null;
        if (!this.stopped) setTimeout(() => this._startUdp(), 15000);
        resolve();
      });
      sock.bind(this.udpPort, this.bindAddress, () => {
        if (this.broadcast) sock.setBroadcast(true);
        this.udp = sock;
        this._sendBeacon('hello');
        resolve();
      });
    });
  }

  _beacon(type) {
    const beacon = { app: NETWORK.APP_ID, v: NETWORK.PROTOCOL, type, ...this._self() };
    for (const c of this.collections) {
      const { count, hash } = c.store.summary();
      beacon[`${c.beacon}count`] = count;
      beacon[`${c.beacon}hash`] = hash;
    }
    return Buffer.from(JSON.stringify(beacon));
  }

  _sendBeacon(type, target) {
    if (!this.udp) return;
    const buf = this._beacon(type);
    const send = (address, port) => this.udp.send(buf, port, address, () => {});
    if (target) return send(target.address, target.port);
    if (this.broadcast) broadcastAddresses().forEach((a) => send(a, this.udpPort));
    this.staticPeers.forEach((p) => send(p.address, p.udpPort || this.udpPort));
  }

  announce() {
    if (this._beaconSoonTimer) return;
    this._beaconSoonTimer = setTimeout(() => {
      this._beaconSoonTimer = null;
      this._sendBeacon('hello');
    }, 800);
  }

  _onBeacon(buf, rinfo) {
    let b;
    try {
      b = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!b || b.app !== NETWORK.APP_ID || b.v !== NETWORK.PROTOCOL || b.id === this.peerId) return;
    if (!isPrivateAddress(rinfo.address)) return;
    const peer = this._seePeer(b, rinfo.address);
    if (!peer) return;
    for (const c of this.collections) {
      const count = b[`${c.beacon}count`];
      const hash = b[`${c.beacon}hash`];
      if (Number.isInteger(count) && typeof hash === 'string') peer.known[c.name] = { count, hash };
    }
    if (b.type === 'hello') this._sendBeacon('reply', { address: rinfo.address, port: rinfo.port });
    this._maybeSync(peer);
  }

  _seePeer(info, rawAddress) {
    if (!info || typeof info.id !== 'string' || info.id === this.peerId || info.id.length > 64) return null;
    if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return null;
    const address = normaliseAddress(rawAddress);
    const dept = DEPARTMENT_IDS.includes(info.dept) ? info.dept : null;
    const host = typeof info.host === 'string' ? info.host.slice(0, 64) : '';
    const ver = typeof info.ver === 'string' && /^[0-9A-Za-z.\-+]{1,24}$/.test(info.ver) ? info.ver : null;
    let peer = this.peerMap.get(info.id);
    const isNew = !peer;
    if (!peer) {
      // known: the latest fingerprint we've heard for each collection it syncs.
      peer = { id: info.id, reachable: null, known: {} };
      this.peerMap.set(info.id, peer);
    }
    const changed =
      isNew || peer.address !== address || peer.port !== info.port || peer.dept !== dept || peer.host !== host || peer.ver !== ver;
    Object.assign(peer, { address, port: info.port, dept, host, ver, lastSeen: Date.now() });
    if (isNew) peer.blobSkipUntil = 0; // a computer that has just come (back) on the network is worth asking again
    if (changed) {
      if (isNew) this.log.info(`found ${peer.host} (${peer.address}:${peer.port})`);
      this.emit('peers', this.peers());
    }
    return peer;
  }

  _markReachable(peer, ok) {
    if (peer.reachable === ok) return;
    peer.reachable = ok;
    this.emit('peers', this.peers());
  }

  _tick() {
    const now = Date.now();
    let removed = false;
    for (const [id, peer] of this.peerMap) {
      if (now - peer.lastSeen > NETWORK.PEER_TIMEOUT_MS) {
        this.peerMap.delete(id);
        removed = true;
      }
    }
    if (removed) this.emit('peers', this.peers());
    this._sendBeacon('hello');
    for (const peer of this.peerMap.values()) this._maybeSync(peer);
    this._sweepFailedBlobs();
    if (this.wanted.size) this._fetchBlobs();
  }
}

function parseStaticPeer(entry) {
  if (typeof entry !== 'string' || !entry.trim()) return null;
  const [address, port] = entry.trim().split(':');
  return { address, udpPort: port ? Number(port) : null };
}

function readJson(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on('data', (c) => {
      size += c.length;
      if (size > NETWORK.MAX_BODY_BYTES) {
        stream.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    stream.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    stream.on('error', reject);
  });
}

module.exports = { Network, isPrivateAddress, broadcastAddresses };
