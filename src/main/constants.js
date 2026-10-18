'use strict';

const brand = require('./brand');

// The departments come from the clinic's brand (brands/<id>/brand.json).
const DEPARTMENTS = brand.departments.map(({ id, label, hint }) => ({ id, label, hint }));

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

// Buttons offered above the message box until someone changes them in Settings (set per clinic in the brand).
const DEFAULT_QUICK_MESSAGES = brand.quickMessages.map((q) => ({ ...q }));
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
  APP_ID: brand.network.appId,
  PROTOCOL: 1,
  UDP_PORT: brand.network.udpPort,
  // The HTTP sync server takes the first free port in this range.
  TCP_PORTS: brand.network.tcpPorts,
  BEACON_INTERVAL_MS: 8000,
  PEER_TIMEOUT_MS: 45000,
  REQUEST_TIMEOUT_MS: 8000,
  MIN_SYNC_GAP_MS: 4000,
  MAX_BODY_BYTES: 8 * 1024 * 1024,
  CHUNK: 500,
};

// Medication requests (clients phoning in for repeat scripts / chronic medication). Reception logs them;
// the department below is alerted when a new one arrives, and whoever ticks one off notifies the department that logged it.
const MEDICATION_ALERT_DEPT = brand.medicationAlertDept;

// The appointment schedule: a whiteboard of today's (or any day's) appointments in a few columns, e.g. consulting rooms.
// Only brands with an "appointments" block in brand.json have one; for the others this is null and nothing is shown.
const toMinutes = (hhmm) => (hhmm === '24:00' ? 1440 : Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));
const APPOINTMENTS = brand.appointments
  ? {
      columns: brand.appointments.columns.map(({ id, label }) => ({ id, label })),
      dayStart: toMinutes(brand.appointments.dayStart), // minutes after midnight
      dayEnd: toMinutes(brand.appointments.dayEnd),
    }
  : null;
const APPT_COLUMN_IDS = APPOINTMENTS ? APPOINTMENTS.columns.map((c) => c.id) : [];
// A block's colour is only a label (no meaning built in); the page draws each one in light and dark mode.
const APPT_COLORS = ['green', 'blue', 'pink', 'yellow', 'grey'];
// Smallest step the schedule snaps to, and the longest appointment (minutes).
const APPT_MIN_STEP = 5;
const APPT_MAX_LENGTH = 12 * 60;

const LIMITS = {
  TEXT: 4000,
  REMINDER: 1000,
  PATIENT: 80,
  MEDICATION: 80,
  QUANTITY: 40,
  MAX_MEDICATIONS: 10,
  PIN: 300,
  APPT_PATIENT: 80,
  APPT_CLIENT: 40,
  APPT_NOTES: 300,
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
  MEDICATION_ALERT_DEPT,
  APPOINTMENTS,
  APPT_COLUMN_IDS,
  APPT_COLORS,
  APPT_MIN_STEP,
  APPT_MAX_LENGTH,
  NETWORK,
  LIMITS,
};
