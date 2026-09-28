'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  department: null,
  author: '',
  sound: true,
  autoStart: true,
  iconPosition: null,
  lastReadAt: 0,
  firstRunAt: null,
  peerId: null,
  peerHost: null,
  // Optional extra computers to contact directly, e.g. ["192.168.1.20"].
  // Only needed if some computers are on a different network segment.
  staticPeers: [],
};

/** Small JSON settings file for this computer. */
class Config {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.data = { ...DEFAULTS };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      // first run, or unreadable file: start from defaults
    }
  }

  get(key) {
    return this.data[key];
  }

  set(values) {
    Object.assign(this.data, values);
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Config };
