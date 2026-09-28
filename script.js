const CELL=40, COLS=16, ROWS=12;
const canvas=document.getElementById('game'), ctx=canvas.getContext('2d');
const WIN_WAVE=15;

const maps={
  forest:{name:'Floresta',theme:'forest',
    path:[[0,5],[1,5],[2,5],[3,5],[4,5],[4,2],[5,2],[6,2],[7,2],[7,8],[8,8],[9,8],[10,8],[10,4],[11,4],[12,4],[13,4],[14,4],[15,4],[15,6]]},
  ice:{name:'Gelo',theme:'ice',
    path:[[0,2],[1,2],[2,2],[3,2],[3,9],[4,9],[5,9],[6,9],[6,2],[7,2],[8,2],[9,2],[9,9],[10,9],[11,9],[12,9],[12,2],[13,2],[14,2],[15,2],[15,6]]}
};
const mapThemes={
  forest:{bgTop:'#16261e',bgBottom:'#0a1610',tileA:'#182c22',tileB:'#0f2018',pathShadow:'rgba(0,0,0,.25)',pathBase:'#5f5546',pathGradTop:'#a08e6c',pathGradBottom:'#8a7a5c',speckle:'rgba(255,255,255,.06)',deco:'forest',frameEdge:'#8a7a5c'},
  ice:{bgTop:'#1c2f45',bgBottom:'#0a1420',tileA:'#233c56',tileB:'#152438',pathShadow:'rgba(0,10,30,.35)',pathBase:'#7fa9c9',pathGradTop:'#eaf7ff',pathGradBottom:'#a9d4ec',speckle:'rgba(255,255,255,.14)',deco:'ice',frameEdge:'#9fc9e6'}
};
const pathCells=[], pathSet=new Set(), waypoints=[];
function centerOf(c,r){return {x:c*CELL+CELL/2,y:r*CELL+CELL/2};}
let currentMapKey='forest';
function applyMap(key){
  currentMapKey=key;
  const m=maps[key];
  pathCells.length=0; m.path.forEach(p=>pathCells.push(p));
  pathSet.clear(); pathCells.forEach(p=>pathSet.add(p[0]+','+p[1]));
  waypoints.length=0; pathCells.forEach(([c,r])=>waypoints.push(centerOf(c,r)));
  towers.length=0;
  document.querySelectorAll('.mapBtn').forEach(b=>b.classList.toggle('sel',b.dataset.map===key));
}
const towerTypes={
  arrow:{name:'Arqueiro',cost:20,range:110,dmg:8,rate:35,color:'#4fd1c5'},
  cannon:{name:'Canhão',cost:45,range:90,dmg:28,rate:75,color:'#f6ad55'},
  frost:{name:'Gelo',cost:35,range:100,dmg:4,rate:45,color:'#63b3ed',slow:true},
  sniper:{name:'Sniper',cost:60,range:220,dmg:55,rate:110,color:'#a06bd6',pierce:false}
};
let gold=100, lives=10, wave=0, selectedType='arrow', running=false, gameOver=false;
let towers=[], enemies=[], projectiles=[], frame=0, waveActive=false, spawnQueue=[];
let speed=1, paused=false, bestWave=0, autoWave=false, autoTimer=0;
let particles=[], floaters=[];

