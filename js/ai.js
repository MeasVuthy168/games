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

// ===== Thinking spinner (unchanged behavior — always shown while the
// worker is searching, independent of the debug flag) =====

function ensureSpinner() {
  let el = document.getElementById('aiSpinner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aiSpinner';
    el.style.position = 'absolute';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.top = 'calc(50% - 12px)';
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.borderRadius = '50%';
    el.style.boxShadow =
      '0 0 0 3px rgba(13,45,92,.15) inset, 0 0 0 2px rgba(13,45,92,.15)';
    el.style.background =
      'radial-gradient(circle at 35% 35%, #a3ff8f 0 25%, #7fd95e 26% 60%, #5fb941 61% 100%)';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.transition = 'opacity .18s ease';
    const board = document.getElementById('board') || document.body;
    (board.parentElement || board).appendChild(el);
  }
  return el;
}

function setSpinner(on) {
  ensureSpinner().style.opacity = on ? '1' : '0';
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
  logDbg(`Thinking… level=${level} turn=${game.turn}`);
  updateStatus(`AI thinking… (level ${level})`, '#a60');
  setSpinner(true);

  // A previous search should already be resolved (ui.js serializes calls
  // via its AILock), but guard against overlap defensively.
  if (pending) { const { resolve } = pending; pending = null; resolve(null); }

  ensureWorker();

  try {
    const move = await new Promise((resolve) => {
      const requestId = nextRequestId++;
      pending = { requestId, resolve };
      worker.postMessage({
        type: 'search',
        board: game.board,
        turn: game.turn,
        level,
        requestId,
      });
    });
    return move;
  } finally {
    setSpinner(false);
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
