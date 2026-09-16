// js/ai.js — thin adapter over the local search running in js/ai-worker.js.
//
// Same public contract as before: chooseAIMove(game, opts) / pickAIMove
// resolve to `{from:{x,y}, to:{x,y}}` (or null if no legal move exists).
// The actual search never touches the network — js/ai-engine.js runs
// entirely inside a Web Worker so the board UI never blocks, however deep
// the search goes.

import { LEVELS, DEFAULT_LEVEL } from './ai-engine.js';
import { showToast } from './toast.js';

const LS_KEY = 'kc_settings_v1';

function readSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}

function debugEnabled() {
  return !!readSettings().aiDebug;
}

// ===== Debug panel (reused scaffolding: same anchor point, same
// window.AIDebug interface — now shows search stats instead of an HTTP
// retry trace) =====

function ensureDebugPanel() {
  if (!debugEnabled()) return null;

  let cardBelow = document.getElementById('chatCard');
  if (!cardBelow) {
    const all = Array.from(document.querySelectorAll('*'));
    cardBelow = all.find(el =>
      /សន្ទនា|Chat/i.test(el.textContent || '') &&
      el.getBoundingClientRect().height > 40
    );
  }

  let host = document.getElementById('aiDebugPanelHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'aiDebugPanelHost';

    const panel = document.createElement('div');
    panel.id = 'aiDebugPanel';
    panel.style.cssText = `
      margin:10px 12px 14px; border:1px dashed #b7c3d7; border-radius:10px;
      background:#f7faff; overflow:hidden; font-family:ui-sans-serif,system-ui;
    `;

    const bar = document.createElement('div');
    bar.style.cssText = `
      display:flex; align-items:center; justify-content:space-between;
      padding:8px 10px; background:#e9f1ff;
    `;
    bar.innerHTML =
      `<strong style="font-weight:700;color:#17355d">AI Debug</strong>
       <div>
         <button id="aiDbgCopy" style="margin-right:6px;padding:4px 8px;border:1px solid #a9bfd9;border-radius:6px;background:#fff">Copy</button>
         <button id="aiDbgToggle" style="padding:4px 8px;border:1px solid #a9bfd9;border-radius:6px;background:#fff">Hide</button>
       </div>`;

    const pre = document.createElement('pre');
    pre.id = 'aiDebugLog';
    pre.style.cssText = `
      margin:0; padding:10px; max-height:220px; overflow:auto; white-space:pre-wrap;
      font-size:12px; line-height:1.35; color:#243b5a;
      background:#fbfdff;
    `;
    pre.textContent = '…';

    const status = document.createElement('div');
    status.id = 'aiStatusLine';
    status.style.cssText = `
      padding:6px 10px; font-size:13px; background:#fffbe7; color:#444;
      border-top:1px solid #d9d9d9;
      font-family:ui-sans-serif,system-ui;
    `;
    status.textContent = 'AI idle.';

    panel.appendChild(bar);
    panel.appendChild(pre);
    panel.appendChild(status);
    host.appendChild(panel);

    if (cardBelow && cardBelow.parentElement) {
      cardBelow.parentElement.insertBefore(host, cardBelow.nextSibling);
    } else {
      document.body.appendChild(host);
    }

    document.getElementById('aiDbgToggle').onclick = () => {
      const preEl = document.getElementById('aiDebugLog');
      const hidden = preEl.style.display === 'none';
      preEl.style.display = hidden ? 'block' : 'none';
      document.getElementById('aiDbgToggle').textContent = hidden ? 'Hide' : 'Show';
    };

    document.getElementById('aiDbgCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(
          document.getElementById('aiDebugLog').textContent
        );
        showToast('AI debug log copied', 'success');
      } catch {
        showToast('Copy failed', 'error');
      }
    };
  }

  host.style.display = '';
  return document.getElementById('aiDebugLog');
}

function updateStatus(text, color) {
  if (!debugEnabled()) return;
  let el = document.getElementById('aiStatusLine');
  if (!el) { ensureDebugPanel(); el = document.getElementById('aiStatusLine'); }
  if (el) {
    el.textContent = text;
    el.style.color = color || '#222';
  }
}

