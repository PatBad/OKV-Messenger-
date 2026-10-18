'use strict';

/* global okv */

const PAGE = 150;

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body,
  bubble: $('bubble'),
  badge: $('badge'),
  badgeBlue: $('badge-blue'),
  badgeBlueCount: $('badge-blue-count'),
  meDept: $('me-dept'),
  netStatus: $('net-status'),
  netText: $('net-text'),
  openSettings: $('open-settings'),
  openSchedule: $('open-schedule'),
  collapse: $('collapse'),
  onboarding: $('screen-onboarding'),
  onboardingDepts: $('onboarding-depts'),
  board: $('screen-board'),
  filters: $('filters'),
  searchBox: $('search-box'),
  search: $('search'),
  toggleSearch: $('toggle-search'),
  banner: $('update-banner'),
  bannerText: $('update-banner-text'),
  bannerBtn: $('update-banner-btn'),
  list: $('list'),
  jump: $('jump'),
  compose: $('compose'),
  to: $('to'),
  author: $('author'),
  urgent: $('urgent'),
  text: $('text'),
  send: $('send'),
  composeError: $('compose-error'),
  replyBar: $('reply-bar'),
  replyWho: $('reply-who'),
  replySnippet: $('reply-snippet'),
  replyCancel: $('reply-cancel'),
  quickRow: $('quick-row'),
  attachBtn: $('attach-btn'),
  attachInput: $('attach-input'),
  attachList: $('attach-list'),
  media: $('screen-media'),
  mediaFilters: $('media-filters'),
  mediaSearch: $('media-search'),
  mediaList: $('media-list'),
  mediaNote: $('media-note'),
  viewer: $('viewer'),
  viewerTitle: $('viewer-title'),
  viewerImg: $('viewer-img'),
  viewerShow: $('viewer-show'),
  viewerSave: $('viewer-save'),
  viewerOpen: $('viewer-open'),
  viewerClose: $('viewer-close'),
  viewerStage: $('viewer-stage'),
  quietBtn: $('quiet-btn'),
  quietLeft: $('quiet-left'),
  quietMenu: $('quiet-menu'),
  pinBanner: $('pin-banner'),
  pinText: $('pin-text'),
  pinMeta: $('pin-meta'),
  pinClear: $('pin-clear'),
  togglePin: $('toggle-pin'),
  pinForm: $('pin-form'),
  pinInput: $('pin-input'),
  pinCancel: $('pin-cancel'),
  quickEdit: $('quick-edit'),
  quickAdd: $('quick-add'),
  quickReset: $('quick-reset'),
  peerSelf: $('peer-self'),
  tidyNote: $('tidy-note'),
  exportRange: $('export-range'),
  exportBtn: $('export-btn'),
  backupBtn: $('backup-btn'),
  openArchive: $('open-archive'),
  historyResult: $('history-result'),
  gifAttached: $('gif-attached'),
  gifThumb: $('gif-thumb'),
  gifName: $('gif-name'),
  gifSize: $('gif-size'),
  gifRemove: $('gif-remove'),
  settings: $('screen-settings'),
  closeSettings: $('close-settings'),
  settingsDepts: $('settings-depts'),
  optSound: $('opt-sound'),
  optAutostart: $('opt-autostart'),
  peerList: $('peer-list'),
  version: $('version'),
  host: $('host'),
  updateText: $('update-text'),
  updateBtn: $('update-btn'),
  openData: $('open-data'),
  toast: $('toast'),
  sections: $('sections'),
  badgeReminders: $('badge-reminders'),
  reminders: $('screen-reminders'),
  remFilters: $('rem-filters'),
  remClear: $('rem-clear'),
  remList: $('rem-list'),
  remCompose: $('rem-compose'),
  remTo: $('rem-to'),
  remName: $('rem-name'),
  remNames: $('rem-names'),
  remText: $('rem-text'),
  remAdd: $('rem-add'),
  remDueOn: $('rem-due-on'),
  remDue: $('rem-due'),
  remError: $('rem-error'),
  badgeMedications: $('badge-medications'),
  medications: $('screen-medications'),
  medFilters: $('med-filters'),
  medClear: $('med-clear'),
  medList: $('med-list'),
  medCompose: $('med-compose'),
  medPatient: $('med-patient'),
  medRows: $('med-rows'),
  medAdd: $('med-add'),
  medError: $('med-error'),
  toastText: $('toast-text'),
  toastAction: $('toast-action'),
};

const state = {
  productName: 'Messenger',
  departments: [],
  settings: {},
  expanded: false,
  unread: 0,
  peers: [],
  update: { state: 'dev' },
  screen: 'board',
  filter: 'all',
  search: '',
  messages: [],
  more: false,
  newSince: 0,
  urgent: false,
  sending: false,
  gif: null, // the GIF waiting to be sent: { data, name, size, url }
  reply: null, // the message being replied to: { id, from, author, text, gif }
  pendingFiles: [], // files and images waiting to be sent: { name, size, data, url, isImage }
  attachPlaceholder: '[Attachment]',
  fileMaxBytes: 15 * 1024 * 1024,
  maxAttach: 5,
  attachTotal: 40 * 1024 * 1024,
  attachRetention: 7,
  blockedExt: new Set(),
  mediaFilter: 'all',
  mediaSearch: '',
  media: null,
  viewing: null, // the picture open in the viewer
  pin: null, // the notice pinned for everyone: { text, by, name, at }
  editing: null, // id of the message being edited, with its unsaved wording in editDraft
  editDraft: null,
  editWindowMs: 15 * 60 * 1000,
  retentionDays: 14,
  maxQuick: 8,
  quickDraft: null, // the quick-message list being edited in Settings
  peerReport: null,
  gifMaxBytes: 4 * 1024 * 1024,
  hasUrgentUnread: false,
  // Days the user has opened or closed (dayKey -> open). Otherwise only today is open.
  dayOpen: new Map(),
  reactionChoices: [],
  section: 'board', // which of 'board' / 'reminders' / 'medications' / 'media' the panel shows
  remFilter: 'for-us',
  reminderList: [],
  remSummary: { open: 0, overdue: 0, unseen: 0, unseenDue: false },
  remSending: false,
  medFilter: 'open',
  medicationList: [],
  medSummary: { open: 0, requests: 0, completed: 0 },
  medRows: [{ name: '', qty: '' }], // the medicines being typed into the request form
  medSending: false,
};

// ---------- Helpers ----------

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const deptLabel = (id) => (state.departments.find((d) => d.id === id) || { label: id }).label;
const toLabel = (to) => (to === 'all' ? 'Everyone' : deptLabel(to));

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((today - that) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.getFullYear() === today.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

// Static, trusted SVG markup for small icons.
const ICONS = {
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  bellOff:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M2 2l20 20"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>',
  reply:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>',
};
// Reactions drawn as pictures rather than emoji characters (token → file and name).
const CUSTOM_REACTIONS = {
  ':dead-inside:': { src: '../../assets/reactions/dead-inside.svg', name: 'Dead inside' },
};
function reactionGlyph(emoji, size) {
  const custom = CUSTOM_REACTIONS[emoji];
  if (!custom) return document.createTextNode(emoji);
  return h('img', { class: 'reaction-img', src: custom.src, alt: custom.name, width: size, height: size, draggable: 'false' });
}
const reactionName = (emoji) => (CUSTOM_REACTIONS[emoji] ? CUSTOM_REACTIONS[emoji].name : emoji);

function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstChild;
}

let toastTimer;
/** Shows a short notice; `action` ({label, run}) adds a button such as Undo, `tone` 'blue' marks a medication notification. */
function toast(message, action = null, tone = null) {
  el.toastText.textContent = message;
  el.toastAction.hidden = !action;
  el.toast.classList.toggle('has-action', Boolean(action));
  el.toast.classList.toggle('is-blue', tone === 'blue');
  if (action) {
    el.toastAction.textContent = action.label;
    el.toastAction.onclick = () => {
      el.toast.hidden = true;
      action.run();
    };
  }
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), action ? 6000 : 2600);
}

// ---------- Sound ----------

let audio;
function chime(urgent, kind = null) {
  if (!state.settings.sound) return;
  if (quietActive() && !urgent) return;
  try {
    audio = audio || new AudioContext();
    // A medication request being ticked off gets its own rising three-note chime, so it's not mistaken for a message.
    const notes = urgent ? [988, 784, 988, 784, 988] : kind === 'done' ? [523, 659, 784] : [659, 880];
    const gap = urgent ? 0.17 : 0.15;
    const start = audio.currentTime + 0.03;
    notes.forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const t = start + i * gap;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(urgent ? 0.3 : 0.2, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    // no audio device; ignore
  }
}

// ---------- Expand / collapse ----------

async function setExpanded(expanded) {
  if (expanded === state.expanded) return;
  el.body.classList.add('is-switching');
  try {
    await okv.setExpanded(expanded);
  } finally {
    el.body.classList.remove('is-switching');
  }
}

function applyView({ expanded, origin, lastReadAt }) {
  const opening = expanded && !state.expanded;
  state.expanded = expanded;
  el.body.classList.toggle('is-expanded', expanded);
  el.body.classList.toggle('is-collapsed', !expanded);
  el.body.classList.remove('is-switching');
  if (origin) $('panel').style.transformOrigin = origin;
  if (opening) {
    state.newSince = lastReadAt || 0;
    refreshPin();
    showScreen(state.settings.department ? state.section : 'onboarding');
    refresh({ toBottom: true });
    if (state.screen === 'board') el.text.focus();
    okv.markRead();
  }
}

/**
 * Lets `handle` move the whole window. A press that doesn't move counts as a
 * tap. Returns a function that says whether a drag is in progress.
 */
function makeDraggable(handle, { canStart = () => true, onTap = () => {} } = {}) {
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !canStart(e)) return;
    drag = {
      offsetX: e.screenX - window.screenX,
      offsetY: e.screenY - window.screenY,
      startX: e.screenX,
      startY: e.screenY,
      moved: false,
    };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.screenX - drag.startX, e.screenY - drag.startY) > 4) {
      drag.moved = true;
      handle.classList.add('is-dragging');
    }
    if (drag.moved) okv.dragMove(e.screenX - drag.offsetX, e.screenY - drag.offsetY);
  });
  const end = (e) => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    handle.classList.remove('is-dragging');
    if (moved) okv.dragEnd();
    else if (e.type === 'pointerup') onTap();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  return () => drag !== null;
}

// The bubble: drag to move it, tap to open.
const bubbleDragging = makeDraggable(el.bubble, { onTap: () => setExpanded(true) });
el.bubble.addEventListener('click', (e) => {
  if (e.detail === 0) setExpanded(true); // Enter/Space when it has keyboard focus
});

// Clicks pass through the empty space around the bubble to the apps below;
// catch them again while the mouse is over the bubble itself.
el.bubble.addEventListener('pointerenter', () => okv.setClickThrough(false));
el.bubble.addEventListener('pointerleave', () => {
  if (!bubbleDragging()) okv.setClickThrough(true);
});

// The open panel: drag it by its top bar (but not by the buttons there).
makeDraggable(document.querySelector('.topbar'), { canStart: (e) => !e.target.closest('button') });

