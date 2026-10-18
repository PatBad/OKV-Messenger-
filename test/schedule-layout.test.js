'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/renderer/schedule-layout');

test('times are written and read as HH:MM', () => {
  assert.equal(L.clock(0), '00:00');
  assert.equal(L.clock(510), '08:30');
  assert.equal(L.clock(1080), '18:00');
  assert.equal(L.parseClock('08:30'), 510);
  assert.equal(L.parseClock('8:05'), 485);
  assert.equal(L.parseClock('24:00'), null);
  assert.equal(L.parseClock('08:60'), null);
  assert.equal(L.parseClock('soon'), null);
});

test('snap rounds to the nearest row', () => {
  assert.equal(L.snap(507, 15), 510);
  assert.equal(L.snap(502, 15), 495);
  assert.equal(L.snap(503, 5), 505);
  assert.equal(L.snap(517, 30), 510);
  assert.equal(L.snap(526, 30), 540);
  assert.equal(L.clamp(5, 10, 20), 10);
  assert.equal(L.clamp(25, 10, 20), 20);
});

test('days move forward and back across month and year ends', () => {
  assert.equal(L.shiftDay('2026-10-18', 1), '2026-10-19');
  assert.equal(L.shiftDay('2026-10-31', 1), '2026-11-01');
  assert.equal(L.shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(L.shiftDay('2028-02-28', 1), '2028-02-29');
  assert.equal(L.dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

const item = (id, start, len) => ({ id, start, len });
const byId = (list) => Object.fromEntries(list.map((i) => [i.id, `${i.lane}/${i.lanes}`]));

test('appointments that do not overlap each get the full column', () => {
  const out = L.layoutColumn([item('a', 480, 30), item('b', 510, 30), item('c', 600, 15)]);
  assert.deepEqual(byId(out), { a: '0/1', b: '0/1', c: '0/1' });
});

test('two overlapping appointments sit side by side', () => {
  const out = L.layoutColumn([item('a', 480, 60), item('b', 500, 30)]);
  assert.deepEqual(byId(out), { a: '0/2', b: '1/2' });
});

test('lanes are reused once an earlier appointment has finished', () => {
  // a runs 8:00-9:00, b 8:15-8:45 (second lane), c 8:50-9:30 can use b's lane, d is on its own afterwards.
  const out = L.layoutColumn([item('a', 480, 60), item('b', 495, 30), item('c', 530, 40), item('d', 600, 30)]);
  assert.deepEqual(byId(out), { a: '0/2', b: '1/2', c: '1/2', d: '0/1' });
});

test('three at once need three lanes, and a later cluster is independent', () => {
  const out = L.layoutColumn([item('a', 480, 60), item('b', 490, 60), item('c', 500, 60), item('z', 700, 30)]);
  assert.deepEqual(byId(out), { a: '0/3', b: '1/3', c: '2/3', z: '0/1' });
});

test('findClash sees overlaps in the same column only', () => {
  const items = [
    { id: 'a', col: 'consult1', start: 600, len: 30 },
    { id: 'b', col: 'consult2', start: 600, len: 30 },
  ];
  assert.equal(L.findClash(items, 'consult1', 615, 30).id, 'a');
  assert.equal(L.findClash(items, 'consult1', 630, 15), null);
  assert.equal(L.findClash(items, 'procedures', 600, 30), null);
  assert.equal(L.findClash(items, 'consult1', 615, 30, 'a'), null);
});