function logDbg(...args) {
  const pre = ensureDebugPanel();
  if (!pre) return;
  const ts = new Date().toLocaleTimeString();
  pre.textContent += `\n[${ts}] ${args.join(' ')}`;
  pre.scrollTop = pre.scrollHeight;
}

function resetDbg() {
  const pre = ensureDebugPanel();
  if (pre) pre.textContent = 'Local Makruk engine (Web Worker)\n---';
}

window.AIDebug = { log: logDbg, reset: resetDbg, status: updateStatus };

// ===== Thinking indicator (always shown while the worker is searching,
// independent of the debug flag) =====
//
// Pure presentation layer over chooseAIMove()'s own start/resolve — this
// is the ONLY thing this block does. It never touches game.js, ai-engine.js,
// ai-worker.js, or ui.js's move-execution/turn logic; it doesn't know a
// legal move from an illegal one and never calls game.move() or anything
// resembling it. The board's own pieces are never touched here — the badge
// is a floating overlay on top of #board (position:relative already, see
// styles.css), sized and positioned so it never intercepts touches
// (pointer-events:none) and never grows to cover the board.
//
// Three visual stages, all driven from the two existing call sites below
// (chooseAIMove's start and its `finally`) — no parallel state machine:
//   1. "Thinking" — shown the instant the search starts.
//   2. An abstract pulsing ring around the badge while it searches. This is
//      NOT tied to any real candidate squares/moves — the worker's search
//      is opaque until it resolves (no intermediate candidate-move channel
//      exists, and this file deliberately doesn't add one to the engine
//      just for this), so per the brief this stays a purely decorative,
//      non-informational animation, never a fake analysis of the position.
//   3. "Best move found" — a brief label swap once the search has actually
//      resolved. Fully non-blocking: chooseAIMove() below returns the move
//      to ui.js immediately, on its original timing; this flash runs async
//      alongside (never inside) that return, so it can't delay the real
//      move for even one frame.
const THINKING_HOLD_MS = 280; // Stage 3 "Best move found" hold before fade-out

function ensureThinkingUI() {
  let el = document.getElementById('aiThinkingBadge');
  if (el) return el;

  if (!document.getElementById('aiThinkingStyles')) {
    const style = document.createElement('style');
    style.id = 'aiThinkingStyles';
    style.textContent = `
#aiThinkingBadge{
  /* Above .cell-sliding (z-index:8 in styles.css) so a move animation
     starting during the brief Stage-3 fade-out can never render over it. */
  position:absolute; top:10px; left:50%; z-index:9;
  display:flex; align-items:center; gap:.4rem;
  padding:.38rem .7rem; border-radius:999px;
  background:var(--panel,#fff); color:var(--ink,#1b1f23);
  box-shadow:var(--shadow,0 8px 24px rgba(0,0,0,.12)), 0 0 0 1px rgba(13,45,92,.08);
  font-size:.78rem; font-weight:700; line-height:1.1;
  white-space:nowrap; max-width:88%; overflow:hidden; text-overflow:ellipsis;
  opacity:0; pointer-events:none;
  transform:translate(-50%,-6px);
  transition:opacity .2s ease, transform .2s ease;
}
#aiThinkingBadge.is-visible{ opacity:1; transform:translate(-50%,0); }
#aiThinkingBadge::before{
  content:''; position:absolute; inset:-5px; border-radius:999px;
  box-shadow:0 0 0 0 rgba(13,45,92,.16);
  animation:aiThinkRing 1.7s ease-out infinite;
}
#aiThinkingBadge.is-done::before{ animation:none; box-shadow:none; }
.ai-thinking-emoji{ font-size:.95rem; animation:aiThinkPulse 1.6s ease-in-out infinite; }
#aiThinkingBadge.is-done .ai-thinking-emoji{ animation:none; }
.ai-thinking-label{ color:var(--blue,#0d2d5c); font-weight:800; }
.ai-thinking-dots{ display:inline-flex; gap:2px; margin-inline-start:2px; }
.ai-thinking-dots i{
  width:3px; height:3px; border-radius:50%; background:currentColor;
  opacity:.28; animation:aiThinkDot 1.2s ease-in-out infinite;
}
.ai-thinking-dots i:nth-child(2){ animation-delay:.15s; }
.ai-thinking-dots i:nth-child(3){ animation-delay:.3s; }
@keyframes aiThinkPulse{ 0%,100%{ transform:scale(1); opacity:1; } 50%{ transform:scale(1.15); opacity:.7; } }
@keyframes aiThinkDot{ 0%,80%,100%{ opacity:.28; transform:translateY(0); } 40%{ opacity:1; transform:translateY(-2px); } }
@keyframes aiThinkRing{ 0%{ box-shadow:0 0 0 0 rgba(13,45,92,.16); opacity:1; } 100%{ box-shadow:0 0 0 9px rgba(13,45,92,0); opacity:0; } }
@media (prefers-reduced-motion: reduce){
  .ai-thinking-emoji, .ai-thinking-dots i, #aiThinkingBadge::before{ animation:none !important; }
  .ai-thinking-dots i{ opacity:.6; }
}
`;
    document.head.appendChild(style);
  }

  el = document.createElement('div');
  el.id = 'aiThinkingBadge';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML =
    '<span class="ai-thinking-emoji" aria-hidden="true">🤖</span>' +
    '<span class="ai-thinking-label">AI</span>' +
    '<span class="ai-thinking-status"></span>';

  // Anchored to #board itself (already position:relative in styles.css),
  // not its parent — so top/left below are always relative to the actual
  // board box, regardless of surrounding page layout.
  const board = document.getElementById('board') || document.body;
  board.appendChild(el);
  return el;
}

