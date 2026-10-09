/* FLOW · visual engine
   Dark palettes, audio analysis, the canvas styles (music visualisers + timer
   visuals) and the seeded SVG cover art. app.js owns all state; everything in
   here only draws what it is handed. Exposed as window.Viz. */
(() => {
'use strict';
const TAU = Math.PI * 2;
const NB = 24;                       // analysis bands, low → high

/* ════════════ Palettes ════════════
   All dark. c = the five shape colours; focus / brk index into c. */
const PALETTES = {
  bauhaus:  { name: 'Bauhaus',  bg: '#0E0E10', fg: '#F2EDE3', c: ['#FF4F2E', '#FFC23D', '#2F62FF', '#F2EDE3', '#14B8A0'], focus: 0, brk: 4 },
  synth:    { name: 'Synth',    bg: '#0B0916', fg: '#EEEBFF', c: ['#FF3D8B', '#7C5CFF', '#22D3EE', '#C6FF3D', '#FF9F1C'], focus: 0, brk: 2 },
  ember:    { name: 'Ember',    bg: '#100B09', fg: '#F8EEE6', c: ['#FF5A36', '#FFB000', '#E0245E', '#FFD8A8', '#B23A48'], focus: 0, brk: 3 },
  abyss:    { name: 'Abyss',    bg: '#070C11', fg: '#E6F1F5', c: ['#00C2A8', '#2D7DFF', '#9BE7FF', '#F4E9CD', '#6C5CE7'], focus: 1, brk: 0 },
  acid:     { name: 'Acid',     bg: '#0A0C08', fg: '#F1F6E9', c: ['#C5F82A', '#2BD47D', '#F9F871', '#00A6A6', '#FF6B6B'], focus: 0, brk: 3 },
  orchid:   { name: 'Orchid',   bg: '#0D0913', fg: '#F4EDFA', c: ['#C77DFF', '#FF6FB5', '#FFC6E0', '#6A4CFF', '#FFD166'], focus: 0, brk: 2 },
  graphite: { name: 'Graphite', bg: '#0C0C0C', fg: '#F2F2F2', c: ['#FF3B30', '#F2F2F2', '#8E8E8E', '#5A5A5A', '#C9C9C9'], focus: 0, brk: 2 },
};
const MUSIC_STYLES = { bauhaus: 'Bauhaus', orbit: 'Orbit', monolith: 'Monolith', strata: 'Strata', burst: 'Burst', float: 'Float' };
const TIMER_STYLES = { orbit: 'Orbit', eclipse: 'Eclipse', mosaic: 'Mosaic', tide: 'Tide' };

/* ════════════ Colour ════════════ */
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const hex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = h => {
  const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
};
// text colour that reads best on a given fill
const onColour = h => { const L = lum(h); return (L + .05) / .05 >= 1.05 / (L + .05) ? '#0B0B0C' : '#FFFFFF'; };

/* depth: dark = the palette's own background · darker = halfway to black · black = #000 */
function theme(id, depth) {
  const p = PALETTES[id] || PALETTES.bauhaus;
  const bg = depth === 'black' ? '#000000' : depth === 'darker' ? mix(p.bg, '#000000', .55) : p.bg;
  const fg = p.fg, m = t => mix(bg, fg, t);
  const focus = p.c[p.focus], brk = p.c[p.brk];
  return {
    id: PALETTES[id] ? id : 'bauhaus', name: p.name, bg, fg, c: p.c.slice(), focus, brk,
    s0: m(.028), s1: m(.048), s2: m(.08), s3: m(.12), bd: m(.085), bd2: m(.16), fg2: m(.7), mu: m(.46),
    onFocus: onColour(focus), onBrk: onColour(brk), on: p.c.map(onColour),
  };
}

/* the five colours a style draws with, per colour mode */
const colCache = {};
function colours(th, mode, phase) {
  const k = th.id + th.bg + mode + phase;
  if (colCache[k]) return colCache[k];
  let c;
  if (mode === 'mono') c = [th.fg, mix(th.fg, th.bg, .3), mix(th.fg, th.bg, .55), mix(th.fg, th.bg, .15), mix(th.fg, th.bg, .7)];
  else if (mode === 'phase') {
    const p = phase === 'focus' ? th.focus : th.brk;
    c = [p, mix(p, th.fg, .45), mix(p, th.bg, .4), mix(p, th.fg, .75), mix(p, th.bg, .62)];
  } else c = th.c;
  return (colCache[k] = c);
}

/* ════════════ Seeded randomness ════════════ */
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ════════════ Audio analysis ════════════
   24 log-spaced bands with attack/release smoothing, a low-end onset detector
   (beat / pulse) and, when nothing plays, a slow metronome on `pulse` so the
   compositions keep evolving in silence. */
const A = { bands: new Float32Array(NB), level: 0, bass: 0, mid: 0, high: 0, beat: 0, pulse: 0, active: false, avg: 0, last: 0, idle: 0 };
let edges = null, edgeKey = '';
function bandEdges(rate, bins) {
  const hz = rate / 2 / bins, lo = 32, hi = Math.min(16000, rate * .45), e = new Uint16Array(NB + 1);
  for (let i = 0; i <= NB; i++) e[i] = Math.min(bins - 1, Math.max(1, Math.round(lo * (hi / lo) ** (i / NB) / hz)));
  for (let i = 1; i <= NB; i++) if (e[i] <= e[i - 1]) e[i] = Math.min(bins, e[i - 1] + 1);
  return e;
}
function analyse(an, data, rate, dt, sens, smooth, now, idleDt) {
  const raw = an && data ? data : null;
  if (raw) {
    an.getByteFrequencyData(raw);
    const key = rate + ':' + raw.length;
    if (key !== edgeKey) { edgeKey = key; edges = bandEdges(rate, raw.length); }
  }
  const atk = 1 - Math.exp(-dt * (30 - smooth * 22)), rel = 1 - Math.exp(-dt * (10 - smooth * 8.6));
  let sum = 0, low = 0, b = 0, m = 0, h = 0;
  for (let i = 0; i < NB; i++) {
    let v = 0;
    if (raw) {
      const lo = edges[i], hi = Math.max(lo + 1, edges[i + 1]);
      let s = 0, mx = 0;
      for (let j = lo; j < hi; j++) { const x = raw[j]; s += x; if (x > mx) mx = x; }
      v = (s / (hi - lo) * .55 + mx * .45) / 255;
      v = Math.max(0, (v - .12) / .88) * (.8 + i / NB * .7) * sens;
      if (v > 1) v = 1;
      if (i < 3) low += v / 3;
    }
    const c = A.bands[i];
    const n = A.bands[i] = c + (v - c) * (v > c ? atk : rel);
    sum += n; if (i < 4) b += n; else if (i < 14) m += n; else h += n;
  }
  A.level = sum / NB; A.bass = b / 4; A.mid = m / 10; A.high = h / (NB - 14);
  A.active = A.level > .02;
  A.avg += (low - A.avg) * Math.min(1, dt * 2);
  if (raw && low > A.avg * 1.3 + .05 && now - A.last > .24) { A.last = now; A.beat = 1; A.pulse++; }
  else A.beat *= Math.exp(-dt * 6);
  if (!A.active && idleDt > 0) { A.idle += idleDt; if (A.idle > 3.5) { A.idle = 0; A.pulse++; } }
  else A.idle = 0;
}

/* ════════════ Primitives ════════════ */
function disc(ctx, x, y, r, f) { if (r <= 0) return; ctx.fillStyle = f; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function shp(ctx, type, x, y, r, rot, f, stroke) {
  if (!(r > 0)) return;
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
  ctx.beginPath();
  switch (type) {
    case 'half': ctx.arc(0, -r * .42, r, 0, Math.PI); ctx.closePath(); break;
    case 'quarter': ctx.moveTo(-r * .6, -r * .6); ctx.arc(-r * .6, -r * .6, r * 1.45, 0, Math.PI / 2); ctx.closePath(); break;
    case 'square': ctx.rect(-r * .84, -r * .84, r * 1.68, r * 1.68); break;
    case 'bar': ctx.rect(-r * 1.5, -r * .36, r * 3, r * .72); break;
    case 'tri': ctx.moveTo(0, -r * 1.08); ctx.lineTo(r * .98, r * .62); ctx.lineTo(-r * .98, r * .62); ctx.closePath(); break;
    case 'ring':
      ctx.arc(0, 0, r, 0, TAU);
      if (!stroke) { ctx.moveTo(r * .56, 0); ctx.arc(0, 0, r * .56, 0, TAU, true); }
      break;
    default: ctx.arc(0, 0, r, 0, TAU);
  }
  if (stroke) { ctx.strokeStyle = f; ctx.stroke(); } else { ctx.fillStyle = f; ctx.fill(); }
  ctx.restore();
}

/* ════════════ Seeded compositions ════════════ */
const comps = {};
function composition(kind, seed, dens) {
  const key = kind + seed + ':' + dens.toFixed(2);
  if (comps[kind] && comps[kind].key === key) return comps[kind];
  const r = rng(seed * 977 + (kind === 'float' ? 31 : 7)), list = [];
  if (kind === 'bauhaus') {
    const n = Math.round(6 + dens * 12), types = ['circle', 'half', 'quarter', 'square', 'bar', 'tri', 'ring', 'circle', 'half'];
    for (let i = 0; i < n; i++) {
      const tier = i < 2 ? 0 : i < Math.max(4, n * .45) ? 1 : 2;   // giants first → drawn behind
      const anchor = tier === 0 ? (i === 0 ? [.24, .42] : [.74, .6]) : null;
      list.push({
        type: types[Math.floor(r() * types.length)],
        x: anchor ? anchor[0] + (r() - .5) * .16 : .06 + r() * .88,
        y: anchor ? anchor[1] + (r() - .5) * .3 : .08 + r() * .84,
        r: tier === 0 ? .26 + r() * .15 : tier === 1 ? .1 + r() * .09 : .035 + r() * .045,
        rot: Math.floor(r() * 4) * Math.PI / 2, ci: (i * 2 + Math.floor(r() * 3)) % 5,
        band: tier === 0 ? Math.floor(r() * 3) : tier === 1 ? 3 + Math.floor(r() * 8) : 10 + Math.floor(r() * (NB - 10)),
        gain: tier === 0 ? .14 : tier === 1 ? .28 : .55, sp: .4 + r() * .8, ph: r() * TAU,
        kick: r() < .6 ? 1 + Math.floor(r() * 3) : 0, dir: r() < .5 ? 1 : -1,
        spin: tier === 2 && r() < .4 ? (r() - .5) * .7 : 0,
      });
    }
    list.forEach(s => { s.tgt = s.rot; });
  } else {
    const n = Math.round(16 + dens * 44), types = ['circle', 'square', 'tri', 'half', 'ring', 'quarter', 'bar'];
    for (let i = 0; i < n; i++) list.push({
      type: types[Math.floor(r() * types.length)], x: r(), y: r(), r: .014 + r() * r() * .05,
      ci: Math.floor(r() * 5), band: Math.floor(r() * NB), sp: .5 + r(), rot: r() * TAU, vr: (r() - .5) * 1.2, ph: r() * TAU,
    });
  }
  list.key = key; list.pulse = A.pulse;
  return (comps[kind] = list);
}

/* ════════════ Music visualisers ════════════
   o: { A, T, dt, col(i), pc, others[], bg, fg, fg2, track, dens, sc, seed, hole } */
let peaks = new Float32Array(0);
const MUSIC = {
  /* a living Bauhaus poster: big flat shapes swell with their band and click
     round in quarter turns on the beat */
  bauhaus(ctx, W, H, o) {
    const S = Math.min(W, H) * o.sc, list = composition('bauhaus', o.seed, o.dens);
    const fresh = A.pulse !== list.pulse; list.pulse = A.pulse;
    const ease = Math.min(1, o.dt * 6);
    for (const s of list) {
      if (fresh && s.kick && A.pulse % s.kick === 0) s.tgt += s.dir * Math.PI / 2;
      s.rot += (s.tgt - s.rot) * ease + s.spin * o.dt;
      const e = A.bands[s.band];
      const x = s.x * W + Math.sin(o.T * .11 * s.sp + s.ph) * S * .025;
      const y = s.y * H + Math.cos(o.T * .09 * s.sp + s.ph * 1.3) * S * .025;
      shp(ctx, s.type, x, y, s.r * S * (1 + e * s.gain + A.beat * s.gain * .2), s.rot, o.col(s.ci));
    }
  },

  /* concentric arcs, inner = bass; arc length rides each band */
  orbit(ctx, W, H, o) {
    const S = Math.min(W, H) * o.sc, cx = W / 2, cy = H / 2, K = 3 + Math.round(o.dens * 6);
    const r0 = S * (o.hole ? .3 : .13), r1 = S * .48, step = (r1 - r0) / K, lw = step * .58;
    ctx.lineCap = 'butt';
    for (let k = 0; k < K; k++) {
      const r = r0 + step * (k + .5), e = A.bands[Math.min(NB - 1, Math.floor(k / K * NB))];
      const len = (.08 + e * .8 + .05 * Math.sin(o.T * .7 + k)) * TAU;
      const a = o.T * (.12 + .05 * k) * (k % 2 ? 1 : -1) + k * 1.7;
      ctx.lineWidth = lw;
      ctx.strokeStyle = o.track; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = o.col(k); ctx.beginPath(); ctx.arc(cx, cy, r, a, a + len); ctx.stroke();
      disc(ctx, cx + Math.cos(a + len) * r, cy + Math.sin(a + len) * r, lw * (.42 + e * .3), o.col(k + 2));
    }
    if (!o.hole) disc(ctx, cx, cy, r0 * .62 * (1 + A.bass * .35 + A.beat * .08), o.col(0));
  },

  /* mirrored pillars with falling peak dots; colour bands spread from the centre.
     With the clock showing they rise from the floor and hang from the ceiling,
     leaving its band clear. */
  monolith(ctx, W, H, o) {
    const N = 2 * Math.round(7 + o.dens * 13), pad = W * .06, slot = (W - pad * 2) / N, w = slot * .62;
    const base = H * .9, reach = o.hole ? .3 : .7;
    if (peaks.length !== N) peaks = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const d = Math.abs(i - (N - 1) / 2) / ((N - 1) / 2);
      const e = A.bands[Math.min(NB - 1, Math.floor(d * (NB - 1)))];
      const h = Math.max(w, H * (.05 + e * reach) * o.sc + Math.sin(o.T * 1.3 + i * .5) * H * .008);
      const x = pad + slot * (i + .5) - w / 2;
      ctx.fillStyle = o.col(Math.min(4, Math.floor(d * 5)));
      ctx.beginPath(); ctx.roundRect(x, base - h, w, h, w / 2); ctx.fill();
      if (o.hole) { ctx.beginPath(); ctx.roundRect(x, H - base, w, h * .8, w / 2); ctx.fill(); }
      peaks[i] = Math.max(peaks[i] - o.dt * H * .16, h);
      disc(ctx, x + w / 2, base - peaks[i] - w * .9, w * .34, o.fg);
    }
    ctx.fillStyle = o.track; ctx.fillRect(pad, base + w * .7, W - pad * 2, Math.max(1, H * .003));
    if (o.hole) ctx.fillRect(pad, H - base - w * .7, W - pad * 2, Math.max(1, H * .003));
  },

  /* a flat-colour landscape: layered strata under a sun */
  strata(ctx, W, H, o) {
    const S = Math.min(W, H);
    disc(ctx, W * .7, H * .32, S * .17 * o.sc * (1 + A.bass * .18 + A.beat * .04), o.col(1));
    const L = 3 + Math.round(o.dens * 3), P = 14, order = [2, 0, 4, 3, 1, 2];
    for (let k = 0; k < L; k++) {
      const baseY = H * ((o.hole ? .6 : .5) + k * ((o.hole ? .34 : .42) / L)), amp = H * (.17 - k * .015) * o.sc * (o.hole ? .7 : 1), xs = [], ys = [];
      for (let i = 0; i <= P; i++) {
        const e = A.bands[((i * 5 + k * 7) % (P + 1)) * (NB - 1) / P | 0];
        xs.push(i / P * W);
        ys.push(baseY - e * amp - Math.sin(o.T * (.35 + k * .12) + i * .7 + k * 1.9) * H * .018 - Math.sin(o.T * .13 + i * .25 + k) * H * .02);
      }
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(xs[0], ys[0]);
      for (let i = 1; i < P; i++) ctx.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
      ctx.lineTo(xs[P], ys[P]); ctx.lineTo(W, H); ctx.closePath();
      ctx.fillStyle = o.col(order[k]); ctx.fill();
    }
  },

  /* a slowly turning sunburst of wedges */
  burst(ctx, W, H, o) {
    const S = Math.min(W, H) * o.sc, cx = W / 2, cy = H / 2, K = 4 * Math.round(4 + o.dens * 8);
    const r0 = S * (o.hole ? .31 : .11), spin = o.T * .045, half = K / 2, dA = Math.PI / K * .78, reach = o.hole ? .26 : .36;
    for (let k = 0; k < K; k++) {
      const m = k % half, d = Math.abs(m - half / 2) / (half / 2);
      const e = A.bands[Math.min(NB - 1, Math.floor((1 - d) * (NB - 1) * .85))];
      const a = spin + k / K * TAU, len = S * (.05 + e * reach + A.beat * .02);
      ctx.fillStyle = o.col(k % 5);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - dA) * r0, cy + Math.sin(a - dA) * r0);
      ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      ctx.lineTo(cx + Math.cos(a + dA) * r0, cy + Math.sin(a + dA) * r0);
      ctx.closePath(); ctx.fill();
      if (k % 2 === 0) disc(ctx, cx + Math.cos(a) * (r0 + len + S * .03), cy + Math.sin(a) * (r0 + len + S * .03), S * (.008 + e * .012), o.fg);
    }
    ctx.lineWidth = Math.max(2, S * .012); ctx.strokeStyle = o.track;
    ctx.beginPath(); ctx.arc(cx, cy, r0 * .82, 0, TAU); ctx.stroke();
    if (!o.hole) disc(ctx, cx, cy, r0 * .5 * (1 + A.bass * .3), o.col(0));
  },

  /* shapes drifting upward, kicked along by the music */
  float(ctx, W, H, o) {
    const S = Math.min(W, H) * o.sc, list = composition('float', o.seed, o.dens);
    for (const p of list) {
      const e = A.bands[p.band];
      p.y -= o.dt * p.sp * (.02 + e * .1 + A.beat * .05);
      p.x += Math.sin(o.T * .3 + p.ph) * o.dt * .006;
      p.rot += o.dt * p.vr * (1 + e * 2);
      if (p.y < -.08) { p.y = 1.08; p.x = Math.random(); }
      if (p.x < -.05) p.x = 1.05; else if (p.x > 1.05) p.x = -.05;
      shp(ctx, p.type, p.x * W, p.y * H, p.r * S * (1 + e * .5), p.rot, o.col(p.ci));
    }
  },
};

