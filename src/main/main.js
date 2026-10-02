'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DEPARTMENTS, DEPARTMENT_IDS, REACTIONS, LIMITS } = require('./constants');
const { Config } = require('./config');
const { MessageStore, DeletionLog, ReactionLog, LocalHides, toWire, isUnread } = require('./store');
const { Network } = require('./network');
const { Updater } = require('./updater');
const { createLogger } = require('./logger');

// Developer overrides so several copies can run side by side on one PC.
// See README "Running two copies for testing".
const env = process.env;
if (env.OKV_DATA_DIR) app.setPath('userData', path.resolve(env.OKV_DATA_DIR));

// The logo's box: a 60px bubble plus room for its shadow. iconPos is this box's top-left.
const ICON_SIZE = 76;
// While collapsed the window is this much bigger on every side, so the unread
// pulse has room to spread. The extra area lets clicks through to the apps below.
const PULSE_PAD = 22;
const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 640;
const EDGE = 12;
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const HOST = os.hostname().slice(0, LIMITS.HOST);

let win = null;
let tray = null;
let config;
let store;
let deletions; // "delete for everyone", shared with the other computers
let hides; // "delete for me", this computer only
let reactions; // emoji reactions, shared with the other computers
let network = null;
let updater = null;
let log;
let expanded = false;
let iconPos = null;
let panelRect = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => setExpanded(true));
  app.whenReady().then(start).catch((err) => {
    console.error(err);
    app.quit();
  });
}

