'use strict';

// The appointment schedule's records. Like everything else the app shares, they are immutable records
// in an append-only log that computers copy to each other. Three kinds:
//  - type 'appt':   a new appointment
//  - type 'change': a replacement for an appointment's details (the newest change wins, so two people
//                   editing at once simply end with whichever edit was made last)
//  - type 'status': 'removed' or 'restored' (undo), again newest wins

const { DEPARTMENT_IDS, APPT_COLUMN_IDS, APPT_COLORS, APPT_MIN_STEP, APPT_MAX_LENGTH, LIMITS } = require('./constants');
const { RecordLog, compareRecords, validId, validTime, validHost } = require('./store');

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATUSES = ['removed', 'restored'];

/** A calendar day written YYYY-MM-DD (the clinic's own local date), or false. */
function validDay(day) {
  const m = typeof day === 'string' ? DAY.exec(day) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2020 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const text = (value, max) => {
  const v = value ?? '';
  return typeof v === 'string' && v.trim().length <= max ? v.trim() : null;
};

/** The details of an appointment, cleaned, or null if anything is wrong. Times are minutes after midnight. */
function sanitizeDetails(r, columns = APPT_COLUMN_IDS) {
  const { day, col, start, len, color } = r;
  if (!validDay(day) || !columns.includes(col) || !APPT_COLORS.includes(color)) return null;
  const onStep = (n) => Number.isInteger(n) && n % APPT_MIN_STEP === 0;
  if (!onStep(start) || !onStep(len) || start < 0 || len < APPT_MIN_STEP || len > APPT_MAX_LENGTH || start + len > 1440) return null;
  const patient = text(r.patient, LIMITS.APPT_PATIENT);
  const client = text(r.client, LIMITS.APPT_CLIENT);
  const notes = text(r.notes, LIMITS.APPT_NOTES);
  if (!patient || client === null || notes === null) return null;
  return { day, col, start, len, patient, client, notes, color };
}

function sanitizeAppointmentRecord(r, columns = APPT_COLUMN_IDS) {
  if (!r || typeof r !== 'object' || !validId(r.id)) return null;
  const host = r.host ?? '';
  const byName = r.byName ?? '';
  if (!validHost(host) || !validTime(r.createdAt) || !DEPARTMENT_IDS.includes(r.by)) return null;
  if (typeof byName !== 'string' || byName.length > LIMITS.AUTHOR) return null;
  const base = { v: 1, id: r.id, by: r.by, byName: byName.trim(), host, createdAt: Math.floor(r.createdAt) };

  if (r.type === 'appt' || r.type === 'change') {
    const details = sanitizeDetails(r, columns);
    if (!details) return null;
    if (r.type === 'appt') return { ...base, type: 'appt', ...details };
    if (!validId(r.target)) return null;
    return { ...base, type: 'change', target: r.target, ...details };
  }
  if (r.type === 'status' && validId(r.target) && STATUSES.includes(r.status)) {
    return { ...base, type: 'status', target: r.target, status: r.status };
  }
  return null;
}

const FIELDS = ['day', 'col', 'start', 'len', 'patient', 'client', 'notes', 'color'];

class AppointmentLog extends RecordLog {
  /** `columns`: the ids of the schedule's columns (from the brand); records for any other column are refused. */
  constructor(dir, { columns = APPT_COLUMN_IDS } = {}) {
    super(dir, 'appointments.jsonl', (r) => sanitizeAppointmentRecord(r, columns));
    this.columns = columns;
    this.appts = new Map();
    this.changes = new Map(); // target id -> change records
    this.statuses = new Map(); // target id -> status records
  }

  _reset() {
    this.appts = new Map();
    this.changes = new Map();
    this.statuses = new Map();
  }

  _track(record) {
    if (record.type === 'appt') {
      this.appts.set(record.id, record);
      return;
    }
    const map = record.type === 'change' ? this.changes : this.statuses;
    const list = map.get(record.target);
    if (list) list.push(record);
    else map.set(record.target, [record]);
  }

  _latest(map, id) {
    let latest = null;
    for (const r of map.get(id) || []) if (!latest || compareRecords(r, latest) > 0) latest = r;
    return latest;
  }

  isRemoved(id) {
    const s = this._latest(this.statuses, id);
    return Boolean(s && s.status === 'removed');
  }

  /** The appointment as it stands now (its newest details), or null if it is unknown or removed. */
  get(id) {
    const appt = this.appts.get(id);
    if (!appt || this.isRemoved(id)) return null;
    const change = this._latest(this.changes, id);
    const details = {};
    for (const f of FIELDS) details[f] = (change || appt)[f];
    return {
      id,
      ...details,
      by: appt.by,
      byName: appt.byName,
      createdAt: appt.createdAt,
      // Who last changed it, when it has been changed.
      editedBy: change ? change.by : null,
      editedByName: change ? change.byName : '',
      updatedAt: change ? change.createdAt : appt.createdAt,
    };
  }

  /** Every appointment on a day, earliest first. */
  forDay(day) {
    const list = [];
    for (const id of this.appts.keys()) {
      const a = this.get(id);
      if (a && a.day === day) list.push(a);
    }
    return list.sort((a, b) => a.start - b.start || a.col.localeCompare(b.col) || a.createdAt - b.createdAt);
  }

  /** An appointment already in that column and time (other than `exceptId`), or null. */
  conflict({ day, col, start, len }, exceptId = null) {
    for (const a of this.forDay(day)) {
      if (a.id !== exceptId && a.col === col && a.start < start + len && start < a.start + a.len) return a;
    }
    return null;
  }
}

module.exports = { AppointmentLog, sanitizeAppointmentRecord, sanitizeDetails, validDay };
