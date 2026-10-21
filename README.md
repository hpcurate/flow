# FLOW

A dark, geometric focus app for Windows: a local music player, a Pomodoro timer drawn as bold abstract shapes, and an audio-reactive full-screen visualiser.

Open `dist/FLOW-win32-x64/FLOW.exe`. Keep the executable with the rest of its folder. Everything runs offline; music and settings stay on this PC.

## Views

| View | What it is | Shortcut |
|------|------------|----------|
| **Standard** | Timer stage + player / library. Resizable (min 880×640) and maximisable. | `M` toggles with minimal |
| **Minimal** | Just the timer and the current track, 400×660 by default (min 340×520). The pin keeps it on top. | `M` |
| **Mini** | A 360 px always-on-top bar; it grows a progress row while the timer runs. | `B` |
| **Full screen** | The music visualiser (or the timer visual) with a big clock. | `F`, `Esc` to leave |
| **Pill** | A session bar on top of everything, on or off alongside any view. Snaps to the taskbar. | `O` |
| **Timers** | Quick timers you name on the fly, in every view, or popped out into a window of their own. | `N` for a new one |

Standard and minimal each remember their own size and position. FLOW reopens in the last one you used. The view buttons in the titlebar are icons; point at one and its name slides out. The link chip (TUTOR, GRIND, an open session) does the same.

## Look

Seven dark palettes: Bauhaus, Synth, Ember, Abyss, Acid, Orchid and Graphite. Each comes in three depths: **Dark**, **Darker** (the default) and **Black** (true #000). Motion can be Full, Calm or Still. Film grain is optional. Every track gets its own generated Bauhaus-style cover, recoloured live with the palette.

## Timer

Four timer visuals (`T` cycles them):

- **Orbit**: a thick progress ring with minute ticks and a head that pulses with the bass.
- **Eclipse**: during focus a moon slides across the sun; during a break it slides away again. The digits invert where they cross the sun.
- **Mosaic**: one shape per minute around the dial; each minute that passes fills in with colour.
- **Tide**: a vessel that fills up during focus and drains during a break.

Focus, short and long break lengths, how often the long break comes, and a daily goal. The cycle strip shows your sessions (● focus, ▪ break, ▬ long break) and today's focused time. Optional extras: sync music, so it fades out on breaks and back in for focus; a break track (the cup in the library); a chime; and roll-over into the next phase. Settings → Timer.

## Visualiser

Six styles (`V` cycles them): **Bauhaus**, **Orbit**, **Monolith**, **Strata**, **Burst** and **Float**. Each one reacts to the music and the ambience through a 24-band analyser with beat detection. Settings → Visualiser has:

- a live preview
- sensitivity, smoothing, speed, density and scale
- colour: palette, follow the timer, or mono
- what full screen shows (music or timer visual)
- whether the clock and track are shown
- 30 / 60 fps
- **New composition** to reshuffle the shapes

## Other apps (Spotify & co.)

FLOW also shows what other apps are playing, such as Spotify, a browser tab or Media Player. It reads the same Windows media info the volume flyout uses, so it needs no Spotify account, API or login.

- **Player panel, minimal strip, mini bar and full screen** show the other app's title, artist and artwork, plus its position.
- **Play/pause, previous, next and seek** control that app (`Space` too). Loop and shuffle stay FLOW-only.
- **The visualiser and the timer visuals** react to it: FLOW listens to the system audio output (loopback). Nothing is recorded or sent anywhere.
- **Sync music** pauses the other app for a break and resumes it after.
- When FLOW's own track plays, it takes the panel back. A paused source keeps the panel until the other one starts playing.

Switch it off in Settings → Visualiser → **Other apps**; the status line there shows what FLOW currently sees.

## The pill

A small session bar that sits on top of everything: the same pill as TUTOR's and GRIND's title-bar session bar, on its own. It's a toggle (titlebar **Pill**, `O`, Settings → Window or Pill) that runs alongside whichever view is open, and closing FLOW's window leaves it up.

- **What it shows:** whatever runs the clock. That's TUTOR or GRIND while one is linked (in that app's colours), an **open session**, or FLOW's own timer. It also shows the music as four bars: hover them for the track, click them to play or pause.
- **Open sessions** are FLOW's own sessions for anything that isn't TUTOR or GRIND. They work like GRIND's: a goal, and a break every so often. Name one in the pill's panel or under FLOW's clock, and the names you use come back as one-click picks. Settings → Pill shows today's total, by name.
- **Hand it over:** from a running open session, **TUTOR** or **GRIND** starts that app linked, and its session carries the minutes on. With nothing running, the same buttons start the app's own session linked.
- **"!"** pops when another app takes the clock. An open session caught under it pauses and comes back when that app lets go.
- **Moments:** a flat colour wipes across when a break starts, when it ends and when the goal is reached.
- **No room kept for its controls:** point at it and it grows to show them, away from the side it is held by, so nothing under the pointer moves.
- **Timers beside it:** drop the timers' pop-out against the pill's right end and they dock there, as capsules of the pill's height that open on their own controls when pointed at. A "+" appears on the free side for a new one, and clicking a capsule opens the timers panel. Pull a capsule away from the pill to give the timers their own window again.
- **Place it** anywhere by dragging. Near the taskbar it lies on it and clicks into a spot: beside the icon group, before the tray or at the left edge. It stays above the taskbar, even after the Start menu closes.
- **Settings → Pill:**
  - size (S / M / L), scale and opacity
  - each size's own width and height: what the pill shows grows with its height, and the least important parts ("break in…", the phase, the tag, the visualiser…) give way as it gets narrower
  - what it does with nothing running (start button, dot, hidden)
  - the app's colours or FLOW's
  - snap, lock, click-through (hold Ctrl to reach it)
  - hide over full-screen apps, music bars, moments
  - global shortcuts: `Ctrl+Alt+Shift+O` shows or hides it, `Ctrl+Alt+Shift+P` starts or pauses
  - the open session's goal and breaks
  - where TUTOR and GRIND live

  Right-click the pill for the quick ones.

