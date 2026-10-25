const { app, BrowserWindow, Tray, Menu, ipcMain, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const net = require('net');
const mark = require('./mark');
const createPill = require('./pill-main');
const createTimers = require('./timers-main');

// The two resizable views. Mini's size comes from the renderer (it grows while a
// timer runs); full screen restores whatever was there before.
const MODES = {
  standard: { width: 1160, height: 820, minWidth: 880, minHeight: 640 },
  minimal:  { width: 400,  height: 660, minWidth: 340, minHeight: 520 }
};
const STATE_FILE = path.join(app.getPath('userData'), 'win-state.json');
const LEGACY_POS = path.join(app.getPath('userData'), 'win-pos.json');
let win;
let tray = null;
let pill = null;        // the pill (pill-main.js), once the app is ready
let timers = null;      // the timers (timers-main.js), once the app is ready
let saveT = null;
let inMini = false;
let fsRestore = null;   // bounds to return to after full screen (also marks the transition)
let pending = null;     // a view change that arrived mid-transition, replayed after it
// the timers docked under the minimal view make its window that much taller: want is what the
// page last said, on is what the window has now (so its own size is always height - on)
const dock = { want: 0, on: 0 };
let state = { mode: 'standard', bounds: {}, onTop: false, maximized: false, bg: '#060607', mark: null };
const isHex = c => /^#[0-9a-f]{6}$/i.test(c);

// needed for Windows toast notifications from the renderer
app.setAppUserModelId('com.hugo.flow');

// one FLOW at a time — launching it again (e.g. while it sits in the tray) shows the running one
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', (_e, argv) => {
  // another app adding a timer (CORE's "how long?"): FLOW's window stays where it is
  if (timers && timers.fromArgs(argv)) return;
  // CORE's FLOW box: a focus session by name, in the pill (1.5.0)
  if (pill && pill.fromArgs(argv)) return;
  // CORE's view menu: that view, where it was last (below)
  if (viewFromArgs(argv)) return;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
});

function loadState() {
  try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); }
  catch {
    try {
      const p = JSON.parse(fs.readFileSync(LEGACY_POS, 'utf8'));
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) state.bounds.standard = { x: p.x, y: p.y };
    } catch {}
  }
  if (!MODES[state.mode]) state.mode = 'standard';
  if (!state.bounds || typeof state.bounds !== 'object') state.bounds = {};
  if (!isHex(state.bg)) state.bg = '#060607';
  if (!Array.isArray(state.mark) || state.mark.length !== 4 || !state.mark.every(isHex)) state.mark = null;
}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
}

/* where a saved rect belongs: the display holding most of it, by the display's bounds — not its work area.
   CORE's bar keeps the top of Hugo's top monitor as an AppBar (240 px, or 56 for its minimal bar), so a FLOW
   saved under the minimal bar used to count as off screen while the bar was up, and came back in the middle
   of the main monitor (Hugo, 2026-10-22: "flow remembers window position of both pill and main window … it
   needs to function independently of the layouts"). */
