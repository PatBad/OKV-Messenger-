'use strict';

/* global appt, ScheduleLayout */

const { clock, parseClock, snap, clamp, dayKey, shiftDay, dayLabel, layoutColumn, findClash } = ScheduleLayout;

const ROW_PX = 26; // height of one row, whatever the minutes per row
const DRAG_START_PX = 4; // how far the pointer must move before a press becomes a drag
const DEFAULT_LENGTH = 15; // minutes, for an appointment made by a single click
const MIN_LEN = 5;
const COLOR_NAMES = { green: 'Green', blue: 'Blue', pink: 'Pink', yellow: 'Yellow', grey: 'Grey' };

const $ = (id) => document.getElementById(id);
const el = {
  prev: $('prev'),
  next: $('next'),
  today: $('today'),
  dayLabel: $('day-label'),
  dayPick: $('day-pick'),
  steps: $('steps'),
  onTop: $('on-top'),
  scroller: $('scroller'),
  grid: $('grid'),
  backdrop: $('backdrop'),
  dialog: $('dialog'),
  dialogTitle: $('dialog-title'),
  dialogError: $('dialog-error'),
  dialogMeta: $('dialog-meta'),
  fPatient: $('f-patient'),
  fClient: $('f-client'),
  fNotes: $('f-notes'),
  fCol: $('f-col'),
  fDay: $('f-day'),
  fStart: $('f-start'),
  fEnd: $('f-end'),
  fLength: $('f-length'),
  fColors: $('f-colors'),
  fDelete: $('f-delete'),
  fCancel: $('f-cancel'),
  fSave: $('f-save'),
  tip: $('tip'),
  toast: $('toast'),
  toastText: $('toast-text'),
  toastAction: $('toast-action'),
};

const state = {
  cfg: null,
  day: dayKey(),
  step: 15,
  items: [], // the viewed day's appointments
  geo: null, // { from, to, ppm, height } of the grid as drawn
  bodies: [], // the column elements, in order
  drag: null,
  dialog: null, // the appointment being created or edited, while the form is open
  pending: false, // an update arrived mid-drag
  loadToken: 0,
};

// ---------- Small helpers ----------

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = [].concat(v).filter(Boolean).join(' ');
    else if (k === 'style') for (const [name, value] of Object.entries(v)) node.style.setProperty(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), value);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}

/** The text of an error thrown in the main process, without Electron's wrapper. */
const errText = (err) => String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let toastTimer;
function toast(text, action = null) {
  el.toastText.textContent = text;
  el.toastAction.hidden = !action;
  if (action) {
    el.toastAction.textContent = action.label;
    el.toastAction.onclick = () => {
      el.toast.hidden = true;
      action.run();
    };
  }
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), action ? 7000 : 3500);
}

const deptLabel = (id) => (state.cfg.departments.find((d) => d.id === id) || { label: id }).label;
const columnLabel = (id) => (state.cfg.columns.find((c) => c.id === id) || { label: id }).label;
const lengthText = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);

// ---------- Drawing the day ----------

/** The rows to draw: opening hours, widened if an appointment falls outside them, aligned to the step. */
function geometry() {
  const { dayStart, dayEnd } = state.cfg;
  const step = state.step;
  let from = dayStart;
  let to = dayEnd;
  for (const a of state.items) {
    from = Math.min(from, a.start);
    to = Math.max(to, a.start + a.len);
  }
  from = Math.floor(from / step) * step;
  to = Math.ceil(to / step) * step;
  const ppm = ROW_PX / step;
  return { from, to, ppm, height: (to - from) * ppm };
}