/* ════════════ Timer visuals ════════════
   d = dial { x, y, S }  ·  st = { p (elapsed 0→1), phase, long, running, total } */
const TIMER = {
  /* a thick progress ring with minute ticks, a bass-driven head and orbiting satellites */
  orbit(ctx, d, st, o) {
    const S = d.S, R = S * .38, lw = Math.max(5, S * .046), a0 = -Math.PI / 2, a1 = a0 + st.p * TAU;
    disc(ctx, d.x, d.y, R - lw / 2, o.faint);
    ctx.lineCap = 'butt'; ctx.lineWidth = lw;
    ctx.strokeStyle = o.track; ctx.beginPath(); ctx.arc(d.x, d.y, R, 0, TAU); ctx.stroke();
    if (st.p > .0005) { ctx.strokeStyle = o.pc; ctx.beginPath(); ctx.arc(d.x, d.y, R, a0, a1); ctx.stroke(); }
    const n = Math.min(60, Math.max(1, Math.round(st.total / 60))), r1 = R + lw * .5 + S * .022, r2 = r1 + S * .02;
    ctx.lineWidth = Math.max(1, S * .0035);
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * TAU, c = Math.cos(a), s = Math.sin(a);
      ctx.strokeStyle = i / n < st.p ? o.fg2 : o.track;
      ctx.beginPath(); ctx.moveTo(d.x + c * r1, d.y + s * r1); ctx.lineTo(d.x + c * r2, d.y + s * r2); ctx.stroke();
    }
    disc(ctx, d.x + Math.cos(a1) * R, d.y + Math.sin(a1) * R, lw * (.72 + A.bass * .35 + A.beat * .12), st.p > .0005 ? o.others[0] : o.pc);
    const rs = R + lw * .5 + S * .075, types = ['square', 'tri', 'circle'];
    for (let i = 0; i < 3; i++) {
      const a = o.T * (.08 + i * .025) * (i % 2 ? -1 : 1) + i * 2.1;
      shp(ctx, types[i], d.x + Math.cos(a) * rs, d.y + Math.sin(a) * rs, S * (.018 + A.bands[3 + i * 7] * .018), a * 2, o.others[(i + 1) % o.others.length]);
    }
  },

  /* focus slides a moon across the sun; a break slides it away again */
  eclipse(ctx, d, st, o) {
    const S = d.S, R = S * .3;
    ctx.lineWidth = Math.max(1, S * .004); ctx.strokeStyle = o.pc;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = (.34 - i * .1) * (.55 + A.level * .9);
      ctx.beginPath(); ctx.arc(d.x, d.y, R * (1.16 + i * .13) + A.bands[2 + i * 6] * S * .025, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.track; ctx.beginPath(); ctx.arc(d.x, d.y, R * 1.62, 0, TAU); ctx.stroke();
    for (let i = 0; i < 2; i++) {
      const a = o.T * .07 * (i ? -1.4 : 1) + i * Math.PI;
      disc(ctx, d.x + Math.cos(a) * R * 1.62, d.y + Math.sin(a) * R * 1.62, S * (.02 + A.bands[8 + i * 8] * .012), o.others[i % o.others.length]);
    }
    disc(ctx, d.x, d.y, R * (1 + A.bass * .03), o.pc);
    const mx = st.phase === 'focus' ? d.x - (1 - st.p) * R * 2.2 : d.x + st.p * R * 2.2;
    disc(ctx, mx, d.y, R * .985, o.bg);
  },

  /* one shape per minute round the dial; elapsed minutes fill in colour */
  mosaic(ctx, d, st, o) {
    const S = d.S, R = S * .385, mins = Math.max(1, st.total / 60), per = Math.max(1, Math.ceil(mins / 40));
    const N = Math.max(4, Math.ceil(mins / per)), ts = Math.min(TAU * R / N * .36, S * .05);
    const types = ['circle', 'square', 'tri', 'half', 'quarter', 'ring'], done = st.p * N;
    ctx.lineWidth = Math.max(1.2, S * .004);
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + (i + .5) / N * TAU, x = d.x + Math.cos(a) * R, y = d.y + Math.sin(a) * R;
      const type = types[i % types.length], rot = a + Math.PI / 2;
      if (i < Math.floor(done)) shp(ctx, type, x, y, ts * (1 + A.bands[i % NB] * .35), rot, o.col(i));
      else {
        shp(ctx, type, x, y, ts, rot, o.track, true);
        if (i === Math.floor(done)) shp(ctx, type, x, y, ts * (.25 + .75 * (done - i)) * (1 + A.beat * .15), rot, o.pc);
      }
    }
  },

  /* a vessel that fills during focus and drains during a break */
  tide(ctx, d, st, o) {
    const S = d.S, R = S * .4, k = st.phase === 'focus' ? st.p : 1 - st.p, top = d.y + R - (.05 + k * .95) * 2 * R;
    const amp = S * (.006 + A.level * .01);
    const wave = (x, L) => top + Math.sin(o.T * (1 + L * .35) + (x - d.x) / R * 3 + L * 2) * amp
      + Math.sin(o.T * .7 + (x - d.x) / R * 5 + L) * S * A.bands[(L * 7 + Math.round((x - d.x + R) / (2 * R) * 9)) % NB] * .012;
    ctx.lineWidth = Math.max(1.5, S * .005); ctx.strokeStyle = o.track;
    ctx.beginPath(); ctx.arc(d.x, d.y, R + S * .022, 0, TAU); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(d.x, d.y, R, 0, TAU); ctx.clip();
    ctx.fillStyle = o.faint; ctx.fillRect(d.x - R, d.y - R, 2 * R, 2 * R);
    ctx.beginPath(); ctx.moveTo(d.x - R, d.y + R);
    for (let i = 0; i <= 28; i++) { const x = d.x - R + i / 28 * 2 * R; ctx.lineTo(x, wave(x, 1)); }
    ctx.lineTo(d.x + R, d.y + R); ctx.closePath();
    ctx.fillStyle = o.pc; ctx.fill();
    // two floaters ride the surface near the rim, clear of the clock in the middle
    const hn = Math.min(1, Math.abs(top - d.y) / R), edge = Math.min(.9, Math.sqrt(1 - hn * hn) * .82);
    for (let i = 0; i < 2; i++) {
      const x = d.x + (i ? 1 : -1) * R * (edge - Math.abs(Math.sin(o.T * .2 + i * 2)) * .03);
      shp(ctx, i ? 'tri' : 'circle', x, wave(x, 1) - S * .01, S * .028 * (1 + A.bands[2 + i * 9] * .4),
        Math.sin(o.T * .8 + i) * .3, o.others[i % o.others.length]);
    }
    ctx.restore();
  },
};

