// ui.js — Khmer Chess (Play page) + AI turn integration (remote-safe)
import { Game, SIZE, COLORS } from './game.js';
import * as AI from './ai.js';
const AIPICK = AI.pickAIMove || AI.chooseAIMove;

const LS_KEY   = 'kc_settings_v1';
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
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {}
}
function loadGameState(){
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function clearGameState(){ try { localStorage.removeItem(SAVE_KEY); } catch {} }

function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    const merged = s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
    if (!('aiEnabled' in merged)) merged.aiEnabled = false;
    if (!('aiLevel'   in merged)) merged.aiLevel   = 'Master';
    if (!('aiColor'   in merged)) merged.aiColor   = 'b';
    return merged;
  }catch{
    return { ...DEFAULTS, aiEnabled:false, aiLevel:'Master', aiColor:'b' };
  }
}

/* ---------------- Audio ---------------- */
class AudioBeeper{
  constructor(){
    this.enabled = true;
    this.bank = {
      move:    new Audio('assets/sfx/move.mp3'),
      capture: new Audio('assets/sfx/capture.mp3'),
      select:  new Audio('assets/sfx/select.mp3'),
      error:   new Audio('assets/sfx/error.mp3'),
      check:   new Audio('assets/sfx/check.mp3'),
      countStart: new Audio('assets/sfx/count-start.mp3'),
      countEnd:   new Audio('assets/sfx/count-end.mp3'),
    };
    for (const k in this.bank) this.bank[k].preload = 'auto';
  }
  play(name, vol=1){
    if(!this.enabled) return;
    const src = this.bank[name]; if(!src) return;
    const a = src.cloneNode(true);
    a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(()=>{});
  }
  move(){this.play('move', .9);} capture(){this.play('capture', 1);}
  select(){this.play('select', .85);} error(){this.play('error', .9);}
  check(){this.play('check', 1);}
}
const beeper = new AudioBeeper();
function vibrate(x){ if (navigator.vibrate) navigator.vibrate(x); }

