// js/ai-hook.js — Connect UI game to backend engine + spinner + fallback local AI
// Works with your current UI without editing ui.js (uses kc:ready event + window.game)

import { chooseAIMove as localMaster } from './ai.js';

// ---- Config (edit if needed) -----------------------------------------------
// 1) Default backend endpoint (Render live)
const DEFAULT_ENGINE_URL = 'https://ouk-ai-backend.onrender.com/api/ai/move';

// 2) Allow override from localStorage ("kc_engine_url") or window.__ENGINE_URL
function getEngineURL() {
  return (
    window.__ENGINE_URL ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('kc_engine_url')) ||
    DEFAULT_ENGINE_URL
  );
}

// ---- Tiny DOM helpers -------------------------------------------------------
function $(sel, root = document) { return root.querySelector(sel); }

function ensureSpinner() {
  if ($('#aiBusy')) return $('#aiBusy');
  const wrap = document.createElement('div');
  wrap.id = 'aiBusy';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
    <div class="ai-spinner">
      <div class="ai-dot"></div>
      <div class="ai-text">🤖 គិត…</div>
    </div>`;
  document.body.appendChild(wrap);
  return wrap;
}
function showSpinner(show = true) {
  const el = ensureSpinner();
  el.style.display = show ? 'flex' : 'none';
}

// ---- Game helpers -----------------------------------------------------------
function getFEN(game) {
  try {
    if (typeof game.fen === 'function') return game.fen();
    if (typeof game.toFEN === 'function') return game.toFEN();
    if (typeof game.getFEN === 'function') return game.getFEN();
  } catch {}
  return null;
}
function getTurn(game) {
  try { return game.turn || (typeof game.getTurn === 'function' ? game.getTurn() : null); }
  catch { return null; }
}
function listLegals(game) {
  const out = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    try {
      const moves = game.legalMoves?.(x, y) || [];
      for (const m of moves) out.push({ from: { x, y }, to: { x: m.x, y: m.y } });
    } catch {}
  }
  return out;
}
function algebraToXY(fileChar, rankChar) {
  const fx = fileChar.charCodeAt(0) - 97;       // a->0 ... h->7
  const fy = 8 - (rankChar.charCodeAt(0) - 48); // '1'..'8' -> 7..0
  return { x: fx, y: fy };
}
function uciToMove(uci, game) {
  // e2e4, possibly e7e8q (promotion ignored here — Makruk/Khmer doesn’t need it)
  if (!uci || uci.length < 4) return null;
  const from = algebraToXY(uci[0], uci[1]);
  const to   = algebraToXY(uci[2], uci[3]);
  // Validate against legals
  const legals = listLegals(game);
  return legals.find(m => m.from.x === from.x && m.from.y === from.y &&
                          m.to.x   === to.x   && m.to.y   === to.y) || null;
}

// Apply move to the board
function applyMove(game, move) {
  try { return game.move(move.from, move.to); } catch { return null; }
}

// ---- AI loop ----------------------------------------------------------------
let aiBusy = false;
let settings = null;  // from localStorage
const LS_KEY = 'kc_settings_v1';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}

async function thinkWithBackend(fen, variant, movetime) {
  const url = getEngineURL();
  const body = { fen, variant, movetime };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Engine HTTP ${res.status}`);
  return await res.json(); // expect shape like { move: "e2e4", score: ..., nodes: ... }
}

async function runAI(game) {
  if (aiBusy) return;
  if (!settings?.aiEnabled) return;

  const aiColor = settings.aiColor || 'b';
  const turn = getTurn(game);
  if (turn !== aiColor) return;

  const fen = getFEN(game);
  if (!fen) return;

  aiBusy = true;
  showSpinner(true);

  try {
    // Prefer real backend engine
    const { move: uci } = await thinkWithBackend(fen, 'makruk', 1200);
    let mv = uciToMove(uci, game);

    // If backend returns an illegal move (rare), fall back to local AI
    if (!mv) {
      console.log('[ai] backend move invalid or missing, falling back to local master');
      mv = await localMaster(game, { aiColor, countState: null });
    }
    if (mv) applyMove(game, mv);
  } catch (err) {
    console.log('[ai] backend error -> fallback local:', err?.message || err);
    // Fallback to strong local AI
    try {
      const mv = await localMaster(game, { aiColor, countState: null });
      if (mv) applyMove(game, mv);
    } catch (e2) {
      console.log('[ai] local fallback failed:', e2?.message || e2);
    }
  } finally {
    showSpinner(false);
    aiBusy = false;
  }
}

// Trigger conditions to decide when to think:
// 1) On kc:ready (game created)
// 2) On every user move — we’ll poll FEN changes (minimal invasiveness)
function startLoop(game) {
  settings = loadSettings();
  if (!settings.aiEnabled) return;

  // lightweight FEN watcher
  let lastFen = getFEN(game);
  setInterval(() => {
    try {
      const f = getFEN(game);
      if (!f) return;
      if (f !== lastFen) {
        lastFen = f;
        // if it's AI's turn now, think
        runAI(game);
      }
    } catch {}
  }, 250);

  // also think immediately if AI starts
  runAI(game);
}

// Wait for the game from main.js
window.addEventListener('kc:ready', (e) => {
  const game = e?.detail?.game || window.game;
  if (!game) return;
  startLoop(game);
});

// If kc:ready already fired earlier (or game existed), start anyway
if (window.game) startLoop(window.game);

// Ensure spinner node exists at load
ensureSpinner();
showSpinner(false);
