/* FLOW · the timer overlay (ring.html): main (timers-main.js) opens it over
   the screen the mouse is on and sends each timer that ends. Pops play one
   after the other; with "keep it on screen" each leaves a banner that stays
   until it is answered here or the timer is dealt with anywhere else. Clicks
   pass through everything but the banners; once nothing is left the page
   says so and main closes the window. */
'use strict';

const R = window.timersAPI;
const stage = document.getElementById('stage'), cardsEl = document.getElementById('cards');
const cards = new Map();   // timer id → banner
let st = null, queue = [], playing = false, seen = false, hitOn = false;

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ink(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return .299 * (n >> 16 & 255) + .587 * (n >> 8 & 255) + .114 * (n & 255) > 150 ? '#0b0b0c' : '#F2EDE3';
}
function human(ms) {
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : m ? (r ? `${m}m ${r}s` : `${m}m`) : `${r}s`;
}
const motion = () => (st && st.theme && st.theme.motion) || 'full';

function applyTheme() {
  const r = document.documentElement.style, t = st && st.theme;
  if (t) {
    for (const k of ['bg', 'fg', 'fg2', 's1', 'bd2']) if (t[k]) r.setProperty('--' + k, t[k]);
    if (t.c) t.c.forEach((c, i) => r.setProperty('--c' + (i + 1), c));
  }
  const cl = document.documentElement.classList;
  cl.toggle('still', motion() === 'still'); cl.toggle('calm', motion() === 'calm');
}

function pop(m) {
  const small = m.size === 'small', D = small ? 150 : Math.round(Math.min(innerWidth, innerHeight) * .34);
  const el = document.createElement('div');
  el.className = 'pop';
  el.style.setProperty('--D', D + 'px'); el.style.setProperty('--tc', m.color); el.style.setProperty('--tink', ink(m.color));
  // the shapes: FLOW's palette and the timer's colour, thrown out in every direction
  const cols = [m.color, 'var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c5)', 'var(--fg)'], kinds = ['o', 'r', 't', 'b', 'ring', 'o'];
  const n = motion() === 'calm' ? 8 : small ? 10 : 18;
  let sh = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (Math.random() - .5) * .5, d = D * (small ? 1.1 : .9) * (1 + Math.random() * 1.5);
    const s = Math.round(D * (.05 + Math.random() * .07));
    sh += `<i class="sh ${kinds[i % kinds.length]}" style="--s:${s}px;--k:${cols[i % cols.length]};--tx:${Math.round(Math.cos(a) * d)}px;--ty:${Math.round(Math.sin(a) * d * .8)}px;--r:${Math.round((Math.random() - .5) * 540)}deg;--dl:${(.06 + Math.random() * .12).toFixed(2)}s"></i>`;
  }
  el.innerHTML = `<i class="wave"></i><i class="wave w2"></i>${sh}<div class="disc"><span>!</span></div>
    <div class="tag"><b>${esc(m.name)}</b><span>done · ${human(m.total)}</span></div>`;
  stage.appendChild(el);
  // the next one starts as this one leaves; a kept one drops its banner in then
  setTimeout(() => { if (m.stay) addCard(m); playing = false; next(); }, 2150);
  setTimeout(() => { el.remove(); idle(); }, 2800);
}
function next() {
  if (playing || !queue.length) return;
  playing = true; seen = true;
  pop(queue.shift());
}

function addCard(m) {
  const t = st && st.list.find(x => x.id === m.id);
  if (cards.has(m.id) || !t || !t.done) return;
  const el = document.createElement('div');
  el.className = 'card'; el.dataset.id = m.id;
  el.style.setProperty('--tc', t.color); el.style.setProperty('--tink', ink(t.color));
  el.innerHTML = `<i>!</i><span class="txt"><b>${esc(t.name)}</b><small>done · ${human(t.total)}</small></span>
    <button data-c="snooze" title="5 more minutes">+5 min</button><button data-c="reset" title="the same again">again</button><button class="ok" data-c="dismiss">ok</button>`;
  cardsEl.appendChild(el);
  cards.set(m.id, el);
}
function dropCard(id) {
  const el = cards.get(id); if (!el) return;
  cards.delete(id);
  el.classList.add('go');
  setTimeout(() => { el.remove(); setHit(false); idle(); }, motion() === 'still' ? 0 : 330);
}
cardsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-c]'), card = b && b.closest('.card');
  if (card) R.cmd({ cmd: b.dataset.c, id: card.dataset.id });
});
function idle() { if (seen && !playing && !queue.length && !stage.children.length && !cards.size) R.ui({ cmd: 'idle' }); }

function setHit(on) { if (on !== hitOn) { hitOn = on; R.ui({ cmd: 'hit', on }); } }
document.addEventListener('mousemove', e => setHit(!!e.target.closest('.card')));
document.addEventListener('mouseout', e => { if (!e.relatedTarget) setHit(false); });

R.on('timers:state', s => {
  st = s; applyTheme();
  // dealt with elsewhere (dismissed, reset, more time): its banner goes
  for (const id of [...cards.keys()]) { const t = s.list.find(x => x.id === id); if (!t || !t.done) dropCard(id); }
});
R.on('timers:ring', m => { queue.push(m); next(); });
