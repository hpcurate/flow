const { contextBridge, ipcRenderer } = require('electron');

// the view to open in (standard / minimal), read once before the page renders
const initial = ipcRenderer.sendSync('win:initial') || {};

contextBridge.exposeInMainWorld('flowAPI', {
  initialMode: initial.mode || 'standard',
  initialOnTop: !!initial.onTop,
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMax: () => ipcRenderer.send('win:max'),
  onMaxed: (cb) => ipcRenderer.on('win:maxed', (_e, on) => cb(on)),
  close: () => ipcRenderer.send('win:close'),
  setMode: (mode) => ipcRenderer.send('win:mode', { mode }),
  setOnTop: (on) => ipcRenderer.send('win:ontop', { on }),
  // mark: the titlebar mark's four colours, which the taskbar/tray icon is redrawn in
  setTheme: (bg, mark) => ipcRenderer.send('win:theme', { bg, mark }),
  setMini: (mini, width, height) => ipcRenderer.send('win:mini', { mini, width, height }),
  setFullscreen: (on) => ipcRenderer.send('win:fullscreen', { on }),
  onFullscreen: (cb) => ipcRenderer.on('win:fs', (_e, on) => cb(on)),
  setProgress: (v, mode) => ipcRenderer.send('win:progress', { v, mode }),
  setTray: (text) => ipcRenderer.send('tray:tip', text),
  onMedia: (cb) => ipcRenderer.on('media', (_e, act) => cb(act)),
  // other apps' media (Spotify & co.) through the Windows media sessions
  sysMedia: (on) => ipcRenderer.send('sys:enable', !!on),
  sysCmd: (cmd, arg) => ipcRenderer.send('sys:cmd', { cmd, arg }),
  onSys: (cb) => ipcRenderer.on('sys:msg', (_e, msg) => cb(msg))
});