// ---------- Áudio melhorado (sintetizado) ----------
let audioCtx=null, soundOn=true, busSfx=null, busMus=null, revSend=null, noiseBuf=null;
const lastPlay={}, RND=(a,b)=>a+Math.random()*(b-a);
function ensureAudio(){
  if(!soundOn) return null;
  if(!audioCtx){
    try{
      const ac=new (window.AudioContext||window.webkitAudioContext)();
      const comp=ac.createDynamicsCompressor();
      comp.threshold.value=-16;comp.knee.value=20;comp.ratio.value=5;comp.attack.value=.004;comp.release.value=.2;
      const master=ac.createGain();master.gain.value=.9;master.connect(comp);comp.connect(ac.destination);
      busSfx=ac.createGain();busSfx.connect(master);
      busMus=ac.createGain();busMus.gain.value=.5;busMus.connect(master);
      const len=Math.floor(ac.sampleRate*1.6), ir=ac.createBuffer(2,len,ac.sampleRate);
      for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.6);}
      const cv=ac.createConvolver();cv.buffer=ir;
      const wet=ac.createGain();wet.gain.value=.3;
      revSend=ac.createGain();revSend.connect(cv);cv.connect(wet);wet.connect(master);
      noiseBuf=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate);
      const nd=noiseBuf.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=Math.random()*2-1;
      audioCtx=ac;
    }catch(e){audioCtx=null;return null;}
  }
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}
function gate(k,gap){
  const ac=ensureAudio(); if(!ac) return false;
  const t=ac.currentTime; if(lastPlay[k]&&t-lastPlay[k]<gap) return false; lastPlay[k]=t; return true;
}
function outNode(g,pan,r,dest){
  let o=g;
  if(pan&&audioCtx.createStereoPanner){const p=audioCtx.createStereoPanner();p.pan.value=pan;g.connect(p);o=p;}
  o.connect(dest||busSfx);
  if(r>0){const s=audioCtx.createGain();s.gain.value=r;o.connect(s);s.connect(revSend);}
}
function voice(f,dur,o={}){
  const ac=ensureAudio(); if(!ac) return;
  const {type='sine',vol=.15,fe=null,delay=0,at=null,atk=.006,det=0,cut=null,cutE=null,r=.15,dest=null,pan=0}=o;
  const t0=at!==null?at:ac.currentTime+delay, g=ac.createGain();
  g.gain.setValueAtTime(.0001,t0);g.gain.linearRampToValueAtTime(vol,t0+atk);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
  let head=g;
  if(cut){const fl=ac.createBiquadFilter();fl.type='lowpass';fl.frequency.setValueAtTime(cut,t0);
    if(cutE)fl.frequency.exponentialRampToValueAtTime(Math.max(cutE,20),t0+dur);fl.connect(g);head=fl;}
  (det?[-det,det]:[0]).forEach(d=>{
    const os=ac.createOscillator();os.type=type;os.detune.value=d;os.frequency.setValueAtTime(f,t0);
    if(fe)os.frequency.exponentialRampToValueAtTime(Math.max(fe,1),t0+dur);
    os.connect(head);os.start(t0);os.stop(t0+dur+.05);
  });
  outNode(g,pan,r,dest);
}
function noise(dur,o={}){
  const ac=ensureAudio(); if(!ac) return;
  const {vol=.2,delay=0,type='lowpass',f0=2000,f1=null,r=.1,pan=0}=o, t0=ac.currentTime+delay;
  const s=ac.createBufferSource();s.buffer=noiseBuf;s.loop=true;
  const fl=ac.createBiquadFilter();fl.type=type;fl.frequency.setValueAtTime(f0,t0);
  if(f1)fl.frequency.exponentialRampToValueAtTime(Math.max(f1,20),t0+dur);
  const g=ac.createGain();g.gain.setValueAtTime(vol,t0);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
  s.connect(fl);fl.connect(g);outNode(g,pan,r);s.start(t0,Math.random());s.stop(t0+dur+.05);
}
const sfx={
  click:()=>voice(660,.06,{type:'triangle',vol:.09,fe:880,r:.05}),
  build:()=>{noise(.12,{vol:.22,f0:700,f1:150});voice(190,.14,{vol:.22,fe:80,r:.05});
    voice(523,.25,{type:'triangle',vol:.1,delay:.07,det:6,r:.3});voice(784,.3,{type:'triangle',vol:.09,delay:.13,det:6,r:.35});},
  denied:()=>{voice(150,.14,{type:'square',vol:.11,cut:600,fe:110,r:.05});voice(150,.16,{type:'square',vol:.11,cut:600,fe:95,delay:.11,r:.05});},
  sell:()=>{voice(1568,.25,{vol:.11,r:.35});voice(2093,.35,{vol:.1,delay:.07,r:.4});noise(.05,{vol:.05,type:'highpass',f0:5000});},
  upgrade:()=>{[440,554,659,880,1108].forEach((f,i)=>voice(f,.28,{type:'triangle',vol:.1,delay:i*.07,det:7,r:.4}));voice(2200,.5,{vol:.05,delay:.3,r:.6});},
  shoot(k){
    if(!gate('s'+k,.04)) return;
    const p=RND(.94,1.06),pan=RND(-.4,.4);
    if(k==='cannon'){noise(.28,{vol:.28,f0:900,f1:90,pan});voice(110*p,.3,{vol:.3,fe:38,pan});voice(300*p,.1,{type:'sawtooth',vol:.06,cut:900,fe:120,pan});}
    else if(k==='frost'){voice(2200*p,.16,{vol:.07,fe:3200,pan,r:.45});voice(3300*p,.22,{vol:.05,delay:.03,pan,r:.5});noise(.1,{vol:.07,type:'highpass',f0:6000,pan});}
    else if(k==='sniper'){noise(.05,{vol:.22,type:'highpass',f0:2500,pan});voice(2600*p,.16,{type:'sawtooth',vol:.11,fe:280,cut:5000,cutE:400,pan,r:.3});voice(90,.12,{vol:.14,fe:50,pan});}
    else{voice(880*p,.09,{type:'triangle',vol:.09,fe:1500*p,det:8,pan,r:.2});noise(.04,{vol:.05,type:'highpass',f0:4000,pan});}
  },
  hit(k){
    if(!gate('h'+k,.05)) return;
    if(k==='cannon'){noise(.2,{vol:.2,f0:600,f1:80});voice(80,.2,{vol:.2,fe:35});}
    else if(k==='frost'){voice(1800,.12,{type:'triangle',vol:.06,fe:1000,r:.4});noise(.06,{vol:.05,type:'highpass',f0:5000});}
    else if(k==='sniper'){noise(.08,{vol:.14,f0:2500,f1:300});voice(220,.1,{type:'square',vol:.08,cut:800,fe:90});}
    else voice(320,.06,{type:'square',vol:.05,cut:1500,fe:160,r:.05});
  },
  enemyDeath(boss){
    if(boss){voice(180,.7,{type:'sawtooth',vol:.22,fe:35,cut:1200,cutE:80,det:12,r:.4});noise(.6,{vol:.24,f0:1200,f1:60,r:.3});voice(60,.6,{vol:.3,fe:28});
      [523,659,784].forEach((f,i)=>voice(f,.4,{type:'triangle',vol:.07,delay:.35+i*.08,r:.5}));}
    else{if(!gate('death',.03))return;const p=RND(.9,1.15);
      voice(520*p,.14,{type:'square',vol:.08,fe:110,cut:2200,cutE:300,r:.15});noise(.08,{vol:.07,f0:2500,f1:400});voice(1046*p,.1,{vol:.05,delay:.05,r:.3});}
  },
  leak:()=>{voice(300,.3,{type:'sawtooth',vol:.15,fe:90,cut:1500,cutE:200,det:10,r:.25});voice(150,.35,{vol:.2,fe:55});noise(.15,{vol:.1,f0:900,f1:100});},
  waveStart(boss){
    if(boss){[110,131,165].forEach(f=>voice(f,.9,{type:'sawtooth',vol:.1,atk:.12,cut:700,cutE:1600,det:9,r:.4}));voice(55,1,{vol:.28,atk:.05,fe:48});
      [440,466,554,880].forEach((f,i)=>voice(f,.25,{type:'sawtooth',vol:.08,delay:.35+i*.11,cut:2500,r:.35}));}
    else[392,523,659].forEach((f,i)=>voice(f,i==2?.4:.22,{type:'triangle',vol:.12,delay:i*.1,det:6,r:.4}));
  },
  waveClear:()=>{[523,659,784,1047].forEach((f,i)=>voice(f,.35,{type:'triangle',vol:.11,delay:i*.08,det:6,r:.45}));voice(1568,.6,{vol:.05,delay:.3,r:.6});},
  win:()=>{[523,659,784,1047,1318,1568].forEach((f,i)=>voice(f,.7,{type:'triangle',vol:.13,delay:i*.14,det:8,r:.55}));
    [262,330,392].forEach(f=>voice(f,1.8,{type:'sawtooth',vol:.05,delay:.8,atk:.15,cut:1400,r:.5}));voice(2093,1.2,{vol:.06,delay:1,r:.7});},
  lose:()=>{[400,340,260,180].forEach((f,i)=>voice(f,.55,{type:'sawtooth',vol:.12,delay:i*.22,cut:1400,cutE:200,det:10,r:.4}));voice(70,1.4,{vol:.26,delay:.7,fe:35});}
};
// música ambiente procedural
const MUSIC={forest:{p:[[57,3],[53,4],[60,4],[55,4]],s:.375},ice:{p:[[50,3],[58,4],[55,3],[57,4]],s:.42}};
const midiHz=n=>440*Math.pow(2,(n-69)/12);
let musicTimer=null, nextNote=0, musicStep=0;
function playStep(t,s){
  const m=MUSIC[currentMapKey]||MUSIC.forest,[root,th]=m.p[Math.floor(s/8)%4],n=[root,root+th,root+7,root+12];
  voice(midiHz(n[[0,1,2,3,2,1,2,1][s%8]]+12),.5,{type:'triangle',vol:.05,at:t,det:5,r:.55,dest:busMus,cut:3000});
  if(s%4===0)voice(midiHz(root-12),.7,{vol:.11,at:t,atk:.02,r:.2,dest:busMus});
  if(s%8===0)[root,root+th,root+7].forEach(x=>voice(midiHz(x),3.2,{type:'sawtooth',vol:.018,at:t,atk:.9,cut:900,det:8,r:.6,dest:busMus}));
}
function musicTick(){
  if(!soundOn||gameOver||paused) return;
  const ac=ensureAudio(); if(!ac) return;
  const m=MUSIC[currentMapKey]||MUSIC.forest;
  if(nextNote<ac.currentTime) nextNote=ac.currentTime+.05;
  while(nextNote<ac.currentTime+.6){playStep(nextNote,musicStep);nextNote+=m.s;musicStep++;}
}
function startMusic(){if(!musicTimer){musicStep=0;nextNote=0;musicTimer=setInterval(musicTick,120);}}
function stopMusic(){clearInterval(musicTimer);musicTimer=null;}

let impactRings=[];
function burst(x,y,color,n){
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2, sp=1+Math.random()*2.5;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-1,life:22+Math.random()*10,maxLife:32,color});
  }
}
function ringBurst(x,y,color,startR=3,speed=2.4,life=16){impactRings.push({x,y,color,r:startR,speed,life,maxLife:life});}
function floatText(x,y,text,color){floaters.push({x,y,text,color,life:38,maxLife:38});}
function updateFx(){
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.12;p.life--;if(p.life<=0)particles.splice(i,1);}
  for(let i=floaters.length-1;i>=0;i--){const f=floaters[i];f.y-=0.6;f.life--;if(f.life<=0)floaters.splice(i,1);}
  for(let i=impactRings.length-1;i>=0;i--){const r=impactRings[i];r.r+=r.speed;r.life--;if(r.life<=0)impactRings.splice(i,1);}
}
function drawFx(){
  impactRings.forEach(r=>{ctx.globalAlpha=Math.max(r.life/r.maxLife,0)*0.8;ctx.beginPath();ctx.arc(r.x,r.y,r.r,0,7);ctx.strokeStyle=r.color;ctx.lineWidth=2;ctx.stroke();});
  ctx.globalAlpha=1;
  particles.forEach(p=>{ctx.globalAlpha=Math.max(p.life/p.maxLife,0);ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,7);ctx.fillStyle=p.color;ctx.fill();});
  ctx.globalAlpha=1;
  floaters.forEach(f=>{ctx.globalAlpha=Math.max(f.life/f.maxLife,0);ctx.font='bold 13px Nunito, system-ui';ctx.textAlign='center';ctx.fillStyle=f.color;ctx.fillText(f.text,f.x,f.y);});
  ctx.globalAlpha=1;ctx.textAlign='left';
}

const towerIcons={arrow:'🏹',cannon:'💣',frost:'❄️',sniper:'🎯'};
const towerBar=document.getElementById('towerBar');
Object.entries(towerTypes).forEach(([key,t])=>{
  const b=document.createElement('div');
  b.className='towerBtn'+(key==='arrow'?' sel':'');
  b.dataset.key=key;
  b.style.setProperty('--tcolor',t.color);
  b.innerHTML='<span class="ico">'+towerIcons[key]+'</span>'+t.name+'<small>💰'+t.cost+'</small>';
  b.onclick=()=>{selectedType=key;document.querySelectorAll('.towerBtn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');};
  towerBar.appendChild(b);
});
function isPath(c,r){return pathSet.has(c+','+r);}

