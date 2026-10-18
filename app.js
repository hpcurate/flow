/* FLOW · app
   Library (IndexedDB), playback with loop crossfades, the pomodoro, ambience
   noise, the four views (standard / minimal / mini / full screen), settings and
   the render loop. Drawing is delegated to viz.js (window.Viz). */
'use strict';

/* ════════════ IndexedDB (persist audio blobs) ════════════ */
const DB_NAME='flow_db', STORE='tracks';
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE,{keyPath:'id'}); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
async function idbPut(rec){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(rec);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
async function idbAll(){const db=await openDB();return new Promise((res,rej)=>{const rq=db.transaction(STORE,'readonly').objectStore(STORE).getAll();rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});}
async function idbDel(id){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

/* ════════════ State ════════════ */
const ORDER_KEY='flow_order', SET_KEY='flow_settings';
let tracks=[];          // {id,name,url,duration}
let current=-1;         // index into tracks
let loopMode=0;         // 0 off · 1 all · 2 one
let shuffle=false;
const VIZ_DEFAULTS={vizSens:1,vizSmooth:.5,vizSpeed:1,vizDensity:.5,vizScale:1,vizColor:'palette',fps:60,fsClock:true,fsTrack:true};
const DEFAULTS={focus:25,brk:5,longBrk:15,longEvery:4,goal:4,sync:true,autoNext:true,chime:true,
  vol:80,breakTrackId:null,noise:'off',noiseVol:40,intention:'',sysMedia:true,
  theme:'bauhaus',depth:'darker',grain:true,motion:'full',side:'player',
  timerStyle:'orbit',vizStyle:'bauhaus',fsContent:'music',vizSeed:1,...VIZ_DEFAULTS};
let settings={...DEFAULTS};

const audioA=document.getElementById('audio');
const audioB=document.getElementById('audio-b');
let audio=audioA;   // active element — the other one is used for crossfades
const $=id=>document.getElementById(id);
const winAPI=window.flowAPI;

const ICO_PLAY='<path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.2-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6z"/>';
const ICO_PAUSE='<rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/>';

function master(){ return settings.vol/100; }

/* volume fades (pomodoro transitions + loop crossfade) */
const fades=new Map();
function cancelFade(el){ const id=fades.get(el); if(id!==undefined){ clearInterval(id); fades.delete(el); } }
function fadeEl(el,target,ms,done){
  cancelFade(el);
  const v0=el.volume, t0=performance.now();
  const id=setInterval(()=>{
    const k=Math.min(1,(performance.now()-t0)/ms);
    el.volume=v0+(target-v0)*k;
    if(k>=1){ cancelFade(el); if(done) done(); }
  },32);
  fades.set(el,id);
}

function loadSettings(){
  let s={};
  try{ s=JSON.parse(localStorage.getItem(SET_KEY)||'{}')||{}; }catch{}
  // older builds: zenViz indexed waves/ring/drift and motion was a boolean
  if(typeof s.zenViz==='number'&&!s.vizStyle) s.vizStyle=['strata','orbit','float'][s.zenViz];
  if(typeof s.motion==='boolean') s.motion=s.motion?'full':'still';
  for(const k of ['zenViz','scene','pomOn']) delete s[k];
  Object.assign(settings,s);
  const keep=(k,ok)=>{ if(!ok(settings[k])) settings[k]=DEFAULTS[k]; };
  keep('theme',v=>typeof v==='string'&&v in Viz.PALETTES);
  keep('depth',v=>['dark','darker','black'].includes(v));
  keep('motion',v=>['full','calm','still'].includes(v));
  keep('timerStyle',v=>typeof v==='string'&&v in Viz.TIMER_STYLES);
  keep('vizStyle',v=>typeof v==='string'&&v in Viz.MUSIC_STYLES);
  keep('vizColor',v=>['palette','phase','mono'].includes(v));
  keep('fsContent',v=>v==='music'||v==='timer');
  keep('side',v=>v==='player'||v==='library');
  keep('fps',v=>v===30||v===60);
  for(const k of ['focus','brk','longBrk','longEvery','goal','vol','noiseVol','vizSens','vizSmooth','vizSpeed','vizDensity','vizScale','vizSeed'])
    keep(k,v=>typeof v==='number'&&isFinite(v));
}
function saveSettings(){ localStorage.setItem(SET_KEY,JSON.stringify(settings)); }
function saveOrder(){ localStorage.setItem(ORDER_KEY,JSON.stringify(tracks.map(t=>t.id))); }

function two(n){ return String(n).padStart(2,'0'); }
function fmt(s){
  if(!isFinite(s)||s<0) s=0;
  s=Math.floor(s);
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return (h?h+':'+two(m):m)+':'+two(sec);
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function stripExt(n){return n.replace(/\.[^.]+$/,'');}

/* ════════════ Theme ════════════ */
let TH=null;
function applyTheme(){
  TH=Viz.theme(settings.theme,settings.depth);
  const st=document.documentElement.style;
  for(const k of ['bg','fg','s0','s1','s2','s3','bd','bd2','fg2','mu']) st.setProperty('--'+k,TH[k]);
  TH.c.forEach((c,i)=>{ st.setProperty('--c'+(i+1),c); st.setProperty('--on-c'+(i+1),TH.on[i]); });
  st.setProperty('--focus',TH.focus); st.setProperty('--break',TH.brk);
  st.setProperty('--on-focus',TH.onFocus); st.setProperty('--on-break',TH.onBrk);
  document.querySelector('meta[name=theme-color]').content=TH.bg;
  document.body.classList.toggle('grain',!!settings.grain);
  document.body.dataset.motion=settings.motion;
  // the icon wears the theme: the titlebar mark's shapes (k1 k2 k3 k5) on the background
  const k=[TH.c[0],TH.c[1],TH.c[2],TH.c[4]];
  if(winAPI&&winAPI.setTheme) winAPI.setTheme(TH.bg,k);
  document.querySelector('link[rel=icon]').href='data:image/svg+xml,'+encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${TH.bg}"/>`+
    `<circle cx="9.75" cy="9.75" r="5.75" fill="${k[0]}"/><path d="M16.5 15.5V4a11.5 11.5 0 0 1 11.5 11.5z" fill="${k[1]}"/>`+
    `<rect x="4" y="16.5" width="11.5" height="11.5" rx="1.5" fill="${k[2]}"/><path d="M16.5 16.5H28a5.75 5.75 0 0 1-11.5 0z" fill="${k[3]}"/></svg>`);
}
/* a tiny noise tile for the film-grain overlay */
function makeGrain(){
  const c=document.createElement('canvas'); c.width=c.height=160;
  const x=c.getContext('2d'), img=x.createImageData(160,160);
  for(let i=0;i<img.data.length;i+=4){ const v=Math.random()*255|0; img.data[i]=img.data[i+1]=img.data[i+2]=v; img.data[i+3]=34; }
  x.putImageData(img,0,0);
  document.documentElement.style.setProperty('--grain',`url(${c.toDataURL()})`);
}
/* generated cover art; with img (another app's artwork) the sleeve sits on top of it */
function setArt(el,seed,cols,rows,img){
  const k=seed+'|'+cols+'x'+rows+(img?'|'+img.length+img.slice(-24):'');
  if(el.dataset.k===k) return;
  el.dataset.k=k; el.innerHTML=Viz.cover(seed,cols,rows);
  if(img){ const im=new Image(); im.className='art-img'; im.alt=''; im.draggable=false; im.src=img; el.appendChild(im); }
}

/* ════════════ Library load / add ════════════ */
async function loadLibrary(){
  const recs=await idbAll();
  let order=[]; try{order=JSON.parse(localStorage.getItem(ORDER_KEY)||'[]');}catch{}
  const byId={}; recs.forEach(r=>byId[r.id]=r);
  const ordered=[...order.filter(id=>byId[id]), ...recs.filter(r=>!order.includes(r.id)).map(r=>r.id)];
  tracks=ordered.map(id=>{
    const r=byId[id];
    return {id, name:r.name, url:URL.createObjectURL(r.blob), duration:r.duration||0};
  });
  saveOrder();
  renderList(); updateNP();
  // probe missing durations lazily
  tracks.forEach(t=>{ if(!t.duration) probeDuration(t); });
}

function probeDuration(t){
  const a=new Audio(); a.preload='metadata'; a.src=t.url;
  a.addEventListener('loadedmetadata',async()=>{
    t.duration=a.duration; renderList();
    const recs=await idbAll(); const r=recs.find(x=>x.id===t.id);
    if(r){ r.duration=a.duration; idbPut(r); }
  },{once:true});
}

async function addFiles(fileList){
  const files=[...fileList].filter(f=>f.type.startsWith('audio/')||/\.(mp3|m4a|flac|ogg|wav|aac)$/i.test(f.name));
  if(!files.length){ toast('No audio files there'); return; }
  for(const f of files){
    const id='t_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);
    const rec={id, name:f.name, blob:f, duration:0, added:Date.now()};
    try{ await idbPut(rec); }
    catch(e){ toast('Storage full — track skipped'); console.error(e); continue; }
    tracks.push({id, name:f.name, url:URL.createObjectURL(f), duration:0});
    probeDuration(tracks[tracks.length-1]);
  }
  saveOrder(); renderList(); updateNP();
  toast(files.length+' track'+(files.length>1?'s':'')+' added');
}

async function delTrack(id,ev){
  ev.stopPropagation();
  const i=tracks.findIndex(t=>t.id===id);
  if(i<0) return;
  if(settings.breakTrackId===id){ settings.breakTrackId=null; saveSettings(); }
  const wasCurrent=(i===current);
  URL.revokeObjectURL(tracks[i].url);
  await idbDel(id);
  tracks.splice(i,1);
  if(wasCurrent){ audio.pause(); audio.removeAttribute('src'); current=-1; }
  else if(i<current){ current--; }
  saveOrder(); renderList(); updateNP();
}

/* ════════════ Playback ════════════ */
let xfading=false;
function otherEl(){ return audio===audioA?audioB:audioA; }
function play(i){
  if(i<0||i>=tracks.length) return;
  ensureGraph();
  current=i;
  xfading=false;
  const o=otherEl(); cancelFade(o); o.pause();
  cancelFade(audio);
  audio.volume=master();
  audio.src=tracks[i].url;
  audio.play().catch(()=>{});
  updateNP(); renderList();
}
/* gapless loop-one: overlap the tail with a fresh start on the spare element */
function maybeCrossfade(){
  if(loopMode!==2||xfading||current<0||!audio.duration) return;
  const rem=audio.duration-audio.currentTime;
  if(rem>1.2||rem<=0) return;
  xfading=true;
  const o=otherEl(), old=audio;
  o.src=tracks[current].url;
  o.currentTime=0; o.volume=0;
  o.play().then(()=>{
    audio=o;
    fadeEl(old,0,1000,()=>old.pause());
    fadeEl(o,master(),1000,()=>{ xfading=false; });
  }).catch(()=>{ xfading=false; });
}
/* the transport (buttons, Space, tray) drives whichever player the panel shows */
function togglePlay(){ if(src==='sys') sysCmd('toggle'); else flowToggle(); }
function goPrev(){ if(src==='sys') sysCmd('prev'); else prevTrack(); }
function goNext(){ if(src==='sys') sysCmd('next'); else nextTrack(false); }
function flowToggle(){
  if(current<0){
    if(tracks.length) play(0);
    else { if(!miniOn&&!zenOn) setSide('library'); toast('Add a few tracks to get started'); }
    return;
  }
  ensureGraph();
  if(audio.paused) audio.play().catch(()=>{}); else audio.pause();
}
function nextTrack(auto){
  if(!tracks.length) return;
  if(loopMode===2 && auto){ audio.currentTime=0; audio.play().catch(()=>{}); return; }
  if(shuffle){
    if(tracks.length===1){ if(auto&&loopMode!==1){audio.pause();return;} play(0); return; }
    let n; do{ n=Math.floor(Math.random()*tracks.length); }while(n===current);
    play(n); return;
  }
  if(current+1<tracks.length) play(current+1);
  else if(loopMode===1) play(0);
  else if(auto){ audio.pause(); audio.currentTime=audio.duration||0; renderList(); }
  else play(0);
}
function prevTrack(){
  if(!tracks.length) return;
  if(audio.currentTime>3){ audio.currentTime=0; return; }
  if(current-1>=0) play(current-1);
  else play(tracks.length-1);
}

let msName=null;   // what FLOW last told Windows it is playing
function updateNP(){
  const s=src==='sys'?sys:null, t=tracks[current], name=t?stripExt(t.name):'';
  let title, sub, short, seed, img='';
  if(s){
    const app=appName(s.app), by=s.artist||s.album;
    title=s.title||app; seed=title;
    sub=`<em>${esc(app)}</em>${by?' · '+esc(by):''}`; short=app+(by?' · '+by:'');
    if(sysArt.key===s.key) img=sysArt.url;
  } else {
    const idleSub=tracks.length?'pick a track to begin':'add music to begin';
    title=t?name:'Nothing playing'; seed=t?t.name:'flow';
    sub=t?`track <em>${current+1}</em> of ${tracks.length}`:idleSub;
    short=t?`${current+1} / ${tracks.length}`:idleSub;
  }
  $('np-title').textContent=title; $('np-sub').innerHTML=sub;
  $('sp-title').textContent=title; $('sp-sub').textContent=short;
  setArt($('cover'),seed,6,4,img); setArt($('sp-art'),seed,2,2,img); setArt($('mini-art'),seed,2,2,img); setArt($('zen-art'),seed,2,2,img);
  // another app's track gets only the controls that app offers
  $('loop-btn').disabled=$('shuffle-btn').disabled=!!s;
  for(const id of ['prev-btn','sp-prev','zen-prev']) $(id).disabled=!!s&&!s.prev;
  for(const id of ['next-btn','sp-next','mini-next','zen-next']) $(id).disabled=!!s&&!s.next;
  $('seek').disabled=!!s&&!(s.seek&&s.dur>0);
  $('vol').title=s?`FLOW's own volume (${appName(s.app)} keeps its own)`:'Music volume';
  // FLOW's entry in the Windows media flyout only ever describes FLOW's own track
  if('mediaSession' in navigator&&msName!==name){
    msName=name;
    try{ navigator.mediaSession.metadata=t?new MediaMetadata({title:name,artist:'FLOW'}):null; }catch{}
  }
  updateTray();
  syncMini();
}
let trayTip='';
function updateTray(){
  if(!winAPI||!winAPI.setTray) return;
  const t=tracks[current], s=src==='sys'?sys:null;
  let str=link.on?'FLOW · linked to TUTOR':'FLOW';
  if(pom.running) str+=` · ${phaseLabel()} ${clockText(pom.remaining)}`;
  if(s){ if(s.playing) str+=' · ♪ '+(s.title||appName(s.app))+(s.artist?' — '+s.artist:''); }
  else if(t&&!audio.paused) str+=' · ♪ '+stripExt(t.name);
  if(str===trayTip) return;
  trayTip=str; winAPI.setTray(str);
}

/* play/pause icons everywhere + active-row bars */
function reflectPlayState(){
  updateSource();
  const mine=flowPlaying(), playing=src==='sys'?!!(sys&&sys.playing):mine;
  for(const id of ['play-ico','sp-play-ico','mini-play-ico','zen-play-ico']) $(id).innerHTML=playing?ICO_PAUSE:ICO_PLAY;
  document.body.classList.toggle('is-playing',playing);
  document.querySelectorAll('.track').forEach(el=>el.classList.toggle('playing',+el.dataset.i===current&&mine));
  if('mediaSession' in navigator){
    try{ navigator.mediaSession.playbackState=mine?'playing':'paused'; }catch{}
  }
  updateTray();
  syncMini();
}
/* the seek bar and times, for whichever player is showing */
let seeking=false;
function reflectTime(){
  if(seeking) return;
  const s=src==='sys'?sys:null, seek=$('seek');
  const d=s?s.dur:audio.duration, p=s?sysPos():audio.currentTime;
  seek.value=d>0?p/d*1000:0; setPct(seek);
  $('t-cur').textContent=fmt(p);
  $('t-dur').textContent=s&&!(d>0)?'—':fmt(d);
}

/* ════════════ Other apps (Spotify & co.) ════════════
   main.js runs smtc.ps1, which reads the Windows media sessions (what the volume
   flyout shows: title, artist, artwork, position) and relays play / pause / skip.
   While another app is the source, the player panel shows its track, the transport
   drives it, the timer's music sync pauses and resumes it, and the visualiser
   listens to the system audio instead of FLOW's own sound. */
let sys=null;               // {app,title,artist,album,status,pos,dur,at,prev,next,seek,key, playing,rx}
let sysArt={key:'',url:''};
let sysSeen=false, sysErr='';
let src='flow';             // whose track the panel shows: 'flow' | 'sys'
let lastSrc='flow';         // the last one heard playing; holds the panel while both are quiet
let sysBreak=null;          // {resume} while a break has paused the other app

const APP_NAMES=[[/spotify/i,'Spotify'],[/vivaldi/i,'Vivaldi'],[/msedge/i,'Edge'],[/chrome/i,'Chrome'],[/firefox/i,'Firefox'],
  [/brave/i,'Brave'],[/opera/i,'Opera'],[/zunemusic/i,'Media Player'],[/vlc/i,'VLC'],[/deezer/i,'Deezer'],[/tidal/i,'TIDAL'],
  [/applemusic|itunes/i,'Apple Music'],[/foobar/i,'foobar2000'],[/musicbee/i,'MusicBee'],[/aimp/i,'AIMP'],[/soundcloud/i,'SoundCloud']];
function appName(id){
  const s=String(id||'');
  for(const [re,n] of APP_NAMES) if(re.test(s)) return n;
  return s.split(/[\\/!]/).pop().replace(/\.exe$/i,'').replace(/_\w{13}$/,'')||'Another app';
}
function flowPlaying(){ return current>=0&&!audio.paused; }
function pickSource(){
  if(!settings.sysMedia||!sys) return 'flow';
  if(flowPlaying()) return 'flow';
  if(sys.playing) return 'sys';
  return lastSrc==='sys'||current<0?'sys':'flow';
}
function updateSource(){
  const s=pickSource();
  if(s==='flow'?flowPlaying():sys.playing) lastSrc=s;
  if(s===src) return;
  src=s; document.body.dataset.src=s;
  if(s==='sys') startLoop();
  routeViz(); updateNP(); reflectTime();
}
/* players report their position only now and then; count on from the last report */
function sysPos(){
  if(!sys) return 0;
  const at=sys.at>1e12?sys.at:sys.rx;
  const p=sys.pos+(sys.playing?(Date.now()-at)/1000:0);
  return Math.max(0,sys.dur>0?Math.min(p,sys.dur):p);
}
function sysCmd(cmd,arg){
  if(!sys||!winAPI||!winAPI.sysCmd) return;
  winAPI.sysCmd(cmd,arg);
  // show the result at once; the bridge's next report confirms or corrects it
  if(cmd==='seek'){ sys.pos=arg; sys.at=Date.now(); reflectTime(); return; }
  if(cmd!=='toggle'&&cmd!=='play'&&cmd!=='pause') return;
  sys.pos=sysPos(); sys.at=Date.now();
  sys.playing=cmd==='toggle'?!sys.playing:cmd==='play';
  sys.status=sys.playing?'Playing':'Paused';
  if(sys.playing) lastSrc='sys';
  reflectPlayState();
}
function onSys(m){
  if(!settings.sysMedia) return;
  if(m.t==='err'){ sysErr=m.msg||'unavailable'; sys=null; }
  else if(m.t==='art') sysArt={key:m.key,url:m.url};
  else if(m.t==='state'){ sysErr=''; sysSeen=true; sys=m.none?null:Object.assign(m,{playing:m.status==='Playing',rx:Date.now()}); }
  else return;
  reflectPlayState(); updateNP(); reflectTime(); reflectSysStatus();
}
function applySysMedia(){
  if(winAPI&&winAPI.sysMedia) winAPI.sysMedia(settings.sysMedia);
  if(!settings.sysMedia){ sys=null; sysSeen=false; sysErr=''; sysBreak=null; stopLoop(); }
  loopErr='';
  reflectPlayState(); updateNP(); reflectTime(); reflectSysStatus();
}
function reflectSysStatus(){
  let t;
  if(!settings.sysMedia) t='Off: FLOW shows and visualises its own library only.';
  else if(sysErr) t='Not available on this PC ('+sysErr+').';
  else if(!sysSeen) t='Looking for other players…';
  else if(!sys) t='Nothing is playing in other apps right now.';
  else {
    t=`Now: ${appName(sys.app)} · ${sys.title||'untitled'}${sys.playing?'':' (paused)'}`;
    if(loopErr) t+='. The visualiser can’t hear it: '+loopErr;
    else if(vizLoop) t+='. The visualiser is listening.';
  }
  $('sys-status').textContent=t;
}

/* ════════════ List render ════════════ */
const CUP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/></svg>';
const CROSS='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
function renderList(){
  $('pl-meta').textContent=tracks.length;
  const list=$('pl-list');
  if(!tracks.length){
    list.innerHTML=`<div class="empty">
      <div class="empty-art"><i></i><i></i><i></i><i></i></div>
      <div class="empty-t">Your library is empty</div>
      <div class="empty-s">Add ambient and focus tracks from this PC, or drop audio files anywhere on the window. They stay saved locally.</div>
      <button class="pill-btn" id="add-empty">Add music</button>
    </div>`;
    $('add-empty').onclick=pickFiles;
    reflectPlayState();
    return;
  }
  list.innerHTML=tracks.map((t,i)=>`
    <div class="track${i===current?' active':''}" data-i="${i}" draggable="true">
      <div class="tk-art art">${Viz.cover(t.name,2,2)}<span class="tk-eq"><i></i><i></i><i></i></span></div>
      <div class="tk-body">
        <div class="tk-name">${esc(stripExt(t.name))}</div>
        <div class="tk-dur">${t.duration?fmt(t.duration):'—'}${t.id===settings.breakTrackId?' · break track':''}</div>
      </div>
      <button class="tk-btn tk-brk${t.id===settings.breakTrackId?' on':''}" data-id="${t.id}" title="Play this during breaks">${CUP}</button>
      <button class="tk-btn tk-del" data-id="${t.id}" title="Remove from library">${CROSS}</button>
    </div>`).join('');
  list.querySelectorAll('.track').forEach(el=>{
    el.onclick=()=>play(+el.dataset.i);
    el.addEventListener('dragstart',e=>{
      e.dataTransfer.setData('text/flow-track',el.dataset.i);
      e.dataTransfer.effectAllowed='move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    el.addEventListener('dragover',e=>{
      if(!e.dataTransfer.types.includes('text/flow-track')) return;
      e.preventDefault(); e.dataTransfer.dropEffect='move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave',()=>el.classList.remove('drop-target'));
    el.addEventListener('drop',e=>{
      if(!e.dataTransfer.types.includes('text/flow-track')) return;
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('drop-target');
      const from=+e.dataTransfer.getData('text/flow-track');
      const to=+el.dataset.i;
      if(from===to||isNaN(from)) return;
      const cur=tracks[current];
      const [moved]=tracks.splice(from,1);
      tracks.splice(to,0,moved);
      current=cur?tracks.indexOf(cur):-1;
      saveOrder(); renderList(); updateNP();
    });
  });
  list.querySelectorAll('.tk-brk').forEach(b=>{
    b.onclick=e=>{
      e.stopPropagation();
      settings.breakTrackId=settings.breakTrackId===b.dataset.id?null:b.dataset.id;
      saveSettings(); renderList();
      toast(settings.breakTrackId?'Break track set':'Break track cleared');
    };
  });
  list.querySelectorAll('.tk-del').forEach(b=>{
    b.onclick=e=>delTrack(b.dataset.id,e);
  });
  reflectPlayState();
}

/* ════════════ Loop / shuffle UI ════════════ */
function reflectLoop(){
  const btn=$('loop-btn');
  btn.classList.toggle('toggled', loopMode>0);
  $('loop-badge').textContent = loopMode===2?'1':'';
  btn.title = ['Loop: off','Loop: all','Loop: one'][loopMode];
}
function reflectShuffle(){ $('shuffle-btn').classList.toggle('toggled', shuffle); }

/* ════════════ Pomodoro ════════════ */
let pom={running:false, phase:'focus', long:false, remaining:25*60, total:25*60, sessions:0, focusSec:0, timer:null, tickAt:0};
let resumeIdx=-1;   // track to come back to after a break-track swap
function today(){ const d=new Date(); return d.getFullYear()+'-'+two(d.getMonth()+1)+'-'+two(d.getDate()); }
let pomDay=today();
function pomTodayKey(){ return 'flow_pom_'+pomDay; }
function focusKey(){ return 'flow_focus_'+pomDay; }
function loadPom(){
  pomDay=today();
  pom.sessions=+(localStorage.getItem(pomTodayKey())||0);
  pom.focusSec=+(localStorage.getItem(focusKey())||0);
  setRemaining(settings.focus*60);
}
function rollDay(){ if(today()!==pomDay){ pomDay=today(); pom.sessions=0; pom.focusSec=0; } }
function savePomSessions(){ localStorage.setItem(pomTodayKey(),pom.sessions); }
function setRemaining(sec){ pom.remaining=sec; pom.total=sec; }
function phaseKey(){ return pom.phase==='focus'?'focus':(pom.long?'long':'break'); }
function phaseLabel(){ return pom.phase==='focus'?'Focus':(pom.long?'Long break':'Break'); }
function clockText(sec){ return two(Math.floor(sec/60))+':'+two(sec%60); }
function fmtMins(sec){ const m=Math.floor(sec/60); return m<60?m+'m':Math.floor(m/60)+'h '+two(m%60)+'m'; }
function todayText(){
  const s=pom.sessions, g=settings.goal;
  return (g?`${s}/${g}`:`${s} session${s===1?'':'s'}`)+' · '+fmtMins(pom.focusSec)+' focused';
}
/* elapsed share of the current phase, interpolated between ticks for smooth visuals */
function pomProgress(){
  if(!pom.total) return 0;
  let el=pom.total-pom.remaining;
  if(pom.running) el+=Math.min(1,(performance.now()-pom.tickAt)/1000);
  return Math.max(0,Math.min(1,el/pom.total));
}
/* the clock uses Syne's tabular figures, so it never jitters as it counts */
function setClock(el,str){ if(el.textContent!==str) el.textContent=str; }
/* the session cycle: ● focus · ▪ short break · ▬ long break */
function cycleHTML(){
  const every=settings.longEvery, goal=settings.goal, inFocus=pom.phase==='focus';
  const reach=pom.sessions+(inFocus?1:0);
  const n=Math.min(12,Math.max(goal,reach,1)), start=Math.max(0,reach-12), p=pomProgress().toFixed(3);
  let h='';
  for(let i=start;i<start+n;i++){
    let c='cy cy-f', st='';
    if(i<pom.sessions) c+=' done';
    else if(i===pom.sessions&&inFocus){ c+=' now'; st=` style="--p:${p}"`; }
    else if(goal&&i>=goal) c+=' extra';
    h+=`<i class="${c}"${st}></i>`;
    const breakNow=!inFocus&&i===pom.sessions-1;
    if(i===start+n-1&&!breakNow) break;
    let b='cy '+(every>0&&(i+1)%every===0?'cy-l':'cy-b'), bs='';
    if(breakNow){ b+=' now'; bs=` style="--p:${p}"`; }
    else if(i<pom.sessions-1||(i===pom.sessions-1&&inFocus)) b+=' done';
    h+=`<i class="${b}"${bs}></i>`;
  }
  return h;
}

function renderPom(){
  setClock($('pom-time'),clockText(pom.remaining));
  $('pom-time').classList.toggle('long',pom.remaining>=6000);
  document.body.dataset.phase=pom.phase==='focus'?'focus':'break';
  $('pom-phase').textContent=(link.on?'TUTOR · ':'')+phaseLabel()+(!pom.running&&pom.remaining<pom.total?' · paused':'');
  const lbl=pom.running?'Pause':pom.remaining<pom.total?'Resume':pom.phase==='focus'?'Start focus':'Start break';
  $('pom-start-lbl').textContent=lbl;
  $('pom-start-ico').innerHTML=pom.running?ICO_PAUSE:ICO_PLAY;
  const key=phaseKey();
  document.querySelectorAll('[data-ph]').forEach(b=>{ const on=b.dataset.ph===key; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); });
  const cyc=cycleHTML();
  $('cycle').innerHTML=cyc; $('zen-cycle').innerHTML=cyc;
  $('pom-count').textContent=todayText();
  if(winAPI&&winAPI.setProgress){
    if(pom.running) winAPI.setProgress(1-pom.remaining/pom.total, pom.phase==='focus'?'normal':'paused');
    else winAPI.setProgress(-1,'normal');
  }
  updateTray();
  syncMini();
}
function pomTick(){
  rollDay();
  pom.remaining--; pom.tickAt=performance.now();
  if(pom.phase==='focus'){ pom.focusSec++; localStorage.setItem(focusKey(),pom.focusSec); }
  if(pom.remaining<=0) pomPhaseEnd();
  renderPom();
}
function musicForFocus(){
  if(!settings.sync) return;
  if(src==='sys'){ if(sys&&!sys.playing) sysCmd('play'); }
  else if(current>=0 && audio.paused){ audio.volume=0; audio.play().catch(()=>{}); fadeEl(audio,master(),1500); }
}
function pomStart(){
  if(link.on){ winAPI.linkCmd('toggle'); return; }
  if(pom.running){ pomPause(); return; }
  pom.running=true; pom.tickAt=performance.now();
  pom.timer=setInterval(pomTick,1000);
  if(pom.phase==='focus') musicForFocus();
  renderPom();
}
function pomPause(){
  pom.running=false; clearInterval(pom.timer); renderPom();
}
function pomReset(){
  if(link.on){ toast('The session runs from TUTOR — end it there'); return; }
  pomPause(); pom.phase='focus'; pom.long=false; setRemaining(settings.focus*60); renderPom();
}
function pomSkip(){ if(link.on){ winAPI.linkCmd('skip'); return; } pomPhaseEnd(); }
function pomResetCount(){
  pom.sessions=0; savePomSessions(); renderPom(); toast('Session count reset');
}
/* picking a phase by hand: switch the timer only, leave the music alone */
function selectPhase(key){
  if(link.on){ toast('Linked to TUTOR — its session sets the phase'); return; }
  pomPause();
  pom.phase=key==='focus'?'focus':'break';
  pom.long=key==='long';
  setRemaining((key==='focus'?settings.focus:key==='long'?settings.longBrk:settings.brk)*60);
  renderPom();
}

/* music + noise transitions on phase change (gentle fades, optional break track) */
function musicToBreak(){
  if(!settings.sync) return;
  noiseDuck(true);
  const bi=settings.breakTrackId?tracks.findIndex(t=>t.id===settings.breakTrackId):-1;
  if(src==='sys'){
    // another app can't be faded, only paused; the break track still plays if there is one
    sysBreak={resume:sys.playing};
    if(sys.playing) sysCmd('pause');
    if(bi>=0){ play(bi); audio.volume=0; fadeEl(audio,master(),1200); }
    return;
  }
  if(bi>=0 && bi!==current){
    resumeIdx=current;
    fadeEl(audio,0,1200,()=>{ play(bi); audio.volume=0; fadeEl(audio,master(),1200); });
  } else if(current>=0 && !audio.paused){
    fadeEl(audio,0,1800,()=>audio.pause());
  }
}
function musicToFocus(){
  if(!settings.sync) return;
  noiseDuck(false);
  if(sysBreak){
    const back=sysBreak.resume; sysBreak=null;
    if(flowPlaying()) fadeEl(audio,0,1000,()=>{ lastSrc='sys'; audio.pause(); });
    else lastSrc='sys';
    if(back&&sys) sysCmd('play');
    return;
  }
  if(resumeIdx>=0 && resumeIdx<tracks.length && resumeIdx!==current){
    const back=resumeIdx; resumeIdx=-1;
    fadeEl(audio,0,1000,()=>{ play(back); audio.volume=0; fadeEl(audio,master(),1500); });
  } else if(current>=0){
    resumeIdx=-1;
    cancelFade(audio);
    if(audio.paused){ audio.volume=0; audio.play().catch(()=>{}); }
    fadeEl(audio,master(),1500);
  }
}
function notifyPhase(title,body){
  if(document.hasFocus()) return;
  try{ new Notification(title,{body,silent:true}); }catch{}
}
function pomPhaseEnd(){
  clearInterval(pom.timer);
  if(settings.chime) chime();
  if(pom.phase==='focus'){
    pom.sessions++; savePomSessions();
    pom.long=settings.longEvery>0 && pom.sessions%settings.longEvery===0;
    pom.phase='break';
    setRemaining((pom.long?settings.longBrk:settings.brk)*60);
    musicToBreak();
    const msg=pom.long?'Long break — you earned it':'Break time';
    toast('Focus done — '+msg.toLowerCase());
    notifyPhase('Focus done',msg+(settings.goal?` · ${pom.sessions}/${settings.goal} today`:''));
  } else {
    pom.phase='focus'; pom.long=false;
    setRemaining(settings.focus*60);
    musicToFocus();
    toast('Break over — back to focus');
    notifyPhase('Break over','Back to focus');
  }
  if(pom.running){
    if(settings.autoNext){ pom.tickAt=performance.now(); pom.timer=setInterval(pomTick,1000); }
    else pom.running=false;
  }
  renderPom();
}

/* ════════════ The TUTOR link ════════════
   While TUTOR is linked it is the clock. Its session arrives every couple of
   seconds and on every change; FLOW's timer mirrors it (phase, time left,
   running) and the music follows its breaks with the same sync transitions as
   FLOW's own pomodoro. FLOW's timer buttons send commands back to TUTOR. When
   the link drops, FLOW's own timer comes back exactly as it was. */
const link={on:false, saved:null, phase:null};
function setLinked(on){
  if(on===link.on) return;
  link.on=on;
  document.body.classList.toggle('linked',on);
  clearInterval(pom.timer);
  if(on){
    link.saved={phase:pom.phase,long:pom.long,remaining:pom.remaining,total:pom.total};
    pom.running=false;
    toast('Linked to TUTOR');
  } else {
    pom.running=false;
    if(link.saved) Object.assign(pom,link.saved);
    link.saved=null; link.phase=null;
    toast('Unlinked from TUTOR');
  }
  renderPom();
}
function linkTick(){ if(pom.remaining>0) pom.remaining--; pom.tickAt=performance.now(); renderPom(); }
function onLink(m){
  if(m.t==='state'){ setLinked(!!m.on); return; }
  if(m.t!=='session') return;
  if(!link.on) setLinked(true);
  clearInterval(pom.timer);
  if(m.phase==='idle'){ pom.running=false; pom.phase='focus'; renderPom(); return; }
  const ph=m.phase==='break'?'break':'focus';
  if(link.phase&&link.phase!==ph){
    if(settings.chime) chime();
    if(ph==='break') musicToBreak(); else musicToFocus();
  } else if(!link.phase&&ph==='focus'&&m.running) musicForFocus();
  link.phase=ph;
  pom.phase=ph; pom.long=false;
  pom.total=Math.max(1,m.total|0); pom.remaining=Math.max(0,m.left|0);
  pom.running=!!m.running; pom.tickAt=performance.now();
  if(pom.running) pom.timer=setInterval(linkTick,1000);
  renderPom();
}

/* soft chime via WebAudio */
let actx=null;
function chime(){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    [880,1320].forEach((f,i)=>{
      const o=actx.createOscillator(), g=actx.createGain();
      o.type='sine'; o.frequency.value=f;
      o.connect(g); g.connect(actx.destination);
      const t0=actx.currentTime+i*0.16;
      g.gain.setValueAtTime(0,t0);
      g.gain.linearRampToValueAtTime(0.18,t0+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+0.5);
      o.start(t0); o.stop(t0+0.5);
    });
  }catch{}
}

/* ════════════ Noise generator ════════════ */
let noiseSrc=null, noiseGain=null, noiseDucked=false;
function noiseBuf(type){
  const len=actx.sampleRate*4, buf=actx.createBuffer(1,len,actx.sampleRate), d=buf.getChannelData(0);
  if(type==='white'){ for(let i=0;i<len;i++) d[i]=Math.random()*2-1; }
  else if(type==='brown'){ let l=0; for(let i=0;i<len;i++){ const w=Math.random()*2-1; l=(l+0.02*w)/1.02; d[i]=l*3.5; } }
  else { // rain ≈ pink noise (Kellet approx), lowpassed live
    let b0=0,b1=0,b2=0;
    for(let i=0;i<len;i++){ const w=Math.random()*2-1;
      b0=0.997*b0+0.0299*w; b1=0.985*b1+0.0563*w; b2=0.95*b2+0.115*w;
      d[i]=(b0+b1+b2+w*0.1849)*0.6; }
  }
  return buf;
}
function noiseTarget(){ return (noiseDucked?0:1)*(settings.noiseVol/100)*0.5; }
function applyNoiseGain(ms){
  if(!noiseGain||!actx) return;
  const t=actx.currentTime;
  noiseGain.gain.cancelScheduledValues(t);
  noiseGain.gain.setValueAtTime(noiseGain.gain.value,t);
  noiseGain.gain.linearRampToValueAtTime(noiseTarget(),t+(ms||300)/1000);
}
function noiseDuck(on){ noiseDucked=on; if(settings.noise!=='off') applyNoiseGain(1500); }
function setNoise(type){
  settings.noise=type; saveSettings(); reflectNoise();
  if(noiseSrc){ try{noiseSrc.stop();}catch{} try{noiseSrc.disconnect();}catch{} noiseSrc=null; }
  if(type==='off') return;
  ensureGraph();
  if(!actx||!analyser) return;
  if(!noiseGain){ noiseGain=actx.createGain(); noiseGain.gain.value=0; noiseGain.connect(bus); }
  noiseSrc=actx.createBufferSource();
  noiseSrc.buffer=noiseBuf(type);
  noiseSrc.loop=true;
  if(type==='rain'){
    const f=actx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900;
    noiseSrc.connect(f); f.connect(noiseGain);
  } else noiseSrc.connect(noiseGain);
  noiseSrc.start();
  applyNoiseGain(400);
}
function reflectNoise(){
  document.querySelectorAll('.nz').forEach(b=>{ const on=b.dataset.n===settings.noise; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); });
}