// The open panel: resize it by dragging any edge or corner.
for (const handle of document.querySelectorAll('.rh')) {
  let from = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    from = { x: e.screenX, y: e.screenY };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    document.body.classList.add('is-resizing');
    okv.resizeStart(handle.dataset.edge);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (from) okv.resizeMove(e.screenX - from.x, e.screenY - from.y);
  });
  const end = () => {
    if (!from) return;
    from = null;
    document.body.classList.remove('is-resizing');
    okv.resizeEnd();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

el.collapse.addEventListener('click', () => setExpanded(false));

// ---------- Badge ----------

function renderBadge() {
  const rem = state.remSummary;
  const med = state.medSummary;
  const n = state.unread + rem.unseen + med.requests;
  el.badge.hidden = n === 0;
  el.badge.textContent = n > 99 ? '99+' : String(n);
  el.bubble.classList.toggle('has-urgent', (state.unread > 0 && state.hasUrgentUnread) || rem.unseenDue);
  // Reminders tab: how many are open for us, red when any are overdue.
  el.badgeReminders.hidden = rem.open === 0;
  el.badgeReminders.textContent = String(rem.open);
  el.badgeReminders.classList.toggle('is-overdue', rem.overdue > 0);
  el.badgeReminders.title = rem.overdue ? `${rem.open} open, ${rem.overdue} overdue` : `${rem.open} open`;
  // Medications tab: blue with the number completed since you last looked, otherwise grey with how many are still to dispense.
  const blue = med.completed > 0;
  const tabCount = blue ? med.completed : med.open;
  el.badgeMedications.hidden = tabCount === 0;
  el.badgeMedications.textContent = String(tabCount);
  el.badgeMedications.classList.toggle('is-blue', blue);
  el.badgeMedications.title = blue ? `${med.completed} medication request${med.completed === 1 ? '' : 's'} completed` : `${med.open} to dispense`;
  // The blue badge on the logo is separate from the red message count.
  el.badgeBlue.hidden = !blue;
  el.badgeBlueCount.textContent = med.completed > 99 ? '99+' : String(med.completed);
  const notes = [n ? `${n} new` : null, blue ? `${med.completed} medication${med.completed === 1 ? '' : 's'} completed` : null].filter(Boolean);
  el.bubble.setAttribute('aria-label', notes.length ? `Open ${state.productName}, ${notes.join(', ')}` : `Open ${state.productName}`);
  el.bubble.title = notes.length ? `${state.productName} – ${notes.join(', ')}` : state.productName;
}

function bump() {
  el.bubble.classList.remove('bump');
  void el.bubble.offsetWidth; // restart the animation
  el.bubble.classList.add('bump');
}

// ---------- Header ----------

function renderHeader() {
  const dept = state.settings.department;
  el.meDept.className = `me-dept dept-${dept}`;
  el.meDept.textContent = dept ? deptLabel(dept) : '';
  el.meDept.hidden = !dept;
  const n = state.peers.length;
  el.netStatus.classList.toggle('is-online', n > 0);
  el.netText.textContent = n === 0 ? 'No other PCs found' : `${n} other PC${n === 1 ? '' : 's'} online`;
  el.netStatus.title = n === 0 ? `No other computers running ${state.productName} found` : `${n} other computer${n === 1 ? '' : 's'} online`;
  el.collapse.hidden = !dept;
  el.openSettings.hidden = !dept;
}

// ---------- Screens ----------

function showScreen(name) {
  state.screen = name;
  const section = name === 'board' || name === 'reminders' || name === 'medications' || name === 'media';
  if (section) state.section = name;
  el.onboarding.hidden = name !== 'onboarding';
  el.board.hidden = name !== 'board';
  el.reminders.hidden = name !== 'reminders';
  el.medications.hidden = name !== 'medications';
  el.media.hidden = name !== 'media';
  el.settings.hidden = name !== 'settings';
  el.sections.hidden = !section;
  for (const b of el.sections.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.section === name));
  if (name === 'settings') renderSettings();
  if (name === 'media') refreshMedia();
  if (name === 'board') {
    renderList({ toBottom: true });
    el.text.focus();
  }
  if (name === 'reminders') {
    refreshReminders();
    if (state.expanded) okv.markRemindersSeen();
    el.remText.focus();
  }
  if (name === 'medications') {
    refreshMedications();
    if (state.expanded) okv.markMedicationsSeen();
    renderMedRows();
    el.medPatient.focus();
  }
}

el.sections.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-section]');
  if (button) showScreen(button.dataset.section);
});

function deptButtons(container, compact) {
  container.replaceChildren(
    ...state.departments.map((d) =>
      h(
        'button',
        {
          type: 'button',
          class: ['dept-option', `dept-${d.id}`],
          'aria-pressed': String(state.settings.department === d.id),
          onclick: () => chooseDepartment(d.id),
        },
        h('span', { class: 'dept-swatch' }),
        h('span', null, h('strong', null, d.label), compact ? null : h('small', null, d.hint || '')),
      ),
    ),
  );
}

async function chooseDepartment(id) {
  const firstTime = !state.settings.department;
  state.settings = await okv.setDepartment(id);
  renderHeader();
  renderComposeTargets();
  renderReminderTargets();
  renderQuick();
  if (firstTime) {
    showScreen('board');
    toast(`This computer now sends as ${deptLabel(id)}`);
  } else {
    deptButtons(el.settingsDepts, true);
    toast(`Now sending as ${deptLabel(id)}`);
  }
  refresh();
}

// ---------- Message list ----------

async function refresh({ toBottom = false } = {}) {
  if (!state.settings.department) return;
  const result = await okv.query({
    filter: state.filter,
    search: state.search,
    limit: Math.max(PAGE, state.messages.length),
  });
  state.messages = result.messages;
  state.more = result.more;
  renderList({ toBottom });
}

async function loadOlder() {
  if (!state.messages.length) return;
  const first = state.messages[0];
  const result = await okv.query({
    filter: state.filter,
    search: state.search,
    before: { createdAt: first.createdAt, id: first.id },
    limit: PAGE,
  });
  state.messages = result.messages.concat(state.messages);
  state.more = result.more;
  renderList({ keepTop: true });
}

function isNew(m) {
  return !m.local && m.receivedAt > state.newSince;
}

function messageNode(m) {
  const dept = state.settings.department;
  const toUs = m.to !== 'all' && m.to === dept;
  return h(
    'article',
    { class: ['msg', `dept-${m.from}`, m.urgent && 'is-urgent', m.local && 'is-mine', isNew(m) && 'is-new'], 'data-id': m.id, 'data-unseen': m.seenByMe === false ? '1' : null },
    h(
      'header',
      { class: 'msg-head' },
      h('span', { class: 'msg-from', title: m.host ? `Sent from ${m.host}` : null }, deptLabel(m.from)),
      m.author ? h('span', { class: 'msg-author' }, m.author) : null,
      h('span', { class: ['msg-to', toUs && 'is-us'], title: toUs ? `To ${toLabel(m.to)}` : null }, `→ ${toUs ? 'You' : toLabel(m.to)}`),
      m.urgent ? h('span', { class: 'msg-tag' }, 'Urgent') : null,
      m.editedAt ? h('span', { class: 'msg-edited', title: `Edited ${fullFmt.format(m.editedAt)}` }, 'edited') : null,
      h('time', { class: 'msg-time', datetime: new Date(m.createdAt).toISOString(), title: fullFmt.format(m.createdAt) }, timeFmt.format(m.createdAt)),
    ),
    quoteNode(m),
    // A GIF message has "[GIF]" as its text unless the sender typed a caption.
    state.editing === m.id ? editorNode(m) : isMediaOnly(m) ? null : h('p', { class: 'msg-text' }, m.text),
    gifNode(m),
    attachmentsNode(m),
    reactionsNode(m),
    seenNode(m),
    // Shown while pointing at the message: react, or delete.
    h(
      'div',
      { class: 'msg-actions', role: 'toolbar', 'aria-label': 'Message actions' },
      h('button', { type: 'button', class: 'msg-reply', title: 'Reply', 'aria-label': 'Reply to this message', onclick: () => setReply(m) }, icon('reply')),
      h('span', { class: 'msg-actions-sep' }),
      ...state.reactionChoices.map((emoji) => {
        const on = hasReacted(m, emoji);
        return h(
          'button',
          {
            type: 'button',
            class: ['msg-react', on && 'is-on'],
            title: on ? `Remove your ${reactionName(emoji)}` : `React with ${reactionName(emoji)}`,
            'aria-pressed': String(on),
            onclick: () => react(m, emoji),
          },
          reactionGlyph(emoji, 20),
        );
      }),
      h('span', { class: 'msg-actions-sep' }),
      h('button', { type: 'button', class: 'msg-more', title: 'More', 'aria-label': 'More actions', onclick: (e) => toggleMessageMenu(e.currentTarget.closest('.msg'), m) }, icon('more')),
      h(
        'button',
        {
          type: 'button',
          class: 'msg-delete',
          title: 'Delete',
          'aria-label': 'Delete message',
          onclick: (e) => toggleDeleteChoices(e.currentTarget.closest('.msg'), m),
        },
        icon('trash'),
      ),
    ),
  );
}

// ---------- Reactions ----------

function hasReacted(m, emoji) {
  const r = (m.reactions || []).find((x) => x.emoji === emoji);
  return Boolean(r && r.by.includes(state.settings.department));
}

/** Chips under a message, e.g. "👍 You, Reception". Clicking one adds or removes your reaction. */
function reactionsNode(m) {
  if (!m.reactions || !m.reactions.length) return null;
  const me = state.settings.department;
  return h(
    'div',
    { class: 'msg-reactions' },
    ...m.reactions.map((r) => {
      const mine = r.by.includes(me);
      const names = [...(mine ? ['You'] : []), ...r.by.filter((d) => d !== me).map(deptLabel)];
      return h(
        'button',
        {
          type: 'button',
          class: ['reaction', mine && 'is-mine'],
          title: mine ? `Click to remove your ${reactionName(r.emoji)}` : `Click to react with ${reactionName(r.emoji)} too`,
          onclick: () => react(m, r.emoji),
        },
        h('span', { class: 'reaction-emoji' }, reactionGlyph(r.emoji, 15)),
        h('span', { class: 'reaction-who' }, names.join(', ')),
      );
    }),
  );
}

function react(m, emoji) {
  // The list refreshes itself when the main process reports the change.
  okv.react({ id: m.id, emoji }).catch(() => toast('Couldn’t add that reaction'));
}

// ---------- Deleting ----------

/** Shows (or hides) the "Delete: For me / For everyone" row under a message. */
function toggleDeleteChoices(article, m) {
  const open = article.querySelector('.msg-confirm');
  for (const row of el.list.querySelectorAll('.msg-confirm')) {
    row.closest('.msg').classList.remove('is-confirming');
    row.remove();
  }
  if (open) return;
  const ours = m.from === state.settings.department;
  const row = h(
    'div',
    { class: 'msg-confirm' },
    h('span', { class: 'msg-confirm-label' }, 'Delete'),
    h('button', { type: 'button', class: 'chip', onclick: () => deleteMessage(m, 'me') }, 'For me'),
    ours ? h('button', { type: 'button', class: ['chip', 'is-danger'], onclick: () => deleteMessage(m, 'everyone') }, 'For everyone') : null,
    h(
      'button',
      {
        type: 'button',
        class: 'chip is-quiet',
        onclick: () => {
          row.remove();
          article.classList.remove('is-confirming');
        },
      },
      'Cancel',
    ),
    ours ? null : h('span', { class: 'msg-confirm-hint' }, `Only ${deptLabel(m.from)} can delete it for everyone`),
  );
  article.classList.add('is-confirming');
  article.append(row);
  row.querySelector('button').focus();
}

async function deleteMessage(m, scope) {
  try {
    await okv.deleteMessage({ id: m.id, scope });
    // The list refreshes itself when the main process reports the change.
    toast(scope === 'me' ? 'Deleted on this computer' : 'Deleted for everyone', {
      label: 'Undo',
      run: () => okv.undoDelete({ id: m.id, scope }).catch(() => toast('Couldn’t undo that')),
    });
  } catch {
    toast('Couldn’t delete that message');
  }
}

function emptyNode() {
  if (state.search) return h('div', { class: 'empty' }, h('strong', null, 'No matches'), `Nothing found for “${state.search}”.`);
  const text = {
    all: ['No messages yet', 'Messages from every department will appear here. Write the first one below.'],
    'to-us': ['Nothing for you yet', `Messages sent directly to ${deptLabel(state.settings.department)} will appear here.`],
    'from-us': ['Nothing sent yet', `Messages sent by ${deptLabel(state.settings.department)} will appear here.`],
    urgent: ['No urgent messages', 'Messages marked urgent will appear here.'],
  }[state.filter];
  return h('div', { class: 'empty' }, h('strong', null, text[0]), text[1]);
}

// ---------- Days ----------

