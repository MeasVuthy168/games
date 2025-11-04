// ui.js — Khmer Chess (Play page) + Continuous AI turns (debugged & AI-move-adapted)
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
    merged.aiEnabled = true;
    merged.aiLevel   = 'Master';
    merged.aiColor   = 'b';
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
    window.AIDebug?.log('[UI] setBoardBusy:', on ? 'ON' : 'OFF');
  }

  function isAITurn() {
    return settings.aiEnabled && (
      (settings.aiColor === 'w' && game.turn === COLORS.WHITE) ||
      (settings.aiColor === 'b' && game.turn === COLORS.BLACK)
    );
  }

  function maybeTriggerAI(){
    const isTurn = isAITurn();
    window.AIDebug?.log('[UI] maybeTriggerAI — AILock=', String(AILock),'game.turn=', game.turn,'aiColor=', settings.aiColor,'isAITurn=', String(isTurn));
    if (!AILock && isTurn) {
      setTimeout(() => {
        if (!AILock && isAITurn()) thinkAndPlay();
      }, 400);
    }
  }

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
      cells[fromIdx].classList.add('last-from');
      cells[toIdx].classList.add('last-to');
      if(last.captured) cells[toIdx].classList.add('last-capture');
    }
    if(elTurn) elTurn.textContent=khTurnLabel();
    applyTurnClass();
  }

  /* ------------ helpers to adapt AI move to local legal moves -------- */

  function collectAllLegalMovesForTurn(){
    const legals = [];
    for (let y = 0; y < SIZE; y++){
      for (let x = 0; x < SIZE; x++){
        const p = game.at(x,y);
        if (!p || p.c !== game.turn) continue;
        const moves = game.legalMoves(x,y);
        for (const m of moves){
          legals.push({ from:{x,y}, to:{x:m.x,y:m.y} });
        }
      }
    }
    window.AIDebug?.log('[UI] collectAllLegalMovesForTurn: count =', String(legals.length));
    return legals;
  }

  function adaptAIMoveToLegal(hint){
    const legals = collectAllLegalMovesForTurn();
    if (!legals.length){
      window.AIDebug?.log('[UI] adaptAIMove: no legal moves available');
      return null;
    }

    if (hint && hint.from && hint.to){
      let fx = hint.from.x, fy = hint.from.y;
      let tx = hint.to.x, ty = hint.to.y;

      // --- 🔄 Coordinate translation for Makruk-to-Khmer-Chess board ---
      const flipY = (y) => 7 - y;
      fy = flipY(fy);
      ty = flipY(ty);
      // ---------------------------------------------------------------

      const translated = { from: {x:fx, y:fy}, to: {x:tx, y:ty} };
      window.AIDebug?.log('[UI] adaptAIMove: translated AI move =', JSON.stringify(translated));

      const exact = legals.find(m =>
        m.from.x === translated.from.x &&
        m.from.y === translated.from.y &&
        m.to.x   === translated.to.x &&
        m.to.y   === translated.to.y
      );
      if (exact){
        window.AIDebug?.log('[UI] adaptAIMove: exact translated AI move is legal');
        return exact;
      }

      const sameTo = legals.filter(m =>
        m.to.x === translated.to.x && m.to.y === translated.to.y
      );
      if (sameTo.length){
        window.AIDebug?.log('[UI] adaptAIMove: using move with same target square as translated AI move');
        return sameTo[0];
      }

      window.AIDebug?.log('[UI] adaptAIMove: translated move not legal, fallback random');
    } else {
      window.AIDebug?.log('[UI] adaptAIMove: no hint move, picking random legal');
    }

    const mv = legals[(Math.random() * legals.length) | 0];
    return mv;
  }

  // === AI thinking + move executor ====================================
  async function thinkAndPlay(){
    if (AILock || !isAITurn()) return;

    setBoardBusy(true);
    try{
      const aiOpts = { level:settings.aiLevel, aiColor:settings.aiColor, timeMs:120 };
      const aiHint = await Promise.resolve(AIPICK(game, aiOpts));
      window.AIDebug?.log('[UI] thinkAndPlay: move from AI (hint) =', JSON.stringify(aiHint));

      const mv = adaptAIMoveToLegal(aiHint);
      if (!mv) return;

      const prevTurn = game.turn;
      const before   = game.at(mv.to.x, mv.to.y);
      const res      = game.move(mv.from, mv.to);

      if (res?.ok) {
        if (beeper.enabled) {
          if (before){ beeper.capture(); vibrate([20,40,30]); }
          else beeper.move();
          if (res.status?.state === 'check') beeper.check();
        }
        clocks.switchedByMove(prevTurn);
        render(); saveGameState(game, clocks);
        if (res.status?.state==='checkmate') setTimeout(()=>alert('អុកស្លាប់! AI ឈ្នះ'),60);
        else if (res.status?.state==='stalemate') setTimeout(()=>alert('អាប់ — ស្មើជាមួយ AI!'),60);
        else maybeTriggerAI();
      }
    } catch(e){ console.error('[AI] thinkAndPlay failed', e); }
    finally{ setBoardBusy(false); }
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

  function onCellTap(e){
    const x=+e.currentTarget.dataset.x, y=+e.currentTarget.dataset.y, p=game.at(x,y);
    if (isAITurn()||AILock){ beeper.error(); vibrate(40); return; }

    if (p && p.c===game.turn){ selected={x,y}; showHints(x,y); beeper.select(); return; }
    if (!selected){ beeper.error(); vibrate(40); return; }

    const ok=legal.some(m=>m.x===x&&m.y===y);
    if(!ok){ selected=null; legal=[]; clearHints(); beeper.error(); vibrate(40); return; }

    const from={...selected}, to={x,y}, before=game.at(to.x,to.y), prev=game.turn;
    const res=game.move(from,to);
    if(res.ok){
      if(before){beeper.capture();vibrate([20,40,30]);}else beeper.move();
      if(res.status?.state==='check') beeper.check();
      clocks.switchedByMove(prev); selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
      if(res.status?.state==='checkmate') alert('អុកស្លាប់! ការប្រកួតបានបញ្ចប់');
      else if(res.status?.state==='stalemate') alert('អាប់ — ស្មើគ្នា!');
      else maybeTriggerAI();
    }
  }

  for(const c of cells)c.addEventListener('click',onCellTap,{passive:true});

  const saved=loadGameState();
  if(saved){ game.board=saved.board; game.turn=saved.turn; game.history=saved.history||[]; render(); clocks.start(); }
  else { render(); clocks.start(); }
  maybeTriggerAI();

  btnReset?.addEventListener('click', ()=>{ game.reset(); selected=null; legal=[]; clearHints(); clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE); render(); clocks.start(); maybeTriggerAI(); });
  btnUndo?.addEventListener('click', ()=>{ if(game.undo()){ selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks); maybeTriggerAI(); }});
  btnPause?.addEventListener('click', ()=>{ const was=clocks.running; clocks.pauseResume(); const i=btnPause?.querySelector('img'), s=btnPause?.querySelector('span'); if(i)i.src=was?'assets/ui/play.png':'assets/ui/pause.png'; if(s)s.textContent=was?'ចាប់ផ្ដើម':'ផ្អាក'; });
  window.addEventListener('beforeunload', ()=>saveGameState(game,clocks));
}
