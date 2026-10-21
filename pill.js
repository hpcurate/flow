/* FLOW · the pill page. main (pill-main.js) sends the state, the layout, the
   music bars and the moments; this draws them and sends back what is asked.
   The clock counts on locally from the state's timestamp between updates.
   Markup is rebuilt only when what the pill shows changes shape (size,
   source, phase, paused…), so a button under the pointer stays put.
   FLOW's timers can be docked beside the pill (timers-main.js decides): they
   are drawn here as capsules, their width is reported so main can place the
   group, their buttons go straight to the timers, and one dragged away from
   the pill takes the timers back to their own window. The timers panel is
   the same list as everywhere else (timers-ui.js). */
'use strict';

const P = window.pillAPI;
const $ = id => document.getElementById(id);
const pill = $('pill'), inner = $('in'), fxEl = $('fx'), panelEl = $('panel'), group = $('group'), tdock = $('tdock');
let st = null, lay = null, shapeKey = '', panelKey = '', hitOn = false, fxT = null, renameT = null;
let draft = null;   // the start panel's goal / breaks, remembered as FLOW's defaults when changed
let vizEls = [];    // the four music bars, when the pill shows them
let ts = null;      // FLOW's timers (docked here when ts.docked)
let tui = null, tHost = null, tEdit = null, tdKey = '';   // the timers panel, a timer to edit once it opens, the docked capsules' shape

const SVG = d => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><rect x="4" y="3.2" width="2.8" height="9.6" rx="1" fill="currentColor"/><rect x="9.2" y="3.2" width="2.8" height="9.6" rx="1" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>',
  skip: SVG('<path d="M4 3.5l6 4.5-6 4.5zM12 3.5v9"/>'),
  link: SVG('<path d="M6.6 9.4l2.8-2.8"/><path d="M7.4 4.6l1.1-1.1a2.9 2.9 0 014.1 4.1l-1.1 1.1"/><path d="M8.6 11.4l-1.1 1.1a2.9 2.9 0 01-4.1-4.1l1.1-1.1"/>'),
  more: '<svg viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="12.5" cy="8" r="1.5" fill="currentColor"/></svg>',
  x: SVG('<path d="M4 4l8 8M12 4l-8 8"/>'),
  edit: SVG('<path d="M10.2 3.3l2.5 2.5L6.3 12.2H3.8V9.7z"/>'),
  reset: SVG('<path d="M3.4 8.2a4.6 4.6 0 1 0 1.5-3.5"/><path d="M3.4 2.6v2.8h2.8"/>'),
  check: SVG('<path d="M3.5 8.4l3 3 6-7"/>'),
};
const MARK = '<svg class="mark" viewBox="0 0 26 26" aria-hidden="true"><circle cx="6" cy="6" r="6" class="k1"/><path d="M14 12V0a12 12 0 0 1 12 12z" class="k2"/><rect y="14" width="12" height="12" rx="1.5" class="k3"/><path d="M14 14h12a6 6 0 0 1-12 0z" class="k5"/></svg>';
// each app's button wears its own colour
const APP_COL = { TUTOR: '#C6F24E', GRIND: '#FF4F2E' };

const p2 = n => String(n).padStart(2, '0');
const clock = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`; };
const hm = min => { min = Math.round(min); const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m} min`; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ink(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return .299 * (n >> 16 & 255) + .587 * (n >> 8 & 255) + .114 * (n & 255) > 150 ? '#0b0b0c' : '#F2EDE3';
}

