'use strict';

// Pure helpers for the appointment schedule (no page or Electron needed, so they are unit-tested).
// Times are minutes after midnight; days are 'YYYY-MM-DD' in the clinic's local time.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ScheduleLayout = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');

  /** 510 -> '08:30' */
  function clock(minutes) {
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }

  /** '08:30' -> 510, or null if it isn't a time. */
  function parseClock(text) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text).trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /** Rounds to the nearest step (the schedule's row size). */
  function snap(minutes, step) {
    return Math.round(minutes / step) * step;
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** A Date as the clinic's local calendar day. */
  function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** The day n days after (or before, if negative) a day. */
  function shiftDay(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + n));
  }

  /** 'Tue 21 Oct 2026' */
  function dayLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * Sets lane / lanes on appointments in one column so ones that overlap sit side by side: each cluster of
   * overlapping appointments is split into as many lanes as it needs. Returns the same objects, annotated.
   */
  function layoutColumn(items) {
    const sorted = [...items].sort((a, b) => a.start - b.start || b.len - a.len || (a.id < b.id ? -1 : 1));
    let cluster = [];
    let clusterEnd = -1;
    const finish = () => {
      const lanes = cluster.reduce((max, it) => Math.max(max, it.lane + 1), 1);
      for (const it of cluster) it.lanes = lanes;
      cluster = [];
    };
    const laneEnds = [];
    for (const it of sorted) {
      if (cluster.length && it.start >= clusterEnd) {
        finish();
        laneEnds.length = 0;
        clusterEnd = -1;
      }
      let lane = laneEnds.findIndex((end) => end <= it.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = it.start + it.len;
      it.lane = lane;
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.start + it.len);
    }
    if (cluster.length) finish();
    return sorted;
  }

  /** Does an appointment at [start, start+len) clash with another in the list (ignoring `exceptId`)? */
  function findClash(items, col, start, len, exceptId = null) {
    return items.find((a) => a.id !== exceptId && a.col === col && a.start < start + len && start < a.start + a.len) || null;
  }

  return { clock, parseClock, snap, clamp, dayKey, shiftDay, dayLabel, layoutColumn, findClash };
});
