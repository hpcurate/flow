/* FLOW · the timers' pop-out (timers.html): the rows on their own, on top of
   everything. main (timers-main.js) sizes the window to what this reports,
   moves it as it is dragged, and lets clicks through wherever there is no
   capsule. */
'use strict';

const A = window.timersAPI;
const wrap = document.getElementById('wrap'), dock = document.getElementById('dock');
const ui = TimersUI.create(dock, m => A.cmd(m));
let hitOn = false;

function applyTheme(s) {
  const r = document.documentElement.style, t = s.theme;
  if (t) {
    for (const k of ['bg', 'fg', 'fg2', 'mu', 's1', 's2', 's3', 'bd', 'bd2']) if (t[k]) r.setProperty('--' + k, t[k]);
    if (t.c) t.c.forEach((c, i) => r.setProperty('--c' + (i + 1), c));
    document.documentElement.classList.toggle('still', t.motion === 'still');
  }
  r.setProperty('--op', s.cfg.popOpacity);
  for (const z of ['s', 'm', 'l']) dock.classList.toggle('size-' + z, s.cfg.popSize === z);
  // the field fades in at the end away from the edge the window grows from, so pointing at it moves nothing
  dock.classList.toggle('field-top', s.anchor !== 'top');
}
A.on('timers:state', s => { applyTheme(s); ui.set(s); });
A.on('timers:focus', () => ui.focus());
A.on('timers:ding', m => ui.ding(m));

// as tall as what it shows: main fits the window to it
new ResizeObserver(() => A.ui({ cmd: 'size', h: Math.ceil(wrap.getBoundingClientRect().height) })).observe(wrap);

// over a capsule or not: everywhere else clicks go to whatever is under the window
function setHit(on) { if (on !== hitOn) { hitOn = on; A.ui({ cmd: 'hit', on }); } }
document.addEventListener('mousemove', e => setHit(!!e.target.closest('.tm-row,.tm-new')));
document.addEventListener('mouseout', e => { if (!e.relatedTarget) setHit(false); });

// drag a capsule to move the window (its buttons and the fields stay clickable)
dock.addEventListener('pointerdown', e => {
  const row = e.target.closest('.tm-row');
  if (e.button !== 0 || !row || row.classList.contains('editing') || e.target.closest('button,input')) return;
  row.setPointerCapture(e.pointerId);
  const at = { x: e.screenX, y: e.screenY, moved: false };
  const move = ev => {
    if (!at.moved) {
      if (Math.hypot(ev.screenX - at.x, ev.screenY - at.y) < 4) return;
      at.moved = true; A.ui({ cmd: 'drag', phase: 'start', x: at.x, y: at.y });
    }
    A.ui({ cmd: 'drag', phase: 'move', x: ev.screenX, y: ev.screenY });
  };
  const up = () => {
    row.removeEventListener('pointermove', move); row.removeEventListener('pointerup', up); row.removeEventListener('pointercancel', up);
    try { row.releasePointerCapture(e.pointerId); } catch {}
    if (at.moved) A.ui({ cmd: 'drag', phase: 'end' });
  };
  row.addEventListener('pointermove', move); row.addEventListener('pointerup', up); row.addEventListener('pointercancel', up);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.activeElement) document.activeElement.blur(); });
