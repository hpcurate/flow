/* FLOW · the pill (main process) — a small always-on-top session bar.
   It shows whatever runs FLOW's clock — a linked app (TUTOR, GRIND), an open
   session (FLOW's own goal-and-breaks session, named or not) or FLOW's
   pomodoro — with the music as four bars. It is a toggle that runs alongside
   the other views: closing FLOW's window leaves it up. It snaps to the
   taskbar; pill.ps1 keeps it above the taskbar (closing the Start menu puts
   the taskbar back over every topmost window), finds the snap spots beside
   the icon group and the tray, and spots full-screen apps.

   The open session lives here, not in the page: Node's timers are not
   throttled while FLOW's window is hidden. FLOW's window mirrors it exactly
   like a linked app (link:msg with kind 'open'), so its timer, the music sync
   and the chime follow it with no new code there. Its record is on disk
   (userData/pill.json) so a crash loses nothing; finished ones with a minute
   or more of focus are kept for the tally.

   A link arriving while something else runs the clock pops a "!" on the pill;
   an open session caught under it pauses and waits underneath. Handing an
   open session to TUTOR or GRIND starts that app with --flow-link and
   --flow-carry=<start>:<focus s>:<since break s>: it links back and its own
   session picks the minutes up, and the open session is dropped once its
   first session report shows them.

   The pill is the head of a group: FLOW's timers can dock beside it (a timers
   pop-out dropped against its right end), and they then grow out of its right
   as capsules of its own height. The group keeps the side it is held by (a
   snap spot's edge) still and grows away from it, on hover too, when the pill
   and each timer open to show their controls. The window spans the group plus
   room for that, and lets clicks through everywhere else. */
'use strict';

const { app, BrowserWindow, screen, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const SIZES = { s: { w: 232, h: 28 }, m: { w: 660, h: 32 }, l: { w: 680, h: 44 } };
const IDLE_W = { s: 132, m: 240, l: 300 };   // the compact idle pill
// each size's own width and height (Hugo, 2026-10-21): SIZES are the defaults, these the bounds
const DIMS = { s: { w: [120, 480], h: [20, 64] }, m: { w: [300, 1100], h: [22, 64] }, l: { w: [320, 1200], h: [28, 80] } };
const PAD = 12;                              // transparent margin: room for the moments
const PANEL = { w: 404, h: 236, gap: 8 };
const GAP = 6;                               // between the pill and the timers docked beside it
const GROW = 190;                            // room on the free side for what opens on hover
const APPS = ['TUTOR', 'GRIND'];
// the apps' own session colours (focus · next-break bar · break), used until their hello says otherwise
const APP_K = { GRIND: ['#FF4F2E', '#FFC23D', '#14B8A0'], TUTOR: ['#C6F24E', '#6FD3FF', '#6FD3FF'] };
const DEFAULTS = { on: false, size: 'm', scale: 1, opacity: 1, idle: 'compact', colors: 'app', snap: true, lock: false,
  through: false, fsHide: true, viz: true, moments: true, hotkeys: false, goalMin: 120, breakEvery: 50, breakMin: 10,
  tutorExe: '', grindExe: '', dims: null };
const HOTKEYS = { show: 'CommandOrControl+Alt+Shift+O', toggle: 'CommandOrControl+Alt+Shift+P' };

const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);

function cleanDims(d) {
  const o = {};
  for (const z of ['s', 'm', 'l']) {
    const x = (d && typeof d === 'object' && d[z]) || {};
    o[z] = { w: Math.round(num(x.w, DIMS[z].w[0], DIMS[z].w[1], SIZES[z].w)), h: Math.round(num(x.h, DIMS[z].h[0], DIMS[z].h[1], SIZES[z].h)) };
  }
  return o;
}
function cleanCfg(c) {
  const o = { ...DEFAULTS };
  if (c && typeof c === 'object') for (const k of Object.keys(DEFAULTS)) if (k in c) o[k] = c[k];
  o.size = ['s', 'm', 'l'].includes(o.size) ? o.size : 'm';
  o.scale = Math.round(num(o.scale, .8, 1.4, 1) * 100) / 100;
  o.opacity = Math.round(num(o.opacity, .4, 1, 1) * 100) / 100;
  o.idle = ['compact', 'dot', 'hide'].includes(o.idle) ? o.idle : 'compact';
  o.colors = o.colors === 'flow' ? 'flow' : 'app';
  for (const k of ['on', 'snap', 'lock', 'through', 'fsHide', 'viz', 'moments', 'hotkeys']) o[k] = !!o[k];
  o.goalMin = Math.round(num(o.goalMin, 5, 720, 120));
  o.breakEvery = Math.round(num(o.breakEvery, 0, 240, 50));
  o.breakMin = Math.round(num(o.breakMin, 1, 120, 10));
  o.dims = cleanDims(o.dims);
  o.tutorExe = String(o.tutorExe || '').trim().replace(/^"|"$/g, '');
  o.grindExe = String(o.grindExe || '').trim().replace(/^"|"$/g, '');
  return o;
}

/* ── the open session: focus, breaks, a goal (GRIND's clock) ──
   The record holds when the phase began; the time is folded in only on a
   change (pause, phase, end), never once a second. */
