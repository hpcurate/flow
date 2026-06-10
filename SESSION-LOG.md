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

## Open follow-ups
- Visual polish unverified by Claude (no GUI access): miniplayer bar height,
  fixed-window dimensions, nav spacing — quick CSS tweaks once Hugo uses it for real.
- Single-file installer (`FLOW-Setup.exe`) pending the Developer-Mode/admin step above.
- Optional: slim down via Tauri (~5 MB) later.
