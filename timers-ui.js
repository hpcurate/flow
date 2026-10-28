/* FLOW · timers — the list and the new-timer field, the same in FLOW's window
   (docked in every view) and in the pop-out (timers.html). main
   (timers-main.js) keeps the timers; this draws them, counts down from their
   end time between updates and sends back what is asked. A row is rebuilt
   only when its shape changes (name, colour, paused, ended, being edited…),
   so a button under the pointer stays put. Reset asks first, in the row.
   The field takes "laundry 2h" on its own, or a name and a length; as you
   type it offers the names used before, each with its colour and length.
   A timer that dings every so often wears a small bell; each ding pops a bubble over it for a
   few seconds ("laundry · 1h 20m left"). */
(() => {
'use strict';

const SVG = d => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  edit: SVG('<path d="M10.2 3.3l2.5 2.5L6.3 12.2H3.8V9.7z"/>'),
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><rect x="4" y="3.2" width="2.8" height="9.6" rx="1" fill="currentColor"/><rect x="9.2" y="3.2" width="2.8" height="9.6" rx="1" fill="currentColor"/></svg>',
  reset: SVG('<path d="M3.4 8.2a4.6 4.6 0 1 0 1.5-3.5"/><path d="M3.4 2.6v2.8h2.8"/>'),
  check: SVG('<path d="M3.5 8.4l3 3 6-7"/>'),
  plus: SVG('<path d="M8 3.5v9M3.5 8h9"/>'),
  out: SVG('<path d="M9.5 2.8h3.7v3.7"/><path d="M13.2 2.8L8.2 7.8"/><path d="M11.4 9.6v2.6a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1V5.6a1 1 0 0 1 1-1h2.6"/>'),
  in: SVG('<path d="M13.2 2.8l-5 5"/><path d="M8.2 4.4v3.4h3.4"/><path d="M11.4 9.6v2.6a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1V5.6a1 1 0 0 1 1-1h2.6"/>'),
  bell: SVG('<path d="M4.4 11.2V7.6a3.6 3.6 0 0 1 7.2 0v3.6l1 1.2H3.4z"/><path d="M6.8 13.6a1.3 1.3 0 0 0 2.4 0"/>'),
};
const MAX = 100 * 3600e3;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const p2 = n => String(n).padStart(2, '0');
// 1.7.0 (CORE 0.27.0, r261028-hr3y): each colour's own ink, of its own hue and readable on it (ink.js, CORE's)
function ink(hex) { return Ink.on(hex); }

/* ── lengths: 25m · 2h · 1h30 · 1h 30m · 90 (minutes) · 1:30 (1h30) · 45s ── */
const UNIT = { h: 3600, m: 60, s: 1 };
const ok = ms => ms >= 1000 && ms <= MAX ? Math.round(ms) : null;
function parseDur(str) {
  const s = String(str || '').trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
  if (!s) return null;
  const c = s.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (c) return ok((+c[1] * 3600 + +c[2] * 60 + +(c[3] || 0)) * 1000);
  if (/^\d+(\.\d+)?$/.test(s)) return ok(+s * 60e3);
  const re = /(\d+(?:\.\d+)?)(hours?|hrs?|h|minutes?|mins?|mn|m|seconds?|secs?|s)?/y;
  let sec = 0, last = '';
  re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    const t = re.exec(s);
    if (!t) return null;
    // "1h30": a bare number after hours is minutes, after minutes seconds
    const u = t[2] ? t[2][0] : last === 'h' ? 'm' : last === 'm' ? 's' : '';
    if (!u || (t[2] == null && re.lastIndex < s.length)) return null;
    sec += +t[1] * UNIT[u]; last = u;
  }
  return ok(sec * 1000);
}
// "laundry 2h" → { name: 'laundry', dur: 7200000 } (also "tea 3m 30s", "pasta 10", "bread 1:15");
// a name with no length at its end keeps it all
const TAIL = /^(.*?)\s*((?:\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|mn|m|seconds?|secs?|s)\s*)+\d*|\d{1,3}:\d{1,2}(?::\d{1,2})?|\d{1,3})$/i;
function splitName(str) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  const m = s.match(TAIL);
  if (m && (!m[1] || s.charAt(m[1].length) === ' ')) {
    const dur = parseDur(m[2]);
    if (dur) return { name: m[1], dur };
  }
  return { name: s, dur: null };
}
// 1:42:10 · 4:05 · 0:09 (seconds rounded up, so a timer never shows 0:00 while it runs)
function fmtLeft(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return h ? `${h}:${p2(m)}:${p2(r)}` : `${m}:${p2(r)}`;
}
// 2h · 1h 30m · 25m · 1m 30s · 45s
function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return r ? `${m}m ${r}s` : `${m}m`;
  return `${r}s`;
}

