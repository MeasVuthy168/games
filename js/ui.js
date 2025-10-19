import { Game, SIZE, COLORS } from './game.js';

const LS_KEY='kc_settings_v1', SAVE_KEY='kc_game_state_v1';
const DEFAULTS={minutes:10, increment:5, sound:true};

function saveGameState(game,clocks){
  const s={board:game.board, turn:game.turn, history:game.history, msW:clocks.msW, msB:clocks.msB, clockTurn:clocks.turn};
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}
function loadGameState(){ try{return JSON.parse(localStorage.getItem(SAVE_KEY));}catch{return null;} }
function clearGameState(){ localStorage.removeItem(SAVE_KEY); }

function loadSettings(){ try{const s=JSON.parse(localStorage.getItem(LS_KEY)||'null'); return s?{...DEFAULTS,...s}:{...DEFAULTS};}catch{return {...DEFAULTS};} }
function saveSettings(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }

class Beeper{
  constructor(){this.enabled=true; this.ctx=null;}
  ensure(){ if(!this.ctx) this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }
  tone(freq=600,ms=120,type='sine',gain=0.08){ if(!this.enabled) return; this.ensure();
    const t0=this.ctx.currentTime, osc=this.ctx.createOscillator(), g=this.ctx.createGain();
    osc.type=type; osc.frequency.value=freq; g.gain.value=gain; osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0+ms/1000);
  }
  move(){this.tone(660,90,'square',0.06);} capture(){this.tone(420,140,'sawtooth',0.07);}
  select(){this.tone(880,70,'sine',0.05);} error(){this.tone(200,180,'triangle',0.07);}
}
const beeper=new Beeper();

