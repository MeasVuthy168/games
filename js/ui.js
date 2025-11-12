// ui.js — Khmer Chess (Play page) — Makruk AI with remote engine + fallback + end flashes + DnD + premove

import { Game, SIZE, COLORS, PT } from './game.js';
import * as AI from './ai.js';

const AIPICK   = AI.pickAIMove || AI.chooseAIMove;

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
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {}
}

function loadGameState() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
  catch { return null; }
}

function clearGameState() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
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
      check:   new Audio('assets/sfx/check.mp3'),
      win:     new Audio('assets/sfx/win.mp3'),
      lose:    new Audio('assets/sfx/lose.mp3')
    };
    for (const k in this.bank) this.bank[k].preload = 'auto';
  }
  play(name, vol = 1) {
    if (!this.enabled) return;
    const src = this.bank[name]; if (!src) return;
    const a = src.cloneNode(true); a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(()=>{});
  }
  move(){ this.play('move', .9); }
  capture(){ this.play('capture', 1.0); }
  select(){ this.play('select', .85); }
  error(){ this.play('error', .9); }
  check(){ this.play('check', 1.0); }
  sfxWin(){ this.play('win', 1.0); }
  sfxLose(){ this.play('lose', 1.0); }
}
const beeper = new AudioBeeper();

function vibrate(pattern){ if (navigator.vibrate) navigator.vibrate(pattern); }

/* ---------------- clocks ---------------- */