let selectedTower=null;
canvas.addEventListener('click',e=>{
  if(gameOver||paused) return;
  const rect=canvas.getBoundingClientRect();
  const x=(e.clientX-rect.left)*canvas.width/rect.width, y=(e.clientY-rect.top)*canvas.height/rect.height;
  const c=Math.floor(x/CELL), r=Math.floor(y/CELL);
  if(c<0||c>=COLS||r<0||r>=ROWS) return;
  if(isPath(c,r)){setMsg('Não pode construir no caminho!');sfx.denied();return;}
  const existing=towers.find(t=>t.c===c&&t.r===r);
  if(existing){showUpgradePanel(existing);sfx.click();return;}
  hideUpgradePanel();
  const type=towerTypes[selectedType];
  if(gold<type.cost){setMsg('Ouro insuficiente!');sfx.denied();return;}
  gold-=type.cost;
  const pos=centerOf(c,r);
  towers.push({c,r,x:pos.x,y:pos.y,key:selectedType,...type,cooldown:0,cast:0,level:1,baseDmg:type.dmg,baseRange:type.range,baseRate:type.rate,spent:type.cost});
  updateHud();setMsg('Torre construída!');sfx.build();
});
function upgradeCost(t){return Math.round(t.cost*0.85*t.level);}
function showUpgradePanel(t){
  selectedTower=t;
  document.getElementById('upgradePanel').classList.remove('hidden');
  const maxed=t.level>=4;
  document.getElementById('upgradeInfo').innerHTML=`${t.name} — Nível <b>${t.level}</b>${maxed?' (máx)':''} &nbsp;|&nbsp; Dano <b>${Math.round(t.dmg)}</b> &nbsp;|&nbsp; Alcance <b>${Math.round(t.range)}</b>`;
  const btn=document.getElementById('upgradeBtn'), cost=upgradeCost(t);
  btn.textContent=maxed?'Nível Máximo':`Melhorar (💰${cost})`;
  btn.disabled=maxed||gold<cost;
  document.getElementById('sellBtn').textContent=`Vender (+💰${Math.round(t.spent*0.5)})`;
}
function hideUpgradePanel(){selectedTower=null;document.getElementById('upgradePanel').classList.add('hidden');}
document.getElementById('closeUpgrade').onclick=hideUpgradePanel;
document.getElementById('upgradeBtn').onclick=()=>{
  if(!selectedTower||selectedTower.level>=4) return;
  const cost=upgradeCost(selectedTower); if(gold<cost) return;
  gold-=cost; selectedTower.spent+=cost; selectedTower.level++;
  selectedTower.dmg=Math.round(selectedTower.baseDmg*(1+0.5*(selectedTower.level-1)));
  selectedTower.range=Math.round(selectedTower.baseRange+10*(selectedTower.level-1));
  selectedTower.rate=Math.max(12,Math.round(selectedTower.baseRate*Math.pow(0.88,selectedTower.level-1)));
  updateHud();showUpgradePanel(selectedTower);
  setMsg(selectedTower.name+' evoluiu para nível '+selectedTower.level+'!');sfx.upgrade();
};
document.getElementById('sellBtn').onclick=()=>{
  if(!selectedTower) return;
  gold+=Math.round(selectedTower.spent*0.5);
  towers=towers.filter(t=>t!==selectedTower);
  hideUpgradePanel();updateHud();setMsg('Torre vendida.');sfx.sell();
};
function setMsg(m){document.getElementById('msg').textContent=m;}
function updateHud(){
  document.getElementById('gold').textContent=gold;
  document.getElementById('lives').textContent=lives;
  document.getElementById('wave').textContent=wave;
  document.getElementById('best').textContent=bestWave;
  if(selectedTower) showUpgradePanel(selectedTower);
}
document.getElementById('speedBtn').onclick=()=>{
  speed=speed===1?2:1;
  const b=document.getElementById('speedBtn');
  b.textContent=(speed===1?'▶ 1x':'⏩ 2x');b.classList.toggle('active',speed===2);sfx.click();
};
document.getElementById('pauseBtn').onclick=()=>{
  paused=!paused;
  const b=document.getElementById('pauseBtn');
  b.textContent=paused?'▶ Continuar':'⏸ Pausar';b.classList.toggle('active',paused);sfx.click();
};
document.getElementById('autoWave').onchange=e=>{autoWave=e.target.checked;sfx.click();};
document.querySelectorAll('.mapBtn').forEach(b=>{
  b.onclick=()=>{
    if(b.dataset.map===currentMapKey) return;
    if(wave>0){setMsg('Reinicie o jogo (🔁) para trocar de mapa.');sfx.denied();return;}
    applyMap(b.dataset.map);gold=100;hideUpgradePanel();updateHud();
    setMsg('Mapa alterado para '+maps[b.dataset.map].name+'!');sfx.click();
  };
});
document.getElementById('muteBtn').onclick=()=>{
  soundOn=!soundOn;
  const b=document.getElementById('muteBtn');
  b.textContent=soundOn?'🔊 Som':'🔇 Mudo';b.classList.toggle('muted',!soundOn);
  if(soundOn) sfx.click();
};
function showBanner(text){
  const b=document.getElementById('waveBanner');
  b.textContent=text;b.classList.add('show');
  clearTimeout(showBanner._t);showBanner._t=setTimeout(()=>b.classList.remove('show'),1400);
}
const enemyPalette=['#8b3a3a','#3a5f8b','#4a7a3a','#7a4a8b','#a87a2f'];
function startWave(){
  if(waveActive||gameOver||wave>=WIN_WAVE) return;
  wave++;
  const count=5+wave*2, isBoss=wave%5===0;
  spawnQueue=[];
  const tunic=enemyPalette[(wave-1)%enemyPalette.length];
  for(let i=0;i<count;i++){
    const fast=!isBoss&&wave>2&&i%4===0;
    spawnQueue.push({hp:30+wave*12,maxHp:30+wave*12,speed:(fast?1.7:1)+wave*0.04,delay:i*30,tunic,fast});
  }
  if(isBoss) spawnQueue.push({hp:400+wave*60,maxHp:400+wave*60,speed:0.7,delay:count*30+40,tunic:'#c0392b',boss:true});
  waveActive=true;
  showBanner(isBoss?'⚔️ Onda de Chefe '+wave+'!':'🌊 Onda '+wave);
  updateHud();sfx.waveStart(isBoss);
}
document.getElementById('waveBtn').onclick=startWave;
function spawnEnemy(base){
  enemies.push({x:waypoints[0].x,y:waypoints[0].y,wp:1,hp:base.hp,maxHp:base.maxHp,speed:base.speed,slowT:0,tunic:base.tunic,seed:Math.random()*10,fast:!!base.fast,boss:!!base.boss});
}
function tick(){
  frame++;
  if(waveActive&&spawnQueue.length){
    if(spawnQueue[0].delay<=0) spawnEnemy(spawnQueue.shift());
    else spawnQueue.forEach(s=>s.delay--);
  }
  for(let i=enemies.length-1;i>=0;i--){
    const en=enemies[i];
    let spd=en.speed*(en.slowT>0?0.5:1);
    if(en.slowT>0) en.slowT--;
    const target=waypoints[en.wp];
    if(!target){
      lives--;enemies.splice(i,1);updateHud();sfx.leak();
      if(lives<=0){endGame(false);return;}
      continue;
    }
    const dx=target.x-en.x, dy=target.y-en.y, dist=Math.hypot(dx,dy);
    if(dist<spd) en.wp++; else {en.x+=dx/dist*spd;en.y+=dy/dist*spd;}
    if(en.hp<=0){
      const g=(en.boss?40:5)+wave;
      gold+=g;enemies.splice(i,1);updateHud();
      burst(en.x,en.y,en.boss?'#ffd700':'#e8564a',en.boss?18:8);
      floatText(en.x,en.y-16,'+'+g,'#f6ad55');sfx.enemyDeath(en.boss);
    }
  }
  updateFx();
  towers.forEach(t=>{
    if(t.cast>0) t.cast--;
    if(t.cooldown>0){t.cooldown--;return;}
    let target=null,best=Infinity;
    enemies.forEach(en=>{const d=Math.hypot(en.x-t.x,en.y-t.y);if(d<=t.range&&d<best){best=d;target=en;}});
    if(target){
      projectiles.push({x:t.x,y:t.y-18,target,dmg:t.dmg,color:t.color,slow:t.slow,key:t.key,trail:[]});
      t.cooldown=t.rate;t.cast=14;
      burst(t.x,t.y-18,t.color,t.key==='cannon'?9:6);
      ringBurst(t.x,t.y-18,t.color,3,2,14);sfx.shoot(t.key);
    }
  });
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i];
    if(!enemies.includes(p.target)){projectiles.splice(i,1);continue;}
    const dx=p.target.x-p.x, dy=p.target.y-p.y, dist=Math.hypot(dx,dy);
    if(dist<8){
      p.target.hp-=p.dmg;sfx.hit(p.key);
      if(p.slow) p.target.slowT=60;
      burst(p.x,p.y,p.color,p.key==='cannon'?16:(p.key==='sniper'?10:7));
      ringBurst(p.x,p.y,p.color,4,p.key==='cannon'?3.2:2.2,p.key==='cannon'?20:14);
      if(p.key==='frost') burst(p.x,p.y,'#eaf7ff',5);
      projectiles.splice(i,1);
    }else{
      const spd=p.key==='sniper'?18:6;
      p.x+=dx/dist*spd;p.y+=dy/dist*spd;
    }
  }
  if(waveActive&&!spawnQueue.length&&!enemies.length){
    waveActive=false;gold+=20;updateHud();
    if(wave>bestWave){bestWave=wave;updateHud();}
    if(wave>=WIN_WAVE){endGame(true);return;}
    setMsg('Onda '+wave+' concluída! +20 ouro bônus.');sfx.waveClear();
    if(autoWave) autoTimer=90;
  }
  if(autoWave&&!waveActive&&autoTimer>0){autoTimer--;if(autoTimer<=0) startWave();}
}
function update(){
  if(paused||gameOver) return;
  tick();
  if(speed===2) tick();
}let ambient=[];
function seedAmbient(){
  ambient=[];
  for(let i=0;i<24;i++) ambient.push({x:Math.random()*canvas.width,y:Math.random()*canvas.height,vy:0.3+Math.random()*0.5,vx:(Math.random()-0.5)*0.4,drift:Math.random()*Math.PI*2,size:2+Math.random()*2});
}
function updateAmbient(){
  const ice=mapThemes[maps[currentMapKey].theme].deco==='ice';
  ambient.forEach(a=>{
    a.drift+=0.02;a.y+=a.vy*(ice?1:0.7);a.x+=a.vx+Math.sin(a.drift)*(ice?0.3:0.6);
    if(a.y>canvas.height+10){a.y=-10;a.x=Math.random()*canvas.width;}
    if(a.x<-10)a.x=canvas.width+10; if(a.x>canvas.width+10)a.x=-10;
  });
}
function drawAmbient(){
  const ice=mapThemes[maps[currentMapKey].theme].deco==='ice';
  ambient.forEach(a=>{
    if(ice){ctx.beginPath();ctx.arc(a.x,a.y,a.size*0.7,0,7);ctx.fillStyle='rgba(255,255,255,.75)';ctx.shadowColor='#fff';ctx.shadowBlur=4;ctx.fill();ctx.shadowBlur=0;}
    else{ctx.save();ctx.translate(a.x,a.y);ctx.rotate(a.drift);ctx.beginPath();ctx.ellipse(0,0,a.size,a.size*0.5,0,0,7);ctx.fillStyle='rgba(120,200,120,.55)';ctx.fill();ctx.restore();}
  });
}
function drawSkyGlow(){
  const ice=mapThemes[maps[currentMapKey].theme].deco==='ice';
  const gx=canvas.width*0.85, gy=canvas.height*0.14;
  const g=ctx.createRadialGradient(gx,gy,2,gx,gy,60);
  g.addColorStop(0,ice?'rgba(210,235,255,.4)':'rgba(255,230,160,.35)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.beginPath();ctx.arc(gx,gy,60,0,7);ctx.fillStyle=g;ctx.fill();
  ctx.beginPath();ctx.arc(gx,gy,ice?10:12,0,7);
  ctx.fillStyle=ice?'#eaf6ff':'#ffe9b8';ctx.shadowColor=ice?'#cfeaff':'#ffdb8a';ctx.shadowBlur=16;ctx.fill();ctx.shadowBlur=0;
}
seedAmbient();
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawMap();drawMapExtras();drawSkyGlow();updateAmbient();drawAmbient();
  towers.forEach(t=>drawWizard(t));
  enemies.forEach(en=>drawEnemy(en));
  projectiles.forEach(p=>drawProjectile(p));
  drawFx();
  const vg=ctx.createRadialGradient(canvas.width/2,canvas.height/2,canvas.height*0.35,canvas.width/2,canvas.height/2,canvas.height*0.75);
  vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,.28)');
  ctx.fillStyle=vg;ctx.fillRect(0,0,canvas.width,canvas.height);
  if(paused){
    ctx.fillStyle='rgba(0,0,0,.45)';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#fff';ctx.font='bold 28px system-ui';ctx.textAlign='center';
    ctx.fillText('⏸ PAUSADO',canvas.width/2,canvas.height/2);ctx.textAlign='left';
  }
}

