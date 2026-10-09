# FLOW — Desktop App Conversion · Session Log

**Date:** 2026-06-09
**Goal:** Turn the FLOW web project (single `index.html` ambiance/focus player +
pomodoro) into a real native app — *not* a webapp.

---

## Decisions

- **Target:** Windows desktop app (chosen by Hugo). Scope: "bundle everything."
- **Why Electron, not Tauri:** Node v24 was already installed; Tauri would have
  needed a multi-GB Rust + C++ build-tools install first. Electron got us running
  immediately. Tauri remains a future option (same `index.html` drops in, ~5 MB
  output vs Electron's ~180 MB).
- **Why @electron/packager, not electron-builder:** `electron-builder` failed on
  this machine — see "Build blocker" below. Packager produces a working portable
  app without that problem.

---

## What was built

A native, frameless Windows app wrapping the existing `index.html`.

### New files
| File | Purpose |
|------|---------|
| `main.js` | Electron entry — frameless 440×800 fixed window, IPC for minimize/close/miniplayer resize |
| `preload.js` | `contextBridge` exposing `window.flowAPI` (minimize / close / setMini) |
| `package.json` | scripts (`start`, `pack`, `dist`) + electron-builder config |
| `build/icon.ico` | generated dark tile + purple ♫ note (256px, PNG-embedded ICO) |
| `fonts/` | Syne + JetBrains Mono as 9 local `.woff2` + `fonts.css` |

### Feature changes to `index.html`
1. **Fonts bundled** — dropped the Google Fonts CDN `<link>`; now fully offline.
2. **No border** — frameless window; custom minimize / close / mini buttons top-right;
   titlebar is a `-webkit-app-region: drag` region so the window can still be moved.
3. **No scrollbar + fixed size + menus** — fixed 440×800, scrollbars hidden, and a
   bottom **Player ↔ Tracks** nav so you switch views instead of scrolling one long page.
4. **Miniplayer** — `⤡` button shrinks the window to a compact floating, always-on-top
   bar (play/pause, title, next, expand). If a pomodoro is running, its phase + countdown
   show in the bar and it grows to fit; pausing shrinks it back.

---

## The bug that ate an hour: dead UI, "renders but nothing clicks"

**Symptom:** packaged app launched and looked perfect, but no button, nav item, or
track responded.

**Root cause:** `preload.js` exposes `flowAPI` via `contextBridge.exposeInMainWorld`,
which registers it as a **non-configurable global property** (`window.flowAPI`). The
page script then did `const flowAPI = window.flowAPI;` at the top level. JavaScript
forbids a top-level `const`/`let` whose name collides with a non-configurable global,
so the **entire `<script>` failed to parse** (`SyntaxError: Identifier 'flowAPI' has
already been declared`). A dead script = zero event handlers attached. The HTML still
painted because markup is static → "renders but nothing clicks."

**Fix:** renamed the local to `winAPI` (kept `window.flowAPI` as the bridge name).

**Lessons:**
- Never give a top-level `const`/`let` the same name as a `contextBridge` key.
- For Electron, **"the window appeared" ≠ "it works."** The only reliable signal was
  the renderer console, which had to be piped to the terminal
  (`win.webContents.on('console-message', …)`) to be seen. A launch/process check
  passes happily on an inert app.

---

## Build blocker: electron-builder + Windows symlinks

`npm run dist` (electron-builder) fails on this machine while extracting its
`winCodeSign` package: it contains macOS `.dylib` **symlinks**, and creating symlinks
needs **Developer Mode** (off) or an elevated/admin terminal. Those files are macOS-only
signing tools irrelevant to a Windows build, but electron-builder aborts the whole
extraction over them.

**Workarounds (for a single-file installer later):**
- Turn on Settings → Privacy & Security → For Developers → **Developer Mode**, then
  `npm run dist`; **or** run the build from an **admin** terminal.

We sidestepped it with `@electron/packager`, which doesn't use `winCodeSign`.
*Resolved 2026-10-09 without Developer Mode; see the installer entry below.*

---

## How to run

- **Use the app:** double-click
  `dist\FLOW-win32-x64\FLOW.exe` (standalone, offline, ~268 MB folder — copy it
  anywhere). Pin to Start / make a desktop shortcut for daily use.
- **Develop live:** `npm start` (reflects code edits on next launch; needs Node).
- **Rebuild the app:** `npm run pack` → refreshes `dist\FLOW-win32-x64\`.

---

## 2026-06-10 — Zen mode (fullscreen visualizer)

New third nav button **Zen** (also keyboard `F`; `Esc` exits) opens a fullscreen view:

- **Audio visualizer** — Web Audio `AnalyserNode` fed by a `MediaElementAudioSourceNode`
  on the existing `<audio>` element, drawn as bottom-anchored frequency bars on a
  full-screen canvas (purple in focus, green in break; v² scaling; DPR-aware).
  Note: `createMediaElementSource` can only be called **once** per element and
  permanently reroutes audio through the AudioContext — created lazily on first
  Zen entry, guarded so it never runs twice.
- **Focus session info** — big pomodoro countdown, phase, sessions-today count,
  and a start/pause button centered over the visualizer; track name, elapsed/total
  time, and prev/play/next at the bottom. Cursor + chrome auto-hide after ~2.6 s idle.
- **Electron plumbing** — window is created `fullscreenable:false`/`resizable:false`,
  so a new `win:fullscreen` IPC temporarily lifts both before `setFullScreen(true)`
  and re-locks them on `leave-full-screen`. Main pushes `win:fs` state back so the
  renderer UI can't get stuck if fullscreen exits externally. Entering Zen from
  miniplayer exits mini first.

## 2026-06-10 (later) — Zen fixes + GUI verification workflow

**Bug: window stayed fullscreen-sized after exiting Zen.** On Windows, the
`leave-full-screen` event fires *before* the OS finishes the transition, so any
bounds set synchronously inside the handler get stomped. Fix in `main.js`: stash
`win.getBounds()` when entering fullscreen, restore it in `leave-full-screen`
inside a `setTimeout(..., 50)`. Verified programmatically: 440×800 → fullscreen →
exactly 440×800 at the same position.

**Visualizer v2** (Hugo wanted "smoother, more round and abstract" than bars):
- soft radial **orb** behind the timer that breathes with smoothed bass energy
- three layered translucent **flowing wave curves** along the bottom (quadratic
  midpoint smoothing, 15 spectrum bands mirrored so bass swells in the middle,
  fast-attack/slow-release easing + slow sine drift so it undulates organically)

**Claude CAN see the GUI now** — `gui-check.js` (kept in repo, excluded from the
package via the pack script's `--ignore`): a driver that `require('./main.js')`
(so the *real* IPC handlers are exercised), drives the renderer via
`webContents.executeJavaScript`, screenshots via `capturePage`, and prints
bounds/fullscreen state as JSON. Run with `npx electron gui-check.js`, then read
the `shot-*.png` files. Injects a fake spectrum since no track plays in scripted
runs. (A pasted screenshot — Win+Shift+S then Ctrl+V into Claude Code — also works.)

## 2026-06-10 (evening) — "everything" feature drop

All features from the brainstorm, in one pass. GUI-verified via gui-check.js
(screenshots + a runtime probe of the noise/audio graph), repacked, pushed.

**Desktop integration** (`main.js` + `preload.js`)
- Tray icon (build/icon.ico) with Show / Play-Pause / Next / Quit; tooltip live-updates
  with phase + countdown + track (`tray:tip` IPC, max 127 chars).
- **Close button now hides to tray** — music keeps playing; quit via tray menu.
- Taskbar progress bar = pomodoro progress (`win:progress` IPC; 'normal' mode for
  focus, 'paused' (yellow) for break; -1 clears).
- Media keys via `navigator.mediaSession` (SMTC) + metadata per track.
- Native toast on phase end when the window isn't focused
  (`app.setAppUserModelId('com.hugo.flow')` required for packaged toasts).
- Window position persisted to userData/win-pos.json (debounced on move).

**Pomodoro**
- Long break (default 15 m) every 4th session; `pom.long` flag, label "Long break".
- Daily goal (default 4, 0=off) with goal-dot row (●●○○) in main + zen.
- `pom.total` tracks phase length for progress math (`setRemaining()` helper).
- Music transitions now FADE (fadeEl helper, ~1.5 s) instead of hard pause/play.
- **Break track**: coffee-cup toggle on a track row (settings.breakTrackId) — during
  breaks it crossfades to that track and back (`resumeIdx`).
- Noise ducks to 0 during breaks, ramps back on focus.

**Audio**
- Dual `<audio>` elements (A/B): `audio` is a *let* pointing at the active one.
  Loop-one mode crossfades the last ~1.2 s into a fresh start on the spare element
  (`maybeCrossfade`). All listeners attached to BOTH elements with
  `e.target===audio` guards. Both get MediaElementSource nodes (once each!) in
  `ensureGraph` (renamed from ensureAnalyser).
- Noise generator: rain (pink noise + 900 Hz lowpass), brown, white — 4 s looped
  buffers → gain → analyser (so the zen visualizer reacts to noise too).

**Library**
- Drag-and-drop audio files anywhere on the window to add (body.dropping overlay).
- Drag rows to reorder (HTML5 DnD, 'text/flow-track' type guards it from the
  file-drop path); `current` re-derived by object identity after splice.

**Zen**
- 3 visualizer styles cycled by button (top-left) or V: waves / ring / drift
  (settings.zenViz). Orb stays in all modes.
- Idle (timer full + not running) shows wall clock + date instead of countdown.

## 2026-10-08 — Dark geometric redesign (v2)

**Asked:** darker colour options, better visualiser settings, better sizing
(minimal view, full screen view), a better visualiser for the pomodoro, professional,
abstract/creative with big colours and shapes — "forget the monument valley style".

**Removed:** an uncommitted light "Sanctuary" redesign found in the working tree
(dated 2026-09-11, never logged here): `sanctuary.css`/`sanctuary.js`, an isometric
Monument-Valley-style garden over a 1160×820 window. Its useful bits were kept and
rebuilt in the new code: the intention field, the phase tabs, aria labels, the input-aware
keyboard guard and the screen-fitting window bounds.

**Structure:** the single inline script is now split up:
- `index.html`: markup only
- `flow.css`: the theme
- `viz.js`: palettes, analysis, canvas styles, cover art (`window.Viz`)
- `app.js`: the old engine, ported intact, plus the views, settings and render loop

**Look**
- 7 dark palettes (Bauhaus default, Synth, Ember, Abyss, Acid, Orchid, Graphite) ×
  3 depths: dark / darker (default) / black (#000). `Viz.theme()` derives every surface
  token from bg+fg, and `app.js` writes them to `:root`. The window background colour
  follows the theme (persisted by main, so there's no flash at launch).
- Type: Syne 800 for display, JetBrains Mono for UI. **Gotcha:** this PC's Segoe UI has
  been replaced system-wide by a "font wizard" (`segoeui_fontwizard_*.ttf` in the
  registry), so `font-family: Segoe UI` renders monospace here. The UI font is now the
  bundled JetBrains Mono, set explicitly. Both bundled fonts are variable;
  `fonts/fonts.css` now declares each subset once with its weight range.
- **Clock gotcha:** Syne 800 digits are ~1.07em wide (much wider than 700). Use its
  `tnum` feature (`font-variant-numeric: tabular-nums`, every digit 1.06em) and size the
  clock as `.14 × dial`.
- Seeded Bauhaus cover art per track (SVG, colours as `k1..k5` classes so palettes
  recolour without regenerating). Shown in the player, library rows, the minimal strip
  and the mini bar.
- Film grain overlay (generated noise tile) and Motion: full / calm / still.

**Timer visuals** (stage + minimal + optional full screen), `T` cycles:
- Orbit: thick progress ring, minute ticks, bass-driven head, satellites.
- Eclipse: the moon covers the sun during focus and slides off during breaks.
- Mosaic: one shape per minute, filled as minutes pass.
- Tide: a vessel that fills during focus and drains during breaks.

On Eclipse and Tide the clock uses `mix-blend-mode: difference` with ink = phase colour,
so the digits read black on the colour and coloured on the dark. **This only works if
nothing between the clock and the canvas creates a stacking context.** No z-index,
transform or container query on `.dial`; that is why the clock size comes from a JS-set
`--S` rather than container units.

Also new: a cycle strip (● focus · ▪ break · ▬ long break, with live progress), today's
focused time (`flow_focus_<date>`), a configurable long-break interval, auto-roll on/off,
and a chime toggle. Per-day keys now use the local date (they used the UTC date).

**Visualiser:** 6 music styles (Bauhaus poster with beat-quantised quarter turns, Orbit,
Monolith, Strata, Burst, Float). The analyser is now `fftSize` 2048, mapped to 24
log-spaced bands with attack/release smoothing, onset detection (`A.beat`/`A.pulse`) and
an idle metronome so it keeps moving in silence.
- Settings → Visualiser has a live preview, sensitivity / smoothing / speed / density /
  scale, colour mode (palette / follow timer / mono), what full screen shows (music or
  timer), clock / track toggles, 30/60 fps, new composition, and reset.
- With the clock showing, Orbit and Burst open a wider centre, Monolith splits into floor
  and ceiling bars, and Strata sits lower, so the digits stay clear.

**Views / window** (main.js rewritten around `win-state.json`):
- Standard is resizable (min 880×640) and maximisable. Minimal is 400×660 (min 340×520)
  with an optional pin to keep it on top. Mini is the 360×84/142 bar. Full screen
  restores whatever came before.
- Each view remembers its own bounds. The first trip to minimal or mini keeps the window's
  top-right corner. The legacy `win-pos.json` is migrated, and FLOW reopens in the last view.
- A view change that arrives during a full-screen transition is queued (`pending`) and
  replayed after the 50 ms restore. Without this, "exit full screen → minimal" was
  silently dropped.
- Single-instance lock: launching FLOW again while it sits in the tray brings it forward
  (it used to start a second copy). The tray menu gained "Start / Pause timer".
- New icon: the four-shape mark (multi-size PNG ICO, `build/icon.ico`).

**Verification:** `test/visual.cjs` was rewritten (`npm run test:ui`; `gui-check.js` now
just requires it). It plays a generated 120 bpm loop through the real graph with the
window muted, and asserts the analyser level, every view's exact bounds, the full-screen
restore, the replayed view change, that nothing overflows at minimum and large sizes,
persistence across a reload, and zero renderer errors. It saves 30+ screenshots.
Passing; all screenshots were reviewed.

## 2026-10-09 — Shareable installer (`FLOW-Setup-1.0.0.exe`)

Goal: a single file Hugo can send so other people can install FLOW.

**Unblocking electron-builder without Developer Mode:** every failed `npm run dist`
left a numbered folder in `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\`
holding the complete extraction *except* the macOS `.dylib` symlinks. Copying one of
those folders to `winCodeSign-2.6.0` (the name electron-builder 25 looks for) makes it
use the cache and skip extraction. The Windows tools (rcedit, signtool) are all there.
If the cache is ever wiped, repeat this: run the build once, let it fail, then copy.

**Build:** `npx electron-builder --win nsis --x64` → `dist\FLOW-Setup-1.0.0.exe`
(~82 MB, unsigned). `npm run dist` builds the same plus `FLOW-portable.exe`. Config is
the existing `build` block in `package.json`: per-user install (no admin) into
`%LOCALAPPDATA%\Programs\flow`, choosable folder, desktop + Start Menu shortcuts,
uninstall from Settings → Apps. AppUserModelId `com.hugo.flow` matches `main.js`, so
toast notifications work from the installed copy.

**Verified:** the asar holds every file `index.html` loads (`app.js`, `viz.js`,
`flow.css`, `fonts/*`, `preload.js`, `build/icon.ico`). There are no other file or
network references. The installer payload lists the full 74-file app.
`win-unpacked\FLOW.exe` launched in an isolated `--user-data-dir` profile and stayed up with no renderer errors.
**Not done:** a real install/uninstall run. The installer closes any running `FLOW.exe`
by name, so a silent test would have killed Hugo's open copy.

**For recipients:** the exe is unsigned, so Windows SmartScreen shows "Windows protected
your PC". Click **More info → Run anyway**. Browsers may also warn on download. Avoiding
that needs a code-signing certificate (paid).

**Note for Hugo:** installing it himself adds a second copy next to
`dist\FLOW-win32-x64`. Both use the same `%APPDATA%\flow` profile, so the library and
settings carry over, and the single-instance lock means only one runs at a time.

---

## Open follow-ups
- The visualiser was tuned on a generated loop. Real tracks may want a different default
  sensitivity (Settings → Visualiser → Sensitivity).
- Installer is unsigned (SmartScreen warning for recipients). Signing would need a certificate.
- Bump `version` in `package.json` before building a new installer to send, so recipients can tell builds apart.
- Optional: slim down via Tauri (~5 MB) later.