function render() {
  const { cfg } = state;
  const keepScroll = el.scroller.scrollTop;
  const g = (state.geo = geometry());
  el.grid.style.setProperty('--cols', String(cfg.columns.length));
  el.grid.style.setProperty('--row', `${ROW_PX}px`);
  el.grid.style.setProperty('--hour', `${60 * g.ppm}px`);
  el.grid.style.setProperty('--hour-offset', `${((60 - (g.from % 60)) % 60) * g.ppm}px`);

  const gutter = h('div', { class: 'sch-gutter', style: { height: `${g.height}px` } });
  const labelEvery = state.step === 5 ? 15 : state.step;
  for (let t = g.from; t < g.to; t += state.step) {
    if (t % labelEvery !== 0) continue;
    gutter.append(h('div', { class: ['sch-time', t % 60 === 0 && 'is-hour'], style: { top: `${(t - g.from) * g.ppm}px` } }, clock(t)));
  }

  state.bodies = cfg.columns.map((col) => {
    const body = h('div', { class: 'sch-col', 'data-col': col.id, style: { height: `${g.height}px` } });
    // Shade the time outside opening hours.
    if (cfg.dayStart > g.from) body.append(h('div', { class: 'sch-shade', style: { top: '0px', height: `${(cfg.dayStart - g.from) * g.ppm}px` } }));
    if (cfg.dayEnd < g.to) body.append(h('div', { class: 'sch-shade', style: { top: `${(cfg.dayEnd - g.from) * g.ppm}px`, height: `${(g.to - cfg.dayEnd) * g.ppm}px` } }));
    const mine = state.items.filter((a) => a.col === col.id).map((a) => ({ ...a }));
    for (const a of layoutColumn(mine)) body.append(blockElement(a, g));
    return body;
  });

  el.grid.replaceChildren(h('div', { class: 'sch-corner' }), ...cfg.columns.map((c) => h('div', { class: 'sch-head' }, c.label)), gutter, ...state.bodies);
  el.scroller.scrollTop = keepScroll;
  updateNow();
}

function blockElement(a, g) {
  const height = Math.max(a.len * g.ppm - 2, 10);
  const who = h('div', { class: 'sch-appt-who' }, a.patient, a.client ? h('span', null, ` · ${a.client}`) : null);
  const summary = `${a.patient}${a.client ? ` (${a.client})` : ''}, ${clock(a.start)}–${clock(a.start + a.len)}${a.notes ? `. ${a.notes}` : ''}`;
  return h(
    'div',
    {
      class: ['sch-appt', `c-${a.color}`, height < 44 && 'is-short', height < 20 && 'is-tiny', a.lanes > 1 && 'is-double'],
      'data-id': a.id,
      role: 'button',
      tabindex: '0',
      title: `${a.lanes > 1 ? 'DOUBLE-BOOKED: this overlaps another appointment in the same column.\n' : ''}${summary}\nBooked by ${deptLabel(a.by)}${a.editedBy ? `, last changed by ${deptLabel(a.editedBy)}` : ''}`,
      'aria-label': summary,
      style: {
        top: `${(a.start - g.from) * g.ppm + 1}px`,
        height: `${height}px`,
        left: `calc(${(a.lane / a.lanes) * 100}% + 2px)`,
        width: `calc(${100 / a.lanes}% - 4px)`,
      },
    },
    h('div', { class: 'sch-appt-time' }, `${clock(a.start)}–${clock(a.start + a.len)}`),
    who,
    a.notes ? h('div', { class: 'sch-appt-notes' }, a.notes) : null,
    h('div', { class: 'sch-handle top' }),
    h('div', { class: 'sch-handle bottom' }),
  );
}

/** The red "now" line, on today only. */
function updateNow() {
  for (const old of el.grid.querySelectorAll('.sch-now')) old.remove();
  if (!state.geo || state.day !== dayKey()) return;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < state.geo.from || minutes > state.geo.to) return;
  for (const body of state.bodies) body.append(h('div', { class: 'sch-now', style: { top: `${(minutes - state.geo.from) * state.geo.ppm}px` } }));
}

function renderHeader() {
  const today = state.day === dayKey();
  el.dayLabel.textContent = `${dayLabel(state.day)}${today ? ' (today)' : ''}`;
  el.dayPick.value = state.day;
  for (const b of el.steps.children) b.setAttribute('aria-pressed', String(Number(b.dataset.step) === state.step));
}

function scrollToStart() {
  if (!state.geo) return;
  let target = state.cfg.dayStart;
  if (state.day === dayKey()) {
    const now = new Date();
    target = Math.max(state.cfg.dayStart, now.getHours() * 60 + now.getMinutes() - 60);
  }
  el.scroller.scrollTop = Math.max(0, (target - state.geo.from) * state.geo.ppm);
}

async function refresh() {
  const token = ++state.loadToken;
  if (state.drag) {
    state.pending = true;
    return;
  }
  try {
    const items = await appt.day(state.day);
    if (token !== state.loadToken) return;
    if (state.drag) {
      state.pending = true;
      return;
    }
    state.items = items;
    render();
  } catch (err) {
    toast(errText(err));
  }
}

async function goTo(day) {
  if (!day) return;
  state.day = day;
  renderHeader();
  await refresh();
  scrollToStart();
}

function setStep(step) {
  if (step === state.step) return;
  const before = state.geo;
  const topMinute = before ? before.from + el.scroller.scrollTop / before.ppm : null;
  state.step = step;
  render();
  if (topMinute !== null) el.scroller.scrollTop = Math.max(0, (topMinute - state.geo.from) * state.geo.ppm);
  renderHeader();
  appt.set({ step }).catch(() => {});
}