function groupByDay(messages) {
  const groups = [];
  for (const m of messages) {
    const key = dayKey(m.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.messages.push(m);
    else groups.push({ key, first: m.createdAt, messages: [m] });
  }
  return groups;
}

/** Local midnight-to-midnight bounds of the day containing `ts`. */
function dayBounds(ts) {
  const d = new Date(ts);
  return {
    start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
  };
}

/** Today is open and earlier days are folded, unless the user changed it. Searches show everything. */
function isDayOpen(key) {
  if (state.search) return true;
  const chosen = state.dayOpen.get(key);
  return chosen === undefined ? key === dayKey(Date.now()) : chosen;
}

function toggleDay(key) {
  state.dayOpen.set(key, !isDayOpen(key));
  renderList({ anchorDay: key });
}

/**
 * A day's banner. While the day is open it sticks to the top of the list as
 * you scroll through it, so it can be folded from anywhere in the day.
 */
function dayHeader(group, open) {
  const n = group.messages.length;
  const urgent = group.messages.filter((m) => m.urgent).length;
  const fresh = group.messages.filter(isNew).length;
  return h(
    'div',
    { class: ['day', open && 'is-open'] },
    h(
      'div',
      { class: 'day-bar' },
      h(
        'button',
        {
          type: 'button',
          class: 'day-toggle',
          'aria-expanded': String(open),
          title: open ? 'Click to fold this day away' : 'Click to show these messages',
          onclick: () => toggleDay(group.key),
        },
        h('span', { class: 'day-chevron' }),
        h('span', { class: 'day-label' }, dayLabel(group.first)),
        h('span', { class: 'day-count' }, `${n} message${n === 1 ? '' : 's'}`),
        !open && urgent ? h('span', { class: 'day-flag is-urgent' }, `${urgent} urgent`) : null,
        !open && fresh ? h('span', { class: 'day-flag is-new' }, `${fresh} new`) : null,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'day-delete',
          title: `Delete ${dayLabel(group.first)}’s messages`,
          'aria-label': `Delete ${dayLabel(group.first)}’s messages`,
          onclick: (e) => toggleDayDeleteChoices(e.currentTarget.closest('.day-group'), group),
        },
        icon('trash'),
      ),
    ),
  );
}

/** Shows (or hides) the "Delete Yesterday's messages: For me / Ours for everyone" row. */
function toggleDayDeleteChoices(section, group) {
  const open = section.querySelector('.day-confirm');
  for (const row of el.list.querySelectorAll('.day-confirm')) row.remove();
  if (open) return;
  const me = state.settings.department;
  const ours = group.messages.some((m) => m.from === me);
  const label = dayLabel(group.first);
  const name = label === 'Today' || label === 'Yesterday' ? label.toLowerCase() : label;
  const row = h(
    'div',
    { class: 'day-confirm' },
    h('span', { class: 'msg-confirm-label' }, `Delete ${name}’s messages`),
    h('button', { type: 'button', class: 'chip', onclick: () => deleteDay(group, 'me') }, 'For me'),
    ours
      ? h(
          'button',
          { type: 'button', class: ['chip', 'is-danger'], onclick: () => deleteDay(group, 'everyone') },
          'Ours for everyone',
        )
      : null,
    h('button', { type: 'button', class: 'chip is-quiet', onclick: () => row.remove() }, 'Cancel'),
    h(
      'span',
      { class: 'msg-confirm-hint' },
      ours
        ? `“For me” hides all of them on this computer. “Ours for everyone” removes the ones ${deptLabel(me)} sent, from every computer.`
        : `Hides all of them on this computer. Only the departments that sent them can delete them for everyone.`,
    ),
  );
  section.querySelector('.day').append(row);
  row.querySelector('button').focus();
}

/** Deletes every message shown under a day's banner (respecting the current tab and search). */
async function deleteDay(group, scope) {
  try {
    const { ids } = await okv.deleteDay({ ...dayBounds(group.first), scope, filter: state.filter, search: state.search });
    if (!ids.length) {
      toast('Nothing to delete');
      return;
    }
    const n = `${ids.length} message${ids.length === 1 ? '' : 's'}`;
    toast(scope === 'me' ? `${n} deleted on this computer` : `${n} deleted for everyone`, {
      label: 'Undo',
      run: () => okv.undoDeleteMany({ ids, scope }).catch(() => toast('Couldn’t undo that')),
    });
  } catch {
    toast('Couldn’t delete those messages');
  }
}

/**
 * Redraws the message list. `anchorDay` keeps that day's banner where it was
 * on screen (used when a day is opened or folded).
 */
function renderList({ toBottom = false, keepTop = false, anchorDay = null } = {}) {
  const list = el.list;
  const gapBelow = list.scrollHeight - list.scrollTop - list.clientHeight;
  const oldTop = list.scrollTop;
  const oldHeight = list.scrollHeight;
  // Where the banner appears on screen right now (it may be stuck to the top).
  const anchor = anchorDay && list.querySelector(`.day-group[data-day="${anchorDay}"] .day`);
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top - list.getBoundingClientRect().top : null;

  const nodes = [];
  if (state.more) nodes.push(h('button', { type: 'button', class: ['link-btn', 'older'], onclick: loadOlder }, 'Show older messages'));
  if (!state.messages.length) nodes.push(emptyNode());
  for (const group of groupByDay(state.messages)) {
    const open = isDayOpen(group.key);
    nodes.push(
      h(
        'section',
        { class: 'day-group', 'data-day': group.key },
        dayHeader(group, open),
        ...(open ? group.messages.map(messageNode) : []),
      ),
    );
  }
  list.replaceChildren(...nodes);
  observeSeen();

  // Put the banner back where it was, measured from its day's (non-sticky) start.
  const newAnchor = anchorOffset !== null && list.querySelector(`.day-group[data-day="${anchorDay}"]`);
  if (newAnchor) {
    list.scrollTop = newAnchor.offsetTop - anchorOffset;
  } else if (toBottom || gapBelow < 60) {
    list.scrollTop = list.scrollHeight;
    el.jump.hidden = true;
  } else if (keepTop) {
    list.scrollTop = list.scrollHeight - oldHeight + oldTop;
  } else {
    list.scrollTop = oldTop;
  }
}

el.list.addEventListener('scroll', () => {
  if (el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 60) el.jump.hidden = true;
});

el.jump.addEventListener('click', () => {
  el.list.scrollTop = el.list.scrollHeight;
  el.jump.hidden = true;
});

// ---------- Filters & search ----------

el.filters.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  for (const b of el.filters.querySelectorAll('button')) b.setAttribute('aria-selected', String(b === button));
  state.messages = [];
  refresh({ toBottom: true });
});

function openSearch() {
  el.filters.hidden = true;
  el.searchBox.hidden = false;
  el.search.focus();
  el.search.select();
}

function closeSearch() {
  el.search.value = '';
  el.searchBox.hidden = true;
  el.filters.hidden = false;
  if (state.search) {
    state.search = '';
    state.messages = [];
    refresh({ toBottom: true });
  }
}

el.toggleSearch.addEventListener('click', () => (el.searchBox.hidden ? openSearch() : closeSearch()));

let searchTimer;
el.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = el.search.value.trim();
    state.messages = [];
    refresh({ toBottom: true });
  }, 180);
});

// ---------- Compose ----------

function renderComposeTargets() {
  const current = el.to.value || 'all';
  el.to.replaceChildren(
    h('option', { value: 'all' }, 'Everyone'),
    ...state.departments.map((d) => h('option', { value: d.id }, d.label)),
  );
  el.to.value = current;
  updatePlaceholder();
}

function updatePlaceholder() {
  el.text.placeholder = state.reply ? 'Write your reply…' : el.to.value === 'all' ? 'Message everyone…' : `Message ${toLabel(el.to.value)}…`;
}

function setUrgent(value) {
  state.urgent = value;
  el.urgent.setAttribute('aria-pressed', String(value));
  el.compose.classList.toggle('is-urgent', value);
}

function autoGrow() {
  el.text.style.height = 'auto';
  el.text.style.height = `${Math.min(el.text.scrollHeight + 2, 132)}px`;
}

function updateSendState() {
  el.send.disabled = state.sending || (!el.text.value.trim() && !state.gif && !state.pendingFiles.length);
}

// ---------- Seen-by, edits, quick messages, quiet mode, pinned notice ----------

/** The readable part of an error thrown by the main process. */
const errText = (err) => String((err && err.message) || err).split('Error: ').pop();

// Seen: a message counts as seen once it has been on screen for a second while the board is in use.
let lastActive = Date.now();
for (const type of ['pointermove', 'pointerdown', 'keydown']) {
  document.addEventListener(type, () => (lastActive = Date.now()), { passive: true, capture: true });
}
window.addEventListener('focus', () => (lastActive = Date.now()));
const seenTimers = new Map();
const pendingSeen = new Set();
let flushSeenTimer = null;
const boardInUse = () => state.expanded && state.screen === 'board' && (document.hasFocus() || Date.now() - lastActive < 5 * 60 * 1000);

function flushSeen() {
  flushSeenTimer = null;
  if (!pendingSeen.size) return;
  const ids = [...pendingSeen];
  pendingSeen.clear();
  okv.markSeen(ids).catch(() => {});
}

const seenObserver = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      const id = en.target.dataset.id;
      const tall = en.rootBounds ? en.rootBounds.height * 0.5 : Infinity; // a long message counts when half the list is it
      const enough = en.isIntersecting && (en.intersectionRatio >= 0.6 || en.intersectionRect.height >= tall);
      if (enough) {
        if (seenTimers.has(id)) continue;
        seenTimers.set(
          id,
          setTimeout(() => {
            seenTimers.delete(id);
            if (!boardInUse()) return;
            pendingSeen.add(id);
            flushSeenTimer = flushSeenTimer || setTimeout(flushSeen, 400);
          }, 1000),
        );
      } else if (seenTimers.has(id)) {
        clearTimeout(seenTimers.get(id));
        seenTimers.delete(id);
      }
    }
  },
  { root: el.list, threshold: [0, 0.3, 0.6, 1] },
);

/** Watches the messages sent to us that this department hasn't been marked as seeing yet. */
function observeSeen() {
  seenObserver.disconnect();
  for (const timer of seenTimers.values()) clearTimeout(timer);
  seenTimers.clear();
  for (const node of el.list.querySelectorAll('.msg[data-unseen]')) seenObserver.observe(node);
}

/** Under a message we sent: who has seen it. */
function seenNode(m) {
  if (!m.seen) return null;
  const { intended, seen } = m.seen;
  const seenDepts = seen.map((x) => x.dept);
  const waiting = intended.filter((d) => !seenDepts.includes(d));
  let text;
  if (m.to !== 'all') {
    text = seen.length ? `✓ Seen by ${deptLabel(m.to)} · ${timeFmt.format(seen[0].at)}` : `Not seen yet by ${deptLabel(m.to)}`;
  } else if (!seen.length) {
    text = 'Not seen yet';
  } else if (!waiting.length) {
    text = '✓ Seen by everyone';
  } else {
    text = `✓ Seen by ${seen.map((x) => deptLabel(x.dept)).join(', ')}`;
  }
  const details = [...seen.map((x) => `${deptLabel(x.dept)} saw it at ${timeFmt.format(x.at)}`), ...(waiting.length ? [`Not yet: ${waiting.map(deptLabel).join(', ')}`] : [])];
  return h('div', { class: ['msg-seen', seen.length && !waiting.length && 'is-all', !seen.length && 'is-none'], title: details.join('\n') }, text);
}

// --- editing a message ---

const canEdit = (m) => m.from === state.settings.department && Date.now() - m.createdAt <= state.editWindowMs;

function editorNode(m) {
  if (state.editDraft === null) state.editDraft = isMediaOnly(m) ? '' : m.text;
  const save = h('button', { type: 'button', class: 'chip is-done', onclick: () => saveEdit(m) }, 'Save');
  const box = h('textarea', { class: 'msg-edit-input', rows: '2', maxlength: '4000', 'aria-label': 'Edit message' });
  box.value = state.editDraft;
  save.disabled = !box.value.trim();
  box.addEventListener('input', () => {
    state.editDraft = box.value;
    save.disabled = !box.value.trim();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      saveEdit(m);
    }
  });
  return h(
    'div',
    { class: 'msg-edit' },
    box,
    h('div', { class: 'msg-edit-actions' }, save, h('button', { type: 'button', class: 'chip is-quiet', onclick: cancelEdit }, 'Cancel'), h('span', { class: 'msg-edit-hint' }, 'Enter saves · Esc cancels')),
  );
}