/* ── the clock, counted on from the state's timestamp ── */
function cur() {
  const s = st && st.s;
  if (!s) return null;
  const dt = s.running ? Math.max(0, (Date.now() - s.at) / 1000) : 0;
  const left = Math.max(0, s.left - dt);
  const focus = s.focus == null ? null : s.focus + (s.phase === 'focus' ? dt : 0);
  const nx = !s.pom && (s.every > 0 || s.phase === 'break');
  const v = { left, focus, goal: s.goal, nx, nextP: nx ? Math.min(1, Math.max(0, 1 - left / s.total)) : null };
  v.goalP = s.pom ? Math.min(1, Math.max(0, 1 - left / s.total)) : s.goal ? Math.min(1, focus / s.goal) : 0;
  if (s.pom) v.sub = s.phase === 'break' ? (s.long ? 'long break' : 'break') : 'pomodoro';
  else if (s.phase === 'break') v.sub = `back in ${clock(left)}`;
  else if (s.every > 0) v.sub = `break in ${clock(left)}`;
  else if (s.goal && focus >= s.goal) v.sub = 'goal reached';
  else v.sub = s.goal && focus != null ? `${clock(s.goal - focus)} to go` : '';
  return v;
}
const phaseWord = s => !s.running ? 'paused' : s.phase === 'break' ? (s.long ? 'long break' : 'break') : 'focus';
function tagText() {
  if (st.src === 'link') return st.app;
  if (st.src === 'pom') return 'flow';
  return st.cfg.size === 'm' && st.name ? st.name : 'open';
}
function music() {
  const m = st.music;
  if (!m || !m.title) return { t: 'nothing playing', b: '' };
  return { t: m.title, b: m.sub || '' };
}

/* ── markup ── */
const vizHTML = () => st.cfg.viz ? '<button class="viz" id="viz" data-act="music" tabindex="-1"><i></i><i></i><i></i><i></i></button>' : '';
const barsHTML = v => `<span class="bars"><span><b id="bg"></b></span>${v.nx ? '<span class="nx"><b id="bn"></b></span>' : ''}</span>`;
// the controls: no room at rest; the pill grows to make it when it is pointed at (pill.css)
function ctlHTML(n) {
  const s = st.s, b = [];
  b.push(`<button class="ib" data-act="toggle" title="${s.running ? 'pause' : 'resume'}">${s.running ? ICON.pause : ICON.play}</button>`);
  b.push(`<button class="ib" data-act="skip" title="${s.pom ? 'skip to the next phase' : s.phase === 'break' ? 'end the break' : 'take a break now'}">${ICON.skip}</button>`);
  if (n > 3) {
    b.push(`<button class="ib" data-act="end" title="${st.src === 'pom' ? 'reset the timer' : 'end the session'}">${ICON.stop}</button>`);
    b.push(`<button class="ib${st.src === 'link' ? ' on' : ''}" data-act="panel" title="${st.src === 'link' ? 'linked to ' + st.app : 'link to TUTOR or GRIND'}">${ICON.link}</button>`);
  }
  b.push(`<button class="ib" data-act="panel" title="more">${ICON.more}</button>`);
  return `<span class="ctl">${b.join('')}</span>`;
}
function runHTML() {
  const v = cur(), size = st.cfg.size;
  const ph = '<span class="ph"><i></i><b id="ph"></b></span>', tm = '<span class="tm" id="tm"></span>';
  if (size === 's')
    return `<span class="ph"><i></i></span>${tm}${barsHTML(v)}<span class="end"><span class="info">${vizHTML()}</span></span>${ctlHTML(3)}`;
  const tag = `<span class="tag${st.src === 'open' && st.name && size === 'm' ? ' named' : ''}">${esc(tagText())}</span>`;
  if (size === 'm')
    return `${tag}${ph}${tm}${barsHTML(v)}<span class="trk" id="trk"></span>
      <span class="end"><span class="info"><span class="sub" id="sub"></span></span></span>${vizHTML()}${ctlHTML(5)}`;
  const nm = st.src === 'open' && st.name ? `<span class="nm">${esc(st.name)}</span>` : '';
  return `${vizHTML()}<span class="col"><span class="r1">${tag}${nm}${ph}</span><span class="r2">${tm}<span class="sub" id="sub"></span></span></span>
    ${barsHTML(v)}<span class="trk" id="trk"></span>
    <span class="end"><span class="info"><span class="song"><b id="sg-t"></b><span id="sg-b"></span></span></span></span>${ctlHTML(5)}`;
}
function idleHTML() {
  if (st.cfg.idle === 'dot') return MARK;
  const linkIdle = st.src === 'link';
  // the mark already says FLOW: a word only when it says more (what plays, which app is linked)
  const m = st.music, label = linkIdle ? `${st.app} · linked` : m && m.playing && m.title ? m.title : '';
  return `${MARK}<span class="lbl${linkIdle ? '' : ' t'}" id="lbl">${esc(label)}</span><span class="trk" id="trk"></span>
    <button class="go${linkIdle ? ' k' : ''}" data-act="${linkIdle ? 'toggle' : 'panel'}">start</button>${vizHTML()}`;
}