let thinkingToken = 0;
let thinkingHideTimer = null;

function startThinkingUI() {
  thinkingToken++;
  if (thinkingHideTimer) { clearTimeout(thinkingHideTimer); thinkingHideTimer = null; }
  const el = ensureThinkingUI();
  el.classList.remove('is-done');
  el.querySelector('.ai-thinking-status').innerHTML =
    'Thinking<span class="ai-thinking-dots"><i></i><i></i><i></i></span>';
  // Next frame, so the opacity/transform transition actually runs instead
  // of the element appearing already in its end state.
  requestAnimationFrame(() => el.classList.add('is-visible'));
}

// Never awaited by its caller (see chooseAIMove below) — this only ever
// runs after the real move has already been handed back for execution, and
// never delays that hand-off.
function stopThinkingUI(moveFound) {
  const myToken = ++thinkingToken;
  const el = document.getElementById('aiThinkingBadge');
  if (!el) return;

  if (thinkingHideTimer) { clearTimeout(thinkingHideTimer); thinkingHideTimer = null; }

  if (!moveFound) {
    el.classList.remove('is-visible');
    return;
  }

  el.classList.add('is-done');
  el.querySelector('.ai-thinking-status').textContent = 'Best move found';
  thinkingHideTimer = setTimeout(() => {
    thinkingHideTimer = null;
    if (thinkingToken !== myToken) return; // a newer start/stop happened meanwhile
    el.classList.remove('is-visible');
  }, THINKING_HOLD_MS);
}

// ===== Worker lifecycle =====
//
// A single persistent worker is reused for the whole game (so its
// transposition table keeps paying off move to move). `resetAI()` tears it
// down and spins up a fresh one — called from ui.js on Restart/Undo so a
// search in flight when the board changes underneath it can never resolve
// into a stale move, and no lock or pending promise is left behind.

let worker = null;
let pending = null;   // { requestId, resolve }
let nextRequestId = 1;
let lastStats = null; // stats from the most recently resolved search — see getLastStats()

