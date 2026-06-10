const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowAPI', {
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  setMini: (mini, width, height) => ipcRenderer.send('win:mini', { mini, width, height }),
  setFullscreen: (on) => ipcRenderer.send('win:fullscreen', { on }),
  onFullscreen: (cb) => ipcRenderer.on('win:fs', (_e, on) => cb(on)),
  setProgress: (v, mode) => ipcRenderer.send('win:progress', { v, mode }),
  setTray: (text) => ipcRenderer.send('tray:tip', text),
  onMedia: (cb) => ipcRenderer.on('media', (_e, act) => cb(act))
});
