/* FLOW · timers (main process) — quick timers made on the fly: "laundry 2h".
   They keep time here, not in a page, so they run while FLOW's window is
   hidden, and FLOW's window and the pop-out show the same list. Each has a
   name, a colour and a length; edit, pause and reset (the page asks first)
   work from either. One that ends pops the overlay (ring.html) on the screen
   the mouse is on, rings in FLOW's window and leaves a Windows notification.

   In FLOW's window they are docked in every view (app.js moves the dock: a
   strip under the standard titlebar, under the minimal view — main.js grows
   the window by it —, under the mini bar, top right in full screen). Popped
   out they get a small window of their own (timers.html) that looks like the
   pill. Dropped against the pill's right end, the pop-out docks: the timers
   then grow out of the pill as capsules of its own (pill.js draws them), and
   one dragged away from it brings the pop-out back where it is let go. The
   timers themselves aren't saved; the settings, the pop-out's place and the
   names used (each with its colour and length, for the autocomplete) are, in
   userData/timers.json.
   A timer can ding every so often while it runs (cfg.every for new ones, or its own; Hugo,
   2026-10-21): a soft note in FLOW's window and a bubble over the timer wherever it shows (the
   pill says it when they are docked). Another app adds one by starting FLOW again with
   --flow-timer=15m [--flow-timer-name=…] [--flow-timer-every=5m] (CORE's "how long?"). */
'use strict';

const { app, BrowserWindow, screen, ipcMain, Notification, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const COLORS = ['#FF4F2E', '#FFC23D', '#2F62FF', '#14B8A0', '#C6F24E', '#6FD3FF', '#FF7AB6', '#A78BFA', '#F2EDE3'];
const WIDTHS = { s: 280, m: 340, l: 420 };   // the pop-out's rows
const PAD = 8;                               // the pop-out's transparent margin (room for the done pulse)
const MAX_MS = 100 * 3600e3;
const SNOOZE = 5 * 60e3;
const HOTKEY = 'CommandOrControl+Alt+Shift+N';
const DEFAULTS = { on: false, pop: false, dock: false, bar: 'fill', showLeft: true, order: 'added', overlay: 'big', stay: false, sound: 'chime',
  notify: true, popTop: true, popOpacity: 1, popSize: 'm', presets: '5m 10m 25m 1h 2h', hotkey: false, every: '' };
const MIN_EVERY = 10e3;                      // a ding no more often than every 10 s

/* lengths, as timers-ui.js reads them: 25m · 2h · 1h30 · 1h 30m · 90 (minutes) · 1:30 · 45s */
const UNIT = { h: 3600, m: 60, s: 1 };
function parseDur(str) {
  const s = String(str || '').trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
  if (!s) return null;
  const ok = ms => (ms >= 1000 && ms <= MAX_MS ? Math.round(ms) : null);
  const c = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (c) return ok((+c[1] * 3600 + +c[2] * 60 + +(c[3] || 0)) * 1000);
  if (/^\d+(\.\d+)?$/.test(s)) return ok(+s * 60e3);
  const re = /(\d+(?:\.\d+)?)(hours?|hrs?|h|minutes?|mins?|mn|m|seconds?|secs?|s)?/y;
  let sec = 0, last = '';
  while (re.lastIndex < s.length) {
    const t = re.exec(s);
    if (!t) return null;
    const u = t[2] ? t[2][0] : last === 'h' ? 'm' : last === 'm' ? 's' : '';
    if (!u || (t[2] == null && re.lastIndex < s.length)) return null;
    sec += +t[1] * UNIT[u]; last = u;
  }
  return ok(sec * 1000);
}
// "every": off ('' / 'off' / 0) or a length of at least 10 s
const everyOf = v => { if (v == null || v === '' || v === 0 || /^(off|no|none|0)$/i.test(String(v).trim())) return 0; const ms = typeof v === 'number' ? v : parseDur(v); return ms && ms >= MIN_EVERY ? ms : 0; };

const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);

