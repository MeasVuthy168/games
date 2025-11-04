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
    // Force single AI mode for now
    merged.aiEnabled = true;     // AI always on
    merged.aiLevel   = 'Master'; // single level
    merged.aiColor   = 'b';      // AI plays Black
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

  // Log basic settings into AI debug panel
  window.AIDebug?.log(
    '[UI] init — aiEnabled=', String(settings.aiEnabled),
    'aiColor=', settings.aiColor,
    'aiLevel=', settings.aiLevel
  );

  let AILock = false;
  function setBoardBusy(on){
    AILock = !!on;
    if (elBoard) elBoard.style.pointerEvents = on ? 'none' : 'auto';
    document.body.classList.toggle('ai-thinking', !!on);
    window.AIDebug?.log('[UI] setBoardBusy:', on ? 'ON' : 'OFF');
  }

  function isAITurn() {
    const result = settings.aiEnabled && (
      (settings.aiColor === 'w' && game.turn === COLORS.WHITE) ||
      (settings.aiColor === 'b' && game.turn === COLORS.BLACK)
    );
    return result;
  }

  function maybeTriggerAI(){
    const isTurn = isAITurn();
    window.AIDebug?.log(
      '[UI] maybeTriggerAI — AILock=', String(AILock),
      'game.turn=', game.turn,
      'aiColor=', settings.aiColor,
      'isAITurn=', String(isTurn)
    );

    if (!AILock && isTurn) {
      setTimeout(() => {
        const stillAITurn = isAITurn();
        window.AIDebug?.log('[UI] maybeTriggerAI timeout — stillAITurn=', String(stillAITurn), 'AILock=', String(AILock));
        if (!AILock && stillAITurn) thinkAndPlay();
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

    const tryMatch = (move, label) => {
      if (!move) return null;
      window.AIDebug?.log('[UI] adaptAIMove: trying', label, 'candidate =', JSON.stringify(move));

      // 1) exact
      const exact = legals.find(m =>
        m.from.x === move.from.x &&
        m.from.y === move.from.y &&
        m.to.x   === move.to.x   &&
        m.to.y   === move.to.y
      );
      if (exact){
        window.AIDebug?.log('[UI] adaptAIMove:', label, 'exact match is legal');
        return exact;
      }

      // 2) same destination
      const sameTo = legals.filter(m =>
        m.to.x === move.to.x && m.to.y === move.to.y
      );
      if (sameTo.length){
        window.AIDebug?.log('[UI] adaptAIMove:', label, 'using move with same target square');
        return sameTo[0];
      }

      window.AIDebug?.log('[UI] adaptAIMove:', label, 'no match');
      return null;
    };

    if (hint && hint.from && hint.to){
      // 🔹 First: try the AI move as-is (no translation)
      const raw = {
        from: { x: hint.from.x, y: hint.from.y },
        to:   { x: hint.to.x,   y: hint.to.y }
      };
      const rawMatch = tryMatch(raw, 'raw');
      if (rawMatch) return rawMatch;

      // 🔹 Second: try a Makruk→Khmer flip on Y as backup
      const flipY = (y) => 7 - y;
      const translated = {
        from: { x: hint.from.x, y: flipY(hint.from.y) },
        to:   { x: hint.to.x,   y: flipY(hint.to.y) }
      };
      window.AIDebug?.log('[UI] adaptAIMove: translated AI move =', JSON.stringify(translated));
      const transMatch = tryMatch(translated, 'translated');
      if (transMatch) return transMatch;

      window.AIDebug?.log('[UI] adaptAIMove: neither raw nor translated hint was legal, fallback random');
    } else {
      window.AIDebug?.log('[UI] adaptAIMove: no hint move, picking random legal');
    }

    // random legal fallback
    const mv = legals[(Math.random() * legals.length) | 0];
    return mv;
  }

  // === AI thinking + move executor ====================================
  async function thinkAndPlay(){
    if (AILock || !isAITurn()) {
      window.AIDebug?.log(
        '[UI] thinkAndPlay: skipped — AILock=',
        String(AILock),
        'game.turn=', game.turn,
        'aiColor=', settings.aiColor,
        'isAITurn=', String(isAITurn())
      );
      return;
    }

    window.AIDebug?.log('[UI] thinkAndPlay: START for side', game.turn);
    setBoardBusy(true);
    try{
      const aiOpts = {
        level:  settings.aiLevel,
        aiColor: settings.aiColor,
        timeMs: 120
      };

      const aiHint = await Promise.resolve(AIPICK(game, aiOpts));
      window.AIDebug?.log('[UI] thinkAndPlay: move from AI (hint) =', JSON.stringify(aiHint));

      if (!aiHint) {
        window.AIDebug?.log('[UI] thinkAndPlay: AI returned null move');
        return;
      }

      // ensure we only play a move that is legal for the local rules
      const mv = adaptAIMoveToLegal(aiHint);
      if (!mv){
        window.AIDebug?.log('[UI] thinkAndPlay: no legal move could be adapted from AI hint');
        return;
      }
      window.AIDebug?.log('[UI] thinkAndPlay: applying move =', JSON.stringify(mv));

      const prevTurn = game.turn;
      const before   = game.at(mv.to.x, mv.to.y);
      const res      = game.move(mv.from, mv.to);

      window.AIDebug?.log(
        '[UI] thinkAndPlay: game.move result ok=',
        String(!!res?.ok),
        'newTurn=', game.turn
      );

      if (res?.ok) {
        if (beeper.enabled) {
          if (before){ beeper.capture(); vibrate([20,40,30]); }
          else beeper.move();
          if (res.status?.state === 'check') beeper.check();
        }

        clocks.switchedByMove(prevTurn);
        render();
        saveGameState(game, clocks);

        if (res.status?.state === 'checkmate') {
          window.AIDebug?.log('[UI] thinkAndPlay: checkmate');
          setTimeout(() => alert('អុកស្លាប់! AI ឈ្នះ'), 60);
        } else if (res.status?.state === 'stalemate') {
          window.AIDebug?.log('[UI] thinkAndPlay: stalemate');
          setTimeout(() => alert('អាប់ — ស្មើជាមួយ AI!'), 60);
        } else {
          maybeTriggerAI();
        }
      } else {
        window.AIDebug?.log('[UI] thinkAndPlay: game.move returned not ok even after adapting mv=', JSON.stringify(mv));
      }
    } catch (e) {
      window.AIDebug?.log('[UI] thinkAndPlay ERROR:', e?.message || String(e));
      console.error('[AI] thinkAndPlay failed', e);
    } finally {
      setBoardBusy(false);
      window.AIDebug?.log('[UI] thinkAndPlay: END, game.turn=', game.turn);
    }
  }
  // =====================================================================

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

  // === UPDATED onCellTap with debug (and AI-piece capture allowed) ====
  function onCellTap(e){
    const x = +e.currentTarget.dataset.x;
    const y = +e.currentTarget.dataset.y;
    const p = game.at(x,y);

    window.AIDebug?.log(
      '[UI] tap @', x, y,
      'piece=', p ? (p.c + p.t) : 'empty',
      'game.turn=', game.turn,
      'aiColor=', settings.aiColor,
      'isAITurn=', String(isAITurn()),
      'AILock=', String(AILock)
    );

    // 1) Never allow user moves while it's AI's turn
    if (isAITurn()) {
      window.AIDebug?.log('[UI] tap blocked: it is AI turn');
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    // 2) Also block while engine is busy
    if (AILock) {
      window.AIDebug?.log('[UI] tap blocked: AILock true');
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    // ⚠️ We DO NOT block selecting AI-colored squares anymore,
    // so you can capture AI pieces.

    if (p && p.c === game.turn){
      selected = {x,y};
      showHints(x,y);
      if (beeper.enabled) beeper.select();
      return;
    }

    if (!selected){
      window.AIDebug?.log('[UI] tap: no piece selected and tap not own piece');
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok){
      window.AIDebug?.log('[UI] tap: target not in legal[] — clearing selection');
      selected = null;
      legal = [];
      clearHints();
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    const from   = { ...selected };
    const to     = { x, y };
    const before = game.at(to.x,to.y);
    const prev   = game.turn;

    window.AIDebug?.log('[UI] human move from', JSON.stringify(from), 'to', JSON.stringify(to));

    const res = game.move(from,to);
    if (res.ok){
      if (beeper.enabled){
        if (before){ beeper.capture(); vibrate([20,40,30]); }
        else beeper.move();
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prev);
      selected = null;
      legal = [];
      clearHints();
      render();
      saveGameState(game,clocks);

      window.AIDebug?.log('[UI] human move applied, new turn=', game.turn);

      if (res.status?.state === 'checkmate'){
        window.AIDebug?.log('[UI] human caused checkmate');
        alert('អុកស្លាប់! ការប្រកួតបានបញ្ចប់');
      } else if (res.status?.state === 'stalemate'){
        window.AIDebug?.log('[UI] human caused stalemate');
        alert('អាប់ — ស្មើគ្នា!');
      } else {
        maybeTriggerAI();
      }
    } else {
      window.AIDebug?.log('[UI] game.move from tap returned not ok');
    }
  }
  // =====================================================================

  for(const c of cells) c.addEventListener('click',onCellTap,{passive:true});

  // resume or fresh start
  const saved=loadGameState();
  if(saved){
    game.board=saved.board; game.turn=saved.turn; game.history=saved.history||[];
    window.AIDebug?.log('[UI] loaded saved game — turn=', game.turn);
    render(); clocks.start();
  } else {
    window.AIDebug?.log('[UI] new game — turn=', game.turn);
    render(); clocks.start();
  }

  // if AI should move first (in future when AI can be White)
  maybeTriggerAI();

  /* -------- controls -------- */
  btnReset?.addEventListener('click', ()=>{
    window.AIDebug?.log('[UI] RESET pressed');
    game.reset(); selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    maybeTriggerAI();
  });

  btnUndo?.addEventListener('click', ()=>{
    window.AIDebug?.log('[UI] UNDO pressed');
    if(game.undo()){
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
      window.AIDebug?.log('[UI] undo ok, new turn=', game.turn);
      maybeTriggerAI();
    } else {
      window.AIDebug?.log('[UI] undo failed (no history)');
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