function drawEnemy(en){
  const swing=Math.sin(frame/4+en.seed);
  const tg=waypoints[en.wp];
  const dir=(tg&&tg.x<en.x-0.5)?-1:1;
  const sc=en.boss?1.6:(en.fast?0.92:1);
  const frosted=en.slowT>0;
  const skin=frosted?'#bcd9ef':'#dba876';
  const tunic=frosted?'#7fb8e8':en.tunic;
  ctx.save();
  ctx.translate(en.x,en.y);
  ctx.scale(sc*dir,sc);
  ctx.beginPath();ctx.ellipse(0,14,10,3.2,0,0,7);ctx.fillStyle='rgba(0,0,0,.35)';ctx.fill();
  ctx.lineCap='round';
  if(en.fast){
    ctx.beginPath();ctx.moveTo(-3,-6);ctx.lineTo(-13-swing*3,5);ctx.lineTo(-3,9);ctx.closePath();
    ctx.fillStyle=tunic;ctx.globalAlpha=.75;ctx.fill();ctx.globalAlpha=1;
  }
  ctx.strokeStyle='#3a2a1c';ctx.lineWidth=3.4;
  ctx.beginPath();ctx.moveTo(-3,4);ctx.lineTo(-4+swing*4,12);ctx.stroke();
  ctx.beginPath();ctx.moveTo(3,4);ctx.lineTo(4-swing*4,12);ctx.stroke();
  ctx.fillStyle='#22170d';
  ctx.beginPath();ctx.ellipse(-4+swing*4,13,3,1.8,0,0,7);ctx.fill();
  ctx.beginPath();ctx.ellipse(4-swing*4,13,3,1.8,0,0,7);ctx.fill();
  ctx.strokeStyle=skin;ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(-6,-3);ctx.lineTo(-9-swing*2,4);ctx.stroke();
  if(!en.fast){
    ctx.beginPath();ctx.arc(-10-swing*2,3,5.2,0,7);
    ctx.fillStyle=en.boss?'#7a7f88':'#8a5a2b';ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=1;ctx.stroke();
    ctx.beginPath();ctx.arc(-10-swing*2,3,1.6,0,7);ctx.fillStyle='#d8c27a';ctx.fill();
  }
  ctx.fillStyle=tunic;ctx.fillRect(-6,-7,12,13);
  ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(-6,0,12,6);
  ctx.strokeStyle='rgba(0,0,0,.4)';ctx.lineWidth=1;ctx.strokeRect(-6,-7,12,13);
  if(en.boss){
    ctx.fillStyle='#8a8f98';ctx.fillRect(-5,-6,10,8);
    ctx.strokeStyle='#ffd700';ctx.lineWidth=1;ctx.strokeRect(-5,-6,10,8);
    ctx.fillStyle='#ffd700';ctx.fillRect(-1,-6,2,8);
  }
  ctx.fillStyle='#4a3020';ctx.fillRect(-6,2,12,2.4);
  ctx.fillStyle='#d8c27a';ctx.fillRect(-1.5,2,3,2.4);
  const sx=9+swing*3, sy=3-swing*3;
  ctx.strokeStyle=skin;ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(6,-3);ctx.lineTo(sx,sy);ctx.stroke();
  ctx.strokeStyle='#dfe3e8';ctx.lineWidth=2.2;
  ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+5+swing*2,sy-11);ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,.8)';ctx.lineWidth=.8;
  ctx.beginPath();ctx.moveTo(sx+.6,sy-1);ctx.lineTo(sx+5.6+swing*2,sy-11);ctx.stroke();
  ctx.fillStyle='#b8902f';ctx.fillRect(sx-2.5,sy-1,5,1.8);
  ctx.beginPath();ctx.arc(0,-12,5,0,7);ctx.fillStyle=skin;ctx.fill();
  ctx.fillStyle=en.boss?'#ff3b30':'#1a1208';
  ctx.beginPath();ctx.arc(1.8,-12,en.boss?1.2:.9,0,7);ctx.fill();
  if(en.boss){ctx.shadowColor='#ff3b30';ctx.shadowBlur=6;ctx.fill();ctx.shadowBlur=0;}
  if(en.fast){
    ctx.beginPath();ctx.arc(0,-12.5,5.8,Math.PI*0.95,Math.PI*2.05);
    ctx.fillStyle=tunic;ctx.fill();ctx.strokeStyle='rgba(0,0,0,.35)';ctx.lineWidth=1;ctx.stroke();
  }else{
    ctx.beginPath();ctx.arc(0,-13,5.6,Math.PI,0);
    ctx.fillStyle=frosted?'#4d7fb0':(en.boss?'#4a1010':'#9aa0a8');ctx.fill();
    ctx.fillRect(-5.6,-13,11.2,2);
    ctx.fillStyle='rgba(255,255,255,.35)';ctx.fillRect(-3,-17,2,2);
    ctx.beginPath();ctx.moveTo(0,-18);ctx.quadraticCurveTo(-5-swing*2,-22,-7-swing*3,-16);
    ctx.strokeStyle=en.boss?'#ffd700':'#c0392b';ctx.lineWidth=2.4;ctx.stroke();
  }
  if(en.boss){
    ctx.fillStyle='#ffd700';
    [[-5],[0],[5]].forEach(([dx])=>{ctx.beginPath();ctx.moveTo(dx-2,-17);ctx.lineTo(dx,-25);ctx.lineTo(dx+2,-17);ctx.closePath();ctx.fill();});
  }
  ctx.restore();
  const bw=en.boss?38:24, by=en.y-23*sc, hp=Math.max(en.hp,0)/en.maxHp;
  ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillRect(en.x-bw/2-1,by-1,bw+2,6);
  ctx.fillStyle=frosted?'#63b3ed':(hp>.5?'#48bb78':(hp>.25?'#ecc94b':'#e8564a'));
  ctx.fillRect(en.x-bw/2,by,bw*hp,4);
  if(en.boss){ctx.strokeStyle='#ffd700';ctx.lineWidth=1;ctx.strokeRect(en.x-bw/2-1,by-1,bw+2,6);}
}