function startEdit(m) {
  closeMessageMenus();
  state.editing = m.id;
  state.editDraft = null;
  renderList();
  const box = el.list.querySelector('.msg-edit-input');
  if (box) {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    box.scrollIntoView({ block: 'nearest' });
  }
}

function cancelEdit() {
  state.editing = null;
  state.editDraft = null;
  renderList();
}

async function saveEdit(m) {
  const text = (state.editDraft ?? '').trim();
  if (!text) return;
  try {
    if (text !== m.text) await okv.editMessage({ id: m.id, text });
    state.editing = null;
    state.editDraft = null;
    await refresh();
  } catch (err) {
    toast(errText(err));
  }
}

// --- the "more" menu on a message ---

function closeMessageMenus() {
  for (const menu of el.list.querySelectorAll('.msg-menu')) {
    menu.closest('.msg').classList.remove('menu-open');
    menu.remove();
  }
}

function toggleMessageMenu(article, m) {
  const wasOpen = Boolean(article.querySelector('.msg-menu'));
  closeMessageMenus();
  if (wasOpen) return;
  const item = (label, iconName, run) =>
    h(
      'button',
      {
        type: 'button',
        class: 'msg-menu-item',
        role: 'menuitem',
        onclick: () => {
          closeMessageMenus();
          run();
        },
      },
      icon(iconName),
      label,
    );
  const items = [];
  if (canEdit(m)) items.push(item('Edit message', 'pencil', () => startEdit(m)));
  items.push(item('Pin as a notice for everyone', 'pin', () => pinFromMessage(m)));
  article.classList.add('menu-open');
  article.append(h('div', { class: 'msg-menu', role: 'menu' }, ...items));
}

document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.msg-menu, .msg-more')) closeMessageMenus();
  if (!e.target.closest('.quiet-menu, .quiet-btn')) el.quietMenu.hidden = true;
});

/** Closes whatever is floating (menus, the notice box, an edit). Returns whether there was anything to close. */
function closeFloating() {
  let closed = false;
  if (state.viewing) {
    closeViewer();
    closed = true;
  }
  if (el.list.querySelector('.msg-menu')) {
    closeMessageMenus();
    closed = true;
  }
  if (!el.quietMenu.hidden) {
    el.quietMenu.hidden = true;
    closed = true;
  }
  if (!el.pinForm.hidden) {
    el.pinForm.hidden = true;
    closed = true;
  }
  if (state.editing) {
    cancelEdit();
    closed = true;
  }
  return closed;
}

// --- quick messages ---

function renderQuick() {
  const list = state.settings.quickMessages || [];
  el.quickRow.hidden = !list.length || !state.settings.department;
  el.quickRow.replaceChildren(
    ...list.map((q) =>
      h(
        'button',
        {
          type: 'button',
          class: ['quick', q.urgent && 'is-urgent'],
          title: `Sends “${q.text}” to ${toLabel(q.to)}${q.urgent ? ' as urgent' : ''}`,
          onclick: () => sendQuick(q),
        },
        q.text,
      ),
    ),
  );
}

async function sendQuick(q) {
  try {
    const message = await okv.sendMessage({ to: q.to, text: q.text, urgent: q.urgent, author: el.author.value });
    const short = q.text.length > 34 ? `${q.text.slice(0, 34)}…` : q.text;
    toast(`Sent to ${toLabel(q.to)}: ${short}`, {
      label: 'Undo',
      run: () => okv.deleteMessage({ id: message.id, scope: 'everyone' }).catch(() => toast('Couldn’t undo that')),
    });
  } catch {
    toast('Couldn’t send that');
  }
}

function renderQuickEditor() {
  if (!state.quickDraft) state.quickDraft = (state.settings.quickMessages || []).map((q) => ({ ...q }));
  const list = state.quickDraft;
  const save = async () => {
    state.settings = await okv.setSettings({ quickMessages: list.filter((q) => q.text.trim()) });
    renderQuick();
  };
  el.quickEdit.replaceChildren(
    ...list.map((q, i) => {
      const text = h('input', { type: 'text', maxlength: '200', placeholder: 'Message', 'aria-label': 'Quick message', spellcheck: 'true' });
      text.value = q.text;
      text.addEventListener('input', () => (q.text = text.value));
      text.addEventListener('change', save);
      const to = h(
        'select',
        { 'aria-label': 'Send to' },
        h('option', { value: 'all' }, 'Everyone'),
        ...state.departments.map((d) => h('option', { value: d.id }, d.label)),
      );
      to.value = q.to;
      to.addEventListener('change', () => {
        q.to = to.value;
        save();
      });
      const urgent = h('input', { type: 'checkbox', 'aria-label': 'Urgent' });
      urgent.checked = q.urgent;
      urgent.addEventListener('change', () => {
        q.urgent = urgent.checked;
        save();
      });
      return h(
        'li',
        { class: 'quick-edit-row' },
        text,
        h('div', { class: 'quick-edit-opts' }, h('span', null, 'to'), to, h('label', { class: 'quick-urgent' }, urgent, 'Urgent'), h('button', { type: 'button', class: 'icon-btn small', title: 'Remove', 'aria-label': 'Remove this button', onclick: () => { list.splice(i, 1); save(); renderQuickEditor(); } }, icon('trash'))),
      );
    }),
  );
  el.quickAdd.disabled = list.length >= state.maxQuick;
}

el.quickAdd.addEventListener('click', () => {
  state.quickDraft.push({ text: '', to: 'all', urgent: false });
  renderQuickEditor();
  const inputs = el.quickEdit.querySelectorAll('input[type=text]');
  inputs[inputs.length - 1].focus();
});
el.quickReset.addEventListener('click', async () => {
  state.settings = await okv.setSettings({ resetQuickMessages: true });
  state.quickDraft = null;
  renderQuickEditor();
  renderQuick();
});

// --- quiet mode ---

const quietActive = () => Number.isFinite(state.settings.quietUntil) && Date.now() < state.settings.quietUntil;