function homeOf(b) {
  let best = null, most = 0;
  for (const d of screen.getAllDisplays()) {
    const B = d.bounds;
    const w = Math.min(b.x + b.width, B.x + B.width) - Math.max(b.x, B.x), h = Math.min(b.y + b.height, B.y + B.height) - Math.max(b.y, B.y);
    if (w > 0 && h > 0 && w * h > most) { most = w * h; best = d; }
  }
  // a quarter of it (or a good handful of pixels) still on a screen: it stays there
  return best && most >= Math.min(b.width * b.height / 4, 6400) ? best : null;
}
// into a work area: moved first, made smaller only when it has to be
function fitIn(b, area) {
  const width = Math.min(b.width, area.width), height = Math.min(b.height, area.height);
  return { x: Math.min(Math.max(b.x, area.x), area.x + area.width - width), y: Math.min(Math.max(b.y, area.y), area.y + area.height - height), width, height };
}
// saved bounds for a view, on the screen they were on (below anything that keeps its top); a view never
// saved keeps the current top-right corner (where the view buttons are), or centres on first launch
function boundsFor(mode, anchor) {
  const def = MODES[mode], saved = state.bounds[mode] || {};
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const s = { x: saved.x, y: saved.y, width: Math.max(saved.width || def.width, def.minWidth), height: Math.max(saved.height || def.height, def.minHeight) };
    const home = homeOf(s);
    if (home) return fitIn(s, home.workArea);
  }
  const area = (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea;
  const width = Math.min(Math.max(saved.width || def.width, def.minWidth), area.width);
  const height = Math.min(Math.max(saved.height || def.height, def.minHeight), area.height);
  const b = { x: 0, y: 0, width, height };
  b.x = anchor ? anchor.x + anchor.width - width : area.x + Math.round((area.width - width) / 2);
  b.y = anchor ? anchor.y : area.y + Math.round((area.height - height) / 2);
  b.x = Math.min(Math.max(b.x, area.x), area.x + area.width - width);
  b.y = Math.min(Math.max(b.y, area.y), area.y + area.height - height);
  return b;
}
function minFor(mode, b) {
  const def = MODES[mode], area = screen.getDisplayMatching(b).workArea, extra = mode === 'minimal' ? dock.on : 0;
  return [Math.min(def.minWidth, area.width), Math.min(def.minHeight + extra, area.height)];
}
// taller by d, upward if the bottom would leave the screen
function grow(b, d) {
  const area = screen.getDisplayMatching(b).workArea;
  b.height = Math.max(1, b.height + d);
  if (b.y + b.height > area.y + area.height) b.y = Math.max(area.y, area.y + area.height - b.height);
  return b;
}
function busy() { return !win || win.isDestroyed() || win.isFullScreen() || fsRestore; }
function applyDock() {
  if (busy() || inMini || state.mode !== 'minimal' || dock.want === dock.on) return;
  const b = grow(win.getBounds(), dock.want - dock.on);
  dock.on = dock.want;
  win.setMinimumSize(1, 1);
  win.setBounds(b);
  win.setMinimumSize(...minFor('minimal', b));
}

function remember() {
  if (busy()) return;
  if (inMini) { const b = win.getBounds(); state.bounds.mini = { x: b.x, y: b.y }; }
  else {
    const nb = win.getNormalBounds();
    state.bounds[state.mode] = state.mode === 'minimal' && dock.on ? { ...nb, height: nb.height - dock.on } : nb;
    if (state.mode === 'standard') state.maximized = win.isMaximized();
  }
  saveState();
}

function applyMode(mode) {
  const anchor = win.getBounds();
  if (win.isMaximized()) win.unmaximize();
  state.mode = mode;
  const b = boundsFor(mode, anchor);
  dock.on = mode === 'minimal' ? dock.want : 0;
  if (dock.on) grow(b, dock.on);
  win.setMinimumSize(1, 1);
  win.setResizable(true);
  win.setMaximizable(mode === 'standard');
  win.setBounds(b);
  win.setMinimumSize(...minFor(mode, b));
  win.setAlwaysOnTop(mode === 'minimal' && state.onTop, 'floating');
  if (mode === 'standard' && state.maximized) win.maximize();
  saveState();
}
function setMode(mode) {
  if (!MODES[mode]) return;
  if (busy()) { pending = () => setMode(mode); return; }
  if (!inMini && mode === state.mode) return;
  if (!inMini) remember();
  inMini = false;
  applyMode(mode);
}
function setMini(mini, width, height) {
  if (busy()) { pending = () => setMini(mini, width, height); return; }
  if (!mini) {
    if (!inMini) return;
    inMini = false;
    applyMode(state.mode);
    return;
  }
  const cur = win.getBounds();
  let b = { x: cur.x, y: cur.y, width, height };
  if (!inMini) {
    remember();
    if (win.isMaximized()) win.unmaximize();
    inMini = true; dock.on = 0;
    const saved = state.bounds.mini, at = win.getBounds();
    b = { x: at.x + at.width - width, y: at.y, width, height };
    const s = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y, width, height } : null, home = s && homeOf(s);
    if (home) b = fitIn(s, home.workArea);
  }
  win.setMinimumSize(1, 1);
  win.setResizable(true);
  win.setMaximizable(false);
  win.setBounds(b);
  win.setResizable(false);
  win.setAlwaysOnTop(true, 'floating');
}

