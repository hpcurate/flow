/* throwaway GUI driver — loads the real main.js, drives Zen mode, screenshots, reports bounds */
require('./main.js');
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(1500); // let main.js create + load the window
  const win = BrowserWindow.getAllWindows()[0];
  const shot = async n =>
    fs.writeFileSync(path.join(__dirname, n), (await win.webContents.capturePage()).toPNG());

  const before = win.getBounds();
  await shot('shot-1-main.png');

  await win.webContents.executeJavaScript('enterZen(); 0');
  await sleep(900);
  // no track is playing in this scripted run — feed a fake spectrum so the visualizer has data
  await win.webContents.executeJavaScript(`
    analyser = null;
    zenData = new Uint8Array(128);
    for (let i = 0; i < 128; i++) zenData[i] = Math.max(0, 215 - i * 1.7 + Math.sin(i * 0.9) * 45);
    0`);
  await sleep(1600); // let the smoothed bands ease up to the injected values
  const fsOn = win.isFullScreen();
  await shot('shot-2-zen.png');

  await win.webContents.executeJavaScript('exitZen(); 0');
  await sleep(1200);
  const after = win.getBounds();
  await shot('shot-3-restored.png');

  console.log(JSON.stringify({ before, fsOn, after, stillFs: win.isFullScreen() }));
  app.exit(0);
});