// ---------- Dragging: create, move, resize ----------

const minuteAt = (clientY) => state.geo.from + (clientY - state.bodies[0].getBoundingClientRect().top) / state.geo.ppm;

function colIndexAt(clientX) {
  let best = 0;
  let bestDistance = Infinity;
  state.bodies.forEach((body, i) => {
    const r = body.getBoundingClientRect();
    const distance = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

/** The free stretch around a time in a column, or null if that time is inside an appointment. */
function freeGap(col, at) {
  let lo = state.geo.from;
  let hi = state.geo.to;
  for (const a of state.items) {
    if (a.col !== col) continue;
    if (a.start + a.len <= at) lo = Math.max(lo, a.start + a.len);
    else if (a.start >= at) hi = Math.min(hi, a.start);
    else return null;
  }
  return { lo, hi };
}

el.grid.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.drag || state.dialog) return;
  const body = e.target.closest('.sch-col');
  if (!body) return;
  e.preventDefault();
  const block = e.target.closest('.sch-appt');
  const common = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, cancelled: false };
  if (block) {
    const item = state.items.find((a) => a.id === block.dataset.id);
    if (!item) return;
    const handle = e.target.closest('.sch-handle');
    const mode = handle ? (handle.classList.contains('top') ? 'resize-top' : 'resize-bottom') : 'move';
    begin({ ...common, mode, item, block, grab: minuteAt(e.clientY) - item.start });
  } else {
    begin({ ...common, mode: 'create', colIndex: colIndexAt(e.clientX), anchor: Math.floor(minuteAt(e.clientY) / state.step) * state.step });
  }
});

let scrollTimer = null;

function begin(drag) {
  state.drag = drag;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onDragKey, true);
  // Keep scrolling while the pointer rests near the top or bottom edge.
  scrollTimer = setInterval(() => {
    const d = state.drag;
    if (!d || !d.moved) return;
    const r = el.scroller.getBoundingClientRect();
    if (d.lastY < r.top + 60) el.scroller.scrollTop -= 14;
    else if (d.lastY > r.bottom - 30) el.scroller.scrollTop += 14;
    else return;
    updateDrag();
  }, 30);
}

function onMove(e) {
  const d = state.drag;
  if (!d) return;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_START_PX) return;
    d.moved = true;
    if (d.mode === 'move') d.block.classList.add('is-dragging');
  }
  updateDrag();
}

function onDragKey(e) {
  if (e.key !== 'Escape' || !state.drag) return;
  e.preventDefault();
  e.stopPropagation();
  state.drag.cancelled = true;
  onUp();
}

/** Works out where the dragged thing is now and shows it. */
function updateDrag() {
  const d = state.drag;
  const g = state.geo;
  const step = state.step;
  const m = minuteAt(d.lastY);

  if (d.mode === 'create') {
    let start = d.anchor;
    let end = d.anchor + step;
    if (m >= d.anchor) end = Math.max(end, Math.ceil(m / step) * step);
    else start = Math.floor(m / step) * step;
    d.start = clamp(start, g.from, g.to - step);
    d.end = clamp(end, d.start + step, g.to);
    const col = state.cfg.columns[d.colIndex].id;
    d.bad = Boolean(findClash(state.items, col, d.start, d.end - d.start));
    if (!d.ghost) {
      d.ghost = h('div', { class: 'sch-ghost' });
      state.bodies[d.colIndex].append(d.ghost);
    }
    d.ghost.classList.toggle('is-bad', d.bad);
    d.ghost.style.top = `${(d.start - g.from) * g.ppm}px`;
    d.ghost.style.height = `${(d.end - d.start) * g.ppm}px`;
    return showTip(d, `${clock(d.start)}–${clock(d.end)} · ${lengthText(d.end - d.start)}`);
  }

  const item = d.item;
  let start = item.start;
  let len = item.len;
  let col = item.col;
  if (d.mode === 'move') {
    start = clamp(snap(m - d.grab, step), g.from, g.to - len);
    col = state.cfg.columns[colIndexAt(d.lastX)].id;
  } else if (d.mode === 'resize-bottom') {
    let end = snap(m, step);
    if (end <= item.start) end = item.start + step;
    len = clamp(end, item.start + MIN_LEN, g.to) - item.start;
  } else {
    const end = item.start + item.len;
    let s = snap(m, step);
    if (s >= end) s = end - step;
    start = Math.max(s, g.from);
    len = end - start;
  }
  Object.assign(d, { start, len, col });
  d.bad = Boolean(findClash(state.items, col, start, len, item.id));

  const block = d.block;
  const body = state.bodies[state.cfg.columns.findIndex((c) => c.id === col)];
  if (block.parentElement !== body) body.append(block);
  block.classList.toggle('is-bad', d.bad);
  Object.assign(block.style, {
    top: `${(start - g.from) * g.ppm + 1}px`,
    height: `${Math.max(len * g.ppm - 2, 10)}px`,
    left: '2px',
    width: 'calc(100% - 4px)',
  });
  showTip(d, `${clock(start)}–${clock(start + len)} · ${lengthText(len)}`);
}

