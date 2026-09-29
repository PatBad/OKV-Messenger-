'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const { EventEmitter } = require('events');
const { NETWORK, DEPARTMENT_IDS } = require('./constants');

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
    // What gets synced. Messages keep the original routes so computers still
    // on 1.0.x carry on syncing with us; deletions (added in 1.1) have their
    // own routes and are only exchanged with computers that announce them.
    this.collections = [{ name: 'messages', store, prefix: '', key: 'messages' }];
    if (deletions) this.collections.push({ name: 'deletions', store: deletions, prefix: '/deletions', key: 'records' });
    this.store = store;
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
  }

  async start() {
    await this._startHttp();
    await this._startUdp();
    this.timers.push(setInterval(() => this._tick(), this.beaconIntervalMs));
    return this;
  }

  stop() {
    this.stopped = true;
    this.timers.forEach(clearInterval);
    clearTimeout(this._beaconSoonTimer);
    for (const c of this.collections) c.store.off('added', this._onStoreAdded);
    if (this.udp) this.udp.close();
    if (this.server) this.server.close();
    this.agent.destroy();
  }

  /** Computers currently visible on the network. */
  peers() {
    return [...this.peerMap.values()]
      .map(({ id, dept, host, address, port, lastSeen, reachable }) => ({ id, dept, host, address, port, lastSeen, reachable }))
      .sort((a, b) => (a.host || '').localeCompare(b.host || ''));
  }

  /** Sends freshly written records (messages by default) straight to every known computer. */
  pushNow(records, name = 'messages') {
    const c = this._collection(name);
    for (const peer of this.peerMap.values()) {
      if (!this._peerHas(peer, c)) continue;
      this._request(peer, 'POST', `${c.prefix}/push`, { from: this._self(), [c.key]: records })
        .then(() => this._markReachable(peer, true))
        .catch(() => this._markReachable(peer, false)); // they'll pick it up on their next sync
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
    return { id: this.peerId, dept: profile.department, host: profile.host, port: this.tcpPort };
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
    const { count, hash } = this.store.summary();
    const beacon = { app: NETWORK.APP_ID, v: NETWORK.PROTOCOL, type, ...this._self(), count, hash };
    // Extra fields are ignored by 1.0.x computers.
    const deletions = this._collection('deletions');
    if (deletions) {
      const d = deletions.store.summary();
      Object.assign(beacon, { dcount: d.count, dhash: d.hash });
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
    if (Number.isInteger(b.count) && typeof b.hash === 'string') peer.known.messages = { count: b.count, hash: b.hash };
    if (Number.isInteger(b.dcount) && typeof b.dhash === 'string') peer.known.deletions = { count: b.dcount, hash: b.dhash };
    if (b.type === 'hello') this._sendBeacon('reply', { address: rinfo.address, port: rinfo.port });
    this._maybeSync(peer);
  }

  _seePeer(info, rawAddress) {
    if (!info || typeof info.id !== 'string' || info.id === this.peerId || info.id.length > 64) return null;
    if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return null;
    const address = normaliseAddress(rawAddress);
    const dept = DEPARTMENT_IDS.includes(info.dept) ? info.dept : null;
    const host = typeof info.host === 'string' ? info.host.slice(0, 64) : '';
    let peer = this.peerMap.get(info.id);
    const isNew = !peer;
    if (!peer) {
      // known: the latest fingerprint we've heard for each collection it syncs.
      peer = { id: info.id, reachable: null, known: {} };
      this.peerMap.set(info.id, peer);
    }
    const changed =
      isNew || peer.address !== address || peer.port !== info.port || peer.dept !== dept || peer.host !== host;
    Object.assign(peer, { address, port: info.port, dept, host, lastSeen: Date.now() });
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