/* ════════════ Audio graph (feeds every visual) ════════════
   FLOW's own sound (both players + ambience) → bus → speakers. The analyser listens
   to the bus, or, while another app is the source, to the system audio loopback,
   which never goes to the speakers. */
let analyser=null, zenData=null, bus=null;
function ensureGraph(){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended') actx.resume();
    if(!analyser){
      // sources can only be created once per <audio> element — afterwards all audio routes through the context
      analyser=actx.createAnalyser();
      analyser.fftSize=2048;
      analyser.smoothingTimeConstant=.5;
      analyser.minDecibels=-88; analyser.maxDecibels=-22;
      bus=actx.createGain();
      actx.createMediaElementSource(audioA).connect(bus);
      actx.createMediaElementSource(audioB).connect(bus);
      bus.connect(actx.destination);
      bus.connect(analyser);
      zenData=new Uint8Array(analyser.frequencyBinCount);
    }
  }catch(e){ console.error('audio graph failed',e); }
}

/* system audio: getDisplayMedia, which main.js answers with the loopback and no picker.
   Its "video" is FLOW's own page and is stopped straight away. */
let loopSrc=null, loopStream=null, loopBusy=false, loopErr='', vizLoop=false;
async function startLoop(){
  if(loopStream||loopBusy||loopErr||!settings.sysMedia||!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia) return;
  loopBusy=true;
  try{
    ensureGraph();
    const st=await navigator.mediaDevices.getDisplayMedia({video:true,audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    st.getVideoTracks().forEach(t=>t.stop());
    const tr=st.getAudioTracks()[0];
    if(!tr){ st.getTracks().forEach(t=>t.stop()); throw new Error('no system audio'); }
    if(!settings.sysMedia){ tr.stop(); return; }   // switched off while we waited
    loopStream=st; loopSrc=actx.createMediaStreamSource(st);
    // the stream ends if the output device changes: pick the new one up
    tr.addEventListener('ended',()=>{ stopLoop(); if(settings.sysMedia&&src==='sys') setTimeout(startLoop,1000); });
  }catch(e){ loopErr=e.message||e.name||'capture failed'; console.warn('system audio capture failed:',loopErr); }
  finally{ loopBusy=false; routeViz(); }
}
function stopLoop(){
  if(loopSrc){
    try{ loopSrc.disconnect(); }catch{}
    loopSrc=null;
    if(vizLoop){ vizLoop=false; bus.connect(analyser); }
  }
  if(loopStream){ loopStream.getTracks().forEach(t=>t.stop()); loopStream=null; }
  routeViz();
}
function routeViz(){
  const want=!!loopSrc&&src==='sys';
  if(analyser&&bus&&want!==vizLoop){
    vizLoop=want;
    try{
      if(want){ bus.disconnect(analyser); loopSrc.connect(analyser); }
      else { loopSrc.disconnect(analyser); bus.connect(analyser); }
    }catch(e){ console.warn('visualiser routing',e); }
  }
  reflectSysStatus();
}

/* ════════════ Files + toast ════════════ */
function pickFiles(){ $('file-input').click(); }
let toastT=null;
function toast(msg){
  const el=$('toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),2000);
}

/* ════════════ Views: standard · minimal · mini · full screen ════════════ */
let winMode=winAPI&&winAPI.initialMode==='minimal'?'minimal':'standard';
let onTop=!!(winAPI&&winAPI.initialOnTop);
let miniOn=false, zenOn=false, curMiniH=0, cursorT=null;
const MINI_W=360, MINI_H_BASE=84, MINI_H_POM=58;

function applyModeClass(){
  document.body.classList.toggle('mode-minimal',winMode==='minimal');
  document.body.classList.toggle('mode-standard',winMode==='standard');
  reflectModes();
}
function reflectModes(){
  const cur=zenOn?'fullscreen':miniOn?'mini':winMode;
  document.querySelectorAll('[data-mode]').forEach(b=>{ const on=b.dataset.mode===cur; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); });
  $('pin-btn').classList.toggle('on',onTop); $('pin-btn').setAttribute('aria-pressed',onTop);
  $('pin-btn').title=onTop?'Stop keeping on top':'Keep on top';
  $('ontop-switch').classList.toggle('on',onTop);
}
function setMode(m){
  if(m==='fullscreen'){ enterZen(); return; }
  if(m==='mini'){ enterMini(); return; }
  if(m!=='standard'&&m!=='minimal') return;
  if(zenOn) exitZen();
  const fromMini=miniOn;
  if(miniOn){ miniOn=false; document.body.classList.remove('mini-mode'); }
  if(m===winMode&&!fromMini){ reflectModes(); return; }
  winMode=m; applyModeClass();
  if(winAPI&&winAPI.setMode) winAPI.setMode(m);
}
function setOnTop(on){
  onTop=on;
  if(winAPI&&winAPI.setOnTop) winAPI.setOnTop(on);
  reflectModes();
  toast(on?'Minimal view stays on top':'Minimal view no longer on top');
}

function miniHeight(){ return MINI_H_BASE + (pom.running?MINI_H_POM:0); }
function enterMini(){
  if(miniOn) return;
  if(zenOn) exitZen();
  closeDrawer();
  miniOn=true; document.body.classList.add('mini-mode');
  syncMini(true); curMiniH=miniHeight();
  if(winAPI) winAPI.setMini(true,MINI_W,curMiniH);
  reflectModes();
}
function exitMini(){
  if(!miniOn) return;
  miniOn=false; document.body.classList.remove('mini-mode');
  if(winAPI) winAPI.setMini(false);
  reflectModes();
}
function syncMini(force){
  if(!miniOn && !force) return;
  const t=tracks[current], s=src==='sys'?sys:null, playing=s?s.playing:flowPlaying();
  $('mini-title').textContent=s?(s.title||appName(s.app)):t?stripExt(t.name):'Nothing playing';
  $('mini-sub').textContent=s?appName(s.app)+' · '+(playing?'playing':'paused'):t?(playing?'playing':'paused'):'no track';
  $('mini-pom').style.display = pom.running ? 'flex' : 'none';
  if(pom.running){
    $('mini-time').textContent=clockText(pom.remaining);
    $('mini-phase').textContent=phaseLabel();
    $('mini-bar').style.width=(pomProgress()*100).toFixed(2)+'%';
    $('mini-pom-ico').innerHTML=ICO_PAUSE;
  }
  if(miniOn){
    const h=miniHeight();
    if(h!==curMiniH){ curMiniH=h; if(winAPI) winAPI.setMini(true,MINI_W,h); }
  }
}

function enterZen(){
  if(zenOn) return;
  if(miniOn){ miniOn=false; document.body.classList.remove('mini-mode'); if(winAPI) winAPI.setMini(false); }
  ensureGraph();
  zenOn=true;
  document.body.classList.add('zen-mode');
  if(winAPI) winAPI.setFullscreen(true);
  else document.documentElement.requestFullscreen?.().catch(()=>{});
  zenGeo=null; refreshZen(); wakeCursor(); reflectModes();
}
function exitZenUI(){
  if(!zenOn) return;
  zenOn=false;
  clearTimeout(cursorT);
  document.body.classList.remove('zen-mode','hide-cursor');
  stageGeo=null; reflectModes();
}
function exitZen(){
  exitZenUI();
  if(winAPI) winAPI.setFullscreen(false);
  else if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
}
function wakeCursor(){
  document.body.classList.remove('hide-cursor');
  clearTimeout(cursorT);
  cursorT=setTimeout(()=>{ if(zenOn&&!drawerOpen) document.body.classList.add('hide-cursor'); },2600);
}
function refreshZen(){
  const z=$('zen'), timer=settings.fsContent==='timer';
  z.dataset.ts=timer?settings.timerStyle:'music';
  $('zen-style').textContent=timer?Viz.TIMER_STYLES[settings.timerStyle]:Viz.MUSIC_STYLES[settings.vizStyle];
  $('zen-style').title=timer?'Next timer visual (T)':'Next visualiser style (V)';
  z.classList.toggle('no-clock',!settings.fsClock);
  z.classList.toggle('no-track',!settings.fsTrack);
}
const zc={};
function zSet(id,val){ if(zc[id]===val) return; zc[id]=val; $(id).textContent=val; }
function zenInfo(){
  const idle=!pom.running&&pom.remaining===pom.total;
  if(idle){
    const now=new Date();
    setClock($('zen-time'),two(now.getHours())+':'+two(now.getMinutes()));
    zSet('zen-phase',now.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}));
  } else {
    setClock($('zen-time'),clockText(pom.remaining));
    zSet('zen-phase',phaseLabel()+(pom.running?'':' · paused'));
  }
  $('zen-time').classList.toggle('long',!idle&&pom.remaining>=6000);
  zSet('zen-pom-btn',pom.running?'Pause':pom.remaining<pom.total?'Resume':pom.phase==='focus'?'Start focus':'Start break');
  const t=tracks[current], s=src==='sys'?sys:null;
  if(s){
    zSet('zen-track',(s.title||appName(s.app))+(s.artist?' — '+s.artist:''));
    zSet('zen-tt',appName(s.app)+(s.dur>0?' · '+fmt(sysPos())+' / '+fmt(s.dur):''));
  } else {
    zSet('zen-track',t?stripExt(t.name):'Nothing playing');
    zSet('zen-tt',t?fmt(audio.currentTime)+' / '+fmt(audio.duration||t.duration||0):'no track');
  }
  const w=(idle?0:pomProgress()*100).toFixed(1)+'%';
  if(zc.bar!==w){ zc.bar=w; $('zen-bar').style.width=w; }
}

