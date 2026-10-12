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

module.exports = { clamp, resizeBounds };