function drawProjectile(p){
  const trailLen=p.key==='sniper'?9:6;
  p.trail.push({x:p.x,y:p.y});
  if(p.trail.length>trailLen) p.trail.shift();
  ctx.save();
  for(let i=0;i<p.trail.length;i++){
    const pt=p.trail[i], a=(i+1)/p.trail.length;
    ctx.globalAlpha=a*0.5;
    ctx.beginPath();ctx.arc(pt.x,pt.y,2.5*a+0.8,0,7);
    ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=6*a;ctx.fill();
  }
  ctx.shadowBlur=0;ctx.globalAlpha=1;
  if(p.key==='cannon'){
    const r=5.5+Math.sin(frame/2)*1.2;
    ctx.beginPath();ctx.arc(p.x,p.y,r+3,0,7);ctx.fillStyle=p.color+'33';ctx.fill();
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,7);ctx.fillStyle='#ffd28a';ctx.shadowColor=p.color;ctx.shadowBlur=14;ctx.fill();
    ctx.beginPath();ctx.arc(p.x,p.y,r*0.55,0,7);ctx.fillStyle=p.color;ctx.fill();
    ctx.beginPath();ctx.arc(p.x-r*0.2,p.y-r*0.25,r*0.22,0,7);ctx.fillStyle='#fff6e6';ctx.fill();
  }else if(p.key==='frost'){
    ctx.beginPath();ctx.arc(p.x,p.y,7,0,7);ctx.fillStyle=p.color+'22';ctx.fill();
    ctx.translate(p.x,p.y);ctx.rotate(frame/8);
    ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(4.5,0);ctx.lineTo(0,7);ctx.lineTo(-4.5,0);ctx.closePath();
    ctx.fillStyle='#eaf7ff';ctx.shadowColor=p.color;ctx.shadowBlur=12;ctx.fill();
    ctx.beginPath();ctx.moveTo(0,-3);ctx.lineTo(2,0);ctx.lineTo(0,3);ctx.lineTo(-2,0);ctx.closePath();
    ctx.fillStyle=p.color;ctx.fill();
  }else if(p.key==='sniper'){
    ctx.strokeStyle=p.color;ctx.lineWidth=2.5;ctx.shadowColor=p.color;ctx.shadowBlur=12;ctx.lineCap='round';
    ctx.beginPath();
    p.trail.forEach((pt,i)=>i?ctx.lineTo(pt.x,pt.y):ctx.moveTo(pt.x,pt.y));
    ctx.lineTo(p.x,p.y);ctx.stroke();
    ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.shadowBlur=6;
    ctx.beginPath();ctx.moveTo(p.x-6,p.y);ctx.lineTo(p.x+6,p.y);ctx.stroke();
  }else{
    ctx.beginPath();ctx.arc(p.x,p.y,4,0,7);ctx.fillStyle='#fff';ctx.shadowColor=p.color;ctx.shadowBlur=12;ctx.fill();
    ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,7);ctx.fillStyle=p.color;ctx.fill();
    const oa=frame/4, ox=p.x+Math.cos(oa)*6, oy=p.y+Math.sin(oa)*6;
    ctx.beginPath();ctx.arc(ox,oy,1.4,0,7);ctx.fillStyle=p.color;ctx.shadowBlur=8;ctx.fill();
  }
  ctx.shadowBlur=0;
  ctx.restore();
}
function hash(a,b){const x=Math.sin(a*127.1+b*311.7)*43758.5453;return x-Math.floor(x);}

