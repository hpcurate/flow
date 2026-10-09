const { app, BrowserWindow, Tray, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

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
let state = { mode: 'standard', bounds: {}, onTop: false, maximized: false, bg: '#060607' };

// needed for Windows toast notifications from the renderer
app.setAppUserModelId('com.hugo.flow');

// one FLOW at a time — launching it again (e.g. while it sits in the tray) shows the running one
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
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
}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {}
}

function onScreen(b) {
  return screen.getAllDisplays().some(({ workArea: r }) =>
    b.x >= r.x - 10 && b.y >= r.y - 10 && b.x + b.width <= r.x + r.width + 10 && b.y + b.height <= r.y + r.height + 10);
}
// saved bounds for a view if they still fit a screen; otherwise keep the current
// top-right corner (where the view buttons are), or centre on first launch
function boundsFor(mode, anchor) {
  const def = MODES[mode], saved = state.bounds[mode] || {};
  const area = (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea;
  const width = Math.min(Math.max(saved.width || def.width, def.minWidth), area.width);
  const height = Math.min(Math.max(saved.height || def.height, def.minHeight), area.height);
  const b = { x: saved.x, y: saved.y, width, height };
  if (Number.isFinite(b.x) && Number.isFinite(b.y) && onScreen(b)) return b;
  b.x = anchor ? anchor.x + anchor.width - width : area.x + Math.round((area.width - width) / 2);
  b.y = anchor ? anchor.y : area.y + Math.round((area.height - height) / 2);
  b.x = Math.min(Math.max(b.x, area.x), area.x + area.width - width);
  b.y = Math.min(Math.max(b.y, area.y), area.y + area.height - height);
  return b;
}
function minFor(mode, b) {
  const def = MODES[mode], area = screen.getDisplayMatching(b).workArea;
  return [Math.min(def.minWidth, area.width), Math.min(def.minHeight, area.height)];
}
function busy() { return !win || win.isDestroyed() || win.isFullScreen() || fsRestore; }

function remember() {
  if (busy()) return;
  if (inMini) { const b = win.getBounds(); state.bounds.mini = { x: b.x, y: b.y }; }
  else {
    state.bounds[state.mode] = win.getNormalBounds();
    if (state.mode === 'standard') state.maximized = win.isMaximized();
  }
  saveState();
}

function applyMode(mode) {
  const anchor = win.getBounds();
  if (win.isMaximized()) win.unmaximize();
  state.mode = mode;
  const b = boundsFor(mode, anchor);
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
    inMini = true;
    const saved = state.bounds.mini, at = win.getBounds();
    b = { x: at.x + at.width - width, y: at.y, width, height };
    if (saved && onScreen({ x: saved.x, y: saved.y, width, height })) b = { x: saved.x, y: saved.y, width, height };
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
      nodeIntegration: false
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

  win.on('enter-full-screen', () => win.webContents.send('win:fs', true));
  win.on('leave-full-screen', () => {
    win.setFullScreenable(false);
    win.webContents.send('win:fs', false);
    // Windows finishes the fullscreen transition AFTER this event and stomps any
    // bounds set synchronously here — restore on the next tick instead
    const r = fsRestore;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      if (r) { win.setBounds(r.bounds); if (r.maximized) win.maximize(); }
      win.setResizable(!inMini);
      win.setAlwaysOnTop(inMini || (state.mode === 'minimal' && state.onTop), 'floating');
      fsRestore = null;
      const p = pending; pending = null;
      if (p) p();
    }, 50);
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
  tray.setToolTip('FLOW');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show FLOW', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => win.webContents.send('media', 'toggle') },
    { label: 'Next track', click: () => win.webContents.send('media', 'next') },
    { label: 'Start / Pause timer', click: () => win.webContents.send('media', 'pom') },
    { type: 'separator' },
    { label: 'Quit FLOW', click: () => { remember(); app.quit(); } }
  ]));
  tray.on('click', () => {
    if (win.isVisible()) win.focus();
    else win.show();
  });
}

app.whenReady().then(() => {
  if (!primary) return;
  createWindow();
  createTray();
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
ipcMain.on('win:ontop', (e, { on }) => {
  state.onTop = !!on; saveState();
  if (!busy() && !inMini) win.setAlwaysOnTop(state.mode === 'minimal' && state.onTop, 'floating');
});
ipcMain.on('win:theme', (e, { bg }) => {
  if (!/^#[0-9a-f]{6}$/i.test(bg) || bg === state.bg) return;
  state.bg = bg; saveState();
  if (win) win.setBackgroundColor(bg);
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
    fsRestore = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
    win.setAlwaysOnTop(false);
    win.setResizable(true);
    win.setFullScreenable(true);
    win.setFullScreen(true);
  } else if (win.isFullScreen()) {
    win.setFullScreen(false); // 'leave-full-screen' handler restores and re-locks the window
  }
});