/* ---------------- Clocks ---------------- */
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
    this.turn=(prev===COLORS.WHITE)?COLORS.BLACK:COLORS.WHITE;
    this._u(this.msW,this.msB); this.start();
  }
  format(ms){
    const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), t=Math.floor((ms%1000)/100);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`;
  }
}

/* ---------------- Main UI ---------------- */
export function initUI(){
  const elBoard  = document.getElementById('board');
  const elTurn   = document.getElementById('turnLabel');
  const btnReset = document.getElementById('btnReset');
  const btnUndo  = document.getElementById('btnUndo');
  const btnPause = document.getElementById('btnPause');
  const clockW   = document.getElementById('clockW');
  const clockB   = document.getElementById('clockB');

  const KH = { white:'ស', black:'ខ្មៅ', check:'អុក', checkmate:'អុកស្លាប់', stalemate:'អាប់' };

  const game = new Game();
  const settings = loadSettings();
  beeper.enabled = !!settings.sound;

  let AILock = false;
  function setBoardBusy(on){
    AILock = !!on;
    if (elBoard) elBoard.style.pointerEvents = on ? 'none' : 'auto';
    document.body.classList.toggle('ai-thinking', !!on);
  }

  const isAITurn = () => settings.aiEnabled &&
    ((settings.aiColor==='w' && game.turn===COLORS.WHITE) ||
     (settings.aiColor==='b' && game.turn===COLORS.BLACK));

  // ✅ helper for reliable AI follow-up
  function maybeTriggerAI(){
    if (!AILock && isAITurn()) setTimeout(thinkAndPlay, 0);
  }

  const clocks = new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  elBoard.innerHTML='';
  const cells=[];
  for(let y=0;y<SIZE;y++){
    for(let x=0;x<SIZE;x++){
      const c=document.createElement('div');
      c.className='cell '+((x+y)%2?'dark':'light');
      c.dataset.x=x; c.dataset.y=y; elBoard.appendChild(c); cells.push(c);
    }
  }

  function applyTurnClass(){
    elBoard.classList.toggle('turn-white', game.turn===COLORS.WHITE);
    elBoard.classList.toggle('turn-black', game.turn===COLORS.BLACK);
  }

  function khTurnLabel(){
    const side=game.turn===COLORS.WHITE?KH.white:KH.black;
    const st=game.status();
    if(st.state==='checkmate'){const w=side==='ស'?'ខ្មៅ':'ស';return`វេនខាង(${side})·${KH.checkmate}·${w}ឈ្នះ`;}
    if(st.state==='stalemate')return KH.stalemate;
    if(st.state==='check')return`វេនខាង(${side})·${KH.check}`;
    return`វេនខាង(${side})`;
  }

  function render(){
    for(const c of cells)c.innerHTML='';
    for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
      const p=game.at(x,y); if(!p)continue;
      const cell=cells[y*SIZE+x];
      const s=document.createElement('div');
      s.className=`piece ${p.c==='w'?'white':'black'}`;
      s.style.backgroundImage=`url(./assets/pieces/${p.c==='w'?'w':'b'}-${p.t.toLowerCase()}.png)`;
      cell.appendChild(s);
    }
    elTurn.textContent=khTurnLabel();
    applyTurnClass();
  }

  async function thinkAndPlay(){
    if(!isAITurn()||AILock)return;
    setBoardBusy(true);
    try{
      const aiOpts={level:settings.aiLevel,aiColor:settings.aiColor,timeMs:120};
      const mv=await Promise.resolve(AIPICK(game,aiOpts));
      if(!mv){setBoardBusy(false);return;}
      const prev=game.turn;
      const before=game.at(mv.to.x,mv.to.y);
      const res=game.move(mv.from,mv.to);
      if(res?.ok){
        if(beeper.enabled){
          if(before)beeper.capture();else beeper.move();
          if(res.status?.state==='check')beeper.check();
        }
        clocks.switchedByMove(prev);
        render(); saveGameState(game,clocks);
        if(res.status?.state==='checkmate')setTimeout(()=>alert('អុកស្លាប់! AI ឈ្នះ'),60);
        else if(res.status?.state==='stalemate')setTimeout(()=>alert('អាប់ — ស្មើជាមួយ AI!'),60);
        else maybeTriggerAI();
      }
    }finally{setBoardBusy(false);}
  }

  let selected=null,legal=[];
  const clearHints=()=>{for(const c of cells)c.classList.remove('selected','hint-move','hint-capture');};
  const hintsEnabled=()=>settings.hints!==false;

  function showHints(x,y){
    clearHints();const cell=cells[y*SIZE+x];cell.classList.add('selected');
    legal=game.legalMoves(x,y);if(!hintsEnabled())return;
    for(const m of legal){const t=game.at(m.x,m.y),c=cells[m.y*SIZE+m.x];
      c.classList.add(t?'hint-capture':'hint-move');}
  }

  // ✅ updated tap handler
  function onCellTap(e){
    // 1) block if AI turn
    if(isAITurn()){ if(beeper.enabled)beeper.error(); vibrate(40); return; }
    // 2) block if engine busy
    if(AILock)return;

    const x=+e.currentTarget.dataset.x,y=+e.currentTarget.dataset.y;
    const p=game.at(x,y);

    // 3) block selecting AI’s pieces
    if(settings.aiEnabled && p && p.c===settings.aiColor){
      if(beeper.enabled)beeper.error(); vibrate(40); return;
    }

    if(p && p.c===game.turn){selected={x,y}; showHints(x,y);
      if(beeper.enabled)beeper.select(); return;}

    if(!selected){if(beeper.enabled)beeper.error(); vibrate(40); return;}

    const ok=legal.some(m=>m.x===x&&m.y===y);
    if(!ok){selected=null;legal=[];clearHints();beeper.error();vibrate(40);return;}

    const from={...selected},to={x,y},before=game.at(to.x,to.y),prev=game.turn;
    const res=game.move(from,to);
    if(res.ok){
      if(before)beeper.capture();else beeper.move();
      if(res.status?.state==='check')beeper.check();
      clocks.switchedByMove(prev);
      selected=null;legal=[];clearHints();render();saveGameState(game,clocks);
      if(res.status?.state==='checkmate')setTimeout(()=>alert('អុកស្លាប់!'),50);
      else if(res.status?.state==='stalemate')setTimeout(()=>alert('ស្មើ!'),50);
      else maybeTriggerAI();
    }
  }
  for(const c of cells)c.addEventListener('click',onCellTap,{passive:true});

  // resume/start
  const saved=loadGameState();
  if(saved){game.board=saved.board;game.turn=saved.turn;game.history=saved.history||[];
    render();clocks.start();}
  else{render();clocks.start();}
  maybeTriggerAI();

  // buttons
  btnReset?.addEventListener('click',()=>{
    game.reset();selected=null;legal=[];clearHints();
    clearGameState();clocks.init(settings.minutes,settings.increment,COLORS.WHITE);
    render();clocks.start();maybeTriggerAI();
  });
  btnUndo?.addEventListener('click',()=>{
    if(game.undo()){selected=null;legal=[];clearHints();render();saveGameState(game,clocks);maybeTriggerAI();}
  });
  btnPause?.addEventListener('click',()=>{
    const r=clocks.running;clocks.pauseResume();
    const i=btnPause.querySelector('img'),s=btnPause.querySelector('span');
    if(i)i.src=r?'assets/ui/play.png':'assets/ui/pause.png';
    if(s)s.textContent=r?'ចាប់ផ្ដើម':'ផ្អាក';
  });

  window.addEventListener('beforeunload',()=>saveGameState(game,clocks));
}
