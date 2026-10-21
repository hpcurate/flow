/* FLOW's CPU, state by state — npm run perf (2026-10-21, Hugo: "up to 8% for flow").
   A temp profile and a private link pipe (a running FLOW, TUTOR or GRIND is never
   touched); the media bridge reads the real Windows sessions but its commands are
   recorded, never sent. Each state settles, then Electron's own counters
   (cumulative CPU seconds per process) plus FLOW's PowerShell helpers (the media
   bridge, the pill's) are read over a span: % of the whole CPU, Task Manager's
   figure. PERF_SPAN / PERF_SETTLE (s), PERF_STATES=a,b to pick, PERF_FOCUS=use (as if focused; default:
   at rest), PERF_LIST=1 lists what still moves, PERF_CSS / PERF_JS for experiments. */
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-perf-'));
app.setPath('userData', profile);
process.env.FLOW_LINK_PIPE = '\\\\.\\pipe\\flow-perf-' + process.pid;
const M = require('../main.js');
ipcMain.removeAllListeners('sys:cmd');
ipcMain.on('sys:cmd', () => {});
const pause = ms => new Promise(r => setTimeout(r, ms));
const SPAN = Number(process.env.PERF_SPAN) || 12, SETTLE = Number(process.env.PERF_SETTLE) || 6;
const CORES = os.cpus().length;

// FLOW's own PowerShell children: pid → CPU ms (one PowerShell call, which leaves itself out)
function helpers() {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid} AND Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object { try { '{0} {1}' -f $_.ProcessId, [math]::Round((Get-Process -Id $_.ProcessId -ErrorAction Stop).TotalProcessorTime.TotalMilliseconds) } catch {} }`],
      { encoding: 'utf8', windowsHide: true });
    return new Map(out.trim().split(/\r?\n/).filter(Boolean).map(l => l.split(' ').map(Number)));
  } catch { return new Map(); }
}
function sample() {
  const m = new Map();
  for (const p of app.getAppMetrics()) m.set(p.pid, { type: p.type, s: p.cpu.cumulativeCPUUsage || 0 });
  return m;
}
async function measure(label) {
  const h0 = helpers(), a = sample(), t0 = Date.now();
  await pause(SPAN * 1000);
  const b = sample(), sec = (Date.now() - t0) / 1000, h1 = helpers(), by = {};
  for (const [pid, x] of b) { const was = a.get(pid); if (was) by[x.type] = (by[x.type] || 0) + (x.s - was.s); }
  let ps = 0; for (const [pid, ms] of h1) if (h0.has(pid)) ps += (ms - h0.get(pid)) / 1000;
  by.helpers = ps;
  const pct = s => +(100 * s / sec / CORES).toFixed(2);
  const total = Object.values(by).reduce((x, y) => x + y, 0);
  const row = { state: label, total: pct(total), ...Object.fromEntries(Object.entries(by).map(([k, v]) => [k, pct(v)])) };
  console.log(JSON.stringify(row));
  return row;
}

app.whenReady().then(async () => {
  try {
    await pause(3000);
    const win = BrowserWindow.getAllWindows().find(w => /index\.html/.test(w.webContents.getURL()));
    const J = code => win.webContents.executeJavaScript(code, true);
    // FLOW's own music, never heard: a generated 150 s loop played with the bus cut off from the speakers
    // (the analyser still hears it, so every visual moves as with real music). Other apps' media off,
    // so whatever Hugo is playing doesn't change the figures.
    const music = async () => {
      await J(`(async () => {
        const rate = 22050, secs = 150, n = rate * secs, buf = new ArrayBuffer(44 + n * 2), d = new DataView(buf);
        const str = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
        str(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
        d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) {
          const t = i / rate, b = t % .5;
          const kick = Math.sin(2 * Math.PI * (45 * b + 75 / 12 * (1 - Math.exp(-12 * b)))) * Math.exp(-b * 9);
          const pad = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 329.6 * t)) * .15 * (.6 + .4 * Math.sin(t * 1.3));
          d.setInt16(44 + i * 2, Math.max(-1, Math.min(1, (kick * .8 + pad) * .5)) * 32767, true);
        }
        ensureGraph(); bus.disconnect(actx.destination);
        await addFiles([new File([buf], 'Perf loop.wav', { type: 'audio/wav' })]); play(0); return 1;
      })()`);
    };
    const STATES = {
      'standard, idle, no music': async () => { await J("setSetting('sysMedia',false);setMode('standard');0"); },
      'standard, music + focus': async () => { await music(); await J('pomStart();0'); },
      'minimal, music': async () => { await J("setMode('minimal');0"); },
      'full screen, music': async () => { await J("setMode('standard');enterZen();0"); },
      'mini bar, music': async () => { await J('exitZen();enterMini();0'); },
      'hidden, music': async () => { await J('exitMini();0'); await pause(500); win.hide(); },
      'hidden + pill, music': async () => { M.pill.set('on', true); },
    };
    // in use or at rest (app.js loopFps): pinned, so where the real focus is (Hugo at work) doesn't matter.
    // PERF_FOCUS=use: as if FLOW had the focus; the default, rest: FLOW in the background
    const inUse = process.env.PERF_FOCUS === 'use';
    await J(`document.hasFocus = () => ${inUse}; 0`);
    const pick = (process.env.PERF_STATES || '').split(',').filter(Boolean);
    console.log(`FLOW perf — ${inUse ? 'in use' : 'at rest'}, ${SPAN} s per state, % of all ${CORES} logical cores (Task Manager's figure)`);
    for (const [name, go] of Object.entries(STATES)) {
      await go();
      if (pick.length && !pick.some(p => name.startsWith(p))) continue;
      // experiments: PERF_CSS goes into every window, PERF_JS runs in FLOW's (e.g. frame=function(){} stops the draw loop)
      if (process.env.PERF_CSS) for (const w of BrowserWindow.getAllWindows()) await w.webContents.insertCSS(process.env.PERF_CSS).catch(() => {});
      if (process.env.PERF_JS) await J(process.env.PERF_JS + ';0');
      await pause(SETTLE * 1000);
      // PERF_LIST=1: what still moves in each window (CSS animations and transitions, by element and name)
      if (process.env.PERF_LIST) for (const w of BrowserWindow.getAllWindows()) {
        const a = await w.webContents.executeJavaScript(`document.getAnimations().filter(a => a.playState === 'running').map(a => {
          const t = a.effect && a.effect.target, c = t ? (t.id ? '#' + t.id : '') + '.' + String(t.className && t.className.baseVal != null ? t.className.baseVal : t.className).split(' ')[0] : '?';
          return c + '|' + (a.animationName || a.transitionProperty || '');
        })`, true).catch(() => []);
        if (a.length) console.log('  moving in ' + w.webContents.getURL().split('/').pop().split('?')[0] + (w.isVisible() ? '' : ' (hidden)') + ': ' + JSON.stringify([...new Set(a)].slice(0, 14)) + ' (' + a.length + ')');
      }
      const loop = await J('({ fps: looping ? loopFps() : 0, focused: document.hasFocus() })').catch(() => ({}));
      console.log('  draw loop: ' + JSON.stringify(loop));
      await measure(name);
    }
  } catch (e) { console.error(e); process.exitCode = 1; }
  app.exit(process.exitCode || 0);
});