function create(root, send) {
  root.classList.add('tm-dock');
  // the head (a card's title) shows only where the dock is a card; the field is a "+" until the timers are pointed at
  root.innerHTML = `<div class="tm-head"><span class="tm-eyebrow">Timers</span><span class="tm-count"></span></div><div class="tm-list"></div>
    <div class="tm-new">
      <div class="tm-add">
        <span class="tm-plus" aria-hidden="true">${ICON.plus}</span>
        <button class="tm-dot" data-tm="dot" tabindex="-1" title="colour"></button>
        <input class="tm-name" maxlength="48" placeholder="new timer · laundry 2h" spellcheck="false" autocomplete="off" aria-label="New timer">
        <input class="tm-dur" maxlength="14" placeholder="25m" spellcheck="false" autocomplete="off" aria-label="How long" title="how long: 25m · 1h30 · 2h · 1:30 · 90">
        <button class="tm-ib tm-go" data-tm="add" title="start it (Enter)">${ICON.plus}</button>
        <button class="tm-ib tm-popb" data-tm="pop"></button>
      </div>
      <div class="tm-drop" hidden></div>
    </div>`;
  const countEl = root.querySelector('.tm-count'), listEl = root.querySelector('.tm-list'), addEl = root.querySelector('.tm-add'), dropEl = root.querySelector('.tm-drop');
  const nameEl = root.querySelector('.tm-name'), durEl = root.querySelector('.tm-dur'), dotEl = root.querySelector('.tm-dot'), popEl = root.querySelector('.tm-popb');
  const rows = new Map();     // id → { el, key, t }
  let st = null, editing = null, editColor = null, asking = null, askT = null;
  let color = null, colorSet = false, durAuto = '', sugs = [], sugIdx = -1, dropOpen = false;

  const shape = t => [t.name, t.color, t.running, t.done, t.every, editing === t.id, asking === t.id].join('|');
  const known = name => { const k = String(name || '').trim().toLowerCase(); return k && st ? st.names.find(n => n.name.toLowerCase() === k) : null; };
  // what the field says: a name used before as typed ("Episode 3"), else a name and a length at its end
  function parts() {
    const full = nameEl.value.replace(/\s+/g, ' ').trim();
    return known(full) ? { name: full, dur: null } : splitName(full);
  }
  const swatches = cur => (st ? st.colors : []).map(c =>
    `<button class="tm-s${String(cur).toLowerCase() === c.toLowerCase() ? ' on' : ''}" data-tm="sw" data-c="${c}" style="--sc:${c}" tabindex="-1" title="${c}"></button>`).join('');

  function build(r) {
    const t = r.t, el = r.el;
    el.className = 'tm-row' + (t.done ? ' done' : !t.running ? ' paused' : '');
    el.dataset.id = t.id;
    const tc = editing === t.id && editColor ? editColor : t.color;
    el.style.setProperty('--tc', tc); el.style.setProperty('--tink', ink(tc));
    if (editing === t.id) {
      el.classList.add('editing');
      const left = t.done ? '' : fmtDur(leftNow(t)), every = t.every ? fmtDur(t.every) : '';
      el.innerHTML = `<div class="tm-ed"><input class="tm-in tm-e-name" maxlength="40" value="${esc(t.name)}" spellcheck="false" autocomplete="off" aria-label="Name">
          <input class="tm-in tm-e-left" maxlength="14" value="${esc(left)}" data-was="${esc(left)}" placeholder="${t.done ? 'again for…' : 'time left'}" spellcheck="false" autocomplete="off" aria-label="Time left" title="time left: 25m · 1h30 · 1:30">
          <input class="tm-in tm-e-every" maxlength="14" value="${esc(every)}" data-was="${esc(every)}" placeholder="ding every…" spellcheck="false" autocomplete="off" aria-label="Ding every" title="a ding and a bubble every so often while it runs: 30s · 5m · 1h — empty = never"></div>
        <div class="tm-sw">${swatches(tc)}</div>
        <div class="tm-e-row"><button class="tm-btn prime" data-tm="save">save</button><button class="tm-btn" data-tm="cancel">cancel</button><span class="tm-grow"></span><button class="tm-btn bad" data-tm="remove">remove</button></div>`;
      return;
    }
    if (asking === t.id) {
      el.classList.add('asking');
      el.innerHTML = `<span class="tm-ask">reset <b>${esc(t.name)}</b> to ${fmtLeft(t.total)}?</span>
        <button class="tm-yes" data-tm="reset-yes">reset</button><button class="tm-no" data-tm="reset-no">keep</button>`;
      return;
    }
    el.innerHTML = `<span class="tm-tag" title="${esc(t.name)}${t.every ? ' · dings every ' + fmtDur(t.every) : ''}">${esc(t.name)}</span>${t.every ? `<span class="tm-bell" title="dings every ${fmtDur(t.every)}">${ICON.bell}</span>` : ''}<span class="tm-bar"><b></b></span><span class="tm-left"></span>
      <span class="tm-btns"><button class="tm-ib" data-tm="edit" title="edit">${ICON.edit}</button>
      <button class="tm-ib" data-tm="toggle" title="${t.done ? 'dismiss' : t.running ? 'pause' : 'resume'}">${t.done ? ICON.check : t.running ? ICON.pause : ICON.play}</button>
      <button class="tm-ib" data-tm="reset" title="${t.done ? 'start it again' : 'reset'}">${ICON.reset}</button></span>`;
  }
  function rebuild(id) { const r = rows.get(id); if (r) { r.key = shape(r.t); build(r); } tick(); }
  const leftNow = (t, now = Date.now()) => t.done ? 0 : t.running && t.endAt ? Math.max(0, t.endAt - now) : t.left;

  function set(s) {
    st = s;
    root.classList.toggle('tm-empty', !s.list.length);
    countEl.textContent = s.list.length || '';
    root.classList.toggle('no-left', !s.cfg.showLeft);
    root.classList.toggle('tm-caps', !!s.cfg.caps);   // 1.7.0: CORE's "names in capitals"
    const seen = new Set();
    let prev = null;
    for (const t of s.list) {
      seen.add(t.id);
      let r = rows.get(t.id);
      if (!r) { r = { el: document.createElement('div'), key: '' }; rows.set(t.id, r); }
      r.t = t;
      const k = shape(t);
      if (r.key !== k) { r.key = k; build(r); }
      const want = prev ? prev.nextSibling : listEl.firstChild;
      if (r.el !== want) listEl.insertBefore(r.el, want);
      prev = r.el;
    }
    for (const [id, r] of rows) if (!seen.has(id)) {
      r.el.remove(); rows.delete(id);
      if (editing === id) editing = null;
      if (asking === id) asking = null;
    }
    if (!colorSet) color = known(parts().name)?.color || s.next;
    paintAdd();
    if (dropOpen) renderDrop();
    tick();
  }
  function paintAdd() {
    dotEl.style.setProperty('--tc', color || '#FF4F2E');
    const popped = !!(st && st.popped);
    popEl.innerHTML = popped ? ICON.in : ICON.out;
    popEl.title = popped ? 'back into FLOW' : 'pop the timers out';
    const k = known(parts().name);
    durEl.placeholder = k ? fmtDur(k.dur) : '25m';
  }

  /* the time and the bars, four times a second */
  function tick() {
    if (!st) return;
    const now = Date.now(), drain = st.cfg.bar === 'drain';
    for (const r of rows.values()) {
      const t = r.t, el = r.el;
      if (el.classList.contains('editing') || el.classList.contains('asking')) continue;
      const left = leftNow(t, now), p = t.done ? 1 : Math.min(1, Math.max(0, 1 - left / t.total));
      const b = el.querySelector('.tm-bar b');
      if (b) { const w = ((drain ? 1 - p : p) * 100).toFixed(2) + '%'; if (b.style.width !== w) b.style.width = w; }
      const l = el.querySelector('.tm-left');
      if (l) {
        const ago = t.done ? Math.floor((now - t.doneAt) / 60e3) : 0;
        const txt = t.done ? (ago ? `done · ${ago}m` : 'done') : fmtLeft(left);
        if (l.textContent !== txt) l.textContent = txt;
      }
    }
  }
  setInterval(tick, 250);

  /* ── the new-timer field and what drops under it: the names used before,
     the quick lengths, the colours ── */
  function openDrop() { if (!dropOpen) { dropOpen = true; dropEl.hidden = false; root.classList.add('adding'); } renderDrop(); }
  function closeDrop() { if (!dropOpen) return; dropOpen = false; dropEl.hidden = true; sugIdx = -1; root.classList.remove('adding'); }
  function renderDrop() {
    if (!st) return;
    const q = parts().name.toLowerCase();
    sugs = st.names.filter(n => !q || n.name.toLowerCase().includes(q))
      .sort((a, b) => (b.name.toLowerCase().startsWith(q) ? 1 : 0) - (a.name.toLowerCase().startsWith(q) ? 1 : 0)).slice(0, 5);
    if (sugs.length === 1 && sugs[0].name.toLowerCase() === q) sugs = [];   // already typed in full
    if (sugIdx >= sugs.length) sugIdx = sugs.length - 1;
    const hl = n => { const i = q ? n.toLowerCase().indexOf(q) : -1; return i < 0 ? esc(n) : esc(n.slice(0, i)) + '<b>' + esc(n.slice(i, i + q.length)) + '</b>' + esc(n.slice(i + q.length)); };
    const chips = String(st.cfg.presets || '').split(/[\s,]+/).filter(x => parseDur(x)).slice(0, 8);
    dropEl.innerHTML = (sugs.length ? `<div class="tm-sugs">${sugs.map((n, i) =>
        `<button class="tm-sug${i === sugIdx ? ' on' : ''}" data-tm="sug" data-i="${i}" style="--sc:${n.color}" tabindex="-1"><i></i><span>${hl(n.name)}</span><small>${fmtDur(n.dur)}</small></button>`).join('')}</div>` : '')
      + (chips.length ? `<div class="tm-chips">${chips.map(c => `<button class="tm-chip${durEl.value.trim() === c ? ' on' : ''}" data-tm="preset" data-v="${esc(c)}" tabindex="-1">${esc(c)}</button>`).join('')}</div>` : '')
      + `<div class="tm-sw">${swatches(color)}</div>`;
  }
  function pick(i) {
    const n = sugs[i]; if (!n) return;
    nameEl.value = n.name;
    if (!durEl.value.trim() || durEl.value === durAuto) { durEl.value = durAuto = fmtDur(n.dur); }
    color = n.color; colorSet = true; sugIdx = -1;
    paintAdd(); renderDrop();
    nameEl.focus(); nameEl.setSelectionRange(nameEl.value.length, nameEl.value.length);
  }
  function flash(el) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }
  function submit() {
    let { name, dur } = parts();
    const typed = durEl.value.trim();
    let ms = typed ? parseDur(typed) : dur;
    const k = known(name);
    if (ms == null && !typed && k) ms = k.dur;
    if (ms == null) { flash(durEl); durEl.focus(); return false; }
    send({ cmd: 'add', name: name || fmtDur(ms), color: colorSet ? color : k ? k.color : color, dur: ms });
    nameEl.value = ''; durEl.value = ''; durAuto = ''; colorSet = false; sugIdx = -1;
    nameEl.focus();
    if (dropOpen) renderDrop();
    return true;
  }
  addEl.addEventListener('keydown', e => {
    const inName = e.target === nameEl;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && dropOpen && sugs.length) {
      e.preventDefault(); e.stopPropagation();
      sugIdx = e.key === 'ArrowDown' ? Math.min(sugs.length - 1, sugIdx + 1) : Math.max(-1, sugIdx - 1);
      renderDrop(); return;
    }
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (inName && sugIdx >= 0) pick(sugIdx); else submit();
      return;
    }
    if (e.key === 'Tab' && inName && !e.shiftKey && sugs.length && nameEl.value.trim()) { e.preventDefault(); pick(sugIdx >= 0 ? sugIdx : 0); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (nameEl.value || durEl.value) { nameEl.value = durEl.value = ''; durAuto = ''; colorSet = false; color = st && st.next; paintAdd(); renderDrop(); } else e.target.blur(); }
  });
  nameEl.addEventListener('input', () => { sugIdx = -1; if (!colorSet) color = known(parts().name)?.color || (st && st.next); paintAdd(); openDrop(); });
  durEl.addEventListener('input', () => { if (dropOpen) renderDrop(); });
  for (const el of [nameEl, durEl]) el.addEventListener('focus', openDrop);
  root.querySelector('.tm-new').addEventListener('focusout', e => { if (!root.querySelector('.tm-new').contains(e.relatedTarget)) closeDrop(); });
  // FLOW left for another app: the drop closes (it opens again with the field's focus)
  window.addEventListener('blur', closeDrop);
  // clicks in the drop and on the field's buttons keep the focus in the field
  for (const el of [dropEl, dotEl, popEl, root.querySelector('.tm-go')]) el.addEventListener('mousedown', e => e.preventDefault());

  /* the edit form: Enter saves, Escape cancels */
  listEl.addEventListener('keydown', e => {
    const row = e.target.closest('.tm-row.editing'); if (!row) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(row); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; editColor = null; rebuild(row.dataset.id); }
  });
  function save(row) {
    const id = row.dataset.id, r = rows.get(id); if (!r) return;
    const name = row.querySelector('.tm-e-name').value.trim(), li = row.querySelector('.tm-e-left');
    const m = { cmd: 'edit', id };
    if (name && name !== r.t.name) m.name = name;
    if (editColor && editColor !== r.t.color) m.color = editColor;
    if (li.value.trim() !== li.dataset.was) {
      const ms = parseDur(li.value);
      if (ms == null) { flash(li); li.focus(); return; }
      m.left = ms;
    }
    const ev = row.querySelector('.tm-e-every');
    if (ev && ev.value.trim() !== ev.dataset.was) {
      const v = ev.value.trim();
      if (!v || /^(off|no|none|0)$/i.test(v)) m.every = 0;
      else { const ms = parseDur(v); if (ms == null || ms < 10e3) { flash(ev); ev.focus(); return; } m.every = ms; }
    }
    editing = null; editColor = null;
    if (Object.keys(m).length > 2) send(m);
    rebuild(id);
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-tm]');
    if (!b || b.disabled || !root.contains(b)) return;
    const row = b.closest('.tm-row'), id = row && row.dataset.id, r = id && rows.get(id);
    if (row) closeDrop();   // a timer's own buttons: the new-timer drop goes (focus doesn't always say so)
    switch (b.dataset.tm) {
      case 'edit': {
        const was = editing; editing = id; editColor = null; asking = asking === id ? null : asking;
        if (was && was !== id) rebuild(was);
        rebuild(id);
        const n = row.querySelector('.tm-e-name'); if (n) { n.focus(); n.select(); }
        break;
      }
      case 'toggle': if (r) send({ cmd: r.t.done ? 'dismiss' : 'toggle', id }); break;
      case 'reset':
        asking = id; clearTimeout(askT);
        askT = setTimeout(() => { if (asking === id) { asking = null; rebuild(id); } }, 5000);   // not answered: nothing happens
        rebuild(id);
        break;
      case 'reset-yes': asking = null; send({ cmd: 'reset', id }); rebuild(id); break;
      case 'reset-no': asking = null; rebuild(id); break;
      case 'save': save(row); break;
      case 'cancel': editing = null; editColor = null; rebuild(id); break;
      case 'remove': editing = null; editColor = null; send({ cmd: 'remove', id }); break;
      case 'sw':
        if (row) {   // the edit form: shown at once, sent with save
          editColor = b.dataset.c;
          row.style.setProperty('--tc', editColor); row.style.setProperty('--tink', ink(editColor));
          row.querySelectorAll('.tm-s').forEach(s => s.classList.toggle('on', s === b));
        } else { color = b.dataset.c; colorSet = true; paintAdd(); renderDrop(); }
        break;
      case 'sug': pick(+b.dataset.i); break;
      case 'preset': durEl.value = b.dataset.v; durAuto = ''; renderDrop(); nameEl.focus(); break;
      case 'add': submit(); break;
      case 'pop': send({ cmd: 'pop' }); break;
      case 'dot': nameEl.focus(); break;
    }
  });

  // a ding: a bubble over the timer for a few seconds, the row gives a little jump
  function ding(m) {
    const r = rows.get(m.id);
    if (!r || r.el.classList.contains('editing') || r.el.classList.contains('asking')) return;
    const old = r.el.querySelector('.tm-bub'); if (old) old.remove();
    const b = document.createElement('span');
    b.className = 'tm-bub';
    b.innerHTML = `${ICON.bell}<b>${esc(r.t.name)}</b><span>${fmtDur(m.left)} left</span>`;
    r.el.appendChild(b);
    r.el.classList.remove('dinged'); void r.el.offsetWidth; r.el.classList.add('dinged');
    setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 320); }, 4200);
  }

  return {
    el: root, set, tick, ding,
    focus() { nameEl.focus(); openDrop(); },
    // the edit form for one timer (the pill's panel opens on it)
    edit(id) {
      const r = rows.get(id); if (!r) return;
      editing = id; editColor = null; asking = null; rebuild(id);
      const n = r.el.querySelector('.tm-e-name'); if (n) { n.focus(); n.select(); }
    },
    busy: () => !!editing || !!asking || root.contains(document.activeElement),
  };
}

window.TimersUI = { create, parseDur, splitName, fmtDur, fmtLeft, ink };
})();