/* ════════════ Settings drawer ════════════ */
let drawerOpen=false, drawerTab='look';
function setDrawerTab(tab){
  drawerTab=tab;
  document.querySelectorAll('[data-tab]').forEach(b=>{ const on=b.dataset.tab===tab; b.classList.toggle('on',on); b.setAttribute('aria-selected',on); });
  document.querySelectorAll('[data-pane]').forEach(p=>p.classList.toggle('on',p.dataset.pane===tab));
}
function openDrawer(tab){
  if(miniOn) return;
  if(tab) setDrawerTab(tab);
  drawerOpen=true;
  document.body.classList.add('drawer-open');
  $('drawer').setAttribute('aria-hidden','false');
  reflectSettings(); wakeCursor();
}
function closeDrawer(){
  if(!drawerOpen) return;
  drawerOpen=false;
  document.body.classList.remove('drawer-open');
  $('drawer').setAttribute('aria-hidden','true');
  if(zenOn) wakeCursor();
}
function buildSwatches(){
  $('swatches').innerHTML=Object.entries(Viz.PALETTES).map(([id,p])=>
    `<button class="swatch" data-v="${id}" style="--sw-bg:${p.bg};--sw-fg:${p.fg}">
      <span class="sw-art">${p.c.map(c=>`<i style="background:${c}"></i>`).join('')}</span>
      <span class="sw-name">${p.name}</span></button>`).join('');
}
/* a data-v string → the type the setting stores */
function parseFor(key,v){ const d=DEFAULTS[key]; return typeof d==='number'?+v:typeof d==='boolean'?v==='true':v; }
function setPct(inp){ const lo=+inp.min||0, hi=+inp.max||100; inp.style.setProperty('--pct',((inp.value-lo)/(hi-lo)*100).toFixed(1)+'%'); }
function setSetting(k,v){
  if(settings[k]!==v){ settings[k]=v; saveSettings(); onSetting(k); }
  reflectSettings();
}
function onSetting(k){
  if(['theme','depth','grain','motion'].includes(k)) applyTheme();
  else if(k==='focus'||k==='brk'||k==='longBrk'){
    if(!pom.running){
      if(k==='focus'&&pom.phase==='focus') setRemaining(settings.focus*60);
      if(k==='brk'&&pom.phase==='break'&&!pom.long) setRemaining(settings.brk*60);
      if(k==='longBrk'&&pom.phase==='break'&&pom.long) setRemaining(settings.longBrk*60);
    }
    renderPom();
  }
  else if(k==='goal'||k==='longEvery') renderPom();
  else if(k==='side') reflectSide();
  else if(k==='sysMedia') applySysMedia();
  if(['timerStyle','vizStyle','fsContent','fsClock','fsTrack'].includes(k)){ reflectTimerStyle(); zenGeo=null; }
}
function reflectSettings(){
  document.querySelectorAll('[data-set]').forEach(g=>{
    const v=String(settings[g.dataset.set]);
    g.querySelectorAll('[data-v]').forEach(b=>{ const on=b.dataset.v===v; b.classList.toggle('on',on); b.setAttribute('aria-pressed',on); });
  });
  document.querySelectorAll('[data-toggle]').forEach(b=>{ const on=!!settings[b.dataset.toggle]; b.classList.toggle('on',on); b.setAttribute('aria-checked',on); b.setAttribute('role','switch'); });
  document.querySelectorAll('input[data-range]').forEach(inp=>{ if(document.activeElement!==inp) inp.value=settings[inp.dataset.range]; setPct(inp); });
  document.querySelectorAll('[data-out]').forEach(o=>{
    const k=o.dataset.out, v=settings[k];
    o.textContent=k==='vizSmooth'||k==='vizDensity'?Math.round(v*100)+'%':(+v).toFixed(2)+'×';
  });
  document.querySelectorAll('.stepper').forEach(st=>{
    const v=settings[st.dataset.step];
    st.querySelector('.st-val').textContent=v===0&&st.dataset.zero?st.dataset.zero:v+st.dataset.unit;
  });
  $('pom-sync').classList.toggle('on',settings.sync); $('pom-sync').setAttribute('aria-pressed',settings.sync);
  $('preview-tag').textContent=Viz.MUSIC_STYLES[settings.vizStyle];
  reflectModes();
}
function bindSettings(){
  document.querySelectorAll('[data-set]').forEach(g=>{
    g.addEventListener('click',e=>{ const b=e.target.closest('[data-v]'); if(b&&g.contains(b)) setSetting(g.dataset.set,parseFor(g.dataset.set,b.dataset.v)); });
  });
  document.querySelectorAll('[data-toggle]').forEach(b=>b.addEventListener('click',()=>setSetting(b.dataset.toggle,!settings[b.dataset.toggle])));
  document.querySelectorAll('input[data-range]').forEach(inp=>inp.addEventListener('input',()=>setSetting(inp.dataset.range,+inp.value)));
  document.querySelectorAll('.stepper').forEach(st=>st.addEventListener('click',e=>{
    const b=e.target.closest('[data-s]'); if(!b) return;
    const k=st.dataset.step, lo=+st.dataset.min, hi=+st.dataset.max;
    setSetting(k,Math.max(lo,Math.min(hi,settings[k]+(+b.dataset.s)*(e.shiftKey?5:1))));
  }));
}
function reflectSide(){
  document.querySelectorAll('[data-side]').forEach(b=>{ const on=b.dataset.side===settings.side; b.classList.toggle('on',on); b.setAttribute('aria-selected',on); });
  document.querySelectorAll('[data-side-view]').forEach(v=>v.classList.toggle('on',v.dataset.sideView===settings.side));
}
function setSide(s){ setSetting('side',s); }
function reflectTimerStyle(){
  $('stage').dataset.ts=settings.timerStyle;
  $('ts-name').textContent=Viz.TIMER_STYLES[settings.timerStyle];
  refreshZen();
}
function nextKey(obj,cur){ const k=Object.keys(obj); return k[(k.indexOf(cur)+1)%k.length]; }
function cycleViz(){
  setSetting('vizStyle',nextKey(Viz.MUSIC_STYLES,settings.vizStyle));
  if(!zenOn&&!drawerOpen) toast('Visualiser · '+Viz.MUSIC_STYLES[settings.vizStyle]);
}
function cycleTimer(){ setSetting('timerStyle',nextKey(Viz.TIMER_STYLES,settings.timerStyle)); }