function applyTheme() {
  const r = document.documentElement.style, t = st.theme;
  if (t) {
    for (const k of ['bg', 'fg', 'fg2', 'mu', 's1', 's2', 's3', 'bd', 'bd2']) if (t[k]) r.setProperty('--' + k, t[k]);
    if (t.c) t.c.forEach((c, i) => r.setProperty('--c' + (i + 1), c));
    if (t.mu2) r.setProperty('--mu2', t.mu2);
  }
  const [k1, k2, k3] = st.k;
  r.setProperty('--k1', k1); r.setProperty('--k2', k2); r.setProperty('--k3', k3);
  r.setProperty('--ink1', ink(k1)); r.setProperty('--ink3', ink(k3));
  r.setProperty('--op', st.cfg.opacity);
  const b = document.body.classList, motion = t && t.motion || 'full';
  for (const z of ['s', 'm', 'l']) b.toggle('sz-' + z, st.cfg.size === z);
  b.toggle('through', st.cfg.through);
  b.toggle('still', motion === 'still'); b.toggle('calm', motion === 'calm');
}

function render() {
  if (!st) return;
  applyTheme();
  const s = st.s, idle = !s, dot = idle && st.cfg.idle === 'dot';
  const m = st.music, v = s && cur();
  const key = [st.cfg.size, st.cfg.viz, st.src, st.app, idle, dot, s && s.phase, s && s.running, s && s.pom, v && v.nx, tagText(), st.name,
               idle && m && m.playing ? m.title : ''].join('|');
  if (key !== shapeKey) {
    shapeKey = key;
    inner.innerHTML = idle ? idleHTML() : runHTML();
    vizEls = [...inner.querySelectorAll('.viz i')];
  }
  pill.classList.toggle('idle', idle);
  pill.classList.toggle('run', !idle);
  pill.classList.toggle('dot', dot);
  pill.classList.toggle('break', !!s && s.phase === 'break');
  pill.classList.toggle('paused', !!s && !s.running);
  tick();
  renderPanel();
}

/* the text, the bars and the panel's live numbers, four times a second */
function setText(id, t) { const e = $(id); if (e && e.textContent !== t) e.textContent = t; }
function tick() {
  if (st) {
    const s = st.s, v = cur();
    if (s && v) {
      setText('ph', phaseWord(s));
      const tm = $('tm');
      if (tm) {
        const h = s.pom ? clock(v.left) : st.cfg.size === 's' || !s.goal ? clock(v.focus) : `${clock(v.focus)}<small> / ${clock(s.goal)}</small>`;
        if (tm.innerHTML !== h) tm.innerHTML = h;
      }
      const g = $('bg'); if (g) g.style.width = (v.goalP * 100).toFixed(1) + '%';
      const n = $('bn'); if (n && v.nextP != null) n.style.width = (v.nextP * 100).toFixed(1) + '%';
      setText('sub', v.sub);
    }
    const mu = music();
    setText('trk', st.music && st.music.title ? `♪ ${mu.t}${mu.b ? ' — ' + mu.b : ''}` : '♪ nothing playing');
    setText('sg-t', mu.t); setText('sg-b', mu.b);
    const viz = $('viz');
    if (viz) { viz.title = st.music && st.music.title ? (st.music.playing ? 'pause ' : 'play ') + mu.t : 'nothing playing'; viz.classList.toggle('rest', !(st.music && st.music.playing)); }
    if (st.panel && panelMode() !== 'timers') panelLive(v);
  }
  tickDock();
}
setInterval(tick, 250);

/* ── the music bars: main relays FLOW's analyser, four bands, ~30 a second ── */
P.on('pill:viz', v => {
  if (!vizEls.length || !Array.isArray(v)) return;
  for (let i = 0; i < 4; i++) vizEls[i].style.transform = `scaleY(${(.16 + Math.max(0, Math.min(100, v[i] || 0)) / 100 * .84).toFixed(3)})`;
});