async function start() {
  const dataDir = app.getPath('userData');
  log = createLogger(path.join(dataDir, 'logs'));
  log.info(`OKV Messenger ${app.getVersion()} starting on ${HOST}`);

  config = new Config(dataDir);
  // A copied/imaged profile keeps the old id; give each computer its own.
  if (!config.get('peerId') || config.get('peerHost') !== HOST) {
    config.set({ peerId: crypto.randomUUID(), peerHost: HOST });
  }
  if (!config.get('firstRunAt')) config.set({ firstRunAt: Date.now() });

  const historyDir = path.join(dataDir, 'history');
  store = new MessageStore(historyDir).load();
  deletions = new DeletionLog(historyDir).load();
  hides = new LocalHides(historyDir).load();
  reactions = new ReactionLog(historyDir).load();
  log.info(`loaded ${store.count} messages, ${deletions.count} deletions`);
  store.on('added', onMessagesAdded);
  deletions.on('added', onMessagesChanged);
  reactions.on('added', onMessagesChanged);

  applyAutoStart();
  createWindow();

  updater = new Updater({ log, canInstallNow: () => !expanded });
  updater.on('status', (status) => {
    send('update-status', status);
    refreshTray();
  });
  createTray();

  network = new Network({
    store,
    deletions,
    reactions,
    peerId: config.get('peerId'),
    getProfile: () => ({ department: config.get('department'), host: HOST }),
    log,
    bindAddress: env.OKV_BIND || '0.0.0.0',
    udpPort: env.OKV_UDP_PORT ? Number(env.OKV_UDP_PORT) : undefined,
    tcpPorts: env.OKV_TCP_PORT ? [Number(env.OKV_TCP_PORT)] : undefined,
    staticPeers: [...(config.get('staticPeers') || []), ...(env.OKV_PEERS ? env.OKV_PEERS.split(',') : [])],
  });
  network.on('peers', (peers) => send('peers', peers));
  try {
    await network.start();
  } catch (err) {
    log.error('network failed to start:', err.message);
  }

  updater.start();

  screen.on('display-removed', keepOnScreen);
  screen.on('display-metrics-changed', keepOnScreen);
  // Some full-screen apps knock topmost windows down; put ourselves back.
  setInterval(() => {
    if (win && !win.isDestroyed() && !win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver');
  }, 30000);
}

app.on('before-quit', () => {
  quitting = true;
  if (network) network.stop();
});

// ---------- Window ----------

function createWindow() {
  iconPos = validIconPosition(config.get('iconPosition')) || defaultIconPosition();
  win = new BrowserWindow({
    ...collapsedBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'OKV Messenger',
    icon: path.join(ASSETS, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  setClickThrough(true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    // First run: open straight onto the department picker.
    if (!config.get('department')) setExpanded(true);
    else win.showInactive();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // Alt+F4 collapses rather than quits; quitting is in the tray menu.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    setExpanded(false);
  });
}

function setExpanded(value) {
  if (!win || win.isDestroyed()) return;
  expanded = !!value;
  let origin = 'bottom right';
  if (expanded) {
    const bounds = panelBounds();
    origin = bounds.origin;
    panelRect = bounds.rect;
    setClickThrough(false);
    win.setBounds(panelRect);
    win.show();
    win.focus();
  } else {
    win.setBounds(collapsedBounds());
    setClickThrough(true);
    if (!win.isVisible()) win.showInactive();
    if (updater) updater.installIfIdle();
  }
  send('view', { expanded, origin, lastReadAt: config.get('lastReadAt') });
}

/** Opens the panel out of the bubble, towards the middle of the screen. */
function panelBounds() {
  const wa = screen.getDisplayMatching({ ...iconPos, width: ICON_SIZE, height: ICON_SIZE }).workArea;
  const width = Math.min(PANEL_WIDTH, wa.width - EDGE * 2);
  const height = Math.min(PANEL_HEIGHT, wa.height - EDGE * 2);
  const right = iconPos.x + ICON_SIZE / 2 > wa.x + wa.width / 2;
  const bottom = iconPos.y + ICON_SIZE / 2 > wa.y + wa.height / 2;
  const x = clamp(right ? iconPos.x + ICON_SIZE - width : iconPos.x, wa.x, wa.x + wa.width - width);
  const y = clamp(bottom ? iconPos.y + ICON_SIZE - height : iconPos.y, wa.y, wa.y + wa.height - height);
  return {
    rect: { x: Math.round(x), y: Math.round(y), width, height },
    origin: `${bottom ? 'bottom' : 'top'} ${right ? 'right' : 'left'}`,
  };
}

function collapsedBounds() {
  return {
    x: iconPos.x - PULSE_PAD,
    y: iconPos.y - PULSE_PAD,
    width: ICON_SIZE + PULSE_PAD * 2,
    height: ICON_SIZE + PULSE_PAD * 2,
  };
}

/**
 * While collapsed, clicks pass through the window except over the bubble
 * itself (the page switches this off while the mouse is over the bubble).
 * `forward` still delivers mouse movement so the page can tell.
 */
function setClickThrough(on) {
  if (!win || win.isDestroyed()) return;
  if (on && !expanded) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
}

/** Where the bubble goes for a panel at `rect`: its corner nearest the screen edges. */
function iconForPanel(rect) {
  const wa = screen.getDisplayMatching(rect).workArea;
  const right = rect.x + rect.width / 2 > wa.x + wa.width / 2;
  const bottom = rect.y + rect.height / 2 > wa.y + wa.height / 2;
  return {
    x: right ? rect.x + rect.width - ICON_SIZE : rect.x,
    y: bottom ? rect.y + rect.height - ICON_SIZE : rect.y,
  };
}

function clampToWorkArea(rect) {
  const wa = screen.getDisplayMatching(rect).workArea;
  return {
    ...rect,
    x: Math.round(clamp(rect.x, wa.x, wa.x + wa.width - rect.width)),
    y: Math.round(clamp(rect.y, wa.y, wa.y + wa.height - rect.height)),
  };
}

function defaultIconPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - ICON_SIZE - EDGE, y: wa.y + Math.round(wa.height * 0.62) };
}

/** Returns the position clamped onto whichever screen it's on, or null if it's on none. */
function validIconPosition(pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  const cx = pos.x + ICON_SIZE / 2;
  const cy = pos.y + ICON_SIZE / 2;
  const display = screen
    .getAllDisplays()
    .find(({ workArea: w }) => cx >= w.x && cx < w.x + w.width && cy >= w.y && cy < w.y + w.height);
  if (!display) return null;
  const w = display.workArea;
  return {
    x: Math.round(clamp(pos.x, w.x, w.x + w.width - ICON_SIZE)),
    y: Math.round(clamp(pos.y, w.y, w.y + w.height - ICON_SIZE)),
  };
}

function keepOnScreen() {
  iconPos = validIconPosition(iconPos) || defaultIconPosition();
  setExpanded(expanded);
}

function resetIconPosition() {
  iconPos = defaultIconPosition();
  config.set({ iconPosition: iconPos });
  setExpanded(false);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- Tray ----------

function createTray() {
  tray = new Tray(path.join(ASSETS, 'icon.ico'));
  tray.on('click', () => setExpanded(!expanded));
  refreshTray();
}

function refreshTray() {
  if (!tray) return;
  const dept = DEPARTMENTS.find((d) => d.id === config.get('department'));
  const update = updater ? updater.status : { state: 'dev' };
  const unreadNow = unread().count;
  tray.setToolTip(unreadNow ? `OKV Messenger – ${unreadNow} new` : 'OKV Messenger');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `OKV Messenger ${app.getVersion()}`, enabled: false },
      { label: dept ? `Sending as ${dept.label}` : 'No department chosen yet', enabled: false },
      { type: 'separator' },
      { label: 'Open messages', click: () => setExpanded(true) },
      {
        label: 'Settings…',
        click: () => {
          setExpanded(true);
          send('open', 'settings');
        },
      },
      { label: 'Move icon back to the corner', click: resetIconPosition },
      { type: 'separator' },
      update.state === 'ready'
        ? { label: `Restart to update to ${update.version}`, click: () => updater.installNow() }
        : { label: 'Check for updates', enabled: app.isPackaged, click: () => updater.check() },
      { type: 'separator' },
      {
        label: 'Quit OKV Messenger',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---------- Messages ----------

/** Messages that shouldn't be shown on this computer. */
function isRemoved(m) {
  return hides.has(m.id) || deletions.isDeleted(m);
}

function unreadContext() {
  return {
    department: config.get('department'),
    lastReadAt: config.get('lastReadAt'),
    since: config.get('firstRunAt'),
  };
}

function unread() {
  if (!store || !config.get('department')) return { count: 0, urgent: false };
  return store.unread({ ...unreadContext(), exclude: isRemoved });
}

function sendUnread() {
  send('unread', unread());
  refreshTray();
}

function onMessagesAdded(added) {
  const ctx = unreadContext();
  const fresh = ctx.department ? added.filter((m) => isUnread(m, ctx) && !isRemoved(m)) : [];
  const alert = fresh.length ? (fresh.some((m) => m.urgent) ? 'urgent' : 'normal') : null;
  send('messages-added', { messages: added, alert });
  sendUnread();
}

/** Something other than a new message changed what's on the board (a deletion). */
function onMessagesChanged() {
  send('messages-changed');
  sendUnread();
}

/**
 * Deletes (or with `undo`, restores) a message. 'me' hides it on this
 * computer; 'everyone' removes it from every computer, which only the
 * department that sent it may do.
 */
function setDeleted(input, deleted) {
  const { id, scope } = input || {};
  const message = typeof id === 'string' ? store.byId.get(id) : null;
  if (!message) throw new Error('Message not found');
  if (scope === 'everyone' && message.from !== config.get('department')) {
    throw new Error('Only the department that sent it can delete it for everyone');
  }
  setManyDeleted([id], scope, deleted);
}

/**
 * Deletes (or with deleted=false, restores) several messages at once. For
 * 'everyone', messages other departments sent are skipped. Returns the ids
 * that were acted on.
 */
function setManyDeleted(ids, scope, deleted) {
  const messages = ids.map((id) => store.byId.get(id)).filter(Boolean);
  if (scope === 'me') {
    if (hides.setMany(messages.map((m) => m.id), deleted)) onMessagesChanged();
    return messages.map((m) => m.id);
  }
  if (scope !== 'everyone') throw new Error('Unknown delete scope');
  const department = config.get('department');
  const ours = messages.filter((m) => m.from === department);
  const now = Date.now();
  const added = deletions.add(
    ours.map((m) => ({ id: crypto.randomUUID(), target: m.id, deleted, by: department, host: HOST, createdAt: now })),
    { local: true },
  );
  if (added.length) {
    if (network) network.pushNow(added.map(toWire), 'deletions');
    log.info(`${deleted ? 'deleted' : 'restored'} ${added.length} message(s) for everyone`);
  }
  return ours.map((m) => m.id);
}

/** The tab and search box, cleaned up, as used by the board and by deleting a day. */
function queryFilters(opts) {
  return {
    filter: ['all', 'to-us', 'from-us', 'urgent'].includes(opts.filter) ? opts.filter : 'all',
    search: typeof opts.search === 'string' ? opts.search.slice(0, 200) : '',
    department: config.get('department'),
    exclude: isRemoved,
  };
}

function publicSettings() {
  return {
    department: config.get('department'),
    author: config.get('author'),
    sound: config.get('sound'),
    autoStart: config.get('autoStart'),
  };
}

function applyAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!config.get('autoStart') });
}