function createWindow() {
  loadState();
  const mode = state.mode, b = boundsFor(mode), [minWidth, minHeight] = minFor(mode, b);
  win = new BrowserWindow({
    ...b,
    minWidth,
    minHeight,
    backgroundColor: state.bg || '#060607',
    icon: iconFile(),
    title: 'FLOW',
    frame: false,
    resizable: true,
    maximizable: mode === 'standard',
    fullscreenable: false,
    alwaysOnTop: mode === 'minimal' && state.onTop,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // the page keeps time and fades the music while it is hidden to the tray (the pill's
      // music bars, an open session's breaks); it stops drawing by itself (win:vis)
      backgroundThrottling: false
    }
  });
  if (mode === 'minimal' && state.onTop) win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    if (mode === 'standard' && state.maximized) win.maximize();
    win.show();
  });

  const queue = () => { clearTimeout(saveT); saveT = setTimeout(remember, 400); };
  win.on('moved', queue);
  win.on('resized', queue);
  win.on('maximize', () => { queue(); win.webContents.send('win:maxed', true); });
  win.on('unmaximize', () => { queue(); win.webContents.send('win:maxed', false); });

  const vis = () => { if (win && !win.isDestroyed()) win.webContents.send('win:vis', win.isVisible() && !win.isMinimized()); };
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, vis);

  win.on('enter-full-screen', () => win.webContents.send('win:fs', true));
  win.on('leave-full-screen', () => {
    win.setFullScreenable(false);
    // the monitor's top was just taken (CORE's bar came up): full screen below it now, still in the full screen view
    if (fsSwitch) {
      fsSwitch = false;
      setTimeout(() => { if (win && !win.isDestroyed() && fsRestore) enterSoft(screen.getDisplayMatching(win.getBounds())); }, 50);
      return;
    }
    win.webContents.send('win:fs', false);
    // Windows finishes the fullscreen transition AFTER this event and stomps any
    // bounds set synchronously here — restore on the next tick instead
    const r = fsRestore;
    setTimeout(() => afterFs(r), 50);
  });
}
// back from either full screen: the bounds it had, its view's limits, what waited for it
function afterFs(r) {
  if (!win || win.isDestroyed()) return;
  if (r) { win.setBounds(r.bounds); if (r.maximized) win.maximize(); }
  if (!inMini) win.setMinimumSize(...minFor(state.mode, win.getBounds()));
  win.setResizable(!inMini);
  win.setAlwaysOnTop(inMini || (state.mode === 'minimal' && state.onTop), 'floating');
  fsRestore = null;
  const p = pending; pending = null;
  if (p) p(); else applyDock();
}

/* ── Full screen below a bar (Hugo, 2026-10-22: "top monitor fix — when i select the full screen view of flow,
   it goes under the bar, i would like the full screen view of flow in the top monitor to exclude the area of
   the core bar / mini view") ──
   CORE's bar and minimal bar keep the top of their monitor as an AppBar, so that monitor's work area starts
   below them. There FLOW's full screen is the monitor minus that band: a plain window filling the rest, which
   follows the band when it changes (bar ⇄ minimal bar, folded to its line, given back). A monitor whose top is
   free (the main one: its taskbar is at the bottom) gets Windows' own full screen, as before. */
