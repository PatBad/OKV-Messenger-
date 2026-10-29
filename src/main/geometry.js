'use strict';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * New window bounds when dragging one edge or corner of a window.
 *
 * @param edge   'n' 's' 'e' 'w' or a corner such as 'se'
 * @param start  { x, y, width, height } when the drag began
 * @param dx,dy  how far the pointer has moved since then
 * @param area   the screen's usable area { x, y, width, height }
 * @param min    { width, height } the window may not be made smaller than this
 *
 * The edge opposite the one being dragged stays put, and the window is never
 * made larger than the space between that fixed edge and the screen's edge.
 */
function resizeBounds(edge, start, dx, dy, area, min) {
  let { x, y, width, height } = start;
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  if (edge.includes('e')) width = clamp(start.width + dx, min.width, Math.max(min.width, area.x + area.width - start.x));
  if (edge.includes('w')) {
    width = clamp(start.width - dx, min.width, Math.max(min.width, right - area.x));
    x = right - width;
  }
  if (edge.includes('s')) height = clamp(start.height + dy, min.height, Math.max(min.height, area.y + area.height - start.y));
  if (edge.includes('n')) {
    height = clamp(start.height - dy, min.height, Math.max(min.height, bottom - area.y));
    y = bottom - height;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * The logo can be docked to the left or right edge of a screen, half of it
 * poking out. A dock is { side: 'left' | 'right', edge, y }: `edge` is the
 * screen x that side sits on and `y` is the top of the logo's box (`size` tall).
 */
const DOCK_SIDES = ['left', 'right'];

const dockEdgeX = (side, area) => (side === 'left' ? area.x : area.x + area.width);

/** A dock on `side` of `area`, with the logo's box as near `y` as the screen allows. */
function makeDock(side, area, y, size) {
  const top = clamp(Math.round(y), area.y, Math.max(area.y, area.y + area.height - size));
  return { side, edge: dockEdgeX(side, area), y: top };
}

/**
 * Which side of `area` the logo's box at `box` (x, y) should snap to when dropped,
 * or null if it is more than `threshold` from both. Dropping it past the edge counts.
 */
function dockSnap(box, size, area, threshold) {
  const fromLeft = box.x - area.x;
  const fromRight = area.x + area.width - (box.x + size);
  if (fromLeft <= threshold && fromLeft <= fromRight) return 'left';
  if (fromRight <= threshold) return 'right';
  return null;
}

/**
 * The screen area a saved dock belongs on, or null if it fits none (the monitor
 * was unplugged, say). Prefers the area whose edge is exactly where the dock was,
 * then any area spanning it, so a moved taskbar doesn't lose the dock.
 */
function matchDockArea(dock, size, areas) {
  if (!dock || !DOCK_SIDES.includes(dock.side) || !Number.isFinite(dock.edge) || !Number.isFinite(dock.y)) return null;
  const mid = dock.y + size / 2;
  const level = areas.filter((a) => mid >= a.y && mid < a.y + a.height);
  return (
    level.find((a) => dockEdgeX(dock.side, a) === dock.edge) ||
    level.find((a) => dock.edge >= a.x && dock.edge <= a.x + a.width) ||
    null
  );
}

module.exports = { clamp, resizeBounds, DOCK_SIDES, makeDock, dockSnap, matchDockArea };
