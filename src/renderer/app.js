'use strict';

/* global okv */

const PAGE = 150;
const DEPT_HINTS = {
  principal: 'Practice owner & management',
  clinical: 'Vets, nurses & animal care',
  reception: 'Front desk & client care',
  other: 'Anyone else in the clinic',
};

const $ = (id) => document.getElementById(id);
const el = {
  body: document.body,
  bubble: $('bubble'),
  badge: $('badge'),
  meDept: $('me-dept'),
  netStatus: $('net-status'),
  netText: $('net-text'),
  openSettings: $('open-settings'),
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
  toastText: $('toast-text'),
  toastAction: $('toast-action'),
};

const state = {
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
  hasUrgentUnread: false,
  // Days the user has opened or closed (dayKey -> open). Otherwise only today is open.
  dayOpen: new Map(),
  reactionChoices: [],
  section: 'board', // which of 'board' / 'reminders' the panel shows
  remFilter: 'for-us',
  reminderList: [],
  remSummary: { open: 0, overdue: 0, unseen: 0, unseenDue: false },
  remSending: false,
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
/** Shows a short notice; `action` ({label, run}) adds a button such as Undo. */
function toast(message, action = null) {
  el.toastText.textContent = message;
  el.toastAction.hidden = !action;
  el.toast.classList.toggle('has-action', Boolean(action));
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
function chime(urgent) {
  if (!state.settings.sound) return;
  try {
    audio = audio || new AudioContext();
    const notes = urgent ? [988, 784, 988, 784, 988] : [659, 880];
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

el.collapse.addEventListener('click', () => setExpanded(false));

// ---------- Badge ----------

function renderBadge() {
  const rem = state.remSummary;
  const n = state.unread + rem.unseen;
  el.badge.hidden = n === 0;
  el.badge.textContent = n > 99 ? '99+' : String(n);
  el.bubble.classList.toggle('has-urgent', (state.unread > 0 && state.hasUrgentUnread) || rem.unseenDue);
  // Reminders tab: how many are open for us, red when any are overdue.
  el.badgeReminders.hidden = rem.open === 0;
  el.badgeReminders.textContent = String(rem.open);
  el.badgeReminders.classList.toggle('is-overdue', rem.overdue > 0);
  el.badgeReminders.title = rem.overdue ? `${rem.open} open, ${rem.overdue} overdue` : `${rem.open} open`;
  el.bubble.setAttribute('aria-label', n ? `Open OKV Messenger, ${n} new` : 'Open OKV Messenger');
  el.bubble.title = n ? `OKV Messenger – ${n} new` : 'OKV Messenger';
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
  el.netStatus.title = n === 0 ? 'No other computers running OKV Messenger found' : `${n} other computer${n === 1 ? '' : 's'} online`;
  el.collapse.hidden = !dept;
  el.openSettings.hidden = !dept;
}

// ---------- Screens ----------

function showScreen(name) {
  state.screen = name;
  const section = name === 'board' || name === 'reminders';
  if (section) state.section = name;
  el.onboarding.hidden = name !== 'onboarding';
  el.board.hidden = name !== 'board';
  el.reminders.hidden = name !== 'reminders';
  el.settings.hidden = name !== 'settings';
  el.sections.hidden = !section;
  for (const b of el.sections.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.section === name));
  if (name === 'settings') renderSettings();
  if (name === 'board') {
    renderList({ toBottom: true });
    el.text.focus();
  }
  if (name === 'reminders') {
    refreshReminders();
    if (state.expanded) okv.markRemindersSeen();
    el.remText.focus();
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
        h('span', null, h('strong', null, d.label), compact ? null : h('small', null, DEPT_HINTS[d.id] || '')),
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
    { class: ['msg', `dept-${m.from}`, m.urgent && 'is-urgent', m.local && 'is-mine', isNew(m) && 'is-new'] },
    h(
      'header',
      { class: 'msg-head' },
      h('span', { class: 'msg-from', title: m.host ? `Sent from ${m.host}` : null }, deptLabel(m.from)),
      m.author ? h('span', { class: 'msg-author' }, m.author) : null,
      h('span', { class: ['msg-to', toUs && 'is-us'], title: toUs ? `To ${toLabel(m.to)}` : null }, `→ ${toUs ? 'You' : toLabel(m.to)}`),
      m.urgent ? h('span', { class: 'msg-tag' }, 'Urgent') : null,
      h('time', { class: 'msg-time', datetime: new Date(m.createdAt).toISOString(), title: fullFmt.format(m.createdAt) }, timeFmt.format(m.createdAt)),
    ),
    h('p', { class: 'msg-text' }, m.text),
    reactionsNode(m),
    // Shown while pointing at the message: react, or delete.
    h(
      'div',
      { class: 'msg-actions', role: 'toolbar', 'aria-label': 'Message actions' },
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
  el.text.placeholder = el.to.value === 'all' ? 'Message everyone…' : `Message ${toLabel(el.to.value)}…`;
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
  el.send.disabled = state.sending || !el.text.value.trim();
}

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
  if (!text || state.sending) return;
  state.sending = true;
  updateSendState();
  try {
    await okv.sendMessage({ to: el.to.value, text, urgent: state.urgent, author: el.author.value });
    el.text.value = '';
    autoGrow();
    setUrgent(false);
    if (state.filter !== 'all' && state.filter !== 'from-us') {
      toast('Sent');
    }
  } catch {
    el.composeError.textContent = 'Message not sent. Please try again.';
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

// Keep "due in…" labels and overdue highlighting current while the list is open.
setInterval(() => {
  if (state.expanded && state.screen === 'reminders') renderReminders();
}, 30000);

// ---------- Settings ----------

function renderSettings() {
  deptButtons(el.settingsDepts, true);
  el.optSound.checked = !!state.settings.sound;
  el.optAutostart.checked = !!state.settings.autoStart;
  renderPeers();
  renderUpdate();
}

function renderPeers() {
  renderHeader();
  if (!state.peers.length) {
    el.peerList.replaceChildren(
      h('li', null, h('span', { class: 'peer-empty' }, 'None yet. Other computers appear here automatically while OKV Messenger is running on them.')),
    );
    return;
  }
  el.peerList.replaceChildren(
    ...state.peers.map((p) =>
      h(
        'li',
        { class: `dept-${p.dept}`, title: p.reachable === false ? 'Seen, but not accepting connections (check its firewall)' : null },
        h('span', { class: 'dept-swatch' }),
        h('span', { class: 'peer-name' }, p.host || p.address),
        h('span', null, p.dept ? deptLabel(p.dept) : 'No department'),
        h('span', { class: 'peer-meta' }, p.address),
      ),
    ),
  );
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
    if (!el.searchBox.hidden) closeSearch();
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
  if (state.settings.department) refresh();
});

okv.onUnread(({ count, urgent, reminders }) => {
  state.unread = count;
  state.hasUrgentUnread = urgent;
  state.remSummary = reminders;
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
    departments: s.departments,
    reactionChoices: s.reactions || [],
    settings: s.settings,
    unread: s.unread.count,
    hasUrgentUnread: s.unread.urgent,
    remSummary: s.unread.reminders,
    peers: s.peers,
    update: s.update,
    newSince: s.lastReadAt,
  });
  el.version.textContent = s.version;
  el.host.textContent = s.host;
  el.author.value = s.settings.author || '';
  deptButtons(el.onboardingDepts, false);
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