let fsSoft = false;     // full screen as a window below the band
let fsSwitch = false;   // in Windows' full screen when a band appeared: leaving it turns into fsSoft
let fsTarget = null;    // the display a full screen asked for from outside goes to (the last one used)
const topBand = d => Math.max(0, d.workArea.y - d.bounds.y);
const softRect = d => ({ x: d.bounds.x, y: d.workArea.y, width: d.bounds.width, height: d.bounds.y + d.bounds.height - d.workArea.y });
function enterSoft(d) {
  fsSoft = true;
  if (win.isMaximized()) win.unmaximize();
  win.setAlwaysOnTop(false);
  win.setMaximizable(false);
  win.setMinimumSize(1, 1);
  win.setResizable(true);
  win.setBounds(softRect(d));
  win.setResizable(false);
  win.webContents.send('win:fs', true);
}
function leaveSoft() {
  fsSoft = false;
  win.webContents.send('win:fs', false);
  win.setMaximizable(state.mode === 'standard');
  const r = fsRestore;
  setTimeout(() => afterFs(r), 50);
}
// the band changed under FLOW's full screen: follow it (or, in Windows' own full screen, step below the new band)
function fsFollow() {
  if (!win || win.isDestroyed() || !fsRestore) return;
  const d = screen.getDisplayMatching(win.getBounds());
  if (fsSoft) { const r = softRect(d), b = win.getBounds(); if (r.x !== b.x || r.y !== b.y || r.width !== b.width || r.height !== b.height) { win.setResizable(true); win.setBounds(r); win.setResizable(false); } }
  else if (win.isFullScreen() && topBand(d) && !fsSwitch) { fsSwitch = true; win.setFullScreen(false); }
}

/* ── The icon wears the theme ──
   The taskbar button, the tray and FLOW's own shortcuts are redrawn in the current
   palette (the titlebar mark's four shapes on the theme's background). Each colouring
   is written once to userData/icons under a name made of its colours: a new theme
   is a new path, which is what makes Explorer's icon cache let go of the old one. */
const ICON_DIR = path.join(app.getPath('userData'), 'icons');
const BUILD_ICON = path.join(__dirname, 'build', 'icon.ico');
let shownIcon = null;
let lnkT = null;

function iconFile() {
  if (!state.mark) return BUILD_ICON;
  const file = path.join(ICON_DIR, 'flow-' + [state.bg, ...state.mark].map(c => c.slice(1).toLowerCase()).join('-') + '.ico');
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(ICON_DIR, { recursive: true });
      fs.writeFileSync(file, mark.ico(state.bg, state.mark));
    }
    return file;
  } catch { return BUILD_ICON; }
}
function applyIcon() {
  const file = iconFile();
  if (file === shownIcon) return;
  shownIcon = file;
  if (win && !win.isDestroyed()) win.setIcon(file);
  if (tray) tray.setImage(file);
  queueShortcuts();
}

// Start menu, desktop and taskbar-pin shortcuts whose target is this exe point at the
// current icon. Packaged app on its own profile only: a dev, test or --user-data-dir
// smoke run must never point the user's shortcuts at its throwaway icons.
function shortcutDirs() {
  const ad = app.getPath('appData');
  return [path.join(ad, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), app.getPath('desktop'),
    path.join(ad, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')];
}
function restyleShortcuts(icon, dirs, exe) {
  const want = path.resolve(exe).toLowerCase();
  let n = 0;
  const walk = (dir, depth) => {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth) walk(p, depth - 1); continue; }
      if (!/\.lnk$/i.test(d.name)) continue;
      try {
        const l = shell.readShortcutLink(p);
        if (!l.target || path.resolve(l.target).toLowerCase() !== want || l.icon === icon) continue;
        if (shell.writeShortcutLink(p, 'update', { icon, iconIndex: 0 })) n++;
      } catch {}
    }
  };
  for (const dir of dirs) walk(dir, 1);
  return n;
}
function queueShortcuts() {
  if (!app.isPackaged || process.platform !== 'win32' || !state.mark || app.commandLine.hasSwitch('user-data-dir')) return;
  clearTimeout(lnkT);   // clicking through the palettes rewrites them once, at the end
  lnkT = setTimeout(() => restyleShortcuts(shownIcon, shortcutDirs(), process.execPath), 2000);
}

