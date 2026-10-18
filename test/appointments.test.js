'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { MessageStore } = require('../src/main/store');
const { AppointmentLog, sanitizeAppointmentRecord } = require('../src/main/appointments');
const { Network } = require('../src/main/network');
const { tempDir, waitFor } = require('./helpers');

const COLUMNS = ['consult1', 'consult2', 'procedures'];
const DAY = '2026-10-20';
let clock = Date.UTC(2026, 9, 18, 8, 0, 0);

const appt = (o = {}) => ({
  type: 'appt',
  id: crypto.randomUUID(),
  day: DAY,
  col: 'consult1',
  start: 8 * 60 + 30,
  len: 30,
  patient: 'Bella',
  client: 'Smith',
  notes: 'Vaccination',
  color: 'green',
  by: 'reception',
  byName: 'Thandi',
  host: 'REC-PC',
  createdAt: (clock += 1000),
  ...o,
});
const change = (target, o = {}) => ({ ...appt(o), type: 'change', target });
const status = (target, s, o = {}) => ({
  type: 'status',
  id: crypto.randomUUID(),
  target,
  status: s,
  by: 'reception',
  byName: '',
  host: 'REC-PC',
  createdAt: (clock += 1000),
  ...o,
});

const newLog = (dir = tempDir()) => new AppointmentLog(dir, { columns: COLUMNS }).load();

test('a valid appointment is stored and shown on its day', () => {
  const log = newLog();
  const [a] = log.add([appt()], { local: true });
  assert.ok(a);
  const [shown] = log.forDay(DAY);
  assert.equal(shown.patient, 'Bella');
  assert.equal(shown.start, 510);
  assert.equal(shown.len, 30);
  assert.equal(shown.color, 'green');
  assert.deepEqual(log.forDay('2026-10-21'), []);
});

test('bad appointments are refused', () => {
  const ok = appt();
  assert.ok(sanitizeAppointmentRecord(ok, COLUMNS));
  const bad = (change) => sanitizeAppointmentRecord({ ...ok, ...change }, COLUMNS);
  assert.equal(bad({ col: 'surgery' }), null, 'unknown column');
  assert.equal(bad({ color: 'purple' }), null, 'unknown colour');
  assert.equal(bad({ day: '2026-02-30' }), null, 'a day that does not exist');
  assert.equal(bad({ day: '20-10-2026' }), null, 'wrong date format');
  assert.equal(bad({ start: 503 }), null, 'not on a 5-minute step');
  assert.equal(bad({ len: 0 }), null, 'no length');
  assert.equal(bad({ len: 7 }), null, 'length not on a 5-minute step');
  assert.equal(bad({ start: 1430, len: 30 }), null, 'runs past midnight');
  assert.equal(bad({ len: 13 * 60 }), null, 'longer than the longest allowed');
  assert.equal(bad({ patient: '   ' }), null, 'no patient name');
  assert.equal(bad({ patient: 'x'.repeat(81) }), null, 'patient name too long');
  assert.equal(bad({ notes: 'x'.repeat(301) }), null, 'notes too long');
  assert.equal(bad({ client: 42 }), null, 'client must be text');
  assert.equal(bad({ by: 'nobody' }), null, 'unknown department');
  assert.equal(bad({ id: 'x' }), null, 'bad id');
  assert.equal(bad({ createdAt: 5 }), null, 'timestamp out of range');
  // Optional text may be left empty and is trimmed.
  const tidy = bad({ patient: '  Rex ', client: '', notes: '' });
  assert.equal(tidy.patient, 'Rex');
  assert.equal(tidy.client, '');
});

test('the newest change wins, whatever order records arrive in', () => {
  const log = newLog();
  const a = appt();
  const first = change(a.id, { col: 'consult2', start: 600, patient: 'Bella (first edit)' });
  const second = change(a.id, { col: 'procedures', start: 660, color: 'pink', patient: 'Bella (second edit)', by: 'principal', byName: 'Dr K' });
  // The newer edit arrives before the older one, and before the appointment itself.
  log.add([second]);
  log.add([first]);
  assert.equal(log.get(a.id), null, 'nothing to show until the appointment itself arrives');
  log.add([a]);
  const shown = log.get(a.id);
  assert.equal(shown.patient, 'Bella (second edit)');
  assert.equal(shown.col, 'procedures');
  assert.equal(shown.start, 660);
  assert.equal(shown.color, 'pink');
  assert.equal(shown.editedBy, 'principal');
  assert.equal(shown.editedByName, 'Dr K');
  assert.equal(shown.by, 'reception', 'the booker is still who made it');
});

test('a change can move an appointment to another day', () => {
  const log = newLog();
  const [a] = log.add([appt()]);
  log.add([change(a.id, { day: '2026-10-22' })]);
  assert.deepEqual(log.forDay(DAY), []);
  assert.equal(log.forDay('2026-10-22').length, 1);
});

test('removing hides an appointment and restoring brings it back', () => {
  const log = newLog();
  const [a] = log.add([appt()]);
  const [removed] = log.add([status(a.id, 'removed')]);
  assert.deepEqual(log.forDay(DAY), []);
  assert.equal(log.get(a.id), null);
  log.add([status(a.id, 'restored', { createdAt: removed.createdAt + 1 })]);
  assert.equal(log.forDay(DAY).length, 1);
  // Removing again after the undo works too.
  log.add([status(a.id, 'removed', { createdAt: removed.createdAt + 2 })]);
  assert.deepEqual(log.forDay(DAY), []);
});