/* ── moments ── */
function play(m) {
  clearTimeout(fxT);
  pill.classList.remove('banging');
  fxEl.innerHTML = '';
  void pill.offsetWidth;   // restarts the animations
  let ms = 2950;
  if (m.kind === 'bang') {
    fxEl.innerHTML = '<span class="bang">!</span>' + [1, 2, 3, 4, 5, 6].map(i => `<i class="sh s${i}"></i>`).join('');
    pill.classList.add('banging'); ms = 1150;
  } else if (m.kind === 'note') {
    fxEl.innerHTML = `<span class="note">${esc(m.text)}</span>`; ms = 2650;
  } else {
    const [k1, k2, k3] = st ? st.k : ['#FF4F2E', '#FFC23D', '#14B8A0'];
    const col = m.kind === 'break' ? k3 : m.kind === 'goal' ? k2 : k1;
    const text = m.kind === 'break' ? `break <small>${clock(m.total || 0)}</small>` : m.kind === 'goal' ? `goal <small>${hm((m.goal || 0) / 60)}</small>` : 'back to it';
    fxEl.innerHTML = `<span class="wipe" style="--mk:${col};--mink:${ink(col)}"><i class="o"></i>${text}<i></i></span>`;
  }
  fxT = setTimeout(() => { fxEl.innerHTML = ''; pill.classList.remove('banging'); }, ms);
}
P.on('pill:fx', play);

/* ── the timers docked beside the pill ── */
const docked = () => !!(ts && ts.docked && ts.list.length);
const leftOf = (t, now = Date.now()) => t.done ? 0 : t.running && t.endAt ? Math.max(0, t.endAt - now) : t.left;
function tClock(ms) { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return h ? `${h}:${p2(m)}:${p2(r)}` : `${m}:${p2(r)}`; }
let asking = null, askT = null;
function capHTML(t) {
  if (asking === t.id)
    return `<span class="tg">${esc(t.name)}</span><span class="tq">reset?</span><button class="ib" data-t="reset-yes" title="reset to ${tClock(t.total)}">${ICON.check}</button><button class="ib" data-t="reset-no" title="keep it">${ICON.x}</button>`;
  return `<span class="tg" title="${esc(t.name)}">${esc(t.name)}</span><span class="tt"></span><span class="tb"><b></b></span>
    <span class="tx"><button class="ib" data-t="edit" title="edit">${ICON.edit}</button>
    <button class="ib" data-t="toggle" title="${t.done ? 'dismiss' : t.running ? 'pause' : 'resume'}">${t.done ? ICON.check : t.running ? ICON.pause : ICON.play}</button>
    <button class="ib" data-t="reset" title="${t.done ? 'start it again' : 'reset'}">${ICON.reset}</button></span>`;
}
function renderDock() {
  const on = docked();
  group.classList.toggle('docked', !!(ts && ts.docked));
  const key = on ? ts.list.map(t => [t.id, t.name, t.color, t.running, t.done, asking === t.id].join(',')).join('|') : '';
  if (key !== tdKey) {
    tdKey = key;
    tdock.innerHTML = on ? ts.list.map(t => `<div class="tc${t.done ? ' done' : !t.running ? ' paused' : ''}${asking === t.id ? ' ask' : ''}" data-id="${t.id}"
      style="--tc:${t.color};--tink:${ink(t.color)}">${capHTML(t)}</div>`).join('') : '';
  }
  tickDock();
  requestAnimationFrame(reportDock);
}
function tickDock() {
  if (!docked()) return;
  const now = Date.now(), byId = new Map(ts.list.map(t => [t.id, t]));
  for (const el of tdock.children) {
    const t = byId.get(el.dataset.id); if (!t) continue;
    const tt = el.querySelector('.tt'), b = el.querySelector('.tb b'), left = leftOf(t, now);
    if (tt) { const txt = t.done ? 'done' : tClock(left); if (tt.textContent !== txt) tt.textContent = txt; }
    if (b) b.style.width = ((t.done ? 1 : Math.min(1, Math.max(0, 1 - left / t.total))) * 100).toFixed(1) + '%';
  }
}
// main places the group by its width at rest: the capsules without what opens on hover, in the layout's pixels
function reportDock() {
  if (!lay) return;
  let w = 0;
  if (docked()) {
    if (group.matches(':hover') || tdock.querySelector('.pulling')) return;   // something is open: asked again on leave
    const k = lay.w / (pill.getBoundingClientRect().width || lay.w);
    w = Math.round(tdock.getBoundingClientRect().width * k);
  }
  P.ui({ cmd: 'tdock', w });
}
new ResizeObserver(() => reportDock()).observe(tdock);
group.addEventListener('mouseleave', () => setTimeout(reportDock, 450));
function tAct(b) {
  const el = b.closest('.tc'), id = el && el.dataset.id, t = ts && ts.list.find(x => x.id === id);
  if (!t) return;
  switch (b.dataset.t) {
    case 'edit': openTimers(id); break;
    case 'toggle': P.tcmd({ cmd: t.done ? 'dismiss' : 'toggle', id }); break;
    case 'reset':
      asking = id; clearTimeout(askT);
      askT = setTimeout(() => { if (asking === id) { asking = null; renderDock(); } }, 5000);   // not answered: nothing happens
      renderDock(); break;
    case 'reset-yes': asking = null; P.tcmd({ cmd: 'reset', id }); renderDock(); break;
    case 'reset-no': asking = null; renderDock(); break;
  }
}
function openTimers(editId) { tEdit = editId || null; P.ui({ cmd: 'panel', open: true, mode: 'timers' }); }
P.on('pill:timers', s => { ts = s; renderDock(); if (tui) tui.set(s); });
P.on('pill:hint', on => pill.classList.toggle('hinting', !!on));
P.on('pill:focus', () => { if (tui) setTimeout(() => tui.focus(), 80); });
// closing: it plays out before main shrinks the window back around the pill
P.on('pill:panel', m => { if (m === 'out' && !panelEl.hidden) panelEl.classList.add('out'); });

