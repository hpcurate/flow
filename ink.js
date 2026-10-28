/* FLOW · a copy of CORE's core/ink.js (keep the two the same) — the ink on a colour (0.27.0, Hugo's r261028-hr3y "timers need to be more visible on every colour option. for this
   white on green doesn't work. make every colour have a unique text colour that matches it (make sure it's visible)").
   Before, text on a timer's colour was black or bone, picked by a brightness guess: white on the green, bone on the red.
   Now each colour gets its own ink, of its own hue: a deep shade of it (dark green on the green, deep brown on the yellow),
   or a pale tint of it on the dark ones (the blue), whichever side has room, as light or as deep as it can be while it
   reads — a contrast of 6.5 (WCAG: 4.5 is the floor for small text) where the colour allows it. Any #rrggbb works, so a
   colour of his own gets one too. (UMD: the clock's pages, the tests.)
   - on(hex): the ink, '#rrggbb'
   - contrast(a, b): WCAG's contrast ratio of two colours (1–21) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ink = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TARGET = 6.5;
  const cache = new Map();

  const rgbOf = hex => { const n = parseInt(String(hex).slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hexOf = rgb => '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
  const lum = rgb => .2126 * lin(rgb[0]) + .7152 * lin(rgb[1]) + .0722 * lin(rgb[2]);
  const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  const contrast = (a, b) => ratio(lum(rgbOf(a)), lum(rgbOf(b)));

  function hsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  function on(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(String(hex))) return '#0B0B0C';
    const k = String(hex).toLowerCase();
    if (cache.has(k)) return cache.get(k);
    const base = rgbOf(k), L = lum(base), [h, s0, l0] = hsl(base);
    // the side with more room: toward black, or toward white
    const dark = ratio(L, 0) >= ratio(L, 1);
    // a grey (white, bone) stays a grey, warm or cool as it was; a colour keeps its hue, strong enough to still read as that
    // colour so far from it
    const chroma = (Math.max(...base) - Math.min(...base)) / 255;
    const s = chroma < .1 ? Math.min(s0, .25) : Math.max(s0, dark ? .55 : .7);
    const want = Math.min(TARGET, (dark ? ratio(L, 0) : ratio(L, 1)) * .95);
    // the lightness closest to the colour that still reaches it (the ends keep a little of the hue)
    let lo = dark ? .04 : l0, hi = dark ? l0 : .985;
    const ok = l => ratio(L, lum(rgb(h, s, l))) >= want;
    if (!ok(dark ? lo : hi)) { const out = hexOf(rgb(h, s, dark ? lo : hi)); cache.set(k, out); return out; }
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (dark) { if (ok(mid)) lo = mid; else hi = mid; }
      else { if (ok(mid)) hi = mid; else lo = mid; }
    }
    const out = hexOf(rgb(h, s, dark ? lo : hi));
    cache.set(k, out);
    return out;
  }

  return { on, contrast, TARGET };
});