function renderQuiet() {
  const on = quietActive();
  el.quietBtn.classList.toggle('is-quiet', on);
  el.quietBtn.replaceChildren(icon(on ? 'bellOff' : 'bell'), el.quietLeft);
  el.quietLeft.hidden = !on;
  if (on) {
    const minutes = Math.ceil((state.settings.quietUntil - Date.now()) / 60000);
    el.quietLeft.textContent = minutes >= 60 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`;
    el.quietBtn.title = `Quiet until ${timeFmt.format(state.settings.quietUntil)}. Click to change.`;
  } else {
    el.quietBtn.title = 'Quiet mode: mute sounds for a while';
  }
  const choose = async (minutes) => {
    state.settings = await okv.setQuiet(minutes);
    el.quietMenu.hidden = true;
    renderQuiet();
  };
  const option = (label, minutes) => h('button', { type: 'button', class: 'quiet-option', role: 'menuitem', onclick: () => choose(minutes) }, label);
  el.quietMenu.replaceChildren(
    option('Quiet for 30 minutes', 30),
    option('Quiet for 1 hour', 60),
    ...(on ? [option('Turn sounds back on', 0)] : []),
    h('p', { class: 'quiet-note' }, 'The badge still shows new messages. Urgent messages still make a sound.'),
  );
}

el.quietBtn.addEventListener('click', () => {
  el.quietMenu.hidden = !el.quietMenu.hidden;
});
setInterval(renderQuiet, 20000); // counts down, and switches itself off when the time is up

// --- the notice pinned at the top ---

function renderPin() {
  const pin = state.pin;
  el.pinBanner.hidden = !pin;
  if (pin) {
    el.pinText.textContent = pin.text;
    el.pinMeta.textContent = `Pinned by ${deptLabel(pin.by)}${pin.name ? ` · ${pin.name}` : ''} · ${whenLabel(pin.at)}`;
  }
}

async function refreshPin() {
  state.pin = await okv.getPin();
  renderPin();
}

async function setNotice(text, undoTo) {
  try {
    state.pin = await okv.setPin(text);
    renderPin();
    toast('Pinned for everyone', {
      label: 'Undo',
      run: async () => {
        state.pin = undoTo ? await okv.setPin(undoTo.text) : await okv.clearPin();
        renderPin();
      },
    });
  } catch (err) {
    toast(errText(err));
  }
}

function pinFromMessage(m) {
  if (isMediaOnly(m)) {
    toast('That message has no text to pin');
    return;
  }
  const text = m.text.length > 300 ? `${m.text.slice(0, 299).trimEnd()}…` : m.text;
  setNotice(text, state.pin);
}

el.togglePin.addEventListener('click', () => {
  el.pinForm.hidden = !el.pinForm.hidden;
  if (!el.pinForm.hidden) el.pinInput.focus();
});
el.pinCancel.addEventListener('click', () => (el.pinForm.hidden = true));
el.pinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = el.pinInput.value.trim();
  if (!text) return;
  el.pinForm.hidden = true;
  el.pinInput.value = '';
  await setNotice(text, state.pin);
});
el.pinClear.addEventListener('click', async () => {
  const old = state.pin;
  state.pin = await okv.clearPin();
  renderPin();
  toast('Notice taken down', {
    label: 'Undo',
    run: async () => {
      state.pin = await okv.setPin(old.text);
      renderPin();
    },
  });
});

// --- computers on the network, and history ---

async function loadPeerReport() {
  state.peerReport = await okv.peersReport();
  renderPeerReport();
}

/** Negative if version a is older than b. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function agoLabel(ts) {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return whenLabel(ts);
}

function renderPeerReport() {
  const report = state.peerReport;
  if (!report) return;
  const { self, peers } = report;
  el.peerSelf.textContent = `This computer: ${self.host}${self.dept ? ` · ${deptLabel(self.dept)}` : ''} · version ${self.version}`;
  if (!peers.length) {
    el.peerList.replaceChildren(h('li', null, h('span', { class: 'peer-empty' }, `No other computers seen yet. They appear here automatically while ${state.productName} is running on them.`)));
    return;
  }
  el.peerList.replaceChildren(
    ...peers.map((p) => {
      let versionText;
      let versionClass;
      if (!p.ver) [versionText, versionClass] = ['older version', 'is-old'];
      else if (compareVersions(p.ver, self.version) < 0) [versionText, versionClass] = [`${p.ver} · needs update`, 'is-old'];
      else [versionText, versionClass] = [`${p.ver}`, 'is-current'];
      const status = p.online ? (p.reachable === false ? 'online, but not accepting connections' : 'online') : `offline · last seen ${agoLabel(p.lastSeen)}`;
      return h(
        'li',
        { class: ['peer', `dept-${p.dept}`, !p.online && 'is-offline'], title: p.reachable === false ? 'Seen, but not accepting connections (check its firewall)' : null },
        h('span', { class: ['peer-dot', p.online && 'is-online'] }),
        h('div', { class: 'peer-main' }, h('span', { class: 'peer-name' }, p.host || p.address), h('span', { class: 'peer-sub' }, `${p.dept ? deptLabel(p.dept) : 'No department'} · ${status}`)),
        h('span', { class: ['peer-ver', versionClass] }, versionText),
      );
    }),
  );
}
setInterval(() => {
  if (state.expanded && state.screen === 'settings') loadPeerReport();
}, 15000);

function renderHistorySection() {
  el.tidyNote.textContent = `Messages and GIFs older than ${state.retentionDays} days are archived automatically on every computer. They leave the board but are kept in the archive folder, and “Everything” exports include them.`;
  el.historyResult.hidden = true;
}

function showHistoryResult(text) {
  el.historyResult.textContent = text;
  el.historyResult.hidden = false;
}

el.exportBtn.addEventListener('click', async () => {
  el.exportBtn.disabled = true;
  try {
    const result = await okv.exportMessages({ range: el.exportRange.value });
    if (!result.canceled) showHistoryResult(`Saved ${result.count} message${result.count === 1 ? '' : 's'} to ${result.path}`);
  } catch {
    showHistoryResult('Couldn’t save that. Please try again.');
  } finally {
    el.exportBtn.disabled = false;
  }
});

el.backupBtn.addEventListener('click', async () => {
  el.backupBtn.disabled = true;
  try {
    const result = await okv.backupHistory();
    if (!result.canceled) showHistoryResult(`Backup saved (${result.files} files, ${formatSize(result.bytes)}) in ${result.path}`);
  } catch {
    showHistoryResult('Couldn’t make the backup. Please try again.');
  } finally {
    el.backupBtn.disabled = false;
  }
});

el.openArchive.addEventListener('click', () => okv.openArchiveFolder());

// A notice was pinned or taken down on another computer.
okv.onPinsChanged(({ alert }) => {
  refreshPin();
  if (alert) {
    chime(false);
    if (!state.expanded) bump();
  }
});

// ---------- Replies ----------

/** The quote shown above a reply: who sent the original and a snippet, which jumps to it when clicked. */
function quoteNode(m) {
  if (!m.replyTo) return null;
  const q = m.reply;
  if (!q || q.state !== 'ok') {
    const why = q && q.state === 'removed' ? 'The original message was deleted' : 'The original message is no longer available';
    return h('div', { class: 'msg-quote is-gone' }, why);
  }
  return h(
    'button',
    { type: 'button', class: ['msg-quote', `dept-${q.from}`], title: 'Go to the original message', onclick: () => jumpToMessage(q.id) },
    h('span', { class: 'msg-quote-who' }, q.author ? `${deptLabel(q.from)} · ${q.author}` : deptLabel(q.from)),
    h('span', { class: 'msg-quote-text' }, q.text || (q.gif ? 'GIF' : q.files ? (q.files === 1 ? 'Attachment' : `${q.files} attachments`) : '')),
  );
}

/** Starts a reply to a message: shows the strip above the message box and addresses the reply sensibly. */
function setReply(m) {
  const me = state.settings.department;
  const isGifOnly = isMediaOnly(m);
  state.reply = { id: m.id, from: m.from, author: m.author, text: isGifOnly ? '' : m.text.replace(/\s+/g, ' ').trim(), gif: Boolean(m.gif) };
  // Reply to whoever sent it; if it was our own message, carry on to whoever we sent it to.
  el.to.value = m.from !== me ? m.from : m.to;
  updatePlaceholder();
  el.replyWho.textContent = `Replying to ${m.from === me ? 'yourself' : deptLabel(m.from)}${m.author ? ` · ${m.author}` : ''}`;
  el.replySnippet.textContent = state.reply.text || (m.gif ? 'GIF' : m.attachments ? 'Attachment' : '');
  el.replyBar.hidden = false;
  el.text.placeholder = 'Write your reply…';
  el.text.focus();
}

function clearReply() {
  state.reply = null;
  el.replyBar.hidden = true;
  updatePlaceholder();
}

el.replyCancel.addEventListener('click', () => {
  clearReply();
  el.text.focus();
});

/** Scrolls to a message in the list (opening its day, loading older messages if needed) and highlights it. */
async function jumpToMessage(id) {
  for (let i = 0; i < 20 && !state.messages.some((m) => m.id === id) && state.more; i++) await loadOlder();
  const target = state.messages.find((m) => m.id === id);
  if (!target) {
    toast(state.filter === 'all' ? 'That message isn’t on this computer' : 'It isn’t in this list. Try the All tab.');
    return;
  }
  state.dayOpen.set(dayKey(target.createdAt), true);
  renderList();
  const node = el.list.querySelector(`.msg[data-id="${id}"]`);
  if (!node) return;
  node.scrollIntoView({ block: 'center' });
  node.classList.add('is-flash');
  setTimeout(() => node.classList.remove('is-flash'), 1800);
}

// ---------- Files and images ----------

const isMediaOnly = (m) => Boolean((m.gif && m.text === GIF_PLACEHOLDER) || (m.attachments && m.text === state.attachPlaceholder));

const fileExt = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** A short label for a file's icon, from its extension. */
function fileLabel(name) {
  const ext = fileExt(name);
  const groups = { PDF: ['pdf'], DOC: ['doc', 'docx', 'rtf', 'odt'], XLS: ['xls', 'xlsx', 'csv', 'ods'], PPT: ['ppt', 'pptx', 'odp'], ZIP: ['zip', '7z', 'rar', 'tar', 'gz'], TXT: ['txt', 'log', 'md'] };
  for (const [label, list] of Object.entries(groups)) if (list.includes(ext)) return label;
  return ext ? ext.slice(0, 4).toUpperCase() : 'FILE';
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];

/** Adds the chosen, pasted or dropped files to the message being written. Small GIFs keep animating through the GIF route. */
async function addFiles(fileList) {
  for (const file of [...fileList]) {
    const isGif = /gif$/i.test(file.type) || /\.gif$/i.test(file.name);
    if (isGif && !state.gif && file.size <= state.gifMaxBytes) await attachGif(file);
    else await addAttachment(file);
  }
}

async function addAttachment(file) {
  el.composeError.hidden = true;
  let name = String(file.name || '').split(/[\\/]/).pop().trim();
  if (!name || /^image\.(png|jpe?g|webp|bmp)$/i.test(name)) {
    // A screenshot or copied picture arrives with no useful name.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    name = `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.${ext}`;
  }
  if (state.pendingFiles.length >= state.maxAttach) return showGifError(`You can attach up to ${state.maxAttach} files to one message.`);
  if (state.blockedExt.has(fileExt(name))) return showGifError(`“${name}” can’t be sent: programs, scripts, web pages and macro files aren’t allowed.`);
  if (file.size === 0) return showGifError(`“${name}” is empty.`);
  if (file.size > state.fileMaxBytes) return showGifError(`“${name}” is ${formatSize(file.size)}. The limit is ${formatSize(state.fileMaxBytes)}.`);
  const total = state.pendingFiles.reduce((n, f) => n + f.size, 0) + file.size;
  if (total > state.attachTotal) return showGifError(`Those files are too large together. The limit is ${formatSize(state.attachTotal)} for one message.`);
  const data = await file.arrayBuffer();
  const head = new Uint8Array(data, 0, Math.min(2, data.byteLength));
  if (head[0] === 0x4d && head[1] === 0x5a) return showGifError(`“${name}” is a program, which can’t be sent.`);
  const isImage = IMAGE_TYPES.includes(file.type);
  const url = isImage ? URL.createObjectURL(new Blob([data], { type: file.type })) : null;
  state.pendingFiles.push({ name, size: file.size, data, url, isImage });
  renderPending();
  updateSendState();
  el.text.focus();
}

function renderPending() {
  el.attachList.hidden = !state.pendingFiles.length;
  el.attachList.replaceChildren(
    ...state.pendingFiles.map((f, i) =>
      h(
        'div',
        { class: 'attach-chip' },
        f.isImage ? h('img', { class: 'attach-thumb', src: f.url, alt: '' }) : h('span', { class: 'attach-ext' }, fileLabel(f.name)),
        h('span', { class: 'attach-chip-text' }, h('strong', { title: f.name }, f.name), h('small', null, formatSize(f.size))),
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn small',
            title: 'Remove',
            'aria-label': `Remove ${f.name}`,
            onclick: () => {
              if (f.url) URL.revokeObjectURL(f.url);
              state.pendingFiles.splice(i, 1);
              renderPending();
              updateSendState();
            },
          },
          h('span', { 'aria-hidden': 'true' }, '✕'),
        ),
      ),
    ),
  );
}

function clearPending() {
  for (const f of state.pendingFiles) if (f.url) URL.revokeObjectURL(f.url);
  state.pendingFiles = [];
  renderPending();
  updateSendState();
}

el.attachBtn.addEventListener('click', () => el.attachInput.click());
el.attachInput.addEventListener('change', async () => {
  await addFiles(el.attachInput.files);
  el.attachInput.value = '';
});

/** Attached files and images under a message. */
function attachmentsNode(m) {
  if (!m.attachments || !m.attachments.length) return null;
  return h('div', { class: 'msg-attachments' }, ...m.attachments.map((a) => (a.kind === 'image' ? imageAttachment(m, a) : fileAttachment(m, a))));
}

function imageAttachment(m, a) {
  if (!a.have) return h('div', { class: 'att-image-wait' }, a.expired ? 'Image archived (older than a week)' : 'Image is on its way…');
  const img = h('img', { class: 'att-image', src: `okv-file://${a.hash}`, alt: a.name, width: a.w, height: a.h, draggable: 'false' });
  img.addEventListener('error', () => img.closest('.att-image-btn').replaceWith(fileAttachment(m, a))); // can't be drawn: show it as a file
  return h(
    'button',
    { type: 'button', class: 'att-image-btn', title: `${a.name} · ${formatSize(a.size)}. Click to enlarge`, onclick: () => openViewer({ src: `okv-file://${a.hash}`, file: a, message: m }) },
    img,
  );
}

function fileAttachment(m, a) {
  const note = !a.have ? (a.expired ? 'Archived (older than a week)' : 'On its way…') : formatSize(a.size);
  return h(
    'div',
    { class: ['att-file', !a.have && 'is-missing'] },
    h('span', { class: 'att-icon' }, fileLabel(a.name)),
    h('div', { class: 'att-meta' }, h('span', { class: 'att-name', title: a.name }, a.name), h('small', null, note)),
    a.have ? h('div', { class: 'att-actions' }, h('button', { type: 'button', class: 'chip', onclick: () => openAttachment(a) }, 'Open'), h('button', { type: 'button', class: 'chip', onclick: () => saveAttachment(a) }, 'Save a copy')) : null,
  );
}

function openAttachment(a) {
  okv.openFile({ hash: a.hash, name: a.name }).catch((err) => toast(errText(err)));
}

async function saveAttachment(a) {
  try {
    const result = await okv.saveFile({ hash: a.hash, name: a.name });
    if (!result.canceled) toast(`Saved ${a.name}`);
  } catch (err) {
    toast(errText(err));
  }
}

// --- the picture viewer ---

/** Opens a picture large. `file` is the attachment (absent for a GIF), `message` the message it came from. */
function openViewer({ src, file, message }) {
  state.viewing = { file, message };
  el.viewerImg.src = src;
  const who = `${deptLabel(message.from)}${message.author ? ` · ${message.author}` : ''} · ${whenLabel(message.createdAt)}`;
  el.viewerTitle.textContent = file ? `${file.name} · ${formatSize(file.size)} · ${who}` : `GIF · ${who}`;
  el.viewerSave.hidden = !file;
  el.viewerOpen.hidden = !file;
  el.viewer.hidden = false;
}

function closeViewer() {
  state.viewing = null;
  el.viewer.hidden = true;
  el.viewerImg.removeAttribute('src');
}

el.viewerClose.addEventListener('click', closeViewer);
el.viewerStage.addEventListener('click', (e) => {
  if (e.target === el.viewerStage) closeViewer();
});
el.viewerSave.addEventListener('click', () => state.viewing && state.viewing.file && saveAttachment(state.viewing.file));
el.viewerOpen.addEventListener('click', () => state.viewing && state.viewing.file && openAttachment(state.viewing.file));
el.viewerShow.addEventListener('click', () => {
  const id = state.viewing && state.viewing.message.id;
  closeViewer();
  if (id) showMessageInChat(id);
});

/** Goes to the Messages tab and scrolls to a message (for "Show in chat" from Media). */
async function showMessageInChat(id) {
  showScreen('board');
  closeSearch();
  state.filter = 'all';
  for (const b of el.filters.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.filter === 'all'));
  await refresh({ toBottom: true });
  await jumpToMessage(id);
}

// ---------- Media tab ----------

let mediaRequest = 0;

async function refreshMedia() {
  if (!state.settings.department) return;
  const mine = ++mediaRequest;
  const result = await okv.listMedia({ filter: state.mediaFilter, search: state.mediaSearch });
  if (mine !== mediaRequest) return; // a newer request has been made; don't let this older answer overwrite it
  state.media = result;
  renderMedia();
}