/* ── the panel ── */
function panelMode() { return !st || !st.panel ? null : st.panel === 'timers' ? 'timers' : st.src === 'link' ? 'link' : st.src === 'open' ? 'open' : 'start'; }
const stepVal = (k, v) => k === 'goalMin' ? hm(v).replace(' min', 'm') : k === 'breakEvery' && !v ? 'never' : v + 'm';
const appBtn = (a, act, label) => `<button class="btn app" style="--a:${APP_COL[a] || 'var(--fg2)'}" data-act="${act}" data-app="${a}">${esc(label || a)}</button>`;
const headHTML = t => `<div class="p-head"><span class="eyebrow">${t}</span><button class="x" data-act="close" title="close (Esc)">${ICON.x}</button></div>`;
function panelHTML(mode) {
  const head = headHTML;
  if (mode === 'start') {
    const c = st.cfg;
    draft = { goalMin: c.goalMin, breakEvery: c.breakEvery, breakMin: c.breakMin };
    const seen = new Set(), chips = [];
    if (st.intention) { seen.add(st.intention.toLowerCase()); chips.push(`<button class="chip it" data-act="chip" data-name="${esc(st.intention)}" title="FLOW's focus line">${esc(st.intention)}</button>`); }
    for (const n of st.names) if (!seen.has(n.name.toLowerCase())) { seen.add(n.name.toLowerCase()); chips.push(`<button class="chip" data-act="chip" data-name="${esc(n.name)}">${esc(n.name)}${n.min ? `<small>${hm(n.min)}</small>` : ''}</button>`); }
    const step = (k, label, lo, hi, d) => `<div class="step" data-k="${k}" data-min="${lo}" data-max="${hi}" data-d="${d}"><span>${label}</span><button data-s="-1" tabindex="-1">−</button><b id="st-${k}">${stepVal(k, draft[k])}</b><button data-s="1" tabindex="-1">+</button></div>`;
    return head(st.src === 'pom' ? 'open session · FLOW\'s timer waits underneath' : 'open session')
      + `<input class="name" id="p-name" maxlength="60" placeholder="name it — or don't" spellcheck="false" autocomplete="off">`
      + `<div class="chips">${chips.join('') || '<span class="p-note">the names you use come back here</span>'}</div>`
      + `<div class="steps">${step('goalMin', 'goal', 5, 720, 15)}${step('breakEvery', 'every', 0, 240, 5)}${step('breakMin', 'for', 1, 120, 1)}</div>`
      + `<div class="row"><button class="btn main" data-act="start">start</button><span class="grow"></span><span class="or">or link</span>${st.apps.map(a => appBtn(a, 'link')).join('')}</div>`;
  }
  if (mode === 'open') {
    return head('open session · <b id="p-ph"></b>')
      + `<input class="name" id="p-name" maxlength="60" placeholder="name this session" spellcheck="false" autocomplete="off" value="${esc(st.name)}">`
      + `<div class="big"><b id="p-focus"></b><span id="p-sub"></span></div>`
      + `<div class="row"><button class="btn" data-act="toggle" id="p-toggle"></button><button class="btn" data-act="skip" id="p-skip"></button><button class="btn" data-act="end">end</button><span class="grow"></span><button class="btn" data-act="flow">FLOW</button></div>`
      + `<div class="row"><span class="or">hand it to</span>${st.apps.map(a => appBtn(a, 'link')).join('')}<span class="p-note">its minutes go with it</span></div>`;
  }
  const u = st.under;
  return head(`<b>${esc(st.app)}</b> runs the clock`)
    + `<div class="big"><b id="p-focus"></b><span id="p-sub"></span></div>`
    + `<div class="p-note">Its session and its minutes — FLOW follows its breaks.${u ? ` Your open session <b>${esc(u.name || 'unnamed')}</b> waits underneath, paused at ${hm(u.focus / 60)}.` : ''}</div>`
    + `<div class="row"><button class="btn" data-act="toggle" id="p-toggle"></button><button class="btn" data-act="skip" id="p-skip"></button><button class="btn" data-act="end" id="p-end">end</button></div>`
    + `<div class="row">${appBtn(st.app, 'open-app', 'open ' + st.app)}<button class="btn" data-act="unlink">unlink</button><span class="grow"></span><button class="btn" data-act="flow">FLOW</button></div>`;
}
function panelLive(v) {
  const s = st.s;
  setText('p-ph', s ? phaseWord(s) : 'no session');
  if (s && v) {
    setText('p-focus', s.pom ? clock(v.left) : clock(v.focus || 0));
    setText('p-sub', s.pom ? v.sub : (s.goal ? `of ${hm(s.goal / 60)}` : '') + (v.sub ? ' · ' + v.sub : ''));
  } else { setText('p-focus', '—'); setText('p-sub', 'no session yet'); }
  setText('p-toggle', !s ? 'start' : s.running ? 'pause' : 'resume');
  setText('p-skip', s && s.phase === 'break' ? 'end break' : 'break now');
  const sk = $('p-skip'); if (sk) sk.disabled = !s;
  const en = $('p-end'); if (en) en.disabled = !s;
}
// the timers panel: the same list and field as FLOW's (timers-ui.js), as tall as it needs (main is told)
function timersPanel() {
  if (!tHost) {
    tHost = document.createElement('div');
    tHost.className = 'slot-panel';
    tui = TimersUI.create(tHost, m => P.tcmd(m));
    if (ts) tui.set(ts);
    new ResizeObserver(() => reportPanelH()).observe(tHost);
  }
  panelEl.innerHTML = headHTML('timers');
  panelEl.appendChild(tHost);
  if (ts) tui.set(ts);
  const id = tEdit; tEdit = null;
  setTimeout(() => { if (id) tui.edit(id); else tui.focus(); }, 60);
  reportPanelH();
}
function reportPanelH() {
  if (panelMode() !== 'timers' || !lay || !tHost) return;
  const k = lay.h / (pill.getBoundingClientRect().height || lay.h);
  const head = panelEl.querySelector('.p-head');
  const h = (tHost.getBoundingClientRect().height + (head ? head.getBoundingClientRect().height : 20)) * k + 13 + 12 + 9 + 2;
  P.ui({ cmd: 'panelH', h: Math.ceil(h) });
}
function renderPanel() {
  const mode = panelMode();
  const show = !!mode && !!lay && !!lay.panel;
  if (show && panelEl.hidden) panelEl.classList.remove('out');   // shown again: it pops in (pill.css)
  panelEl.hidden = !show;
  panelEl.classList.toggle('up', !!lay && lay.side === 'up');
  panelEl.classList.toggle('timers', mode === 'timers');
  if (!show) { panelKey = ''; return; }
  const b = lay.panel;
  Object.assign(panelEl.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
  const key = mode + '|' + st.app;
  if (key === panelKey) return;
  panelKey = key;
  if (mode === 'timers') { timersPanel(); return; }
  panelEl.innerHTML = panelHTML(mode);
  panelLive(cur());
  const name = $('p-name');
  if (name) {
    setTimeout(() => { name.focus(); name.setSelectionRange(name.value.length, name.value.length); }, 60);
    if (mode === 'open') name.addEventListener('input', () => { clearTimeout(renameT); renameT = setTimeout(() => P.ui({ cmd: 'rename', name: name.value }), 350); });
  }
}
panelEl.addEventListener('click', e => {
  const b = e.target.closest('.step button');
  if (!b) return;
  const st0 = b.closest('.step'), k = st0.dataset.k, d = +st0.dataset.d;
  const v = Math.max(+st0.dataset.min, Math.min(+st0.dataset.max, draft[k] + (+b.dataset.s) * d * (e.shiftKey ? 4 : 1)));
  draft[k] = v; setText('st-' + k, stepVal(k, v));
  P.ui({ cmd: 'set', k, v });
});
panelEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') { P.ui({ cmd: 'panel', open: false }); return; }
  if (e.key === 'Enter' && e.target.id === 'p-name') {
    if (panelMode() === 'start') act({ dataset: { act: 'start' } });
    else { clearTimeout(renameT); P.ui({ cmd: 'rename', name: e.target.value }); P.ui({ cmd: 'panel', open: false }); }
  }
});