function view(s, now = Date.now()) {
  if (!s) return null;
  const dt = s.running ? Math.max(0, (now - s.phaseStart) / 1000) : 0;
  const focus = s.focusSec + (s.phase === 'focus' ? dt : 0), since = s.sinceBreak + (s.phase === 'focus' ? dt : 0);
  const v = { phase: s.phase, running: s.running, focus, since, goal: s.goalSec, every: s.breakEvery };
  if (s.phase === 'break') { v.left = Math.max(0, s.breakLen - dt); v.total = s.breakLen; }
  else if (s.breakEvery > 0) { v.left = Math.max(0, s.breakEvery - since); v.total = s.breakEvery; }
  else { v.left = Math.max(0, s.goalSec - focus); v.total = s.goalSec; }
  return v;
}
function fold(s, now) {
  const dt = s.running ? Math.max(0, (now - s.phaseStart) / 1000) : 0;
  if (s.phase === 'focus') { s.focusSec += dt; s.sinceBreak += dt; } else s.breakSec += dt;
  s.phaseStart = now;
}
function cleanOpen(o) {
  if (!o || typeof o !== 'object' || !Number.isFinite(+o.start) || !Number.isFinite(+o.phaseStart)) return null;
  return { start: +o.start, name: cleanName(o.name), phase: o.phase === 'break' ? 'break' : 'focus', phaseStart: +o.phaseStart,
    running: !!o.running, focusSec: num(o.focusSec, 0, 1e7, 0), breakSec: num(o.breakSec, 0, 1e7, 0), sinceBreak: num(o.sinceBreak, 0, 1e7, 0),
    breaks: num(o.breaks, 0, 1e4, 0) | 0, goalSec: num(o.goalSec, 300, 43200, 7200), breakEvery: num(o.breakEvery, 0, 14400, 3000),
    breakLen: num(o.breakLen, 60, 7200, 600), goalHit: !!o.goalHit };
}