function renderMedia() {
  const { items, counts, more } = state.media;
  for (const b of el.mediaFilters.querySelectorAll('button')) {
    b.querySelector('.count').textContent = counts[b.dataset.mfilter];
    b.setAttribute('aria-selected', String(b.dataset.mfilter === state.mediaFilter));
  }
  el.mediaNote.textContent = `Files and images shared in chat are kept here for ${state.attachRetention} days, then archived automatically (they stay in the archive folder and in backups).`;

  const isPicture = (x) => x.kind === 'image' || x.kind === 'gif';
  const pictures = items.filter(isPicture);
  const documents = items.filter((x) => !isPicture(x));
  const nodes = [];
  if (!items.length) {
    nodes.push(
      h(
        'div',
        { class: 'empty' },
        h('strong', null, state.mediaSearch ? 'No matches' : 'Nothing shared yet'),
        state.mediaSearch ? `No files or images match “${state.mediaSearch}”.` : 'Images and files you attach to messages (the paperclip, or paste or drop them) appear here.',
      ),
    );
  }
  if (pictures.length) {
    nodes.push(h('h4', { class: 'media-heading' }, `Images · ${pictures.length}`), h('div', { class: 'media-grid' }, ...pictures.map(mediaTile)));
  }
  if (documents.length) {
    nodes.push(h('h4', { class: 'media-heading' }, `Files · ${documents.length}`), h('div', { class: 'media-files' }, ...documents.map(mediaRow)));
  }
  if (more) nodes.push(h('p', { class: 'media-note' }, 'Showing the newest items. Use the search to find older ones.'));
  el.mediaList.replaceChildren(...nodes);
}

function mediaWho(x) {
  return `${deptLabel(x.from)}${x.author ? ` · ${x.author}` : ''} · ${whenLabel(x.createdAt)}`;
}

function mediaTile(x) {
  const message = { id: x.messageId, from: x.from, author: x.author, createdAt: x.createdAt };
  const src = x.kind === 'gif' ? `okv-gif://${x.hash}` : `okv-file://${x.hash}`;
  if (!x.present) return h('div', { class: 'media-tile is-missing', title: mediaWho(x) }, x.archived ? 'Archived' : 'On its way…');
  const file = x.kind === 'gif' ? undefined : { hash: x.hash, name: x.name, size: x.size };
  return h(
    'button',
    { type: 'button', class: 'media-tile', title: `${x.name} · ${mediaWho(x)}`, onclick: () => openViewer({ src, file, message }) },
    h('img', { src, alt: x.name, draggable: 'false' }),
    h('span', { class: 'media-tile-cap' }, mediaWho(x)),
  );
}

function mediaRow(x) {
  const a = { hash: x.hash, name: x.name, size: x.size };
  const note = !x.present ? (x.archived ? 'Archived (older than a week)' : 'On its way…') : formatSize(x.size);
  return h(
    'div',
    { class: ['att-file', 'media-row', !x.present && 'is-missing'] },
    h('span', { class: 'att-icon' }, fileLabel(x.name)),
    h('div', { class: 'att-meta' }, h('span', { class: 'att-name', title: x.name }, x.name), h('small', null, `${note} · ${mediaWho(x)}`)),
    h(
      'div',
      { class: 'att-actions' },
      x.present ? h('button', { type: 'button', class: 'chip', onclick: () => openAttachment(a) }, 'Open') : null,
      x.present ? h('button', { type: 'button', class: 'chip', onclick: () => saveAttachment(a) }, 'Save a copy') : null,
      h('button', { type: 'button', class: 'chip is-quiet', onclick: () => showMessageInChat(x.messageId) }, 'Show in chat'),
    ),
  );
}

el.mediaFilters.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-mfilter]');
  if (!button) return;
  state.mediaFilter = button.dataset.mfilter;
  refreshMedia();
});

let mediaSearchTimer;
el.mediaSearch.addEventListener('input', () => {
  clearTimeout(mediaSearchTimer);
  mediaSearchTimer = setTimeout(() => {
    state.mediaSearch = el.mediaSearch.value.trim();
    refreshMedia();
  }, 180);
});

// ---------- GIFs ----------

const GIF_PLACEHOLDER = '[GIF]'; // must match the main process

const formatSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** A GIF in a message, drawn from the file kept on this computer; "arriving" while it's still being fetched from another PC. */
function gifNode(m) {
  if (!m.gif) return null;
  const { hash, w, h: height } = m.gif;
  const wrap = h('div', { class: 'msg-gif' });
  const img = h('img', {
    class: 'msg-gif-img',
    src: `okv-gif://${hash}`,
    alt: m.text === GIF_PLACEHOLDER ? 'GIF' : m.text,
    width: w,
    height,
    draggable: 'false',
  });
  img.addEventListener('error', () => {
    // Not here yet; it's refreshed when the file arrives (see onGifReady).
    wrap.classList.add('is-missing');
    img.replaceWith(h('div', { class: 'msg-gif-wait' }, 'GIF is on its way…'));
  });
  wrap.append(img);
  return wrap;
}

function showGifError(text) {
  el.composeError.textContent = text;
  el.composeError.hidden = false;
}

function clearGif() {
  if (state.gif) URL.revokeObjectURL(state.gif.url);
  state.gif = null;
  el.gifAttached.hidden = true;
  el.gifThumb.removeAttribute('src');
  updateSendState();
}

/** Checks a chosen file really is a GIF within the size limit, and attaches it to the message being written. */
async function attachGif(file) {
  if (!file) return;
  el.composeError.hidden = true;
  if (file.size > state.gifMaxBytes) {
    showGifError(`That GIF is ${formatSize(file.size)}. The limit is ${formatSize(state.gifMaxBytes)}.`);
    return;
  }
  const data = await file.arrayBuffer();
  const header = new TextDecoder('latin1').decode(new Uint8Array(data, 0, Math.min(6, data.byteLength)));
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    showGifError('That file isn’t a GIF.');
    return;
  }
  clearGif();
  const url = URL.createObjectURL(new Blob([data], { type: 'image/gif' }));
  state.gif = { data, name: file.name, size: file.size, url };
  el.gifThumb.src = url;
  el.gifName.textContent = file.name;
  el.gifSize.textContent = formatSize(file.size);
  el.gifAttached.hidden = false;
  updateSendState();
  el.text.focus();
}

el.gifRemove.addEventListener('click', () => {
  clearGif();
  el.text.focus();
});

/**
 * Looks in pasted web content for a GIF: a picture embedded in it (a data: address), or a link to one
 * on a website. The Windows emoji panel's GIF tab and web pages can hand a GIF over in these ways.
 */
function gifFromHtml(html) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: nothing in it is loaded
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    const data = /^data:image\/gif;base64,([A-Za-z0-9+/=]+)$/i.exec(src);
    if (data) return { bytes: Uint8Array.from(atob(data[1]), (c) => c.charCodeAt(0)) };
    if (/^https:\/\//i.test(src) && (/\.gif(\?|#|$)/i.test(src) || /(tenor|giphy)\.com/i.test(src))) return { url: src };
  }
  return null;
}

/** What a paste contained, in words, for the log. */
function describePaste(cd, html) {
  const files = [...cd.files].map((f) => `${f.name || '(unnamed)'}:${f.type || '?'}:${f.size}`);
  return `paste could not be used as a GIF. types=[${[...cd.types].join(', ')}] files=[${files.join(', ')}] html=${html ? html.slice(0, 300).replace(/\s+/g, ' ') : '(none)'}`;
}

// Pasting (Ctrl+V, or choosing a GIF in the Windows emoji panel with Win + ;) attaches a GIF if the paste holds one.
// Ordinary text pastes are left alone.
document.addEventListener('paste', async (e) => {
  if (!state.expanded || state.screen !== 'board' || !e.clipboardData) return;
  const cd = e.clipboardData;
  const files = [...cd.files];
  const html = cd.getData('text/html');

  const gifFile = files.find((f) => f.type === 'image/gif' || /\.gif$/i.test(f.name));
  if (gifFile) {
    e.preventDefault();
    attachGif(gifFile);
    return;
  }

  const found = gifFromHtml(html);
  if (found) {
    e.preventDefault();
    try {
      if (found.bytes) {
        await attachGif(new File([found.bytes], 'pasted.gif', { type: 'image/gif' }));
      } else {
        toast('Getting that GIF…');
        const got = await okv.fetchGifUrl(found.url);
        await attachGif(new File([got.data], got.name, { type: 'image/gif' }));
      }
    } catch (err) {
      // Say why when we know (too big, not a GIF, the site refused); otherwise suggest the fallback.
      const reason = errText(err);
      const known = /too large|isn’t a GIF|The site answered|valid link|can’t be used/.test(reason);
      showGifError(known ? `Couldn’t use that GIF: ${reason}.` : 'Couldn’t get that GIF. It may need internet on this computer. Saving it as a file and attaching it with the paperclip works too.');
      okv.logNote(`${describePaste(cd, html)} reason=${reason.slice(0, 200)}`);
    }
    return;
  }

  if (files.length) {
    // Pictures (a screenshot, say) and files copied in Explorer attach to the message.
    e.preventDefault();
    addFiles(files);
  }
});

// Dropping a GIF file anywhere on the board attaches it.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (state.expanded && state.screen === 'board') addFiles(e.dataTransfer.files);
});

el.to.addEventListener('change', updatePlaceholder);
el.urgent.addEventListener('click', () => setUrgent(!state.urgent));
el.text.addEventListener('input', () => {
  autoGrow();
  updateSendState();
  el.composeError.hidden = true;
});
el.text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.compose.requestSubmit();
  }
});
el.author.addEventListener('change', async () => {
  state.settings = await okv.setSettings({ author: el.author.value });
});

el.compose.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = el.text.value.trim();
  if ((!text && !state.gif && !state.pendingFiles.length) || state.sending) return;
  state.sending = true;
  updateSendState();
  try {
    await okv.sendMessage({
      to: el.to.value,
      text,
      urgent: state.urgent,
      author: el.author.value,
      gif: state.gif ? { data: state.gif.data } : undefined,
      files: state.pendingFiles.length ? state.pendingFiles.map((f) => ({ name: f.name, data: f.data })) : undefined,
      replyTo: state.reply ? state.reply.id : undefined,
    });
    clearGif();
    clearPending();
    clearReply();
    el.text.value = '';
    autoGrow();
    setUrgent(false);
    if (state.filter !== 'all' && state.filter !== 'from-us') {
      toast('Sent');
    }
  } catch (err) {
    const reason = errText(err);
    // Reasons about the files themselves are worth showing; anything else gets the usual message.
    el.composeError.textContent = /file|attach|GIF|MB/i.test(reason) ? reason : 'Message not sent. Please try again.';
    el.composeError.hidden = false;
  } finally {
    state.sending = false;
    updateSendState();
    el.text.focus();
  }
});

// ---------- Reminders ----------

const shortDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** "3:00 pm" today, otherwise "Mon 28 Sep, 3:00 pm". */
function whenLabel(ts) {
  return dayKey(ts) === dayKey(Date.now()) ? timeFmt.format(ts) : `${shortDayFmt.format(ts)}, ${timeFmt.format(ts)}`;
}

/** "Due 3:00 pm", "Due tomorrow 9:00 am", "Overdue · was due 3:00 pm". */
function dueLabel(dueAt) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(dueAt);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((that - today) / 86400000);
  const time = timeFmt.format(dueAt);
  const when = days === 0 ? time : days === 1 ? `tomorrow ${time}` : days === -1 ? `yesterday ${time}` : `${shortDayFmt.format(dueAt)}, ${time}`;
  return dueAt <= Date.now() ? `Overdue · was due ${when}` : `Due ${when}`;
}

function renderReminderTargets() {
  const current = el.remTo.value;
  el.remTo.replaceChildren(...state.departments.map((d) => h('option', { value: d.id }, d.label)));
  // Reminders are usually for another department, so default to the first one that isn't ours.
  const other = state.departments.find((d) => d.id !== state.settings.department) || state.departments[0];
  el.remTo.value = current || (other ? other.id : '');
  loadNameSuggestions();
}

async function loadNameSuggestions() {
  const names = await okv.reminderNames(el.remTo.value);
  el.remNames.replaceChildren(...names.map((n) => h('option', { value: n })));
}

async function refreshReminders() {
  if (!state.settings.department) return;
  state.reminderList = await okv.listReminders({ view: state.remFilter });
  renderReminders();
}

function renderReminders() {
  const list = el.remList;
  const top = list.scrollTop;
  el.remClear.hidden = state.remFilter !== 'done' || !state.reminderList.length;
  list.replaceChildren(...(state.reminderList.length ? state.reminderList.map(reminderNode) : [remindersEmpty()]));
  list.scrollTop = top;
}