function showTip(d, text) {
  el.tip.hidden = false;
  el.tip.textContent = text;
  el.tip.style.left = `${Math.min(d.lastX + 14, window.innerWidth - 170)}px`;
  el.tip.style.top = `${Math.min(d.lastY + 16, window.innerHeight - 30)}px`;
}

async function onUp() {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  window.removeEventListener('keydown', onDragKey, true);
  clearInterval(scrollTimer);
  el.tip.hidden = true;
  if (d.ghost) d.ghost.remove();

  if (d.cancelled) return finishDrag(true);
  if (!d.moved) {
    if (d.mode === 'create') clickCreate(d);
    else openEdit(d.item);
    return finishDrag(false);
  }
  if (d.mode === 'create') {
    const col = state.cfg.columns[d.colIndex].id;
    if (d.bad) toast('That time is already booked');
    else openNew({ col, start: d.start, len: d.end - d.start });
    return finishDrag(false);
  }
  if (d.bad) {
    toast('That time is already booked');
    return finishDrag(true);
  }
  if (d.start === d.item.start && d.len === d.item.len && d.col === d.item.col) return finishDrag(true);
  await save(d.item, { col: d.col, start: d.start, len: d.len });
  return finishDrag(false);
}

function finishDrag(redraw) {
  if (redraw) render();
  if (state.pending) {
    state.pending = false;
    refresh();
  }
}

/** A single click on an empty slot: a default-length appointment, shortened to fit the gap. */
function clickCreate(d) {
  const g = state.geo;
  const col = state.cfg.columns[d.colIndex].id;
  const m = minuteAt(d.startY);
  const wanted = Math.max(state.step, DEFAULT_LENGTH);
  for (const start of [clamp(d.anchor, g.from, g.to - state.step), clamp(Math.floor(m / 5) * 5, g.from, g.to - MIN_LEN)]) {
    const gap = freeGap(col, start);
    if (!gap) continue;
    const len = Math.min(wanted, gap.hi - start);
    if (len >= MIN_LEN) return openNew({ col, start, len });
  }
  toast('That time is already booked');
}

/** Saves a moved or resized appointment, showing the result straight away. */
async function save(item, changes) {
  const next = { ...item, ...changes };
  state.items = state.items.map((a) => (a.id === item.id ? next : a));
  render();
  try {
    const { day, col, start, len, patient, client, notes, color } = next;
    await appt.change({ id: item.id, day, col, start, len, patient, client, notes, color });
  } catch (err) {
    toast(errText(err));
  }
  refresh();
}

el.grid.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const block = e.target.closest && e.target.closest('.sch-appt');
  const item = block && state.items.find((a) => a.id === block.dataset.id);
  if (!item) return;
  e.preventDefault();
  openEdit(item);
});

// ---------- The booking form ----------

function buildForm() {
  el.fCol.replaceChildren(...state.cfg.columns.map((c) => h('option', { value: c.id }, c.label)));
  el.fColors.replaceChildren(
    ...state.cfg.colors.map((c) =>
      h('label', { class: ['sch-swatch', `c-${c}`], title: COLOR_NAMES[c] || c }, h('input', { type: 'radio', name: 'color', value: c, 'aria-label': COLOR_NAMES[c] || c }), h('span')),
    ),
  );
}

function openDialog(model) {
  state.dialog = { ...model, lastStart: model.start };
  model = state.dialog;
  el.dialogTitle.textContent = model.id ? 'Edit appointment' : 'New appointment';
  el.fPatient.value = model.patient || '';
  el.fClient.value = model.client || '';
  el.fNotes.value = model.notes || '';
  el.fCol.value = model.col;
  el.fDay.value = model.day;
  el.fStart.value = clock(model.start);
  el.fEnd.value = clock(model.start + model.len);
  for (const radio of el.fColors.querySelectorAll('input')) radio.checked = radio.value === model.color;
  el.fDelete.hidden = !model.id;
  el.dialogMeta.textContent = model.id
    ? `Booked by ${deptLabel(model.by)}${model.byName ? ` (${model.byName})` : ''}${model.editedBy ? ` · last changed by ${deptLabel(model.editedBy)}${model.editedByName ? ` (${model.editedByName})` : ''}` : ''}`
    : '';
  el.dialogError.hidden = true;
  updateLength();
  el.backdrop.hidden = false;
  el.fPatient.focus();
}