function showFlow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
// rebuilt when the pill changes: its items say what they will do
let trayKey = '';
function trayMenu() {
  const extra = [...(pill ? pill.trayItems() : []), ...(timers ? timers.trayItems() : [])];
  const key = extra.map(i => i.label + (i.enabled === false ? '-' : '')).join('|');
  if (!tray || key === trayKey) return;
  trayKey = key;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show FLOW', click: showFlow },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => win.webContents.send('media', 'toggle') },
    { label: 'Next track', click: () => win.webContents.send('media', 'next') },
    { label: 'Start / Pause timer', click: () => win.webContents.send('media', 'pom') },
    ...(extra.length ? [{ type: 'separator' }, ...extra] : []),
    { type: 'separator' },
    { label: 'Quit FLOW', click: () => { remember(); app.quit(); } }
  ]));
}
function createTray() {
  tray = new Tray(iconFile());
  tray.setToolTip('FLOW');
  trayMenu();
  tray.on('click', () => {
    if (win.isVisible()) win.focus();
    else win.show();
  });
}

/* ── Other apps' media (Spotify & co.) ──
   smtc.ps1 reads the Windows media sessions and takes play/pause/skip commands on stdin.
   It runs in Windows PowerShell 5.1, which can't read files inside app.asar, so a copy is
   written to userData first. It exits by itself when its stdin closes. */
const SYS_SCRIPT = path.join(app.getPath('userData'), 'smtc.ps1');
const sys = { proc: null, want: false, state: null, art: null, fails: 0, timer: null };

function sysSend(msg) { if (win && !win.isDestroyed()) win.webContents.send('sys:msg', msg); }
function sysStart() {
  if (sys.proc || !sys.want || process.platform !== 'win32') return;
  try {
    const src = fs.readFileSync(path.join(__dirname, 'smtc.ps1'), 'utf8');
    let old = null; try { old = fs.readFileSync(SYS_SCRIPT, 'utf8'); } catch {}
    if (old !== src) fs.writeFileSync(SYS_SCRIPT, src);
  } catch (e) { sysSend({ t: 'err', msg: 'could not prepare the media bridge' }); return; }
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const p = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SYS_SCRIPT],
    { windowsHide: true, env: { ...process.env, FLOW_AUMID: 'com.hugo.flow' } });
  sys.proc = p;
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'state') { sys.state = m; sys.fails = 0; }
      else if (m.t === 'art') sys.art = m;
      else if (m.t === 'warn') { console.warn('[smtc]', m.msg); continue; }
      sysSend(m);
    }
  });
  p.stderr.on('data', d => console.warn('[smtc]', String(d).trim()));
  p.on('error', () => {});
  p.on('exit', code => {
    if (sys.proc === p) sys.proc = null;
    if (code === 2 || !sys.want) return;   // 2: this Windows has no media sessions API
    // crashed: try again a few times, slower each time
    if (++sys.fails > 5) { sysSend({ t: 'err', msg: 'the media bridge keeps stopping' }); return; }
    clearTimeout(sys.timer);
    sys.timer = setTimeout(sysStart, 1500 * sys.fails);
  });
}
function sysStop() {
  clearTimeout(sys.timer);
  const p = sys.proc; sys.proc = null;
  if (!p) return;
  try { p.stdin.end(); } catch {}
  setTimeout(() => { try { if (p.exitCode === null) p.kill(); } catch {} }, 1500);
}
ipcMain.on('sys:enable', (e, on) => {
  sys.want = !!on;
  if (!sys.want) { sysStop(); sys.state = sys.art = null; return; }
  if (sys.proc) { if (sys.state) sysSend(sys.state); if (sys.art) sysSend(sys.art); }   // a reloaded page catches up
  else { sys.fails = 0; sysStart(); }
});
ipcMain.on('sys:cmd', (e, { cmd, arg }) => {
  if (!sys.proc || !/^(toggle|play|pause|next|prev|seek)$/.test(cmd)) return;
  const n = Number(arg);
  try { sys.proc.stdin.write(cmd + (cmd === 'seek' && Number.isFinite(n) ? ' ' + n.toFixed(2) : '') + '\n'); } catch {}
});
app.on('will-quit', () => { sys.want = false; sysStop(); });

