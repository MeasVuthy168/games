// ui.js — Khmer Chess (Play page)
// Uses: game.js (export { Game, SIZE, COLORS })

import { Game, SIZE, COLORS } from './game.js';

const LS_KEY   = 'kc_settings_v1';
const SAVE_KEY = 'kc_game_state_v2';

// reasonable defaults if settings not found
const DEFAULTS = { minutes: 10, increment: 5, sound: true, hints: true };

/* ------------------------------ storage ------------------------------ */
function saveGameState(game, clocks){
  const s = {
    board: game.board,
    turn: game.turn,
    history: game.history,
    msW: clocks.msW,
    msB: clocks.msB,
    clockTurn: clocks.turn
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {}
}
function loadGameState(){
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function clearGameState(){ try { localStorage.removeItem(SAVE_KEY); } catch {} }

function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
  }catch{
    return { ...DEFAULTS };
  }
}

/* ------------------------------ audio beeper (file-based) ------------------------------ */
class AudioBeeper{
  constructor(){
    this.enabled = true;
    this.bank = {
      move:    new Audio('assets/sfx/move.mp3'),
      capture: new Audio('assets/sfx/capture.mp3'),
      select:  new Audio('assets/sfx/select.mp3'),
      error:   new Audio('assets/sfx/error.mp3'),
      check:   new Audio('assets/sfx/check.mp3'),
    };
    for (const k in this.bank) {
      this.bank[k].preload = 'auto';
    }
  }
  play(name, vol=1){
    if(!this.enabled) return;
    const src = this.bank[name]; if(!src) return;
    const a = src.cloneNode(true);
    a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(()=>{ /* autoplay guard ignored until first tap */ });
  }
  move(){this.play('move', .9);}
  capture(){this.play('capture', 1);}
  select(){this.play('select', .85);}
  error(){this.play('error', .9);}
  check(){this.play('check', 1);}
}
const beeper = new AudioBeeper();

/* ------------------------------ haptics ------------------------------ */
function vibrate(x){
  // accepts number or pattern
  if (navigator.vibrate) navigator.vibrate(x);
}