/* quiet oversized shapes behind the stage dial, tinted with the phase colour */
function decor(ctx, W, H, o) {
  const S = Math.min(W, H);
  ctx.fillStyle = o.faint;
  ctx.beginPath(); ctx.moveTo(0, H); ctx.arc(0, H, S * (.46 + A.bass * .025), -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(W, 0, S * .28, 0, TAU); ctx.moveTo(W + S * .19, 0); ctx.arc(W, 0, S * .19, 0, TAU, true); ctx.fill();
}

function drawMusic(ctx, W, H, style, o) {
  ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
  (MUSIC[style] || MUSIC.bauhaus)(ctx, W, H, o);
}
function drawTimer(ctx, W, H, d, st, style, o) {
  ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
  if (o.decor) decor(ctx, W, H, o);
  (TIMER[style] || TIMER.orbit)(ctx, d, st, o);
}

/* ════════════ Cover art ════════════
   A seeded Bauhaus tile grid per track. Colours are classes (k1…k5 = --c1…--c5,
   k0 = surface, r* = ring strokes) so a palette change recolours every cover
   without regenerating it; .sp shapes turn slowly while music plays. */
const coverCache = new Map();
function cover(seed, cols, rows) {
  const key = seed + '|' + cols + 'x' + rows;
  if (coverCache.has(key)) return coverCache.get(key);
  const r = rng(hash(seed)), u = 50, W = cols * u, H = rows * u, pick = () => 1 + Math.floor(r() * 5);
  const bgk = r() < .45 ? pick() : 0;
  let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="${W}" height="${H}" class="k${bgk}"/>`;
  let spun = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (r() < .16) continue;
    let k = pick(); if (k === bgk) k = k % 5 + 1;
    const X = x * u, Y = y * u, rot = Math.floor(r() * 4) * 90;
    const sp = spun < 2 && r() < .25 ? (spun++, ' sp') : '';
    let el;
    switch (Math.floor(r() * 8)) {
      case 0: el = `<circle cx="${X + 25}" cy="${Y + 25}" r="25" class="k${k}${sp}"/>`; break;
      case 1: el = `<path d="M${X} ${Y + 25}a25 25 0 0 0 50 0z" class="k${k}${sp}"/>`; break;
      case 2: el = `<path d="M${X} ${Y}h50a50 50 0 0 1-50 50z" class="k${k}${sp}"/>`; break;
      case 3: {
        let k2 = pick(); if (k2 === k) k2 = k % 5 + 1;
        el = `<rect x="${X}" y="${Y}" width="50" height="50" class="k${k}"/><circle cx="${X + 25}" cy="${Y + 25}" r="13" class="k${k2}${sp}"/>`; break;
      }
      case 4: el = `<path d="M${X} ${Y + 50}h50L${X} ${Y}z" class="k${k}${sp}"/>`; break;
      case 5: el = `<circle cx="${X + 25}" cy="${Y + 25}" r="17" stroke-width="10" class="r${k}${sp}"/>`; break;
      case 6: el = `<path d="M${X} ${Y + 6}h50v9H${X}zM${X} ${Y + 21}h50v9H${X}zM${X} ${Y + 36}h50v9H${X}z" class="k${k}${sp}"/>`; break;
      default: el = `<path d="M${X + 25} ${Y}a25 25 0 0 1 0 50z" class="k${k}${sp}"/>`;
    }
    s += `<g transform="rotate(${rot} ${X + 25} ${Y + 25})">${el}</g>`;
  }
  if (cols > 2 && rows > 1 && r() < .75) {
    const X = Math.floor(r() * (cols - 1)) * u + 50, Y = Math.floor(r() * (rows - 1)) * u + 50;
    s += `<circle cx="${X}" cy="${Y}" r="${r() < .5 ? 50 : 38}" class="k${pick()}"/>`;
  }
  s += '</svg>';
  coverCache.set(key, s);
  return s;
}

window.Viz = { PALETTES, MUSIC_STYLES, TIMER_STYLES, NB, A, theme, colours, mix, onColour, analyse, drawMusic, drawTimer, cover };
})();