// ---------- IPC ----------

ipcMain.handle('get-state', () => ({
  version: app.getVersion(),
  host: HOST,
  departments: DEPARTMENTS,
  reactions: REACTIONS,
  settings: publicSettings(),
  expanded,
  unread: unread(),
  lastReadAt: config.get('lastReadAt'),
  peers: network ? network.peers() : [],
  update: updater ? updater.status : { state: 'dev' },
  dataDir: app.getPath('userData'),
}));

ipcMain.handle('query', (_e, opts = {}) => {
  const before =
    opts.before && Number.isFinite(opts.before.createdAt) && typeof opts.before.id === 'string'
      ? { createdAt: opts.before.createdAt, id: opts.before.id }
      : null;
  const limit = Number.isInteger(opts.limit) ? clamp(opts.limit, 1, 1000) : 150;
  const result = store.query({ ...queryFilters(opts), before, limit });
  // Copies, so the stored messages don't get a reactions field.
  result.messages = result.messages.map((m) => ({ ...m, reactions: reactions.forMessage(m.id, REACTIONS) }));
  return result;
});

ipcMain.handle('send-message', (_e, input = {}) => {
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  const author = typeof input.author === 'string' ? input.author.trim().slice(0, LIMITS.AUTHOR) : '';
  const [message] = store.add(
    [
      {
        id: crypto.randomUUID(),
        from: department,
        to: input.to,
        author,
        host: HOST,
        text: input.text,
        urgent: input.urgent === true,
        createdAt: Date.now(),
      },
    ],
    { local: true },
  );
  if (!message) throw new Error('Message was empty or invalid');
  if (author !== config.get('author')) config.set({ author });
  if (network) network.pushNow([toWire(message)]);
  return message;
});

