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

Standard and minimal each remember their own size and position. FLOW reopens in the last one you used.

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

## Shortcuts

`Space` play/pause · `P` start/pause timer · `F` full screen · `M` minimal ↔ standard · `B` mini player · `V` visualiser style · `T` timer visual · `,` settings · `Esc` close settings / leave full screen

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
