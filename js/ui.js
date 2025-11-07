// ui.js — Khmer Chess (Play page) — Trust remote AI moves, even if locally “illegal”
import { Game, SIZE, COLORS } from './game.js';
import * as AI from './ai.js';
const AIPICK = AI.pickAIMove || AI.chooseAIMove;

const LS_KEY   = 'kc_settings_v1';
// NEW save key so old buggy states are ignored
const SAVE_KEY = 'kc_game_state_makruk_v1';
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
    // Force Makruk AI vs human
    merged.aiEnabled = true;
    merged.aiLevel   = 'Master';
    merged.aiColor   = 'b';    // AI = Black
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

  window.AIDebug?.log('[UI] init — Makruk AI (force-move mode)');

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

  const clocks = new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // Build board
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
    const name = `${p.c === 'w' ? 'w' : 'b'}-${key}.png`;
    span.style.backgroundImage = `url(./assets/pieces/${name})`;
  }

  function khTurnLabel(){
    const side=game.turn===COLORS.WHITE?KH.white:KH.black;
    const st=game.status();
    if(st.state==='checkmate'){
      const w=side==='ស'?'ខ្មៅ':'ស';
      return `វេនខាង (${side}) · ${KH.checkmate} · ${w} ឈ្នះ`;
    }
    if(st.state==='stalemate') return KH.stalemate;
    if(st.state==='check')     return `វេនខាង (${side}) · ${KH.check}`;
    return `វេនខាង (${side})`;
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
      cells[fromIdx]?.classList.add('last-from');
      cells[toIdx]?.classList.add('last-to');
      if(last.captured) cells[toIdx]?.classList.add('last-capture');
    }
    if (elTurn) elTurn.textContent=khTurnLabel();
    applyTurnClass();
  }

  /* ========== AI Logic (force remote move) ========== */

  // helper: find any AI piece that has a legal move to "to"
  function findLegalSourceFor(toX, toY){
    for (let y=0; y<SIZE; y++){
      for (let x=0; x<SIZE; x++){
        const p = game.at(x,y);
        if (!p || p.c !== settings.aiColor) continue;
        const moves = game.legalMoves(x,y);
        if (moves.some(m => m.x === toX && m.y === toY)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  // helper: find any AI piece at all to teleport
  function findAnyAIPiece(){
    for (let y=0; y<SIZE; y++){
      for (let x=0; x<SIZE; x++){
        const p = game.at(x,y);
        if (p && p.c === settings.aiColor) {
          return { x, y };
        }
      }
    }
    return null;
  }

  async function thinkAndPlay(){
    if (AILock || !isAITurn()) return;
    setBoardBusy(true);
    try{
      const aiOpts = { level: settings.aiLevel, aiColor: settings.aiColor, timeMs: 120 };
      const aiMove = await Promise.resolve(AIPICK(game, aiOpts));

      window.AIDebug?.log('[UI] thinkAndPlay: AI move (raw) =', JSON.stringify(aiMove));

      // If AI failed to produce any move → disable AI, let human continue both sides
      if (!aiMove || !aiMove.from || !aiMove.to){
        window.AIDebug?.log('[UI] AI returned null/invalid move → disabling AI (no fallback)');
        alert('AI engine could not find a move.\nAI play has been stopped. You can continue playing both sides or press Reset.');
        settings.aiEnabled = false;  // so isAITurn() will be false from now on
        return;
      }

      const from = { x: aiMove.from.x, y: aiMove.from.y };
      const to   = { x: aiMove.to.x,   y: aiMove.to.y   };

      // board bounds safety
      if (from.x<0 || from.x>=SIZE || from.y<0 || from.y>=SIZE ||
          to.x<0   || to.x>=SIZE   || to.y<0   || to.y>=SIZE) {
        window.AIDebug?.log('[UI] AI move outside board → disabling AI');
        alert('AI engine produced an off-board move.\nAI play has been stopped.');
        settings.aiEnabled = false;
        return;
      }

      const prevTurn = game.turn;
      const before   = game.at(to.x,to.y);

      const res = game.move(from, to);

      if (!res || !res.ok){
        // Engine move not legal under our local Makruk rules (should be rare now).
        window.AIDebug?.log('[UI] game.move rejected for engine move → disabling AI (no fallback)');
        alert('AI engine suggested a move that is illegal in the local Makruk rules.\nAI play has been stopped. You can finish the game manually or reset.');
        settings.aiEnabled = false;
        return;
      }

      // SFX
      if (beeper.enabled){
        if (before){ beeper.capture(); vibrate([20,40,30]); }
        else beeper.move();
        if (res.status?.state === 'check') beeper.check();
      }

      // clocks + UI
      clocks.switchedByMove(prevTurn);
      render();
      saveGameState(game, clocks);

      if (res.status?.state === 'checkmate'){
        alert('អុកស្លាប់! AI ឈ្នះ');
      } else if (res.status?.state === 'stalemate'){
        alert('អាប់ — ស្មើជាមួយ AI!');
      }

    }catch(e){
      console.error('[AI] thinkAndPlay failed', e);
      window.AIDebug?.log('[UI] thinkAndPlay ERROR:', e?.message || String(e));
      alert('AI error occurred. AI play has been stopped.');
      settings.aiEnabled = false;
    }finally{
      setBoardBusy(false);
      window.AIDebug?.log('[UI] thinkAndPlay END turn=', game.turn);
    }
  }

  /* ========== Human move ========== */

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

  function onCellTap(e){
    const x = +e.currentTarget.dataset.x;
    const y = +e.currentTarget.dataset.y;
    const p = game.at(x,y);

    if (isAITurn() || AILock){
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    if (p && p.c === game.turn){
      selected = {x,y};
      showHints(x,y);
      if (beeper.enabled) beeper.select();
      return;
    }

    if (!selected){
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok){
      selected=null; legal=[]; clearHints();
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    const from = { ...selected };
    const to   = { x, y };
    const before = game.at(to.x,to.y);
    const prev   = game.turn;
    const res    = game.move(from,to);

    if (res.ok){
      if (beeper.enabled){
        if (before){ beeper.capture(); vibrate([20,40,30]); }
        else beeper.move();
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prev);
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);

      if (res.status?.state==='checkmate'){
        alert('អុកស្លាប់! ការប្រកួតបានបញ្ចប់');
      } else if (res.status?.state==='stalemate'){
        alert('អាប់ — ស្មើគ្នា!');
      } else {
        // Let AI reply
        thinkAndPlay();
      }
    }
  }

  for(const c of cells) c.addEventListener('click',onCellTap,{passive:true});

  // resume or fresh start
  const saved=loadGameState();
  if(saved){
    game.board=saved.board; game.turn=saved.turn; game.history=saved.history||[];
    render(); clocks.start();
  } else {
    render(); clocks.start();
  }

  // AI first move (if ever AI=White later)
  if (isAITurn()) thinkAndPlay();

  /* -------- controls -------- */
  btnReset?.addEventListener('click', ()=>{
    game.reset(); selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    if (isAITurn()) thinkAndPlay();
  });

  btnUndo?.addEventListener('click', ()=>{
    if(game.undo()){
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
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
