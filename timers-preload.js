const { contextBridge, ipcRenderer } = require('electron');

// the pop-out (timers.html) and the overlay (ring.html): the timers come in, the buttons and the window's business go out
const IN = /^timers:(state|ring|focus|ding)$/;
contextBridge.exposeInMainWorld('timersAPI', {
  cmd: (m) => ipcRenderer.send('timers:cmd', m),
  ui: (m) => ipcRenderer.send('timers:ui', m),
  on: (ch, cb) => { if (IN.test(ch)) ipcRenderer.on(ch, (_e, m) => cb(m)); }
});
