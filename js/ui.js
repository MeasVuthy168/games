import { Game, SIZE, COLORS } from './game.js';

const LS_KEY='kc_settings_v1', SAVE_KEY='kc_game_state_v2'; // 🔁 bumped to v2 to avoid old-state conflicts
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
  check(){this.tone(980,160,'sine',0.06);}
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

  const KH = {
    white: 'ស',
    black: 'ខ្មៅ',
    toMove: 'លំដាប់វេន',
    check: 'ឆក់រាជា',
    checkmate: 'ម៉ាត់',
    stalemate: 'គប់ស្ដាំ (Stalemate)',
    resumeQ: 'មានល្បែងមុន។ តើបន្តទេ?',
    askSaveLeave: 'តើអ្នកចង់រក្សាទុក game នេះសម្រាប់លេងពេលក្រោយឬទេ?',
  };

  const game=new Game();
  let settings=loadSettings();
  optSound.checked=settings.sound; beeper.enabled=settings.sound;

  const clocks=new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // Build board cells
  const cells=[];
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
    const cell=document.createElement('div');
    cell.className='cell '+((x+y)%2?'dark':'light');
    cell.dataset.x=x; cell.dataset.y=y; cell.dataset.ax=(String.fromCharCode(97+x)+(8-y));
    elBoard.appendChild(cell); cells.push(cell);
  }

  const setPieceBG=(span,p)=>{
    const map={K:'king',Q:'queen',B:'bishop',R:'rook',N:'knight',P:'pawn'};
    const name=`${p.c==='w'?'w':'b'}-${map[p.t]}`;
    span.style.backgroundImage=`url(./assets/pieces/${name}.png)`;
  };

  function khTurnLabel(){
    const side = game.turn===COLORS.WHITE ? KH.white : KH.black;
    const st = game.status();
    if(st.state==='checkmate') return `${side} ${KH.checkmate} · ${side==='ស'?'ខ្មៅ':'ស'} ឈ្នះ`;
    if(st.state==='stalemate') return `${KH.stalemate}`;
    if(st.state==='check') return `${side} ${KH.toMove} · ${KH.check}`;
    return `${side} ${KH.toMove}`;
  }

  function render(){
    // clear
    for(const c of cells){ c.innerHTML=''; c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture'); }

    // pieces
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
      const p=game.at(x,y); if(!p) continue;
      const cell=cells[y*SIZE+x];
      const span=document.createElement('div');
      span.className=`piece ${p.c==='w'?'white':'black'}`;
      setPieceBG(span,p);
      cell.appendChild(span);
    }

    // last move highlight
    const last = game.history[game.history.length-1];
    if(last){
      cells[last.from.y*SIZE+last.from.x].classList.add('last-from');
      const toCell = cells[last.to.y*SIZE+last.to.x];
      toCell.classList.add('last-to');
      if(last.captured) toCell.classList.add('last-capture');
    }

    // turn label (Khmer-first)
    elTurn.textContent = khTurnLabel();
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

    const ok=legal.some(m=>m.x===x&&m.y===y);
    if(!ok){ selected=null; legal=[]; clearHints(); if(beeper.enabled) beeper.error(); return; }

    const from={...selected}, to={x,y}, before=game.at(to.x,to.y), prevTurn=game.turn;
    const res=game.move(from,to);
    if(res.ok){
      const idx=Math.ceil(game.history.length/2);
      const moveText=`${String.fromCharCode(97+from.x)}${8-from.y}→${String.fromCharCode(97+to.x)}${8-to.y}`+(before?' ×':'')+(res.promo?' =Q':'');
      if(game.turn===COLORS.BLACK){ const li=document.createElement('li'); li.textContent=`${idx}. ${moveText}`; elMoves.appendChild(li); }
      else { const last=elMoves.lastElementChild; if(last) last.textContent=`${last.textContent} | ${moveText}`; else { const li=document.createElement('li'); li.textContent=`${idx}. ... ${moveText}`; elMoves.appendChild(li);} }
      elMoves.parentElement.scrollTop=elMoves.parentElement.scrollHeight;

      if(beeper.enabled){ if(before) beeper.capture(); else beeper.move(); }
      if(res.status?.state==='check' && beeper.enabled){ beeper.check(); }

      clocks.switchedByMove(prevTurn);
      selected=null; legal=[]; clearHints(); render();
      saveGameState(game,clocks);

      // announce end
      if(res.status?.state==='checkmate'){
        setTimeout(()=> alert('ម៉ាត់! ល្បែងបានបញ្ចប់'), 50);
      }else if(res.status?.state==='stalemate'){
        setTimeout(()=> alert('គប់ស្ដាំ (Stalemate) — ល្បែងស្មើ!'), 50);
      }
    }
  }
  for(const c of cells) c.addEventListener('click', onCellTap, {passive:true});

  // Khmer-first labels for buttons already in markup; start game
  const saved=loadGameState();
  if(saved && confirm(KH.resumeQ)){ game.board=saved.board; game.turn=saved.turn; game.history=saved.history;
    const clockWEl=document.getElementById('clockW'); const clockBEl=document.getElementById('clockB');
    clocks.msW=saved.msW; clocks.msB=saved.msB; clocks.turn=saved.clockTurn;
    clockWEl.textContent=clocks.format(clocks.msW); clockBEl.textContent=clocks.format(clocks.msB);
    render(); clocks.start(); }
  else { if(saved!==null) clearGameState(); render(); clocks.start(); }

  // Controls
  document.getElementById('btnReset').addEventListener('click', ()=>{
    game.reset(); elMoves.innerHTML=''; selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
  });

  document.getElementById('btnUndo').addEventListener('click', ()=>{
    if(game.undo()){
      if(elMoves.lastElementChild){
        const hasPipe=elMoves.lastElementChild.textContent.includes('|');
        if(hasPipe){
          const t=elMoves.lastElementChild.textContent.split('|')[0].trim();
          elMoves.lastElementChild.textContent=t;
        }else elMoves.removeChild(elMoves.lastElementChild);
      }
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
    }
  });

  document.getElementById('btnPause').addEventListener('click', ()=>{
    clocks.pauseResume();
    btnPause.textContent=clocks.running?'⏸️':'▶️';
  });

  optSound.addEventListener('change', ()=>{ beeper.enabled=optSound.checked; settings.sound=beeper.enabled; saveSettings(settings); });

  // Settings modal wires
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

  // Fullscreen + rotate + autohide as before
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

  // Ask to save when leaving via bottom nav / links (Khmer prompt)
  function attachLeaveProtection() {
    const onPlayPage = /play\.html/i.test(location.pathname) || location.pathname.endsWith('/play');
    if (!onPlayPage) return;

    const selectors = ['.home-nav a', '.topbar a', '#btnHome', '.avatar'];
    const links = document.querySelectorAll(selectors.join(','));
    const promptMsg = KH.askSaveLeave;

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
      saveGameState(game, clocks); // auto-save
      e.preventDefault();
      e.returnValue = '';
    });
  }
  attachLeaveProtection();

  // persist on unload anyway
  window.addEventListener('beforeunload', ()=> saveGameState(game,clocks));
}
