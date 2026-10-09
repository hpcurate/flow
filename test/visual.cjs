/* FLOW GUI check — loads the real main.js in a throwaway profile, drives every
   view and style with a generated music track, asserts on window bounds,
   layout fit, persistence and renderer errors, and saves shot-*.png to read.
   Run: npm run test:ui   (FLOW_LOG=1 also echoes the renderer console) */
const {app,BrowserWindow}=require('electron');
const fs=require('fs');
const os=require('os');
const path=require('path');
const assert=require('assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'flow-test-'));
app.setPath('userData',profile);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const errors=[];
app.on('web-contents-created',(_,contents)=>{
  contents.on('console-message',(_e,level,message)=>{ if(level>=3) errors.push(message); if(process.env.FLOW_LOG) console.log('[renderer]',message); });
  contents.on('did-fail-load',(_e,code,description)=>errors.push(`${code}: ${description}`));
});
require('../main.js');
const pause=ms=>new Promise(r=>setTimeout(r,ms));

// a 12 s, 120 bpm loop: swept kick, a breathing pad chord, off-beat hats and a plucked lead
const WAV=`(async(name,secs,lead)=>{
  const rate=22050,n=rate*secs,buf=new ArrayBuffer(44+n*2),d=new DataView(buf);
  const str=(o,s)=>[...s].forEach((c,i)=>d.setUint8(o+i,c.charCodeAt(0)));
  str(0,'RIFF');d.setUint32(4,36+n*2,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
  d.setUint32(24,rate,true);d.setUint32(28,rate*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,n*2,true);
  let prev=0;
  for(let i=0;i<n;i++){
    const t=i/rate,b=t%.5,h=(t+.25)%.5;
    const kick=Math.sin(2*Math.PI*(45*b+75/12*(1-Math.exp(-12*b))))*Math.exp(-b*9);
    const pad=(Math.sin(2*Math.PI*220*t)+Math.sin(2*Math.PI*277.2*t)+Math.sin(2*Math.PI*329.6*t))*.12*(.6+.4*Math.sin(t*1.3));
    const w=Math.random()*2-1,hat=(w-prev)*Math.exp(-h*60)*.35; prev=w;
    const pl=Math.sin(2*Math.PI*lead*(1+(Math.floor(t*2)%3)/12)*t)*.1*Math.exp(-((t*4)%1)*3);
    d.setInt16(44+i*2,Math.max(-1,Math.min(1,(kick*.8+pad+hat+pl)*.5))*32767,true);
  }
  return new File([buf],name,{type:'audio/wav'});
})`;
// visible controls must sit inside the window, and no card may overflow
const FIT=`(()=>{const bad=[],vw=innerWidth,vh=innerHeight;
  document.querySelectorAll('button,input,.clock,.cycle,.np-title,.today').forEach(e=>{
    if(!e.checkVisibility({visibilityProperty:true}))return;const r=e.getBoundingClientRect();if(!r.width||!r.height)return;
    if(r.left<-1||r.top<-1||r.right>vw+1||r.bottom>vh+1)bad.push((e.id||e.className)+' @'+[r.left,r.top,r.right,r.bottom].map(Math.round));});
  for(const sel of ['.stage','.np','.ambience','.side','.stage-bottom']){const e=document.querySelector(sel);
    if(e&&e.checkVisibility()&&e.scrollHeight>e.clientHeight+2)bad.push(sel+' overflows '+e.scrollHeight+'>'+e.clientHeight);}
  const c=document.querySelector('.app .clock'),s=parseFloat(getComputedStyle(document.getElementById('stage')).getPropertyValue('--S'));
  if(c&&c.checkVisibility()&&c.getBoundingClientRect().width>s*.72)bad.push('clock wider than its dial '+c.getBoundingClientRect().width+' vs S '+s);
  return bad;})()`;

app.whenReady().then(async()=>{
  try{
    await pause(300);
    const win=BrowserWindow.getAllWindows()[0];
    if(win.webContents.isLoading()) await new Promise(r=>win.webContents.once('did-finish-load',r));
    win.webContents.setAudioMuted(true);
    await pause(900);
    const run=code=>win.webContents.executeJavaScript(code,true);
    const shot=async name=>fs.writeFileSync(path.join(__dirname,`../shot-${name}.png`),(await win.webContents.capturePage()).toPNG());
    const fit=async where=>{ const bad=await run(FIT); assert.equal(bad.length,0,where+': '+bad.join(' | ')); };
    const initial=win.getBounds();
    assert.equal(initial.width,1160); assert.equal(initial.height,820);
    await shot('1-standard-empty'); await fit('standard, empty');

    // real audio through the real graph
    await run(`(async()=>{const W=${WAV};await addFiles([await W('Night drive.wav',12,660),await W('Low tide.wav',12,494)]);play(0);return 1})()`);
    await pause(1600);
    const audioState=await run(`({playing:!audio.paused,dur:audio.duration,graph:!!analyser,level:Viz.A.level,bass:Viz.A.bass,pulse:Viz.A.pulse})`);
    assert(audioState.playing&&audioState.graph&&audioState.dur>11,JSON.stringify(audioState));
    assert(audioState.level>.03,'music should reach the analyser: '+JSON.stringify(audioState));

    // timer running at 40% through each timer visual
    await run(`pomStart();pom.remaining=Math.round(pom.total*.6);$('intention').value='Draft the chapter outline';$('intention').dispatchEvent(new Event('input'));renderPom();0`);
    await pause(700); await shot('2-standard-orbit'); await fit('standard, orbit');
    for(const s of ['eclipse','mosaic','tide']){ await run(`setSetting('timerStyle','${s}');0`); await pause(600); await shot('3-timer-'+s); }
    await run(`pomPause();selectPhase('break');pom.remaining=Math.round(pom.total*.3);renderPom();0`); await pause(500); await shot('3-timer-tide-break');
    await run(`selectPhase('focus');pomStart();pom.remaining=Math.round(pom.total*.55);renderPom();setSetting('timerStyle','orbit');0`);

    // palettes × darkness
    for(const [t,d,ts] of [['synth','darker','eclipse'],['ember','black','mosaic'],['graphite','dark','orbit'],['abyss','black','tide'],['acid','darker','orbit'],['orchid','dark','eclipse']]){
      await run(`setSetting('theme','${t}');setSetting('depth','${d}');setSetting('timerStyle','${ts}');0`); await pause(500); await shot(`4-theme-${t}-${d}`);
    }
    await run(`setSetting('theme','bauhaus');setSetting('depth','darker');setSetting('timerStyle','orbit');0`);

    await run(`setSide('library');0`); await pause(300); await shot('5-library'); await fit('library');
    await run(`setSide('player');0`);
    for(const tab of ['look','timer','viz','window']){ await run(`openDrawer('${tab}');0`); await pause(500); await shot('6-settings-'+tab); }
    await run(`closeDrawer();0`); await pause(400);

    // minimal view
    await run(`setMode('minimal');0`); await pause(900);
    let b=win.getBounds(); assert.equal(b.width,400); assert.equal(b.height,660);
    assert.equal(b.x+b.width,initial.x+initial.width,'minimal keeps the top-right corner on first use');
    await shot('7-minimal'); await fit('minimal');
    await run(`setSetting('timerStyle','tide');0`); await pause(400); await shot('7-minimal-tide');
    await run(`setSetting('timerStyle','orbit');0`);
    win.setBounds({...b,width:340,height:520}); await pause(500); await shot('7-minimal-smallest'); await fit('minimal at its minimum size');
    win.setBounds(b); await pause(500);

    // mini bar from minimal, and back
    await run(`enterMini();0`); await pause(700);
    b=win.getBounds(); assert.equal(b.width,360); assert.equal(b.height,142); assert(win.isAlwaysOnTop());
    await shot('8-mini');
    await run(`pomPause();0`); await pause(500); assert.equal(win.getBounds().height,84);
    await run(`exitMini();0`); await pause(700);
    b=win.getBounds(); assert.equal(b.width,400); assert.equal(b.height,660); assert(!win.isAlwaysOnTop());
    await run(`setMode('standard');pomStart();0`); await pause(800);
    assert.deepEqual(win.getBounds(),initial,'standard restores its own bounds');

    // full screen, every visualiser on real audio
    await run(`enterZen();0`); await pause(1500);
    assert(win.isFullScreen());
    for(const s of ['bauhaus','orbit','monolith','strata','burst','float']){ await run(`setSetting('vizStyle','${s}');0`); await pause(1300); await shot('9-fs-'+s); }
    await run(`setSetting('fsContent','timer');setSetting('timerStyle','eclipse');0`); await pause(800); await shot('9-fs-timer-eclipse');
    await run(`setSetting('timerStyle','mosaic');0`); await pause(600); await shot('9-fs-timer-mosaic');
    await run(`setSetting('fsContent','music');setSetting('timerStyle','orbit');setSetting('vizStyle','bauhaus');openDrawer('viz');0`); await pause(700); await shot('9-fs-settings');
    await run(`closeDrawer();exitZen();0`); await pause(1200);
    assert(!win.isFullScreen()); assert.deepEqual(win.getBounds(),initial,'full screen restores the window');

    // a view change requested mid-full-screen is replayed once it has left
    await run(`enterZen();0`); await pause(1400); assert(win.isFullScreen());
    await run(`setMode('minimal');0`); await pause(1500);
    b=win.getBounds(); assert(!win.isFullScreen()); assert.equal(b.width,400); assert.equal(b.height,660);
    await run(`setMode('standard');0`); await pause(800); assert.deepEqual(win.getBounds(),initial);

    // standard view at its minimum and at a big size
    win.setBounds({...initial,width:880,height:640}); await pause(600); await shot('10-standard-min'); await fit('standard at its minimum size');
    win.setBounds({...initial,width:1600,height:1000}); await pause(600); await shot('10-standard-large'); await fit('standard large');
    win.setBounds(initial); await pause(700);

    // persistence across a reload
    await run(`pomPause();setSetting('theme','orchid');setSetting('timerStyle','mosaic');setSetting('vizStyle','burst');setSetting('vizSens',1.6);0`);
    win.reload(); await new Promise(r=>win.webContents.once('did-finish-load',r)); await pause(900);
    const kept=await run(`({theme:settings.theme,ts:settings.timerStyle,viz:settings.vizStyle,sens:settings.vizSens,tracks:tracks.length,intention:$('intention').value})`);
    assert.deepEqual(kept,{theme:'orchid',ts:'mosaic',viz:'burst',sens:1.6,tracks:2,intention:'Draft the chapter outline'});
    const st=JSON.parse(fs.readFileSync(path.join(profile,'win-state.json'),'utf8'));
    assert.equal(st.mode,'standard'); assert.equal(st.bounds.minimal.width,400);

    assert.equal(errors.length,0,errors.join('\n'));
    console.log(JSON.stringify({result:'PASS',audio:audioState,initial,profile},null,2));
    app.exit(0);
  }catch(error){ console.error(error); console.error('renderer errors:',errors); app.exit(1); }
});
