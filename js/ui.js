// ui.js — Khmer Chess (Play screen, fixed version)
// No fullscreen, no settings modal, no rotation

import { Game, SIZE, COLORS } from './game.js';

const LS_KEY = 'kc_settings_v1';
const SAVE_KEY = 'kc_game_state_v2';
const DEFAULTS = { minutes: 10, increment: 5, sound: true, hints: true };

function saveGameState(game, clocks){
  const s = {
    board: game.board,
    turn: game.turn,
    history: game.history,
    msW: clocks.msW,
    msB: clocks.msB,
    clockTurn: clocks.turn
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(s));
}
function loadGameState(){ try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }
function clearGameState(){ localStorage.removeItem(SAVE_KEY); }

function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
  }catch{
    return { ...DEFAULTS };
  }
}

class Beeper{
  constructor(){ this.enabled=true; this.ctx=null; }
  ensure(){ if(!this.ctx) this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }
  tone(freq=600,ms=120,type='sine',gain=0.08){
    if(!this.enabled) return;
    this.ensure();
    const t0=this.ctx.currentTime;
    const osc=this.ctx.createOscillator(), g=this.ctx.createGain();
    osc.type=type; osc.frequency.value=freq; g.gain.value=gain;
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0+ms/1000);
  }
  move(){this.tone(660,90,'square',0.06);}
  capture(){this.tone(420,140,'sawtooth',0.07);}
  select(){this.tone(880,70,'sine',0.05);}
  error(){this.tone(200,180,'triangle',0.07);}
  check(){this.tone(980,160,'sine',0.06);}
}
const beeper=new Beeper();