/* ── what the buttons ask ── */
function act(el) {
  const a = el.dataset.act;
  switch (a) {
    case 'toggle': case 'skip': case 'end': case 'music': case 'unlink': case 'flow': P.ui({ cmd: a }); break;
    case 'panel': P.ui({ cmd: 'panel', open: !st.panel }); break;
    case 'close': P.ui({ cmd: 'panel', open: false }); break;
    case 'start': { const n = $('p-name'); P.ui({ cmd: 'start', name: n ? n.value : '', ...draft }); break; }
    case 'link': { const n = $('p-name'); if (n && panelMode() === 'open') { clearTimeout(renameT); P.ui({ cmd: 'rename', name: n.value }); } P.ui({ cmd: 'link', app: el.dataset.app }); break; }
    case 'open-app': P.ui({ cmd: 'open-app', app: el.dataset.app }); break;
    case 'chip': { const n = $('p-name'); if (n) { n.value = el.dataset.name; n.focus(); } break; }
    case 'tnew': openTimers(); break;
  }
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-t]');
  if (t && tdock.contains(t)) { tAct(t); return; }
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && !(tHost && tHost.contains(el))) act(el);
});
document.addEventListener('contextmenu', e => { e.preventDefault(); if (e.target.closest('.pill,.tc')) P.ui({ cmd: 'menu' }); });

