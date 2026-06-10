const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const FULL = { width: 440, height: 800 };
let win;
let prevBounds = null;
let preFsBounds = null;

function createWindow() {
  win = new BrowserWindow({
    width: FULL.width,
    height: FULL.height,
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:close', () => win && win.close());

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
