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

## 2026-10-09 — Other apps: system "now playing" + visualiser (Spotify & co.)

**Asked:** show what Spotify is playing inside FLOW, with the visualiser working on it.
Explicitly **not** through the Spotify API.

**Approach:** two Windows mechanisms, no accounts or keys:
1. **Track info + control: the Windows media sessions** (SMTC, what the volume flyout
   shows). `smtc.ps1` is a small bridge run by `main.js` in **Windows PowerShell 5.1**
   (`powershell.exe`, not pwsh 7: only 5.1 has the WinRT projection). It polls every
   ~600 ms, prints a JSON line when the shown session changes (`state`), sends artwork
   as a data URL (`art`), and takes `toggle|play|pause|next|prev|seek <s>` on stdin. It
   exits when stdin closes, so it never outlives FLOW. FLOW's own session
   (`com.hugo.flow`, passed as `FLOW_AUMID`) is filtered out.
2. **Visualiser: system audio loopback.** `session.setDisplayMediaRequestHandler` answers
   `getDisplayMedia` with `{video: request.frame, audio: 'loopback'}`. The "video" is
   FLOW's own page (tab capture, so no screen capture and no yellow border), and the
   renderer stops it at once. No user gesture is needed. The loopback feeds the analyser
   only, never the speakers.