function drawMap(){
  const theme=mapThemes[maps[currentMapKey].theme];
  const bgGrad=ctx.createLinearGradient(0,0,0,canvas.height);
  bgGrad.addColorStop(0,theme.bgTop);bgGrad.addColorStop(1,theme.bgBottom);
  ctx.fillStyle=bgGrad;ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let c=0;c<COLS;c++)for(let r=0;r<ROWS;r++){
    if(isPath(c,r)) continue;
    ctx.fillStyle=hash(c,r)>0.5?theme.tileA:theme.tileB;
    ctx.fillRect(c*CELL,r*CELL,CELL,CELL);
    for(let k=0;k<3;k++){
      ctx.fillStyle=theme.speckle;
      ctx.fillRect(c*CELL+hash(c*3+k,r)*CELL,r*CELL+hash(r*3+k,c)*CELL,2,2);
    }
    if(hash(c*7,r*11)>0.8){
      const bx=c*CELL+hash(c*9,r)*CELL, by=r*CELL+hash(r*9,c)*CELL;
      if(theme.deco==='ice'){
        ctx.strokeStyle='rgba(220,245,255,.35)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(bx-3,by);ctx.lineTo(bx+3,by);ctx.moveTo(bx,by-3);ctx.lineTo(bx,by+3);
        ctx.moveTo(bx-2,by-2);ctx.lineTo(bx+2,by+2);ctx.moveTo(bx-2,by+2);ctx.lineTo(bx+2,by-2);ctx.stroke();
      }else{
        ctx.strokeStyle='rgba(180,255,190,.15)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx-2,by-6);ctx.moveTo(bx+2,by);ctx.lineTo(bx+3,by-5);ctx.stroke();
      }
    }
  }
  ctx.strokeStyle=theme.pathShadow;ctx.lineWidth=CELL*0.86;ctx.lineJoin='round';ctx.lineCap='round';
  ctx.beginPath();waypoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y+2):ctx.moveTo(p.x,p.y+2));ctx.stroke();
  ctx.strokeStyle=theme.pathBase;ctx.lineWidth=CELL*0.82;
  ctx.beginPath();waypoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
  const pathGrad=ctx.createLinearGradient(0,0,0,canvas.height);
  pathGrad.addColorStop(0,theme.pathGradTop);pathGrad.addColorStop(1,theme.pathGradBottom);
  ctx.strokeStyle=pathGrad;ctx.lineWidth=CELL*0.68;
  ctx.beginPath();waypoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
  if(theme.deco==='ice'){
    ctx.save();ctx.globalAlpha=.55;ctx.strokeStyle='#fff';ctx.lineWidth=1.5;
    ctx.beginPath();waypoints.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.setLineDash([2,10]);ctx.lineDashOffset=-frame/3;ctx.stroke();ctx.setLineDash([]);ctx.restore();
  }
  pathCells.forEach(([c,r])=>{
    for(let k=0;k<5;k++){
      const hx=hash(c*5+k,r)*CELL, hy=hash(r*5+k,c)*CELL, rr=1.5+hash(c*13+k,r)*1.5;
      ctx.fillStyle=theme.deco==='ice'?'rgba(20,40,70,.12)':'rgba(0,0,0,.1)';
      ctx.beginPath();ctx.ellipse(c*CELL+hx,r*CELL+hy,rr,rr*0.7,0,0,7);ctx.fill();
      ctx.fillStyle=theme.deco==='ice'?'rgba(255,255,255,.45)':'rgba(255,255,255,.08)';
      ctx.beginPath();ctx.ellipse(c*CELL+hx-1,r*CELL+hy-1,rr*0.5,rr*0.35,0,0,7);ctx.fill();
    }
  });
  for(let c=0;c<COLS;c++)for(let r=0;r<ROWS;r++){
    if(isPath(c,r)||towers.some(t=>t.c===c&&t.r===r)) continue;
    const h=hash(c*17,r*13);
    if(h>0.86){
      const x=c*CELL+CELL/2, y=r*CELL+CELL/2;
      if(theme.deco==='ice'){
        if(h>0.93){
          ctx.beginPath();ctx.ellipse(x,y+2,7,3,0,0,7);ctx.fillStyle='rgba(0,10,30,.25)';ctx.fill();
          ctx.beginPath();ctx.moveTo(x-5,y-2);ctx.lineTo(x,y-14);ctx.lineTo(x+5,y-2);ctx.closePath();ctx.fillStyle='#dff3ff';ctx.fill();
          ctx.beginPath();ctx.moveTo(x-1,y-3);ctx.lineTo(x,y-11);ctx.lineTo(x+1,y-3);ctx.closePath();ctx.fillStyle='rgba(160,210,235,.7)';ctx.fill();
        }else{
          ctx.beginPath();ctx.ellipse(x,y+3,6,2,0,0,7);ctx.fillStyle='rgba(0,10,30,.25)';ctx.fill();
          ctx.beginPath();ctx.ellipse(x,y,6,4,0,0,7);ctx.fillStyle='#eef8ff';ctx.fill();
          ctx.beginPath();ctx.ellipse(x-1,y-1,3,2,0,0,7);ctx.fillStyle='#c7e6f7';ctx.fill();
        }
      }else if(h>0.93){
        ctx.beginPath();ctx.ellipse(x,y+2,7,3,0,0,7);ctx.fillStyle='rgba(0,0,0,.2)';ctx.fill();
        ctx.fillStyle='#5a3b1e';ctx.fillRect(x-2,y-2,4,8);
        ctx.beginPath();ctx.arc(x,y-8,9,0,7);ctx.fillStyle='#245c30';ctx.fill();
        ctx.beginPath();ctx.arc(x-4,y-4,6,0,7);ctx.fillStyle='#2c6b38';ctx.fill();
      }else{
        ctx.beginPath();ctx.ellipse(x,y+3,6,2,0,0,7);ctx.fillStyle='rgba(0,0,0,.2)';ctx.fill();
        ctx.beginPath();ctx.ellipse(x,y,6,4,0,0,7);ctx.fillStyle='#8b8b8b';ctx.fill();
        ctx.beginPath();ctx.ellipse(x-1,y-1,3,2,0,0,7);ctx.fillStyle='#a3a3a3';ctx.fill();
      }
    }
  }
  const sp=waypoints[0];
  const pc=theme.deco==='ice'?['rgba(150,220,255,.55)','rgba(80,170,230,0)','#bfe9ff','#7fd0ff','#e8f9ff']:['rgba(180,120,230,.55)','rgba(120,60,200,0)','#c9a3e8','#a06bd6','#f0e0ff'];
  const pg=ctx.createRadialGradient(sp.x,sp.y,2,sp.x,sp.y,18);
  pg.addColorStop(0,pc[0]);pg.addColorStop(1,pc[1]);
  ctx.beginPath();ctx.arc(sp.x,sp.y,18,0,7);ctx.fillStyle=pg;ctx.fill();
  for(let i=0;i<2;i++){
    ctx.beginPath();ctx.arc(sp.x,sp.y,10+i*4+Math.sin(frame/15+i)*2,0,7);
    ctx.strokeStyle=i?pc[2]:pc[3];ctx.lineWidth=2;ctx.stroke();
  }
  ctx.beginPath();ctx.arc(sp.x,sp.y,6,0,7);ctx.fillStyle=pc[4];ctx.shadowColor=pc[3];ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
  const ep=waypoints[waypoints.length-1];
  ctx.fillStyle='rgba(0,0,0,.25)';ctx.beginPath();ctx.ellipse(ep.x,ep.y+15,20,5,0,0,7);ctx.fill();
  const postGrad=ctx.createLinearGradient(0,ep.y-18,0,ep.y+4);
  postGrad.addColorStop(0,'#6b5842');postGrad.addColorStop(1,'#463724');
  ctx.fillStyle=postGrad;
  ctx.fillRect(ep.x-15,ep.y-17,7,22);ctx.fillRect(ep.x+8,ep.y-17,7,22);ctx.fillRect(ep.x-17,ep.y-19,34,6);
  ctx.fillStyle='#c0392b';ctx.shadowColor='#e8564a';ctx.shadowBlur=8;
  ctx.beginPath();ctx.moveTo(ep.x+15,ep.y-16);ctx.lineTo(ep.x+26,ep.y-12);ctx.lineTo(ep.x+15,ep.y-8);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;
  ctx.strokeStyle='rgba(0,0,0,.35)';ctx.lineWidth=8;ctx.strokeRect(4,4,canvas.width-8,canvas.height-8);
  ctx.strokeStyle=theme.frameEdge;ctx.lineWidth=2;ctx.strokeRect(7,7,canvas.width-14,canvas.height-14);
}function drawWizard(t){
  const bob=Math.sin((frame+t.c*10+t.r*7)/12)*1.5;
  const x=t.x, y=t.y+bob;
  const skin='#d9a877', col=t.color;
  const P={arrow:['#0b2726','#15504d'],cannon:['#361506','#6a2a0c'],frost:['#0b2444','#1a4d80'],sniper:['#1f0e33','#3e1d69']}[t.key]||['#0d1015','#161b22'];
  const robeD=P[0], robeM=P[1];
  ctx.save();
  ctx.translate(x,y);
  if(t===selectedTower){
    ctx.beginPath();ctx.arc(0,0,t.range,0,7);
    ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(0,15,15,0,7);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  }
  if(t.cooldown>t.rate-6){
    ctx.beginPath();ctx.arc(0,0,t.range,0,7);ctx.strokeStyle=col+'33';ctx.lineWidth=1.5;ctx.stroke();
  }
  const runeA=0.12+t.level*0.06;
  ctx.beginPath();ctx.ellipse(0,15,15,5.4,0,0,7);
  ctx.strokeStyle=col+Math.round(runeA*255).toString(16).padStart(2,'0');ctx.lineWidth=1.5;ctx.stroke();
  for(let i=0;i<4;i++){
    const a=frame/40+i*Math.PI/2;
    ctx.beginPath();ctx.arc(Math.cos(a)*15,15+Math.sin(a)*5.4,1.3,0,7);
    ctx.fillStyle=col;ctx.shadowColor=col;ctx.shadowBlur=5;ctx.fill();
  }
  ctx.shadowBlur=0;
  if(t.level>=4){
    const auraR=24+Math.sin(frame/10)*3;
    const grad=ctx.createRadialGradient(0,0,4,0,0,auraR);
    grad.addColorStop(0,col+'55');grad.addColorStop(1,col+'00');
    ctx.beginPath();ctx.arc(0,0,auraR,0,7);ctx.fillStyle=grad;ctx.fill();
  }
  ctx.beginPath();ctx.ellipse(0,16,12,4,0,0,7);ctx.fillStyle='rgba(0,0,0,.4)';ctx.fill();
  ctx.beginPath();ctx.ellipse(0,15,13,4.5,0,0,7);ctx.fillStyle='#1c2128';ctx.fill();
  ctx.beginPath();ctx.ellipse(0,14,13,4.5,0,0,7);ctx.fillStyle='#2b313a';ctx.fill();
  ctx.strokeStyle=col+'66';ctx.lineWidth=1;ctx.stroke();
  if(t.level>=2){
    const flap=Math.sin(frame/14)*3;
    [-1,1].forEach(sd=>{
      ctx.beginPath();ctx.moveTo(sd*8,-5);ctx.lineTo(sd*16+sd*flap*sd,17);ctx.lineTo(sd*2,15);ctx.closePath();
      ctx.fillStyle=robeD;ctx.fill();ctx.strokeStyle=col+'66';ctx.lineWidth=1;ctx.stroke();
    });
  }
  const rg=ctx.createLinearGradient(0,-7,0,16);rg.addColorStop(0,robeM);rg.addColorStop(1,robeD);
  ctx.beginPath();ctx.moveTo(-4,-7);ctx.quadraticCurveTo(-6,4,-12,16);ctx.lineTo(12,16);ctx.quadraticCurveTo(6,4,4,-7);ctx.closePath();
  ctx.fillStyle=rg;ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.stroke();
  ctx.strokeStyle=col;ctx.lineWidth=1.8;ctx.shadowColor=col;ctx.shadowBlur=6;
  ctx.beginPath();ctx.moveTo(-11.5,15.5);ctx.lineTo(11.5,15.5);ctx.stroke();ctx.shadowBlur=0;
  ctx.strokeStyle=col+'88';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,-3);ctx.lineTo(0,15);ctx.stroke();
  ctx.fillStyle='#2a1f14';ctx.fillRect(-6,4,12,2.6);
  ctx.beginPath();ctx.arc(0,5.3,1.8,0,7);ctx.fillStyle=col;ctx.fill();
  ctx.beginPath();ctx.ellipse(0,-5,8.5,3.6,0,0,7);ctx.fillStyle=robeM;ctx.fill();
  ctx.strokeStyle=col+'aa';ctx.lineWidth=1;ctx.stroke();

  const casting=t.cast>0;
  const raise=casting?Math.sin((14-t.cast)/14*Math.PI):0;
  const staffBaseX=12, staffBaseY=14;
  const staffTipX=15+raise*4, staffTipY=-14-raise*10;
  ctx.beginPath();
  ctx.moveTo(6,-3);ctx.lineTo(staffBaseX*0.7+staffTipX*0.3,-2-raise*8);
  ctx.strokeStyle=robeM;ctx.lineWidth=5;ctx.lineCap='round';ctx.stroke();
  ctx.beginPath();ctx.arc(0,-9.5,6,0,7);ctx.fillStyle=skin;ctx.fill();
  ctx.fillStyle=col;ctx.shadowColor=col;ctx.shadowBlur=6;
  ctx.beginPath();ctx.ellipse(-2,-9.5,1.1,.75,0,0,7);ctx.fill();
  ctx.beginPath();ctx.ellipse(2,-9.5,1.1,.75,0,0,7);ctx.fill();
  ctx.shadowBlur=0;
  const bl=t.key==='frost'?7:(t.key==='cannon'?3:2);
  ctx.beginPath();ctx.moveTo(-5,-8);ctx.quadraticCurveTo(0,bl,5,-8);ctx.quadraticCurveTo(0,-5,-5,-8);
  ctx.fillStyle=t.key==='cannon'?'#d9822b':'#dfe3e8';ctx.fill();
  const tipX=4+raise*2, tipY=-33-raise*2;
  ctx.beginPath();ctx.moveTo(-8,-13);ctx.quadraticCurveTo(-5,-25,tipX,tipY);ctx.quadraticCurveTo(4,-22,8,-13);ctx.closePath();
  ctx.fillStyle=robeM;ctx.fill();ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.stroke();
  ctx.beginPath();ctx.ellipse(0,-13,11,3,0,0,7);ctx.fillStyle=robeD;ctx.fill();
  ctx.strokeStyle=col+'aa';ctx.lineWidth=1;ctx.stroke();
  ctx.strokeStyle=col;ctx.lineWidth=1.6;
  ctx.beginPath();ctx.moveTo(-7,-15);ctx.lineTo(7,-15);ctx.stroke();
  ctx.beginPath();ctx.arc(0,-15,1.8,0,7);ctx.fillStyle='#fff';ctx.shadowColor=col;ctx.shadowBlur=6;ctx.fill();ctx.shadowBlur=0;
  if(t.level>=4){
    ctx.beginPath();ctx.arc(tipX,tipY,3,0,7);ctx.fillStyle='#fff';ctx.shadowColor=col;ctx.shadowBlur=14;ctx.fill();ctx.shadowBlur=0;
  }
  ctx.beginPath();ctx.moveTo(staffBaseX,staffBaseY);ctx.lineTo(staffTipX,staffTipY);
  ctx.strokeStyle='#3a2a18';ctx.lineWidth=2.6;ctx.lineCap='round';ctx.stroke();
  ctx.beginPath();ctx.arc(staffBaseX*0.55+staffTipX*0.45,staffBaseY*0.55+staffTipY*0.45,3,0,7);
  ctx.fillStyle=skin;ctx.fill();
  const ready=t.cooldown<=0 && !casting;
  const pulse=3+Math.sin(frame/8)*1;
  const orbR=casting?5+raise*4:(ready?pulse+2:3);
  ctx.beginPath();ctx.arc(staffTipX,staffTipY,orbR,0,7);
  ctx.fillStyle=casting?'#fff':col;
  ctx.shadowColor=col;ctx.shadowBlur=casting?20:(ready?14:5);ctx.fill();ctx.shadowBlur=0;
  if(t.key==='cannon'){
    const f=Math.sin(frame/3)*1.5;
    ctx.beginPath();ctx.moveTo(staffTipX-3,staffTipY-orbR*0.5);
    ctx.quadraticCurveTo(staffTipX-1,staffTipY-orbR-4-f,staffTipX,staffTipY-orbR-8-f);
    ctx.quadraticCurveTo(staffTipX+1,staffTipY-orbR-4,staffTipX+3,staffTipY-orbR*0.5);
    ctx.fillStyle='#ffb347';ctx.fill();
  }else if(t.key==='frost'){
    ctx.strokeStyle='#eaf7ff';ctx.lineWidth=1.4;
    for(let k=0;k<4;k++){
      const a=k*Math.PI/2+frame/60;
      ctx.beginPath();ctx.moveTo(staffTipX+Math.cos(a)*(orbR+1),staffTipY+Math.sin(a)*(orbR+1));
      ctx.lineTo(staffTipX+Math.cos(a)*(orbR+5),staffTipY+Math.sin(a)*(orbR+5));ctx.stroke();
    }
  }else if(t.key==='sniper'){
    ctx.strokeStyle=col;ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(staffTipX,staffTipY,orbR+3.5,0,7);ctx.stroke();
    ctx.beginPath();ctx.moveTo(staffTipX-orbR-7,staffTipY);ctx.lineTo(staffTipX+orbR+7,staffTipY);
    ctx.moveTo(staffTipX,staffTipY-orbR-7);ctx.lineTo(staffTipX,staffTipY+orbR+7);ctx.stroke();
  }else{
    for(let k=0;k<3;k++){
      const a=frame/10+k*2.09;
      ctx.beginPath();ctx.arc(staffTipX+Math.cos(a)*(orbR+5),staffTipY+Math.sin(a)*(orbR+5),1.4,0,7);
      ctx.fillStyle=col;ctx.shadowColor=col;ctx.shadowBlur=6;ctx.fill();
    }
    ctx.shadowBlur=0;
  }
  if(casting){
    ctx.beginPath();ctx.arc(staffTipX,staffTipY,orbR*0.5,0,7);ctx.fillStyle=col;ctx.fill();
    const chargeA=Math.max(0,raise-0.3)/0.7;
    if(chargeA>0){
      ctx.beginPath();ctx.arc(staffTipX,staffTipY,4+chargeA*11,0,7);
      ctx.strokeStyle=col+Math.round((1-chargeA)*170+30).toString(16).padStart(2,'0');ctx.lineWidth=1.4;ctx.stroke();
    }
    if(Math.random()<0.5){
      const sa=Math.random()*Math.PI*2, sr=orbR+2+Math.random()*3;
      particles.push({x:x+staffTipX+Math.cos(sa)*sr,y:y+staffTipY+Math.sin(sa)*sr,vx:Math.cos(sa)*0.3,vy:Math.sin(sa)*0.3-0.2,life:14,maxLife:14,color:col});
    }
  }
  if(t.level>=3){
    for(let i=0;i<2;i++){
      const ang=frame/20+i*Math.PI;
      ctx.beginPath();ctx.arc(Math.cos(ang)*17,-10+Math.sin(ang)*7,2,0,7);
      ctx.fillStyle=col;ctx.shadowColor=col;ctx.shadowBlur=8;ctx.fill();
    }
    ctx.shadowBlur=0;
  }
  for(let i=0;i<t.level-1;i++){
    const sx=-6+i*6, sy=-38-raise*2;
    ctx.beginPath();
    for(let k=0;k<10;k++){
      const ang=-Math.PI/2+k*(Math.PI/5), rr=k%2?1.3:2.8;
      ctx.lineTo(sx+Math.cos(ang)*rr,sy+Math.sin(ang)*rr);
    }
    ctx.closePath();ctx.fillStyle='#ffd700';ctx.shadowColor='#ffd700';ctx.shadowBlur=6;ctx.fill();ctx.shadowBlur=0;
  }
  ctx.restore();
}