module.exports = function createPill({ getWin, link, linkSend, linkToRenderer, showFlow, onChange, getTimers }) {
  const T = () => (getTimers && getTimers()) || null;
  const FILE = path.join(app.getPath('userData'), 'pill.json');
  const D = { cfg: cleanCfg(null), pos: null, open: null, done: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    D.cfg = cleanCfg(raw.cfg);
    D.pos = raw.pos && typeof raw.pos === 'object' ? raw.pos : null;
    D.open = cleanOpen(raw.open);
    D.done = Array.isArray(raw.done) ? raw.done.filter(d => d && Number.isFinite(+d.start) && Number.isFinite(+d.focusSec)).slice(-500) : [];
  } catch {}
  let saveT = null;
  function saveNow() { clearTimeout(saveT); try { fs.writeFileSync(FILE, JSON.stringify(D)); } catch {} }
  function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); }

  // what FLOW's window tells the pill: its music, its own pomodoro, its theme, its intention
  const ext = { music: null, pom: null, theme: null, intention: '' };
  let pend = null;          // a hand-over / study launch waiting for the app's link
  let fxQueue = [];         // moments waiting for the pill page to load
  const H = { launch: (exe, args) => spawn(exe, args, { detached: true, stdio: 'ignore' }).unref(), raises: 0 };

  const linked = () => !!(link.sock && link.app);
  function source() {
    if (linked()) return 'link';
    if (D.open) return 'open';
    const p = ext.pom;
    if (p && (p.running || p.left < p.total)) return 'pom';
    return 'idle';
  }
  function colours(src) {
    const t = ext.theme, flow = t ? [t.focus, t.c[1], t.brk] : ['#FF4F2E', '#FFC23D', '#14B8A0'];
    if (D.cfg.colors !== 'app' || src !== 'link') return flow;
    return Array.isArray(link.k) && link.k.length === 3 && link.k.every(isHex) ? link.k : APP_K[link.app] || flow;
  }
  function today() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const from = d.getTime(), list = D.done.filter(x => x.start >= from);
    const by = {};
    for (const x of list) { const k = x.name || ''; by[k] = (by[k] || 0) + x.focusSec; }
    let sec = list.reduce((t, x) => t + x.focusSec, 0);
    if (D.open && D.open.start >= from) sec += view(D.open).focus;
    return { min: Math.round(sec / 60), n: list.length + (D.open ? 1 : 0),
             by: Object.entries(by).map(([name, s]) => ({ name, min: Math.round(s / 60) })).sort((a, b) => b.min - a.min) };
  }
  // the names used lately, newest first, with today's minutes
  function names() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const from = d.getTime(), seen = new Map();
    for (let i = D.done.length - 1; i >= 0 && seen.size < 6; i--) {
      const x = D.done[i];
      if (!x.name || seen.has(x.name.toLowerCase())) continue;
      const min = D.done.filter(y => y.name === x.name && y.start >= from).reduce((t, y) => t + y.focusSec, 0) / 60;
      seen.set(x.name.toLowerCase(), { name: x.name, min: Math.round(min) });
    }
    return [...seen.values()];
  }
  function fromMsg(m) {
    if (!m || !m.phase || m.phase === 'idle') return null;
    const total = Math.max(1, +m.total || 1), goal = Number.isFinite(+m.goal) ? +m.goal : null;
    // older app builds don't send the break interval: in focus, a countdown that isn't the goal is one
    const every = Number.isFinite(+m.every) ? +m.every : m.phase === 'focus' && goal && total !== goal ? total : 0;
    return { phase: m.phase === 'break' ? 'break' : 'focus', running: !!m.running, focus: Number.isFinite(+m.focus) ? +m.focus : null,
             goal, left: Math.max(0, +m.left || 0), total, every, at: link.lastAt || Date.now() };
  }
  function compose() {
    const src = source(), now = Date.now();
    let s = null, appName = '', name = '';
    if (src === 'link') { appName = link.app; s = fromMsg(link.last); }
    else if (src === 'open') {
      appName = 'OPEN'; name = D.open.name;
      const v = view(D.open, now);
      s = { phase: v.phase, running: v.running, focus: v.focus, goal: v.goal, left: v.left, total: v.total, every: v.every, at: now };
    } else if (src === 'pom') {
      const p = ext.pom;
      appName = 'FLOW';
      s = { phase: p.phase === 'break' ? 'break' : 'focus', running: !!p.running, focus: null, goal: null, left: p.left, total: Math.max(1, p.total),
            every: 0, at: p.at, pom: true, long: !!p.long };
    }
    const under = src === 'link' && D.open ? { name: D.open.name, focus: Math.round(view(D.open, now).focus) } : null;
    return { src, app: appName, name, k: colours(src), s, under, music: ext.music, cfg: D.cfg, theme: ext.theme,
             today: today(), names: names(), apps: APPS, panel, intention: ext.intention, pending: pend && pend.app };
  }

  /* ── the pill window ── */
  let pw = null, loaded = false, shown = false, panel = null, hit = false, ctrl = false, drag = null, fsMon = null;
  let rect = null, layoutKey = '', boundsKey = '', guardOn = null, ignoring = null;
  // FLOW's timers (docked beside the pill when tstate.docked), their width at rest, the timers panel's height
  let tstate = null, tdockW = 0, panelH = null;
  const dockedT = () => !!(tstate && tstate.docked && tstate.list.length);
  let lastKey = '', lastPhase = null, lastFocus = 0;

  function send(ch, m) { if (pw && !pw.isDestroyed() && loaded) pw.webContents.send(ch, m); }
  function toFlow(m) { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('pill:msg', m); }
  function fx(m) {
    if (!D.cfg.moments && m.kind !== 'bang' && m.kind !== 'note') return;
    if (loaded && shown) send('pill:fx', m); else if (m.kind === 'note') fxQueue = [m];
  }
  function push() {
    const st = compose();
    // moments: the same clock changing phase, or reaching its goal
    const key = st.src + ':' + st.app;
    if (st.s && key === lastKey && !st.s.pom) {
      if (lastPhase && st.s.phase !== lastPhase) fx({ kind: st.s.phase, total: st.s.total });
      if (st.s.goal && st.s.phase === 'focus' && lastFocus < st.s.goal && st.s.focus >= st.s.goal) fx({ kind: 'goal', goal: st.s.goal });
    }
    lastKey = key; lastPhase = st.s ? st.s.phase : null; lastFocus = st.s && st.s.focus || 0;
    send('pill:state', st);
    refresh();
    toFlow({ t: 'cfg', cfg: D.cfg, today: st.today, open: D.open ? { name: D.open.name } : null, shown, hotkeys: HOTKEYS,
             want: { viz: D.cfg.on && D.cfg.viz && shown } });
    onChange && onChange();
  }

  function pillSize() {
    const z = D.cfg.dims[D.cfg.size], idle = source() === 'idle' || (source() === 'link' && !fromMsg(link.last));
    const w = !idle ? z.w : D.cfg.idle === 'dot' ? z.h : Math.min(IDLE_W[D.cfg.size], z.w);
    return { w: Math.round(w * D.cfg.scale), h: Math.round(z.h * D.cfg.scale), idle };
  }

  /* taskbars, in DIP: the bridge's, or failing that the gap between each screen and its work area */
  let barsPx = null, spotsPx = null;
  function bars() {
    const out = [];
    if (barsPx) for (const b of barsPx) {
      const r = screen.screenToDipRect(null, { x: b.x, y: b.y, width: b.w, height: b.h });
      out.push({ ...r, primary: !!b.primary });
    } else for (const d of screen.getAllDisplays()) {
      const B = d.bounds, W = d.workArea, primary = d.id === screen.getPrimaryDisplay().id;
      if (W.y + W.height < B.y + B.height) out.push({ x: B.x, y: W.y + W.height, width: B.width, height: B.y + B.height - W.y - W.height, primary });
      else if (W.y > B.y) out.push({ x: B.x, y: B.y, width: B.width, height: W.y - B.y, primary });
    }
    return out.filter(b => b.width > b.height);     // the pill only lies along a horizontal taskbar
  }
  function displayFor(id) { return screen.getAllDisplays().find(d => d.id === id) || screen.getPrimaryDisplay(); }
  /* the screen the pill was left on (Hugo, 2026-10-22: "pill needs to remember where the pill was"): Windows can
     hand a monitor a new id (a restart, a cable, the monitors waking up), and the pill then fell back to the main
     one. So: the id, else the monitor with the same bounds (kept since 1.4.0, `db`), else the one under its point. */
  const sameRect = (B, a) => Array.isArray(a) && B.x === a[0] && B.y === a[1] && B.width === a[2] && B.height === a[3];
  function homeDisplay(p) {
    const all = screen.getAllDisplays();
    const d = all.find(x => x.id === p.disp) || all.find(x => sameRect(x.bounds, p.db))
      || (!p.snapped && Number.isFinite(p.cx) && Number.isFinite(p.cy) ? screen.getDisplayNearestPoint({ x: Math.round(p.cx), y: Math.round(p.cy) }) : null);
    if (!d) return screen.getPrimaryDisplay();
    if (d.id !== p.disp && D.pos === p) { D.pos = { ...p, disp: d.id }; save(); }   // found under its new id: keep that one
    return d;
  }
  const dbOf = d => [d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height];
  function barOn(d) {
    const B = d.bounds;
    return bars().find(b => b.x < B.x + B.width && b.x + b.width > B.x && b.y < B.y + B.height && b.y + b.height > B.y) || null;
  }
  function spotsFor(bar) {
    const G = Math.round(10 * D.cfg.scale), o = { left: { x: bar.x + G, a: 'l' } };
    if (bar.primary && spotsPx) {
      const dx = v => screen.screenToDipPoint({ x: v, y: Math.round(bar.y + 1) }).x;
      if (spotsPx.icons) { o.iconsL = { x: dx(spotsPx.icons[0]) - G, a: 'r' }; o.iconsR = { x: dx(spotsPx.icons[1]) + G, a: 'l' }; }
      if (spotsPx.tray != null) o.tray = { x: dx(spotsPx.tray) - G, a: 'r' };
    }
    if (!o.tray) o.right = { x: bar.x + bar.width - G, a: 'r' };
    return o;
  }
  const spotLeft = (at, w) => at.a === 'l' ? at.x : at.x - w;
  function defaultPos() {
    const d = screen.getPrimaryDisplay(), bar = barOn(d);
    return { disp: d.id, db: dbOf(d), snapped: !!bar, spot: bar ? 'iconsL' : null,
             cx: bar ? bar.x + bar.width * .3 : d.workArea.x + d.workArea.width / 2, cy: bar ? null : d.workArea.y + d.workArea.height - 60 };
  }
  // the group's width at rest: the pill, and the timers docked beside it
  function groupW(sz) { return sz.w + (dockedT() && tdockW ? Math.round((GAP + tdockW) * D.cfg.scale) : 0); }
  function pillRect(sz, G = sz.w) {
    if (!D.pos) D.pos = defaultPos();
    const p = D.pos, d = homeDisplay(p), bar = p.snapped && D.cfg.snap ? barOn(d) : null;
    let x, y, anchor = 'l';
    if (bar) {
      y = Math.round(bar.y + (bar.height - sz.h) / 2);
      const at = p.spot && spotsFor(bar)[p.spot];
      if (at) { x = spotLeft(at, G); anchor = at.a; }
      else x = Math.round((Number.isFinite(p.cx) ? p.cx : bar.x + bar.width * .3) - sz.w / 2);
    } else {
      const W = d.workArea;
      x = Math.round((Number.isFinite(p.cx) ? p.cx : W.x + W.width / 2) - sz.w / 2);
      y = Math.round((Number.isFinite(p.cy) ? p.cy : W.y + W.height - 60) - sz.h / 2);
    }
    const B = d.bounds;
    x = Math.round(Math.min(Math.max(x, B.x + 2), B.x + B.width - G - 2));
    y = Math.round(Math.min(Math.max(y, B.y + 2), B.y + B.height - sz.h - 2));
    // it grows away from the spot's edge that holds it, or from the screen edge it is near
    const grow = anchor === 'r' || x + G + GROW * D.cfg.scale > B.x + B.width ? 'left' : 'right';
    return { x, y, w: sz.w, h: sz.h, g: G, grow, snapped: !!bar };
  }
  // the window: the group plus room to grow on its free side, plus the panel above or below the pill while that is open
  function place() {
    if (!pw || pw.isDestroyed() || drag) return;
    const sz = pillSize(), z = D.cfg.scale, r = rect = pillRect(sz, groupW(sz)), E = Math.round(GROW * z);
    let x0 = r.grow === 'left' ? r.x - E : r.x, x1 = r.grow === 'left' ? r.x + r.g : r.x + r.g + E, y0 = r.y, y1 = r.y + r.h;
    let side = null, pb = null;
    if (panel) {
      const B = screen.getDisplayMatching({ x: r.x, y: r.y, width: r.w, height: r.h }).bounds;
      const pwid = Math.round(PANEL.w * z), ph = Math.round((panel === 'timers' && panelH ? panelH : PANEL.h) * z), gap = Math.round(PANEL.gap * z);
      side = r.y + r.h / 2 > B.y + B.height / 2 ? 'up' : 'down';
      const px = Math.round(Math.min(Math.max(r.x + r.w / 2 - pwid / 2, B.x + PAD), B.x + B.width - pwid - PAD));
      pb = { x: px, y: side === 'up' ? r.y - gap - ph : r.y + r.h + gap, w: pwid, h: ph };
      x0 = Math.min(x0, pb.x); x1 = Math.max(x1, pb.x + pwid); y0 = Math.min(y0, pb.y); y1 = Math.max(y1, pb.y + ph);
    }
    const wx = x0 - PAD, wy = y0 - PAD, ww = x1 - x0 + 2 * PAD, wh = y1 - y0 + 2 * PAD;
    const bk = [wx, wy, ww, wh].join();
    if (bk !== boundsKey) { boundsKey = bk; pw.setBounds({ x: wx, y: wy, width: ww, height: wh }); }
    // the page is zoomed by the scale, so it is told its layout in its own (CSS) pixels
    const lay = { gx: (r.x - wx) / z, gr: (wx + ww - r.x - r.g) / z, gy: (r.y - wy) / z, w: r.w / z, h: r.h / z, grow: r.grow, ww: ww / z, wh: wh / z,
                  panel: pb && { x: (pb.x - wx) / z, y: (pb.y - wy) / z, w: pb.w / z, h: pb.h / z }, side, pad: PAD / z, z, idle: sz.idle, snapped: r.snapped };
    const k = JSON.stringify(lay);
    if (k !== layoutKey) { layoutKey = k; send('pill:layout', lay); }
    guard(r.snapped && shown);
  }
  function guard(on) { if (on !== guardOn) { guardOn = on; bridgeSay('guard ' + (on ? 1 : 0)); } }
  function wantShown() {
    if (!D.cfg.on) return false;
    if (panel || drag) return true;
    if (D.cfg.idle === 'hide' && pillSize().idle && !pend && !dockedT()) return false;
    if (D.cfg.fsHide && fsMon && rect) {
      const r = rect;
      if (r.x < fsMon.x + fsMon.width && r.x + r.w > fsMon.x && r.y < fsMon.y + fsMon.height && r.y + r.h > fsMon.y) return false;
    }
    return true;
  }
  function ensureWindow() {
    if (pw && !pw.isDestroyed()) return;
    loaded = false; shown = false; layoutKey = ''; boundsKey = ''; ignoring = null;
    pw = new BrowserWindow({
      width: 300, height: 60, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      focusable: false, alwaysOnTop: true, title: 'FLOW pill',
      webPreferences: { preload: path.join(__dirname, 'pill-preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    pw.setAlwaysOnTop(true, 'screen-saver');
    pw.setIgnoreMouseEvents(true, { forward: true });
    pw.on('blur', () => { if (panel) setPanel(null); });
    pw.on('closed', () => { pw = null; loaded = false; shown = false; bridgeSay('hwnd 0'); });
    pw.webContents.on('did-finish-load', () => {
      loaded = true; layoutKey = '';
      bridgeSay('hwnd ' + hwnd());
      place(); push();
      if (tstate) send('pill:timers', tstate);
      const q = fxQueue; fxQueue = []; for (const m of q) send('pill:fx', m);
    });
    pw.loadFile(path.join(__dirname, 'pill.html'));
  }
  function hwnd() {
    if (!pw || pw.isDestroyed()) return '0';
    const b = pw.getNativeWindowHandle();
    return String(b.length >= 8 ? b.readBigUInt64LE(0) : b.readUInt32LE(0));
  }
  function refresh() {
    if (!D.cfg.on) {
      if (pw && !pw.isDestroyed()) { pw.destroy(); pw = null; }
      shown = false; bridgeStop(); return;
    }
    ensureWindow(); bridgeStart();
    place();
    const want = wantShown();
    if (want && !shown && loaded) {
      shown = true; pw.showInactive(); pw.setAlwaysOnTop(true, 'screen-saver'); pw.moveTop(); place();
      toFlow({ t: 'want', want: { viz: D.cfg.viz } });
    } else if (!want && shown) { shown = false; pw.hide(); guard(false); toFlow({ t: 'want', want: { viz: false } }); }
    mouse();
  }
  function mouse() {
    if (!pw || pw.isDestroyed()) return;
    const on = !!panel || !!drag || (hit && (!D.cfg.through || ctrl));
    if (ignoring === !on) return;
    ignoring = !on;
    pw.setIgnoreMouseEvents(!on, { forward: true });
  }
  let closeT = null;
  function setPanel(mode) {
    if (mode && !D.cfg.on) return;
    const was = panel;
    panel = mode || null;
    if (!pw || pw.isDestroyed()) return;
    clearTimeout(closeT);
    pw.setFocusable(!!panel);
    // closing: the page plays the panel out first (pill.css), then the window shrinks back around the pill
    if (was && !panel && shown && loaded) { send('pill:panel', 'out'); closeT = setTimeout(() => { place(); push(); }, 150); }
    else { place(); push(); }
    if (panel) { pw.focus(); pw.webContents.focus(); }
    mouse();
  }

  /* ── dragging: the page reports the pointer in screen DIPs; the pill snaps
     to the taskbar's band and, along it, to the spots beside the icon group,
     before the tray and at the left edge ── */
  function dragStart(sx, sy) {
    if (D.cfg.lock || !rect) return;
    if (panel) setPanel(null);
    const wb = pw ? pw.getBounds() : { x: rect.x - PAD, y: rect.y - PAD };
    drag = { sx, sy, r: { ...rect }, off: { x: rect.x - wb.x, y: rect.y - wb.y }, now: null };
    bridgeSay('spots'); mouse();
  }
  function dragMove(sx, sy) {
    if (!drag || !pw) return;
    const { w, h, g } = drag.r;
    let x = Math.round(drag.r.x + sx - drag.sx), y = Math.round(drag.r.y + sy - drag.sy);
    const d = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) });
    const bar = D.cfg.snap ? barOn(d) : null, cy = y + h / 2;
    let snapped = false, spot = null;
    if (bar && cy > bar.y - 34 && cy < bar.y + bar.height + 14) {
      snapped = true; y = Math.round(bar.y + (bar.height - h) / 2);
      for (const [k, at] of Object.entries(spotsFor(bar))) { const l = spotLeft(at, g); if (Math.abs(l - x) < 26) { x = Math.round(l); spot = k; break; } }
    }
    drag.now = { disp: d.id, db: dbOf(d), snapped, spot, cx: x + w / 2, cy: y + h / 2 };
    pw.setPosition(x - drag.off.x, y - drag.off.y); boundsKey = '';
    send('pill:drag', { snapped, spot });
  }
  function dragEnd() {
    if (!drag) return;
    const n = drag.now; drag = null;
    if (n) { D.pos = n; saveNow(); }
    send('pill:drag', null);
    place(); refresh();
  }

  /* ── pill.ps1 ── */
  const BRIDGE = path.join(app.getPath('userData'), 'pill.ps1');
  const B = { proc: null, fails: 0, timer: null, spotsT: null };
  function bridgeSay(line) { if (B.proc) { try { B.proc.stdin.write(line + '\n'); } catch {} } }
  function bridgeStart() {
    if (B.proc || process.platform !== 'win32' || process.env.FLOW_PILL_NO_BRIDGE) return;
    try {
      const src = fs.readFileSync(path.join(__dirname, 'pill.ps1'), 'utf8');
      let old = null; try { old = fs.readFileSync(BRIDGE, 'utf8'); } catch {}
      if (old !== src) fs.writeFileSync(BRIDGE, src);
    } catch { return; }
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const p = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BRIDGE], { windowsHide: true });
    B.proc = p;
    let buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        onBridge(m);
      }
    });
    p.stderr.on('data', d => console.warn('[pill]', String(d).trim()));
    p.on('error', () => {});
    p.on('exit', () => {
      if (B.proc === p) B.proc = null;
      if (!D.cfg.on) return;
      if (++B.fails > 5) return;               // keeps stopping: the pill still works, only unguarded
      clearTimeout(B.timer);
      B.timer = setTimeout(bridgeStart, 1500 * B.fails);
    });
    bridgeSay('hwnd ' + hwnd());
    if (guardOn) bridgeSay('guard 1');
    bridgeSay('ctrl ' + (D.cfg.through ? 1 : 0));
    bridgeSay('spots');
    clearInterval(B.spotsT);
    // the icon group grows and shrinks as apps open: a pill beside it follows
    B.spotsT = setInterval(() => { if (shown && D.pos && /^icons|^tray/.test(D.pos.spot || '')) bridgeSay('spots'); }, 5000);
  }
  function bridgeStop() {
    clearTimeout(B.timer); clearInterval(B.spotsT);
    const p = B.proc; B.proc = null;
    if (!p) return;
    try { p.stdin.end(); } catch {}
    setTimeout(() => { try { if (p.exitCode === null) p.kill(); } catch {} }, 1500);
  }
  function onBridge(m) {
    if (m.t === 'bars') { barsPx = Array.isArray(m.list) ? m.list : null; B.fails = 0; place(); refresh(); }
    else if (m.t === 'spots') {
      const k = JSON.stringify(m);
      if (k !== JSON.stringify(spotsPx)) { spotsPx = { icons: m.icons || null, tray: m.tray == null ? null : m.tray }; place(); }
    }
    else if (m.t === 'fs') { fsMon = m.on && m.mon ? screen.screenToDipRect(null, { x: m.mon.x, y: m.mon.y, width: m.mon.w, height: m.mon.h }) : null; refresh(); }
    else if (m.t === 'ctrl') { ctrl = !!m.on; mouse(); send('pill:ctrl', ctrl); }
    else if (m.t === 'raise') H.raises++;
  }

  /* ── the open session, mirrored into FLOW's window as a link ── */
  function openMsg() {
    const v = view(D.open);
    return { t: 'session', phase: v.phase, running: v.running, left: Math.round(v.left), total: Math.round(v.total),
             focus: Math.round(v.focus), goal: v.goal, every: v.every, label: D.open.name || 'OPEN' };
  }
  function mirror() {
    if (linked()) return false;
    if (D.open) { linkToRenderer({ t: 'state', on: true, app: 'OPEN', kind: 'open', name: D.open.name }); linkToRenderer(openMsg()); return true; }
    linkToRenderer({ t: 'state', on: false });
    return false;
  }
  function openChanged(shape) {
    if (!linked() && D.open) { if (shape) mirror(); else linkToRenderer(openMsg()); }
    else if (!linked() && shape) mirror();
    push();
  }
  const O = {
    start(p = {}) {
      if (D.open) return;
      const now = Date.now(), c = D.cfg;
      D.open = { start: now, name: cleanName(p.name), phase: 'focus', phaseStart: now, running: true, focusSec: 0, breakSec: 0, sinceBreak: 0, breaks: 0,
        goalSec: Math.round(num(p.goalMin, 5, 720, c.goalMin)) * 60, breakEvery: Math.round(num(p.breakEvery, 0, 240, c.breakEvery)) * 60,
        breakLen: Math.round(num(p.breakMin, 1, 120, c.breakMin)) * 60, goalHit: false };
      saveNow(); openChanged(true);
    },
    pause() { const s = D.open; if (!s || !s.running) return; fold(s, Date.now()); s.running = false; saveNow(); openChanged(); },
    resume() { const s = D.open; if (!s || s.running) return; s.running = true; s.phaseStart = Date.now(); saveNow(); openChanged(); },
    phase(to) {
      const s = D.open; if (!s) return;
      fold(s, Date.now());
      if (to === 'break' && s.phase === 'focus') s.breaks++;
      if (to === 'focus') s.sinceBreak = 0;
      s.phase = to; s.running = true; s.phaseStart = Date.now();
      saveNow(); openChanged();
    },
    end(file = true) {
      const s = D.open; if (!s) return null;
      const now = Date.now(); fold(s, now);
      if (file && s.focusSec >= 60) D.done = D.done.concat({ start: s.start, end: now, focusSec: Math.round(s.focusSec), name: s.name }).slice(-500);
      D.open = null; saveNow(); openChanged(true);
      return s;
    },
    rename(n) { if (!D.open) return; D.open.name = cleanName(n); save(); openChanged(true); },
  };
  function toggle() {
    const src = source();
    if (src === 'link') linkSend({ t: 'cmd', cmd: 'toggle' });
    else if (src === 'open') D.open.running ? O.pause() : O.resume();
    else if (src === 'pom') { const w = getWin(); if (w) w.webContents.send('media', 'pom'); }
  }
  function skip() {
    const src = source();
    if (src === 'link') linkSend({ t: 'cmd', cmd: 'skip' });
    else if (src === 'open') O.phase(D.open.phase === 'focus' ? 'break' : 'focus');
    else if (src === 'pom') { const w = getWin(); if (w) w.webContents.send('media', 'pom-skip'); }
  }
  function end() {
    const src = source();
    if (src === 'link') linkSend({ t: 'cmd', cmd: 'end' });
    else if (src === 'open') { const s = O.end(); if (s) fx({ kind: 'note', text: s.focusSec >= 60 ? `ended · ${Math.round(s.focusSec / 60)} min` : 'ended' }); }
    else if (src === 'pom') { const w = getWin(); if (w) w.webContents.send('media', 'pom-reset'); }
  }

  /* ── TUTOR and GRIND: start them linked, hand the open session over ── */
  function exeFor(name) {
    const own = name === 'TUTOR' ? D.cfg.tutorExe : D.cfg.grindExe, dir = name.toLowerCase();
    return own || path.join(app.getPath('documents'), 'github', dir, 'dist', `${name}-win32-x64`, `${name}.exe`);
  }
  function launch(name, opts = {}) {
    if (!APPS.includes(name)) return;
    const exe = exeFor(name);
    if (!fs.existsSync(exe)) { fx({ kind: 'note', text: `${name} not found — set its path in FLOW` }); push(); return; }
    const args = [];
    if (opts.link !== false) {
      args.push('--flow-link');
      if (D.open) {
        const v = view(D.open);
        pend = { app: name, at: Date.now(), carry: { focus: Math.round(v.focus) } };
        args.push(`--flow-carry=${D.open.start}:${Math.round(v.focus)}:${Math.round(v.since)}`);
      } else pend = { app: name, at: Date.now(), carry: null };
    }
    try { H.launch(exe, args); } catch { pend = null; fx({ kind: 'note', text: `${name} could not start` }); }
    if (args.length) fx({ kind: 'note', text: `opening ${name}…` });
    push();
  }
  setInterval(() => { if (pend && Date.now() - pend.at > 90000) { pend = null; push(); } }, 5000);

  /* ── hooks from main.js's link ── */
  function linkHello(name, m, took) {
    link.k = Array.isArray(m.k) && m.k.length === 3 && m.k.every(isHex) ? m.k : null;
    const expected = pend && pend.app === name;
    const busy = (D.open && D.open.running) || took || (ext.pom && ext.pom.running);
    if (D.open && D.open.running) { fold(D.open, Date.now()); D.open.running = false; saveNow(); }
    if (busy && !expected) fx({ kind: 'bang' });
    if (panel) setPanel(null);
    push();
  }
  function linkSession(m) {
    if (pend && pend.app === link.app && m.phase && m.phase !== 'idle') {
      // the open session handed over: the app's session now carries its minutes
      if (pend.carry && D.open && Number(m.focus) >= pend.carry.focus - 30) { O.end(false); fx({ kind: 'note', text: `handed to ${link.app}` }); }
      else if (pend.carry && D.open) fx({ kind: 'bang' });
      pend = null;
    }
    push();
  }
  function linkDropped() { link.k = null; const mirrored = mirror(); push(); return mirrored; }
  function mirrorCmd(cmd) {
    if (!D.open) return false;
    if (cmd === 'toggle') D.open.running ? O.pause() : O.resume();
    else if (cmd === 'skip') O.phase(D.open.phase === 'focus' ? 'break' : 'focus');
    else if (cmd === 'end') O.end();
    return true;
  }
  function replay() { if (!linked()) mirror(); push(); }

  /* ── settings ── */
  function set(k, v) {
    if (!(k in DEFAULTS)) return;
    const before = D.cfg;
    D.cfg = cleanCfg({ ...D.cfg, [k]: v });
    if (before[k] === D.cfg[k]) { push(); return; }
    save();
    if (k === 'hotkeys') hotkeys();
    if (k === 'through') bridgeSay('ctrl ' + (D.cfg.through ? 1 : 0));
    if (k === 'on' && !D.cfg.on) panel = null;
    if (k === 'snap' && D.cfg.snap && D.pos && !D.pos.snapped) {
      // switched back on: drop onto the taskbar of the screen it is on
      const d = homeDisplay(D.pos);
      if (barOn(d)) D.pos = { ...D.pos, snapped: true, spot: null };
    }
    push();
  }
  function hotkeys() {
    for (const a of Object.values(HOTKEYS)) { try { globalShortcut.unregister(a); } catch {} }
    if (!D.cfg.hotkeys) return;
    try { globalShortcut.register(HOTKEYS.show, () => set('on', !D.cfg.on)); } catch {}
    try { globalShortcut.register(HOTKEYS.toggle, () => { if (source() === 'idle') O.start({}); else toggle(); }); } catch {}
  }

  /* ── the right-click menu ── */
  function menu() {
    const c = D.cfg, chk = (label, k) => ({ label, type: 'checkbox', checked: !!c[k], click: () => set(k, !c[k]) });
    Menu.buildFromTemplate([
      { label: 'Size', submenu: [['Small', 's'], ['Medium', 'm'], ['Large', 'l']].map(([label, v]) => ({ label, type: 'radio', checked: c.size === v, click: () => set('size', v) })) },
      chk('Snap to the taskbar', 'snap'), chk('Lock position', 'lock'), chk('Click-through (hold Ctrl to reach it)', 'through'),
      chk('Hide over full-screen apps', 'fsHide'), chk('Music bars', 'viz'),
      { label: 'Timers beside the pill', type: 'checkbox', checked: !!(tstate && tstate.docked), click: () => { if (T()) T().setDock(!(tstate && tstate.docked)); } },
      { type: 'separator' },
      { label: 'Open FLOW', click: () => showFlow() },
      { label: 'Pill settings…', click: () => { showFlow(); toFlow({ t: 'drawer', tab: 'pill' }); } },
      { label: 'Reset position', click: () => { D.pos = null; saveNow(); push(); } },
      { type: 'separator' },
      { label: 'Hide the pill', click: () => set('on', false) },
    ]).popup({ window: pw || undefined });
  }

  /* ── the page (pill.js) ── */
  ipcMain.on('pill:ui', (e, m) => {
    if (!m || !pw || e.sender !== pw.webContents) return;
    switch (m.cmd) {
      case 'hit': hit = !!m.on; mouse(); break;
      case 'drag': if (m.phase === 'start') dragStart(m.x, m.y); else if (m.phase === 'move') dragMove(m.x, m.y); else dragEnd(); break;
      case 'panel': setPanel(m.open ? (m.mode || 'main') : null); break;
      case 'menu': menu(); break;
      case 'toggle': toggle(); break;
      case 'skip': skip(); break;
      case 'end': end(); break;
      case 'start': setPanel(null); if (!linked()) O.start(m); break;
      case 'rename': O.rename(m.name); break;
      case 'link': setPanel(null); launch(m.app); break;
      case 'open-app': launch(m.app, { link: false }); break;
      case 'unlink': if (linked()) { const s = link.sock; linkSend({ t: 'bye' }); try { s.end(); } catch {} } setPanel(null); break;
      case 'music': { const w = getWin(); if (w) w.webContents.send('media', 'toggle'); break; }
      case 'flow': setPanel(null); showFlow(); break;
      case 'settings': setPanel(null); showFlow(); toFlow({ t: 'drawer', tab: 'pill' }); break;
      case 'set': set(m.k, m.v); break;
      case 'ready': layoutKey = ''; place(); push(); if (tstate) send('pill:timers', tstate); break;
      // the docked timers: their width at rest, the timers panel's height, one dragged off (the pop-out comes back where it is dropped)
      case 'tdock': { const w = Math.max(0, Math.round(Number(m.w) || 0)); if (w !== tdockW) { tdockW = w; place(); } break; }
      case 'panelH': { const h = Math.max(120, Math.min(560, Math.round(Number(m.h) || 0))); if (h !== panelH) { panelH = h; place(); } break; }
      case 'undock': setPanel(null); if (T()) T().undock(m.x, m.y); break;
    }
  });
  // FLOW's window: its music, pomodoro, theme and intention; the pill's settings; the session buttons in the drawer
  ipcMain.on('pill:ext', (e, m) => {
    if (!m) return;
    if (m.kind === 'music') ext.music = m.v || null;
    else if (m.kind === 'pom') ext.pom = m.v ? { ...m.v, at: Date.now() } : null;
    else if (m.kind === 'theme') ext.theme = m.v || null;
    else if (m.kind === 'intention') ext.intention = String(m.v || '').slice(0, 80);
    else return;
    push();
  });
  ipcMain.on('pill:viz', (e, v) => { if (shown) send('pill:viz', v); });
  ipcMain.on('pill:set', (e, { k, v } = {}) => set(k, v));
  ipcMain.on('pill:cmd', (e, m = {}) => {
    if (m.cmd === 'panel') { if (!D.cfg.on) set('on', true); setTimeout(() => setPanel('main'), 300); }
    else if (m.cmd === 'start') { if (!linked()) O.start(m); }
    else if (m.cmd === 'rename') O.rename(m.name);
    else if (m.cmd === 'end') end();
    else if (m.cmd === 'reset-pos') { D.pos = null; saveNow(); push(); }
    else if (m.cmd === 'ready') { replay(); }
  });

  setInterval(() => {
    const s = D.open;
    if (s && s.running) {
      const v = view(s);
      if (s.phase === 'focus') {
        if (!s.goalHit && v.focus >= s.goalSec) { s.goalHit = true; save(); }
        if (s.breakEvery > 0 && v.since >= s.breakEvery) O.phase('break');
      } else if (v.left <= 0) O.phase('focus');
    }
  }, 1000);
  // FLOW's window counts down between messages; a refresh keeps it honest (as TUTOR and GRIND do)
  setInterval(() => { if (D.open && !linked()) linkToRenderer(openMsg()); }, 2000);
  screen.on('display-metrics-changed', () => { place(); });
  screen.on('display-removed', () => { place(); refresh(); });
  screen.on('display-added', () => { place(); });
  app.on('will-quit', () => {
    for (const a of Object.values(HOTKEYS)) { try { globalShortcut.unregister(a); } catch {} }
    bridgeStop(); saveNow();
  });

  hotkeys();
  setTimeout(() => { replay(); refresh(); }, 0);

  return {
    linkHello, linkSession, linkDropped, mirrorCmd, replay, set, refresh, push,
    // the timers (timers-main.js): whether the pill is there to dock to, where its group is, the timers to show
    isOn: () => D.cfg.on,
    groupRect: () => rect && shown ? { x: rect.x, y: rect.y, w: rect.g, h: rect.h } : null,
    setTimers(s) {
      tstate = s;
      if (!dockedT()) tdockW = 0;
      send('pill:timers', s);
      if (!dockedT() && panel === 'timers') setPanel(null); else refresh();
    },
    dockHint: on => send('pill:hint', !!on),
    note: text => fx({ kind: 'note', text: String(text || '').slice(0, 60) }),
    openTimers() { if (D.cfg.on) { setPanel('timers'); send('pill:focus', {}); } },
    expecting: name => !!pend && pend.app === name,
    trayItems() {
      return [
        { label: D.cfg.on ? 'Hide the pill' : 'Show the pill', click: () => set('on', !D.cfg.on) },
        D.open ? { label: `End the open session${D.open.name ? ' · ' + D.open.name : ''}`, click: () => end() }
               : { label: 'Start an open session', enabled: !linked(), click: () => { if (D.cfg.on) setPanel('main'); else O.start({}); } },
      ];
    },
    _test: { D, H, get rect() { return rect; }, get tdockW() { return tdockW; }, get shown() { return shown; }, get panel() { return panel; }, get win() { return pw; }, get ignoring() { return ignoring; },
             get spots() { return spotsPx; }, bars, spotsFor, pillSize, compose, launch, O, dragStart, dragMove, dragEnd, setPanel, onBridge, push, set, place, homeDisplay },
  };
};