function closeDialog() {
  state.dialog = null;
  el.backdrop.hidden = true;
}

function openNew({ col, start, len }) {
  openDialog({ day: state.day, col, start, len, patient: '', client: '', notes: '', color: 'green' });
}

function openEdit(item) {
  openDialog({ ...item });
}

function updateLength() {
  const s = parseClock(el.fStart.value);
  const e = parseClock(el.fEnd.value);
  el.fLength.textContent = s !== null && e !== null && e > s ? lengthText(e - s) : '—';
}

function dialogError(text) {
  el.dialogError.textContent = text;
  el.dialogError.hidden = false;
}

el.fStart.addEventListener('input', updateLength);
el.fEnd.addEventListener('input', updateLength);
// Moving the start moves the end with it, keeping the length.
el.fStart.addEventListener('change', () => {
  const m = state.dialog;
  const s = parseClock(el.fStart.value);
  if (!m || s === null) return;
  const oldEnd = parseClock(el.fEnd.value);
  const length = oldEnd !== null && oldEnd > m.lastStart ? oldEnd - m.lastStart : m.len;
  m.lastStart = s;
  el.fEnd.value = clock(Math.min(s + length, 23 * 60 + 55));
  updateLength();
});

el.dialog.addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = state.dialog;
  if (!m) return;
  const start = parseClock(el.fStart.value);
  const end = parseClock(el.fEnd.value);
  if (start === null || end === null) return dialogError('Please enter a start and end time');
  if (end <= start) return dialogError('The end time must be after the start time');
  if (start % 5 || end % 5) return dialogError('Times must be on 5-minute steps (for example 08:35)');
  const checked = el.fColors.querySelector('input:checked');
  const details = {
    day: el.fDay.value,
    col: el.fCol.value,
    start,
    len: end - start,
    patient: el.fPatient.value,
    client: el.fClient.value,
    notes: el.fNotes.value,
    color: checked ? checked.value : 'grey',
  };
  if (!details.patient.trim()) return dialogError('Please enter the patient’s name');
  el.fSave.disabled = true;
  try {
    if (m.id) await appt.change({ id: m.id, ...details });
    else await appt.add(details);
    closeDialog();
    if (details.day !== state.day) toast(`Saved for ${dayLabel(details.day)}`);
    await refresh();
  } catch (err) {
    dialogError(errText(err));
  } finally {
    el.fSave.disabled = false;
  }
});

el.fCancel.addEventListener('click', closeDialog);

el.fDelete.addEventListener('click', async () => {
  const m = state.dialog;
  if (!m || !m.id) return;
  try {
    await appt.remove({ id: m.id });
    closeDialog();
    await refresh();
    toast('Appointment deleted', { label: 'Undo', run: () => appt.restore({ id: m.id }).then(refresh).catch((err) => toast(errText(err))) });
  } catch (err) {
    dialogError(errText(err));
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.dialog) {
    e.preventDefault();
    closeDialog();
  }
});

// ---------- Top bar ----------

el.prev.addEventListener('click', () => goTo(shiftDay(state.day, -1)));
el.next.addEventListener('click', () => goTo(shiftDay(state.day, 1)));
el.today.addEventListener('click', () => goTo(dayKey()));
el.dayPick.addEventListener('change', () => goTo(el.dayPick.value));
el.onTop.addEventListener('change', () => appt.set({ onTop: el.onTop.checked }).catch((err) => toast(errText(err))));

// ---------- Start ----------

async function init() {
  state.cfg = await appt.getState();
  state.step = state.cfg.step;
  document.title = `${state.cfg.productName} – Appointments`;
  el.onTop.checked = state.cfg.onTop;
  el.steps.replaceChildren(...state.cfg.steps.map((s) => h('button', { type: 'button', 'data-step': String(s), title: `${s} minutes per row` }, String(s))));
  for (const b of el.steps.children) b.addEventListener('click', () => setStep(Number(b.dataset.step)));
  buildForm();
  renderHeader();
  await refresh();
  scrollToStart();

  let timer;
  appt.onChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 80);
  });
  setInterval(updateNow, 30000);
}

init().catch((err) => toast(errText(err)));