function drawMapExtras(){
  const th=maps[currentMapKey].theme, W=canvas.width, H=canvas.height, ice=th==='ice';
  [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy],di)=>{
    pathCells.forEach(([c,r])=>{
      if(isPath(c+dx,r+dy)) return;
      for(let k=0;k<2;k++){
        const h=hash(c*7+di*3+k,r*5+di);
        const px=c*CELL+CELL/2+dx*CELL*0.41+(dy?(h-0.5)*CELL*0.8:0);
        const py=r*CELL+CELL/2+dy*CELL*0.41+(dx?(h-0.5)*CELL*0.8:0);
        ctx.beginPath();ctx.ellipse(px,py,2.6+h*1.6,2+h,0,0,7);
        ctx.fillStyle=ice?'rgba(235,248,255,.9)':(h>0.5?'#7d7466':'#665e52');ctx.fill();
        ctx.beginPath();ctx.ellipse(px-.7,py-.7,1.2,.8,0,0,7);
        ctx.fillStyle=ice?'rgba(160,210,240,.7)':'rgba(255,255,255,.18)';ctx.fill();
      }
    });
  });
  for(let c=0;c<COLS;c++)for(let r=0;r<ROWS;r++){
    if(isPath(c,r)||towers.some(t=>t.c===c&&t.r===r)) continue;
    const h=hash(c*23,r*29);
    if(h<0.72||h>0.86) continue;
    const x=c*CELL+8+hash(c,r*3)*24, y=r*CELL+10+hash(c*3,r)*22;
    if(ice){
      ctx.beginPath();ctx.ellipse(x,y,9,4.5,0,0,7);ctx.fillStyle='rgba(150,210,245,.35)';ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=1;ctx.stroke();
      ctx.beginPath();ctx.arc(x-2,y-1,3,Math.PI*1.1,Math.PI*1.7);ctx.strokeStyle='rgba(255,255,255,.7)';ctx.stroke();
    }else{
      const sw=Math.sin(frame/25+c+r)*1.2, cols=['#ff7eb6','#ffd166','#9ad0ff','#ffffff'];
      ctx.strokeStyle='#2f7a3f';ctx.lineWidth=1.2;
      ctx.beginPath();ctx.moveTo(x,y+6);ctx.lineTo(x+sw,y);ctx.stroke();
      ctx.fillStyle=cols[Math.floor(h*100)%4];
      for(let k=0;k<4;k++){ctx.beginPath();ctx.arc(x+sw+Math.cos(k*1.57)*2,y+Math.sin(k*1.57)*2,1.6,0,7);ctx.fill();}
      ctx.beginPath();ctx.arc(x+sw,y,1.2,0,7);ctx.fillStyle='#fff3b0';ctx.fill();
    }
  }
  if(ice){
    for(let x=0;x<W;x+=16){
      const a=Math.max(0,Math.sin(x/70+frame/70))*0.09+0.02;
      const g=ctx.createLinearGradient(0,0,0,110);
      g.addColorStop(0,'rgba(127,255,212,'+a+')');g.addColorStop(1,'rgba(160,110,255,0)');
      ctx.fillStyle=g;ctx.fillRect(x,0,16,90+Math.sin(x/50+frame/60)*20);
    }
    ctx.fillStyle='#fff';
    for(let i=0;i<45;i++){
      const sx=(hash(i,2)*W+Math.sin(frame/40+i)*14+W)%W;
      const sy=(hash(i,3)*H+frame*(0.4+hash(i,4)*0.7))%H;
      ctx.globalAlpha=0.35+hash(i,5)*0.5;
      ctx.beginPath();ctx.arc(sx,sy,1+hash(i,6)*1.4,0,7);ctx.fill();
    }
    ctx.globalAlpha=1;
  }else{
    ctx.save();ctx.globalAlpha=0.05+Math.sin(frame/90)*0.02;ctx.fillStyle='#fff6c8';
    [[80,0],[260,0],[470,0]].forEach(([rx])=>{
      ctx.beginPath();ctx.moveTo(rx,0);ctx.lineTo(rx+50,0);ctx.lineTo(rx+190,H);ctx.lineTo(rx+110,H);ctx.closePath();ctx.fill();
    });
    ctx.restore();
    for(let i=0;i<14;i++){
      const fx=(hash(i,7)*W+Math.sin(frame/60+i)*22+W)%W;
      const fy=(hash(i,8)*H+Math.cos(frame/70+i*2)*16+H)%H;
      ctx.globalAlpha=0.5+0.5*Math.sin(frame/18+i);
      ctx.beginPath();ctx.arc(fx,fy,1.6,0,7);
      ctx.fillStyle='#e8ff8a';ctx.shadowColor='#d8ff5a';ctx.shadowBlur=9;ctx.fill();
    }
    ctx.shadowBlur=0;ctx.globalAlpha=1;
  }
}