/* ── drag the pill (main snaps it); a click without a drag opens the panel ── */
pill.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button,input')) return;
  pill.setPointerCapture(e.pointerId);
  const at = { x: e.screenX, y: e.screenY, moved: false };
  const move = ev => {
    if (!at.moved) {
      if (Math.hypot(ev.screenX - at.x, ev.screenY - at.y) < 4) return;
      at.moved = true; P.ui({ cmd: 'drag', phase: 'start', x: at.x, y: at.y });
    }
    P.ui({ cmd: 'drag', phase: 'move', x: ev.screenX, y: ev.screenY });
  };
  const up = () => {
    pill.removeEventListener('pointermove', move); pill.removeEventListener('pointerup', up); pill.removeEventListener('pointercancel', up);
    try { pill.releasePointerCapture(e.pointerId); } catch {}
    if (at.moved) P.ui({ cmd: 'drag', phase: 'end' }); else P.ui({ cmd: 'panel', open: !(st && st.panel) });
  };
  pill.addEventListener('pointermove', move); pill.addEventListener('pointerup', up); pill.addEventListener('pointercancel', up);
});
/* a docked timer: a click opens the timers panel; pulled well away from the pill, the timers get their own window
   again, where it is let go */
tdock.addEventListener('pointerdown', e => {
  const el = e.target.closest('.tc');
  if (e.button !== 0 || !el || e.target.closest('button')) return;
  el.setPointerCapture(e.pointerId);
  const at = { x: e.screenX, y: e.screenY, far: false };
  const move = ev => {
    const dx = ev.screenX - at.x, dy = ev.screenY - at.y;
    if (!at.far && Math.hypot(dx, dy) < 6) return;
    at.far = Math.hypot(dx, dy) > 36;
    el.classList.add('pulling');
    el.style.transform = `translate(${dx / (lay ? lay.z : 1)}px,${dy / (lay ? lay.z : 1)}px)`;
  };
  const up = ev => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    try { el.releasePointerCapture(e.pointerId); } catch {}
    const pulled = el.classList.contains('pulling');
    el.classList.remove('pulling'); el.style.transform = '';
    if (at.far && ev.type === 'pointerup') P.ui({ cmd: 'undock', x: ev.screenX, y: ev.screenY });
    else if (!pulled) openTimers();
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
});