test('a day lists appointments in time order', () => {
  const log = newLog();
  log.add([appt({ start: 600, patient: 'C', col: 'consult2' }), appt({ start: 480, patient: 'A' }), appt({ start: 540, patient: 'B', col: 'procedures' })]);
  assert.deepEqual(log.forDay(DAY).map((x) => x.patient), ['A', 'B', 'C']);
});

test('conflict() finds an overlap in the same column only', () => {
  const log = newLog();
  const [a] = log.add([appt({ start: 600, len: 30 })]); // 10:00 - 10:30, consult1
  const slot = (o) => ({ day: DAY, col: 'consult1', start: 600, len: 15, ...o });
  assert.equal(log.conflict(slot({ start: 615 })).id, a.id, 'inside it');
  assert.equal(log.conflict(slot({ start: 595 })).id, a.id, 'runs into the start');
  assert.equal(log.conflict(slot({ start: 585, len: 60 })).id, a.id, 'covers it');
  assert.equal(log.conflict(slot({ start: 630 })), null, 'starts exactly when it ends');
  assert.equal(log.conflict(slot({ start: 585, len: 15 })), null, 'ends exactly when it starts');
  assert.equal(log.conflict(slot({ col: 'consult2' })), null, 'another column');
  assert.equal(log.conflict(slot({ day: '2026-10-21' })), null, 'another day');
  assert.equal(log.conflict(slot({ start: 615 }), a.id), null, 'ignoring the appointment being edited');
  log.add([status(a.id, 'removed')]);
  assert.equal(log.conflict(slot({ start: 615 })), null, 'removed ones do not count');
});

test('appointments survive a restart, including edits and removals', () => {
  const dir = tempDir();
  const log = newLog(dir);
  const [a, b] = log.add([appt({ patient: 'Keep' }), appt({ patient: 'Gone', start: 720 })]);
  log.add([change(a.id, { patient: 'Kept (edited)' }), status(b.id, 'removed')]);
  const again = newLog(dir);
  assert.deepEqual(again.forDay(DAY).map((x) => x.patient), ['Kept (edited)']);
  assert.equal(again.count, 4);
});

test('a column the clinic does not have is refused when loading too', () => {
  const dir = tempDir();
  const wide = new AppointmentLog(dir, { columns: [...COLUMNS, 'surgery'] }).load();
  wide.add([appt({ col: 'surgery' }), appt()]);
  const narrow = new AppointmentLog(dir, { columns: COLUMNS }).load();
  assert.equal(narrow.forDay(DAY).length, 1);
});

// ---------- syncing between computers ----------

function makeNode(name, dept, { appointments = true } = {}) {
  const dir = tempDir();
  const store = new MessageStore(dir).load();
  const log = appointments ? newLog(dir) : null;
  const net = new Network({
    store,
    appointments: log,
    peerId: `peer-${name}`,
    getProfile: () => ({ department: dept, host: name }),
    bindAddress: '127.0.0.1',
    udpPort: 0,
    tcpPorts: [0],
    beaconIntervalMs: 150,
    minSyncGapMs: 100,
  });
  return { name, store, log, net };
}

test('appointments, edits and removals reach every computer; computers without a schedule are never asked', async (t) => {
  const reception = makeNode('REC', 'reception');
  const vets = makeNode('VET', 'clinical');
  const older = makeNode('OLD', 'principal', { appointments: false });
  const nodes = [reception, vets, older];

  let appointmentRequests = 0;
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  older.net.server.prependListener('request', (req) => {
    if (req.url.includes('/appointments/')) appointmentRequests++;
  });
  for (const n of nodes) {
    n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
  }

  const [a] = reception.log.add([appt()], { local: true });
  reception.net.pushNow([a], 'appointments');
  await waitFor(() => vets.log.get(a.id));
  assert.equal(vets.log.get(a.id).patient, 'Bella');

  // The vet moves it; reception sees the move.
  const [moved] = vets.log.add([change(a.id, { col: 'procedures', start: 700, by: 'clinical' })], { local: true });
  vets.net.pushNow([moved], 'appointments');
  await waitFor(() => reception.log.get(a.id).col === 'procedures');
  assert.equal(reception.log.get(a.id).start, 700);

  // Reception removes it; the vet's board follows.
  const [removed] = reception.log.add([status(a.id, 'removed')], { local: true });
  reception.net.pushNow([removed], 'appointments');
  await waitFor(() => vets.log.get(a.id) === null);

  assert.equal(appointmentRequests, 0, 'a computer that does not announce appointments is never asked for them');
  assert.equal(older.store.count, 0);
});

test('a computer that was switched off catches up when it comes back', async (t) => {
  const reception = makeNode('REC', 'reception');
  const [a, b] = reception.log.add([appt({ patient: 'One' }), appt({ patient: 'Two', start: 600 })], { local: true });
  reception.log.add([change(b.id, { patient: 'Two (edited)', start: 615 })], { local: true });

  const late = makeNode('LATE', 'clinical');
  const nodes = [reception, late];
  for (const n of nodes) {
    await n.net.start();
    n.udpPort = n.net.udp.address().port;
  }
  t.after(() => nodes.forEach((n) => n.net.stop()));
  for (const n of nodes) {
    n.net.staticPeers = nodes.filter((o) => o !== n).map((o) => ({ address: '127.0.0.1', udpPort: o.udpPort }));
  }
  await waitFor(() => late.log.count === 3);
  assert.deepEqual(late.log.forDay(DAY).map((x) => `${x.patient}@${x.start}`), ['One@510', 'Two (edited)@615']);
  assert.ok(a);
});
