const { app, BrowserWindow, Tray, Menu, ipcMain, screen, session, shell, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const Art = require('./art.js');   // 1.7.0: the source's colour, for the stylised artwork
const net = require('net');
const mark = require('./mark');

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
  // a timer, a focus session or the pill (--flow-timer=…, --flow-session=…, --flow-view=pill): CORE's since 1.6.0 —
  // passed on, FLOW's window stays where it is
  if (coreArgs(argv)) return;
  // TUTOR or GRIND linking found no clock: CORE is started (it serves their pipe now)
  linkWanted(argv);
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
// the pill's and the timers' items are in CORE's tray since 1.6.0 (they live there)
function trayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show FLOW', click: showFlow },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => win.webContents.send('media', 'toggle') },
    { label: 'Next track', click: () => win.webContents.send('media', 'next') },
    { label: 'Start / Pause timer', click: () => win.webContents.send('media', 'pom') },
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
      if (m.t === 'state') { sys.state = m; sys.fails = 0; srcLook(m); }
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
/* ── where the sound comes from (1.7.0, Hugo's r261028-ylsm: "change the artwork to the dominant colour of the favicon where
   the sound is playing from (or the app if it's not a website)"). A browser: the site its playing tab is on, from the window
   titles (the one with the track's title in it; art.js knows the sites' colours); another app: its colour (art.js), else its
   icon's main colour (its exe, found by its process). Sent as { t: 'src', key, app, site, colour } once per track; nothing is
   fetched, and a window's title is only read, never kept. ── */
const src = { last: '', icons: new Map(), timer: null };
function srcLook(m, again) {
  if (!m || m.none || !m.app) { src.last = ''; return; }
  const k = m.key || (m.app + '|' + (m.title || ''));
  if (k === src.last && !again) return;
  src.last = k; clearTimeout(src.timer);
  (async () => {
    let site = null;
    if (Art.isBrowser(m.app)) {
      try {
        const wins = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
        site = Art.siteOf(wins.map(w => w.name), m.title);
      } catch {}
      // the tab's title can come a moment after the media session's: once more, 3 s later
      if (!site && !again) src.timer = setTimeout(() => { if (src.last === k) srcLook(m, true); }, 3000);
    }
    const colour = (site && site.colour) || Art.appColour(m.app) || await iconColour(m.app);
    if (src.last === k) sysSend({ t: 'src', key: k, app: m.app, site: site ? site.site : null, colour: colour || null });
  })();
}
async function iconColour(aumid) {
  if (src.icons.has(aumid)) return src.icons.get(aumid);
  let c = null;
  try {
    const s = String(aumid), name = s.split(/[\\/!]/).pop().replace(/\.exe$/i, '');
    const exe = /^[a-z]:\\.+\.exe$/i.test(s) ? s : /^[\w .-]{1,60}$/.test(name) ? await procPath(name) : null;
    if (exe) { const img = await app.getFileIcon(exe, { size: 'normal' }); c = Art.dominant(img.toBitmap(), true); }
  } catch {}
  src.icons.set(aumid, c);
  return c;
}
function procPath(name) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const cmd = `(Get-Process -Name '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1).Path`;
  return new Promise(res => execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 6000 },
    (err, out) => res(!err && String(out || '').trim() ? String(out).trim().split(/\r?\n/)[0] : null)));
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

/* ── CORE: the clock (1.6.0) ──
   Since CORE 0.18.0 (Hugo's r261026-ojsf "can you merge flow and core? or at least the timers / pill should be a part of
   core, flow is just a fancy visualizer", answered "b") the pill, the timers and the TUTOR / GRIND link live in CORE,
   which is always on; FLOW is the player and the visualiser. This connects to CORE's pipe for FLOW and relays, both ways,
   what the page and its pill / timers / link said to each other over IPC when they lived here — so the page is the same:
     the page → CORE   pill:ext (its music, its own pomodoro, its theme, its intention), pill:viz (the four bars),
                       pill:set / pill:cmd (its drawer), timers:cmd (its timers dock and drawer), link:ready, link:cmd
     CORE → the page   link:msg (a linked app's or the open session's clock: its timer mirrors it), pill:msg, timers:msg,
                       media (the pill's music button and FLOW's own pomodoro)
   With CORE away, FLOW's own timer (the pomodoro) runs as it always did; the page hears core:state and its pill and timer
   switches say where they went. Every 3 s it looks again. FLOW_CORE_PIPE moves the pipe (the GUI test hosts the clock
   itself on its own pipe). */