**Which player the panel shows** (`src` in `app.js`): FLOW's own track while it plays;
otherwise the other app while it plays; when both are quiet, whichever played last
(`lastSrc`). The transport (`togglePlay`/`goPrev`/`goNext`, Space, tray) follows `src`.
Media keys stay on FLOW's own player (`flowToggle`), because Windows only sends them to
FLOW when FLOW is the current session. While another app is showing: loop/shuffle are
disabled, prev/next/seek follow what the app allows, and the volume slider is dimmed
(it is FLOW's own volume). Commands update the state optimistically; the bridge
re-reports after every command, so a refused command gets corrected.

**Audio graph change:** both `<audio>` sources and the ambience now go into a `bus` gain
→ destination, and `bus → analyser`. The analyser is a leaf now (Chromium still pulls
it). `routeViz()` swaps the analyser's input between the bus and the loopback.

**Timer sync:** a break pauses the other app (it can't be faded) and focus resumes it
(`sysBreak`). The break track, if set, still plays during the break and is faded out
after.

**UI:** artwork in the cover (the sleeve sits square on the generated poster; it is
never cropped. Done with `container-type:size` on `.cover`, which is fine because the
clock blend trick only cares about `.stage`), the minimal strip, the mini bar, and a new
art chip in full screen. Sub-lines now ellipsis-truncate. There is a switch and a live
status line in Settings → Visualiser → **Other apps** (setting `sysMedia`, default on).

**Gotchas (each cost a round-trip):**
- WinRT in PS 5.1: the awaited artwork stream comes back as a bare `__ComObject`
  (no `Size`, no `ContentType`, no `Dispose`, and `AsStreamForRead` overloads don't bind).
  Invoking `AsStreamForRead` **through reflection** casts it. The content type is
  sniffed from the magic bytes. Spotify sends a ~150 KB PNG.
- PS 5.1 reads a BOM-less script as ANSI, so `smtc.ps1` is kept pure ASCII.
- PowerShell can't read inside `app.asar`, so `main.js` copies `smtc.ps1` to `userData`
  and runs it from there with `-File` (chosen over `-EncodedCommand`, which AV tools flag).
- The bridge reads stdin through its own `StreamReader` over `OpenStandardInput()`
  rather than `[Console]::In` (a SyncTextReader whose "async" read may just block; not
  tested, avoided). Verified: commands arrive between polls, and closing stdin exits it.
- Spotify updates its timeline only every ~4.5 s, so the renderer interpolates from
  `LastUpdatedTime` (`sysPos()`).

**Test:** `test/visual.cjs` **replaces main's `sys:cmd` handler with a recorder**, so a
test can never pause or skip the real player. It turns other apps off for the old
sections, then checks: the real bridge reports; if something is really playing, the
loopback reaches the analyser (Spotify measured `level ≈ .3`, `shot-11-sys-live`); then
a scripted Spotify session drives the panel, the transport commands, FLOW taking the
panel back, the break pause/resume, and every view (`shot-11-sys-*`); switching it off;
and `sysMedia` persisting across a reload. Passing.

**Flake seen (unresolved):** in the first 2 runs after this change, the existing "mini is
always on top" assertion failed. `setAlwaysOnTop(true,'floating')` fired
`always-on-top-changed false` straight away. The next 4 runs passed, including one with
the loopback forced on at launch, and a minimal Electron spike shows capture doesn't
affect topmost. Unproven theory: on Windows, Electron puts `'floating'` windows *behind
the taskbar*, and if the taskbar is momentarily not topmost (e.g. something full-screen
on screen), the window loses topmost. If the mini bar is ever seen not staying on top,
try the `'pop-up-menu'` level, which goes above the taskbar.

**Packaged:** `npm run pack`. The asar has the bridge and renderer code. Smoke test:
`FLOW.exe --user-data-dir=<tmp>` copied `smtc.ps1`, ran exactly one bridge, and left no
process behind after FLOW was killed.

## 2026-10-18 — The icon wears the theme

Asked for: *"make it so that the icon of flow changes to match the currently selected
theme/colour palette."* The four-shape mark is now redrawn in the current palette
(the titlebar mark's `--c1 --c2 --c3 --c5` on the theme's background, so depth counts
too) everywhere Windows shows it:

- **Taskbar button / Alt-Tab** — `win.setIcon`, and the window is created with the last
  theme's icon, so there is no flash of the default one on launch.
- **Tray** — `tray.setImage`.
- **Start menu, desktop and taskbar-pin shortcuts** whose target is this `FLOW.exe` —
  re-pointed with `shell.writeShortcutLink(…,'update',{icon})` 2 s after the last theme
  change (so clicking through palettes writes once), and once at launch to catch a new
  shortcut or pin. Packaged app on its own profile only: `npm start`, the GUI test and
  `--user-data-dir` smoke runs never touch them. Explorer caches shortcut icons, so the
  Start menu / a pin may take a moment (or a sign-out) to repaint.
- **Page favicon** (the web copy) — an SVG data URL from the same colours.

How: `mark.js` (new) rasterises the mark into a multi-size PNG ICO with no image library,
like GRIND's icon script. The renderer sends `{bg, mark}` on `win:theme`; main keeps it in
`win-state.json` and writes each colouring once to `userData/icons/flow-<bg>-<c1>-….ico`.
The name *is* the colours: a new theme is a new path (what Explorer's icon cache needs to
let go) and a cached file can never be stale. `npm run icon` redraws `build/icon.ico` (the
exe's own icon) from `viz.js`'s Bauhaus/darker, so the default runtime icon and the exe
icon are the same image. The mark was also centred: the first icon sat 1 unit low-right
in its tile.

**Verified:** `npm run test:ui` passes, now asserting for each palette × depth that the
theme reached main and the 32px icon shows the right colour at each shape's centre, and
that `restyleShortcuts` rewrites only shortcuts to this exe (fake exe + temp `.lnk`s).
A separate run read the live window's `WM_GETICON` big and small icons through Win32
after switching bauhaus → synth → acid: `#ff4f2e` → `#ff3d8b` → `#c5f82a`. Packaged smoke
run (`--user-data-dir=<tmp>`): boots, writes the icon, real `flow.lnk` untouched.
**Not yet seen:** the real Start-menu shortcut changing. It happens the first time
Hugo opens the packaged FLOW.

---

## 2026-10-18 (later) — Linked to TUTOR

TUTOR (the new CAP study app, `github/tutor`) has a session timer with goal time and
breaks, and a "link to FLOW" button. Hugo's ask: *"opens flow, links both apps … flow has
a visual cue that it's linked to tutor."* Agreed design: **TUTOR is the clock**, FLOW
follows.

- **Pipe** — main listens on `\\.\pipe\hugo-flow-link` (`FLOW_LINK_PIPE` overrides it),
  one JSON object per line. TUTOR connects when its button is pressed; if FLOW isn't
  running it launches `FLOW.exe --tutor-link` and retries. Messages: TUTOR → `hello`,
  `session {phase, running, left, total, focus, goal}` every 2 s and on each change,
  `show`, `bye`; FLOW → `hello`, `cmd toggle|skip|end`, `bye`. The last session is kept
  in main and replayed when the renderer (re)loads (`link:ready`).
- **Renderer** — while linked, FLOW's timer mirrors TUTOR's session (phase, time left,
  running, with a local 1 s count between messages); the phase label reads
  `TUTOR · Focus`. A phase change runs FLOW's own `musicToBreak` / `musicToFocus`
  (and chime), so music and the other app pause on TUTOR's breaks exactly like FLOW's
  own pomodoro. Start/pause and skip send `toggle` / `skip` back; reset and the phase tabs
  are dimmed and only toast. FLOW's own timer state is saved on link and restored on
  unlink. Linked focus time is not added to FLOW's daily count (TUTOR records it).
- **Cue** — a phase-coloured `🔗 TUTOR` chip next to the wordmark (icon only in minimal),
  tray tip `FLOW · linked to TUTOR`. Clicking the chip unlinks (sends `bye`).

**Verified:** `npm run test:ui` passes with a stand-in TUTOR on a private pipe: hello
handshake, mirrored phase/time/running, tray tip, layout fit (`shot-12-linked.png`),
Spotify paused on TUTOR's break and resumed on focus, FLOW's buttons arriving as
`toggle`/`skip`, reset/tabs leaving the session alone, `bye` restoring FLOW's own timer,
and the chip unlinking from FLOW's side. **Not yet seen:** the two packaged apps linked
for real.

---

## 2026-10-18 (evening) — GRIND links too

Hugo asked for the same link (and TUTOR's session bar) in GRIND. FLOW's side is now
app-neutral:

- **Named by its hello** — main keeps `link.app` from the hello (`TUTOR`, `GRIND`;
  letters and digits, max 12, upper-cased) and sends it with the `state` message. The
  chip, its tooltip, the `GRIND · Focus` phase label, the tray tip (`FLOW · linked to
  GRIND`) and the toasts all use it.
- **One app at a time** — a new connection takes over: the old one gets `bye` and its
  socket is `end()`ed (was `destroy()`, which could drop the bye before it was written),
  destroyed a second later if still open. The renderer switches the name in place and
  keeps FLOW's saved own timer, so whichever app lets go last, FLOW's timer comes back
  as it was.

**Verified:** `npm run test:ui` adds a takeover check (TUTOR linked, GRIND connects:
TUTOR hears bye and closes, chip/label/tray say GRIND, `bye` restores FLOW's own timer;
`shot-12-linked-grind.png`). Note: this evening the mini-bar assertion
`win.isAlwaysOnTop()` fails on this PC for the committed code too — Electron's
`setAlwaysOnTop(true,'floating')` is called and Windows reports the window as not topmost.
Machine state, not a regression; the rest of the run passes with that one check
relaxed. Re-check it another time before trusting a failure there.

---

## 2026-10-19 — the pill (a session bar on top of everything)

Hugo's idea: a visualiser for FLOW that works with GRIND and TUTOR, can run an open
session of its own (named), can be placed freely and snapped to the taskbar, with
sizes and the same design as GRIND's and TUTOR's session pill. He asked for it
**inside FLOW** (not a Windhawk mod, not a separate app), as a **toggle that runs
alongside the views** and survives closing the main window. His answers on the
details:

- **Open session = GRIND's model:** a goal, a break every X min for Y min.
- **Another app taking the clock** pops a quick **"!"**, which pops and fades as a "cool
  animation". From the pill, starting or handing a session to TUTOR or GRIND *opens* that
  app. A session started inside an app without the link doesn't show, and that's fine.
- **The music is part of it:** a 4-bar visualiser.
- **All nine extras I proposed:** the app's colours, controls on hover, idle states,
  lock and click-through, hide in full screen, break moments, the music bars with the
  track on hover, global shortcuts, and a tally by name. Plus a settings tab.

**Tested first:** a throwaway Electron pill on the real taskbar plus a probe. Clicking
the taskbar never covers a topmost window, but **closing the Start menu puts the taskbar
back over it**. A guard fixes that: every 120 ms it walks the z-order up from the pill,
and if a taskbar is above, `SetWindowPos(HWND_TOPMOST)` lifts the pill back. It runs
from a PowerShell/C# helper. Gotcha: a synchronous `execFileSync` probe froze Electron's
main thread, and `SetWindowPos` from another process waits for that thread (it's a
SendMessage), which looked like the guard failing.

**How it's built**
- `pill-main.js` (main process) owns the pill window, the open session, the snapping,
  the settings (`userData/pill.json`: cfg, pos, open, done), the right-click menu,
  global shortcuts and `pill.ps1`. `main.js` wires it into the link (hello, session,
  drop, ready, cmd) and rebuilds the tray menu from `pill.trayItems()`.
- **The open session lives in main** (Node timers aren't throttled while FLOW is hidden).
  It is mirrored into FLOW's window **as a link**: `link:msg` `{t:'state', kind:'open',
  name}` plus session messages. So FLOW's timer, music sync and chime follow it without
  new code there. The page labels it with the name, the focus line under the clock *is*
  the name (renaming is two-way), reset ends it, and the chip opens the pill's panel.
- **Priority:** a linked app, then the open session, then FLOW's own pomodoro (running or
  paused mid-phase), then idle.
- **A link arriving** while an open session runs pauses it underneath and pops "!". So does
  a takeover from another app, or FLOW's pomodoro running. When the app lets go, the open
  session takes the clock back (`linkDropped()` mirrors it instead of `state off`).
- **Hand-over:** the pill starts `TUTOR.exe` or `GRIND.exe` with `--flow-link` and
  `--flow-carry=<start>:<focus s>:<since break s>`, then waits. When the app's first
  session report shows those minutes (focus ≥ carried − 30 s), the open session is dropped
  without being filed; otherwise it stays underneath and "!" pops. FLOW ignores the app's
  `show` while it waits, so only the app's window comes up. The TUTOR and GRIND side is in
  their manifests (hello `k` colours, session `every`, `fromFlow(argv)` at launch and in
  `second-instance`, `session.start` takes `carry`).
- **`pill.ps1`** is Windows PowerShell 5.1 plus Add-Type C# (copied to userData like
  `smtc.ps1`). It reports the taskbar rects, a full-screen foreground window (covers its
  monitor and isn't maximised), the snap spots, and Ctrl while click-through is on; it
  also runs the guard. The spots come from UI Automation over `Shell_TrayWnd`'s buttons:
  the biggest run of non-tray buttons is the icon group, and the tray starts at the
  leftmost `SystemTray.*` button. That takes about 0.5 s the first time and is
  re-read every 5 s while the pill sits beside the icons.
- **The window** is the pill plus a 12 px transparent margin (room for the moments), and
  grows by the panel above or below. It's frameless, transparent, `skipTaskbar`,
  `focusable:false` (focusable only while the panel is open, so it can type), and
  topmost at the `screen-saver` level. Clicks pass through everywhere except the pill:
  `setIgnoreMouseEvents(true,{forward:true})`, and the page reports hits. Scale is CSS
  `zoom`, not `setZoomFactor`, which is per origin and would zoom FLOW's window too
  (both are `file://`).
- **The music bars:** the page samples four bands of the analyser about 30 times a second
  while the pill shows them. That's why FLOW's window has `backgroundThrottling:false`
  now; `frame()` stops drawing on its own while hidden (`win:vis`).
- **The design** is GRIND's `.sess` pill: `s1` background, `bd2` border, dot plus
  phase, time / goal, a 6 px goal bar over a 3 px next-break bar, break-in. Sizes are
  S 232×28, M 660×32 and L 680×44 (two lines, Syne name, track on the right); idle is
  compact or a dot. The moments are the "!" disc with six flying shapes and a shake, and
  the colour wipe for break / back to it / goal.

**Verified**
- `npm run test:ui` passes. New checks: on, snapped and idle; hidden window keeps it;
  open session from the panel mirrored with the name; rename from FLOW; three sizes;
  FLOW's and the pill's buttons; break moment; TUTOR takeover ("!", paused underneath,
  TUTOR's colours, panel); TUTOR bye brings the open session back; hand-over to GRIND
  (launch recorded: exe, `--flow-link`, carry; adopted with no "!"; GRIND's colours);
  tally and name chips; free drag and snap into the icon spot; full-screen hide; lock;
  click-through + Ctrl; music bars; Settings → Pill; off; `pill.json`.
  Shots: `shot-13-pill-*.png`.
- **End to end** with the packed GRIND and TUTOR (throwaway profiles, a private pipe, a dev
  FLOW with other apps off):
  - GRIND not running: an open session of 25 min was handed over, GRIND took the start
    and the minutes and filed 25 min when it was ended from the pill.
  - TUTOR already running: linked through its second instance, in its theme colours.
- GRIND 18/18 and TUTOR 18/18 GUI checks, plus the new unit checks. All three apps packed.

## 2026-10-19 (evening) — timers made on the fly (1.2.0)

Hugo's ask: timers that aren't the Pomodoro, made on the fly ("remind me the laundry is
done in 2h"), with a simple interface:
1. a toggle on/off for the timers;
2. when they're on, a second toggle pops them out into their own mini window (name,
   progress bar, three buttons: edit, pause, reset with confirmation);
3. that window looks like the pill;
4. not popped out, they show in every view of FLOW, and the minimal view is the pop-out
   and the minimal window merged together;
5. the timers needn't be saved, but the names are remembered and offered as you type;
6. one that ends gets a big poppy overlay, like the pill's "!";
7. timers have colours, and the colour comes back with the name;
8. customisation options.

**Calls I made** (none were asked):
- **In the standard view** they're a strip of capsules under the titlebar. It's three across
  at the default size, with the field last.
- **The field** takes "laundry 2h" on its own, or a name and a length in its own box. A name
  that was used before, typed in full ("Episode 3"), wins over splitting off a number. A
  picked name brings its length and colour.
- **Reset** keeps a running timer running from its full length, restarts an ended one, and
  leaves a paused one paused. It asks in the row, and nothing happens if the question isn't
  answered within 5 s.
- **Ended:** the middle button becomes ✓ (dismiss). Edit can give an ended timer more time.
  Editing the time left keeps the time already spent on the bar.
- **Turned off,** the timers are hidden but keep running and still ring, so a hidden laundry
  timer isn't lost.
- **The overlay** pops on the screen the mouse is on. The overlay is followed by a Windows
  notification, which waits if he was away. A pulsing row stays until dismissed.
  "Keep it on screen" (off by default) leaves a banner at the top: ok / +5 min / again.

**How it's built**
- `timers-main.js` (main) keeps the timers (end times, not ticks), the settings, the names
  (`userData/timers.json`: cfg, the pop-out's place, names with colour and length; never
  the timers), the pop-out window and the overlay window, the notification and the
  shortcut. Every change goes out as one state message to FLOW's window, the pop-out and
  the overlay; the pages count down from the end time between them.
- `timers-ui.js` is the list and the field. It's the same code in FLOW's window and the
  pop-out, and `timers.css` styles both. A row is rebuilt only when its shape changes, so
  buttons stay under the pointer.
- **In FLOW's window** it's one dock that `app.js` moves into the slot of the view on screen:
  `tm-slot-std`, `-min`, `-mini`, `-zen`, or `-park` while hidden or popped out.
- **The minimal view grows by the dock.** The page reports the dock's height (`win:dock`).
  `main.js` keeps `dock.want` (what the page said) and `dock.on` (what the window has), so
  the saved minimal size is always the window's own (height − `dock.on`). The minimum height
  grows with it, and full screen restores it. The mini bar adds the dock to its height.
- **The pop-out** (`timers.html` + `timers-pop.js`) is transparent and lets clicks through
  except on a capsule, like the pill. Its page reports its height; main grows it away from
  the nearer screen edge (from its bottom in the lower half). A capsule drags it. Alt+F4
  puts the timers back into FLOW.
- **The overlay** (`ring.html/css/js`) is a transparent, non-focusable window over the
  whole screen:
  - a disc in the timer's colour pops (overshoot and wobble), with two ring waves;
  - shapes in FLOW's palette fly out across the screen, and the name rises underneath;
  - pops queue one after another;
  - it closes itself when nothing is left;
  - FLOW's Calm and Still motion settings tone it down.
- **The sound** plays in FLOW's window (`backgroundThrottling:false` already keeps it alive):
  a three-note triangle bell, unlike the phase chime. "Ring" repeats it every 2.4 s for at
  most a minute, and stops when the timer stops being ended.
- **Gotchas:**
  - Two of the shared classes collided with FLOW's stylesheet. The edit form's `main`
    button picked up `.main`'s grid, and the dock's `empty` picked up the library's empty
    state. They're now `prime` and `tm-empty`.
  - `:where(.tm-dock) button` keeps the pop-out's button reset from beating the row styles.

**Verified:** `npm run test:ui` passes. The new section checks:
- N turns them on with the field focused;
- "Laundry 2h" + Enter; a name, a length and a picked colour;
- autocomplete brings back length and colour (↓, Enter, Enter);
- pause and resume;
- reset asks: keep leaves it, reset restores the full length;
- edit (name, time left, colour);
- standard fit;
- minimal is 660 + dock tall, grows with one more timer, keeps 660 on disk, and its drop
  opens upward;
- mini is base + dock; full screen;
- pop-out: FLOW's dock parked, the same rows, as tall as its page, a new timer from it grows
  upward, dragged to the top half it anchors by its top;
- an ending timer opens the overlay, notifies (stubbed), rings FLOW, and the pop-out row
  shows it ended;
- the overlay closes itself; dismiss from the row;
- banner + ring: the banner stays, the bell repeats, ok dismisses and silences, the overlay
  goes; +5 min from the banner;
- back in; Settings → Timers (bar, order, names, forget one);
- off: hidden, not stopped; `timers.json` has the names and no timers.

Shots: `shot-14-timers-*.png`. Also fixed: the pill's lock check now compares its saved
place. Beside the taskbar icons it follows them, and the icon group moved 5 px mid-run.

## 2026-10-19 (night) — timers in the layouts, beside the pill; an icon titlebar

Hugo's seven points after trying the timers:
1. **Timers grow from the right of the pill** when snapped to it.
2. **No dead space** for the pill's controls: it grows to make room for them on hover.
3. **The new-timer field** only appears on hover, in the pop-out and in the app.
4. **Timers are part of each view's layout**, not laid on top of it (full screen and the others).
5. **The track title:** smaller, in bold JetBrains Mono.
6. **The timers' names:** the same.
7. **The titlebar:** icons only, a name sliding out of the button pointed at, bouncy but discreet,
   the bar growing both ways. The link chip shows its logo and opens on its name on hover.

**How**
- **The pill is the head of a group** (pill-main.js / pill.js):
  - The window spans the group (the pill plus docked timers) and `GROW` (190 px) of room on
    its free side; clicks pass through everywhere but the pill, the capsules, the "+" and the
    panel.
  - The free side is away from the snap spot's anchor edge (`r` → grows left), or away from
    a nearby screen edge.
  - The pill's rest width is the size's; on hover its CSS width animates by the controls'
    width (`--ctlw`) with a small overshoot, and the controls come in on the growing side.
  - The page reports the docked capsules' width at rest (`tdock`, converted to layout
    pixels by the pill's own measured width), and main places the group by it: at an
    `r` spot the group's right end stays at the icons and the pill moves left.
  - A group wider than the room there stops at the screen's edge.
- **Docking** (timers-main.js):
  - A `dock` setting; the pop-out is popped and docked while the pill is on, so it has no
    window of its own.
  - Dragging the pop-out within 70 px of the group's right end lights the pill
    (`dockHint`), and dropping it docks.
  - Pulling a capsule more than 36 px away undocks: the pop-out reopens at the drop point,
    anchored to the nearer screen half.
  - The pill's right-click menu and Settings → Timers both toggle it.
  - main.js passes each module a getter for the other. The pill's `onChange` calls
    `timers.pillChanged()`, which pushes only when docking changes, so there is no loop.
- **The docked capsules:**
  - Tag, time and a small bar, opening on edit / pause / reset; reset asks in the capsule.
  - The "+" and edit open the pill's panel in a new `timers` mode: timers-ui.js in a
    `slot-panel`, its height reported to main.
- **The layouts:**
  - Standard: the dock is a card (`.slot-card`, with a head: TIMERS + count) at the bottom of
    `.side`; the cover may shrink to 60 px.
  - Minimal: the same card under the stage.
  - Full screen: a row of 300 px capsules in `.zen-bottom` after the track. "Show the track"
    off and the cursor fade now hide only the track and the controls, so the timers stay.
  - Auto-width rows squeezed the tags in that nested flex layout, so the row width is fixed.
- **The field:**
  - In cards and the full-screen row it is a "+" whose width opens on hover or focus (the
    inputs collapse to 0 and its buttons are `display:none` while shut; the GUI check's fit
    test caught them past the window's edge).
  - In the pop-out it fades in (opacity, still focusable) at the end away from its anchor
    (`field-top` when anchored at the bottom), with its space kept, so nothing moves.
- **Titlebar:** labels `width:0` → `var(--lw)` (app.js measures each one, again on
  `pointerenter` for the link chip) with `--bounce` (`cubic-bezier(.34,1.3,.64,1)`); the
  980/1100 px label media query is gone.
- **Fonts:** `.np-title`, `.mini-title`, `.zen-track`, the pill's L song, the timer tags,
  the docked capsules and the overlay's names are JetBrains Mono 700/800.
- **Gotcha:** a `font:` shorthand after `line-height` reset it (docked tags sat high).

**Verified:** `npm run test:ui` passes. New checks:
- the link chip at rest and on hover;
- the timers card sits in `.side`;
- titlebar labels at rest and on hover (only the one pointed at);
- the card's "+" is under 40 px at rest and over 200 px on hover;
- the fonts;
- the pill grows by 130–150 px on hover;
- dropping the pop-out on the pill: hint, dock, a capsule per timer, its width known, the
  group width, the right end held (or stopped at the screen's edge);
- capsule pause and reset-asks, and opening on hover with the "+";
- the timers panel; undock;
- the pop-out's field at opacity 0 at rest and 1 on hover.

Hover is driven with `webContents.sendInputEvent` mouse moves. The live-audio check once read
0.019 against a 0.02 threshold during a quiet moment of the video playing in Brave; it passed
on re-run.

## 2026-10-20 — the link, readable by CORE

**Why:** CORE (`github/core`, Hugo's new launch center) draws a chain between FLOW's tile and
TUTOR's or GRIND's while they are linked. CORE must **not** connect to the pipe: it takes one
app at a time, so a second client would kick the linked app off.

**What:** main.js writes `userData/link.json` = `{ linked: "TUTOR" | "GRIND" | null, since, pid }`.
- It is written when a hello names the app, and on every drop (bye, unlink, the takeover's
  old socket).
- It is cleared when the pipe starts (so a crash that left it saying "linked" is undone) and on
  quit.
- CORE polls the file. It also treats a "linked" file as unlinked while FLOW isn't running.

**Verified:** `npm run test:ui` passes. New checks: the file names TUTOR after its hello, clears
on bye, and names GRIND after the takeover. Packed (`grep LINK_STATUS` finds it in the asar).
The first pack attempt failed with EBUSY while FLOW was running; the build left in place was
intact.

## 2026-10-20 (evening) — other apps, one click; names in mono

**Hugo's asks:**
- A quick toggle on the player for showing what other apps play. Sometimes he doesn't want
  his YouTube in FLOW.
- Timer and focus names in JetBrains Mono bold, not Syne.

**What changed:**
- **The "other apps" chip.** It sits in the top-right corner of the player's cover
  (`.np-sys`, `data-toggle="sysMedia"`). It is the same switch as Settings → Other apps,
  wired by the generic `[data-toggle]` binding.
  - On: a lit dot in the focus colour.
  - Off: grey and struck through. FLOW goes back to its own library and visualiser, and the
    bridge stops.
- **Pill names in mono.** The pill's named open session (`.tag.named`) and the large pill's
  name (`.sz-l .nm`) are JetBrains Mono 800, no longer Syne. Timer rows, docked capsules and
  the "time's up" banners were already mono. Syne stays for the clock, the wordmark, the "!"
  glyphs and the palette names.

**Verified:** `npm run test:ui` passes. New checks: the chip shows on; one click turns
`sysMedia` off and the chip follows. Packed (`np-sys` is in the asar).

## 2026-10-21 — the pill's "+" and its panel

Two points of Hugo's nine-point list (the other seven were CORE's, see `core/CORE.md` 0.3.0).

**Hugo's asks:**
- "Make the + button to add a timer less swift: the space between the pill and the + actually
  hides the +."
- "Make the focus menu in the pill a smoother transition, snappy and poppy."

**What was wrong with the "+":** the page only keeps the pill's window clickable over the pill,
a capsule, the panel or the "+" (`setHit`). The 6 px gap between them is the `.group` itself, so
crossing it switched the window to click-through. On Windows that drops the hover state, so
`.group:hover` ended and the "+" folded away (a 0.42 s bounce) before the pointer reached it.

**What changed:**
- **The gap counts.** `.group` is part of the hit area (`pill.js`).
- **The "+" is calmer.** It comes in over 0.6 s (opacity slightly behind), and once the pointer
  leaves it waits 0.5 s before folding away. Its plus turns a quarter on hover and dips on click.
- **The panel pops** (the session panel, the start panel, the timers): it springs out of the
  pill's side (`--pop`, a small overshoot, from above or below as it opens) and its rows follow
  one after the other. Closing, main sends `pill:panel` `out`, the panel shrinks away in 0.15 s,
  then the window is made small again (`setPanel`).
- **The hover controls pop in** one after another (from the content outwards, whichever way the
  pill grows).
- Motion "still" turns all of it off.

**Verified:** `npm run test:ui` passes. New checks: over the gap the window still takes clicks
(`_test.ignoring`) and the "+" stays; off the group it waits, then folds; the panel's animation
is `panel-in…`, closing plays `out` first, then it is hidden. Packed (`panel-in-up` in the asar).

## 2026-10-21 (evening) — the pill's own sizes, timers that ding, a timer from CORE (1.3.0)

From Hugo's `curate/claude_requests_final.md` ("the final list of fixes before I use the new
box"): one FLOW point, and two of CORE's ten land here (see `core/CORE.md` 0.5.0).

**Hugo's asks:**
- "actual control of the pill width/height in all 3 sizes, elements dynamically positioning"
- (CORE) after a Claude request launch, a "how long?" window with presets → **a FLOW timer**
- (CORE) a ding / notification above the visible timer every x seconds / minutes / hours

**What changed:**
- **Each pill size has its own width and height** (Settings → Pill → Width and height: two
  sliders per size, the current size highlighted, reset per size). `pill-main.js`: `dims` in the
  config, bounds in `DIMS` (S 120–480 × 20–64, M 300–1100 × 22–64, L 320–1200 × 28–80), the
  defaults being the old `SIZES`. The idle pill is never wider than its size.
- **The parts follow.** `pill.css`: the time, buttons, tag, bars, visualiser, mark and start
  button size from `--h` (clamped; at the default sizes they give the old pixels back).
  `pill.js` `fitParts()`: as a size gets narrower its least important parts give way, in order
  (M: "break in…" → the phase word → the tag → the visualiser → the bars; L: the song → the
  name → bars → visualiser; S: visualiser → bars). Read off the width at rest, so the hover
  growth never reshuffles them. A large pill too low for two lines goes to one (`l-flat`).
- **Timers ding every so often** (`timers-main.js`): a timer's `every` (≥ 10 s, below its
  length) and `nextDing`; a 1 s loop dings it, but not in its last 1.5 s (the end rings anyway).
  A ding is a soft note (unless the sound is off), a bubble over the timer's row with the time
  left (`tmUI.ding`), and a note on the pill when docked. A bell marks the timers that ding.
  The edit form has "every"; Settings → Timers → "Ding every" is the default for new ones
  (empty = never).
- **A timer from the command line**: `--flow-timer=15m --flow-timer-name=… --flow-timer-every=…`,
  read at start and from a second instance (`main.js` → `timers.fromArgs`). It turns the timers
  on if they were off. CORE's "how long?" uses it.
- Small: the new-timer drop closes when the window loses focus (it stayed open over a collapsed
  field when FLOW wasn't focused), and a row's buttons close it too.

**Verified:** `npm run test:ui` passes. New checks: `--flow-timer` adds a 15-min timer dinging
every 10 s; no timer for other arguments; `everyOf` / `parseDur`; one ding at the due time with
the right text, the next one scheduled, the bubble and the bell on screen
(`shot-15-timers-ding`); "every" from the edit form; the default for new timers; the pill at
M 400×40 drops "break in…", the phase word and the tag and its time grows, at 800×26 shows everything
(`shot-15-pill-m-*`); six sliders in settings, a slider sets it, reset
(`shot-15-settings-pill-dims`). Packed (`fromArgs`, `fitParts`, `buildPillDims` in the asar).
Not tried: a real launch from the packed CORE into the packed FLOW.

## 2026-10-21 (night) — CPU: draw only what's seen (1.3.1)

Hugo's request `r261021-1ey8` (prompter): "optimize to run app, it uses to much cpu" — "up to 8%
for flow, and 5% for core", "also applicable to flow and all the other apps". This run: CORE
(`core/CORE.md` 0.6.1) and FLOW; the other apps stay open in the request.

**Measured first:** `npm run perf` (new, `test/perf.cjs`). It uses a temp profile and a private link
pipe. Other apps' media is turned off and FLOW plays its own generated loop with the bus cut off from
the speakers, so the analyser hears music and the room doesn't. Electron's per-process counters plus
FLOW's PowerShell helpers, as % of the whole CPU (Task Manager's figure, 12 threads):

| state (music on) | before | after, at rest | after, in use |
| --- | --- | --- | --- |
| standard | 5.60 % | 1.12 % | 2.61 % |
| minimal | 5.09 % | 0.91 % | 2.39 % |
| full screen | 5.55 % | 2.41 % | 2.43 % |
| mini bar | 3.54 % | 0.54 % | 0.55 % |
| hidden | 4.62 % | 0.33 % | 0.33 % |
| hidden + pill | 7.50 % | 1.03 % | 1.02 % |

**What cost it** (by turning things off one at a time):
- the covers' turning shapes, a CSS animation on SVG shapes: the big cover redrawn 60 times a
  second, ~3 %, and still going with FLOW hidden (`backgroundThrottling: false` keeps a hidden page
  painting);
- the draw loop: the dial redrawn at 60 fps even with nothing changing, ~2 %. A rAF that returns
  early still costs a frame, so lowering the fps alone saved little;
- the pill: its music bars 30 times a second, each eased, plus its progress fill eased on every
  250 ms tick. It's a see-through window over everything, so each redraw sends the whole window
  again: ~1–3 %;
- progress fills (mini bar, full screen, timers) set every second with `transition: width 1s`: never
  still, a relayout every frame;
- the film grain's `soft-light` blend multiplies every redraw under it (~0.7 %). It was left as it
  is: the look stays, and there are far fewer redraws now.

**What changed:**
- **The draw loop's pace** (`loopFps()`, `kick()`):
  - nothing on screen (hidden, minimised): it stops; shown again, modes, focus, visibility and
    play restart it;
  - the mini bar: only its little cover turns, 15 times a second while music plays;
  - in use (focus, or the pointer moved over FLOW in the last 8 s) and full screen: `settings.fps`;
  - otherwise 20 fps, unless Settings → Visualiser → "Slow down when you're elsewhere" (`restSlow`,
    on) is off.

  Below 50 fps a timer wakes it for the next frame.
- **The covers turn from the loop** (`spinArt`): 15 times a second while music plays, holding their
  angle when it stops. The CSS animation is gone.
- **No more eased progress fills** where they're set every second or faster: `.mini-bar i`,
  `.zen-progress i`, the pill's `.bars b` and docked `.tb b`, the timers' `.tm-bar b`. They move a
  fraction of a pixel per step anyway.
- **The pill's music bars:** 20 a second, no easing.

**Verified:** `npm run test:ui` passes. New checks: 20 fps at rest, `settings.fps` in use and with
"slow down" off; hidden stops the loop and showing restarts it; no CSS animation on a cover; a probe
cover turns while music plays and holds still when it stops. `npm run perf` before / after, as in
the table. Packed (`loopFps`, `spinArt`, `restSlow` in the asar, no `animation:spin 26s`).

## 2026-10-22 — positions that stay, full screen below CORE's bar, views from CORE (1.4.0)

Three of Hugo's prompter requests (log `updates/26-10-22_update_v1.4.0.md`):
- `r261022-z257` "flow remembers window position of both pill and main window — pill needs to
  remember where the pill was and where the main window was. it needs to function independently of
  the layouts."
- `r261022-7fzl` "top monitor fix — in my top monitor, when i select the full screen view of flow,
  it goes under the bar, i would like the full screen view of flow in the top monitor to exclude the
  area of the core bar / mini view."
- FLOW's half of CORE's `r261022-ec85`: "if i right click on flow i can select view modes for the
  app (and each one opens at the last position)".

**Why the window moved.** `win-state.json` held the right place, but `boundsFor` only kept it when
it fitted a monitor's *work area*. CORE's bar is an AppBar: it takes the top 240 px (56 for the
minimal bar) out of its monitor's work area. Hugo's standard view was saved at y = −1376, just under
the minimal bar on the top monitor. With the bigger bar up, that counted as off screen, and FLOW came
back in the middle of the main monitor; a CORE layout was the only thing putting it back. Now
`homeOf` finds the monitor holding most of the saved rect (by its bounds) and `fitIn` moves it into
that monitor's work area, shrinking only if it has to. The mini view does the same.
**The pill** was found by its display id only; Windows can renumber a monitor (a restart, a cable),
and the pill then went to the main one. `pos.db` now keeps the monitor's bounds too: the id, else
the same bounds, else its own point (older `pill.json`), else the main monitor.

**Full screen below the bar.** On a monitor whose work area starts lower than its top (`topBand`),
full screen is now a plain window over the monitor minus that band (`enterSoft` / `leaveSoft`,
`fsSoft`). The renderer is in its full-screen view as before. `display-metrics-changed` makes it
follow the band (bar → minimal bar → line → gone). Already in Windows' full screen when a band
appears: it leaves it and continues below the band (`fsSwitch`). A monitor with a free top (the main
one: its taskbar is at the bottom) still gets Windows' own full screen. The leave path is shared
(`afterFs`).

**Views from outside.** `--flow-view=` is read on a second instance (CORE runs `FLOW.exe
--flow-view=mini`) and at start; main shows the window and sends `win:view`, and the page switches
the way its own buttons do (`setMode`), so each view opens where it was last. `fullscreen` goes to
the monitor full screen was last used on (`state.fsAt`); `pill` toggles the pill.

**Verified:** `npm run test:ui` passes. New checks, with the screens faked (`screen`'s functions,
put back after): Hugo's own saved rect comes back on the top monitor under a 240 px bar; a clean
rect stays exactly; a monitor that's gone lands on the main one. The pill finds its monitor under a
new id by bounds and by point. Full screen with a 120 px band is 120 px lower and follows the band
to 56 px, then comes back where it was (`shot-11-fs-below-bar`). `second-instance` with
`--flow-view=minimal|mini|standard|pill`. The older full-screen checks now accept either kind:
Hugo's CORE bar sits on the main monitor today, so the test window's own full screen is the soft
one. A free-top full screen is not forced in the test: it would make his real CORE bar step aside.
The timers' pop-out drag check now allows a work area that starts below the top. Packed via a side
folder (the dist folder was locked), asar copied over; `homeOf`, `softRect`, `homeDisplay`,
`onView` in it.

## 2026-10-25 — the pill holds its place against other apps (1.4.1)

Hugo's prompter request `r261023-vg7n` "issues with placement — the pill doesn't correctly remember
it's position · sometimes it does turn back on (says it's on but it's hidden) · i think it should be
it's own process so it doesn't mess with window placement memory and all" (log
`updates/26-10-25_update_v1.4.1.md`).

**The cause, found in his CORE settings:** his "code" layout held an entry for FLOW.exe titled
"FLOW pill" (x −2, y 1391, 425×64), saved while the pill was up. CORE's helper listed the pill as one
of FLOW's windows. So opening that layout moved the pill to the saved rect, and `place()` never moved
it back, because it only called `setBounds` when its own rect changed (`boundsKey`). Putting the
layout away is set to *close*, which sent the pill WM_CLOSE: the window went, while `cfg.on` stayed
true. That is "says it's on but it's hidden".

**FLOW:**
- `place()` compares the window's real bounds (±2 px) with where it belongs.
- A move, hide or minimise that FLOW didn't make calls `heal()` (250 ms later, backing off after 6
  in 10 s). A close it didn't ask for is refused while the pill is on, until FLOW quits
  (`before-quit`).
- A 5 s look covers what no event reports (a window gone, hidden by another app).

**CORE 0.12.0** (its half): the helper no longer lists windows that can't be activated
(WS_EX_NOACTIVATE without WS_EX_APPWINDOW: alt-tab's own rule; the pill is `focusable: false`), so
no layout can catch it again. An entry saved before ("FLOW pill" / "FLOW timer") is dropped.

**"Its own process":** not done. CORE knows windows by their exe, and a second process would still be
FLOW.exe, so it wouldn't have kept CORE away. What CORE needed was to stop treating the pill as a
window it can place and close, and it now does.

**Verified:** `npm run test:ui` passes. New checks on the test's own pill:
- moved and resized by "another app" (`setBounds`): back in its place;
- `close()`: still up;
- `hide()` and `minimize()`: shown again.

Packed via a side folder (FLOW was running) and the asar copied over; `heals.push` is in it.

## Open follow-ups
- The visualiser was tuned on a generated loop. Real tracks may want a different default
  sensitivity (Settings → Visualiser → Sensitivity).
- Installer is unsigned (SmartScreen warning for recipients). Signing would need a certificate.
- Bump `version` in `package.json` before building a new installer to send, so recipients can tell builds apart.
- Optional: slim down via Tauri (~5 MB) later.
- Other apps: volume can't be controlled (SMTC has no volume); per-app volume would need
  Core Audio interop in the bridge. Shuffle/repeat are not mapped, though SMTC exposes them.
- Loopback hears *everything* on the default output device (notifications, other tabs),
  not only the app shown. Chromium has no per-process loopback here.
- Pill: only a horizontal taskbar is snapped to (a vertical one leaves it free). Spots
  are read on the primary taskbar only; on a secondary one it snaps to the band and the
  edges. Not yet seen: an auto-hiding taskbar, or a monitor at a scale other than 100%.
- Pill: FLOW must be running for it. Starting FLOW with Windows straight to the tray (pill
  only) was discussed but not built.
- Timers beside the pill: a group wider than the room beside its snap spot stops at the
  screen's edge and can cover taskbar icons (five timers + an M pill at the icons' left).
- Timers: quitting FLOW ends them (Hugo: no need to save them). The overlay also pops over
  full-screen apps (games, videos); the pill's full-screen detection could gate it. The real
  Windows notification isn't exercised by the test (stubbed).
