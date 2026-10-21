const { contextBridge, ipcRenderer } = require('electron');

// the pill page: what it shows comes in (state, layout, music bars, moments, the timers docked beside it),
// what it is asked goes out; the docked timers' buttons go straight to the timers (timers-main.js)
const IN = /^pill:(state|layout|viz|fx|drag|ctrl|timers|hint|focus|panel)$/;
contextBridge.exposeInMainWorld('pillAPI', {
  ui: (m) => ipcRenderer.send('pill:ui', m),
  tcmd: (m) => ipcRenderer.send('timers:cmd', m),
  on: (ch, cb) => { if (IN.test(ch)) ipcRenderer.on(ch, (_e, m) => cb(m)); }
});