function ensureWorker() {
  if (worker) return worker;
  // Resolve against this module's own URL (not the document's), so the
  // worker loads correctly regardless of which page imports ai.js.
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { type, requestId, move, stats } = e.data || {};
    if (type !== 'result' || !pending || pending.requestId !== requestId) return;
    const { resolve } = pending;
    pending = null;

    lastStats = stats || null;

    if (stats && stats.error) {
      logDbg('Worker error:', stats.error);
      updateStatus('AI error: ' + stats.error, '#b23');
      resolve(null);
      return;
    }

    logDbg(
      `depth=${stats.depth} nodes=${stats.nodes} time=${stats.timeMs}ms score=${stats.score}`,
      'move=', move ? `${JSON.stringify(move.from)}->${JSON.stringify(move.to)}` : '(none)'
    );
    // AI-vs-AI only: findBestMove() adds these when its caller passes
    // tieBreak/positionHistory (see js/ai-worker.js) — absent (undefined)
    // for every other mode, so this line simply doesn't print there.
    if (stats.rootMoveCount != null) {
      logDbg(
        `  candidates=${stats.rootMoveCount}`,
        stats.tieBreak
          ? `tie-break among ${stats.tieBreak.candidates} equal move(s), chosen position seen ${stats.tieBreak.chosenSeenCount}x before`
          : '(no tie-break — single best move)'
      );
    }
    updateStatus(
      `Last move: depth ${stats.depth}, ${stats.nodes} nodes, ${stats.timeMs}ms, eval ${stats.score}`,
      '#175'
    );
    resolve(move);
  };
  worker.onerror = (e) => {
    logDbg('Worker crashed:', e.message || e);
    if (pending) { const { resolve } = pending; pending = null; resolve(null); }
  };
  return worker;
}

// Discard any in-flight search and start clean. Safe to call any time
// (reset, undo, or if a caller wants to force a fresh worker).
export function resetAI() {
  if (worker) { worker.terminate(); worker = null; }
  if (pending) { const { resolve } = pending; pending = null; resolve(null); }
}

// ===== Public API =====

export async function chooseAIMove(game, opts = {}) {
  resetDbg();

  const level = LEVELS[opts.level] ? opts.level : DEFAULT_LEVEL;
  logDbg(`Thinking… level=${level} turn=${game.turn}` + (opts.aiVsAi ? ' (AI vs AI)' : ''));
  updateStatus(`AI thinking… (level ${level})`, '#a60');
  startThinkingUI();

  // A previous search should already be resolved (ui.js serializes calls
  // via its AILock), but guard against overlap defensively.
  if (pending) { const { resolve } = pending; pending = null; resolve(null); }

  ensureWorker();

  let resolvedMove = null;
  try {
    resolvedMove = await new Promise((resolve) => {
      const requestId = nextRequestId++;
      pending = { requestId, resolve };
      worker.postMessage({
        type: 'search',
        board: game.board,
        turn: game.turn,
        level,
        requestId,
        // AI-vs-AI only (js/ui.js's thinkAndPlay() is the only caller that
        // ever sets these) — every other mode's opts is just {level,
        // aiColor, timeMs} as before, so the worker takes its old,
        // unmodified path for them (see ai-worker.js's `aiVsAi ? … : {}`).
        aiVsAi: !!opts.aiVsAi,
        positionHistory: opts.aiVsAi ? opts.positionHistory : undefined,
        seed: opts.aiVsAi ? opts.debugSeed : undefined,
      });
    });
    return resolvedMove;
  } finally {
    // Not awaited — the move above is already on its way back to ui.js on
    // its original timing; this only starts the (async, non-blocking)
    // Stage 3 flash-and-fade.
    stopThinkingUI(!!resolvedMove);
  }
}

export function setAIDifficulty(level) {
  return {
    mode: 'Local (Web Worker, alpha-beta)',
    level: LEVELS[level] ? level : DEFAULT_LEVEL,
    levels: Object.keys(LEVELS).map(Number),
    params: LEVELS,
  };
}

export const pickAIMove = chooseAIMove;

// Search stats (depth/nodes/timeMs/score) from the most recently resolved
// chooseAIMove() call. Calls are always awaited one at a time (ui.js's
// AILock, and the AI-vs-AI dev loop alike), so reading this right after an
// await reliably reflects that call. Used by js/ai-vs-ai.js's dev log.
export function getLastStats() {
  return lastStats;
}