/* ════════════ Render loop ════════════
   One rAF loop draws whichever canvases are on screen: the stage dial (standard
   + minimal), the full-screen visual, and the live preview in settings. */
let vizT=0, lastT=0, stageGeo=null, zenGeo=null;
const cvs={};
function canvasFor(id){
  let c=cvs[id];
  if(!c){ const cv=$(id); c=cvs[id]={cv,ctx:cv.getContext('2d'),w:0,h:0,dpr:0}; }
  const dpr=Math.min(2,window.devicePixelRatio||1), w=c.cv.clientWidth, h=c.cv.clientHeight;
  if(!w||!h) return null;
  if(w!==c.w||h!==c.h||dpr!==c.dpr){
    c.w=w; c.h=h; c.dpr=dpr;
    c.cv.width=Math.round(w*dpr); c.cv.height=Math.round(h*dpr);
    c.ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  return c;
}
/* the dial's centre and size, measured from the layout; also sizes the clock text (--S) */
function measureDial(dialId,canvasId,host){
  const d=$(dialId).getBoundingClientRect(), c=$(canvasId).getBoundingClientRect();
  const S=Math.max(60,Math.min(d.width,d.height));
  host.style.setProperty('--S',S.toFixed(1)+'px');
  return {x:d.left-c.left+d.width/2, y:d.top-c.top+d.height/2, S};
}
function vopts(bg,ph,dt,extra){
  const cols=Viz.colours(TH,settings.vizColor,ph);
  const pc=settings.vizColor==='mono'?TH.fg:ph==='focus'?TH.focus:TH.brk;
  const others=cols.filter(c=>c!==pc);
  return Object.assign({
    A:Viz.A, T:vizT, dt, col:i=>cols[((i%5)+5)%5], pc, others:others.length?others:[TH.fg],
    bg, fg:TH.fg, fg2:TH.fg2, track:Viz.mix(bg,TH.fg,.1), faint:Viz.mix(bg,TH.fg,.035),
    dens:settings.vizDensity, sc:settings.vizScale, seed:settings.vizSeed, hole:false, decor:false,
  },extra);
}
function frame(now){
  requestAnimationFrame(frame);
  const still=settings.motion==='still';
  if(now-lastT<1000/(still?4:settings.fps)-4) return;
  const dt=Math.min(.1,(now-lastT)/1000); lastT=now;
  if(document.hidden||miniOn) return;
  const k=still?0:settings.motion==='calm'?.45:1, vdt=dt*settings.vizSpeed*k;
  vizT+=vdt;
  Viz.analyse(still?null:analyser,zenData,actx?actx.sampleRate:48000,dt,
    settings.vizSens*(settings.motion==='calm'?.75:1),settings.vizSmooth,now/1000,vdt);
  const ph=pom.phase==='focus'?'focus':'break';
  const st={p:pomProgress(),phase:ph,running:pom.running,total:pom.total};
  if(zenOn){
    const c=canvasFor('zen-canvas');
    if(c){
      if(!zenGeo) zenGeo=measureDial('zen-dial','zen-canvas',$('zen'));
      if(settings.fsContent==='timer') Viz.drawTimer(c.ctx,c.w,c.h,zenGeo,st,settings.timerStyle,vopts(TH.bg,ph,vdt));
      else Viz.drawMusic(c.ctx,c.w,c.h,settings.vizStyle,vopts(TH.bg,ph,vdt,{hole:settings.fsClock}));
    }
    zenInfo();
  } else {
    const c=canvasFor('stage-canvas');
    if(c){
      if(!stageGeo) stageGeo=measureDial('dial','stage-canvas',$('stage'));
      Viz.drawTimer(c.ctx,c.w,c.h,stageGeo,st,settings.timerStyle,vopts(TH.s0,ph,vdt,{decor:true}));
    }
    if(drawerOpen&&drawerTab==='viz'){
      const p=canvasFor('viz-preview');
      if(p) Viz.drawMusic(p.ctx,p.w,p.h,settings.vizStyle,vopts(TH.bg,ph,vdt));
    }
  }
}

/* ════════════ Wire up ════════════ */
function init(){
  loadSettings();
  makeGrain(); applyTheme(); buildSwatches(); bindSettings();

  // window controls + views
  if(winAPI){
    $('win-min').onclick=()=>winAPI.minimize();
    $('win-close').onclick=()=>winAPI.close();
    $('win-max').onclick=()=>winAPI.toggleMax&&winAPI.toggleMax();
    if(winAPI.onMaxed) winAPI.onMaxed(on=>{
      $('win-max-ico').innerHTML=on?'<rect x="8.5" y="5" width="10.5" height="10.5" rx="2"/><path d="M15.5 19H7a2 2 0 0 1-2-2V8.5"/>':'<rect x="6" y="6" width="12" height="12" rx="2"/>';
      $('win-max').title=on?'Restore':'Maximise';
    });
  }
  document.querySelectorAll('[data-mode]').forEach(b=>{ b.onclick=()=>setMode(b.dataset.mode); });
  $('pin-btn').onclick=()=>setOnTop(!onTop);
  $('ontop-switch').onclick=()=>setOnTop(!onTop);
  $('mini-expand').onclick=exitMini;
  $('mini-play').onclick=togglePlay;
  $('mini-next').onclick=goNext;
  $('mini-pom-toggle').onclick=pomStart;
  document.querySelectorAll('[data-side]').forEach(b=>{ b.onclick=()=>setSide(b.dataset.side); });

  // settings drawer
  $('settings-btn').onclick=()=>drawerOpen?closeDrawer():openDrawer();
  $('drawer-close').onclick=closeDrawer;
  $('scrim').onclick=closeDrawer;
  document.querySelectorAll('[data-tab]').forEach(b=>{ b.onclick=()=>setDrawerTab(b.dataset.tab); });
  $('viz-reseed').onclick=()=>setSetting('vizSeed',settings.vizSeed+1);
  $('viz-reset').onclick=()=>{ Object.assign(settings,VIZ_DEFAULTS); saveSettings(); reflectSettings(); refreshZen(); toast('Visualiser reset'); };

  // full screen
  $('zen-exit').onclick=exitZen;
  $('zen-style').onclick=()=>settings.fsContent==='timer'?cycleTimer():cycleViz();
  $('zen-settings').onclick=()=>drawerOpen?closeDrawer():openDrawer('viz');
  $('zen-play').onclick=togglePlay;
  $('zen-prev').onclick=goPrev;
  $('zen-next').onclick=goNext;
  $('zen-pom-btn').onclick=pomStart;
  $('zen').addEventListener('mousemove',()=>{ if(zenOn) wakeCursor(); });
  if(winAPI && winAPI.onFullscreen) winAPI.onFullscreen(on=>{ if(!on) exitZenUI(); });
  new ResizeObserver(()=>{ stageGeo=null; zenGeo=null; }).observe($('stage'));
  new ResizeObserver(()=>{ stageGeo=null; }).observe($('dial'));
  new ResizeObserver(()=>{ zenGeo=null; }).observe($('zen-dial'));

  // volume
  audioA.volume=audioB.volume=master();
  $('vol').value=settings.vol; setPct($('vol'));

  $('add-top').onclick=pickFiles;
  $('file-input').onchange=e=>{ addFiles(e.target.files); e.target.value=''; };

  for(const [id,fn] of [['play-btn',togglePlay],['sp-play',togglePlay],['prev-btn',goPrev],['sp-prev',goPrev],['next-btn',goNext],['sp-next',goNext]]) $(id).onclick=fn;
  $('loop-btn').onclick=()=>{ loopMode=(loopMode+1)%3; reflectLoop(); };
  $('shuffle-btn').onclick=()=>{ shuffle=!shuffle; reflectShuffle(); };

  // seek (FLOW's own track, or another app's when it allows it)
  const seek=$('seek');
  const seekDur=()=>src==='sys'?sys.dur:audio.duration;
  seek.addEventListener('input',()=>{ seeking=true; setPct(seek);
    if(seekDur()>0) $('t-cur').textContent=fmt((seek.value/1000)*seekDur());
  });
  seek.addEventListener('change',()=>{
    seeking=false;
    if(!(seekDur()>0)) return;
    if(src==='sys') sysCmd('seek',(seek.value/1000)*sys.dur);
    else audio.currentTime=(seek.value/1000)*audio.duration;
  });

  // volume control
  $('vol').addEventListener('input',e=>{
    settings.vol=+e.target.value; saveSettings();
    cancelFade(audio); audio.volume=master();
    setPct(e.target);
  });

  // audio events — attached to BOTH elements; guards keep the inactive one quiet
  for(const el of [audioA,audioB]){
    el.addEventListener('timeupdate',e=>{
      if(e.target!==audio) return;
      maybeCrossfade();
      if(audio.duration&&src==='flow') reflectTime();
    });
    el.addEventListener('loadedmetadata',e=>{ if(e.target===audio&&src==='flow') reflectTime(); });
    el.addEventListener('play',()=>{ ensureGraph(); reflectPlayState(); });
    el.addEventListener('pause',reflectPlayState);
    el.addEventListener('ended',e=>{ if(e.target===audio) nextTrack(true); });
    el.addEventListener('error',e=>{ if(e.target===audio&&audio.getAttribute('src')) toast('That track could not be played'); });
  }

  // media keys (Windows SMTC) only reach FLOW when its own player is the current session,
  // so they drive FLOW's own player; the tray menu follows the panel
  if('mediaSession' in navigator){
    try{
      navigator.mediaSession.setActionHandler('play',flowToggle);
      navigator.mediaSession.setActionHandler('pause',flowToggle);
      navigator.mediaSession.setActionHandler('previoustrack',prevTrack);
      navigator.mediaSession.setActionHandler('nexttrack',()=>nextTrack(false));
    }catch{}
  }
  if(winAPI&&winAPI.onMedia) winAPI.onMedia(act=>{ act==='next'?goNext():act==='pom'?pomStart():togglePlay(); });

  // other apps' media; the bridge reports position only now and then, so tick the bar here
  if(winAPI&&winAPI.onSys) winAPI.onSys(onSys);
  if(winAPI&&winAPI.onLink) winAPI.onLink(onLink);
  $('link-badge').onclick=()=>{ if(winAPI&&winAPI.linkCmd) winAPI.linkCmd('unlink'); setLinked(false); };
  setInterval(()=>{ if(src==='sys'&&sys&&sys.playing) reflectTime(); },500);

  // noise generator
  document.querySelectorAll('.nz').forEach(b=>{ b.onclick=()=>setNoise(b.dataset.n); });
  $('noise-vol').value=settings.noiseVol; setPct($('noise-vol'));
  $('noise-vol').addEventListener('input',e=>{
    settings.noiseVol=+e.target.value; saveSettings();
    setPct(e.target);
    applyNoiseGain(120);
  });
  reflectNoise();
  if(settings.noise!=='off') setNoise(settings.noise);

  // drop audio files anywhere to add them
  document.addEventListener('dragover',e=>{
    if(e.dataTransfer&&e.dataTransfer.types.includes('Files')){
      e.preventDefault(); document.body.classList.add('dropping');
    }
  });
  document.addEventListener('dragleave',e=>{
    if(!e.relatedTarget) document.body.classList.remove('dropping');
  });
  document.addEventListener('drop',e=>{
    document.body.classList.remove('dropping');
    if(e.dataTransfer&&e.dataTransfer.files.length){
      e.preventDefault();
      addFiles(e.dataTransfer.files);
    }
  });

  // pomodoro
  $('pom-start').onclick=pomStart;
  $('pom-reset').onclick=pomReset;
  $('pom-skip').onclick=pomSkip;
  $('pom-count-reset').onclick=pomResetCount;
  $('pom-sync').onclick=()=>setSetting('sync',!settings.sync);
  $('ts-btn').onclick=cycleTimer;
  document.querySelectorAll('[data-ph]').forEach(b=>{ b.onclick=()=>selectPhase(b.dataset.ph); });
  $('intention').value=settings.intention||'';
  $('intention').addEventListener('input',()=>{ settings.intention=$('intention').value; saveSettings(); });

  // keyboard: space play · P timer · F full screen · M minimal · B mini · V/T styles · , settings · Esc
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input:not([type=range]),textarea,select,[contenteditable=true]')){
      if(e.key==='Escape'||e.key==='Enter') e.target.blur();
      return;
    }
    if(e.ctrlKey||e.altKey||e.metaKey) return;
    if(e.code==='Space'){ if(e.target.closest('button')) return; e.preventDefault(); togglePlay(); return; }
    if(e.key==='Escape'){ if(drawerOpen) closeDrawer(); else if(zenOn) exitZen(); return; }
    const k=e.key.toLowerCase();
    if(miniOn&&k!=='b'&&k!=='p') return;
    if(k==='f') zenOn?exitZen():enterZen();
    else if(k==='m') setMode(winMode==='minimal'?'standard':'minimal');
    else if(k==='b') miniOn?exitMini():enterMini();
    else if(k==='v') cycleViz();
    else if(k==='t') cycleTimer();
    else if(k==='p') pomStart();
    else if(k===',') drawerOpen?closeDrawer():openDrawer(zenOn?'viz':null);
  });

  applyModeClass(); reflectSide(); reflectTimerStyle(); setDrawerTab('look');
  reflectLoop(); reflectShuffle();
  loadPom(); renderPom(); reflectSettings();
  updateNP(); renderList();
  document.body.dataset.src=src; applySysMedia();
  loadLibrary();
  requestAnimationFrame(frame);
}
init();