function cleanCfg(c) {
  const o = { ...DEFAULTS };
  if (c && typeof c === 'object') for (const k of Object.keys(DEFAULTS)) if (k in c) o[k] = c[k];
  for (const k of ['on', 'pop', 'dock', 'showLeft', 'stay', 'notify', 'popTop', 'hotkey']) o[k] = !!o[k];
  o.bar = o.bar === 'drain' ? 'drain' : 'fill';
  o.order = o.order === 'soon' ? 'soon' : 'added';
  o.overlay = ['big', 'small', 'off'].includes(o.overlay) ? o.overlay : 'big';
  o.sound = ['chime', 'ring', 'off'].includes(o.sound) ? o.sound : 'chime';
  o.popSize = ['s', 'm', 'l'].includes(o.popSize) ? o.popSize : 'm';
  o.popOpacity = Math.round(num(o.popOpacity, .4, 1, 1) * 100) / 100;
  o.presets = String(o.presets == null ? DEFAULTS.presets : o.presets).replace(/\s+/g, ' ').trim().slice(0, 80);
  o.every = everyOf(o.every) ? String(o.every).trim().slice(0, 14) : '';
  return o;
}
function cleanNames(a) {
  if (!Array.isArray(a)) return [];
  const seen = new Set(), out = [];
  for (const x of a) {
    const name = cleanName(x && x.name), k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    out.push({ name, color: isHex(x.color) ? x.color : COLORS[0], dur: Math.round(num(x.dur, 1000, MAX_MS, 25 * 60e3)),
               n: num(x.n, 0, 1e6, 0) | 0, at: num(x.at, 0, 1e15, 0) });
  }
  return out.slice(0, 60);
}
// "2h", "1h 30m", "45s" (the notification)
function human(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return [h && h + 'h', m && m + 'm', !h && r && r + 's'].filter(Boolean).join(' ') || '0s';
}