function remindersEmpty() {
  const text = {
    'for-us': [`Nothing for ${deptLabel(state.settings.department)}`, 'Reminders set for your team appear here until they’re done.'],
    sent: ['No open reminders sent', 'Reminders you set for other people appear here until they deal with them.'],
    all: ['No open reminders', 'Add one below: pick who it’s for, write it, and optionally set a due time.'],
    done: ['Nothing done yet', 'Reminders that are done or cancelled appear here.'],
  }[state.remFilter];
  return h('div', { class: 'empty' }, h('strong', null, text[0]), text[1]);
}

function reminderNode(r) {
  const me = state.settings.department;
  const now = Date.now();
  const open = r.state === 'open';
  const overdue = open && r.dueAt !== null && r.dueAt <= now;
  const soon = open && r.dueAt !== null && !overdue && r.dueAt - now < 3600e3;
  const forUs = r.to === me;
  const fromUs = r.from === me;

  const actions = [];
  if (open && forUs) actions.push(h('button', { type: 'button', class: 'chip is-done', onclick: () => changeReminder(r, 'done') }, '✓ Done'));
  if (open && fromUs) actions.push(h('button', { type: 'button', class: 'chip is-quiet', onclick: () => changeReminder(r, 'cancelled') }, 'Cancel'));
  if (!open && (forUs || fromUs)) actions.push(h('button', { type: 'button', class: 'chip is-quiet', onclick: () => changeReminder(r, 'open') }, 'Reopen'));

  const meta = open
    ? `From ${deptLabel(r.from)}${r.author ? ` · ${r.author}` : ''} · ${whenLabel(r.createdAt)}`
    : `${r.state === 'done' ? 'Done' : 'Cancelled'} by ${deptLabel(r.closed.by)}${r.closed.name ? ` · ${r.closed.name}` : ''} · ${whenLabel(r.closed.at)}`;

  return h(
    'article',
    { class: ['rem', `dept-${r.to}`, overdue && 'is-overdue', soon && 'is-soon', !open && 'is-closed'] },
    h(
      'header',
      { class: 'rem-head' },
      h('span', { class: 'rem-name' }, r.name || deptLabel(r.to)),
      r.name ? h('span', { class: 'rem-dept' }, deptLabel(r.to)) : null,
      open && r.dueAt !== null ? h('span', { class: 'rem-due', title: fullFmt.format(r.dueAt) }, dueLabel(r.dueAt)) : null,
    ),
    h('p', { class: 'rem-text' }, r.text),
    h('footer', { class: 'rem-foot' }, h('span', { class: 'rem-meta' }, meta), ...actions),
  );
}

async function changeReminder(r, status) {
  try {
    await okv.setReminderStatus({ id: r.id, status });
    // The list refreshes itself when the main process reports the change.
    if (status !== 'open') {
      toast(status === 'done' ? 'Marked as done' : 'Reminder cancelled', {
        label: 'Undo',
        run: () => okv.setReminderStatus({ id: r.id, status: 'open' }).catch(() => toast('Couldn’t undo that')),
      });
    }
  } catch {
    toast('Couldn’t update that reminder');
  }
}

el.remFilters.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-rfilter]');
  if (!button) return;
  state.remFilter = button.dataset.rfilter;
  for (const b of el.remFilters.querySelectorAll('button')) b.setAttribute('aria-selected', String(b === button));
  refreshReminders();
});

el.remClear.addEventListener('click', async () => {
  await okv.clearDoneReminders();
  toast('Done list cleared on this computer');
});

// --- adding a reminder ---

/** yyyy-mm-ddThh:mm in local time, as a datetime-local input wants it. */
function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function growTextarea(t) {
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight + 2, 132)}px`;
}

function updateRemAddState() {
  el.remAdd.disabled = state.remSending || !el.remText.value.trim();
}

el.remTo.addEventListener('change', loadNameSuggestions);
el.remText.addEventListener('input', () => {
  growTextarea(el.remText);
  updateRemAddState();
  el.remError.hidden = true;
});
el.remText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.remCompose.requestSubmit();
  }
});
el.remDueOn.addEventListener('change', () => {
  el.remDue.hidden = !el.remDueOn.checked;
  if (el.remDueOn.checked) {
    // Suggest an hour from now, on the quarter hour.
    if (!el.remDue.value) el.remDue.value = toLocalInput(Math.ceil((Date.now() + 3600e3) / 900e3) * 900e3);
    el.remDue.focus();
  }
});

el.remCompose.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = el.remText.value.trim();
  if (!text || state.remSending) return;
  let dueAt = null;
  if (el.remDueOn.checked) {
    dueAt = el.remDue.value ? new Date(el.remDue.value).getTime() : NaN; // datetime-local values are local time
    if (!Number.isFinite(dueAt)) {
      el.remError.textContent = 'Pick a due date and time, or untick Due.';
      el.remError.hidden = false;
      return;
    }
  }
  state.remSending = true;
  updateRemAddState();
  try {
    const to = el.remTo.value;
    const name = el.remName.value.trim();
    await okv.addReminder({ to, name, text, dueAt });
    el.remText.value = '';
    el.remName.value = '';
    el.remDueOn.checked = false;
    el.remDue.hidden = true;
    el.remDue.value = '';
    growTextarea(el.remText);
    // Let them know it was added if the current tab won't show it.
    const shown = state.remFilter === 'all' || state.remFilter === 'sent' || (state.remFilter === 'for-us' && to === state.settings.department);
    if (!shown) toast(`Reminder added for ${name || deptLabel(to)}`);
    loadNameSuggestions();
  } catch {
    el.remError.textContent = 'Reminder not added. Please try again.';
    el.remError.hidden = false;
  } finally {
    state.remSending = false;
    updateRemAddState();
    el.remText.focus();
  }
});

// Keep the waiting times on medication requests current while that list is open.
setInterval(() => {
  if (state.expanded && state.screen === 'medications') updateWaits();
}, 15000);

// Keep "due in…" labels and overdue highlighting current while the list is open.
setInterval(() => {
  if (state.expanded && state.screen === 'reminders') renderReminders();
}, 30000);

// ---------- Medications ----------

/** "Bella Smith", "Bella Smith and Rex Jones", "Bella Smith and 2 others". */
function listNames(names) {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]} and ${names.length - 1} others`;
}

async function refreshMedications() {
  if (!state.settings.department) return;
  state.medicationList = await okv.listMedications({ view: state.medFilter });
  renderMedications();
}

function renderMedications() {
  const list = el.medList;
  const top = list.scrollTop;
  el.medClear.hidden = state.medFilter !== 'done' || !state.medicationList.length;
  list.replaceChildren(...(state.medicationList.length ? state.medicationList.map(medicationNode) : [medicationsEmpty()]));
  list.scrollTop = top;
  updateWaits();
}

const WAIT_AMBER_MIN = 30;
const WAIT_RED_MIN = 60;

