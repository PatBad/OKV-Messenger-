'use strict';

const DEPARTMENTS = [
  { id: 'principal', label: 'Practice Principal', color: '#7c3aed' },
  { id: 'clinical', label: 'Clinical Team', color: '#0d9488' },
  { id: 'reception', label: 'Reception', color: '#2563eb' },
  { id: 'other', label: 'Other', color: '#d97706' },
];

const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id);

// Recipient value meaning "every department".
const TO_ALL = 'all';

const NETWORK = {
  APP_ID: 'okv-messenger',
  PROTOCOL: 1,
  UDP_PORT: 41234,
  // The HTTP sync server takes the first free port in this range.
  TCP_PORTS: [41235, 41236, 41237, 41238, 41239],
  BEACON_INTERVAL_MS: 8000,
  PEER_TIMEOUT_MS: 45000,
  REQUEST_TIMEOUT_MS: 8000,
  MIN_SYNC_GAP_MS: 4000,
  MAX_BODY_BYTES: 8 * 1024 * 1024,
  CHUNK: 500,
};

const LIMITS = {
  TEXT: 4000,
  AUTHOR: 40,
  HOST: 64,
  // Timestamps outside this window are treated as corrupt.
  MIN_TS: Date.UTC(2020, 0, 1),
  MAX_TS: Date.UTC(2100, 0, 1),
};

module.exports = { DEPARTMENTS, DEPARTMENT_IDS, TO_ALL, NETWORK, LIMITS };
