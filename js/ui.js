// ui.js — Khmer Chess (Play page) — Makruk AI with remote engine + fallback
import { Game, SIZE, COLORS } from './game.js';
import * as AI from './ai.js';

const AIPICK = AI.pickAIMove || AI.chooseAIMove;

const LS_KEY   = 'kc_settings_v1';
const SAVE_KEY = 'kc_game_state_makruk_v1';

const DEFAULTS = {
  minutes: 10,
  increment: 5,
  sound: true,
  hints: true
};

/* ---------------- storage ---------------- */

function saveGameState(game, clocks) {
  const s = {
    board: game.board,
    turn: game.turn,
    history: game.history,
    msW: clocks.msW,
    msB: clocks.msB,
    clockTurn: clocks.turn
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {}
}

function loadGameState() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

function clearGameState() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    const merged = s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
    // Force Makruk AI vs human
    merged.aiEnabled = true;
    merged.aiLevel   = 'Master';
    merged.aiColor   = 'b';    // AI = Black
    return merged;
  } catch {
    return { ...DEFAULTS, aiEnabled: true, aiLevel: 'Master', aiColor: 'b' };
  }
}

/* ---------------- audio ---------------- */

class AudioBeeper {
  constructor() {
    this.enabled = true;
    this.bank = {
      move:    new Audio('assets/sfx/move.mp3'),
      capture: new Audio('assets/sfx/capture.mp3'),
      select:  new Audio('assets/sfx/select.mp3'),
      error:   new Audio('assets/sfx/error.mp3'),
      check:   new Audio('assets/sfx/check.mp3')
    };
    for (const k in this.bank) this.bank[k].preload = 'auto';
  }
  play(name, vol = 1) {
    if (!this.enabled) return;
    const src = this.bank[name];
    if (!src) return;
    const a = src.cloneNode(true);
    a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(() => {});
  }
  move()    { this.play('move',   0.9); }
  capture() { this.play('capture', 1.0); }
  select()  { this.play('select', 0.85); }
  error()   { this.play('error',  0.9); }
  check()   { this.play('check',  1.0); }
}
const beeper = new AudioBeeper();

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/* ---------------- clocks ---------------- */

class Clocks {
  constructor(update) {
    this.msW = 0;
    this.msB = 0;
    this.running = false;
    this.turn = COLORS.WHITE;
    this.increment = 0;
    this._t = null;
    this._u = update;
  }

  init(min, inc, turn = COLORS.WHITE) {
    this.msW = min * 60 * 1000;
    this.msB = min * 60 * 1000;
    this.increment = inc * 1000;
    this.turn = turn;
    this.stop();
    this._u(this.msW, this.msB);
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();

    const tick = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = now - last;
      last = now;

      if (this.turn === COLORS.WHITE) {
        this.msW = Math.max(0, this.msW - dt);
      } else {
        this.msB = Math.max(0, this.msB - dt);
      }

      this._u(this.msW, this.msB);

      if (this.msW <= 0 || this.msB <= 0) {
        this.stop();
        return;
      }

      this._t = requestAnimationFrame(tick);
    };