/* ── The link (TUTOR, GRIND) ──
   An app with a session clock (TUTOR, GRIND) connects to this pipe when its
   link button is pressed, launching FLOW first if it is not running. One
   JSON object per line; its hello names it. While linked that app is the
   clock: its session is forwarded to the renderer, which mirrors it; FLOW's
   timer buttons come back here as commands. One app at a time — a new one
   takes over and the old one is told bye. The last session is kept so a
   window that loads late still gets it. FLOW_LINK_PIPE moves the pipe (the
   GUI test uses its own). The pill (pill-main.js) hears every hello, session
   and drop: with no app linked, its open session runs the clock through the
   same messages (kind 'open'), and the timer's buttons go to it. */
const LINK_PIPE = process.env.FLOW_LINK_PIPE || '\\\\.\\pipe\\hugo-flow-link';
const link = { server: null, sock: null, last: null, lastAt: 0, app: '', k: null };
const linkName = a => String(a || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase() || 'APP';
function linkToRenderer(m) { if (win && !win.isDestroyed()) win.webContents.send('link:msg', m); }
function linkSend(m) { if (link.sock && !link.sock.destroyed) { try { link.sock.write(JSON.stringify(m) + '\n'); } catch {} } }
/* CORE draws a chain between FLOW and the linked app. It reads this file and
   never the pipe: a second client on the pipe would take the clock from the
   linked app. Written on every link change, cleared at start and on quit. */
const LINK_STATUS = path.join(app.getPath('userData'), 'link.json');
function linkStatus(on) {
  const a = on && link.sock && link.app ? link.app : null;
  try { fs.writeFileSync(LINK_STATUS, JSON.stringify({ linked: a, since: a ? Date.now() : 0, pid: process.pid })); } catch {}
}
function linkDrop(s) {
  if (link.sock !== s) return;
  link.sock = null; link.last = null; link.app = '';
  linkStatus(false);
  // an open session waiting underneath takes the clock back; otherwise FLOW's own timer does
  if (!pill || !pill.linkDropped()) linkToRenderer({ t: 'state', on: false });
}
function linkServe() {
  link.server = net.createServer(s => {
    const took = link.sock ? link.app : '';   // another app had the clock: the pill says "!"
    if (link.sock) {
      const old = link.sock;
      linkSend({ t: 'bye' });
      try { old.end(); } catch {}
      setTimeout(() => { try { old.destroy(); } catch {} }, 1000);   // end() lets the bye through first
    }
    link.sock = s; link.last = null; link.app = '';
    let buf = '';
    s.setEncoding('utf8');
    s.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (link.sock !== s) return;
        if (m.t === 'hello') {
          link.app = linkName(m.app); linkSend({ t: 'hello', app: 'FLOW', v: 1 });
          linkStatus(true);
          if (pill) pill.linkHello(link.app, m, took);
          linkToRenderer({ t: 'state', on: true, app: link.app });
        }
        // an app the pill just started is what was asked for: FLOW's window stays where it is
        else if (m.t === 'show') { if (!(pill && pill.expecting(link.app))) showFlow(); }
        else if (m.t === 'session') { link.last = m; link.lastAt = Date.now(); linkToRenderer(m); if (pill) pill.linkSession(m); }
        else if (m.t === 'bye') { try { s.end(); } catch {} linkDrop(s); }
      }
    });
    s.on('close', () => linkDrop(s));
    s.on('error', () => {});
  });
  link.server.on('error', () => {});   // the pipe is taken (another FLOW build): FLOW runs unlinked
  link.server.listen(LINK_PIPE);
  linkStatus(false);   // a file left by a FLOW that crashed linked says unlinked again
}
ipcMain.on('link:ready', () => {
  if (!link.sock || !link.app) { if (pill) pill.replay(); return; }
  linkToRenderer({ t: 'state', on: true, app: link.app });
  if (link.last) linkToRenderer(link.last);
});
ipcMain.on('link:cmd', (e, cmd) => {
  // no app linked: FLOW's timer is mirroring the open session, which lives in the pill
  if (!(link.sock && link.app) && pill && pill.mirrorCmd(cmd)) return;
  if (/^(toggle|skip|end)$/.test(cmd)) linkSend({ t: 'cmd', cmd });
  else if (cmd === 'unlink' && link.sock) { const s = link.sock; linkSend({ t: 'bye' }); try { s.end(); } catch {} linkDrop(s); }
});
app.on('will-quit', () => {
  if (link.sock) { linkSend({ t: 'bye' }); try { link.sock.end(); } catch {} }
  linkStatus(false);
  if (link.server) try { link.server.close(); } catch {}
});