/** "<1 min", "25 min", "1 h 5 min", "2 h", "1 d 3 h": how long a request has been waiting. */
function waitLabel(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return min % 60 ? `${hours} h ${min % 60} min` : `${hours} h`;
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`;
}

/** Brings every open request's "waiting" time up to date in place: grey, amber after 30 minutes, red after 60. */
function updateWaits() {
  const now = Date.now();
  for (const card of el.medList.querySelectorAll('.med[data-since]')) {
    const ms = now - Number(card.dataset.since);
    const level = ms >= WAIT_RED_MIN * 60000 ? 'red' : ms >= WAIT_AMBER_MIN * 60000 ? 'amber' : 'ok';
    card.classList.toggle('is-wait-amber', level === 'amber');
    card.classList.toggle('is-wait-red', level === 'red');
    const pill = card.querySelector('.med-wait');
    pill.textContent = waitLabel(ms);
    pill.title = `Waiting since ${fullFmt.format(Number(card.dataset.since))}`;
  }
}

function medicationsEmpty() {
  const text =
    state.medFilter === 'open'
      ? ['Nothing waiting', 'When a client phones in for repeat medication, add it below and it appears here for the vets.']
      : ['Nothing done yet', 'Requests that have been ticked off or cancelled appear here.'];
  return h('div', { class: 'empty' }, h('strong', null, text[0]), text[1]);
}

/** A small icon button/mark whose drawing is trusted static SVG. */
function svgNode(tag, attrs, paths) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  return h(tag, attrs, t.content.firstChild);
}

const SVG_TICK = '<path d="m5 12.5 4.5 4.5L19 7.5"/>';
const SVG_CROSS = '<path d="M6 6l12 12M18 6 6 18"/>';
const SVG_COPY = '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>';
const SVG_PLUS = '<path d="M12 5v14M5 12h14"/>';

function medicationNode(m) {
  const me = state.settings.department;
  const open = m.state === 'open';
  const cancelled = m.state === 'cancelled';

  const meta = open
    ? `From ${deptLabel(m.from)}${m.author ? ` · ${m.author}` : ''} · ${whenLabel(m.createdAt)}`
    : `${cancelled ? 'Cancelled' : 'Completed'} by ${deptLabel(m.closed.by)}${m.closed.name ? ` · ${m.closed.name}` : ''} · ${whenLabel(m.closed.at)}`;

  const actions = [];
  if (open && m.from === me) actions.push(h('button', { type: 'button', class: 'chip is-quiet', onclick: () => changeMedication(m, 'cancelled') }, 'Cancel'));
  if (!open) actions.push(h('button', { type: 'button', class: 'chip is-quiet', onclick: () => changeMedication(m, 'open') }, 'Reopen'));

  const tick = open
    ? svgNode(
        'button',
        { type: 'button', class: 'med-tick', title: 'Tick when complete', 'aria-label': `Mark ${m.patient} as complete`, onclick: () => changeMedication(m, 'done') },
        SVG_TICK,
      )
    : svgNode('span', { class: ['med-tick', 'is-checked', cancelled && 'is-cancelled'], 'aria-hidden': 'true' }, cancelled ? SVG_CROSS : SVG_TICK);

  return h(
    'article',
    { class: ['med', !open && 'is-closed', cancelled && 'is-cancelled'], 'data-since': open ? m.createdAt : null },
    tick,
    h(
      'div',
      { class: 'med-body' },
      h('header', { class: 'med-head' }, h('span', { class: 'med-patient' }, m.patient), copyButton(m.patient, 'Copy patient name', `Copied ${m.patient}`), copyAllChip(m)),
      h(
        'ul',
        { class: 'med-items' },
        ...m.items.map((i) =>
          h(
            'li',
            null,
            h('span', { class: 'med-item-name' }, i.name),
            i.qty ? h('span', { class: 'med-item-qty' }, i.qty) : null,
            copyButton(medicationLine(i), `Copy ${i.name}`, `Copied ${i.name}`),
          ),
        ),
      ),
      h('footer', { class: 'rem-foot' }, h('span', { class: 'rem-meta' }, meta), open ? h('span', { class: 'med-wait' }) : null, ...actions),
    ),
  );
}

/** Copies text for pasting into the practice software (EzyVet). Returns whether it worked. */
async function copyToClipboard(text, notice) {
  try {
    await okv.copyText(text);
  } catch {
    toast('Couldn’t copy that');
    return false;
  }
  toast(notice);
  return true;
}

/** A small icon button that copies `text`; it shows a tick for a moment afterwards. */
function copyButton(text, title, notice) {
  const button = svgNode('button', { type: 'button', class: 'med-copy', title, 'aria-label': title }, SVG_COPY);
  let timer;
  button.addEventListener('click', async () => {
    if (!(await copyToClipboard(text, notice))) return;
    button.classList.add('is-copied');
    button.querySelector('svg').innerHTML = SVG_TICK;
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.classList.remove('is-copied');
      button.querySelector('svg').innerHTML = SVG_COPY;
    }, 1500);
  });
  return button;
}

/** "Copy all": the patient's name, then one line per medication, as tidy text (CRLF line breaks, which Windows programs expect). */
function copyAllChip(m) {
  const chip = h('button', { type: 'button', class: 'chip is-quiet med-copy-all', title: 'Copy the patient and all medications' }, 'Copy all');
  let timer;
  chip.addEventListener('click', async () => {
    if (!(await copyToClipboard(medicationText(m), `Copied ${m.patient} and ${m.items.length === 1 ? '1 medication' : `${m.items.length} medications`}`))) return;
    chip.textContent = 'Copied ✓';
    chip.classList.add('is-copied');
    clearTimeout(timer);
    timer = setTimeout(() => {
      chip.textContent = 'Copy all';
      chip.classList.remove('is-copied');
    }, 1500);
  });
  return chip;
}

const medicationLine = (i) => (i.qty ? `${i.name} - ${i.qty}` : i.name);
const medicationText = (m) => [m.patient, ...m.items.map(medicationLine)].join('\r\n');

async function changeMedication(m, status) {
  try {
    await okv.setMedicationStatus({ id: m.id, status });
    // The list refreshes itself when the main process reports the change.
    if (status !== 'open') {
      toast(status === 'done' ? `${m.patient} marked as complete` : 'Request cancelled', {
        label: 'Undo',
        run: () => okv.setMedicationStatus({ id: m.id, status: 'open' }).catch(() => toast('Couldn’t undo that')),
      });
    }
  } catch {
    toast('Couldn’t update that request');
  }
}

el.medFilters.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-medfilter]');
  if (!button) return;
  state.medFilter = button.dataset.medfilter;
  for (const b of el.medFilters.querySelectorAll('button')) b.setAttribute('aria-selected', String(b === button));
  refreshMedications();
});

el.medClear.addEventListener('click', async () => {
  await okv.clearDoneMedications();
  toast('Done list cleared on this computer');
});

// --- adding a request ---

const MAX_MEDS = 10;

/** Draws the medicine rows. The "+" sits on the last row straight after its number, so Tab goes patient → medication → number → "+". */
function renderMedRows(focusRow = null) {
  const rows = state.medRows;
  el.medRows.replaceChildren(
    ...rows.map((row, i) => {
      const last = i === rows.length - 1;
      const name = h('input', {
        class: 'med-input med-name',
        type: 'text',
        maxlength: 80,
        placeholder: i === 0 ? 'Medication' : `Medication ${i + 1}`,
        'aria-label': `Medication ${i + 1}`,
        spellcheck: 'false',
        value: row.name,
      });
      const qty = h('input', {
        class: 'med-input med-qty',
        type: 'text',
        maxlength: 40,
        placeholder: 'e.g. 30 tabs',
        'aria-label': `Number of caps, tabs, mls or tubs for medication ${i + 1}`,
        spellcheck: 'false',
        value: row.qty,
      });
      name.addEventListener('input', () => {
        row.name = name.value;
        onMedEdit();
      });
      qty.addEventListener('input', () => {
        row.qty = qty.value;
        onMedEdit();
      });
      // Enter moves along the fields; in the number field it adds the request once it's complete.
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          qty.focus();
        }
      });
      qty.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          if (!el.medAdd.disabled) el.medCompose.requestSubmit();
        }
      });
      const control = last
        ? svgNode(
            'button',
            { type: 'button', class: 'med-step med-more', title: 'Add another medication', 'aria-label': 'Add another medication', disabled: rows.length >= MAX_MEDS, onclick: addMedRow },
            SVG_PLUS,
          )
        : svgNode(
            'button',
            { type: 'button', class: 'med-step med-less', tabindex: '-1', title: 'Remove this medication', 'aria-label': `Remove medication ${i + 1}`, onclick: () => removeMedRow(i) },
            SVG_CROSS,
          );
      return h('div', { class: 'med-row' }, name, qty, control);
    }),
  );
  updateMedAddState();
  if (focusRow !== null) el.medRows.querySelectorAll('.med-name')[focusRow].focus();
}

function addMedRow() {
  if (state.medRows.length >= MAX_MEDS) return;
  state.medRows.push({ name: '', qty: '' });
  renderMedRows(state.medRows.length - 1);
}

function removeMedRow(i) {
  state.medRows.splice(i, 1);
  renderMedRows(Math.min(i, state.medRows.length - 1));
}

function updateMedAddState() {
  const filled = state.medRows.some((r) => r.name.trim());
  el.medAdd.disabled = state.medSending || !el.medPatient.value.trim() || !filled;
}

function onMedEdit() {
  el.medError.hidden = true;
  updateMedAddState();
}

el.medPatient.addEventListener('input', onMedEdit);
el.medPatient.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    el.medRows.querySelector('.med-name').focus();
  }
});

el.medCompose.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.medSending) return;
  const patient = el.medPatient.value.trim();
  const rows = state.medRows.filter((r) => r.name.trim() || r.qty.trim());
  if (!patient || !rows.length) return;
  if (rows.some((r) => !r.name.trim())) {
    el.medError.textContent = 'Add the medication name for each number you typed.';
    el.medError.hidden = false;
    return;
  }
  state.medSending = true;
  updateMedAddState();
  try {
    await okv.addMedication({ patient, items: rows.map((r) => ({ name: r.name.trim(), qty: r.qty.trim() })) });
    el.medPatient.value = '';
    state.medRows = [{ name: '', qty: '' }];
    renderMedRows();
    if (state.medFilter !== 'open') toast(`Request added for ${patient}`);
  } catch {
    el.medError.textContent = 'Request not added. Please try again.';
    el.medError.hidden = false;
  } finally {
    state.medSending = false;
    updateMedAddState();
    el.medPatient.focus();
  }
});

// ---------- Settings ----------

function renderSettings() {
  deptButtons(el.settingsDepts, true);
  el.optSound.checked = !!state.settings.sound;
  el.optAutostart.checked = !!state.settings.autoStart;
  state.quickDraft = null;
  renderQuickEditor();
  loadPeerReport();
  renderHistorySection();
  renderUpdate();
}

function renderPeers() {
  renderHeader(); // the "N other PCs online" count
  if (state.screen === 'settings') loadPeerReport();
}

function renderUpdate() {
  const u = state.update;
  const text = {
    dev: 'Automatic updates are off in development mode.',
    idle: 'Updates are checked automatically.',
    checking: 'Checking for updates…',
    current: 'You have the latest version.',
    downloading: `Downloading version ${u.version}…`,
    ready: `Version ${u.version} is ready to install.`,
    error: 'Couldn’t check for updates.',
  }[u.state] || '';
  el.updateText.textContent = text;
  const button = { idle: 'Check now', current: 'Check again', error: 'Try again', ready: 'Restart now' }[u.state];
  el.updateBtn.hidden = !button;
  el.updateBtn.textContent = button || '';

  el.banner.hidden = u.state !== 'ready';
  el.bannerText.textContent = `Update ${u.version} is ready — it installs when you minimise.`;
}

el.updateBtn.addEventListener('click', () => okv.updateAction(state.update.state === 'ready' ? 'install' : 'check'));
el.bannerBtn.addEventListener('click', () => okv.updateAction('install'));
el.openData.addEventListener('click', () => okv.openDataFolder());
el.openSchedule.addEventListener('click', () => okv.openSchedule());
el.openSettings.addEventListener('click', () => showScreen('settings'));
el.closeSettings.addEventListener('click', () => showScreen(state.section));
el.optSound.addEventListener('change', async () => {
  state.settings = await okv.setSettings({ sound: el.optSound.checked });
  if (state.settings.sound) chime(false);
});
el.optAutostart.addEventListener('change', async () => {
  state.settings = await okv.setSettings({ autoStart: el.optAutostart.checked });
});

// ---------- Keyboard ----------

document.addEventListener('keydown', (e) => {
  if (!state.expanded) return;
  if (e.key === 'Escape') {
    if (closeFloating()) {
      // closed a menu, the notice box or an edit in progress
    } else if (!el.searchBox.hidden) closeSearch();
    else if (state.reply && state.screen === 'board') clearReply();
    else if (state.screen === 'settings') showScreen(state.section);
    else if (state.settings.department) setExpanded(false);
    e.preventDefault();
  } else if (e.key === 'f' && e.ctrlKey && state.screen === 'board') {
    openSearch();
    e.preventDefault();
  }
});

// ---------- Live updates from the main process ----------

okv.onView(applyView);

okv.onMessages(({ messages, alert }) => {
  if (state.screen === 'media') refreshMedia();
  if (alert) {
    chime(alert === 'urgent');
    if (!state.expanded) bump();
  }
  if (!state.settings.department) return;
  const mine = messages.some((m) => m.local);
  const wasNearBottom = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 60;
  refresh({ toBottom: mine }).then(() => {
    if (!mine && !wasNearBottom && state.screen === 'board') el.jump.hidden = false;
  });
  if (state.expanded && !mine) okv.markRead();
});

// A message was deleted or restored, here or on another computer.
okv.onMessagesChanged(() => {
  if (state.screen === 'media') refreshMedia();
  if (state.settings.department) refresh();
});

// A GIF that was still on its way has arrived from another computer.
okv.onGifReady(() => {
  if (state.settings.department && state.screen === 'board') refresh();
  if (state.screen === 'media') refreshMedia();
});

// A file or image that was still on its way has arrived from another computer.
okv.onFileReady(() => {
  if (state.settings.department && state.screen === 'board') refresh();
  if (state.screen === 'media') refreshMedia();
});

okv.onUnread(({ count, urgent, reminders, medications }) => {
  state.unread = count;
  state.hasUrgentUnread = urgent;
  state.remSummary = reminders;
  state.medSummary = medications;
  renderBadge();
});

// A reminder was added, changed or fell due, here or on another computer.
okv.onRemindersChanged(({ alert }) => {
  if (alert) {
    chime(alert === 'urgent');
    if (!state.expanded) bump();
  }
  if (state.screen === 'reminders') {
    refreshReminders();
    if (state.expanded) okv.markRemindersSeen();
  }
});

// A medication request was logged, ticked off or changed, here or on another computer.
okv.onMedicationsChanged(({ alert, done = [], requests = [] }) => {
  if (alert === 'done') {
    // The blue notification: a request this department logged has been completed.
    chime(false, 'done');
    if (!state.expanded) bump();
    else if (state.screen !== 'medications') toast(`✓ ${listNames(done)} – medication completed`, null, 'blue');
  } else if (alert) {
    chime(false);
    if (!state.expanded) bump();
    else if (state.screen !== 'medications') toast(`New medication request: ${listNames(requests)}`);
  }
  if (state.screen === 'medications') {
    refreshMedications();
    if (state.expanded) okv.markMedicationsSeen();
  }
});

okv.onPeers((peers) => {
  state.peers = peers;
  renderPeers();
});

okv.onUpdate((update) => {
  state.update = update;
  renderUpdate();
});

okv.onOpen((screen) => {
  if (screen === 'settings' && state.settings.department) showScreen('settings');
});

// ---------- Start ----------

async function init() {
  const s = await okv.getState();
  Object.assign(state, {
    productName: (s.brand && s.brand.productName) || state.productName,
    hasSchedule: Boolean(s.appointments && s.appointments.enabled),
    departments: s.departments,
    reactionChoices: s.reactions || [],
    gifMaxBytes: s.gifMaxBytes || state.gifMaxBytes,
    attachPlaceholder: s.attachPlaceholder || state.attachPlaceholder,
    fileMaxBytes: s.fileMaxBytes || state.fileMaxBytes,
    maxAttach: s.maxAttachments || state.maxAttach,
    attachTotal: s.attachTotalBytes || state.attachTotal,
    attachRetention: s.attachmentRetentionDays || state.attachRetention,
    blockedExt: new Set(s.blockedExtensions || []),
    pin: s.pin,
    editWindowMs: s.editWindowMs || state.editWindowMs,
    retentionDays: s.retentionDays || state.retentionDays,
    maxQuick: s.maxQuickMessages || state.maxQuick,
    settings: s.settings,
    unread: s.unread.count,
    hasUrgentUnread: s.unread.urgent,
    remSummary: s.unread.reminders,
    medSummary: s.unread.medications,
    peers: s.peers,
    update: s.update,
    newSince: s.lastReadAt,
  });
  el.openSchedule.hidden = !state.hasSchedule;
  el.version.textContent = s.version;
  el.host.textContent = s.host;
  el.author.value = s.settings.author || '';
  deptButtons(el.onboardingDepts, false);
  renderQuick();
  renderQuiet();
  renderPin();
  renderComposeTargets();
  renderReminderTargets();
  renderHeader();
  renderBadge();
  renderPeers();
  renderUpdate();
  showScreen(s.settings.department ? 'board' : 'onboarding');
  applyView({ expanded: s.expanded, lastReadAt: s.lastReadAt });
  await refresh({ toBottom: true });
}

init();