    this._t = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this._t) cancelAnimationFrame(this._t);
    this._t = null;
  }

  pauseResume() {
    this.running ? this.stop() : this.start();
  }

  switchedByMove(prev) {
    if (prev === COLORS.WHITE) this.msW += this.increment;
    else this.msB += this.increment;

    this.turn = (prev === COLORS.WHITE) ? COLORS.BLACK : COLORS.WHITE;
    this._u(this.msW, this.msB);
    this.start();
  }

  format(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const t = Math.floor((ms % 1000) / 100);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${t}`;
  }
}

/* ---------------- Toast + helpers (①,②,④,⑤ use this) ---------------- */
function toast(t){
  let el = document.getElementById('kcToast');
  if (!el){
    el = document.createElement('div');
    el.id='kcToast';
    document.body.appendChild(el);
  }
  el.textContent = t;
  el.style.opacity = '1';
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(()=>{ el.style.opacity='0'; }, 1400);
}
function copyText(s){ navigator.clipboard?.writeText(s).then(()=>toast('Copied!')).catch(()=>alert(s)); }

/* ---------------- main UI ---------------- */

export function initUI() {
  const elBoard  = document.getElementById('board');
  const elTurn   = document.getElementById('turnLabel');
  const btnReset = document.getElementById('btnReset');
  const btnUndo  = document.getElementById('btnUndo');
  const btnPause = document.getElementById('btnPause');
  const btnHint  = document.getElementById('btnHint');
  const clockW   = document.getElementById('clockW');
  const clockB   = document.getElementById('clockB');

  const KH = {
    white: 'ស',
    black: 'ខ្មៅ',
    check: 'អុក',
    checkmate: 'អុកស្លាប់',
    stalemate: 'អាប់'
  };

  const game = new Game();
  const settings = loadSettings();
  beeper.enabled = !!settings.sound;

  // ⑤ Battery Saver
  if (navigator.getBattery) {
    try {
      navigator.getBattery().then(b=>{
        if (b.level <= 0.2){
          beeper.enabled = false;
          document.body.classList.add('low-battery');
          toast('Battery Saver On');
        }
      });
    } catch {}
  }

  window.AIDebug?.log('[UI] init — Makruk AI (remote + fallback)');

  let AILock = false;

  function setBoardBusy(on) {
    AILock = !!on;
    if (elBoard) elBoard.style.pointerEvents = on ? 'none' : 'auto';
    document.body.classList.toggle('ai-thinking', !!on);
  }

  function isAITurn() {
    if (!settings.aiEnabled) return false;
    if (settings.aiColor === 'w' && game.turn === COLORS.WHITE) return true;
    if (settings.aiColor === 'b' && game.turn === COLORS.BLACK) return true;
    return false;
  }

  const clocks = new Clocks((w, b) => {
    if (clockW) clockW.textContent = clocks.format(w);
    if (clockB) clockB.textContent = clocks.format(b);
  });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // Build board
  elBoard.innerHTML = '';
  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = document.createElement('div');
      c.className = 'cell ' + ((x + y) % 2 ? 'dark' : 'light');
      c.dataset.x = x;
      c.dataset.y = y;
      elBoard.appendChild(c);
      cells.push(c);
    }
  }

  function applyTurnClass() {
    elBoard.classList.toggle('turn-white', game.turn === COLORS.WHITE);
    elBoard.classList.toggle('turn-black', game.turn === COLORS.BLACK);
  }

  function setPieceBG(span, p){
    const map = { K:'king', Q:'queen', M:'queen', B:'bishop', S:'bishop', R:'rook', N:'knight', P:'pawn' };
    const key  = map[p.t] || 'pawn';
    const name = `${p.c === 'w' ? 'w' : 'b'}-${key}.png`;
    span.style.backgroundImage = `url(./assets/pieces/${name})`;
  }

  function khTurnLabel() {
    const side = game.turn === COLORS.WHITE ? KH.white : KH.black;
    const st = game.status();
    if (st.state === 'checkmate') {
      const w = side === 'ស' ? 'ខ្មៅ' : 'ស';
      return `វេនខាង (${side}) · ${KH.checkmate} · ${w} ឈ្នះ`;
    }
    if (st.state === 'stalemate') return KH.stalemate;
    if (st.state === 'check')     return `វេនខាង (${side}) · ${KH.check}`;
    return `វេនខាង (${side})`;
  }

  function render() {
    for (const c of cells) {
      c.innerHTML = '';
      c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture');
    }

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = game.at(x, y);
        if (!p) continue;
        const cell = cells[y * SIZE + x];
        const s = document.createElement('div');
        s.className = `piece ${p.c === 'w' ? 'white' : 'black'}`;
        setPieceBG(s, p);
        cell.appendChild(s);
      }
    }

    const last = game.history[game.history.length - 1];
    if (last) {
      const fromIdx = last.from.y * SIZE + last.from.x;
      const toIdx   = last.to.y * SIZE + last.to.x;
      cells[fromIdx]?.classList.add('last-from');
      cells[toIdx]?.classList.add('last-to');
      if (last.captured) cells[toIdx]?.classList.add('last-capture');
    }

    if (elTurn) elTurn.textContent = khTurnLabel();
    applyTurnClass();
  }

  /* ====== Coach Mode (①) ====== */
  async function quickCoach(game, sideJustMoved) {
    try{
      // very quick probe; relies on your AI’s fast setting
      const best = await (AIPICK)(game, { aiColor: sideJustMoved, timeMs: 220, maxDepth: 4 });
      // If your AI does not return scores, show “Good move” randomly (or skip entirely).
      // Here we just give a gentle positive nudge to keep UX nice.
      if (best?.from && best?.to) {
        // 30% chance of praising; avoids spam
        if (Math.random() < 0.3) toast('✅ Good move');
      }
    }catch{}
  }

  /* ====== Auto "Count for Draw" detector (③) ====== */
  function materialKey(game){
    const counts = { w:{R:0,N:0,B:0,Q:0,P:0}, b:{R:0,N:0,B:0,Q:0,P:0} };
    for (let y=0;y<8;y++) for (let x=0;x<8;x++){
      const p = game.at(x,y); if(!p) continue;
      const side = p.c; const t = p.t;
      if (t==='R') counts[side].R++;
      else if (t==='N') counts[side].N++;
      else if (t==='B' || t==='S') counts[side].B++;
      else if (t==='Q' || t==='M') counts[side].Q++;
      else if (t==='P') counts[side].P++;
    }
    return counts;
  }
  function detectCountingTarget(game){
    const c = materialKey(game);
    const onlyRNBQlessP = (side)=> c[side].P===0; // quick coarse filter

    // Example rules (expand these for full Khmer count rules):
    // If rooks only remain (no Q/B/N/P), target 8 (two rooks total) or 16 (one rook total)
    const onlyRooks = (side)=> c[side].Q===0 && c[side].B===0 && c[side].N===0 && c[side].P===0;
    if (onlyRooks('w') && onlyRooks('b')){
      const totalR = c.w.R + c.b.R;
      if (totalR >= 2) return 8;
      if (totalR === 1) return 16;
    }

    // If no rooks and no queens but minor pieces exist → sample target 22
    const noRQ = (side)=> c[side].R===0 && c[side].Q===0;
    if (noRQ('w') && noRQ('b') && onlyRNBQlessP('w') && onlyRNBQlessP('b')) {
      return 22;
    }

    return null;
  }
  function maybeSetCountingTarget(){
    const tgt = detectCountingTarget(game);
    if (tgt && window.CountUI?.setTarget){
      window.CountUI.setTarget(tgt);
      toast(`រាប់ស្មើគោលដៅ: ${tgt}`);
      // reveal tools row if you are using a flash/overlay
      const tools = document.getElementById('flashTools');
      if (tools) tools.style.display = 'flex';
    }
  }

  /* ====== Analysis Arrow (④) ====== */
  let arrowEl = null;
  function clearArrow(){ if (arrowEl){ arrowEl.remove(); arrowEl=null; } }
  function boardRect(){ return elBoard.getBoundingClientRect(); }
  function drawArrow(from,to){
    clearArrow();
    const r = boardRect(); const cw = r.width/8, ch = r.height/8;
    const x1=(from.x+.5)*cw, y1=(from.y+.5)*ch;
    const x2=(to.x+.5)*cw,   y2=(to.y+.5)*ch;
    arrowEl = document.createElement('div'); arrowEl.className='best-arrow';
    arrowEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">
      <defs><marker id="ah" markerWidth="10" markerHeight="10" refX="9" refY="4" orient="auto">
        <path d="M0,0 L0,8 L10,4 z" fill="rgba(0,128,0,.95)"/>
      </marker></defs>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="rgba(0,128,0,.95)" stroke-width="6" marker-end="url(#ah)" />
    </svg>`;
    elBoard.appendChild(arrowEl);
  }

  /* ===================== RENDER =================================== */
  function renderAndMaybeHintClear(){
    render();
    // clear hint arrow when position changes
    clearArrow();
  }

  /* ====== AI helpers & logic (with fallback + debug) ====== */

  function pickRandomLegalFor(color) {
    const moves = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = game.at(x, y);
        if (!p || p.c !== color) continue;
        const ms = game.legalMoves(x, y);
        for (const m of ms) moves.push({ from:{x,y}, to:{x:m.x,y:m.y} });
      }
    }
    if (!moves.length) return null;
    return moves[(Math.random() * moves.length) | 0];
  }

  async function thinkAndPlay() {
    if (AILock || !isAITurn()) return;
    setBoardBusy(true);

    try {
      const aiOpts = { level: settings.aiLevel, aiColor: settings.aiColor, timeMs: 120 };
      const aiMove = await Promise.resolve(AIPICK(game, aiOpts));
      window.AIDebug?.log('[UI] thinkAndPlay: AI move (raw) =', JSON.stringify(aiMove));

      if (!aiMove || !aiMove.from || !aiMove.to) {
        window.AIDebug?.log('[UI] AI returned null/invalid move → disabling AI (no fallback)');
        alert(
          'AI engine could not find a move.\n' +
          'AI play has been stopped. You can continue playing both sides or press Reset.'
        );
        settings.aiEnabled = false;
        return;
      }

      const from = { x: aiMove.from.x, y: aiMove.from.y };
      const to   = { x: aiMove.to.x,   y: aiMove.to.y   };

      if (
        from.x < 0 || from.x >= SIZE || from.y < 0 || from.y >= SIZE ||
        to.x   < 0 || to.x   >= SIZE || to.y   < 0 || to.y   >= SIZE
      ) {
        window.AIDebug?.log('[UI] AI move outside board → disabling AI');
        alert('AI engine produced an off-board move.\nAI play has been stopped.');
        settings.aiEnabled = false;
        return;
      }

      const prevTurn = game.turn;
      const before   = game.at(to.x, to.y);

      let res = game.move(from, to);

      if (!res || !res.ok) {
        window.AIDebug?.log('[UI] illegal engine move → trying local fallback');
        const fallback = pickRandomLegalFor(settings.aiColor);
        if (!fallback) {
          window.AIDebug?.log('[UI] no fallback move available');
          alert('AI engine and fallback move both failed.\nAI play has been stopped.');
          settings.aiEnabled = false;
          return;
        }

        const before2   = game.at(fallback.to.x, fallback.to.y);
        const prevTurn2 = game.turn;
        const res2      = game.move(fallback.from, fallback.to);
        if (!res2 || !res2.ok) {
          window.AIDebug?.log('[UI] fallback move also illegal → disabling AI');
          alert('AI engine and fallback failed.\nAI stopped.');
          settings.aiEnabled = false;
          return;
        }

        if (beeper.enabled) {
          if (before2) { beeper.capture(); vibrate([20, 40, 30]); }
          else beeper.move();
          if (res2.status?.state === 'check') beeper.check();
        }

        clocks.switchedByMove(prevTurn2);
        renderAndMaybeHintClear();
        saveGameState(game, clocks);

        maybeSetCountingTarget();

        if (res2.status?.state === 'checkmate') {
          alert('អុកស្លាប់! AI ឈ្នះ');
          const tools = document.getElementById('flashTools'); if (tools) tools.style.display='flex';
        } else if (res2.status?.state === 'stalemate') {
          alert('អាប់ — ស្មើជាមួយ AI!');
          const tools = document.getElementById('flashTools'); if (tools) tools.style.display='flex';
        }
        return;
      }

      // Normal engine move OK
      if (beeper.enabled) {
        if (before) { beeper.capture(); vibrate([20, 40, 30]); }
        else beeper.move();
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prevTurn);
      renderAndMaybeHintClear();
      saveGameState(game, clocks);

      maybeSetCountingTarget();

      if (res.status?.state === 'checkmate') {
        alert('អុកស្លាប់! AI ឈ្នះ');
        const tools = document.getElementById('flashTools'); if (tools) tools.style.display='flex';
      } else if (res.status?.state === 'stalemate') {
        alert('អាប់ — ស្មើជាមួយ AI!');
        const tools = document.getElementById('flashTools'); if (tools) tools.style.display='flex';
      }

    } catch (e) {
      console.error('[AI] thinkAndPlay failed', e);
      window.AIDebug?.log('[UI] thinkAndPlay ERROR:', e?.message || String(e));
      alert('AI error occurred. AI play has been stopped.');
      settings.aiEnabled = false;
    } finally {
      setBoardBusy(false);
      window.AIDebug?.log('[UI] thinkAndPlay END turn=', game.turn);
    }
  }

  /* ========== Human move ========== */

  let selected = null;
  let legal = [];

  const clearHints = () => {
    for (const c of cells) c.classList.remove('selected', 'hint-move', 'hint-capture');
  };

  const hintsEnabled = () => settings.hints !== false;

  function showHints(x, y) {
    clearHints();
    const cell = cells[y * SIZE + x];
    cell.classList.add('selected');
    legal = game.legalMoves(x, y);
    if (!hintsEnabled()) return;
    for (const m of legal) {
      const t = game.at(m.x, m.y);
      const c = cells[m.y * SIZE + m.x];
      c.classList.add(t ? 'hint-capture' : 'hint-move');
    }
  }

  function onCellTap(e) {
    const x = +e.currentTarget.dataset.x;
    const y = +e.currentTarget.dataset.y;
    const p = game.at(x, y);

    // Block user moves during AI turn / thinking
    if (isAITurn() || AILock) {
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    // Select piece
    if (p && p.c === game.turn) {
      selected = { x, y };
      showHints(x, y);
      if (beeper.enabled) beeper.select();
      return;
    }

    // No selection yet
    if (!selected) {
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    // Check if target is legal
    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok) {
      selected = null;
      legal = [];
      clearHints();
      if (beeper.enabled) beeper.error();
      vibrate(40);
      return;
    }

    const from   = { ...selected };
    const to     = { x, y };
    const before = game.at(to.x, to.y);
    const prev   = game.turn;
    const res    = game.move(from, to);

    if (res.ok) {
      if (beeper.enabled) {
        if (before) { beeper.capture(); vibrate([20, 40, 30]); }
        else beeper.move();
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prev);
      selected = null;
      legal = [];
      clearHints();
      renderAndMaybeHintClear();
      saveGameState(game, clocks);

      // ① Coach Mode (quick feedback)
      quickCoach(game, prev);

      // ③ auto counting detector
      maybeSetCountingTarget();

      if (res.status?.state === 'checkmate') {
        alert('អុកស្លាប់! ការប្រកួតបានបញ្ចប់');
        const tools = document.getElementById('flashTools'); if (tools) tools.style.display='flex';
      } else if (res.status?.state === 'stalemate') {
        alert('អាប់ — ស្មើគ្នា!');
        const tools = document.getElementById('flashTools'); if (tools) tools.style.display='flex';
      } else {
        // Let AI reply
        thinkAndPlay();
      }
    }
  }

  for (const c of cells) c.addEventListener('click', onCellTap, { passive: true });

  // resume or fresh start
  const saved = loadGameState();
  if (saved) {
    game.board   = saved.board;
    game.turn    = saved.turn;
    game.history = saved.history || [];
    render();
    clocks.start();
  } else {
    render();
    clocks.start();
  }

  // AI first move (if ever AI=White later)
  if (isAITurn()) thinkAndPlay();

  /* -------- controls -------- */

  btnReset?.addEventListener('click', () => {
    game.reset();
    selected = null;
    legal = [];
    clearHints();
    clearGameState();
    clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    renderAndMaybeHintClear();
    clocks.start();
    const tools = document.getElementById('flashTools'); if (tools) tools.style.display='none';
    if (isAITurn()) thinkAndPlay();
  });

  btnUndo?.addEventListener('click', () => {
    if (game.undo()) {
      selected = null;
      legal = [];
      clearHints();
      renderAndMaybeHintClear();
      saveGameState(game, clocks);
    }
  });

  btnPause?.addEventListener('click', () => {
    const wasRunning = clocks.running;
    clocks.pauseResume();
    const i = btnPause?.querySelector('img');
    const s = btnPause?.querySelector('span');
    if (i) i.src = wasRunning ? 'assets/ui/play.png' : 'assets/ui/pause.png';
    if (s) s.textContent = wasRunning ? 'ចាប់ផ្ដើម' : 'ផ្អាក';
  });

  // ④ Hint button
  btnHint?.addEventListener('click', async ()=>{
    if (isAITurn() || AILock) { toast('Wait for AI'); return; }
    try{
      const mv = await (AIPICK)(game, { aiColor: game.turn, timeMs: 200, maxDepth: 4 });
      if (mv?.from && mv?.to) drawArrow(mv.from, mv.to);
    }catch{ toast('Hint failed'); }
  });
  elBoard.addEventListener('click', clearArrow);

  // ② Result tools (FEN/PGN/Share) — these also work with your flash overlay
  document.addEventListener('click', (e)=>{
    const id = e.target?.id;
    if (id === 'flashCopyFen'){
      try{ copyText(game.toFEN?.() || game.fen?.() || ''); }catch{}
    }
    if (id === 'flashCopyPgn'){
      try{
        // if you later add a PGN generator, swap here:
        const pgn = game.pgn?.() || '(No PGN yet)';
        copyText(pgn);
      }catch{}
    }
    if (id === 'flashShare'){
      try{
        const title = 'Khmer Chess Result';
        const text  = (game.pgn?.() || 'My game') + '\n' + (game.toFEN?.() || game.fen?.() || '');
        if (navigator.share) navigator.share({ title, text });
        else copyText(text);
      }catch{}
    }
  });

  window.addEventListener('beforeunload', () => saveGameState(game, clocks));

  return game;
}
