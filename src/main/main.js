'use strict';

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, shell, protocol, dialog, clipboard, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {
  DEPARTMENTS,
  DEPARTMENT_IDS,
  GIF_PLACEHOLDER,
  ATTACH_PLACEHOLDER,
  ATTACHMENT_RETENTION_DAYS,
  DROP_RETENTION_DAYS,
  REACTIONS,
  RETENTION_DAYS,
  EDIT_WINDOW_MS,
  DEFAULT_QUICK_MESSAGES,
  MAX_QUICK_MESSAGES,
  MEDICATION_ALERT_DEPT,
  APPOINTMENTS,
  APPT_COLUMN_IDS,
  APPT_COLORS,
  LIMITS,
} = require('./constants');
const brand = require('./brand');
const { Config } = require('./config');
const { AppointmentLog, sanitizeDetails: sanitizeApptDetails, validDay: validApptDay } = require('./appointments');
const {
  MessageStore,
  DeletionLog,
  ReactionLog,
  ReminderLog,
  MedicationLog,
  DropLog,
  EditLog,
  ReceiptLog,
  PinLog,
  LocalHides,
  receiptId,
  dayKey,
  toWire,
  isUnread,
} = require('./store');
const { Network } = require('./network');
const { Updater } = require('./updater');
const { createLogger } = require('./logger');
const { resizeBounds, makeDock, dockSnap, matchDockArea } = require('./geometry');
const { GifStore, HASH: GIF_HASH } = require('./gifs');
const { FileStore, inspectFile, imageMime, cleanFileName, isBlockedName, checkBytes, BLOCKED_EXTENSIONS } = require('./files');
const { listMedia } = require('./media');
const { fetchGif, nameFromUrl } = require('./gifurl');
const { rangeBounds, readArchivedMessages, mergeMessages, toCsv, copyFolder } = require('./exporter');

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
// The open board can be resized by dragging its edges, within these limits.
const PANEL_MIN_WIDTH = 340;
const PANEL_MIN_HEIGHT = 440;
const EDGE = 12;
// Docked, the logo's centre sits on the screen edge, so half of it shows. The window
// is just that half plus room for the pulse; the rest of the logo would be off-screen.
const DOCK_WIDTH = ICON_SIZE / 2 + PULSE_PAD;
// Dropping the logo this close to a left or right edge docks it.
const DOCK_SNAP = 30;
// Pulling a docked logo this far away from its edge undocks it. (More than the logo's half-width
// plus DOCK_SNAP, so letting go straight after it comes free leaves it free rather than docking it again.)
const DOCK_DETACH = 80;
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const HOST = os.hostname().slice(0, LIMITS.HOST);

// GIFs are shown to the page as okv-gif://<fingerprint>, served from this computer's GIF folder.
// Attached images are shown the same way, as okv-file://<fingerprint>.
protocol.registerSchemesAsPrivileged([
  { scheme: 'okv-gif', privileges: { standard: true, secure: true } },
  { scheme: 'okv-file', privileges: { standard: true, secure: true } },
]);

let win = null;
let tray = null;
let config;
let store;
let deletions; // "delete for everyone", shared with the other computers
let hides; // "delete for me", this computer only
let gifs; // GIF files, named by fingerprint
let files; // attached files and images, named by fingerprint
let reactions; // emoji reactions, shared with the other computers
let reminders; // reminders and their done/cancelled history, shared
let medications; // repeat-medication requests and their done/cancelled history, shared
let drops; // files put into the Drop box (the black hole), and taking them out again, shared
let appointments = null; // the appointment schedule, shared (only for brands that have one)
let scheduleWin = null; // the schedule window, when it is open
let edits; // corrections to message text, shared
let receipts; // which departments have seen which messages, shared
let pins; // the notice pinned at the top of the board, shared
let reminderHides; // done reminders cleared from this computer's Done list
let medicationHides; // done medication requests cleared from this computer's Done list
let dueCheckedUntil = Date.now(); // reminders due before this have already chimed
let network = null;
let updater = null;
let log;
let expanded = false;
let iconPos = null; // the free-floating logo's box; kept while docked, for when it is pulled out
let dock = null; // { side, edge, y } while the logo is docked to a screen edge, else null
let dragStart = null; // the logo as it was when the current drag of it began
let dockHint = false; // the logo being dragged is close enough to an edge to dock
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
  log.info(`${brand.productName} ${app.getVersion()} starting on ${HOST}`);

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
  gifs = new GifStore(historyDir);
  gifs.on('added', (hash) => send('gif-ready', hash));
  protocol.handle('okv-gif', (request) => {
    const hash = new URL(request.url).hostname;
    const file = GIF_HASH.test(hash) ? gifs.read(hash) : null;
    if (!file) return new Response('GIF not here yet', { status: 404, headers: { 'cache-control': 'no-store' } });
    return new Response(file, { headers: { 'content-type': 'image/gif', 'cache-control': 'max-age=31536000, immutable' } });
  });
  files = new FileStore(historyDir);
  files.on('added', (hash) => send('file-ready', hash));
  // Only pictures we recognise by their content are ever handed to the page; anything else is a 404.
  protocol.handle('okv-file', (request) => {
    const hash = new URL(request.url).hostname;
    const file = GIF_HASH.test(hash) ? files.read(hash) : null;
    const mime = file ? imageMime(file) : null;
    if (!mime) return new Response('Not here', { status: 404, headers: { 'cache-control': 'no-store' } });
    return new Response(file, { headers: { 'content-type': mime, 'cache-control': 'max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
  });
  // Files opened last time were copied out under their real names; they're not needed any more.
  try {
    fs.rmSync(path.join(dataDir, 'opened'), { recursive: true, force: true });
  } catch {
    // one may still be open in another program
  }
  reactions = new ReactionLog(historyDir).load();
  reminders = new ReminderLog(historyDir).load();
  medications = new MedicationLog(historyDir).load();
  drops = new DropLog(historyDir).load();
  appointments = APPOINTMENTS ? new AppointmentLog(historyDir).load() : null;
  edits = new EditLog(historyDir).load();
  receipts = new ReceiptLog(historyDir).load();
  pins = new PinLog(historyDir).load();
  // Everything older than the retention period is archived, on every computer alike.
  for (const history of [store, deletions, reactions, edits, receipts]) history.retentionDays = RETENTION_DAYS;
  drops.retentionDays = DROP_RETENTION_DAYS;
  tidyUp();
  setInterval(tidyUp, 6 * 3600 * 1000);
  reminderHides = new LocalHides(historyDir, 'hidden-reminders.jsonl').load();
  medicationHides = new LocalHides(historyDir, 'hidden-medications.jsonl').load();
  log.info(`loaded ${store.count} messages, ${deletions.count} deletions`);
  store.on('added', onMessagesAdded);
  deletions.on('added', onMessagesChanged);
  reactions.on('added', onMessagesChanged);
  reminders.on('added', onRemindersAdded);
  medications.on('added', onMedicationsAdded);
  drops.on('added', onDropsAdded);
  if (appointments) appointments.on('added', onAppointmentsAdded);
  edits.on('added', onMessagesChanged);
  receipts.on('added', (added) => {
    if (added.some((r) => !r.local)) onMessagesChanged(); // someone else has seen a message
  });
  pins.on('added', onPinsAdded);

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
    reminders,
    medications,
    drops,
    appointments,
    edits,
    receipts,
    pins,
    version: app.getVersion(),
    gifs,
    files,
    fileRetentionDays: ATTACHMENT_RETENTION_DAYS,
    dropRetentionDays: DROP_RETENTION_DAYS,
    shouldFetch: (m) => !deletions.isDeleted(m),
    peerId: config.get('peerId'),
    getProfile: () => ({ department: config.get('department'), host: HOST }),
    log,
    bindAddress: env.OKV_BIND || '0.0.0.0',
    udpPort: env.OKV_UDP_PORT ? Number(env.OKV_UDP_PORT) : undefined,
    tcpPorts: env.OKV_TCP_PORT ? [Number(env.OKV_TCP_PORT)] : undefined,
    staticPeers: [...(config.get('staticPeers') || []), ...(env.OKV_PEERS ? env.OKV_PEERS.split(',') : [])],
  });
  network.on('peers', (peers) => {
    send('peers', peers);
    rememberPeers();
  });
  try {
    await network.start();
  } catch (err) {
    log.error('network failed to start:', err.message);
  }

  updater.start();

  // Chime on the recipient's computers when a reminder falls due.
  setInterval(checkDueReminders, 15000);
  setInterval(rememberPeers, 60000);

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
  dock = initialDock();
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
    title: brand.productName,
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
    sendDock();
    win.setBounds(collapsedBounds());
    setClickThrough(true);
    if (!win.isVisible()) win.showInactive();
    if (updater) updater.installIfIdle();
  }
  send('view', { expanded, origin, lastReadAt: config.get('lastReadAt') });
}