## Timers

Quick timers, separate from the Pomodoro: "the laundry is done in 2h". Turn them on with **Timers** in the titlebar (or `N`, which also opens the field for a new one).

- **A new one:** type `laundry 2h` and press Enter, or a name and a length in its own box (`25m`, `1h30`, `2h`, `1:30`, `90`, `45s`). The chips under the field fill in a length; the dots pick a colour.
- **Names come back:** as you type, the names you've used before are offered with the colour and length they had. Pick one (click, or ↓ then Enter) and Enter again starts it. The timers themselves aren't saved: quitting FLOW ends them.
- **The field** stays out of sight until you point at the timers. In a card or in full screen it's a "+" that opens into the field; in the pop-out it fades in at the end away from the screen edge, so nothing moves.
- **Each timer** looks like the pill: its name on a tag in its colour, a bar, the time left, and three buttons: **edit** (name, time left, colour, how often it dings, or remove it), **pause**, **reset** (it asks first).
- **Dings on the way:** a timer can ding every so often while it runs (`30s`, `5m`, `1h`; at most every 10 s): a soft note and a bubble over it with the time left, also on the pill when the timers are docked. A bell marks the ones that do. New timers take the default from Settings → Timers; each one's own is in its edit form.
- **From another app:** `FLOW.exe --flow-timer=15m --flow-timer-name="claude · run" [--flow-timer-every=5m]` starts one (a running FLOW takes it; otherwise FLOW starts with it). CORE uses it for "how long will Claude take?".
- **Where they show:** every view, as part of its layout:
  - a Timers card at the bottom of the standard view's side column;
  - the same card under the minimal view, which grows to fit it;
  - compact rows under the mini bar;
  - a row in full screen's bottom bar, after the track.

  The second toggle beside **Timers** pops them out into a small window of their own, on top of everything (drag a timer to move it), or docks them beside the pill. Turned off, they're hidden but still run and still ring.
- **When one ends:** a big "!" pops on the screen your mouse is on, with the timer's name. FLOW rings and a Windows notification waits in the notification centre. The timer turns its colour and pulses until you dismiss it (✓) or start it again (↺).
- **Settings → Timers:**
  - the pop-out's width, opacity, and whether it stays on top
  - the bar filling up or draining
  - showing the time left
  - the order: as added, or soonest first
  - the pop: big, small or none
  - keeping it on screen as a banner at the top until you answer it (ok, +5 min, again)
  - the sound: a bell, ringing until dismissed, or none
  - the Windows notification
  - ding every (the default for new timers; empty = never)
  - the quick lengths
  - a global shortcut (`Ctrl+Alt+Shift+N`)
  - the names it remembers (forget one, or all)

## Shortcuts

`Space` play/pause · `P` start/pause timer · `F` full screen · `M` minimal ↔ standard · `B` mini player · `O` pill on/off · `N` new timer · `V` visualiser style · `T` timer visual · `,` settings · `Esc` close settings / leave full screen

Closing the window hides FLOW to the tray (music keeps playing); quit from the tray menu. Launching FLOW again brings the running one back.

## Development

```sh
npm install
npm start        # run from source
npm run test:ui  # GUI check: drives every view and style, asserts, saves shot-*.png
npm run pack     # rebuild dist/FLOW-win32-x64
```

### Installer to share

```sh
npx electron-builder --win nsis --x64   # → dist/FLOW-Setup-<version>.exe
```

Send that one file. It installs per user (no admin) with desktop and Start Menu shortcuts, and it uninstalls from Settings → Apps. It is unsigned, so Windows shows "Windows protected your PC" the first time: **More info → Run anyway**.

| File | Role |
|------|------|
| `index.html` | markup for all four views and the settings drawer |
| `flow.css` | the theme; colour tokens are written by `app.js` |
| `viz.js` | palettes, audio analysis, every canvas style and the cover-art generator (`window.Viz`) |
| `app.js` | library (IndexedDB), playback, pomodoro, ambience, views, settings, render loop |
| `main.js` / `preload.js` | Electron window: per-view bounds, mini/full-screen transitions, tray, taskbar progress, the media bridge and the system-audio grant |
| `smtc.ps1` | the media bridge: reads the Windows media sessions and relays play/pause/skip (Windows PowerShell 5.1) |

The GUI check runs in a throwaway profile with generated music, so it never touches your library. It does read the real media sessions on this PC, but it intercepts every command, so it never pauses or skips your player.