function endGame(won){
  stopMusic();
  gameOver=true; running=false;
  document.getElementById('overTitle').textContent=won?'🎉 Você venceu!':'💀 Fim de jogo';
  document.getElementById('overSub').textContent='Você chegou até a onda '+wave+' de '+WIN_WAVE+'.';
  document.getElementById('overlay').classList.remove('hidden');
  won?sfx.win():sfx.lose();
}
document.getElementById('restartBtn').onclick=()=>location.reload();

function loop(){
  if(!gameOver){update();draw();}
  requestAnimationFrame(loop);
}
let startPickedMap='forest';
document.querySelectorAll('.mapCard').forEach(c=>c.onclick=()=>{
  document.querySelectorAll('.mapCard').forEach(x=>x.classList.remove('sel'));
  c.classList.add('sel');startPickedMap=c.dataset.map;
});
document.querySelectorAll('#startBtn,.playBtn').forEach(b=>b.onclick=()=>{
  applyMap(startPickedMap);
  document.getElementById('startScreen').classList.add('hidden');
  ensureAudio();
  startMusic();
  sfx.click();
});
(function spawnStartParticles(){
  const host=document.getElementById('startParticles');
  const icons=['✨','❄️','🍃','⭐'];
  for(let i=0;i<16;i++){
    const s=document.createElement('span');
    s.textContent=icons[i%icons.length];
    s.style.left=Math.random()*100+'%';
    s.style.setProperty('--drift',(Math.random()*60-30)+'px');
    s.style.animationDuration=(6+Math.random()*6)+'s';
    s.style.animationDelay=(Math.random()*6)+'s';
    s.style.fontSize=(0.8+Math.random()*0.8)+'rem';
    host.appendChild(s);
  }
})();

applyMap('forest');
draw();
loop();