const CORE_PIPE = process.env.FLOW_CORE_PIPE || '\\\\.\\pipe\\hugo-core-flow';
const CORE_EXE = process.env.FLOW_CORE_EXE || path.join(app.getPath('documents'), 'github', 'core', 'dist', 'CORE-win32-x64', 'CORE.exe');
const core = { sock: null, up: false, timer: null, ext: {}, tmTheme: null, tmLast: null, args: [], launched: 0, quitting: false };
function toPage(ch, m) { if (win && !win.isDestroyed()) win.webContents.send(ch, m); }
function linkToRenderer(m) { toPage('link:msg', m); }
function coreSend(m) { if (core.up && core.sock && !core.sock.destroyed) { try { core.sock.write(JSON.stringify(m) + '\n'); } catch {} return true; } return false; }
function coreConnect() {
  if (core.sock || core.quitting) return;
  const s = net.connect(CORE_PIPE);
  core.sock = s;
  let buf = '';
  s.setEncoding('utf8');
  s.once('connect', () => { try { s.write(JSON.stringify({ t: 'hello', app: 'FLOW', v: 1 }) + '\n'); } catch {} });
  s.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (core.sock === s) coreIn(m);
    }
  });
  s.on('error', () => {});
  s.on('close', () => {
    if (core.sock !== s) return;
    core.sock = null;
    const was = core.up; core.up = false;
    if (was) coreGone();
    clearTimeout(core.timer);
    if (!core.quitting) core.timer = setTimeout(coreConnect, 3000);
  });
}
function coreIn(m) {
  if (m.t === 'hello') { core.up = true; coreCame(); return; }
  if (!core.up) return;
  if (m.t === 'link') linkToRenderer(m.m);
  else if (m.t === 'pill') toPage('pill:msg', m.m);
  else if (m.t === 'timers') { if (m.m && m.m.t === 'state') core.tmLast = m.m; toPage('timers:msg', m.m); }
  else if (m.t === 'media') toPage('media', m.act);
  else if (m.t === 'show') showFlow();
}
// CORE came (FLOW started, or CORE did): it hears what the page last said, the page what CORE keeps
function coreCame() {
  for (const [kind, v] of Object.entries(core.ext)) coreSend({ t: 'ext', kind, v });
  if (core.tmTheme) coreSend({ t: 'timers:cmd', m: { cmd: 'theme', v: core.tmTheme } });
  coreSend({ t: 'link:ready' });
  coreSend({ t: 'timers:cmd', m: { cmd: 'ready' } });
  const a = core.args; core.args = [];
  for (const argv of a) coreSend({ t: 'args', argv });
  toPage('core:state', true);
}
// CORE went: FLOW's own timer again, no pill to speak to, the timers out of its window (they stopped with CORE)
function coreGone() {
  linkToRenderer({ t: 'state', on: false });
  toPage('pill:msg', { t: 'cfg', cfg: null, today: null, open: null, shown: false, want: { viz: false } });
  if (core.tmLast) toPage('timers:msg', { ...core.tmLast, list: [], cfg: { ...core.tmLast.cfg, on: false }, popped: false, docked: false });
  toPage('core:state', false);
}
// the page's side, relayed (what it says to CORE while CORE is away is kept where it matters: its state, for coreCame).
// FLOW's own window only: when a test hosts CORE's clock in this process, the clock's pages speak on the same channels
const mine = e => !!(win && !win.isDestroyed() && e.sender === win.webContents);
ipcMain.on('pill:ext', (e, { kind, v } = {}) => { if (mine(e) && kind) { core.ext[kind] = v; coreSend({ t: 'ext', kind, v }); } });
ipcMain.on('pill:viz', (e, v) => { if (mine(e)) coreSend({ t: 'viz', v }); });
ipcMain.on('pill:set', (e, { k, v } = {}) => { if (mine(e)) coreSend({ t: 'pill:set', k, v }); });
ipcMain.on('pill:cmd', (e, m = {}) => { if (mine(e)) coreSend({ t: 'pill:cmd', m }); });
ipcMain.on('timers:cmd', (e, m) => {
  if (!mine(e)) return;
  if (m && m.cmd === 'theme') core.tmTheme = m.v;
  coreSend({ t: 'timers:cmd', m });
});
ipcMain.on('link:ready', e => {
  if (!mine(e)) return;
  if (!coreSend({ t: 'link:ready' })) toPage('core:state', false);
  else toPage('core:state', true);
});
ipcMain.on('link:cmd', (e, cmd) => { if (mine(e)) coreSend({ t: 'link:cmd', cmd }); });
// FLOW.exe's old arguments (--flow-timer=…, --flow-session=…, --flow-view=pill): CORE's, passed on (kept until it comes)
function coreArgs(argv) {
  const a = (argv || []).map(String);
  if (!a.some(x => /^--flow-(timer|session)=/i.test(x) || x.toLowerCase() === '--flow-view=pill')) return false;
  if (!coreSend({ t: 'args', argv: a })) { core.args.push(a); startCore(); }
  return true;
}
// TUTOR or GRIND started FLOW to link (--tutor-link, --grind-link: their pipe wasn't there): the pipe is CORE's now
function linkWanted(argv) {
  if ((argv || []).some(x => /^--(tutor|grind)-link$/i.test(String(x)))) startCore();
}
function startCore() {
  if (core.up || Date.now() - core.launched < 30000 || !fs.existsSync(CORE_EXE)) return false;
  core.launched = Date.now();
  try { spawn(CORE_EXE, [], { detached: true, stdio: 'ignore', cwd: app.getPath('home') }).unref(); } catch { return false; }
  return true;
}
app.on('will-quit', () => {
  core.quitting = true; clearTimeout(core.timer);
  if (core.sock) try { core.sock.end(); } catch {}
});

app.whenReady().then(() => {
  if (!primary) return;
  coreConnect();   // 1.6.0: the clock is CORE's (the pill, the timers, the TUTOR / GRIND link)
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
  // started with a timer or a session for CORE (--flow-timer=…, --flow-session=…): passed on once CORE is there
  coreArgs(process.argv);
  // started by TUTOR or GRIND to link: CORE serves their pipe now
  linkWanted(process.argv);
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
  if (v === 'pill') return true;   // the pill is CORE's (1.6.0): coreArgs passed it on
  if (v === 'fullscreen' && state.fsAt) fsTarget = screen.getDisplayNearestPoint(state.fsAt);
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  const send = () => { if (win && !win.isDestroyed()) win.webContents.send('win:view', v); };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 150)); else send();
  return true;
}

module.exports = { restyleShortcuts, core, coreArgs, coreConnect, dock,   // for test/visual.cjs
  homeOf, fitIn, boundsFor, viewArg, viewFromArgs, softRect, topBand, get fsSoft() { return fsSoft; }, get state() { return state; } };
