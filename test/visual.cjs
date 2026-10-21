/* FLOW GUI check — loads the real main.js in a throwaway profile, drives every
   view and style with a generated music track, asserts on window bounds,
   layout fit, persistence and renderer errors, and saves shot-*.png to read.
   Run: npm run test:ui   (FLOW_LOG=1 also echoes the renderer console) */
const {app,BrowserWindow,ipcMain,shell,screen}=require('electron');
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
// a synthetic pointer: :hover follows it, whatever the real mouse is doing
// (sent again a few times while it waits: the real mouse crossing the window would otherwise take the hover back)
const hover=async(w,x,y,ms=650)=>{ for(let i=0;i<4;i++){ w.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y)}); await pause(ms/4); } };

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
    // the player's own switch for other apps' media: off and on in one click each
    assert.equal(await run(`document.querySelector('.np-sys').classList.contains('on')`),true,'the switch shows it is on');
    await run(`document.querySelector('.np-sys').click();0`); await pause(300);
    assert.equal(await run(`settings.sysMedia`),false,'one click turns other apps off');
    assert.equal(await run(`document.querySelector('.np-sys').classList.contains('on')`),false);
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
    // CORE's chain reads link.json (never the pipe)
    const linkFile=()=>JSON.parse(fs.readFileSync(path.join(profile,'link.json'),'utf8')).linked;
    assert.equal(linkFile(),'TUTOR','link.json names the linked app');
    await shot('12-linked'); await fit('standard, linked');
    // the chip shows the link's logo; its name slides out only while it is pointed at
    const chipW=()=>run(`$('link-badge').querySelector('span').getBoundingClientRect().width`);
    assert.equal(await chipW(),0,'at rest: the logo only');
    let lb=await run(`(()=>{const r=$('link-badge').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await hover(win,lb.x,lb.y);
    assert(await chipW()>20,'pointed at: the name');
    await hover(win,600,500);
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
    assert.equal(linkFile(),null,'link.json clears on bye');
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
    assert.equal(linkFile(),'GRIND','link.json follows the takeover');
    await shot('12-linked-grind');
    G.say({t:'bye'}); await pause(400);
    v=await run(`({linked:document.body.classList.contains('linked'),phase:pom.phase,remaining:pom.remaining,total:pom.total})`);
    assert.deepEqual(v,{linked:false,...own},'the takeover kept FLOW\'s own timer');

    // ── the pill: a session bar on top of everything, alongside the views ──
    const P=require('../main.js').pill._test;
    const launched=[]; P.H.launch=(exe,args)=>launched.push({exe,args});     // TUTOR / GRIND are never really started
    const fakeGrind=path.join(profile,'GRIND.exe'); fs.writeFileSync(fakeGrind,'');
    const pillRun=code=>P.win.webContents.executeJavaScript(code,true);
    const pillShot=async name=>fs.writeFileSync(path.join(__dirname,`../shot-${name}.png`),(await P.win.webContents.capturePage()).toPNG());
    const until=async(fn,what,ms=4000)=>{ const end=Date.now()+ms; while(!(await fn())){ if(Date.now()>end) throw new Error('timed out: '+what); await pause(100); } };
    await run(`pomPause();setSetting('sysMedia',false);togglePill();0`);
    await until(()=>P.shown,'the pill shows');
    await until(async()=>(await pillRun(`!!document.querySelector('#in .go')`)),'the pill page renders');
    await pillRun(`window.__fx=[];pillAPI.on('pill:fx',m=>__fx.push(m));0`);
    assert(await run(`$('pill-btn').classList.contains('on')`),'the titlebar toggle lights');
    const bars=P.bars();
    let r=P.rect, wb=P.win.getBounds();
    assert(wb.x<=r.x&&wb.y<=r.y&&wb.x+wb.width>=r.x+r.w&&wb.y+wb.height>=r.y+r.h,'the window holds the pill');
    if(bars.length){ const b=bars.find(x=>x.primary)||bars[0]; assert(r.snapped&&r.y>=b.y&&r.y+r.h<=b.y+b.height,'first shown on the taskbar: '+JSON.stringify({r,b})); }
    assert.equal(P.compose().src,'idle');
    await pillShot('13-pill-idle');
    // FLOW's window can be hidden to the tray: the pill stays
    win.hide(); await pause(400); assert(P.shown&&P.win.isVisible(),'closing FLOW\'s window leaves the pill up'); win.show(); await pause(300);

    // an open session, named and started from the pill's panel; FLOW's window mirrors it like a link
    P.setPanel('main'); await pause(600);
    await until(async()=>(await pillRun(`!!document.getElementById('p-name')`)),'the start panel');
    await pillShot('13-pill-panel-start');
    await pillRun(`document.getElementById('p-name').value='Mixing the reese';document.querySelector('[data-act=start]').click();0`);
    await until(()=>P.D.open,'the open session starts');
    assert.equal(P.D.open.name,'Mixing the reese'); assert.equal(P.D.open.goalSec,7200); assert.equal(P.D.open.breakEvery,3000);
    await pause(500);
    v=await run(`({linked:document.body.classList.contains('linked'),phase:$('pom-phase').textContent,chip:$('link-badge').textContent,
      intention:$('intention').value,running:pom.running,tray:trayTip})`);
    assert(v.linked&&v.phase==='Mixing the reese · Focus'&&v.chip==='Mixing the reese'&&v.intention==='Mixing the reese'&&v.running&&v.tray.startsWith('FLOW · open session'),JSON.stringify(v));
    assert.equal(P.compose().src,'open');
    // renamed under FLOW's clock, the pill follows
    await run(`$('intention').value='Mixing the reese bass';$('intention').dispatchEvent(new Event('input'));0`);
    await until(()=>P.D.open.name==='Mixing the reese bass','renamed from FLOW');
    await run(`$('intention').blur();0`);
    // a few minutes in, then each size
    P.D.open.focusSec=1680; P.D.open.sinceBreak=1680; P.push(); await pause(400);
    for(const z of ['m','s','l']){ P.set('size',z); await pause(500); await pillShot('13-pill-open-'+z); }
    P.set('size','m'); await pause(300);
    // FLOW's own buttons drive it: start/pause and skip
    await run(`$('pom-start').click();0`); await pause(300);
    assert.equal(P.D.open.running,false,'FLOW\'s pause pauses the open session');
    await pillRun(`document.querySelector('[data-act=toggle]').click();0`); await pause(300);
    assert.equal(P.D.open.running,true,'the pill resumes it');
    await pillRun(`document.querySelector('[data-act=skip]').click();0`); await pause(500);
    assert.equal(P.D.open.phase,'break');
    assert(await pillRun(`__fx.some(m=>m.kind==='break')`),'a break moment plays');
    await pause(250); await pillShot('13-pill-moment-break');
    assert.equal(await run(`document.body.dataset.phase`),'break','FLOW\'s timer follows the break');
    await pillRun(`document.querySelector('[data-act=skip]').click();0`); await pause(400);
    assert.equal(P.D.open.phase,'focus');

    // TUTOR links while the open session runs: "!", the open session waits underneath, paused
    T=await linkTo(); T.say({t:'hello',app:'TUTOR',v:1,k:['#C6F24E','#6FD3FF','#6FD3FF']}); T.say(SES({every:3000})); await pause(250);
    await pillShot('13-pill-bang');
    await pause(500);
    assert(await pillRun(`__fx.some(m=>m.kind==='bang')`),'the "!" pops');
    assert.equal(P.D.open.running,false,'the open session pauses underneath');
    let c=P.compose();
    assert.deepEqual([c.src,c.app,c.k],['link','TUTOR',['#C6F24E','#6FD3FF','#6FD3FF']],'the pill shows TUTOR in its own colours');
    assert.equal(c.s.every,3000); assert(c.under&&c.under.name==='Mixing the reese bass');
    assert.equal(await run(`$('pom-phase').textContent`),'TUTOR · Focus');
    await pause(900); await pillShot('13-pill-linked-tutor');
    P.setPanel('main'); await pause(600); await pillShot('13-pill-panel-linked'); P.setPanel(null); await pause(300);
    // TUTOR goes: the open session takes the clock back, still paused
    T.say({t:'bye'}); await pause(500);
    c=P.compose();
    assert.equal(c.src,'open');
    v=await run(`({linked:document.body.classList.contains('linked'),phase:$('pom-phase').textContent,running:pom.running})`);
    assert(v.linked&&v.phase.startsWith('Mixing the reese bass · Focus')&&!v.running,'the open session is back, paused: '+JSON.stringify(v));

    // handed to GRIND: it is started linked with the minutes; once its session shows them the open session goes
    P.set('grindExe',fakeGrind);
    await pillRun(`document.querySelector('[data-act=toggle]').click();0`); await pause(300);
    const before=Math.round(P.compose().s.focus);
    P.setPanel('main'); await pause(500);
    await pillRun(`document.querySelector('[data-act=link][data-app=GRIND]').click();0`); await pause(300);
    assert.equal(launched.length,1);
    assert.equal(launched[0].exe,fakeGrind);
    const carry=launched[0].args.find(a=>a.startsWith('--flow-carry='));
    assert(launched[0].args[0]==='--flow-link'&&carry,'started linked, with the minutes: '+JSON.stringify(launched));
    const [cs,cf]=carry.slice(13).split(':').map(Number);
    assert(cs===P.D.open.start&&Math.abs(cf-before)<=2,'carries the start and the focus: '+carry);
    const nfx=await pillRun(`__fx.length`);
    const G2=await linkTo(); G2.say({t:'hello',app:'GRIND',v:1}); await pause(200);
    G2.say(SES({label:'GRIND',focus:cf+3,goal:7200,every:3000})); await pause(500);
    assert.equal(P.D.open,null,'adopted by GRIND: the open session is dropped');
    assert(!(await pillRun(`__fx.slice(${nfx}).some(m=>m.kind==='bang')`)),'no "!" for a hand-over');
    assert.equal(P.compose().app,'GRIND');
    assert.deepEqual(P.compose().k,['#FF4F2E','#FFC23D','#14B8A0'],'GRIND\'s colours, known before its hello says them');
    G2.say({t:'bye'}); await pause(500);
    assert.equal(P.compose().src,'idle'); assert.equal(await run(`document.body.classList.contains('linked')`),false);

    // the tally: a finished open session of a minute or more is kept, by name
    await run(`winAPI.pillCmd('start',{name:'Reading'});0`); await until(()=>P.D.open,'started from FLOW');
    await pause(400); P.D.open.focusSec=600; await run(`pomReset();0`); await until(()=>!P.D.open,'reset ends it');
    assert.equal(P.D.done.length,1); assert.equal(P.D.done[0].name,'Reading');
    assert.deepEqual(P.compose().today.by,[{name:'Reading',min:10}]);
    P.setPanel('main'); await pause(500);
    assert(await pillRun(`[...document.querySelectorAll('.chip')].some(c=>c.dataset.name==='Reading')`),'a used name comes back as a chip');
    P.setPanel(null);

    // dragging: free above the taskbar, and back onto it, into the spot beside the icons
    r=P.rect;
    P.dragStart(r.x+20,r.y+10); P.dragMove(r.x+20,r.y+10-300); P.dragEnd(); await pause(400);
    assert.equal(P.D.pos.snapped,false); assert(Math.abs(P.rect.y-(r.y-300))<=2,'free where it was dropped');
    if(bars.length){
      const b=bars.find(x=>x.primary)||bars[0], sp=P.spotsFor(b), at=sp.iconsL||sp.left, w=P.rect.w;
      const tx=(at.a==='l'?at.x:at.x-w)+12, now=P.rect;
      P.dragStart(now.x+20,now.y+10); P.dragMove(tx+20,b.y+10+(b.height-now.h)/2+4); await pause(200);
      assert.equal(await pillRun(`document.getElementById('pill').classList.contains('snapped')`),true,'shows it will snap');
      P.dragEnd(); await pause(400);
      assert(P.D.pos.snapped&&P.D.pos.spot===(sp.iconsL?'iconsL':'left'),'snapped into the spot: '+JSON.stringify(P.D.pos));
      const at2=P.spotsFor(b)[P.D.pos.spot];   // the icon group can have moved since (windows open and close)
      assert.equal(P.rect.x,Math.round(at2.a==='l'?at2.x:at2.x-P.rect.w),'it sits in the spot');
    }
    // a full-screen app on that screen hides it; locked, it doesn't move
    const pd=screen.getDisplayMatching({x:P.rect.x,y:P.rect.y,width:P.rect.w,height:P.rect.h});
    const pb=screen.dipToScreenRect(null,pd.bounds);
    P.onBridge({t:'fs',on:true,mon:{x:pb.x,y:pb.y,w:pb.width,h:pb.height}}); await pause(300);
    assert.equal(P.shown,false,'hidden over a full-screen app');
    P.onBridge({t:'fs',on:false}); await pause(300);
    assert.equal(P.shown,true);
    P.set('lock',true); const lr=P.rect, lp=JSON.stringify(P.D.pos); P.dragStart(lr.x+5,lr.y+5); P.dragMove(lr.x+200,lr.y-200); P.dragEnd(); await pause(200);
    // (beside the icons it still follows them as windows open and close: the place it keeps is what counts)
    assert.equal(JSON.stringify(P.D.pos),lp,'locked: it stays'); P.set('lock',false);
    // click-through: dimmed, reachable with Ctrl
    P.set('through',true); await pause(300);
    assert(await pillRun(`document.body.classList.contains('through')`));
    P.onBridge({t:'ctrl',on:true}); await pause(200);
    assert(await pillRun(`document.body.classList.contains('ctrl')`)); P.onBridge({t:'ctrl',on:false}); P.set('through',false);

    // the music bars move with FLOW's own track
    await run(`play(0);0`); await pause(1500);
    const vz=await pillRun(`[...document.querySelectorAll('#viz i')].map(i=>i.style.transform)`);
    assert(vz.length===4&&vz.some(t=>t&&t!=='scaleY(0.160)'),'the bars hear the music: '+JSON.stringify(vz));
    await pillShot('13-pill-idle-music');

    // its settings: FLOW's drawer tab drives it
    await run(`openDrawer('pill');0`); await pause(500); await shot('13-pill-settings');
    await run(`document.querySelector('[data-pill-set=size] [data-v=l]').click();0`); await pause(500);
    assert.equal(P.D.cfg.size,'l');
    await run(`document.querySelector('[data-pill-step=goalMin] [data-s="1"]').click();0`); await pause(300);
    assert.equal(P.D.cfg.goalMin,135);
    await run(`closeDrawer();audio.pause();0`); P.set('size','m');
    // off: the window goes; the setting and the place are on disk
    await run(`togglePill();0`); await pause(900);
    assert.equal(P.win,null); assert.equal(await run(`$('pill-btn').classList.contains('on')`),false);
    const pj=JSON.parse(fs.readFileSync(path.join(profile,'pill.json'),'utf8'));
    assert(pj.cfg.on===false&&pj.cfg.goalMin===135&&pj.pos&&pj.done.length===1,JSON.stringify(pj.cfg));
    await run(`setSetting('sysMedia',true);0`);

    // ── the timers: quick ones made on the fly, in every view or popped out ──
    const M=require('../main.js'), TM=M.timers._test;
    const notes=[]; TM.H.notify=t=>notes.push(t);     // no real Windows notification
    const tmRow=name=>`[...document.querySelectorAll('.tm-row')].find(r=>r.querySelector('.tm-tag')&&r.querySelector('.tm-tag').textContent===${JSON.stringify(name)})`;
    const tmType=(name,dur)=>run(`(()=>{const n=document.querySelector('.tm-name'),d=document.querySelector('.tm-dur');n.focus();
      n.value=${JSON.stringify(name)};n.dispatchEvent(new Event('input'));d.value=${JSON.stringify(dur||'')};d.dispatchEvent(new Event('input'));return 0})()`);
    const tmKey=(key,sel)=>run(`document.querySelector(${JSON.stringify(sel||'.tm-name')}).dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true}));0`);
    assert.equal(await run(`$('tm-pop-btn').hidden`),true,'no pop-out toggle while the timers are off');
    // N turns them on and opens the field; "laundry 2h" + Enter starts one
    await run(`newTimer();0`); await until(()=>TM.D.cfg.on,'N turns the timers on');
    await until(async()=>(await run(`document.activeElement&&document.activeElement.classList.contains('tm-name')`)),'the field takes the focus');
    v=await run(`({slot:document.querySelector('.tm-dock').parentNode.id,pop:!$('tm-pop-btn').hidden,on:$('tm-btn').classList.contains('on'),drop:!document.querySelector('.tm-drop').hidden})`);
    assert.deepEqual(v,{slot:'tm-slot-std',pop:true,on:true,drop:true},'a card in the side column, with the pop-out toggle');
    assert(await run(`document.getElementById('tm-slot-std').parentNode.classList.contains('side')`),'part of the side column, not laid over the design');
    await tmType('Laundry 2h'); await tmKey('Enter');
    await until(()=>TM.list.length===1,'the first timer starts');
    let tl=TM.list[0];
    assert(tl.name==='Laundry'&&tl.total===7200000&&tl.running&&tl.color==='#FF4F2E','laundry 2h: '+JSON.stringify(tl));
    // a name, a length and a colour of its own
    await tmType('Tea','4m'); await run(`document.querySelector('.tm-drop [data-c="#14B8A0"]').click();0`); await tmKey('Enter');
    await until(()=>TM.list.length===2,'the second one');
    assert.deepEqual([TM.list[1].name,TM.list[1].total,TM.list[1].color],['Tea',240000,'#14B8A0']);
    // the names come back as you type, with their colour and length
    TM.C.remove(TM.list[1].id); await pause(200);
    await tmType('te'); await pause(150);
    assert(await run(`[...document.querySelectorAll('.tm-sug')].some(s=>s.textContent.startsWith('Tea'))`),'Tea is suggested');
    await tmKey('ArrowDown'); await tmKey('Enter'); await pause(100);
    v=await run(`({name:document.querySelector('.tm-name').value,dur:document.querySelector('.tm-dur').value,dot:document.querySelector('.tm-dot').style.getPropertyValue('--tc')})`);
    assert.deepEqual(v,{name:'Tea',dur:'4m',dot:'#14B8A0'},'picked: its length and colour come with it');
    await shot('14-timers-autocomplete');
    await tmKey('Enter'); await until(()=>TM.list.length===2,'started from the suggestion');
    assert.equal(TM.list[1].color,'#14B8A0');
    await run(`document.activeElement.blur();0`);
    // pause and resume from the row
    await run(`${tmRow('Laundry')}.querySelector('[data-tm=toggle]').click();0`); await pause(200);
    assert.equal(TM.list[0].running,false,'paused');
    assert(await run(`${tmRow('Laundry')}.classList.contains('paused')`));
    await run(`${tmRow('Laundry')}.querySelector('[data-tm=toggle]').click();0`); await pause(200);
    assert.equal(TM.list[0].running,true,'resumed');
    // reset asks first, in the row
    TM.list[0].endAt-=600000; TM.push(); await pause(200);
    await run(`${tmRow('Laundry')}.querySelector('[data-tm=reset]').click();0`); await pause(150);
    assert(await run(`!!document.querySelector('.tm-row.asking')`),'reset asks');
    await shot('14-timers-reset-ask');
    await run(`document.querySelector('[data-tm=reset-no]').click();0`); await pause(150);
    assert(TM.list[0].endAt-Date.now()<6700000,'kept: nothing reset');
    await run(`${tmRow('Laundry')}.querySelector('[data-tm=reset]').click();0`); await pause(150);
    await run(`document.querySelector('[data-tm=reset-yes]').click();0`); await pause(200);
    assert(TM.list[0].endAt-Date.now()>7190000&&TM.list[0].running,'reset to its full length, still running');
    // edit: name, time left, colour
    await run(`${tmRow('Laundry')}.querySelector('[data-tm=edit]').click();0`); await pause(150);
    await shot('14-timers-edit');
    await run(`(()=>{const r=document.querySelector('.tm-row.editing');r.querySelector('.tm-e-name').value='Washing';r.querySelector('.tm-e-left').value='45m';
      r.querySelector('[data-c="#2F62FF"]').click();r.querySelector('[data-tm=save]').click();return 0})()`); await pause(250);
    tl=TM.list[0];
    assert(tl.name==='Washing'&&tl.color==='#2F62FF'&&Math.abs(tl.endAt-Date.now()-2700000)<3000,'edited: '+JSON.stringify(tl));
    TM.C.add({name:'Call back the landlord',dur:25*60e3,color:'#FFC23D'}); TM.C.toggle(TM.list[2].id);
    TM.list[2].left=9*60e3; TM.push(); await pause(600);
    await shot('14-timers-standard'); await fit('standard, timers');
    // the titlebar: icons at rest, a name slides out of the button pointed at
    const lblW=sel=>run(`document.querySelector('${sel} span').getBoundingClientRect().width`);
    assert.equal(await lblW('[data-mode=minimal]'),0,'icons only');
    let mb=await run(`(()=>{const r=document.querySelector('[data-mode=minimal]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await hover(win,mb.x,mb.y);
    assert(await lblW('[data-mode=minimal]')>30,'pointed at: its name');
    assert.equal(await lblW('[data-mode=standard]'),0,'only that one');
    await shot('14-titlebar-hover');
    // the new-timer field is a "+" until the card is pointed at
    const newW=()=>run(`document.querySelector('#tm-slot-std .tm-new').getBoundingClientRect().width`);
    assert((await newW())<40,'at rest: a "+"');
    let cb=await run(`(()=>{const r=document.getElementById('tm-slot-std').getBoundingClientRect();return {x:r.x+60,y:r.y+r.height-20}})()`);
    await hover(win,cb.x,cb.y);
    assert((await newW())>200,'pointed at: the field');
    await shot('14-timers-card-hover');
    await hover(win,600,500);
    // the track and the timers' names: bold JetBrains Mono
    v=await run(`[getComputedStyle($('np-title')),getComputedStyle(document.querySelector('.tm-tag'))].map(c=>c.fontFamily.includes('JetBrains')&&c.fontWeight==='700')`);
    assert.deepEqual(v,[true,true],'bold JetBrains Mono');

    // the minimal view grows by the timers docked under it, and keeps its own size
    await run(`setMode('minimal');0`); await pause(1200);
    let dh=await run(`Math.ceil($('tm-slot-min').getBoundingClientRect().height)`);
    b=win.getBounds();
    assert(dh>100&&b.width===400&&b.height===660+dh&&M.dock.on===dh,'minimal + the timers: '+JSON.stringify({b,dh,dock:M.dock}));
    await shot('14-timers-minimal'); await fit('minimal, timers');
    await tmType('wa'); await pause(200);
    v=await run(`(()=>{const d=document.querySelector('.tm-drop').getBoundingClientRect(),a=document.querySelector('.tm-add').getBoundingClientRect();return {up:d.bottom<=a.top,top:d.top}})()`);
    assert(v.up&&v.top>=0,'at the bottom of the window the drop opens upward: '+JSON.stringify(v));
    await shot('14-timers-minimal-new');
    await run(`document.querySelector('.tm-name').value='';document.activeElement.blur();0`); await pause(200);
    TM.C.add({name:'Oven',dur:40*60e3}); await pause(700);
    const dh2=await run(`Math.ceil($('tm-slot-min').getBoundingClientRect().height)`);
    assert(dh2>dh&&win.getBounds().height===660+dh2,'one more timer, a taller window');
    await run(`setMode('standard');0`); await pause(900);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'win-state.json'),'utf8')).bounds.minimal.height,660,'its own size is kept without the timers');
    assert.deepEqual(win.getBounds(),initial);
    // the mini bar: compact rows under it
    await run(`enterMini();0`); await pause(900);
    b=win.getBounds();
    v=await run(`({slot:document.querySelector('.tm-dock').parentNode.id,h:tmMiniH(),want:miniHeight(),pom:pom.running})`);
    assert(v.slot==='tm-slot-mini'&&v.h>100&&v.want===84+(v.pom?58:0)+v.h&&b.height===v.want,'mini + the timers: '+JSON.stringify({b,v}));
    await shot('14-timers-mini');
    await run(`exitMini();0`); await pause(900);
    // full screen: top right
    await run(`enterZen();0`); await pause(1500);
    assert.equal(await run(`document.querySelector('.tm-dock').parentNode.id`),'tm-slot-zen');
    await shot('14-timers-fs');
    await run(`exitZen();0`); await pause(1300); assert.deepEqual(win.getBounds(),initial);

    // popped out: FLOW's dock goes, a window of its own shows the same rows
    await run(`$('tm-pop-btn').click();0`);
    await until(()=>TM.popShown,'the pop-out shows');
    await pause(500);
    const popRun=code=>TM.pop.webContents.executeJavaScript(code,true);
    const popShot=async name=>fs.writeFileSync(path.join(__dirname,`../shot-${name}.png`),(await TM.pop.webContents.capturePage()).toPNG());
    v=await run(`({slot:document.querySelector('.tm-dock').parentNode.id,on:$('tm-pop-btn').classList.contains('on')})`);
    assert.deepEqual(v,{slot:'tm-slot-park',on:true},'FLOW\'s dock is parked');
    assert.equal(await popRun(`document.querySelectorAll('.tm-row').length`),TM.list.length,'the same rows');
    let qb=TM.pop.getBounds();
    assert.equal(qb.width,340+16);
    assert(Math.abs(qb.height-(await popRun(`Math.ceil(document.getElementById('wrap').getBoundingClientRect().height)`)))<=1,'as tall as its rows');
    await popShot('14-timers-popout');
    // a new one from the pop-out: it grows from its bottom edge (it starts low on the screen)
    const bottom=qb.y+qb.height;
    await popRun(`(()=>{const n=document.querySelector('.tm-name');n.focus();n.value='Plants 10m';n.dispatchEvent(new Event('input'));
      n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));n.blur();return 0})()`);
    await until(()=>TM.list.some(t=>t.name==='Plants'),'added from the pop-out');
    await pause(500);
    qb=TM.pop.getBounds();
    assert(Math.abs(qb.y+qb.height-bottom)<=1,'grew upward, its bottom stays');
    // dragged up the screen, it is anchored by its top from then on
    TM.popDrag({phase:'start',x:qb.x+40,y:qb.y+20}); TM.popDrag({phase:'move',x:qb.x+40,y:qb.y-880}); TM.popDrag({phase:'end'}); await pause(300);
    assert(TM.D.pos&&TM.D.pos.anchor==='top'&&Math.abs(TM.pop.getBounds().y-(qb.y-900))<=2,'moved: '+JSON.stringify({pos:TM.D.pos,b:TM.pop.getBounds(),qb}));

    // the pill grows to make room for its controls, rather than keeping room for them
    M.pill.set('on',true); M.pill.set('size','m'); await until(()=>P.shown&&P.win,'the pill again'); await pause(500);
    P.O.start({name:'Reading'}); await pause(700);
    const pw0=await pillRun(`document.getElementById('pill').getBoundingClientRect().width`);
    let pq=P.rect, pwb=P.win.getBounds();
    await hover(P.win,pq.x-pwb.x+pq.w/2,pq.y-pwb.y+pq.h/2);
    const pw1=await pillRun(`document.getElementById('pill').getBoundingClientRect().width`);
    assert(pw1-pw0>=130&&pw1-pw0<=150,'pointed at, it grows by its controls: '+(pw1-pw0));
    await pillShot('14-pill-hover');
    await hover(P.win,2,2);
    // docked beside the pill: the pop-out held against its right end docks there, and the timers grow out of it
    qb=TM.pop.getBounds();
    const g0=M.pill.groupRect(), pr0={...P.rect};
    TM.popDrag({phase:'start',x:qb.x+40,y:qb.y+20});
    TM.popDrag({phase:'move',x:qb.x+40+(g0.x+g0.w+6-(qb.x+8)),y:qb.y+20+(g0.y-(qb.y+8))}); await pause(250);
    assert(TM.nearPill(),'held against the pill');
    assert(await pillRun(`document.getElementById('pill').classList.contains('hinting')`),'the pill shows it can take them');
    TM.popDrag({phase:'end'});
    await until(()=>!TM.pop,'docked: no window of their own');
    await until(async()=>(await pillRun(`document.querySelectorAll('#tdock .tc').length`))===TM.list.length,'a capsule per timer');
    await until(()=>P.tdockW>0,'the pill knows how wide they are');
    await pause(500);
    const pr1=P.rect;
    assert.equal(pr1.g,pr1.w+Math.round((6+P.tdockW)*P.D.cfg.scale),'the group: the pill and its timers');
    // (beside the taskbar icons the spot itself can shift a few pixels as windows open and close)
    // (wider than the room on that side, it stops at the screen's edge)
    if(pr0.grow==='left') assert(pr1.x<pr0.x-100&&(Math.abs(pr1.x+pr1.g-(pr0.x+pr0.g))<=8||pr1.x<=screen.getDisplayMatching({x:pr1.x,y:pr1.y,width:10,height:10}).bounds.x+2),'held by its right end: the pill makes room to its left '+JSON.stringify({pr0,pr1}));
    else assert(Math.abs(pr1.x-pr0.x)<=8,'held by its left end: they grow to the right '+JSON.stringify({pr0,pr1}));
    assert.equal(await run(`document.querySelector('.tm-dock').parentNode.id`),'tm-slot-park');
    await pillShot('14-timers-docked');
    // a capsule: pause, and reset asks; pointed at, it opens on its controls and the "+" shows
    const fid=TM.list[0].id, cap=sel=>`document.querySelector('#tdock .tc[data-id="${fid}"]${sel?' '+sel:''}')`;
    await pillRun(`${cap('[data-t=toggle]')}.click();0`); await pause(200);
    assert.equal(TM.list[0].running,false,'paused from the pill');
    await pillRun(`${cap('[data-t=toggle]')}.click();0`); await pause(200);
    await pillRun(`${cap('[data-t=reset]')}.click();0`); await pause(200);
    assert(await pillRun(`!!document.querySelector('#tdock .tc.ask')`),'reset asks in the capsule');
    await pillRun(`document.querySelector('#tdock [data-t=reset-no]').click();0`); await pause(200);
    const cw0=await pillRun(`${cap()}.getBoundingClientRect().width`);
    pwb=P.win.getBounds();
    const cr=await pillRun(`(()=>{const r=${cap()}.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await hover(P.win,cr.x,cr.y);
    v=await pillRun(`({w:${cap()}.getBoundingClientRect().width,plus:document.getElementById('tplus').getBoundingClientRect().width})`);
    assert(v.w-cw0>60&&v.plus>20,'pointed at: its controls and the "+": '+JSON.stringify({cw0,v}));
    await pillShot('14-timers-docked-hover');
    // the gap between the capsules and the "+" is still the pill (it let clicks through there, and the "+" folded away)
    const gap=await pillRun(`(()=>{const a=document.getElementById('tdock').getBoundingClientRect(),b=document.getElementById('tplus').getBoundingClientRect();return {x:a.right<=b.left?(a.right+b.left)/2:(b.right+a.left)/2,y:b.y+b.height/2}})()`);
    await hover(P.win,gap.x,gap.y,300);
    assert.equal(P.ignoring,false,'over the gap the pill still takes the clicks');
    assert(await pillRun(`document.getElementById('tplus').getBoundingClientRect().width`)>20,'over the gap the "+" stays');
    await hover(P.win,2,2,150);
    assert(await pillRun(`document.getElementById('tplus').getBoundingClientRect().width`)>20,'off the group, the "+" waits before it folds');
    await pause(1300);
    assert(await pillRun(`document.getElementById('tplus').getBoundingClientRect().width`)<4,'then it folds');
    await hover(P.win,2,2);
    // the "+" opens the timers panel: the same list and field
    await pillRun(`document.getElementById('tplus').click();0`); await until(()=>P.panel==='timers','the timers panel');
    await pause(600);
    assert.equal(await pillRun(`document.querySelectorAll('.panel .tm-row').length`),TM.list.length);
    await pillShot('14-timers-pill-panel');
    assert.match(await pillRun(`getComputedStyle(document.getElementById('panel')).animationName`),/^panel-in/,'the panel pops in');
    P.setPanel(null); await pause(60);
    assert(await pillRun(`document.getElementById('panel').classList.contains('out')`),'closing, it plays out before the window shrinks');
    await pause(300);
    assert(await pillRun(`document.getElementById('panel').hidden`),'then it is gone');
    // pulled off the pill: the pop-out comes back where it is let go
    await pillRun(`pillAPI.ui({cmd:'undock',x:${qb.x+60},y:${qb.y+30}});0`);
    await until(()=>TM.popShown,'the pop-out is back',5000);
    assert.equal(TM.D.cfg.dock,false);
    assert.equal(await pillRun(`document.querySelectorAll('#tdock .tc').length`),0,'none left beside the pill');
    P.O.end(false); M.pill.set('on',false); await pause(500);
    // the pop-out's field shows only while it is pointed at
    assert.equal(await popRun(`getComputedStyle(document.querySelector('.tm-new')).opacity`),'0','at rest: out of sight');
    qb=TM.pop.getBounds();
    await hover(TM.pop,qb.width/2,qb.height-30);
    assert.equal(await popRun(`getComputedStyle(document.querySelector('.tm-new')).opacity`),'1','pointed at: there');
    await hover(TM.pop,1,1);

    // one ends: the overlay pops, FLOW rings and toasts, Windows gets a notification; the row breathes in its colour
    const bells=await run(`bellCount`);
    TM.C.add({name:'Pasta',dur:1500,color:'#C6F24E'});
    await until(()=>TM.ring,'the overlay opens',5000);
    await pause(900);
    fs.writeFileSync(path.join(__dirname,'../shot-14-timers-pop-done.png'),(await TM.ring.webContents.capturePage()).toPNG());
    assert(notes.includes('Pasta — done'),'notified: '+JSON.stringify(notes));
    assert(await run(`bellCount`)>bells,'FLOW rang');
    assert(await popRun(`[...document.querySelectorAll('.tm-row.done')].some(r=>r.textContent.includes('Pasta'))`),'the row shows it ended');
    await popShot('14-timers-popout-done');
    await until(()=>!TM.ring,'the overlay closes by itself',6000);
    // dismissed from the row (the middle button)
    await popRun(`[...document.querySelectorAll('.tm-row.done')].find(r=>r.textContent.includes('Pasta')).querySelector('[data-tm=toggle]').click();0`);
    await until(()=>!TM.list.some(t=>t.name==='Pasta'),'dismissed');
    // kept on screen + ringing until dismissed: a banner stays, the bell repeats, ok answers both
    TM.set('stay',true); TM.set('sound','ring');
    const bells2=await run(`bellCount`);
    TM.C.add({name:'Bread',dur:1000});
    await until(async()=>TM.ring&&(await TM.ring.webContents.executeJavaScript(`!!document.querySelector('.card')`)),'the banner stays',8000);
    fs.writeFileSync(path.join(__dirname,'../shot-14-timers-banner.png'),(await TM.ring.webContents.capturePage()).toPNG());
    await until(async()=>(await run(`bellCount`))>=bells2+2,'it keeps ringing',6000);
    await TM.ring.webContents.executeJavaScript(`document.querySelector('.card .ok').click();0`);
    await until(()=>!TM.list.some(t=>t.name==='Bread'),'ok dismisses it');
    await until(()=>!TM.ring,'and the overlay goes',3000);
    const bells3=await run(`bellCount`); await pause(2700);
    assert.equal(await run(`bellCount`),bells3,'the ringing stopped');
    // +5 min from the banner
    TM.C.add({name:'Rice',dur:1000});
    await until(async()=>TM.ring&&(await TM.ring.webContents.executeJavaScript(`!!document.querySelector('.card')`)),'a banner',8000);
    await TM.ring.webContents.executeJavaScript(`document.querySelector('.card [data-c=snooze]').click();0`); await pause(300);
    tl=TM.list.find(t=>t.name==='Rice');
    assert(tl&&tl.running&&tl.total===300000,'5 more minutes');
    TM.set('stay',false); TM.set('sound','chime');

    // back in, and the settings tab
    await popRun(`document.querySelector('[data-tm=pop]').click();0`);
    await until(()=>!TM.pop,'popped back in');
    await pause(300);
    assert.equal(await run(`document.querySelector('.tm-dock').parentNode.id`),'tm-slot-std');
    await run(`openDrawer('timers');0`); await pause(500); await shot('14-timers-settings');
    await run(`document.querySelector('[data-tm-set=bar] [data-v=drain]').click();document.querySelector('[data-tm-set=order] [data-v=soon]').click();0`); await pause(300);
    assert.deepEqual([TM.D.cfg.bar,TM.D.cfg.order],['drain','soon']);
    const sl=TM.snapshot().list.filter(t=>t.running).map(t=>t.left);
    assert.deepEqual(sl,[...sl].sort((a,c)=>a-c),'soonest first');
    v=await run(`[...document.querySelectorAll('#tm-names .tm-nm span')].map(s=>s.textContent)`);
    assert(v.includes('Washing')&&v.includes('Tea')&&v.includes('Laundry'),'the names it remembers: '+JSON.stringify(v));
    await run(`document.querySelector('#tm-names [data-forget="Laundry"]').click();0`); await pause(300);
    assert(!TM.D.names.some(n=>n.name==='Laundry'),'forgotten');
    await run(`closeDrawer();0`); await pause(300);
    // off: the timers keep running hidden (they still ring); the names are on disk, the timers never are
    await run(`$('tm-btn').click();0`); await pause(500);
    assert.equal(await run(`document.querySelector('.tm-dock').parentNode.id`),'tm-slot-park');
    assert(TM.list.length>0,'hidden, not stopped');
    await pause(500);
    const tj=JSON.parse(fs.readFileSync(path.join(profile,'timers.json'),'utf8'));
    assert(tj.cfg.on===false&&tj.cfg.bar==='drain'&&tj.names.some(n=>n.name==='Tea'&&n.color==='#14B8A0'&&n.dur===240000)&&!('list' in tj),JSON.stringify(tj).slice(0,300));
    for(const t of [...TM.list]) TM.C.remove(t.id);
    TM.set('bar','fill'); TM.set('order','added');
    // a timer from the command line (CORE's "how long?") and the dings every so often (2026-10-21)
    TM.set('on',true); await pause(400);
    assert(TM.fromArgs(['FLOW.exe','--flow-timer=15m','--flow-timer-name=claude · run request','--flow-timer-every=10s']),'--flow-timer adds one');
    const ct=TM.list.find(t=>t.name==='claude · run request');
    assert(ct&&ct.total===900000&&ct.every===10000&&ct.running,'15 min, a ding every 10 s: '+JSON.stringify(ct));
    assert.equal(TM.fromArgs(['FLOW.exe','--something-else']),false,'no timer in the arguments: nothing');
    assert.deepEqual([TM.everyOf('5s'),TM.everyOf('5m'),TM.everyOf('off'),TM.parseDur('1h30')],[0,300000,0,5400000]);
    await run("window.dispatchEvent(new Event('blur'));0"); await pause(200);   // the new-timer drop left open by earlier steps
    const dings=[]; TM.H.dinged=m=>dings.push(m);
    ct.nextDing=Date.now()-1; await pause(700);
    assert(dings.length===1&&/^claude · run request · 1[45]m/.test(dings[0].text),'one ding: '+JSON.stringify(dings));
    assert(ct.nextDing>Date.now(),'the next one is due');
    await until(async()=>await run("!!document.querySelector('.tm-row .tm-bub')"),'the bubble over the timer');
    await shot('15-timers-ding');
    assert(await run("!!document.querySelector('.tm-row .tm-bell')"),'a timer that dings wears a bell');
    // its own "every" in the edit form; the default for new ones in the settings
    await run("document.querySelector('.tm-row[data-id=\""+ct.id+"\"] [data-tm=edit]').click();0"); await pause(300);
    await run("(()=>{const e=document.querySelector('.tm-e-every');e.value='2m';document.querySelector('[data-tm=save]').click();})();0"); await pause(300);
    assert.equal(ct.every,120000,'edited: every 2 min');
    TM.set('every','5m'); TM.C.add({name:'Pasta',dur:600000});
    assert.equal(TM.list.find(t=>t.name==='Pasta').every,300000,'new timers take the default');
    TM.set('every','');
    for(const t of [...TM.list]) TM.C.remove(t.id);
    TM.H.dinged=null;

    // the pill: each size its own width and height; the parts follow the height and give way as it narrows (2026-10-21)
    M.pill.set('on',true); M.pill.set('size','m'); await until(()=>P.shown&&P.win,'the pill again'); await pause(400);
    P.O.start({name:'Sizes'}); await pause(600);
    M.pill.set('dims',{...P.D.cfg.dims,m:{w:400,h:40}}); await pause(700);
    assert.deepEqual(P.D.cfg.dims.m,{w:400,h:40});
    const pz=P.pillSize();
    assert.deepEqual([pz.w,pz.h],[Math.round(400*P.D.cfg.scale),Math.round(40*P.D.cfg.scale)],"the pill takes its size's own width and height");
    let cls=await pillRun("[...document.body.classList].filter(c=>/^no-/.test(c)).sort().join()");
    assert.equal(cls,'no-ph,no-sub,no-tag','400 px wide: the least important parts give way');
    assert(await pillRun("parseFloat(getComputedStyle(document.querySelector('.tm')).fontSize)>14"),'40 px high: the time is bigger');
    await pillShot('15-pill-m-400x40');
    M.pill.set('dims',{...P.D.cfg.dims,m:{w:800,h:26}}); await pause(700);
    cls=await pillRun("[...document.body.classList].filter(c=>/^no-/.test(c)).join()");
    assert.equal(cls,'','800 px: everything fits');
    await pillShot('15-pill-m-800x26');
    M.pill.set('dims',{...P.D.cfg.dims,m:{w:660,h:32}}); await pause(300);
    await run("openDrawer('pill');0"); await pause(500);
    assert.equal(await run("document.querySelectorAll('#pill-dims input[data-pd]').length"),6,'width and height for each size in the settings');
    await run("(()=>{const i=document.querySelector('[data-pd=\"s.w\"]');i.value=300;i.dispatchEvent(new Event('input',{bubbles:true}));})();0"); await pause(400);
    assert.equal(P.D.cfg.dims.s.w,300,'the slider sets it');
    await shot('15-settings-pill-dims');
    await run("document.querySelector('[data-pd-reset=s]').click();closeDrawer();0"); await pause(300);
    assert.equal(P.D.cfg.dims.s.w,232,'reset');
    P.O.end(false); M.pill.set('on',false); await pause(400);
    // the draw loop's pace (Hugo's "up to 8% CPU", 2026-10-21): stopped with nothing on screen, 20 fps at rest,
    // settings.fps in use; the covers' shapes turn from it while music plays, never by a CSS animation
    await run(`document.hasFocus=()=>false;pointerAt=-1e9;setMode('standard');0`); await pause(300);
    assert.equal(await run('loopFps()'),20,'at rest: 20 fps');
    await run('document.hasFocus=()=>true;0');
    const settingsFps=await run('settings.fps');
    assert.equal(await run('loopFps()'),settingsFps,'in use: settings.fps');
    await run(`setSetting('restSlow',false);document.hasFocus=()=>false;0`);
    assert.equal(await run('loopFps()'),settingsFps,'"slow down when you\'re elsewhere" off: always settings.fps');
    await run(`setSetting('restSlow',true);0`);
    win.hide(); await pause(500);
    assert.equal(await run('looping'),false,'hidden: the loop stops');
    win.show(); await pause(500);
    assert.equal(await run('looping'),true,'shown again: it runs');
    assert.equal(await run(`document.getAnimations().filter(a=>a.effect&&a.effect.target&&a.effect.target.closest&&a.effect.target.closest('.art')).length`),0,'no CSS animation on the covers');
    await run(`(()=>{const d=document.createElement('div');d.className='art';d.id='spin-probe';d.innerHTML='<svg viewBox="0 0 10 10"><rect class="sp" width="4" height="4"/></svg>';document.body.appendChild(d);document.body.classList.add('is-playing');})();0`);
    await pause(600);
    const turned=await run(`document.querySelector('#spin-probe .sp').style.transform`);
    assert.match(turned,/^rotate\([\d.]+deg\)$/,'music playing: the loop turns the shapes ('+turned+')');
    await run(`document.body.classList.remove('is-playing');0`); await pause(300);
    const held=await run(`document.querySelector('#spin-probe .sp').style.transform`); await pause(400);
    assert.equal(await run(`document.querySelector('#spin-probe .sp').style.transform`),held,'paused: they hold still');
    await run(`document.getElementById('spin-probe').remove();delete document.hasFocus;reflectPlayState();0`);

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