ipcMain.handle('set-department', (_e, department) => {
  if (!DEPARTMENT_IDS.includes(department)) throw new Error('Unknown department');
  config.set({ department });
  log.info(`department set to ${department}`);
  refreshTray();
  sendUnread();
  if (network) network.announce();
  return publicSettings();
});

ipcMain.handle('set-settings', (_e, values = {}) => {
  const next = {};
  if (typeof values.sound === 'boolean') next.sound = values.sound;
  if (typeof values.autoStart === 'boolean') next.autoStart = values.autoStart;
  if (typeof values.author === 'string') next.author = values.author.trim().slice(0, LIMITS.AUTHOR);
  config.set(next);
  if ('autoStart' in next) applyAutoStart();
  return publicSettings();
});

ipcMain.handle('set-expanded', (_e, value) => setExpanded(!!value));

ipcMain.handle('mark-read', () => {
  config.set({ lastReadAt: Date.now() });
  sendUnread();
});

// `pos` is where the page wants the window's top-left corner.
ipcMain.on('drag-move', (_e, pos) => {
  if (!win || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  // setBounds (not setPosition) so the size can't drift across mixed-DPI screens.
  if (expanded) {
    win.setBounds({ x, y, width: panelRect.width, height: panelRect.height });
  } else {
    iconPos = { x: x + PULSE_PAD, y: y + PULSE_PAD };
    win.setBounds(collapsedBounds());
  }
});

ipcMain.on('drag-end', () => {
  if (!win) return;
  if (expanded) {
    // The bubble follows the panel, so it collapses and reopens in the same place.
    iconPos = validIconPosition(iconForPanel(clampToWorkArea(win.getBounds()))) || defaultIconPosition();
    panelRect = panelBounds().rect;
    win.setBounds(panelRect);
  } else {
    iconPos = validIconPosition(iconPos) || defaultIconPosition();
    win.setBounds(collapsedBounds());
  }
  config.set({ iconPosition: iconPos });
});

ipcMain.on('click-through', (_e, on) => setClickThrough(!!on));

ipcMain.handle('delete-message', (_e, input) => setDeleted(input, true));

// Adds this department's emoji reaction to a message, or takes it back if it's already there.
ipcMain.handle('react', (_e, { id, emoji } = {}) => {
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  if (!REACTIONS.includes(emoji)) throw new Error('Unknown reaction');
  if (typeof id !== 'string' || !store.has(id)) throw new Error('Message not found');
  const on = !reactions.hasReacted(id, department, emoji);
  const [record] = reactions.add(
    [{ id: crypto.randomUUID(), target: id, emoji, on, by: department, host: HOST, createdAt: Date.now() }],
    { local: true },
  );
  if (record && network) network.pushNow([toWire(record)], 'reactions');
  return on;
});
ipcMain.handle('undo-delete', (_e, input) => setDeleted(input, false));

// Deletes every message shown under one day's banner: that day (local time),
// in the current tab and search. Returns the ids deleted, for Undo.
ipcMain.handle('delete-day', (_e, opts = {}) => {
  const { start, end, scope } = opts;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 2 * 86400000) {
    throw new Error('Not a valid day');
  }
  const { messages } = store.query({
    ...queryFilters(opts),
    after: start,
    before: { createdAt: end, id: '' },
    limit: Number.MAX_SAFE_INTEGER,
  });
  return { ids: setManyDeleted(messages.map((m) => m.id), scope, true) };
});

ipcMain.handle('undo-delete-many', (_e, { ids, scope } = {}) => {
  if (!Array.isArray(ids)) throw new Error('No messages given');
  setManyDeleted(ids.filter((id) => typeof id === 'string'), scope, false);
});

ipcMain.handle('update-action', (_e, action) => {
  if (!updater) return;
  if (action === 'install') updater.installNow();
  else updater.check();
});

ipcMain.handle('open-data-folder', () => shell.openPath(app.getPath('userData')));