app.whenReady().then(() => {
  if (!primary) return;
  linkServe();
  // the visualiser's ears for other apps: system audio loopback, no picker. The "video" half
  // of the request is FLOW's own page (no screen capture), and the renderer stops it at once.
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (req.frame) cb({ video: req.frame, audio: 'loopback' }); else cb({});
  });
  createWindow();
  createTray();
  // a band at the top of a monitor came, went or changed (CORE's bar): a full screen below it follows
  screen.on('display-metrics-changed', fsFollow);
  screen.on('display-removed', fsFollow);
  // the timers can dock beside the pill: each hears when the other changes
  pill = createPill({ getWin: () => win, link, linkSend, linkToRenderer, showFlow, getTimers: () => timers,
    onChange: () => { trayMenu(); if (timers) timers.pillChanged(); } });
  timers = createTimers({ getWin: () => win, showFlow, getPill: () => pill, onChange: trayMenu });
  // started by another app for a timer (--flow-timer=…): it is added once the timers are up
  setTimeout(() => timers.fromArgs(process.argv), 300);
  // started by CORE's FLOW box for a session (--flow-session=…, 1.5.0)
  setTimeout(() => pill.fromArgs(process.argv), 300);
  // started by CORE's view menu (--flow-view=…): that view once the page is up
  if (viewArg(process.argv)) win.webContents.once('did-finish-load', () => setTimeout(() => viewFromArgs(process.argv), 300));
  trayMenu();
  shownIcon = iconFile();
  queueShortcuts();   // catches a shortcut or pin made since the theme last changed
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', remember);

ipcMain.on('win:initial', e => { e.returnValue = { mode: state.mode, onTop: !!state.onTop }; });
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:max', () => {
  if (busy() || inMini || state.mode !== 'standard') return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
// close button hides to tray — music keeps playing; quit via the tray menu
ipcMain.on('win:close', () => { if (win) { remember(); win.hide(); } });

ipcMain.on('win:mode', (e, { mode }) => setMode(mode));
ipcMain.on('win:mini', (e, { mini, width, height }) => setMini(mini, width, height));
ipcMain.on('win:dock', (e, h) => { dock.want = Math.max(0, Math.min(1200, Math.round(+h || 0))); applyDock(); });
ipcMain.on('win:ontop', (e, { on }) => {
  state.onTop = !!on; saveState();
  if (!busy() && !inMini) win.setAlwaysOnTop(state.mode === 'minimal' && state.onTop, 'floating');
});
ipcMain.on('win:theme', (e, { bg, mark: k }) => {
  if (!isHex(bg)) return;
  const m = Array.isArray(k) && k.length === 4 && k.every(isHex) ? k : state.mark;
  if (bg === state.bg && String(m) === String(state.mark)) return;
  state.bg = bg; state.mark = m; saveState();
  if (win) win.setBackgroundColor(bg);
  applyIcon();
});