class Clocks{
  constructor(update){ this.msW=0; this.msB=0; this.running=false; this.turn=COLORS.WHITE; this.increment=0; this._t=null; this._u=update; }
  init(min,inc,turn=COLORS.WHITE){
    this.msW=min*60*1000; this.msB=min*60*1000; this.increment=inc*1000; this.turn=turn;
    this.stop(); this._u(this.msW,this.msB);
  }
  start(){
    if(this.running) return;
    this.running=true;
    let last=performance.now();
    const tick=()=>{
      if(!this.running) return;
      const now=performance.now(), dt=now-last; last=now;
      if(this.turn===COLORS.WHITE) this.msW=Math.max(0,this.msW-dt);
      else this.msB=Math.max(0,this.msB-dt);
      this._u(this.msW,this.msB);
      if(this.msW<=0||this.msB<=0){ this.stop(); return; }
      this._t=requestAnimationFrame(tick);
    };
    this._t=requestAnimationFrame(tick);
  }
  stop(){ this.running=false; if(this._t) cancelAnimationFrame(this._t); this._t=null; }
  pauseResume(){ this.running?this.stop():this.start(); }
  switchedByMove(prev){
    if(prev===COLORS.WHITE) this.msW+=this.increment; else this.msB+=this.increment;
    this.turn=(prev===COLORS.WHITE)?COLORS.BLACK:COLORS.WHITE;
    this._u(this.msW,this.msB); this.start();
  }
  format(ms){
    const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), t=Math.floor((ms%1000)/100);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`;
  }
}

export function initUI(){
  const app=document.getElementById('app');
  const elBoard=document.getElementById('board');
  const elTurn=document.getElementById('turnLabel');
  const btnReset=document.getElementById('btnReset');
  const btnUndo=document.getElementById('btnUndo');
  const btnPause=document.getElementById('btnPause');
  const clockW=document.getElementById('clockW');
  const clockB=document.getElementById('clockB');

  const KH = {
    resumeQ: 'មានល្បែងមុន។ តើបន្តទេ?',
    askSaveLeave: 'តើអ្នកចង់រក្សាទុក game នេះសម្រាប់លេងពេលក្រោយឬទេ?'
  };

  // Load user settings
  const settings = loadSettings();
  beeper.enabled = !!settings.sound;
  const showHints = settings.hints !== false;

  // Init game + clocks
  const game=new Game();
  const clocks=new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // Build board cells
  const cells=[];
  for(let y=0;y<SIZE;y++){
    for(let x=0;x<SIZE;x++){
      const cell=document.createElement('div');
      cell.className='cell '+((x+y)%2?'dark':'light');
      cell.dataset.x=x; cell.dataset.y=y; cell.dataset.ax=(String.fromCharCode(97+x)+(8-y));
      elBoard.appendChild(cell);
      cells.push(cell);
    }
  }

  const setPieceBG=(span,p)=>{
    const map={K:'king',Q:'queen',B:'bishop',R:'rook',N:'knight',P:'pawn'};
    const name=`${p.c==='w'?'w':'b'}-${map[p.t]}`;
    span.style.backgroundImage=`url(./assets/pieces/${name}.png)`;
  };

  // Khmer turn label
  function khTurnLabel(){
    const side = game.turn===COLORS.WHITE ? 'ស' : 'ខ្មៅ';
    const st = game.status();
    let label = `វេនខាង (${side})`;
    if(st.state==='checkmate'){
      const winner = side==='ស' ? 'ខ្មៅ' : 'ស';
      label = `ម៉ាត់ · ${winner} ឈ្នះ`;
    }else if(st.state==='stalemate'){
      label = 'គប់ស្ដាំ (Stalemate)';
    }else if(st.state==='check'){
      label += ' · ឆក់រាជា';
    }
    return label;
  }

  // Render
  function render(){
    for(const c of cells){ c.innerHTML=''; c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture'); }
    for(let y=0;y<SIZE;y++){
      for(let x=0;x<SIZE;x++){
        const p=game.at(x,y); if(!p) continue;
        const cell=cells[y*SIZE+x];
        const span=document.createElement('div');
        span.className=`piece ${p.c==='w'?'white':'black'}`;
        setPieceBG(span,p);
        cell.appendChild(span);
      }
    }
    const last=game.history[game.history.length-1];
    if(last){
      cells[last.from.y*SIZE+last.from.x].classList.add('last-from');
      const toCell=cells[last.to.y*SIZE+last.to.x];
      toCell.classList.add('last-to');
      if(last.captured) toCell.classList.add('last-capture');
    }
    elTurn.textContent=khTurnLabel();
  }

  let selected=null, legal=[];
  const clearHints=()=>{ for(const c of cells) c.classList.remove('selected','hint-move','hint-capture'); };

  function showHintsFor(x,y){
    clearHints();
    const cell=cells[y*SIZE+x]; cell.classList.add('selected');
    if(!showHints) return;
    legal=game.legalMoves(x,y);
    for(const m of legal){
      const t=game.at(m.x,m.y), c=cells[m.y*SIZE+m.x];
      if(t) c.classList.add('hint-capture'); else c.classList.add('hint-move');
    }
  }

  function onCellTap(e){
    const x=+e.currentTarget.dataset.x, y=+e.currentTarget.dataset.y;
    const p=game.at(x,y);
    if(p && p.c===game.turn){
      selected={x,y}; showHintsFor(x,y);
      if(beeper.enabled) beeper.select();
      return;
    }
    if(!selected) return;

    const ok=legal.some(m=>m.x===x&&m.y===y);
    if(!ok){
      selected=null; legal=[]; clearHints();
      if(beeper.enabled) beeper.error();
      return;
    }

    const from={...selected}, to={x,y}, before=game.at(to.x,to.y), prevTurn=game.turn;
    const res=game.move(from,to);
    if(res.ok){
      if(beeper.enabled){ if(before) beeper.capture(); else beeper.move(); }
      if(res.status?.state==='check' && beeper.enabled){ beeper.check(); }

      clocks.switchedByMove(prevTurn);
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);

      if(res.status?.state==='checkmate'){
        setTimeout(()=>alert('ម៉ាត់! ល្បែងបានបញ្ចប់'),50);
      }else if(res.status?.state==='stalemate'){
        setTimeout(()=>alert('គប់ស្ដាំ (Stalemate) — ល្បែងស្មើ!'),50);
      }
    }
  }

  for(const c of cells) c.addEventListener('click', onCellTap, {passive:true});

  // Start game
  const saved=loadGameState();
  if(saved && confirm(KH.resumeQ)){
    game.board=saved.board; game.turn=saved.turn; game.history=saved.history;
    clocks.msW=saved.msW; clocks.msB=saved.msB; clocks.turn=saved.clockTurn;
    clockW.textContent=clocks.format(clocks.msW);
    clockB.textContent=clocks.format(clocks.msB);
    render(); clocks.start();
  }else{
    if(saved!==null) clearGameState();
    game.reset(); render(); clocks.start();
  }

  // Buttons
  btnReset.addEventListener('click',()=>{
    game.reset(); selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes,settings.increment,COLORS.WHITE);
    render(); clocks.start();
  });

  btnUndo.addEventListener('click',()=>{
    if(game.undo()){ selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks); }
  });

  btnPause.addEventListener('click',()=>{
    clocks.pauseResume();
    btnPause.textContent = clocks.running ? '⏸️' : '▶️';
  });

  // Save on leave
  window.addEventListener('beforeunload', ()=>saveGameState(game,clocks));

  // 🔒 Disable auto rotate or zoom
  window.addEventListener('orientationchange', ()=>{ 
    if(screen.orientation && screen.orientation.lock){
      screen.orientation.lock('portrait').catch(()=>{});
    }
  });
  document.addEventListener('gesturestart', e=>e.preventDefault());
  document.addEventListener('touchmove', e=>{ if(e.scale!==1) e.preventDefault(); }, {passive:false});
}
