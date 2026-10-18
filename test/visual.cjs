/* FLOW GUI check — loads the real main.js in a throwaway profile, drives every
   view and style with a generated music track, asserts on window bounds,
   layout fit, persistence and renderer errors, and saves shot-*.png to read.
   Run: npm run test:ui   (FLOW_LOG=1 also echoes the renderer console) */
const {app,BrowserWindow,ipcMain,shell}=require('electron');
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
// the TUTOR link listens on a private pipe, so a running FLOW or TUTOR is never touched
process.env.FLOW_LINK_PIPE='\\\\.\\pipe\\flow-test-'+process.pid;
const {restyleShortcuts}=require('../main.js');
// the media bridge reads the real Windows sessions, but a test must never press play / skip
// on the user's actual player: commands are recorded here instead of reaching it
const sysSent=[];
ipcMain.removeAllListeners('sys:cmd');
ipcMain.on('sys:cmd',(_e,c)=>sysSent.push(c));
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
    // the taskbar/tray icon is redrawn in the theme: its 32px image must show the titlebar
    // mark's colours at each shape's centre, on the theme's background
    const iconMatches=async where=>{
      const th=await run(`({bg:TH.bg,k:[TH.c[0],TH.c[1],TH.c[2],TH.c[4]]})`);
      const st=JSON.parse(fs.readFileSync(path.join(profile,'win-state.json'),'utf8'));
      assert.deepEqual({bg:st.bg,k:st.mark},th,where+': theme reached main');
      const ico=fs.readFileSync(path.join(profile,'icons','flow-'+[th.bg,...th.k].map(c=>c.slice(1).toLowerCase()).join('-')+'.ico'));
      let png=null;
      for(let i=0;i<ico.readUInt16LE(4);i++) if(ico[6+16*i]===32) png=ico.subarray(ico.readUInt32LE(6+16*i+12),ico.readUInt32LE(6+16*i+12)+ico.readUInt32LE(6+16*i+8));
      let o=8; const idat=[];
      while(o<png.length){ const len=png.readUInt32BE(o); if(png.toString('ascii',o+4,o+8)==='IDAT') idat.push(png.subarray(o+8,o+8+len)); o+=12+len; }
      const raw=require('zlib').inflateSync(Buffer.concat(idat));   // mark.js writes filter-0 rows
      const at=(x,y)=>'#'+[0,1,2].map(c=>raw[y*129+1+x*4+c].toString(16).padStart(2,'0')).join('');
      assert.deepEqual([at(9,9),at(23,9),at(9,22),at(22,19),at(16,30)],[...th.k,th.bg].map(c=>c.toLowerCase()),where+': icon colours');
    };
    const initial=win.getBounds();
    assert.equal(initial.width,1160); assert.equal(initial.height,820);
    // other apps stay out of the way until their own section below (whatever is playing on this PC)
    await run(`setSetting('sysMedia',false);window.Notification=function(){};0`); await pause(300);
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
      await iconMatches(`${t}/${d}`);
    }
    await run(`setSetting('theme','bauhaus');setSetting('depth','darker');setSetting('timerStyle','orbit');0`);
    await pause(300); await iconMatches('bauhaus/darker');

    // shortcuts: only the ones that open this exe are pointed at the new icon (a fake exe and
    // a temp folder here — the real Start menu is never touched by a dev or test run)
    const lnkDir=path.join(profile,'lnk'),exe=path.join(profile,'FLOW.exe'),other=path.join(profile,'other.exe'),icon=path.join(profile,'x.ico');
    fs.mkdirSync(path.join(lnkDir,'sub'),{recursive:true}); fs.writeFileSync(exe,''); fs.writeFileSync(other,'');
    for(const [f,target] of [['flow.lnk',exe],['sub/FLOW.lnk',exe],['other.lnk',other]]) assert(shell.writeShortcutLink(path.join(lnkDir,f),{target}),f);
    assert.equal(restyleShortcuts(icon,[lnkDir],exe),2,'both FLOW shortcuts restyled');
    assert.equal(shell.readShortcutLink(path.join(lnkDir,'sub/FLOW.lnk')).icon,icon);
    assert.notEqual(shell.readShortcutLink(path.join(lnkDir,'other.lnk')).icon,icon,'another app\'s shortcut left alone');
    assert.equal(restyleShortcuts(icon,[lnkDir],exe),0,'nothing rewritten when already current');

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

    // other apps (Spotify & co.), first through the real bridge: it must report something, and if
    // a player is actually playing, the visualiser must hear it through the system loopback
    await run(`audio.pause();setSetting('sysMedia',true);0`);
    let real=null;
    for(let i=0;i<40&&!(real&&real.seen);i++){ await pause(250); real=await run(`({seen:sysSeen,err:sysErr,src,sys:sys&&{app:sys.app,title:sys.title,playing:sys.playing}})`); }
    assert(real.seen&&!real.err,'the media bridge should report: '+JSON.stringify(real));
    let live=null;
    if(real.sys&&real.sys.playing){
      await pause(2500);
      live=await run(`({src,vizLoop,loopErr,level:Viz.A.level,app:sys.app,art:!!document.querySelector('#cover .art-img')})`);
      assert(live.src==='sys'&&live.vizLoop,'a playing app should drive the visualiser: '+JSON.stringify(live));
      assert(live.level>.02,'system audio should reach the analyser: '+JSON.stringify(live));
      await shot('11-sys-live');
    }

    // then a scripted session: stop the real bridge and feed the page directly
    ipcMain.emit('sys:enable',{},false); await pause(1200);
    const ART=`(()=>{const c=document.createElement('canvas');c.width=c.height=300;const x=c.getContext('2d');
      x.fillStyle='#16233f';x.fillRect(0,0,300,300);x.fillStyle='#ff4f2e';x.beginPath();x.arc(105,115,72,0,7);x.fill();
      x.fillStyle='#ffc23d';x.fillRect(150,150,118,118);x.fillStyle='#f2ede4';x.fillRect(32,236,96,18);return c.toDataURL();})()`;
    const SYS=o=>`onSys(Object.assign({t:'state',app:'Spotify.exe',title:'Out Of Your Depth - Skellytn Remix',artist:'Fourward',album:'Out Of Your Depth',
      status:'Playing',pos:62,dur:208.3,at:Date.now(),prev:true,next:true,seek:true,key:'k1'},${JSON.stringify(o||{})}));0`;
    await run(SYS()); await run(`onSys({t:'art',key:'k1',url:${ART}});0`); await pause(500);
    let v=await run(`({src,title:$('np-title').textContent,sub:$('np-sub').textContent,img:!!document.querySelector('#cover .art-img'),
      loop:$('loop-btn').disabled,pauseIco:$('play-ico').innerHTML.includes('rect'),tray:trayTip})`);
    assert.equal(v.src,'sys'); assert.equal(v.title,'Out Of Your Depth - Skellytn Remix'); assert.equal(v.sub,'Spotify · Fourward');
    assert(v.img&&v.loop&&v.pauseIco&&v.tray.includes('♪ Out Of Your Depth'),JSON.stringify(v));
    await shot('11-sys-standard'); await fit('standard, another app');

    // the transport drives the other app: play/pause, skip, seek
    sysSent.length=0;
    await run(`$('play-btn').click();$('next-btn').click();$('seek').value=500;$('seek').dispatchEvent(new Event('change'));0`); await pause(200);
    assert.deepEqual(sysSent.map(c=>c.cmd),['toggle','next','seek']);
    assert(Math.abs(sysSent[2].arg-104.15)<.5,'seek to half way: '+sysSent[2].arg);
    v=await run(`({playing:sys.playing,src,playIco:$('play-ico').innerHTML.includes('path')})`);
    assert(!v.playing&&v.src==='sys'&&v.playIco,'a paused app keeps the panel: '+JSON.stringify(v));

    // FLOW's own track takes the panel (and the visualiser) while it plays, and keeps it when paused
    await run(`play(0);0`); await pause(600);
    v=await run(`({src,title:$('np-title').textContent,vizLoop,loop:$('loop-btn').disabled})`);
    assert.deepEqual(v,{src:'flow',title:'Night drive',vizLoop:false,loop:false});
    await run(`audio.pause();0`); await pause(200);
    assert.equal(await run(`src`),'flow','paused FLOW keeps the panel');
    await run(SYS()); await pause(300);
    assert.equal(await run(`src`),'sys','the other app playing again takes it back');

    // the timer's music sync pauses the other app for a break and resumes it after
    sysSent.length=0;
    await run(`selectPhase('focus');pomStart();pomSkip();0`); await pause(300);
    assert.deepEqual(sysSent.map(c=>c.cmd),['pause']);
    await run(`pomSkip();0`); await pause(300);
    assert.deepEqual(sysSent.map(c=>c.cmd),['pause','play']);

    // every view shows it
    await run(`openDrawer('viz');0`); await pause(500); await shot('11-sys-settings');
    assert((await run(`$('sys-status').textContent`)).startsWith('Now: Spotify · Out Of Your Depth'));
    await run(`closeDrawer();setMode('minimal');0`); await pause(900); await shot('11-sys-minimal'); await fit('minimal, another app');
    await run(`enterMini();0`); await pause(700); await shot('11-sys-mini');
    assert.equal(await run(`$('mini-sub').textContent`),'Spotify · playing');
    await run(`exitMini();setMode('standard');0`); await pause(900);
    await run(`enterZen();0`); await pause(1500); await shot('11-sys-fs');
    v=await run(`({t:$('zen-track').textContent,tt:$('zen-tt').textContent,art:!!document.querySelector('#zen-art .art-img')})`);
    assert(v.t==='Out Of Your Depth - Skellytn Remix — Fourward'&&v.tt.startsWith('Spotify · 1:')&&v.art,JSON.stringify(v));
    await run(`exitZen();0`); await pause(1200); assert.deepEqual(win.getBounds(),initial);

    // switched off, FLOW is back to its own library
    await run(`setSetting('sysMedia',false);0`); await pause(300);
    v=await run(`({src,sys:!!sys,title:$('np-title').textContent,loop:$('loop-btn').disabled,vizLoop})`);
    assert.deepEqual(v,{src:'flow',sys:false,title:'Night drive',loop:false,vizLoop:false});
    await run(`setSetting('sysMedia',true);0`);

    // the TUTOR link: a stand-in TUTOR on the pipe runs the clock, FLOW mirrors it, follows its
    // breaks with the music and sends its own timer buttons back; unlinking restores FLOW's timer
    const net=require('net');
    const linkTo=async()=>{
      const s=net.connect(process.env.FLOW_LINK_PIPE), got=[]; let buf='';
      await new Promise((r,j)=>{ s.once('connect',r); s.once('error',j); });
      s.setEncoding('utf8');
      s.on('data',d=>{ buf+=d; let i; while((i=buf.indexOf('\n'))>=0){ const l=buf.slice(0,i).trim(); buf=buf.slice(i+1); if(l) got.push(JSON.parse(l)); } });
      return {s,got,say:m=>s.write(JSON.stringify(m)+'\n')};
    };
    const SES=o=>Object.assign({t:'session',phase:'focus',running:true,left:1500,total:3000,focus:0,goal:7200,label:'TUTOR'},o);
    await run(`pomPause();selectPhase('break');0`);
    const own=await run(`({phase:pom.phase,remaining:pom.remaining,total:pom.total})`);
    let T=await linkTo();
    T.say({t:'hello',app:'TUTOR',v:1}); T.say(SES()); await pause(600);
    assert.deepEqual(T.got[0],{t:'hello',app:'FLOW',v:1});
    v=await run(`({linked:document.body.classList.contains('linked'),badge:$('link-badge').checkVisibility(),phase:$('pom-phase').textContent,
      total:pom.total,left:pom.remaining,running:pom.running,tray:trayTip})`);
    assert(v.linked&&v.badge&&v.phase==='TUTOR · Focus'&&v.total===3000&&v.left>=1499&&v.left<=1500&&v.running&&v.tray.startsWith('FLOW · linked to TUTOR'),JSON.stringify(v));
    await shot('12-linked'); await fit('standard, linked');
    await run(`audio.pause();0`); await run(SYS()); await pause(300);
    assert.deepEqual(await run(`({src,sync:settings.sync,playing:sys.playing})`),{src:'sys',sync:true,playing:true});
    sysSent.length=0;
    T.say(SES({phase:'break',left:600,total:600})); await pause(400);
    T.say(SES({phase:'focus',left:3000,total:3000})); await pause(400);
    assert.deepEqual(sysSent.map(c=>c.cmd),['pause','play'],'music follows TUTOR\'s break');
    await run(`$('pom-start').click();$('pom-skip').click();pomReset();selectPhase('long');0`); await pause(300);
    assert.deepEqual(T.got.slice(1).map(m=>m.cmd),['toggle','skip'],'FLOW\'s buttons go to TUTOR');
    assert.equal(await run(`pom.total`),3000,'reset and the phase tabs leave TUTOR\'s session alone');
    T.say({t:'bye'}); await pause(400);
    v=await run(`({linked:document.body.classList.contains('linked'),phase:pom.phase,remaining:pom.remaining,total:pom.total})`);
    assert.deepEqual(v,{linked:false,...own},'unlinked, FLOW\'s own timer is back');
    // the badge unlinks from FLOW's side: TUTOR hears bye and the pipe closes
    T=await linkTo(); T.say({t:'hello',app:'TUTOR',v:1}); await pause(300);
    const closed=new Promise(r=>T.s.once('close',r));
    await run(`$('link-badge').click();0`);
    await Promise.race([closed,pause(1500)]);
    assert(T.got.some(m=>m.t==='bye')&&T.s.destroyed,'the badge unlinks: '+JSON.stringify(T.got));
    assert.equal(await run(`document.body.classList.contains('linked')`),false);
    // a second app (GRIND) takes over: the first hears bye, the chip and the clock follow the
    // newcomer, and FLOW's own timer is still underneath when it goes
    T=await linkTo(); T.say({t:'hello',app:'TUTOR',v:1}); T.say(SES()); await pause(400);
    const tClosed=new Promise(r=>T.s.once('close',r));
    const G=await linkTo(); G.say({t:'hello',app:'GRIND',v:1}); G.say(SES({left:1200,total:1500,label:'GRIND'}));
    await Promise.race([tClosed,pause(2000)]); await pause(300);
    assert(T.got.some(m=>m.t==='bye')&&T.s.destroyed,'the first app is told bye: '+JSON.stringify(T.got));
    v=await run(`({chip:$('link-badge').textContent,title:$('link-badge').title,phase:$('pom-phase').textContent,total:pom.total,tray:trayTip})`);
    assert(v.chip==='GRIND'&&v.title.startsWith('Linked to GRIND')&&v.phase==='GRIND · Focus'&&v.total===1500&&v.tray.startsWith('FLOW · linked to GRIND'),JSON.stringify(v));
    await shot('12-linked-grind');
    G.say({t:'bye'}); await pause(400);
    v=await run(`({linked:document.body.classList.contains('linked'),phase:pom.phase,remaining:pom.remaining,total:pom.total})`);
    assert.deepEqual(v,{linked:false,...own},'the takeover kept FLOW\'s own timer');

    // persistence across a reload
    await run(`pomPause();setSetting('theme','orchid');setSetting('timerStyle','mosaic');setSetting('vizStyle','burst');setSetting('vizSens',1.6);0`);
    win.reload(); await new Promise(r=>win.webContents.once('did-finish-load',r)); await pause(900);
    const kept=await run(`({sysMedia:settings.sysMedia,theme:settings.theme,ts:settings.timerStyle,viz:settings.vizStyle,sens:settings.vizSens,tracks:tracks.length,intention:$('intention').value})`);
    assert.deepEqual(kept,{sysMedia:true,theme:'orchid',ts:'mosaic',viz:'burst',sens:1.6,tracks:2,intention:'Draft the chapter outline'});
    const st=JSON.parse(fs.readFileSync(path.join(profile,'win-state.json'),'utf8'));
    assert.equal(st.mode,'standard'); assert.equal(st.bounds.minimal.width,400);

    assert.equal(errors.length,0,errors.join('\n'));
    console.log(JSON.stringify({result:'PASS',audio:audioState,otherApps:{bridge:real.sys,live},initial,profile},null,2));
    app.exit(0);
  }catch(error){ console.error(error); console.error('renderer errors:',errors); app.exit(1); }
});
