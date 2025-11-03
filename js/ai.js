// js/ai.js — Remote-first AI (Render) with spinner + safe fallback
// Public API kept the same for your app:
//   - chooseAIMove(game, { aiColor: 'w'|'b', countState })
//   - setAIDifficulty(level)  -> returns current config
//   - pickAIMove (alias)

////////////////////////////////////////////////////////////
// 1) Backend URL (Render) — change only if you rename it //
////////////////////////////////////////////////////////////
const REMOTE_AI_URL   = 'https://ouk-ai-backend.onrender.com';
const REMOTE_ENDPOINT = `${REMOTE_AI_URL}/api/ai/move`;
const REMOTE_PING     = `${REMOTE_AI_URL}/ping`;
const REMOTE_TIMEOUT  = 14000;   // ms
const REMOTE_MOVETIME = 1200;    // ms the engine will think
const VARIANT         = 'makruk'; // Khmer chess variant name used by backend

///////////////////////////////////////////////
// 2) Tiny helper: show/hide "AI thinking…"  //
///////////////////////////////////////////////
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
    el.style.boxShadow = '0 0 0 3px rgba(13,45,92,.15) inset, 0 0 0 2px rgba(13,45,92,.15)';
    el.style.background = 'radial-gradient(circle at 35% 35%, #a3ff8f 0 25%, #7fd95e 26% 60%, #5fb941 61% 100%)';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.transition = 'opacity .18s ease';
    // try to place it above the board if present
    const board = document.getElementById('board') || document.body;
    (board.parentElement || board).appendChild(el);
  }
  return el;
}
function setSpinner(on) {
  const el = ensureSpinner();
  el.style.opacity = on ? '1' : '0';
}

///////////////////////////////////////////////
// 3) FEN helpers (get FEN from your engine) //
///////////////////////////////////////////////
function getFenFromGame(game) {
  try {
    if (typeof game.toFEN === 'function') return game.toFEN();
    if (typeof game.fen === 'function')   return game.fen();
    if (typeof game.fen === 'string')     return game.fen;
    if (game.state?.fen)                  return game.state.fen;
  } catch {}
  // As a last resort, return a legal empty-board FEN (engine will reply quickly)
  return '8/8/8/8/8/8/8/8 w - - 0 1';
}

/////////////////////////////////////////////////////////
// 4) UCI parsing (supports multiple backend responses) //
/////////////////////////////////////////////////////////
function uciToMoveObj(uci) {
  // Supports like "e2e4", "b8c6", and ignores promotion for now (not used in Makruk setup)
  if (!uci || typeof uci !== 'string' || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97;                // a->0
  const fy = 8 - (uci.charCodeAt(1) - 48);          // '1'->7, '8'->0
  const tx = uci.charCodeAt(2) - 97;
  const ty = 8 - (uci.charCodeAt(3) - 48);
  if (fx|fy|tx|ty & ~7) return null;
  return { from: { x: fx, y: fy }, to: { x: tx, y: ty } };
}

function extractMoveFromResponse(json) {
  // Accept any of these shapes:
  // { uci: "e2e4" }
  // { move: "e2e4" } or { move: {from:{x,y},to:{x,y}} }
  // { bestmove: "e2e4" }
  // { raw: "info ... bestmove e2e4 ponder ..." }
  if (!json) return null;

  if (typeof json.uci === 'string') return uciToMoveObj(json.uci);
  if (typeof json.bestmove === 'string') return uciToMoveObj(json.bestmove);

  if (typeof json.move === 'string') return uciToMoveObj(json.move);
  if (json.move && json.move.from && json.move.to) return json.move;

  if (typeof json.raw === 'string') {
    const m = json.raw.match(/bestmove\s+([a-h][1-8][a-h][1-8])/i);
    if (m) return uciToMoveObj(m[1]);
  }
  return null;
}

/////////////////////////////////////////////////////
// 5) Remote call (with timeout + helpful fallback) //
/////////////////////////////////////////////////////
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 e => { clearTimeout(t); reject(e); });
  });
}

async function pingBackend() {
  try {
    const r = await withTimeout(fetch(REMOTE_PING, { cache: 'no-store' }), 4000);
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return j && (j.ok === true || j.status === 'ok');
  } catch {
    return false;
  }
}

async function fetchRemoteMove(fen, variant = VARIANT, movetime = REMOTE_MOVETIME) {
  const body = JSON.stringify({ fen, variant, movetime });
  const res  = await withTimeout(fetch(REMOTE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }), REMOTE_TIMEOUT);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const mv = extractMoveFromResponse(json);
  if (!mv) throw new Error('No move found in response');
  return mv;
}

///////////////////////////////////////
// 6) Local emergency fallback (safe) //
///////////////////////////////////////
function pickRandomLegal(game) {
  const legals = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = game.at?.(x, y);
      if (!p || p.c !== game.turn) continue;
      const ms = game.legalMoves?.(x, y) || [];
      for (const m of ms) legals.push({ from: { x, y }, to: { x: m.x, y: m.y } });
    }
  }
  if (!legals.length) return null;
  return legals[(Math.random() * legals.length) | 0];
}

////////////////////////////////////////////////////////////
// 7) Public: chooseAIMove — remote first, then fallback  //
////////////////////////////////////////////////////////////
export async function chooseAIMove(game, opts = {}) {
  const fen = getFenFromGame(game);
  setSpinner(true);

  try {
    // quick ping first (avoid long delay if spun down or unreachable)
    const ok = await pingBackend();
    if (!ok) throw new Error('Backend ping failed');

    const mv = await fetchRemoteMove(fen, VARIANT, REMOTE_MOVETIME);
    setSpinner(false);
    return mv;
  } catch (err) {
    console.error('[AI] Remote failed -> fallback:', err?.message || err);

    // fallback
    const mv = pickRandomLegal(game);
    setSpinner(false);

    if (!mv) {
      // no legal moves (checkmate/stalemate) — let caller handle
      return null;
    }

    // optional: notify once (non-blocking)
    try {
      if (!sessionStorage.getItem('ai_remote_warned')) {
        alert('Remote AI unavailable right now. Using local fallback.');
        sessionStorage.setItem('ai_remote_warned', '1');
      }
    } catch {}

    return mv;
  }
}

////////////////////////////////////////////////////////
// 8) Public: difficulty (kept for compatibility)     //
////////////////////////////////////////////////////////
export function setAIDifficulty(/* level */) {
  return {
    mode: 'Remote+Fallback',
    server: REMOTE_AI_URL,
    movetime: REMOTE_MOVETIME,
    timeoutMs: REMOTE_TIMEOUT
  };
}

export const pickAIMove = chooseAIMove;