/* ------------------------------ clocks ------------------------------ */
class Clocks{
  constructor(update){
    this.msW=0; this.msB=0; this.running=false; this.turn=COLORS.WHITE;
    this.increment=0; this._t=null; this._u=update;
  }
  init(min, inc, turn=COLORS.WHITE){
    this.msW=min*60*1000; this.msB=min*60*1000; this.increment=inc*1000; this.turn=turn;
    this.stop(); this._u(this.msW,this.msB);
  }
  start(){
    if(this.running) return; this.running=true; let last=performance.now();
    const tick=()=>{
      if(!this.running) return;
      const now=performance.now(), dt=now-last; last=now;
      if(this.turn===COLORS.WHITE) this.msW=Math.max(0,this.msW-dt); else this.msB=Math.max(0,this.msB-dt);
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
    this.turn=(prev===COLORS.WHITE)?COLORS.BLACK:COLORS.WHITE; this._u(this.msW,this.msB); this.start();
  }
  format(ms){
    const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), t=Math.floor((ms%1000)/100);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`;
  }
}

/* ------------------------------ UI init ------------------------------ */
export function initUI(){
  const elBoard  = document.getElementById('board');

  // Top status + controls
  const elTurn     = document.getElementById('turnLabel');
  const btnReset   = document.getElementById('btnReset');
  const btnUndo    = document.getElementById('btnUndo');
  const btnPause   = document.getElementById('btnPause');
  const pauseIcon  = document.getElementById('pauseIcon');
  const pauseLabel = document.getElementById('pauseLabel');

  // Clocks
  const clockW   = document.getElementById('clockW');
  const clockB   = document.getElementById('clockB');

  const KH = {
    white: 'ស',
    black: 'ខ្មៅ',
    check: 'ឆក់រាជា',
    checkmate: 'ម៉ាត់',
    stalemate: 'គប់ស្ដាំ (Stalemate)',
  };

  const game = new Game();
  let settings = loadSettings();
  beeper.enabled = !!settings.sound;

  const clocks = new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // build board cells
  elBoard.innerHTML = '';
  const cells=[];
  for(let y=0;y<SIZE;y++){
    for(let x=0;x<SIZE;x++){
      const cell=document.createElement('div');
      cell.className='cell '+((x+y)%2?'dark':'light');
      cell.dataset.x=x; cell.dataset.y=y; cell.dataset.ax=(String.fromCharCode(97+x)+(8-y));
      elBoard.appendChild(cell); cells.push(cell);
    }
  }

  const setPieceBG=(span,p)=>{
    const map={K:'king',Q:'queen',B:'bishop',R:'rook',N:'knight',P:'pawn'};
    const name=`${p.c==='w'?'w':'b'}-${map[p.t]}`;
    span.style.backgroundImage=`url(./assets/pieces/${name}.png)`;
  };

  function khTurnLabel(){
    const side = game.turn===COLORS.WHITE ? KH.white : KH.black;
    const st = game.status();
    if(st.state==='checkmate'){
      const winner = side==='ស' ? 'ខ្មៅ' : 'ស';
      return `វេនខាង (${side}) · ${KH.checkmate} · ${winner} ឈ្នះ`;
    }
    if(st.state==='stalemate') return `${KH.stalemate}`;
    if(st.state==='check')     return `វេនខាង (${side}) · ${KH.check}`;
    return `វេនខាង (${side})`;
  }

  function render(){
    // clear
    for(const c of cells){
      c.innerHTML='';
      c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture');
    }
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
    // update status banner
    if (elTurn) elTurn.textContent = khTurnLabel();
  }

  let selected=null, legal=[];
  const clearHints=()=>{ for(const c of cells) c.classList.remove('selected','hint-move','hint-capture'); };
  const hintsEnabled = () => settings.hints !== false;

  function showHints(x,y){
    clearHints(); const cell=cells[y*SIZE+x]; cell.classList.add('selected');
    legal=game.legalMoves(x,y); if(!hintsEnabled()) return;
    for(const m of legal){
      const t=game.at(m.x,m.y), c=cells[m.y*SIZE+m.x];
      if(t) c.classList.add('hint-capture'); else c.classList.add('hint-move');
    }
  }

  function onCellTap(e){
    const x=+e.currentTarget.dataset.x, y=+e.currentTarget.dataset.y, p=game.at(x,y);
    if(p && p.c===game.turn){
      selected={x,y}; showHints(x,y);
      if(beeper.enabled) beeper.select();
      return;
    }
    if(!selected){
      if(beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    const ok=legal.some(m=>m.x===x&&m.y===y);
    if(!ok){
      selected=null; legal=[]; clearHints();
      if(beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    const from={...selected}, to={x,y}, before=game.at(to.x,to.y), prevTurn=game.turn;
    const res=game.move(from,to);

    if(res.ok){
      if(beeper.enabled){
        if(before){ beeper.capture(); vibrate([20,40,30]); }
        else beeper.move();
      }
      if(res.status?.state==='check' && beeper.enabled){ beeper.check(); vibrate(30); }

      clocks.switchedByMove(prevTurn);
      selected=null; legal=[]; clearHints(); render();
      saveGameState(game,clocks);

      if(res.status?.state==='checkmate'){
        setTimeout(()=> alert('ម៉ាត់! ល្បែងបានបញ្ចប់'), 50);
      }else if(res.status?.state==='stalemate'){
        setTimeout(()=> alert('គប់ស្ដាំ (Stalemate) — ល្បែងស្មើ!'), 50);
      }
    }
  }
  for(const c of cells) c.addEventListener('click', onCellTap, {passive:true});

  // resume previous game silently if present; otherwise fresh
  const saved=loadGameState();
  if(saved){
    game.board=saved.board; game.turn=saved.turn; game.history=saved.history||[];
    clocks.msW=saved.msW??clocks.msW; clocks.msB=saved.msB??clocks.msB; clocks.turn=saved.clockTurn??game.turn;
    clockW.textContent=clocks.format(clocks.msW); clockB.textContent=clocks.format(clocks.msB);
    render(); clocks.start();
  } else {
    render(); clocks.start();
  }

  // ensure pause button starts as "pause" (game running)
  if (pauseIcon && pauseLabel) {
    pauseIcon.src = 'assets/ui/pause.png';
    pauseLabel.textContent = 'ផ្អាក';
    btnPause?.setAttribute('aria-pressed','false');
  }

  /* ---------------------------- controls ---------------------------- */
  btnReset?.addEventListener('click', ()=>{
    game.reset(); selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();

    // reset pause button to "pause" icon/label
    if (pauseIcon && pauseLabel) {
      pauseIcon.src = 'assets/ui/pause.png';
      pauseLabel.textContent = 'ផ្អាក';
      btnPause?.setAttribute('aria-pressed','false');
    }
  });

  btnUndo?.addEventListener('click', ()=>{
    if(game.undo()){
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
    }
  });

  // PNG-based pause/play toggle (no emoji)
  btnPause?.addEventListener('click', ()=>{
    clocks.pauseResume();
    const running = clocks.running;
    if (running) {
      pauseIcon.src = 'assets/ui/pause.png';
      pauseLabel.textContent = 'ផ្អាក';
      btnPause.setAttribute('aria-pressed','false');
    } else {
      pauseIcon.src = 'assets/ui/play.png';
      pauseLabel.textContent = 'ចាប់ផ្ដើម';
      btnPause.setAttribute('aria-pressed','true');
    }
  });

  // persist on unload
  window.addEventListener('beforeunload', ()=> saveGameState(game,clocks));
}

// auto-init is handled by main.js (which calls initUI)