ipcMain.on('win:progress', (e, { v, mode }) => {
  if (!win) return;
  if (v < 0) win.setProgressBar(-1);
  else win.setProgressBar(Math.min(1, Math.max(0, v)), { mode: mode || 'normal' });
});

ipcMain.on('tray:tip', (e, text) => {
  if (tray) tray.setToolTip(String(text || 'FLOW').slice(0, 127));
});

ipcMain.on('win:fullscreen', (e, { on }) => {
  if (!win) return;
  if (on) {
    if (win.isFullScreen() || fsRestore) return;
    // its monitor: the one CORE's view menu asked for (the last full screen), else the one it is on
    const d = fsTarget || screen.getDisplayMatching(win.getBounds());
    fsTarget = null;
    fsRestore = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    state.fsAt = { x: d.bounds.x + Math.round(d.bounds.width / 2), y: d.bounds.y + Math.round(d.bounds.height / 2) };
    saveState();
    if (topBand(d)) { enterSoft(d); return; }
    if (screen.getDisplayMatching(win.getBounds()).id !== d.id) {
      // to that monitor first: Windows makes a window full screen on the monitor it is on
      if (win.isMaximized()) win.unmaximize();
      const b = win.getBounds();
      win.setBounds(fitIn({ ...b, x: d.workArea.x + Math.round((d.workArea.width - b.width) / 2), y: d.workArea.y + Math.round((d.workArea.height - b.height) / 2) }, d.workArea));
    }
    win.setAlwaysOnTop(false);
    win.setResizable(true);
    win.setFullScreenable(true);
    win.setFullScreen(true);
  } else if (fsSoft) {
    leaveSoft();
  } else if (win.isFullScreen()) {
    win.setFullScreen(false); // 'leave-full-screen' handler restores and re-locks the window
  }
});

/* ── A view asked for from outside (Hugo, 2026-10-22: "if i right click on flow i can select view modes for
   the app (and each one opens at the last position)") ──
   CORE's launcher starts FLOW.exe --flow-view=<standard|minimal|mini|fullscreen|pill>: FLOW is single-instance,
   so a running FLOW hears it as a second instance. The window opens in that view where the view was last
   (win-state.json keeps each view's place; full screen goes to the last monitor it was used on); "pill"
   shows the pill, or hides it when it is up. The page switches the view itself (win:view), as its own
   buttons do. */
const FLOW_VIEWS = ['standard', 'minimal', 'mini', 'fullscreen', 'pill'];
function viewArg(argv) {
  const a = (argv || []).map(String).find(x => x.toLowerCase().startsWith('--flow-view='));
  const v = a ? a.slice(a.indexOf('=') + 1).replace(/^"|"$/g, '').toLowerCase() : null;
  return FLOW_VIEWS.includes(v) ? v : null;
}
function viewFromArgs(argv) {
  const v = viewArg(argv);
  if (!v || !win || win.isDestroyed()) return !!v;
  if (v === 'pill') { if (pill) pill.set('on', !pill.isOn()); return true; }
  if (v === 'fullscreen' && state.fsAt) fsTarget = screen.getDisplayNearestPoint(state.fsAt);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  const send = () => { if (win && !win.isDestroyed()) win.webContents.send('win:view', v); };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 150)); else send();
  return true;
}

module.exports = { restyleShortcuts, get pill() { return pill; }, get timers() { return timers; }, dock,   // for test/visual.cjs
  homeOf, fitIn, boundsFor, viewArg, viewFromArgs, softRect, topBand, get fsSoft() { return fsSoft; }, get state() { return state; } };