/** Opens the panel out of the bubble, towards the middle of the screen. */
function panelBounds() {
  const icon = logoBox();
  const wa = screen.getDisplayMatching({ ...icon, width: ICON_SIZE, height: ICON_SIZE }).workArea;
  // The size this computer's board was last resized to, if it still fits the screen.
  const saved = config.get('panelSize') || {};
  const width = Math.min(Number.isFinite(saved.width) ? Math.max(saved.width, PANEL_MIN_WIDTH) : PANEL_WIDTH, wa.width - EDGE * 2);
  const height = Math.min(Number.isFinite(saved.height) ? Math.max(saved.height, PANEL_MIN_HEIGHT) : PANEL_HEIGHT, wa.height - EDGE * 2);
  const right = icon.x + ICON_SIZE / 2 > wa.x + wa.width / 2;
  const bottom = icon.y + ICON_SIZE / 2 > wa.y + wa.height / 2;
  const x = clamp(right ? icon.x + ICON_SIZE - width : icon.x, wa.x, wa.x + wa.width - width);
  const y = clamp(bottom ? icon.y + ICON_SIZE - height : icon.y, wa.y, wa.y + wa.height - height);
  return {
    rect: { x: Math.round(x), y: Math.round(y), width, height },
    origin: `${bottom ? 'bottom' : 'top'} ${right ? 'right' : 'left'}`,
  };
}

/** The logo's box as if it were all showing: where it floats, or centred on the edge it is docked to. */
function logoBox() {
  return dock ? { x: dock.edge - ICON_SIZE / 2, y: dock.y } : iconPos;
}