class Clocks{
  constructor(update){ this.msW=0; this.msB=0; this.running=false; this.turn=COLORS.WHITE; this.increment=0; this._t=null; this._u=update; }
  init(min,inc,turn=COLORS.WHITE){ this.msW=min*60*1000; this.msB=min*60*1000; this.increment=inc*1000; this.turn=turn; this.stop(); this._u(this.msW,this.msB); }
  start(){ if(this.running) return; this.running=true; let last=performance.now();
    const tick=()=>{ if(!this.running) return; const now=performance.now(), dt=now-last; last=now;
      if(this.turn===COLORS.WHITE) this.msW=Math.max(0,this.msW-dt); else this.msB=Math.max(0,this.msB-dt);
      this._u(this.msW,this.msB); if(this.msW<=0||this.msB<=0){ this.stop(); return; } this._t=requestAnimationFrame(tick); };
    this._t=requestAnimationFrame(tick);
  }
  stop(){ this.running=false; if(this._t) cancelAnimationFrame(this._t); this._t=null; }
  pauseResume(){ this.running?this.stop():this.start(); }
  switchedByMove(prev){ if(prev===COLORS.WHITE) this.msW+=this.increment; else this.msB+=this.increment;
    this.turn=(prev===COLORS.WHITE)?COLORS.BLACK:COLORS.WHITE; this._u(this.msW,this.msB); this.start(); }
  format(ms){ const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), t=Math.floor((ms%1000)/100); return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`; }
}

export function initUI(){
  const app=document.getElementById('app');
  const elBoard=document.getElementById('board');
  const elMoves=document.getElementById('moveList');
  const elTurn=document.getElementById('turnLabel');
  const elReset=document.getElementById('btnReset');
  const elUndo=document.getElementById('btnUndo');
  const optHints=document.getElementById('optShowHints');
  const optSound=document.getElementById('optSound');
  const btnPause=document.getElementById('btnPause');
  const btnSettings=document.getElementById('btnSettings');
  const btnFullscreen=document.getElementById('btnFullscreen');
  const clockW=document.getElementById('clockW');
  const clockB=document.getElementById('clockB');

  const modal=document.getElementById('settingsModal');
  const setMinutes=document.getElementById('setMinutes');
  const setIncrement=document.getElementById('setIncrement');
  const setSound=document.getElementById('setSound');
  const btnApply=document.getElementById('btnApply');
  const btnDefaults=document.getElementById('btnDefaults');
  const btnTestSound=document.getElementById('btnTestSound');

  const game=new Game();
  let settings=loadSettings();
  optSound.checked=settings.sound; beeper.enabled=settings.sound;

  const clocks=new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  const cells=[];
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
    const cell=document.createElement('div');
    cell.className='cell '+((x+y)%2?'dark':'light');
    cell.dataset.x=x; cell.dataset.y=y; cell.dataset.ax=(String.fromCharCode(97+x)+(8-y));
    elBoard.appendChild(cell); cells.push(cell);
  }

  function setPieceBG(span,p){
    const map={K:'king',Q:'queen',B:'bishop',R:'rook',N:'knight',P:'pawn'};
    const name=`${p.c==='w'?'w':'b'}-${map[p.t]}`;
    span.style.backgroundImage=`url(./assets/pieces/${name}.png)`;
  }

  function render(){
    for(const c of cells){ c.innerHTML=''; c.classList.remove('selected','hint-move','hint-capture'); }
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
      const p=game.at(x,y); if(!p) continue;
      const cell=cells[y*SIZE+x]; const span=document.createElement('div');
      span.className=`piece ${p.c==='w'?'white':'black'}`; setPieceBG(span,p); cell.appendChild(span);
    }
    elTurn.textContent=game.turn===COLORS.WHITE?'ស - White to move':'ខ - Black to move';
  }

  let selected=null, legal=[];
  const clearHints=()=>{ for(const c of cells) c.classList.remove('selected','hint-move','hint-capture'); };
  function showHints(x,y){
    clearHints(); const cell=cells[y*SIZE+x]; cell.classList.add('selected');
    legal=game.legalMoves(x,y); if(!optHints.checked) return;
    for(const m of legal){ const t=game.at(m.x,m.y), c=cells[m.y*SIZE+m.x]; if(t) c.classList.add('hint-capture'); else c.classList.add('hint-move'); }
  }

  function onCellTap(e){
    const x=+e.currentTarget.dataset.x, y=+e.currentTarget.dataset.y, p=game.at(x,y);
    if(p && p.c===game.turn){ selected={x,y}; showHints(x,y); if(beeper.enabled) beeper.select(); return; }
    if(!selected) return;
    const ok=legal.some(m=>m.x===x&&m.y===y); if(!ok){ selected=null; legal=[]; clearHints(); if(beeper.enabled) beeper.error(); return; }
    const from={...selected}, to={x,y}, before=game.at(to.x,to.y), prevTurn=game.turn;
    const res=game.move(from,to);
    if(res.ok){
      const idx=Math.ceil(game.history.length/2);
      const moveText=`${String.fromCharCode(97+from.x)}${8-from.y}→${String.fromCharCode(97+to.x)}${8-to.y}`+(before?' ×':'')+(res.promo?' =Q':'');
      if(game.turn===COLORS.BLACK){ const li=document.createElement('li'); li.textContent=`${idx}. ${moveText}`; elMoves.appendChild(li); }
      else { const last=elMoves.lastElementChild; if(last) last.textContent=`${last.textContent} | ${moveText}`; else { const li=document.createElement('li'); li.textContent=`${idx}. ... ${moveText}`; elMoves.appendChild(li);} }
      elMoves.parentElement.scrollTop=elMoves.parentElement.scrollHeight;
      if(beeper.enabled) (before?beeper.capture():beeper.move());
      clocks.switchedByMove(prevTurn);
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
    }
  }
  for(const c of cells) c.addEventListener('click', onCellTap, {passive:true});

  elReset.addEventListener('click', ()=>{ game.reset(); elMoves.innerHTML=''; selected=null; legal=[]; clearHints(); clearGameState();
    clocks.init(settings.minutes, settings.increment, COLORS.WHITE); render(); clocks.start(); });

  elUndo.addEventListener('click', ()=>{ if(game.undo()){
    if(elMoves.lastElementChild){ const hasPipe=elMoves.lastElementChild.textContent.includes('|');
      if(hasPipe){ const t=elMoves.lastElementChild.textContent.split('|')[0].trim(); elMoves.lastElementChild.textContent=t; }
      else elMoves.removeChild(elMoves.lastElementChild);
    }
    selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
  }});

  // Resume saved game
  const saved=loadGameState();
  if(saved && confirm("មានការបន្តពីល្បែងចាស់។ បន្តទេ?")){ game.board=saved.board; game.turn=saved.turn; game.history=saved.history;
    clocks.msW=saved.msW; clocks.msB=saved.msB; clocks.turn=saved.clockTurn; render(); clocks.start(); }
  else { if(saved===null) {} else clearGameState(); clocks.start(); }

  // Pause/Resume
  btnPause.addEventListener('click', ()=>{ clocks.pauseResume(); btnPause.textContent=clocks.running?'⏸️':'▶️'; });

  // Sound toggle
  optSound.addEventListener('change', ()=>{ beeper.enabled=optSound.checked; settings.sound=beeper.enabled; saveSettings(settings); });

  // Settings modal
  const openModal=()=>{ setMinutes.value=settings.minutes; setIncrement.value=settings.increment; setSound.checked=!!settings.sound; modal.classList.add('show'); };
  const closeModal=()=>{ modal.classList.remove('show'); };
  btnSettings.addEventListener('click', openModal);
  modal.querySelectorAll('[data-close]').forEach(el=> el.addEventListener('click', closeModal));
  modal.addEventListener('click', (e)=>{ if(e.target.classList.contains('modal-backdrop')) closeModal(); });
  btnDefaults.addEventListener('click', ()=>{ setMinutes.value=10; setIncrement.value=5; setSound.checked=true; });
  btnTestSound.addEventListener('click', ()=>{ const was=beeper.enabled; beeper.enabled=true; beeper.move(); setTimeout(()=>beeper.capture(),160); setTimeout(()=>beeper.select(),330); beeper.enabled=was; });
  btnApply.addEventListener('click', ()=>{
    settings={ minutes:Math.max(1,Math.min(180,parseInt(setMinutes.value||'10',10))),
               increment:Math.max(0,Math.min(60,parseInt(setIncrement.value||'5',10))),
               sound:!!setSound.checked };
    saveSettings(settings); beeper.enabled=settings.sound; optSound.checked=settings.sound;
    clocks.init(settings.minutes, settings.increment, game.turn); btnPause.textContent='▶️'; closeModal();
  });

  // Fullscreen + soft-rotate + autohide topbar
  const isFS=()=>!!(document.fullscreenElement||document.webkitFullscreenElement);
  async function enterFS(){ try{ if(app.requestFullscreen) await app.requestFullscreen({navigationUI:'hide'}); else if(app.webkitRequestFullscreen) app.webkitRequestFullscreen();
    try{ if(screen.orientation?.lock) await screen.orientation.lock('landscape'); }catch{} }catch{} updateFsLayout(); scheduleHide(); }
  async function exitFS(){ try{ if(document.exitFullscreen) await document.exitFullscreen(); else if(document.webkitExitFullscreen) document.webkitExitFullscreen();
    try{ if(screen.orientation?.unlock) screen.orientation.unlock(); }catch{} }catch{} app.classList.remove('fs-rotate','fs-autohide'); showNow(); }
  const portrait=()=> window.innerHeight>window.innerWidth;
  function updateFsLayout(){ const fs=isFS(); if(fs && portrait()) app.classList.add('fs-rotate'); else app.classList.remove('fs-rotate'); }
  btnFullscreen.addEventListener('click', ()=>{ isFS()?exitFS():enterFS(); });
  document.addEventListener('fullscreenchange', updateFsLayout);
  document.addEventListener('webkitfullscreenchange', updateFsLayout);
  window.addEventListener('resize', updateFsLayout);
  window.addEventListener('orientationchange', updateFsLayout);

  let hideTimer=null; const HIDE_DELAY=2000;
  function scheduleHide(){ if(!isFS()) return; clearTimeout(hideTimer); hideTimer=setTimeout(()=>app.classList.add('fs-autohide'), HIDE_DELAY); }
  function showNow(){ app.classList.remove('fs-autohide'); if(isFS()) scheduleHide(); }
  ['mousemove','mousedown','touchstart','wheel','keydown'].forEach(evt=> window.addEventListener(evt, ()=>{ if(isFS()) showNow(); }, {passive:true}));

  // ===== Ask to save when navigating away from play page =====
  function attachLeaveProtection() {
    const onPlayPage = /play\.html/i.test(location.pathname) || location.pathname.endsWith('/play');
    if (!onPlayPage) return;

    const selectors = ['.home-nav a', '.topbar a', '#btnHome', '.avatar'];
    const links = document.querySelectorAll(selectors.join(','));
    const promptMsg = 'តើអ្នកចង់រក្សាទុក game នេះសម្រាប់លេងពេលក្រោយឬទេ?';

    function confirmAndGo(href){
      const wantSave = confirm(promptMsg);
      if (wantSave) saveGameState(game, clocks);
      location.href = href;
    }

    links.forEach(a=>{
      a.addEventListener('click', (e)=>{
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#')) return;
        e.preventDefault();
        confirmAndGo(href);
      });
    });

    window.addEventListener('beforeunload', (e)=>{
      saveGameState(game, clocks);
      e.preventDefault();
      e.returnValue = '';
    });
  }
  attachLeaveProtection();

  window.addEventListener('beforeunload', ()=> saveGameState(game,clocks));
}
