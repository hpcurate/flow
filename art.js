/* FLOW · the artwork, stylised (1.7.0, Hugo's r261028-ylsm "can you add a toggle in setting to stylize the artwork of the
   now playing. i want a way for the artwork to blend better with the rest of the app, maybe if it's not playing from spotify
   you can figure out a way to change the artwork to the dominant colour of the favicon where the sound is playing from (or the
   app if it's not a website)").
   - Spotify's artwork stays the album's, drawn as a duotone: its shadows the theme's dark, its lights the album's own
     strongest colour — a poster in the app's dark, flat look.
   - Anything else gets FLOW's own Bauhaus cover in one colour: the website's (its favicon's main colour, for the sites people
     play from — the browser's window title says which site the playing tab is), else the app's (its icon's).
   Nothing is fetched: the sites' colours are known here, an app's comes from its icon on this PC.
   (UMD: main.js finds the source's colour, app.js draws the artwork.) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Art = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // the sites people play from: the name a tab's title carries, and its favicon's main colour
  const SITES = [
    [/youtube music/i, 'YouTube Music', '#FF0033'], [/youtube/i, 'YouTube', '#FF0033'], [/soundcloud/i, 'SoundCloud', '#FF5500'],
    [/twitch/i, 'Twitch', '#9146FF'], [/bandcamp/i, 'Bandcamp', '#1DA0C3'], [/mixcloud/i, 'Mixcloud', '#5000FF'],
    [/deezer/i, 'Deezer', '#A238FF'], [/apple music/i, 'Apple Music', '#FA243C'], [/spotify/i, 'Spotify', '#1ED760'],
    [/netflix/i, 'Netflix', '#E50914'], [/prime video/i, 'Prime Video', '#1A98FF'], [/disney\+/i, 'Disney+', '#113CCF'],
    [/crunchyroll/i, 'Crunchyroll', '#F47521'], [/\bkick\b/i, 'Kick', '#53FC18'], [/vimeo/i, 'Vimeo', '#1AB7EA'],
    [/beatport/i, 'Beatport', '#01FF95'], [/audiomack/i, 'Audiomack', '#FFA200'], [/plex/i, 'Plex', '#EBAF00'],
    [/jellyfin/i, 'Jellyfin', '#AA5CC3'], [/radio garden/i, 'Radio Garden', '#2BE477'], [/bbc sounds/i, 'BBC Sounds', '#FF4900'],
  ];
  // the apps: their icon's main colour (an app not here: its icon on this PC, main.js)
  const APPS = [
    [/spotify/i, '#1ED760'], [/brave/i, '#FB542B'], [/chrome/i, '#4285F4'], [/msedge|edge/i, '#1A9BD7'], [/firefox|308046B0AF4A39CB/i, '#FF7139'],
    [/vivaldi/i, '#EF3939'], [/opera/i, '#FF1B2D'], [/zunemusic|mediaplayer/i, '#F2603C'], [/vlc/i, '#FF8800'], [/deezer/i, '#A238FF'],
    [/applemusic|itunes/i, '#FA243C'], [/musicbee/i, '#F2B33D'], [/aimp/i, '#F39C12'], [/soundcloud/i, '#FF5500'], [/tidal/i, '#33FFEE'],
  ];
  const BROWSER = /brave|chrome|msedge|edge|firefox|308046B0AF4A39CB|vivaldi|opera/i;
  const BROWSER_TAIL = /\s+[-–—]\s+(Brave|Google Chrome|Chromium|Microsoft.?Edge|Mozilla Firefox|Firefox|Vivaldi|Opera)(\s*[-–—].*)?$/i;

  const isBrowser = app => BROWSER.test(String(app || ''));
  const isSpotify = app => /spotify/i.test(String(app || ''));
  function appColour(app) { const s = String(app || ''); for (const [re, c] of APPS) if (re.test(s)) return c; return null; }

  /* the site the playing tab is on, from the browser's window titles: the one with the track's title in it, its tab's last
     " - Name" (YouTube's "(3) Song - YouTube - Brave"), else a known site's name anywhere in it. null: not found */
  function siteOf(titles, track) {
    const t = String(track || '').trim().toLowerCase();
    if (!t) return null;
    for (const raw of titles || []) {
      const w = String(raw || '');
      if (!w.toLowerCase().includes(t)) continue;
      const tab = w.replace(BROWSER_TAIL, ''), after = tab.slice(tab.toLowerCase().indexOf(t) + t.length);
      // what follows the track's title first (a site's name in the title itself is the song's, not the site)
      for (const [re, name, colour] of SITES) if (re.test(after)) return { site: name, colour };
      for (const [re, name, colour] of SITES) if (re.test(tab.slice(0, tab.toLowerCase().indexOf(t)))) return { site: name, colour };
      const m = tab.match(/\s[-–—|·•]\s([^-–—|·•]{2,30})$/);
      if (m && !m[1].toLowerCase().includes(t)) return { site: m[1].trim(), colour: null };
      return null;
    }
    return null;
  }

  /* an image's main colour: its pixels (RGBA, or BGRA with bgra) by hue, the strong ones weighed by how strong; null when it
     has none (black and white, grey) */
  function dominant(px, bgra) {
    const N = 24, w = new Float64Array(N), r = new Float64Array(N), g = new Float64Array(N), b = new Float64Array(N);
    const step = Math.max(4, Math.floor(px.length / 4 / 6000) * 4);
    for (let i = 0; i + 3 < px.length; i += step) {
      if (px[i + 3] < 128) continue;
      const R = px[bgra ? i + 2 : i], G = px[i + 1], B = px[bgra ? i : i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B), v = mx / 255, s = mx ? (mx - mn) / mx : 0;
      if (s < .28 || v < .22) continue;
      const d = mx - mn, h = mx === R ? ((G - B) / d + 6) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
      const k = Math.floor(h / 6 * N) % N, wt = s * s * v;
      w[k] += wt; r[k] += R * wt; g[k] += G * wt; b[k] += B * wt;
    }
    let best = -1, bw = 0;
    for (let k = 0; k < N; k++) { const ww = w[k] + .5 * (w[(k + 1) % N] + w[(k + N - 1) % N]); if (ww > bw) { bw = ww; best = k; } }
    if (best < 0 || bw <= 0) return null;
    const hex = v => Math.round(v).toString(16).padStart(2, '0');
    return ('#' + hex(r[best] / w[best]) + hex(g[best] / w[best]) + hex(b[best] / w[best])).toUpperCase();
  }

  const rgbOf = hex => { const n = parseInt(String(hex).slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hexOf = a => '#' + a.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const mix = (a, b, t) => { const A = rgbOf(a), B = rgbOf(b); return hexOf(A.map((v, i) => v + (B[i] - v) * t)); };
  const lum = hex => { const [r, g, b] = rgbOf(hex); return (.299 * r + .587 * g + .114 * b) / 255; };
  // a colour too dark to be seen on the theme's dark is lifted, one too pale is deepened a little
  function vivid(hex) { const l = lum(hex); return l < .28 ? mix(hex, '#FFFFFF', .28 - l + .1) : l > .9 ? mix(hex, '#000000', .12) : hex.toUpperCase(); }

  /* the cover's five colours and its ground, from one colour and the theme's dark (bg) and light (fg): the colour, a light
     tint, a deep shade, a mid tone, a pale one — every shape in its family, on the theme's surface */
  function family(colour, bg, fg) {
    const c = vivid(colour);
    return { c1: c, c2: mix(c, fg || '#F2EDE3', .45), c3: mix(c, bg || '#0B0B0C', .45), c4: mix(c, fg || '#F2EDE3', .2), c5: mix(c, bg || '#0B0B0C', .7),
             s2: mix(bg || '#0B0B0C', c, .1) };
  }

  /* a duotone of an image's pixels (RGBA, in place): its darks → dark, its lights → light, the middle along the way */
  function duotone(px, dark, light) {
    const D = rgbOf(dark), L = rgbOf(light);
    for (let i = 0; i + 3 < px.length; i += 4) {
      let t = (.299 * px[i] + .587 * px[i + 1] + .114 * px[i + 2]) / 255;
      t = t * t * (3 - 2 * t);   // a little more contrast
      px[i] = D[0] + (L[0] - D[0]) * t; px[i + 1] = D[1] + (L[1] - D[1]) * t; px[i + 2] = D[2] + (L[2] - D[2]) * t;
    }
    return px;
  }

  return { SITES, APPS, isBrowser, isSpotify, appColour, siteOf, dominant, family, duotone, mix, vivid };
});