module.exports = function createTimers({ getWin, showFlow, onChange, getPill }) {
  const P = () => (getPill && getPill()) || null;
  const FILE = path.join(app.getPath('userData'), 'timers.json');
  const D = { cfg: cleanCfg(null), pos: null, names: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    D.cfg = cleanCfg(raw.cfg);
    D.names = cleanNames(raw.names);
    const p = raw.pos;
    D.pos = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y, anchor: p.anchor === 'top' ? 'top' : 'bottom' } : null;
  } catch {}
  let saveT = null;
  function saveNow() { clearTimeout(saveT); try { fs.writeFileSync(FILE, JSON.stringify(D)); } catch {} }
  function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); }

  // the GUI test swaps notify out: no real Windows notification
  const H = {
    notify(title, body) {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title, body, silent: true });   // FLOW's window rings, not Windows
      n.on('click', () => showFlow());
      n.show();
    },
  };
  let list = [], seq = 0, theme = null;
  const get = id => list.find(t => t.id === id);
  const leftOf = (t, now = Date.now()) => t.done ? 0 : t.running ? Math.max(0, t.endAt - now) : t.left;

  // a new timer's colour: the first one no running timer wears
  function nextColor() {
    const used = new Set(list.map(t => t.color.toLowerCase()));
    return COLORS.find(c => !used.has(c.toLowerCase())) || COLORS[list.length % COLORS.length];
  }
  function remember(name, color, dur, used) {
    const k = name.toLowerCase(), i = D.names.findIndex(x => x.name.toLowerCase() === k);
    const old = i >= 0 ? D.names.splice(i, 1)[0] : null;
    D.names.unshift({ name, color, dur: dur || (old ? old.dur : 25 * 60e3), n: (old ? old.n : 0) + (used ? 1 : 0), at: Date.now() });
    D.names = D.names.slice(0, 60);
    save();
  }
  // soonest first: the ended ones (newest on top), then by time left, the paused ones last
  function ordered() {
    if (D.cfg.order !== 'soon') return list;
    const now = Date.now(), rank = t => t.done ? -t.doneAt : t.running ? leftOf(t, now) : 1e13 + t.left;
    return list.slice().sort((a, b) => rank(a) - rank(b));
  }
  function snapshot() {
    const now = Date.now();
    return {
      list: ordered().map(t => ({ id: t.id, name: t.name, color: t.color, total: t.total, left: leftOf(t, now), endAt: t.running ? t.endAt : null,
                                  running: t.running, done: t.done, doneAt: t.doneAt, every: t.every || 0 })),
      cfg: D.cfg, names: D.names, colors: COLORS, next: nextColor(), theme, popped: popWanted(), now,
      docked: docked(), anchor: D.pos ? D.pos.anchor : 'bottom',   // in the pill / which edge the pop-out grows from
    };
  }
  function toFlow(m) { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('timers:msg', m); }
  function push() {
    const s = snapshot();
    toFlow({ t: 'state', ...s });
    sendPop('timers:state', s); sendRing('timers:state', s);
    const p = P(); if (p) p.setTimers(s);
    wasDocked = s.docked;
    popRefresh();
    onChange && onChange();
  }

  /* ── the timers ── */
  const C = {
    add(p = {}) {
      const dur = Math.round(Number(p.dur));
      if (!(dur >= 1000 && dur <= MAX_MS)) return null;
      const now = Date.now(), name = cleanName(p.name) || human(dur), color = isHex(p.color) ? p.color : nextColor();
      const every = p.every != null ? everyOf(p.every) : everyOf(D.cfg.every);
      const t = { id: 't' + (++seq), name, color, total: dur, endAt: now + dur, left: dur, running: true, done: false, doneAt: 0, at: now,
                  every: every < dur ? every : 0, nextDing: every && every < dur ? now + every : 0 };
      list.push(t);
      remember(name, color, dur, true);
      push();
      return t;
    },
    // pause / resume; on an ended timer the middle button dismisses it
    toggle(id) {
      const t = get(id); if (!t) return;
      if (t.done) { C.remove(id); return; }
      if (t.running) { t.left = Math.max(0, t.endAt - Date.now()); t.endAt = null; t.running = false; }
      else { t.endAt = Date.now() + t.left; t.running = true; if (t.every) t.nextDing = Date.now() + t.every; }
      push();
    },
    // back to its full length: it keeps running (an ended one starts again), a paused one stays paused
    reset(id) {
      const t = get(id); if (!t) return;
      const run = t.running || t.done;
      t.done = false; t.doneAt = 0; t.left = t.total; t.running = run; t.endAt = run ? Date.now() + t.total : null;
      if (t.every) t.nextDing = Date.now() + t.every;
      push();
    },
    // name, colour, time left (the time already spent stays on the bar; an ended one starts again)
    edit(id, p = {}) {
      const t = get(id); if (!t) return;
      const name = cleanName(p.name);
      if (name) t.name = name;
      if (isHex(p.color)) t.color = p.color;
      const left = Math.round(Number(p.left));
      if (p.left != null && left >= 1000 && left <= MAX_MS) {
        const now = Date.now();
        t.total = t.done ? left : Math.min(MAX_MS, t.total - leftOf(t, now) + left);
        t.left = left;
        if (t.running || t.done) { t.endAt = now + left; t.running = true; }
        t.done = false; t.doneAt = 0;
      }
      if (p.every != null) { t.every = everyOf(p.every); t.nextDing = t.every ? Date.now() + t.every : 0; }
      if (name || isHex(p.color)) remember(t.name, t.color, 0, false);
      push();
    },
    remove(id) { const n = list.length; list = list.filter(t => t.id !== id); if (list.length !== n) push(); },
    snooze(id) {
      const t = get(id); if (!t) return;
      t.total = SNOOZE; t.left = SNOOZE; t.endAt = Date.now() + SNOOZE; t.running = true; t.done = false; t.doneAt = 0;
      push();
    },
  };
  function forget(name) {
    if (name === '*') D.names = [];
    else { const k = cleanName(name).toLowerCase(); D.names = D.names.filter(x => x.name.toLowerCase() !== k); }
    save(); push();
  }

  // ended: FLOW's window rings (and toasts), the overlay pops, Windows keeps a notification
  function ring(t) {
    const c = D.cfg;
    toFlow({ t: 'done', id: t.id, name: t.name, sound: c.sound });
    if (c.overlay !== 'off') overlay(t);
    if (c.notify) { try { H.notify(`${t.name} — done`, `Your ${human(t.total)} timer has ended.`); } catch {} }
  }
  // every so often while it runs: a soft note in FLOW's window, a bubble over the timer (the pill says it when docked)
  function ding(t, now) {
    const left = Math.max(0, t.endAt - now);
    const m = { id: t.id, name: t.name, color: t.color, left, text: `${t.name} · ${human(left)} left`, sound: D.cfg.sound !== 'off' };
    toFlow({ t: 'ding', ...m });
    sendPop('timers:ding', m);
    const p = P(); if (p && docked() && p.note) p.note(m.text);
    H.dinged && H.dinged(m);
  }
  setInterval(() => {
    const now = Date.now();
    for (const t of list) {
      if (!t.running || !t.every || !t.nextDing || t.nextDing > now) continue;
      if (t.endAt - now > 1500) ding(t, now);   // not in the last moment: the end rings anyway
      while (t.nextDing <= now) t.nextDing += t.every;
    }
    const ended = list.filter(t => t.running && t.endAt <= now);
    if (!ended.length) return;
    for (const t of ended) { t.running = false; t.done = true; t.doneAt = now; t.left = 0; t.endAt = null; }
    push();
    for (const t of ended) ring(t);
  }, 250);

  /* ── the overlay: a transparent window over the whole screen the mouse is on.
     Clicks pass through it except on the banners it leaves when "keep it on
     screen" is on; it closes itself once it has nothing left to show. ── */
  let rw = null, rwLoaded = false, rq = [];
  function sendRing(ch, m) { if (rw && !rw.isDestroyed() && rwLoaded) rw.webContents.send(ch, m); }
  function overlay(t) {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), b = d.bounds;
    const m = { id: t.id, name: t.name, color: t.color, total: t.total, size: D.cfg.overlay, stay: D.cfg.stay };
    if (rw && !rw.isDestroyed()) {
      if (rwLoaded) sendRing('timers:ring', m); else rq.push(m);
      if (!rw.isVisible() && rwLoaded) rw.showInactive();
      return;
    }
    rwLoaded = false; rq = [m];
    rw = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: false, alwaysOnTop: true, title: 'FLOW timer',
      webPreferences: { preload: path.join(__dirname, 'timers-preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    rw.setAlwaysOnTop(true, 'screen-saver');
    rw.setIgnoreMouseEvents(true, { forward: true });
    rw.on('closed', () => { rw = null; rwLoaded = false; });
    rw.webContents.on('did-finish-load', () => {
      rwLoaded = true;
      sendRing('timers:state', snapshot());
      const q = rq; rq = []; for (const x of q) sendRing('timers:ring', x);
      rw.setBounds(b); rw.showInactive(); rw.setAlwaysOnTop(true, 'screen-saver');
    });
    rw.loadFile(path.join(__dirname, 'ring.html'));
  }

  /* ── the pop-out: the rows on their own, on top. Its page reports how tall
     it is and where it is dragged; it grows away from the screen edge it is
     nearest (from its top in the upper half, from its bottom in the lower). ── */
  let pw = null, pwLoaded = false, pwShown = false, popH = 0, pdrag = null, phit = false, pIgnore = null, pTop = null, pBounds = '';
  let wasDocked = false;
  const popWanted = () => D.cfg.on && D.cfg.pop;
  // popped out and docked beside the pill (while the pill is on): no window of their own then
  const docked = () => popWanted() && D.cfg.dock && !!P() && P().isOn();
  function sendPop(ch, m) { if (pw && !pw.isDestroyed() && pwLoaded) pw.webContents.send(ch, m); }
  function popBounds() {
    const w = WIDTHS[D.cfg.popSize] + 2 * PAD, h = Math.max(2 * PAD + 30, Math.round(popH) || 2 * PAD + 34);
    let p = D.pos;
    if (!p) { const W = screen.getPrimaryDisplay().workArea; p = { x: W.x + W.width - w - 8, y: W.y + W.height - 8, anchor: 'bottom' }; }
    const W = screen.getDisplayNearestPoint({ x: Math.round(p.x + w / 2), y: Math.round(p.y) }).workArea;
    let x = Math.round(p.x), y = Math.round(p.anchor === 'bottom' ? p.y - h : p.y);
    x = Math.min(Math.max(x, W.x - PAD), W.x + W.width - w + PAD);
    y = Math.min(Math.max(y, W.y - PAD), W.y + W.height - h + PAD);
    return { x, y, width: w, height: h };
  }
  function placePop() {
    if (!pw || pw.isDestroyed() || pdrag) return;
    const b = popBounds(), k = [b.x, b.y, b.width, b.height].join();
    if (k !== pBounds) { pBounds = k; pw.setBounds(b); }
  }
  function popMouse() {
    if (!pw || pw.isDestroyed()) return;
    const on = phit || !!pdrag;
    if (pIgnore === !on) return;
    pIgnore = !on;
    pw.setIgnoreMouseEvents(!on, { forward: true });
  }
  function popRefresh() {
    if (!popWanted() || docked()) {
      if (pw && !pw.isDestroyed()) pw.destroy();
      pw = null; pwShown = false; return;
    }
    if (pw && !pw.isDestroyed()) {
      if (pTop !== D.cfg.popTop) { pTop = D.cfg.popTop; pw.setAlwaysOnTop(pTop, 'floating'); }
      placePop(); return;
    }
    pwLoaded = false; pwShown = false; popH = 0; pIgnore = null; pBounds = ''; pTop = D.cfg.popTop; phit = false;
    pw = new BrowserWindow({
      ...popBounds(), show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: pTop, title: 'FLOW timers',
      webPreferences: { preload: path.join(__dirname, 'timers-preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    if (pTop) pw.setAlwaysOnTop(true, 'floating');
    popMouse();
    const me = pw;
    // closed by hand (Alt+F4): the timers go back into FLOW's window
    pw.on('close', () => { if (pw === me && popWanted()) { D.cfg = cleanCfg({ ...D.cfg, pop: false }); save(); setImmediate(push); } });
    pw.on('closed', () => { if (pw === me) { pw = null; pwLoaded = false; pwShown = false; } });
    pw.webContents.on('did-finish-load', () => { pwLoaded = true; sendPop('timers:state', snapshot()); });
    pw.loadFile(path.join(__dirname, 'timers.html'));
  }
  function popDrag(m) {
    if (!pw || pw.isDestroyed()) return;
    if (m.phase === 'start') { pdrag = { sx: m.x, sy: m.y, b: pw.getBounds() }; popMouse(); }
    else if (m.phase === 'move' && pdrag) {
      pw.setPosition(Math.round(pdrag.b.x + m.x - pdrag.sx), Math.round(pdrag.b.y + m.y - pdrag.sy));
      const near = nearPill(); if (near !== !!pdrag.near) { pdrag.near = near; const p = P(); if (p) p.dockHint(near); }
    }
    else if (m.phase === 'end' && pdrag) {
      const near = pdrag.near; pdrag = null;
      if (near) { P().dockHint(false); setDock(true); return; }
      const b = pw.getBounds(), W = screen.getDisplayMatching(b).workArea, low = b.y + b.height / 2 > W.y + W.height / 2;
      D.pos = { x: b.x, y: low ? b.y + b.height : b.y, anchor: low ? 'bottom' : 'top' };
      pBounds = ''; saveNow(); placePop(); popMouse();
    }
  }

  // held against the pill's right end (its group's, with timers already docked there)
  function nearPill() {
    const p = P(), g = p && p.isOn() && p.groupRect();
    if (!g || !pw || pw.isDestroyed()) return false;
    const b = pw.getBounds(), left = b.x + PAD, top = b.y + PAD, bottom = b.y + b.height - PAD;
    return Math.abs(left - (g.x + g.w)) < 70 && top < g.y + g.h + 40 && bottom > g.y - 40;
  }
  function setDock(on) {
    D.cfg = cleanCfg({ ...D.cfg, dock: !!on, pop: on ? true : D.cfg.pop, on: on ? true : D.cfg.on });
    if (on && P() && !P().isOn()) P().set('on', true);
    saveNow(); push();
  }
  // a docked timer dragged off the pill: the pop-out comes back where it was let go, growing away from the nearer edge
  function undock(x, y) {
    x = Number(x); y = Number(y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const W = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea, low = y > W.y + W.height / 2;
      D.pos = { x: Math.round(x - 40), y: Math.round(low ? y + 24 : y - 24), anchor: low ? 'bottom' : 'top' };
      pBounds = '';
    }
    D.cfg = cleanCfg({ ...D.cfg, dock: false });
    saveNow(); push();
  }
  // the pill came or went (on, off): docked timers move between it and their own window
  function pillChanged() { if (docked() !== wasDocked) push(); }

  /* ── settings, the shortcut, "a new timer" from anywhere ── */
  function set(k, v) {
    if (k === 'dock') { setDock(!!v); return; }
    if (!(k in DEFAULTS)) return;
    const before = D.cfg[k];
    D.cfg = cleanCfg({ ...D.cfg, [k]: v });
    if (before !== D.cfg[k]) { save(); if (k === 'hotkey') hotkey(); }
    push();
  }
  // the tray, the global shortcut, N in FLOW: the new-timer field, wherever the timers are
  function newTimer() {
    if (!D.cfg.on) set('on', true);
    if (docked()) { P().openTimers(); return; }
    if (popWanted()) {
      const go = () => { if (pw && !pw.isDestroyed()) { pw.show(); pw.focus(); sendPop('timers:focus', {}); } };
      if (pwLoaded && pwShown) go(); else setTimeout(go, 700);
    } else { showFlow(); toFlow({ t: 'focus' }); }
  }
  function hotkey() {
    try { globalShortcut.unregister(HOTKEY); } catch {}
    if (D.cfg.hotkey) { try { globalShortcut.register(HOTKEY, newTimer); } catch {} }
  }

  ipcMain.on('timers:cmd', (e, m) => {
    if (!m || typeof m !== 'object') return;
    switch (m.cmd) {
      case 'ready': push(); break;
      case 'add': C.add(m); break;
      case 'toggle': C.toggle(m.id); break;
      case 'reset': C.reset(m.id); break;
      case 'edit': C.edit(m.id, m); break;
      case 'remove': case 'dismiss': C.remove(m.id); break;
      case 'snooze': C.snooze(m.id); break;
      case 'forget': forget(m.name); break;
      case 'set': set(m.k, m.v); break;
      case 'pop': set('pop', m.v == null ? !D.cfg.pop : !!m.v); break;
      case 'focus': newTimer(); break;
      case 'theme': theme = m.v && typeof m.v === 'object' ? m.v : null; push(); break;
    }
  });
  // the pop-out's and the overlay's own window business
  ipcMain.on('timers:ui', (e, m) => {
    if (!m) return;
    if (pw && !pw.isDestroyed() && e.sender === pw.webContents) {
      if (m.cmd === 'size') {
        popH = num(m.h, 20, 3000, 50); placePop();
        if (!pwShown && pwLoaded) { pwShown = true; pw.showInactive(); }
      }
      else if (m.cmd === 'hit') { phit = !!m.on; popMouse(); }
      else if (m.cmd === 'drag') popDrag(m);
    } else if (rw && !rw.isDestroyed() && e.sender === rw.webContents) {
      if (m.cmd === 'hit') rw.setIgnoreMouseEvents(!m.on, { forward: true });
      else if (m.cmd === 'idle') { rw.destroy(); rw = null; }
    }
  });
  screen.on('display-removed', () => { pBounds = ''; placePop(); });
  app.on('will-quit', () => {
    try { globalShortcut.unregister(HOTKEY); } catch {}
    saveNow();
  });

  hotkey();
  setTimeout(push, 0);

  /* FLOW started again with --flow-timer=15m (CORE's "how long?"): add it, the timers on */
  function fromArgs(argv) {
    const arg = k => { const x = (argv || []).map(String).find(a => a.toLowerCase().startsWith('--flow-timer' + k + '=')); return x == null ? null : x.slice(x.indexOf('=') + 1).replace(/^"|"$/g, ''); };
    const dur = parseDur(arg(''));
    if (!dur) return false;
    if (!D.cfg.on) { D.cfg = cleanCfg({ ...D.cfg, on: true }); save(); }
    const ev = arg('-every');
    C.add({ dur, name: arg('-name') || '', every: ev == null ? undefined : ev });
    return true;
  }

  return {
    push, set, newTimer, undock, setDock, pillChanged, fromArgs,
    trayItems() {
      return [
        { label: D.cfg.on ? 'Hide the timers' : 'Show the timers', click: () => set('on', !D.cfg.on) },
        { label: 'New timer…', click: newTimer },
      ];
    },
    _test: { D, H, C, set, push, snapshot, newTimer, forget, fromArgs, parseDur, everyOf, get list() { return list; }, get pop() { return pw; }, get popShown() { return pwShown; },
             get ring() { return rw; }, popDrag, undock, setDock, nearPill },
  };
};
