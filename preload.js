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
  // a view asked for from outside (CORE's view menu: FLOW.exe --flow-view=…): standard / minimal / mini / fullscreen
  onView: (cb) => ipcRenderer.on('win:view', (_e, v) => cb(v)),
  setProgress: (v, mode) => ipcRenderer.send('win:progress', { v, mode }),
  setTray: (text) => ipcRenderer.send('tray:tip', text),
  onMedia: (cb) => ipcRenderer.on('media', (_e, act) => cb(act)),
  // other apps' media (Spotify & co.) through the Windows media sessions
  sysMedia: (on) => ipcRenderer.send('sys:enable', !!on),
  sysCmd: (cmd, arg) => ipcRenderer.send('sys:cmd', { cmd, arg }),
  onSys: (cb) => ipcRenderer.on('sys:msg', (_e, msg) => cb(msg)),
  // the link (TUTOR, GRIND): the app's session in, FLOW's timer buttons out (toggle / skip / end)
  onLink: (cb) => { ipcRenderer.on('link:msg', (_e, msg) => cb(msg)); ipcRenderer.send('link:ready'); },
  linkCmd: (cmd) => ipcRenderer.send('link:cmd', cmd),
  // whether the window is on screen (the page stops drawing while it is hidden to the tray)
  onVis: (cb) => ipcRenderer.on('win:vis', (_e, on) => cb(on)),
  // the pill (pill-main.js): its settings in; FLOW's music, own timer, theme and music bars out
  onPill: (cb) => ipcRenderer.on('pill:msg', (_e, m) => cb(m)),
  pillSet: (k, v) => ipcRenderer.send('pill:set', { k, v }),
  pillCmd: (cmd, arg) => ipcRenderer.send('pill:cmd', { ...(arg || {}), cmd }),
  pillExt: (kind, v) => ipcRenderer.send('pill:ext', { kind, v }),
  pillViz: (v) => ipcRenderer.send('pill:viz', v),
  // the timers (timers-main.js): the list in, the buttons out; dock: how tall they are docked under the minimal view
  onTimers: (cb) => { ipcRenderer.on('timers:msg', (_e, m) => cb(m)); ipcRenderer.send('timers:cmd', { cmd: 'ready' }); },
  timersCmd: (m) => ipcRenderer.send('timers:cmd', m),
  setDock: (h) => ipcRenderer.send('win:dock', h)
});
