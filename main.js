const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const FULL = { width: 440, height: 800 };
const POS_FILE = path.join(app.getPath('userData'), 'win-pos.json');
let win;
let tray = null;
let prevBounds = null;
let preFsBounds = null;
let saveT = null;

// needed for Windows toast notifications from the renderer
app.setAppUserModelId('com.hugo.flow');

function loadPos() {
  try {
    const p = JSON.parse(fs.readFileSync(POS_FILE, 'utf8'));
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch {}
  return null;
}
function savePos() {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  const b = win.getBounds();
  try { fs.writeFileSync(POS_FILE, JSON.stringify({ x: b.x, y: b.y })); } catch {}
}

function createWindow() {
  const pos = loadPos();
  win = new BrowserWindow({
    width: FULL.width,
    height: FULL.height,
    ...(pos || {}),
    backgroundColor: '#0e0e0e',
    title: 'FLOW',
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');

  win.on('moved', () => { clearTimeout(saveT); saveT = setTimeout(savePos, 500); });

  win.on('enter-full-screen', () => win.webContents.send('win:fs', true));
  win.on('leave-full-screen', () => {
    win.setFullScreenable(false);
    win.webContents.send('win:fs', false);
    // Windows finishes the fullscreen transition AFTER this event and stomps any
    // bounds set synchronously here — restore on the next tick instead
    const b = preFsBounds || { width: FULL.width, height: FULL.height };
    preFsBounds = null;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.setBounds(b);
      win.setResizable(false);
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
    { type: 'separator' },
    { label: 'Quit FLOW', click: () => { savePos(); app.quit(); } }
  ]));
  tray.on('click', () => {
    if (win.isVisible()) win.focus();
    else win.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', savePos);

ipcMain.on('win:minimize', () => win && win.minimize());
// close button hides to tray — music keeps playing; quit via the tray menu
ipcMain.on('win:close', () => { if (win) { savePos(); win.hide(); } });

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
    preFsBounds = win.getBounds();
    win.setResizable(true);
    win.setFullScreenable(true);
    win.setFullScreen(true);
  } else if (win.isFullScreen()) {
    win.setFullScreen(false); // 'leave-full-screen' handler re-locks the window
  }
});

ipcMain.on('win:mini', (e, { mini, width, height }) => {
  if (!win) return;
  win.setResizable(true);
  if (mini) {
    if (!prevBounds) prevBounds = win.getBounds();
    win.setSize(width, height, false);
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    win.setSize(
      prevBounds ? prevBounds.width : FULL.width,
      prevBounds ? prevBounds.height : FULL.height,
      false
    );
    prevBounds = null;
  }
  win.setResizable(false);
});
