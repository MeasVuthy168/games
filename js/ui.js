// ui.js — Khmer Chess (Play page) + Continuous AI turns (fixed)
import { Game, SIZE, COLORS } from './game.js';
import * as AI from './ai.js';
const AIPICK = AI.pickAIMove || AI.chooseAIMove;

const LS_KEY   = 'kc_settings_v1';
const SAVE_KEY = 'kc_game_state_v2';
const DEFAULTS = { minutes: 10, increment: 5, sound: true, hints: true };

/* ---------------- storage ---------------- */
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
    merged.aiEnabled = true;          // Force AI enabled
    merged.aiLevel   = 'Master';      // Only one level
    merged.aiColor   = 'b';           // AI = Black
    return merged;
  }catch{
    return { ...DEFAULTS, aiEnabled:true, aiLevel:'Master', aiColor:'b' };
  }
}

/* ---------------- audio ---------------- */
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

/* ---------------- clocks ---------------- */
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

/* ---------------- main UI ---------------- */
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

  function isAITurn() {
    return settings.aiEnabled && (
      (settings.aiColor === 'w' && game.turn === COLORS.WHITE) ||
      (settings.aiColor === 'b' && game.turn === COLORS.BLACK)
    );
  }

  // **MODIFIED:** Removed maybeTriggerAI as its logic is now inline or simplified.

  const clocks = new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // build board
  elBoard.innerHTML='';
  const cells=[];
  for(let y=0;y<SIZE;y++){
    for(let x=0;x<SIZE;x++){
      const c=document.createElement('div');
      c.className='cell '+((x+y)%2?'dark':'light');
      c.dataset.x=x; c.dataset.y=y;
      elBoard.appendChild(c); cells.push(c);
    }
  }

  function applyTurnClass(){
    elBoard.classList.toggle('turn-white', game.turn===COLORS.WHITE);
    elBoard.classList.toggle('turn-black', game.turn===COLORS.BLACK);
  }

  function setPieceBG(span, p){
    const map = { K:'king', Q:'queen', B:'bishop', R:'rook', N:'knight', P:'pawn' };
    const key = map[p.t] || 'pawn';
    const name = `${p.c==='w' ? 'w' : 'b'}-${key}.png`;
    span.style.backgroundImage = `url(./assets/pieces/${name})`;
  }

  function khTurnLabel(){
    const side=game.turn===COLORS.WHITE?KH.white:KH.black;
    const st=game.status();
    if(st.state==='checkmate'){const w=side==='ស'?'ខ្មៅ':'ស';return`វេនខាង (${side}) · ${KH.checkmate} · ${w} ឈ្នះ`;}
    if(st.state==='stalemate')return KH.stalemate;
    if(st.state==='check')return`វេនខាង (${side}) · ${KH.check}`;
    return`វេនខាង (${side})`;
  }

  function render(){
    for(const c of cells){
      c.innerHTML='';
      c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture');
    }
    for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
      const p=game.at(x,y); if(!p)continue;
      const cell=cells[y*SIZE+x];
      const s=document.createElement('div');
      s.className=`piece ${p.c==='w'?'white':'black'}`;
      setPieceBG(s,p);
      cell.appendChild(s);
    }
    const last = game.history[game.history.length-1];
    if(last){
      const fromIdx = last.from.y*SIZE + last.from.x;
      const toIdx   = last.to.y*SIZE + last.to.x;
      cells[fromIdx].classList.add('last-from');
      cells[toIdx].classList.add('last-to');
      if(last.captured) cells[toIdx].classList.add('last-capture');
    }
    if(elTurn) elTurn.textContent=khTurnLabel();
    applyTurnClass();
  }

  // **FULLY MODIFIED thinkAndPlay for continuous, recursive AI moves**
  async function thinkAndPlay(){
    // Check if it's the AI's turn and the board isn't already busy
    if (!isAITurn() || AILock) {
      // If it's not the AI's turn, we are done
      return;
    }

    setBoardBusy(true);
    
    try {
      const aiOpts = { level: settings.aiLevel, aiColor: settings.aiColor, timeMs: 120 };
      // Introduce a small delay to make the AI thinking visible/feel natural
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const mv = await Promise.resolve(AIPICK(game, aiOpts));
      
      if (!mv) {
        // AI couldn't find a move, stop and unbusy the board
        setBoardBusy(false);
        return;
      }

      const prev = game.turn;
      const before = game.at(mv.to.x, mv.to.y);
      const res = game.move(mv.from, mv.to);
      
      if (res?.ok) {
        if (beeper.enabled) {
          if (before) { beeper.capture(); vibrate([20, 40, 30]); } else beeper.move();
          if (res.status?.state === 'check') beeper.check();
        }
        
        clocks.switchedByMove(prev);
        render();
        saveGameState(game, clocks);

        // Check for end of game conditions
        if (res.status?.state === 'checkmate') {
          setTimeout(() => alert('អុកស្លាប់! AI ឈ្នះ'), 60);
        } else if (res.status?.state === 'stalemate') {
          setTimeout(() => alert('អាប់ — ស្មើជាមួយ AI!'), 60);
        } else {
          // If the game is still on, immediately check if the AI needs to move again
          // This creates the continuous AI turns loop until a human player's turn is reached
          if (isAITurn()) {
            // Note: Since the recursive call is *inside* the try block and before the 
            // setBoardBusy(false) in finally, we *don't* unbusy the board here.
            // The next call to thinkAndPlay will re-lock it, and the last one will unlock it.
            // This is safer: we rely on the next call's try/finally, or the *current*
            // finally block if the recursive call fails or doesn't happen.
            // However, a simple recursive call is cleaner:
            return thinkAndPlay();
          }
        }
      }
    } catch (error) {
      console.error('AI move failed:', error);
    } finally {
      // Only set busy to false if it's no longer the AI's turn (or if an error occurred)
      if (!isAITurn() || game.status().state !== 'ongoing') {
        setBoardBusy(false);
      }
    }
  }

  let selected=null,legal=[];
  const clearHints=()=>{ for(const c of cells)c.classList.remove('selected','hint-move','hint-capture'); };
  const hintsEnabled=()=>settings.hints!==false;

  function showHints(x,y){
    clearHints(); const cell=cells[y*SIZE+x]; cell.classList.add('selected');
    legal=game.legalMoves(x,y); if(!hintsEnabled()) return;
    for(const m of legal){
      const t=game.at(m.x,m.y), c=cells[m.y*SIZE+m.x];
      c.classList.add(t?'hint-capture':'hint-move');
    }
  }

  // **UPDATED onCellTap to reliably trigger AI immediately after human move**
  function onCellTap(e){
    // block user input when AI thinking or its turn
    if (AILock || isAITurn()){ beeper.error(); vibrate(40); return; }

    const x=+e.currentTarget.dataset.x, y=+e.currentTarget.dataset.y;
    const p=game.at(x,y);
    // Block selecting an AI piece (if settings.aiEnabled is true)
    if (settings.aiEnabled && p && p.c===settings.aiColor){ beeper.error(); vibrate(40); return; }

    if(p && p.c===game.turn){
      selected={x,y}; showHints(x,y);
      beeper.select();
      return;
    }
    if(!selected){ beeper.error(); vibrate(40); return; }

    const ok=legal.some(m=>m.x===x&&m.y===y);
    if(!ok){ selected=null; legal=[]; clearHints(); beeper.error(); vibrate(40); return; }

    const from={...selected}, to={x,y}, before=game.at(to.x,to.y), prev=game.turn;
    const res=game.move(from,to);
    if(res.ok){
      if(beeper.enabled){ before?beeper.capture():beeper.move(); }
      if(res.status?.state==='check') beeper.check();
      clocks.switchedByMove(prev);
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
      
      // Check for end of game conditions after the human move
      if(res.status?.state==='checkmate'){
        alert('អុកស្លាប់! ការប្រកួតបានបញ្ចប់');
      }else if(res.status?.state==='stalemate'){
        alert('អាប់ — ស្មើគ្នា!');
      }
      
      // ⚡️ Immediately trigger AI after a successful human move if it's the AI's turn
      // The thinkAndPlay function is now responsible for handling recursive turns.
      // We don't need a timeout here; thinkAndPlay has an internal one for UX.
      if (game.status().state === 'ongoing') {
          thinkAndPlay(); 
      }
    }
  }
  for(const c of cells)c.addEventListener('click',onCellTap,{passive:true});

  // resume or fresh start
  const saved=loadGameState();
  if(saved){
    game.board=saved.board; game.turn=saved.turn; game.history=saved.history||[];
    render(); clocks.start();
  } else {
    render(); clocks.start();
  }

  // if AI should move first
  if (game.status().state === 'ongoing') {
      thinkAndPlay();
  }

  /* -------- controls -------- */
  btnReset?.addEventListener('click', ()=>{
    game.reset(); selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    if (game.status().state === 'ongoing') {
      thinkAndPlay();
    }
  });

  btnUndo?.addEventListener('click', ()=>{
    if(game.undo()){
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
      // After undo, if it's now an AI turn, trigger it
      if (game.status().state === 'ongoing') {
          thinkAndPlay();
      }
    }
  });

  btnPause?.addEventListener('click', ()=>{
    const wasRunning = clocks.running;
    clocks.pauseResume();
    const i=btnPause?.querySelector('img'); const s=btnPause?.querySelector('span');
    if(i) i.src = wasRunning ? 'assets/ui/play.png' : 'assets/ui/pause.png';
    if(s) s.textContent = wasRunning ? 'ចាប់ផ្ដើម' : 'ផ្អាក';
  });

  window.addEventListener('beforeunload', ()=> saveGameState(game,clocks));
}
