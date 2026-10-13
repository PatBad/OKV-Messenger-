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

// Messages and GIFs older than this are moved to the archive folder automatically. The same rule
// runs on every computer, so they all agree on what's still "live" and stay in sync.
const RETENTION_DAYS = 14;

// Files and images attached to messages are kept (and shown in the Media tab) for this long, then archived.
const ATTACHMENT_RETENTION_DAYS = 7;

// How long after sending a message its sender may still edit it.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

// Buttons offered above the message box until someone changes them in Settings.
const DEFAULT_QUICK_MESSAGES = [
  { text: 'Client has arrived', to: 'clinical', urgent: false },
  { text: 'Estimate is ready', to: 'reception', urgent: false },
  { text: 'Lab results are back', to: 'clinical', urgent: false },
  { text: 'Need a hand in theatre', to: 'clinical', urgent: true },
  { text: 'Call me when you have a minute', to: 'all', urgent: false },
];
const MAX_QUICK_MESSAGES = 8;

// A GIF message carries this as its text, so computers on versions that predate GIFs
// (which reject messages without text) still accept it and show "[GIF]".
const GIF_PLACEHOLDER = '[GIF]';

// Likewise for a message that is only attachments (older versions need some text).
const ATTACH_PLACEHOLDER = '[Attachment]';

// Emoji reactions offered on messages, in the order they're shown.
// Entries in :colons: are custom pictures in assets/reactions (see the page's CUSTOM_REACTIONS).
const REACTIONS = ['👌', '👍', '😂', '😅', ':dead-inside:'];

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
  REMINDER: 1000,
  PIN: 300,
  // Largest GIF that can be sent (computers keep every GIF that's sent). GIPHY's search results are often
  // 4-6 MB, so this matches the limit for attached files.
  GIF_BYTES: 15 * 1024 * 1024,
  // Attached files and images.
  FILE_BYTES: 15 * 1024 * 1024,
  MAX_ATTACHMENTS: 5,
  ATTACH_TOTAL_BYTES: 40 * 1024 * 1024,
  FILE_NAME: 120,
  AUTHOR: 40,
  HOST: 64,
  // Timestamps outside this window are treated as corrupt.
  MIN_TS: Date.UTC(2020, 0, 1),
  MAX_TS: Date.UTC(2100, 0, 1),
};

module.exports = {
  DEPARTMENTS,
  DEPARTMENT_IDS,
  TO_ALL,
  GIF_PLACEHOLDER,
  ATTACH_PLACEHOLDER,
  REACTIONS,
  RETENTION_DAYS,
  ATTACHMENT_RETENTION_DAYS,
  EDIT_WINDOW_MS,
  DEFAULT_QUICK_MESSAGES,
  MAX_QUICK_MESSAGES,
  NETWORK,
  LIMITS,
};
