'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { resizeBounds } = require('../src/main/geometry');

const area = { x: 0, y: 0, width: 1920, height: 1032 };
const min = { width: 340, height: 440 };
const start = { x: 1000, y: 200, width: 400, height: 640 };
const resize = (edge, dx, dy, a = area, s = start) => resizeBounds(edge, s, dx, dy, a, min);

test('dragging the right or bottom edge grows the window and keeps the top-left put', () => {
  assert.deepEqual(resize('e', 50, 999), { x: 1000, y: 200, width: 450, height: 640 });
  assert.deepEqual(resize('s', 999, 60), { x: 1000, y: 200, width: 400, height: 700 });
  assert.deepEqual(resize('se', 30, 40), { x: 1000, y: 200, width: 430, height: 680 });
});

test('dragging the left or top edge moves the window so the opposite edge stays put', () => {
  assert.deepEqual(resize('w', -80, 999), { x: 920, y: 200, width: 480, height: 640 });
  assert.deepEqual(resize('n', 999, -100), { x: 1000, y: 100, width: 400, height: 740 });
  const nw = resize('nw', -50, -50);
  assert.deepEqual(nw, { x: 950, y: 150, width: 450, height: 690 });
  assert.equal(nw.x + nw.width, 1400);
  assert.equal(nw.y + nw.height, 840);
});

test('the window can’t be made smaller than the minimum, and the far edge doesn’t move', () => {
  assert.deepEqual(resize('e', -500, 0), { x: 1000, y: 200, width: 340, height: 640 });
  assert.deepEqual(resize('w', 500, 0), { x: 1060, y: 200, width: 340, height: 640 });
  assert.deepEqual(resize('n', 0, 900), { x: 1000, y: 400, width: 400, height: 440 });
  assert.deepEqual(resize('s', 0, -900), { x: 1000, y: 200, width: 400, height: 440 });
});

test('the window can’t be dragged larger than the screen allows', () => {
  assert.equal(resize('e', 5000, 0).width, 920, 'stops at the right edge of the screen');
  assert.equal(resize('s', 0, 5000).height, 832, 'stops at the bottom of the work area');
  const w = resize('w', -5000, 0);
  assert.deepEqual([w.x, w.width], [0, 1400], 'stops at the left edge of the screen');
  const n = resize('n', 0, -5000);
  assert.deepEqual([n.y, n.height], [0, 840], 'stops at the top of the work area');
});

test('works on a second monitor to the left, with negative coordinates', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1040 };
  const s = { x: -500, y: 100, width: 400, height: 600 };
  const r = resizeBounds('w', s, -5000, 0, left, min);
  assert.deepEqual([r.x, r.width], [-1920, 1820]);
  assert.equal(resizeBounds('e', s, 5000, 0, left, min).width, 500, 'stops at the monitor’s right edge (x = 0)');
});

test('a window already larger than the area never ends up below the minimum', () => {
  const tiny = { x: 0, y: 0, width: 300, height: 300 };
  const r = resizeBounds('se', { x: 0, y: 0, width: 400, height: 640 }, 10, 10, tiny, min);
  assert.deepEqual([r.width, r.height], [340, 440]);
});

// ---------- Docking the logo to a screen edge ----------

const { makeDock, dockSnap, matchDockArea } = require('../src/main/geometry');
const SIZE = 76;

test('a dock sits on the chosen edge, with the logo kept on the screen', () => {
  assert.deepEqual(makeDock('right', area, 300, SIZE), { side: 'right', edge: 1920, y: 300 });
  assert.deepEqual(makeDock('left', area, 300, SIZE), { side: 'left', edge: 0, y: 300 });
  assert.equal(makeDock('left', area, -50, SIZE).y, 0, 'not above the top');
  assert.equal(makeDock('left', area, 5000, SIZE).y, 1032 - SIZE, 'not below the bottom');
});

test('a dock on a second monitor uses that monitor’s edge', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(makeDock('left', left, 100, SIZE), { side: 'left', edge: -1920, y: 100 });
  assert.deepEqual(makeDock('right', left, 100, SIZE), { side: 'right', edge: 0, y: 100 });
});

test('dropping the logo near an edge snaps it to that side', () => {
  assert.equal(dockSnap({ x: 12, y: 300 }, SIZE, area, 40), 'left');
  assert.equal(dockSnap({ x: 1920 - SIZE - 12, y: 300 }, SIZE, area, 40), 'right');
  assert.equal(dockSnap({ x: 900, y: 300 }, SIZE, area, 40), null, 'in the middle of the screen');
  assert.equal(dockSnap({ x: 41, y: 300 }, SIZE, area, 40), null, 'just too far');
});

test('dropping the logo past an edge snaps to that side', () => {
  assert.equal(dockSnap({ x: -60, y: 300 }, SIZE, area, 40), 'left');
  assert.equal(dockSnap({ x: 1900, y: 300 }, SIZE, area, 40), 'right');
});

test('on a screen too narrow for either side to be clearly nearer, the nearer one wins', () => {
  const narrow = { x: 0, y: 0, width: 100, height: 500 };
  assert.equal(dockSnap({ x: 20, y: 0 }, SIZE, narrow, 40), 'right');
  assert.equal(dockSnap({ x: 2, y: 0 }, SIZE, narrow, 40), 'left');
});

test('a saved dock is matched to the screen it was on', () => {
  const second = { x: 1920, y: 0, width: 1280, height: 1000 };
  const areas = [area, second];
  assert.equal(matchDockArea({ side: 'right', edge: 3200, y: 200 }, SIZE, areas), second);
  assert.equal(matchDockArea({ side: 'left', edge: 1920, y: 200 }, SIZE, areas), second, 'the seam belongs to the screen it’s docked on');
  assert.equal(matchDockArea({ side: 'right', edge: 1920, y: 200 }, SIZE, areas), area);
});

test('a saved dock that fits no screen is dropped', () => {
  assert.equal(matchDockArea({ side: 'right', edge: 5000, y: 200 }, SIZE, [area]), null, 'monitor unplugged');
  assert.equal(matchDockArea({ side: 'right', edge: 1920, y: 5000 }, SIZE, [area]), null, 'height off every screen');
  assert.equal(matchDockArea({ side: 'top', edge: 1920, y: 200 }, SIZE, [area]), null, 'unknown side');
  assert.equal(matchDockArea({ side: 'left', edge: 'x', y: 200 }, SIZE, [area]), null, 'garbage');
  assert.equal(matchDockArea(false, SIZE, [area]), null);
});

test('a dock whose screen’s edge moved a little (taskbar moved) still finds its screen', () => {
  const shifted = { x: 48, y: 0, width: 1872, height: 1032 };
  assert.equal(matchDockArea({ side: 'left', edge: 0, y: 200 }, SIZE, [shifted]), null, 'edge is outside the new area');
  assert.equal(matchDockArea({ side: 'right', edge: 1900, y: 200 }, SIZE, [shifted]), shifted, 'edge is inside the new area');
});