/* ── over the pill, a docked timer or the panel, or not: main lets clicks through everywhere else ── */
function setHit(on) { if (on !== hitOn) { hitOn = on; P.ui({ cmd: 'hit', on }); } }
// the group counts as a whole: the gap between the pill and the "+" kept letting clicks through, and the "+" folded away
document.addEventListener('mousemove', e => setHit(!!e.target.closest('.pill,.panel,.tc,.tplus,.group')));
document.addEventListener('mouseout', e => { if (!e.relatedTarget) setHit(false); });
document.addEventListener('mouseleave', () => setHit(false));

P.on('pill:state', s => { st = s; render(); fitParts(); });
/* what fits: as a size gets narrower (its own width, settings) it gives up its least important
   parts first; read off the width at rest, so pointing at it (it grows) never moves them */
const FIT = {
  s: [[200, 'no-viz'], [165, 'no-bars']],
  m: [[580, 'no-sub'], [500, 'no-ph'], [430, 'no-tag'], [370, 'no-viz'], [330, 'no-bars']],
  l: [[600, 'no-song'], [520, 'no-nm'], [450, 'no-bars'], [390, 'no-viz']],
};
const FIT_ALL = ['no-viz', 'no-bars', 'no-sub', 'no-ph', 'no-tag', 'no-song', 'no-nm', 'l-flat'];
function fitParts() {
  if (!lay || !st) return;
  const size = st.cfg.size, b = document.body.classList, on = new Set();
  for (const [w, c] of FIT[size] || []) if (lay.w < w) on.add(c);
  if (size === 'l' && lay.h < 38) on.add('l-flat');   // too low for two lines: one
  for (const c of FIT_ALL) b.toggle(c, on.has(c));
}
P.on('pill:layout', l => {
  lay = l;
  const r = document.documentElement.style;
  r.zoom = l.z;
  r.setProperty('--gx', l.gx + 'px'); r.setProperty('--gr', l.gr + 'px'); r.setProperty('--gy', l.gy + 'px');
  r.setProperty('--w', l.w + 'px'); r.setProperty('--h', l.h + 'px'); r.setProperty('--pad', l.pad + 'px');
  document.body.classList.toggle('grow-left', l.grow === 'left');
  document.body.classList.toggle('grow-right', l.grow !== 'left');
  renderPanel();
  fitParts();
  requestAnimationFrame(reportDock);
});
P.on('pill:ctrl', on => document.body.classList.toggle('ctrl', !!on));
P.on('pill:drag', d => { pill.classList.toggle('dragging', !!d); pill.classList.toggle('snapped', !!(d && d.snapped)); });
P.ui({ cmd: 'ready' });