function collapsedBounds() {
  if (dock) {
    return {
      x: dock.side === 'left' ? dock.edge : dock.edge - DOCK_WIDTH,
      y: dock.y - PULSE_PAD,
      width: DOCK_WIDTH,
      height: ICON_SIZE + PULSE_PAD * 2,
    };
  }
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

/** A dock on the right of the main screen, a bit below the middle: where a new install starts. */
function defaultDock() {
  const wa = screen.getPrimaryDisplay().workArea;
  return makeDock('right', wa, wa.y + Math.round(wa.height * 0.62), ICON_SIZE);
}

/** The dock on whichever side of its screen the box at `pos` is nearer, at the same height. */
function dockFromBox(pos) {
  const wa = screen.getDisplayMatching({ ...pos, width: ICON_SIZE, height: ICON_SIZE }).workArea;
  const left = pos.x + ICON_SIZE / 2 < wa.x + wa.width / 2;
  return makeDock(left ? 'left' : 'right', wa, pos.y, ICON_SIZE);
}

/** The saved dock re-fitted to the screens as they are now, or null if it fits none. */
function validDock(saved) {
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const area = matchDockArea(saved, ICON_SIZE, areas);
  return area ? makeDock(saved.side, area, saved.y, ICON_SIZE) : null;
}

/**
 * How the logo starts. Docked unless it was pulled out of its dock on this computer.
 * A computer from before docking existed docks on the side its logo was nearest.
 */
function initialDock() {
  const saved = config.get('dock');
  if (saved === false) return null;
  let found = validDock(saved);
  if (!found) found = validIconPosition(config.get('iconPosition')) ? dockFromBox(iconPos) : defaultDock();
  config.set({ dock: found });
  return found;
}

/** Tells the page which edge it is docked to (null if free) so it can draw the half-hidden logo. */
function sendDock() {
  send('dock', dock ? dock.side : null);
}

function keepOnScreen() {
  iconPos = validIconPosition(iconPos) || defaultIconPosition();
  if (dock) {
    dock = validDock(dock) || defaultDock();
    config.set({ dock });
  }
  setExpanded(expanded);
}

function resetIconPosition() {
  dock = defaultDock();
  iconPos = defaultIconPosition();
  config.set({ dock, iconPosition: iconPos });
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
  const summary = unread();
  const unreadNow = summary.count + summary.reminders.unseen + summary.medications.requests + summary.medications.completed;
  tray.setToolTip(unreadNow ? `${brand.productName} – ${unreadNow} new` : brand.productName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${brand.productName} ${app.getVersion()}`, enabled: false },
      { label: dept ? `Sending as ${dept.label}` : 'No department chosen yet', enabled: false },
      { type: 'separator' },
      { label: 'Open messages', click: () => setExpanded(true) },
      ...(APPOINTMENTS ? [{ label: 'Open appointments', click: openSchedule }] : []),
      {
        label: 'Settings…',
        click: () => {
          setExpanded(true);
          send('open', 'settings');
        },
      },
      { label: 'Put the icon back on the side of the screen', click: resetIconPosition },
      { type: 'separator' },
      update.state === 'ready'
        ? { label: `Restart to update to ${update.version}`, click: () => updater.installNow() }
        : { label: 'Check for updates', enabled: app.isPackaged, click: () => updater.check() },
      { type: 'separator' },
      {
        label: `Quit ${brand.productName}`,
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

/** Unread messages plus reminders and medication requests needing attention, for the badges, pulse and tabs. */
function unread() {
  const empty = {
    count: 0,
    urgent: false,
    reminders: { open: 0, overdue: 0, unseen: 0, unseenDue: false },
    medications: { open: 0, requests: 0, completed: 0 },
    drops: { unseen: 0 },
  };
  if (!store || !config.get('department')) return empty;
  return { ...store.unread({ ...unreadContext(), exclude: isRemoved }), reminders: reminderSummary(), medications: medicationSummary(), drops: dropSummary() };
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
// ---------- Edits, seen-receipts, pinned notice, quick messages, tidy-up, computers on the network ----------

/** The wording a message currently has: its latest valid edit, or what was first sent. */
function textOf(m) {
  const edit = edits.latest(m);
  return edit ? edit.text : m.text;
}

/** Who a message is for, and which of them have seen it. Null when it isn't addressed to anyone else. */
function seenInfo(m) {
  const intended = m.to === 'all' ? DEPARTMENT_IDS.filter((d) => d !== m.from) : m.to === m.from ? [] : [m.to];
  if (!intended.length) return null;
  return { intended, seen: receipts.seenBy(m.id).filter((s) => intended.includes(s.dept)) };
}

function pinView() {
  const pin = pins ? pins.current() : null;
  return pin ? { id: pin.id, text: pin.text, by: pin.by, name: pin.byName, at: pin.createdAt } : null;
}

function onPinsAdded(added) {
  const fresh = added.some((r) => r.type === 'pin' && !r.local && r.by !== config.get('department'));
  send('pins-changed', { alert: fresh ? 'normal' : null });
}

function cleanQuickMessages(list) {
  return list
    .slice(0, MAX_QUICK_MESSAGES)
    .map((q) => ({
      text: typeof (q && q.text) === 'string' ? q.text.trim().slice(0, 200) : '',
      to: q && (q.to === 'all' || DEPARTMENT_IDS.includes(q.to)) ? q.to : 'all',
      urgent: Boolean(q && q.urgent === true),
    }))
    .filter((q) => q.text);
}

/**
 * Archives everything older than the retention period: messages (with their latest edit baked in) and
 * their GIF files move to the archive folder; messages that were deleted are discarded, GIF files included.
 * Reactions, receipts, edits and deletions about old messages have no further use and are discarded.
 */
/** Whether a message's attached files have passed the retention period (so they've been, or will be, archived). */
function attachmentsExpired(m) {
  return dayKey(m.createdAt) < dayKey(Date.now() - ATTACHMENT_RETENTION_DAYS * 86400000);
}

function tidyUp() {
  try {
    const now = Date.now();
    const cutoff = store.cutoffDay(now);
    for (const m of store.sorted) {
      if (dayKey(m.createdAt) >= cutoff) break;
      const edit = edits.latest(m);
      if (edit) Object.assign(m, { text: edit.text, editedAt: edit.createdAt });
    }
    const deleted = (m) => deletions.isDeleted(m) || hides.has(m.id);

    // Attached files: archive those on messages older than the attachment retention (a week), and remove
    // those on messages deleted for everyone, unless a message that stays uses the same file.
    const fileCutoff = dayKey(now - ATTACHMENT_RETENTION_DAYS * 86400000);
    const keepFiles = new Set();
    for (const m of store.sorted) {
      if (m.attachments && dayKey(m.createdAt) >= fileCutoff && !deletions.isDeleted(m)) for (const a of m.attachments) keepFiles.add(a.hash);
    }
    const messageFiles = new Set(keepFiles);
    for (const r of drops.all()) keepFiles.add(r.file.hash); // files in the Drop box stay until their own retention is up
    let filesTidied = 0;
    for (const m of store.sorted) {
      if (!m.attachments) continue;
      const removed = deletions.isDeleted(m);
      if (!removed && dayKey(m.createdAt) >= fileCutoff) continue;
      for (const a of m.attachments) {
        if (keepFiles.has(a.hash)) continue;
        if (removed ? files.remove(a.hash) : files.archive(a.hash)) filesTidied++;
      }
    }

    const old = store.archiveOld(now, { drop: deleted });

    const stillUsed = new Set(store.sorted.filter((m) => m.gif).map((m) => m.gif.hash));
    const archiveGifs = new Set();
    const discardGifs = new Set();
    for (const m of old) if (m.gif && !stillUsed.has(m.gif.hash)) (deleted(m) ? discardGifs : archiveGifs).add(m.gif.hash);
    for (const hash of archiveGifs) gifs.archive(hash);
    for (const hash of discardGifs) if (!archiveGifs.has(hash)) gifs.remove(hash);

    // The Drop box: files past DROP_RETENTION_DAYS go, unless a message still on the board uses the same file.
    const oldDrops = drops.archiveOld(now, { drop: () => true }).filter((r) => r.type === 'drop');
    if (oldDrops.length) {
      const inUse = new Set(messageFiles);
      for (const r of drops.all()) inUse.add(r.file.hash);
      for (const r of oldDrops) if (!inUse.has(r.file.hash) && files.remove(r.file.hash)) filesTidied++;
    }

    let other = 0;
    for (const history of [deletions, reactions, edits, receipts]) other += history.archiveOld(now, { drop: () => true }).length;
    if (old.length || other || filesTidied) {
      log.info(`tidy-up: archived ${old.length} message(s) and ${archiveGifs.size} GIF(s) older than ${RETENTION_DAYS} days, ${filesTidied} attached file(s) older than ${ATTACHMENT_RETENTION_DAYS} days, cleared ${other} old record(s)`);
      onMessagesChanged();
    }
  } catch (err) {
    log.error('tidy-up failed:', err.message);
  }
}

/** Remembers each computer seen on the network, so ones that have dropped off still show (with when they were last seen). */
function rememberPeers() {
  if (!network || !config) return;
  const history = { ...(config.get('peerHistory') || {}) };
  const now = Date.now();
  let changed = false;
  for (const p of network.peers()) {
    const prev = history[p.id];
    const next = { host: p.host, dept: p.dept, ver: p.ver, address: p.address, lastSeen: p.lastSeen };
    const different = !prev || ['host', 'dept', 'ver', 'address'].some((k) => prev[k] !== next[k]) || next.lastSeen - prev.lastSeen > 45000;
    if (different) {
      history[p.id] = next;
      changed = true;
    }
  }
  for (const [id, entry] of Object.entries(history)) {
    if (now - entry.lastSeen > 30 * 86400000) {
      delete history[id];
      changed = true;
    }
  }
  if (changed) config.set({ peerHistory: history });
}

function peersReport() {
  rememberPeers();
  const online = network ? network.peers() : [];
  const onlineIds = new Set(online.map((p) => p.id));
  const history = config.get('peerHistory') || {};
  const peers = [
    ...online.map((p) => ({ id: p.id, host: p.host, dept: p.dept, ver: p.ver, address: p.address, online: true, lastSeen: p.lastSeen, reachable: p.reachable })),
    ...Object.entries(history)
      .filter(([id]) => !onlineIds.has(id))
      .map(([id, h]) => ({ id, host: h.host, dept: h.dept, ver: h.ver, address: h.address, online: false, lastSeen: h.lastSeen, reachable: null })),
  ].sort((a, b) => Number(b.online) - Number(a.online) || (a.host || '').localeCompare(b.host || ''));
  return { self: { host: HOST, dept: config.get('department'), version: app.getVersion() }, peers };
}

// ---------- Reminders ----------

/** A reminder as the page sees it, with its current state worked out. */
function reminderView(r) {
  const s = reminders.status(r);
  return {
    ...toWire(r),
    local: Boolean(r.local),
    state: s ? s.status : 'open',
    closed: s ? { by: s.by, name: s.byName, at: s.createdAt } : null,
  };
}

/** Open reminders for this department: how many, how many overdue, and how many need noticing. */
function reminderSummary() {
  const department = config.get('department');
  const seenAt = config.get('remindersSeenAt') || 0;
  const since = config.get('firstRunAt');
  const now = Date.now();
  let open = 0;
  let overdue = 0;
  let unseen = 0;
  let unseenDue = false;
  for (const r of reminders.all()) {
    if (r.to !== department || reminders.status(r)) continue;
    open++;
    const due = r.dueAt !== null && r.dueAt <= now;
    if (due) overdue++;
    const isNew = !r.local && r.receivedAt > seenAt && r.createdAt >= since;
    const fellDue = due && r.dueAt > seenAt;
    if (isNew || fellDue) unseen++;
    if (fellDue) unseenDue = true;
  }
  return { open, overdue, unseen, unseenDue };
}

function onRemindersAdded(added) {
  const department = config.get('department');
  const since = config.get('firstRunAt');
  const fresh = added.some((r) => r.type === 'reminder' && !r.local && r.to === department && r.createdAt >= since);
  send('reminders-changed', { alert: fresh ? 'normal' : null });
  sendUnread();
}

function checkDueReminders() {
  const department = config.get('department');
  const now = Date.now();
  const nowDue = reminders
    .all()
    .filter((r) => r.to === department && r.dueAt !== null && r.dueAt > dueCheckedUntil && r.dueAt <= now && !reminders.status(r));
  dueCheckedUntil = now;
  if (!nowDue.length) return;
  log.info(`${nowDue.length} reminder(s) now due`);
  send('reminders-changed', { alert: 'urgent' });
  sendUnread();
}

/** Adds a status record (done / cancelled / open again) after checking this department may make it. */
function setReminderStatus(id, status) {
  const r = typeof id === 'string' ? reminders.reminders.get(id) : null;
  if (!r) throw new Error('Reminder not found');
  const department = config.get('department');
  const allowed =
    (status === 'done' && department === r.to) ||
    (status === 'cancelled' && department === r.from) ||
    (status === 'open' && (department === r.to || department === r.from));
  if (!allowed) throw new Error('Your department can’t do that to this reminder');
  const [record] = reminders.add(
    [
      {
        type: 'status',
        id: crypto.randomUUID(),
        target: id,
        status,
        by: department,
        byName: config.get('author') || '',
        host: HOST,
        createdAt: Date.now(),
      },
    ],
    { local: true },
  );
  if (record && network) network.pushNow([toWire(record)], 'reminders');
}

// ---------- Medication requests ----------

/** A request as the page sees it, with its current state worked out. */
function medicationView(m) {
  const s = medications.status(m);
  return {
    ...toWire(m),
    local: Boolean(m.local),
    state: s ? s.status : 'open',
    closed: s ? { by: s.by, name: s.byName, at: s.createdAt } : null,
  };
}

/**
 * For the badges and tab. `open` is every unfinished request. `requests` is new ones the alert department hasn't
 * looked at yet. `completed` is requests this department logged that someone else has ticked off since it last looked
 * (the blue notification).
 */
function medicationSummary() {
  const department = config.get('department');
  const seenAt = config.get('medicationsSeenAt') || 0;
  const since = config.get('firstRunAt');
  let open = 0;
  let requests = 0;
  let completed = 0;
  for (const m of medications.all()) {
    const s = medications.status(m);
    if (!s) {
      open++;
      if (department === MEDICATION_ALERT_DEPT && !m.local && m.receivedAt > seenAt && m.createdAt >= since) requests++;
    } else if (s.status === 'done' && m.from === department && !s.local && s.receivedAt > seenAt && s.createdAt >= since) {
      completed++;
    }
  }
  return { open, requests, completed };
}

function onMedicationsAdded(added) {
  const department = config.get('department');
  const since = config.get('firstRunAt');
  const requests = added.filter((r) => r.type === 'med' && !r.local && department === MEDICATION_ALERT_DEPT && r.createdAt >= since);
  const done = added
    .filter((r) => r.type === 'status' && r.status === 'done' && !r.local && r.createdAt >= since)
    .map((r) => medications.meds.get(r.target))
    .filter((m) => m && m.from === department && medications.status(m) && medications.status(m).status === 'done');
  send('medications-changed', {
    alert: done.length ? 'done' : requests.length ? 'normal' : null,
    done: done.map((m) => m.patient),
    requests: requests.map((m) => m.patient),
  });
  sendUnread();
}

/** Adds a status record (done / cancelled / open again) after checking this department may make it. */
function setMedicationStatus(id, status) {
  const m = typeof id === 'string' ? medications.meds.get(id) : null;
  if (!m) throw new Error('Request not found');
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  if (status === 'cancelled' && department !== m.from) throw new Error('Only the department that logged it can cancel it');
  const [record] = medications.add(
    [
      {
        type: 'status',
        id: crypto.randomUUID(),
        target: id,
        status,
        by: department,
        byName: config.get('author') || '',
        host: HOST,
        createdAt: Date.now(),
      },
    ],
    { local: true },
  );
  if (!record) throw new Error('Unknown status');
  if (network) network.pushNow([toWire(record)], 'medications');
}

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
    textOf, // search finds the edited wording
  };
}

function publicSettings() {
  return {
    department: config.get('department'),
    author: config.get('author'),
    sound: config.get('sound'),
    autoStart: config.get('autoStart'),
    quietUntil: config.get('quietUntil'),
    quickMessages: config.get('quickMessages') ?? DEFAULT_QUICK_MESSAGES,
  };
}

function applyAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!config.get('autoStart') });
}

// ---------- Appointments ----------
// A separate window, only for brands with an "appointments" block in brand.json: a day's appointments in
// columns (e.g. consulting rooms). It is independent of the message board: minimising the board leaves it
// open, and closing it is reopened from the board's top bar or the tray menu.

const SCHEDULE_STEPS = [5, 10, 15, 30];
const SCHEDULE_MIN_WIDTH = 640;
const SCHEDULE_MIN_HEIGHT = 440;

/** Where to put the schedule window: where it was last (if still on a screen), else centred on the main screen. */
function scheduleBoundsFor(saved) {
  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.min(980, work.width - 60);
  const height = Math.min(760, work.height - 60);
  const fallback = { width, height, x: work.x + Math.round((work.width - width) / 2), y: work.y + Math.round((work.height - height) / 2) };
  if (!saved || ![saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return fallback;
  const onScreen = screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return saved.x + 100 < w.x + w.width && saved.x + saved.width - 100 > w.x && saved.y + 40 < w.y + w.height && saved.y > w.y - 40;
  });
  return onScreen
    ? { x: saved.x, y: saved.y, width: Math.max(saved.width, SCHEDULE_MIN_WIDTH), height: Math.max(saved.height, SCHEDULE_MIN_HEIGHT) }
    : fallback;
}

function createScheduleWindow() {
  scheduleWin = new BrowserWindow({
    ...scheduleBoundsFor(config.get('scheduleBounds')),
    minWidth: SCHEDULE_MIN_WIDTH,
    minHeight: SCHEDULE_MIN_HEIGHT,
    title: `${brand.productName} – Appointments`,
    icon: path.join(ASSETS, 'icon.ico'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151d1d' : '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-schedule.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const w = scheduleWin;
  w.setMenu(null);
  if (config.get('scheduleOnTop')) w.setAlwaysOnTop(true, 'floating');
  w.loadFile(path.join(__dirname, '..', 'renderer', 'schedule.html'));
  w.once('ready-to-show', () => {
    w.show();
    w.focus();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (event) => event.preventDefault());
  // Remember where it was, so it opens in the same place next time.
  w.on('close', () => {
    if (!w.isDestroyed()) config.set({ scheduleBounds: w.getNormalBounds() });
  });
  w.on('closed', () => {
    if (scheduleWin === w) scheduleWin = null;
  });
}

function openSchedule() {
  if (!APPOINTMENTS || !appointments) return;
  if (scheduleWin && !scheduleWin.isDestroyed()) {
    if (scheduleWin.isMinimized()) scheduleWin.restore();
    scheduleWin.show();
    scheduleWin.focus();
    return;
  }
  createScheduleWindow();
}

function onAppointmentsAdded() {
  if (scheduleWin && !scheduleWin.isDestroyed()) scheduleWin.webContents.send('appointments-changed');
}

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function needAppointments() {
  if (!APPOINTMENTS || !appointments) throw new Error('Appointments are not available');
}

/** Saves a new appointment ('appt') or a change to one ('change', with the target's id) from this computer. */
function writeAppointment(type, input, target = null) {
  needAppointments();
  const department = config.get('department');
  if (!department) throw new Error(`Choose this computer's department in ${brand.productName} first`);
  const details = sanitizeApptDetails(input, APPT_COLUMN_IDS);
  if (!details) throw new Error('Those appointment details are not valid');
  const clash = appointments.conflict(details, target);
  if (clash) {
    const column = APPOINTMENTS.columns.find((c) => c.id === clash.col);
    throw new Error(`${column ? column.label : 'That column'} is already booked ${clock(clash.start)}–${clock(clash.start + clash.len)} (${clash.patient})`);
  }
  const [record] = appointments.add(
    [
      {
        ...details,
        type,
        ...(target ? { target } : {}),
        id: crypto.randomUUID(),
        by: department,
        byName: (config.get('author') || '').slice(0, LIMITS.AUTHOR),
        host: HOST,
        createdAt: Date.now(),
      },
    ],
    { local: true },
  );
  if (!record) throw new Error('Those appointment details are not valid');
  if (network) network.pushNow([toWire(record)], 'appointments');
  return record;
}

function setAppointmentStatus(id, status) {
  needAppointments();
  const department = config.get('department');
  if (!department) throw new Error(`Choose this computer's department in ${brand.productName} first`);
  if (typeof id !== 'string' || !appointments.appts.has(id)) throw new Error('That appointment no longer exists');
  const [record] = appointments.add(
    [{ type: 'status', id: crypto.randomUUID(), target: id, status, by: department, byName: (config.get('author') || '').slice(0, LIMITS.AUTHOR), host: HOST, createdAt: Date.now() }],
    { local: true },
  );
  if (record && network) network.pushNow([toWire(record)], 'appointments');
}

ipcMain.handle('open-schedule', () => openSchedule());

ipcMain.handle('appt-state', () => {
  needAppointments();
  const step = config.get('scheduleStep');
  return {
    productName: brand.productName,
    columns: APPOINTMENTS.columns,
    dayStart: APPOINTMENTS.dayStart,
    dayEnd: APPOINTMENTS.dayEnd,
    colors: APPT_COLORS,
    steps: SCHEDULE_STEPS,
    step: SCHEDULE_STEPS.includes(step) ? step : 15,
    onTop: Boolean(config.get('scheduleOnTop')),
    department: config.get('department'),
    departments: DEPARTMENTS,
  };
});

ipcMain.handle('appt-day', (_e, day) => {
  needAppointments();
  if (!validApptDay(day)) throw new Error('Not a valid day');
  return appointments.forDay(day);
});

ipcMain.handle('appt-add', (_e, input = {}) => {
  const record = writeAppointment('appt', input);
  return appointments.get(record.id);
});

ipcMain.handle('appt-change', (_e, input = {}) => {
  needAppointments();
  if (typeof input.id !== 'string' || !appointments.get(input.id)) throw new Error('That appointment no longer exists');
  writeAppointment('change', input, input.id);
  return appointments.get(input.id);
});

ipcMain.handle('appt-remove', (_e, { id } = {}) => setAppointmentStatus(id, 'removed'));
ipcMain.handle('appt-restore', (_e, { id } = {}) => setAppointmentStatus(id, 'restored'));

ipcMain.handle('appt-set', (_e, values = {}) => {
  needAppointments();
  const next = {};
  if (SCHEDULE_STEPS.includes(values.step)) next.scheduleStep = values.step;
  if (typeof values.onTop === 'boolean') {
    next.scheduleOnTop = values.onTop;
    if (scheduleWin && !scheduleWin.isDestroyed()) scheduleWin.setAlwaysOnTop(values.onTop, 'floating');
  }
  config.set(next);
});

// ---------- IPC ----------

ipcMain.handle('get-state', () => ({
  version: app.getVersion(),
  host: HOST,
  brand: { productName: brand.productName },
  appointments: { enabled: Boolean(APPOINTMENTS) },
  departments: DEPARTMENTS,
  reactions: REACTIONS,
  gifPlaceholder: GIF_PLACEHOLDER,
  attachPlaceholder: ATTACH_PLACEHOLDER,
  fileMaxBytes: LIMITS.FILE_BYTES,
  maxAttachments: LIMITS.MAX_ATTACHMENTS,
  attachTotalBytes: LIMITS.ATTACH_TOTAL_BYTES,
  attachmentRetentionDays: ATTACHMENT_RETENTION_DAYS,
  dropRetentionDays: DROP_RETENTION_DAYS,
  maxDrops: LIMITS.MAX_DROPS,
  blockedExtensions: [...BLOCKED_EXTENSIONS],
  gifMaxBytes: LIMITS.GIF_BYTES,
  editWindowMs: EDIT_WINDOW_MS,
  retentionDays: RETENTION_DAYS,
  maxQuickMessages: MAX_QUICK_MESSAGES,
  pin: pinView(),
  settings: publicSettings(),
  expanded,
  dock: dock ? dock.side : null,
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
  const me = config.get('department');
  result.messages = result.messages.map((m) => {
    const edit = edits.latest(m);
    return {
      ...m,
      text: edit ? edit.text : m.text,
      editedAt: edit ? edit.createdAt : null,
      reactions: reactions.forMessage(m.id, REACTIONS),
      reply: m.replyTo ? store.quote(m.replyTo, isRemoved, textOf) : null,
      attachments: m.attachments ? m.attachments.map((a) => ({ ...a, have: files.has(a.hash), expired: attachmentsExpired(m) })) : undefined,
      // For messages we sent: which of the people they're for have seen it.
      seen: m.from === me ? seenInfo(m) : null,
      // For messages sent to us: whether this department has already said it's seen it.
      seenByMe: m.from === me || !(m.to === 'all' || m.to === me) || receipts.hasSeen(m.id, me),
    };
  });
  return result;
});

ipcMain.handle('send-message', (_e, input = {}) => {
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  const author = typeof input.author === 'string' ? input.author.trim().slice(0, LIMITS.AUTHOR) : '';
  // An attached GIF is checked and stored here; the message carries only its fingerprint.
  let gif = null;
  if (input.gif && input.gif.data) gif = gifs.add(Buffer.from(input.gif.data));
  // Attached files and images: every one is checked before any is stored.
  let attachments;
  if (Array.isArray(input.files) && input.files.length) {
    if (input.files.length > LIMITS.MAX_ATTACHMENTS) throw new Error(`You can attach up to ${LIMITS.MAX_ATTACHMENTS} files to one message`);
    const picked = input.files.map((f) => ({ name: f && f.name, data: Buffer.from((f && f.data) || []) }));
    const total = picked.reduce((n, f) => n + f.data.length, 0);
    if (total > LIMITS.ATTACH_TOTAL_BYTES) {
      throw new Error(`Those files are too large together (the limit is ${LIMITS.ATTACH_TOTAL_BYTES / 1024 / 1024} MB for one message)`);
    }
    for (const f of picked) inspectFile(f.data, f.name);
    attachments = picked.map((f) => files.add(f.data, f.name));
  }
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const [message] = store.add(
    [
      {
        id: crypto.randomUUID(),
        from: department,
        to: input.to,
        author,
        host: HOST,
        text: !text && (gif || attachments) ? (gif ? GIF_PLACEHOLDER : ATTACH_PLACEHOLDER) : input.text,
        gif,
        attachments,
        replyTo: typeof input.replyTo === 'string' && store.has(input.replyTo) ? input.replyTo : undefined,
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
  if (Array.isArray(values.quickMessages)) next.quickMessages = cleanQuickMessages(values.quickMessages);
  if (values.resetQuickMessages === true) next.quickMessages = null; // back to the standard buttons
  config.set(next);
  if ('autoStart' in next) applyAutoStart();
  return publicSettings();
});

ipcMain.handle('set-expanded', (_e, value) => setExpanded(!!value));

ipcMain.handle('mark-read', () => {
  config.set({ lastReadAt: Date.now() });
  sendUnread();
});

ipcMain.handle('reminders-list', (_e, { view } = {}) => {
  const department = config.get('department');
  const items = reminders
    .all()
    .filter((r) => !reminderHides.has(r.id))
    .map(reminderView);
  if (view === 'done') {
    return items
      .filter((r) => r.state !== 'open' && (r.to === department || r.from === department))
      .sort((a, b) => b.closed.at - a.closed.at);
  }
  return items
    .filter((r) => r.state === 'open')
    .filter((r) => (view === 'for-us' ? r.to === department : view === 'sent' ? r.from === department : true))
    .sort((a, b) => {
      // Reminders with a due time first, soonest (or most overdue) at the top; then the rest, newest first.
      if ((a.dueAt === null) !== (b.dueAt === null)) return a.dueAt === null ? 1 : -1;
      if (a.dueAt !== null) return a.dueAt - b.dueAt;
      return b.createdAt - a.createdAt;
    });
});

ipcMain.handle('reminder-add', (_e, input = {}) => {
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  const [record] = reminders.add(
    [
      {
        type: 'reminder',
        id: crypto.randomUUID(),
        from: department,
        to: input.to,
        name: typeof input.name === 'string' ? input.name.trim().slice(0, LIMITS.AUTHOR) : '',
        author: config.get('author') || '',
        host: HOST,
        text: input.text,
        dueAt: Number.isFinite(input.dueAt) ? input.dueAt : null,
        createdAt: Date.now(),
      },
    ],
    { local: true },
  );
  if (!record) throw new Error('Reminder was empty or invalid');
  if (network) network.pushNow([toWire(record)], 'reminders');
  return reminderView(record);
});

ipcMain.handle('reminder-status', (_e, { id, status } = {}) => setReminderStatus(id, status));

// Clears closed reminders from this computer's Done list (they stay in the history file).
ipcMain.handle('reminders-clear-done', () => {
  const department = config.get('department');
  const ids = reminders
    .all()
    .filter((r) => (r.to === department || r.from === department) && reminders.status(r))
    .map((r) => r.id);
  if (reminderHides.setMany(ids, true)) send('reminders-changed', { alert: null });
});

// Names to suggest for a department: people reminders went to, then names its staff sign messages with.
ipcMain.handle('reminder-names', (_e, department) => {
  if (!DEPARTMENT_IDS.includes(department)) return [];
  const names = reminders.namesFor(department);
  const seen = new Set(names.map((n) => n.toLowerCase()));
  for (let i = store.sorted.length - 1; i >= 0 && names.length < 40; i--) {
    const m = store.sorted[i];
    if (m.from !== department || !m.author || seen.has(m.author.toLowerCase())) continue;
    seen.add(m.author.toLowerCase());
    names.push(m.author);
  }
  return names;
});

ipcMain.handle('reminders-seen', () => {
  config.set({ remindersSeenAt: Date.now() });
  sendUnread();
});

ipcMain.handle('medications-list', (_e, { view } = {}) => {
  const items = medications
    .all()
    .filter((m) => !medicationHides.has(m.id))
    .map(medicationView);
  if (view === 'done') {
    const from = Date.now() - RETENTION_DAYS * 86400000; // finished requests are listed for as long as messages are kept
    return items.filter((m) => m.state !== 'open' && m.closed.at >= from).sort((a, b) => b.closed.at - a.closed.at);
  }
  // Oldest first, so the longest-waiting request is at the top.
  return items.filter((m) => m.state === 'open').sort((a, b) => a.createdAt - b.createdAt);
});

ipcMain.handle('medication-add', (_e, input = {}) => {
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  const [record] = medications.add(
    [
      {
        type: 'med',
        id: crypto.randomUUID(),
        from: department,
        patient: input.patient,
        items: input.items,
        author: config.get('author') || '',
        host: HOST,
        createdAt: Date.now(),
      },
    ],
    { local: true },
  );
  if (!record) throw new Error('Request was empty or invalid');
  if (network) network.pushNow([toWire(record)], 'medications');
  return medicationView(record);
});

// Puts a patient's name, a medication line or a whole request on the clipboard, for pasting into the practice software.
// (A request is at most a patient name plus ten medication lines.)
const COPY_MAX = LIMITS.PATIENT + LIMITS.MAX_MEDICATIONS * (LIMITS.MEDICATION + LIMITS.QUANTITY + 8);
ipcMain.handle('copy-text', (_e, text) => {
  if (typeof text !== 'string' || !text.trim() || text.length > COPY_MAX) throw new Error('Nothing to copy');
  clipboard.writeText(text.trim());
  return true;
});

ipcMain.handle('medication-status', (_e, { id, status } = {}) => setMedicationStatus(id, status));

// Clears finished requests from this computer's Done list (they stay in the history file).
ipcMain.handle('medications-clear-done', () => {
  const ids = medications
    .all()
    .filter((m) => medications.status(m))
    .map((m) => m.id);
  if (medicationHides.setMany(ids, true)) send('medications-changed', { alert: null });
});

// The Medications tab has been looked at: clears the "new request" and blue "completed" notifications.
ipcMain.handle('medications-seen', () => {
  config.set({ medicationsSeenAt: Date.now() });
  sendUnread();
});

// ---------- Drop box ----------

/** A file in the Drop box as the page sees it. */
function dropView(r) {
  return { ...toWire(r), local: Boolean(r.local), have: files.has(r.file.hash) };
}

/** Files other computers have put in the Drop box (and not taken out again) since this one last looked. */
function dropSummary() {
  const seenAt = config.get('dropsSeenAt') || 0;
  const since = config.get('firstRunAt');
  let unseen = 0;
  for (const r of drops.all()) {
    if (!r.local && r.receivedAt > seenAt && r.createdAt >= since && !drops.removal(r)) unseen++;
  }
  return { unseen };
}

function onDropsAdded(added) {
  const since = config.get('firstRunAt');
  const fresh = added.filter((r) => r.type === 'drop' && !r.local && r.createdAt >= since);
  send('drops-changed', { fresh: fresh.map((r) => ({ from: r.from, name: r.file.name })) });
  sendUnread();
}

// The Drop box, newest first. Files that have been taken out are left off.
ipcMain.handle('drops-list', () =>
  drops
    .all()
    .filter((r) => !drops.removal(r))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
    .map(dropView),
);

// Puts one file in the Drop box. The page sends them one at a time so each can be checked, and refused, on its own.
ipcMain.handle('drop-add', (_e, input = {}) => {
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  const data = Buffer.from((input && input.data) || []);
  const file = files.add(data, input && input.name); // throws a message fit to show if it's empty, too big or not allowed
  const author = config.get('author') || '';
  const [record] = drops.add(
    [{ type: 'drop', id: crypto.randomUUID(), from: department, file, author, host: HOST, createdAt: Date.now() }],
    { local: true },
  );
  if (!record) throw new Error('That file couldn’t be added');
  if (network) network.pushNow([toWire(record)], 'drops');
  return dropView(record);
});

// Takes a file out of the Drop box for everyone, or with `undo` puts it back.
ipcMain.handle('drop-remove', (_e, { id, undo } = {}) => {
  const target = typeof id === 'string' ? drops.drops.get(id) : null;
  if (!target) throw new Error('That file isn’t in the Drop box');
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  const [record] = drops.add(
    [
      {
        type: 'status',
        id: crypto.randomUUID(),
        target: id,
        status: undo ? 'open' : 'removed',
        by: department,
        byName: config.get('author') || '',
        host: HOST,
        createdAt: Date.now(),
      },
    ],
    { local: true },
  );
  if (!record) throw new Error('That couldn’t be done');
  if (network) network.pushNow([toWire(record)], 'drops');
  sendUnread();
});

// The Drop box has been looked at.
ipcMain.handle('drops-seen', () => {
  config.set({ dropsSeenAt: Date.now() });
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
    return;
  }
  // `pos` is where the window began plus how far the pointer has moved, whatever shape
  // the window has now, so work from the movement. (The window changes shape when the logo is pulled out.)
  const { x: x0, y: y0 } = win.getBounds();
  if (!dragStart) dragStart = { box: { ...logoBox() }, from: { x: x0, y: y0 } };
  const dx = x - dragStart.from.x;
  const dy = y - dragStart.from.y;
  if (dock) {
    // Docked: up and down moves it along the edge; pulling it away from the edge frees it.
    const pulled = dock.side === 'left' ? dx : -dx;
    if (pulled <= DOCK_DETACH) {
      const wa = screen.getDisplayMatching(win.getBounds()).workArea;
      dock = makeDock(dock.side, wa, dragStart.box.y + dy, ICON_SIZE);
      win.setBounds(collapsedBounds());
      return;
    }
    dock = null;
    sendDock();
  }
  iconPos = { x: dragStart.box.x + dx, y: dragStart.box.y + dy };
  win.setBounds(collapsedBounds());
  setDockHint(Boolean(snapSideFor(iconPos)));
});

/** Which side the free logo at `box` would dock to if dropped now, or null. */
function snapSideFor(box) {
  const wa = screen.getDisplayMatching({ ...box, width: ICON_SIZE, height: ICON_SIZE }).workArea;
  return dockSnap(box, ICON_SIZE, wa, DOCK_SNAP);
}

/** Lets the page glow the logo while it is close enough to an edge to dock. */
function setDockHint(on) {
  if (on === dockHint) return;
  dockHint = on;
  send('dock-hint', on);
}

ipcMain.on('drag-end', () => {
  if (!win) return;
  if (expanded && dock) {
    // The board can go anywhere; closing it sends the logo back to its dock.
    panelRect = clampToWorkArea(win.getBounds());
    win.setBounds(panelRect);
  } else if (expanded) {
    // The bubble follows the panel, so it collapses and reopens in the same place.
    iconPos = validIconPosition(iconForPanel(clampToWorkArea(win.getBounds()))) || defaultIconPosition();
    panelRect = panelBounds().rect;
    win.setBounds(panelRect);
    config.set({ iconPosition: iconPos });
  } else {
    dragStart = null;
    setDockHint(false);
    const side = dock ? null : snapSideFor(iconPos);
    if (side) {
      // Dropped by an edge: it docks there, level with where it was dropped.
      const wa = screen.getDisplayMatching({ ...iconPos, width: ICON_SIZE, height: ICON_SIZE }).workArea;
      dock = makeDock(side, wa, iconPos.y, ICON_SIZE);
    }
    iconPos = validIconPosition(iconPos) || defaultIconPosition();
    sendDock();
    win.setBounds(collapsedBounds());
    config.set({ dock: dock || false, iconPosition: iconPos });
  }
});

// Resizing the open board by dragging an edge or corner. Windows gives frameless
// transparent windows no resize borders, so the page draws its own handles and
// reports the pointer's movement since the drag began.
let resizeFrom = null; // { edge, bounds } for the drag in progress

ipcMain.on('resize-start', (_e, edge) => {
  if (!win || !expanded || typeof edge !== 'string' || !/^[nsew]{1,2}$/.test(edge)) return;
  resizeFrom = { edge, bounds: win.getBounds() };
});

ipcMain.on('resize-move', (_e, d) => {
  if (!win || !expanded || !resizeFrom || !d || !Number.isFinite(d.dx) || !Number.isFinite(d.dy)) return;
  const { edge, bounds } = resizeFrom;
  const area = screen.getDisplayMatching(bounds).workArea;
  win.setBounds(resizeBounds(edge, bounds, d.dx, d.dy, area, { width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT }));
});

ipcMain.on('resize-end', () => {
  if (!win || !resizeFrom) return;
  resizeFrom = null;
  const { width, height } = win.getBounds();
  config.set({ panelSize: { width, height } });
  if (dock) {
    // A docked logo stays put; the board just keeps the new size.
    panelRect = clampToWorkArea(win.getBounds());
    win.setBounds(panelRect);
    return;
  }
  // As with moving it, the bubble follows to the board's nearest corner.
  iconPos = validIconPosition(iconForPanel(clampToWorkArea(win.getBounds()))) || defaultIconPosition();
  panelRect = panelBounds().rect;
  win.setBounds(panelRect);
  config.set({ iconPosition: iconPos });
});

ipcMain.on('click-through', (_e, on) => setClickThrough(!!on));

// Correct a message's wording. Only its sender's department may, and only shortly after sending.
ipcMain.handle('edit-message', (_e, { id, text } = {}) => {
  const department = config.get('department');
  const message = typeof id === 'string' ? store.byId.get(id) : null;
  if (!message) throw new Error('Message not found');
  if (message.from !== department) throw new Error('Only the department that sent it can edit it');
  if (Date.now() - message.createdAt > EDIT_WINDOW_MS) throw new Error('It’s too late to edit that message');
  const [record] = edits.add(
    [{ id: crypto.randomUUID(), target: id, text, by: department, host: HOST, createdAt: Date.now() }],
    { local: true },
  );
  if (!record) throw new Error('The message can’t be empty');
  if (network) network.pushNow([toWire(record)], 'edits');
  return true;
});

// The page reports messages that have been on screen; this department's "seen" is recorded once for each.
ipcMain.handle('mark-seen', (_e, ids) => {
  const department = config.get('department');
  if (!department || !Array.isArray(ids)) return 0;
  const now = Date.now();
  const records = [];
  for (const id of ids.slice(0, 200)) {
    const m = typeof id === 'string' ? store.byId.get(id) : null;
    if (!m || m.from === department || !(m.to === 'all' || m.to === department) || receipts.hasSeen(id, department)) continue;
    records.push({ id: receiptId(id, department), target: id, by: department, host: HOST, createdAt: now });
  }
  const added = receipts.add(records, { local: true });
  if (added.length && network) network.pushNow(added.map(toWire), 'receipts');
  return added.length;
});

ipcMain.handle('pin-get', () => pinView());

ipcMain.handle('pin-set', (_e, text) => {
  const department = config.get('department');
  if (!department) throw new Error('Choose a department first');
  const [record] = pins.add(
    [{ type: 'pin', id: crypto.randomUUID(), text, by: department, byName: config.get('author') || '', host: HOST, createdAt: Date.now() }],
    { local: true },
  );
  if (!record) throw new Error('The notice was empty or too long');
  if (network) network.pushNow([toWire(record)], 'pins');
  return pinView();
});

ipcMain.handle('pin-clear', () => {
  const current = pins.current();
  const department = config.get('department');
  if (!current || !department) return null;
  const [record] = pins.add(
    [{ type: 'clear', id: crypto.randomUUID(), target: current.id, by: department, byName: config.get('author') || '', host: HOST, createdAt: Date.now() }],
    { local: true },
  );
  if (record && network) network.pushNow([toWire(record)], 'pins');
  return pinView();
});

// Mutes sounds on this computer for a while (urgent messages still sound). 0 turns them back on.
ipcMain.handle('set-quiet', (_e, minutes) => {
  const m = Number(minutes);
  config.set({ quietUntil: Number.isFinite(m) && m > 0 ? Date.now() + Math.min(m, 24 * 60) * 60000 : null });
  return publicSettings();
});

ipcMain.handle('peers-report', () => peersReport());

// Saves messages as a spreadsheet (CSV): live and archived ones in the chosen period.
ipcMain.handle('export-messages', async (_e, { range } = {}) => {
  const { from, to, label } = rangeBounds(range);
  const historyDir = path.join(app.getPath('userData'), 'history');
  const rows = mergeMessages(store.sorted.filter((m) => !isRemoved(m)), readArchivedMessages(historyDir))
    .filter((m) => m.createdAt >= from && m.createdAt < to)
    .map((m) => ({ ...m, text: textOf(m) }));
  const stamp = new Date().toISOString().slice(0, 10);
  // OKV_TEST_PICK (development only) skips the file dialogs so automated checks can save into a folder.
  const chosen = env.OKV_TEST_PICK ? { filePath: path.join(env.OKV_TEST_PICK, 'export.csv') } : await dialog.showSaveDialog(win, {
    title: 'Save messages',
    defaultPath: path.join(app.getPath('documents'), `${brand.shortName}-messages-${label}-${stamp}.csv`),
    filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }],
  });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  const csv = toCsv(rows, {
    label: (id) => (DEPARTMENTS.find((d) => d.id === id) || { label: id }).label,
    edited: (m) => Boolean(m.editedAt) || Boolean(edits.latest(m)),
  });
  fs.writeFileSync(chosen.filePath, '\uFEFF' + csv, 'utf8'); // the mark makes Excel read accents and emoji correctly
  log.info(`exported ${rows.length} message(s) to ${chosen.filePath}`);
  return { path: chosen.filePath, count: rows.length };
});

// Copies the whole history (messages, GIFs, archive) and settings into a dated folder somewhere the user picks.
ipcMain.handle('backup-history', async () => {
  const picked = env.OKV_TEST_PICK
    ? { filePaths: [env.OKV_TEST_PICK] }
    : await dialog.showOpenDialog(win, { title: 'Choose where to save the backup', properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const dest = path.join(picked.filePaths[0], `${brand.productName.replace(/\s+/g, '-')}-backup-${stamp}`);
  fs.mkdirSync(dest, { recursive: true });
  const result = copyFolder(path.join(app.getPath('userData'), 'history'), path.join(dest, 'history'));
  fs.copyFileSync(config.file, path.join(dest, 'config.json'));
  log.info(`backed up ${result.files} file(s) to ${dest}`);
  return { path: dest, ...result };
});

// Opens an attached file in whatever program Windows uses for that kind of file. Files are stored by fingerprint,
// so it's copied out under its real name first, and the same safety checks are made again.
ipcMain.handle('open-file', async (_e, { hash, name } = {}) => {
  const source = typeof hash === 'string' ? files.pathOf(hash) : null;
  if (!source) throw new Error('That file isn’t on this computer yet');
  const safeName = cleanFileName(name);
  if (isBlockedName(safeName) || !checkBytes(files.read(hash))) throw new Error('That kind of file can’t be opened from here');
  const dir = path.join(app.getPath('userData'), 'opened', hash.slice(0, 16));
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, safeName);
  if (!fs.existsSync(target)) fs.copyFileSync(source, target);
  if (env.OKV_TEST_PICK) return { copiedTo: target }; // development only: don't launch programs during automated checks
  const problem = await shell.openPath(target);
  if (problem) throw new Error(`Windows couldn’t open that file: ${problem}`);
  return true;
});

ipcMain.handle('save-file', async (_e, { hash, name } = {}) => {
  const source = typeof hash === 'string' ? files.pathOf(hash) : null;
  if (!source) throw new Error('That file isn’t on this computer yet');
  const safeName = cleanFileName(name);
  // OKV_TEST_PICK (development only) skips the file dialog so automated checks can save into a folder.
  const chosen = env.OKV_TEST_PICK
    ? { filePath: path.join(env.OKV_TEST_PICK, safeName) }
    : await dialog.showSaveDialog(win, { title: 'Save a copy', defaultPath: path.join(app.getPath('downloads'), safeName) });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  fs.copyFileSync(source, chosen.filePath);
  return { path: chosen.filePath };
});

// The Media tab: images, files and GIFs from messages still on the board.
ipcMain.handle('media-list', (_e, opts = {}) =>
  listMedia(store.sorted, {
    isRemoved,
    hasFile: (hash) => files.has(hash),
    hasGif: (hash) => gifs.has(hash),
    retentionDays: ATTACHMENT_RETENTION_DAYS,
    filter: ['all', 'images', 'files'].includes(opts.filter) ? opts.filter : 'all',
    search: typeof opts.search === 'string' ? opts.search.slice(0, 100) : '',
  }),
);

ipcMain.handle('open-archive-folder', () => {
  const dir = path.join(app.getPath('userData'), 'history', 'archive');
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// A GIF pasted as a web link (e.g. from the Windows emoji panel's GIF tab): fetched here, then attached like a chosen file.
ipcMain.handle('fetch-gif-url', async (_e, url) => {
  if (typeof url !== 'string') throw new Error('No link given');
  const data = await fetchGif(url);
  return { data, name: nameFromUrl(url) };
});

// Lets the page record what a paste contained when it couldn't use it, to help work out why.
ipcMain.on('log-note', (_e, note) => {
  if (typeof note === 'string') log.info(`page: ${note.slice(0, 600)}`);
});

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