class Clocks {
  constructor(update) {
    this.msW = 0; this.msB = 0; this.running = false;
    this.turn = COLORS.WHITE; this.increment = 0; this._t = null; this._u = update;
  }
  init(min, inc, turn = COLORS.WHITE) {
    this.msW = min * 60 * 1000; this.msB = min * 60 * 1000;
    this.increment = inc * 1000; this.turn = turn; this.stop(); this._u(this.msW, this.msB);
  }
  start() {
    if (this.running) return; this.running = true;
    let last = performance.now();
    const tick = () => {
      if (!this.running) return;
      const now = performance.now(); const dt = now - last; last = now;
      if (this.turn === COLORS.WHITE) this.msW = Math.max(0, this.msW - dt);
      else this.msB = Math.max(0, this.msB - dt);
      this._u(this.msW, this.msB);
      if (this.msW <= 0 || this.msB <= 0){ this.stop(); return; }
      this._t = requestAnimationFrame(tick);
    };
    this._t = requestAnimationFrame(tick);
  }
  stop(){ this.running = false; if (this._t) cancelAnimationFrame(this._t); this._t=null; }
  pauseResume(){ this.running ? this.stop() : this.start(); }
  switchedByMove(prev) {
    if (prev === COLORS.WHITE) this.msW += this.increment;
    else this.msB += this.increment;
    this.turn = (prev === COLORS.WHITE) ? COLORS.BLACK : COLORS.WHITE;
    this._u(this.msW, this.msB); this.start();
  }
  format(ms){
    const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000), t = Math.floor((ms%1000)/100);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`;
  }
}

/* ---------------- end-flash overlay ---------------- */

function $(s, r=document){ return r.querySelector(s); }

function showEndFlash(opts){
  const { type='win' } = opts||{};
  const overlay = $('#flashOverlay');
  const title = $('#flashTitle');
  const sub = $('#flashSub');
  const rip = $('#ripWrap');
  const fw = overlay.querySelector('.fireworks');

  // Defaults
  fw.style.display = 'none';
  rip.style.display = 'none';

  if (type === 'win'){
    title.textContent = 'អ្នកឈ្នះ!';
    sub.textContent   = 'អុកស្លាប់ខាងខ្មៅ (AI)! ល្បែងត្រូវបញ្ចប់។';
    fw.style.display  = 'block';
    beeper.sfxWin();
  } else if (type === 'lose'){
    title.textContent = 'អ្នកចាញ់!';
    sub.textContent   = 'អុកស្លាប់ខាងស! ល្បែងត្រូវបញ្ចប់។';
    rip.style.display = 'block';
    beeper.sfxLose();
  } else {
    title.textContent = 'ស្មើ!';
    sub.innerHTML     = '<span class="draw-badge">ល្បែងត្រូវបញ្ចប់</span>';
  }

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden','false');
  $('#appTabbar')?.classList.add('is-hidden');
}
window.showEndFlash = showEndFlash;

// Close/reset buttons
document.addEventListener('click', (e)=>{
  if (e.target?.id === 'flashClose'){
    $('#flashOverlay')?.classList.remove('show');
    $('#flashOverlay')?.setAttribute('aria-hidden','true');
    $('#appTabbar')?.classList.remove('is-hidden');
  }
  if (e.target?.id === 'flashAgain'){
    $('#flashOverlay')?.classList.remove('show');
    $('#flashOverlay')?.setAttribute('aria-hidden','true');
    $('#appTabbar')?.classList.remove('is-hidden');
    // call reset
    $('#btnReset')?.click();
  }
});

/* ---------------- main UI ---------------- */

export function initUI() {
  const elBoard  = document.getElementById('board');
  const elTurn   = document.getElementById('turnLabel');
  const btnReset = document.getElementById('btnReset');
  const btnUndo  = document.getElementById('btnUndo');
  const btnPause = document.getElementById('btnPause');
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

  /* ====== render with animations ====== */
  function render() {
    for (const c of cells) {
      c.innerHTML = '';
      c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture');
    }

    const last = game.history[game.history.length - 1];

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = game.at(x, y);
        if (!p) continue;
        const cell = cells[y * SIZE + x];

        // compute delta for small animation
        let dx = '0px', dy = '0px', klass = 'anim-slide';
        if (last && last.to.x === x && last.to.y === y){
          dx = (last.from.x - last.to.x) * 12 + 'px';
          dy = (last.from.y - last.to.y) * 12 + 'px';
          const isKnight = (p.t === PT.KNIGHT);
          klass = isKnight ? 'anim-hop' : 'anim-slide';
        }

        const s = document.createElement('div');
        s.className = `piece ${p.c === 'w' ? 'white' : 'black'} ${klass}`;
        s.style.setProperty('--dx', dx);
        s.style.setProperty('--dy', dy);
        setPieceBG(s, p);
        cell.appendChild(s);
      }
    }

    if (last) {
      const fromIdx = last.from.y * SIZE + last.from.x;
      const toIdx   = last.to.y   * SIZE + last.to.x;
      cells[fromIdx]?.classList.add('last-from');
      cells[toIdx]?.classList.add('last-to');
      if (last.captured){
        cells[toIdx]?.classList.add('last-capture');
        const rp = document.createElement('div'); rp.className = 'capture-ripple';
        cells[toIdx]?.appendChild(rp); setTimeout(()=> rp.remove(), 350);
      }
    }

    if (elTurn) elTurn.textContent = khTurnLabel();
    applyTurnClass();
  }

  /* ====== AI helpers & logic (with fallback + debug) ====== */

  function pickRandomLegalFor(color) {
    const moves = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const p = game.at(x, y);
      if (!p || p.c !== color) continue;
      const ms = game.legalMoves(x, y);
      for (const m of ms) moves.push({ from:{x,y}, to:{x:m.x,y:m.y} });
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
        window.AIDebug?.log('[UI] AI returned null → disabling AI');
        alert('AI error. AI play has been stopped.'); settings.aiEnabled = false; return;
      }

      const from = { x: aiMove.from.x, y: aiMove.from.y };
      const to   = { x: aiMove.to.x,   y: aiMove.to.y   };

      const prevTurn = game.turn;
      const before   = game.at(to.x, to.y);
      let res = game.move(from, to);

      if (!res || !res.ok) {
        window.AIDebug?.log('[UI] engine move illegal → fallback random');
        const fb = pickRandomLegalFor(settings.aiColor);
        if (!fb) { settings.aiEnabled = false; return; }
        const before2 = game.at(fb.to.x, fb.to.y);
        const prev2 = game.turn;
        const res2 = game.move(fb.from, fb.to);
        if (!res2?.ok){ settings.aiEnabled=false; return; }

        if (beeper.enabled){
          before2 ? (beeper.capture(), vibrate([20,40,30])) : beeper.move();
          if (res2.status?.state === 'check') beeper.check();
        }

        clocks.switchedByMove(prev2);
        render(); saveGameState(game, clocks);

        if (res2.status?.state === 'checkmate'){
          // AI delivered mate → player loses
          showEndFlash({ type:'lose' });
        } else if (res2.status?.state === 'stalemate'){
          showEndFlash({ type:'draw' });
        }
        return;
      }

      if (beeper.enabled){
        before ? (beeper.capture(), vibrate([20,40,30])) : beeper.move();
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prevTurn);
      render(); saveGameState(game, clocks);

      if (res.status?.state === 'checkmate'){
        showEndFlash({ type:'lose' });
      } else if (res.status?.state === 'stalemate'){
        showEndFlash({ type:'draw' });
      }

    } catch (e) {
      console.error('[AI] thinkAndPlay failed', e);
      window.AIDebug?.log('[UI] thinkAndPlay ERROR:', e?.message || String(e));
      alert('AI error. AI play has been stopped.');
      settings.aiEnabled = false;
    } finally {
      setBoardBusy(false);
      window.AIDebug?.log('[UI] thinkAndPlay END turn=', game.turn);
    }
  }

  /* ========== Human move + Tap-to-move ========== */

  let selected = null;
  let legal = [];
  let premove = null; // queued move while AI thinks

  const clearHints = () => {
    for (const c of cells) c.classList.remove('selected','hint-move','hint-capture');
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

    // If AI turn → allow premove selection
    if (isAITurn() || AILock) {
      if (p && p.c === COLORS.WHITE){
        if (!selected){ selected = {x,y}; showHints(x,y); beeper.select(); return; }
        const ok = legal.some(m => m.x===x && m.y===y);
        if (ok){
          premove = { from:{...selected}, to:{x,y} };
          cells[selected.y*SIZE+selected.x].classList.add('last-from');
          cells[y*SIZE+x].classList.add('last-to');
          beeper.select();
        } else { beeper.error(); }
      } else { beeper.error(); }
      vibrate(30);
      return;
    }

    // Select piece
    if (p && p.c === game.turn) {
      selected = { x, y }; showHints(x, y);
      if (beeper.enabled) beeper.select(); return;
    }

    // No selection yet
    if (!selected) { if (beeper.enabled) beeper.error(); vibrate(40); return; }

    // Check if target is legal
    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok) {
      selected = null; legal = []; clearHints();
      if (beeper.enabled) beeper.error(); vibrate(40); return;
    }

    const from   = { ...selected };
    const to     = { x, y };
    const before = game.at(to.x, to.y);
    const prev   = game.turn;
    const res    = game.move(from, to);

    if (res.ok) {
      if (beeper.enabled) {
        if (before) { beeper.capture(); vibrate([20, 40, 30]); }
        else { beeper.move(); }
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prev);
      selected = null; legal = []; clearHints();
      render(); saveGameState(game, clocks);

      if (res.status?.state === 'checkmate') {
        // Player delivered mate vs AI black
        showEndFlash({ type:'win' });
      } else if (res.status?.state === 'stalemate') {
        showEndFlash({ type:'draw' });
      } else {
        thinkAndPlay();
      }
    }
  }

  for (const c of cells) {
    c.addEventListener('click', onCellTap, { passive: true });
  }

  /* ========== Drag & Drop (pointer) ========== */

  function boardRect(){ return elBoard.getBoundingClientRect(); }
  function cellAtXY(px, py){
    const r = boardRect(); if (!r.width || !r.height) return null;
    const cw = r.width / 8, ch = r.height / 8;
    const x = Math.min(7, Math.max(0, Math.floor((px - r.left) / cw)));
    const y = Math.min(7, Math.max(0, Math.floor((py - r.top)  / ch)));
    if (px < r.left || py < r.top || px > r.right || py > r.bottom) return null;
    return { x, y, idx: y*SIZE + x, el: cells[y*SIZE + x] };
  }

  let dragging = null;        // { from:{x,y}, ghost:El, legal:[{x,y,el}] }
  let dragPointerId = null;

  function legalForSquare(x, y){
    const ls = game.legalMoves(x,y) || [];
    return ls.map(m => ({ x:m.x, y:m.y, el: cells[m.y*SIZE+m.x] }));
  }

  function startDrag(x, y, clientX, clientY, pointerId){
    const p = game.at(x, y); if (!p) return;
    if (p.c !== game.turn) return;
    dragging = { from:{x,y}, legal: legalForSquare(x,y) };
    dragPointerId = pointerId;

    const g = document.createElement('div');
    g.className = 'drag-ghost';
    const tmp = document.createElement('div'); tmp.style.display='none'; setPieceBG(tmp, p);
    g.style.backgroundImage = tmp.style.backgroundImage;
    document.body.appendChild(g);
    dragging.ghost = g;
    moveGhost(clientX, clientY);

    cells[y*SIZE+x].classList.add('selected');
    if (hintsEnabled()) for (const t of dragging.legal) t.el.classList.add('drag-legal');
  }

  function moveGhost(px, py){
    if (!dragging?.ghost) return;
    dragging.ghost.style.left = px+'px';
    dragging.ghost.style.top  = py+'px';
    for (const c of cells) c.classList.remove('drag-target');
    const dest = cellAtXY(px, py);
    if (dest && dragging.legal.some(m => m.x===dest.x && m.y===dest.y)){
      dest.el.classList.add('drag-target');
    }
  }

  function endDrag(px, py){
    const d = dragging; dragging = null;
    for (const c of cells) c.classList.remove('drag-target','drag-legal','selected');
    if (d?.ghost){ d.ghost.remove(); }
    if (!d) return;

    const dest = cellAtXY(px, py);
    if (!dest){ beeper.error(); vibrate(40); return; }
    const ok = d.legal.some(m => m.x===dest.x && m.y===dest.y);
    if (!ok){ beeper.error(); vibrate(40); return; }

    const before = game.at(dest.x, dest.y);
    const prev   = game.turn;
    const res    = game.move(d.from, {x:dest.x, y:dest.y});
    if (!res?.ok){ beeper.error(); vibrate(40); return; }

    if (beeper.enabled){
      before ? (beeper.capture(), vibrate([20,40,30])) : beeper.move();
      if (res.status?.state === 'check') beeper.check();
    }
    clocks.switchedByMove(prev);
    render(); saveGameState(game, clocks);

    if (res.status?.state === 'checkmate'){ showEndFlash({type:'win'}); }
    else if (res.status?.state === 'stalemate'){ showEndFlash({type:'draw'}); }
    else { thinkAndPlay(); }
  }

  function onCellPointerDown(e){
    if (isAITurn() || AILock) { beeper.error(); vibrate(40); return; }
    const x = +e.currentTarget.dataset.x, y = +e.currentTarget.dataset.y;
    const p = game.at(x,y);
    if (!p || p.c !== game.turn){ if (beeper.enabled) beeper.error(); return; }
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    startDrag(x,y, e.clientX, e.clientY, e.pointerId);
  }
  function onCellPointerMove(e){ if (dragging && e.pointerId===dragPointerId){ moveGhost(e.clientX, e.clientY); } }
  function onCellPointerUp(e){ if (e.pointerId===dragPointerId){ endDrag(e.clientX, e.clientY); dragPointerId=null; } }

  for (const c of cells){
    c.addEventListener('pointerdown', onCellPointerDown, { passive:false });
    c.addEventListener('pointermove', onCellPointerMove, { passive:true });
    c.addEventListener('pointerup',   onCellPointerUp,   { passive:true });
    c.addEventListener('pointercancel', onCellPointerUp, { passive:true });
  }

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
    selected = null; legal = []; premove = null; clearHints(); clearGameState();
    clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    if (isAITurn()) thinkAndPlay();
  });

  btnUndo?.addEventListener('click', () => {
    if (game.undo()) {
      selected = null; legal = []; clearHints(); render(); saveGameState(game, clocks);
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

  window.addEventListener('beforeunload', () => saveGameState(game, clocks));

  return game;
}

/* ---------------- service worker (unchanged) ---------------- */

const SW_URL = './sw.js';
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: './', updateViaCache: 'none' });
      reg.update();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing; if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage({ type: 'SKIP_WAITING' });
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.__reloadedForSW) { window.__reloadedForSW = true; location.reload(); }
      });
      setInterval(() => reg.update(), 60 * 1000);
    } catch (err) {
      console.log('SW registration failed:', err);
    }
  });
}
