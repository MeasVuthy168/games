// js/ai.js — Remote-first AI (Render) with stronger search + spinner
// Public API (unchanged):
//   - chooseAIMove(game, { aiColor: 'w'|'b', countState })
//   - setAIDifficulty(level)
//   - pickAIMove (alias)

//////////////////////// Render backend ////////////////////////
const REMOTE_AI_URL   = 'https://ouk-ai-backend.onrender.com';
const REMOTE_ENDPOINT = `${REMOTE_AI_URL}/api/ai/move`;
const REMOTE_PING     = `${REMOTE_AI_URL}/ping`;

// Networking & defaults
const REMOTE_TIMEOUT  = 20000; // allow cold-start
const VARIANT         = 'makruk';

// Strength knobs (safe on Render free; increase if you upgrade)
const THREADS  = 1;    // 1 CPU on free tier
const HASH_MB  = 96;   // 64–128 MB is safe on free tier

// Phase-based movetime (ms): more time in endgames for deeper search
function phaseMovetime(game) {
  try {
    let pieces = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (game.at?.(x,y)) pieces++;
    if (pieces > 22) return 2400;   // opening
    if (pieces > 14) return 3300;   // middlegame
    return 4300;                    // endgame
  } catch { return 3000; }
}

//////////////////////////// Spinner ////////////////////////////
function ensureSpinner() {
  let el = document.getElementById('aiSpinner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aiSpinner';
    el.setAttribute('role','status');
    el.setAttribute('aria-label','AI is thinking');
    el.style.cssText = `
      position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
      width:34px; height:34px; border-radius:50%;
      background: conic-gradient(#0d2d5c 0 25%, transparent 25% 100%);
      mask: radial-gradient(circle 12px at 50% 50%, transparent 98%, #000 100%);
      opacity:0; pointer-events:none; transition:opacity .16s ease;
      animation: kcSpin 0.9s linear infinite;
      filter: drop-shadow(0 2px 6px rgba(13,45,92,.25));
      z-index: 30;
    `;
    const board = document.getElementById('board');
    (board?.parentElement || document.body).appendChild(el);

    const key = document.createElement('style');
    key.textContent = `
      @keyframes kcSpin { from{transform:translate(-50%,-50%) rotate(0deg)}
                           to  {transform:translate(-50%,-50%) rotate(360deg)} }`;
    document.head.appendChild(key);
  }
  return el;
}
function setSpinner(on) { ensureSpinner().style.opacity = on ? '1' : '0'; }

//////////////////////////// FEN ////////////////////////////////
function getFenFromGame(game) {
  try {
    if (typeof game.toFEN === 'function') return game.toFEN();
    if (typeof game.fen === 'function')   return game.fen();
    if (typeof game.fen === 'string')     return game.fen;
    if (game.state?.fen)                  return game.state.fen;
  } catch {}
  return '8/8/8/8/8/8/8/8 w - - 0 1';
}

//////////////////////////// UCI helpers ////////////////////////
function uciToMoveObj(uci) {
  if (!uci || typeof uci !== 'string' || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97;
  const fy = 8 - (uci.charCodeAt(1) - 48);
  const tx = uci.charCodeAt(2) - 97;
  const ty = 8 - (uci.charCodeAt(3) - 48);
  if (fx|fy|tx|ty & ~7) return null;
  return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
}
function extractMoveFromResponse(json) {
  if (!json) return null;
  if (typeof json.uci === 'string')      return uciToMoveObj(json.uci);
  if (typeof json.bestmove === 'string')  return uciToMoveObj(json.bestmove);
  if (typeof json.move === 'string')      return uciToMoveObj(json.move);
  if (json.move && json.move.from && json.move.to) return json.move;
  if (typeof json.raw === 'string') {
    const m = json.raw.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrnb]?)/i);
    if (m) return uciToMoveObj(m[1]);
  }
  return null;
}

//////////////////////////// Network utils //////////////////////
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(()=>reject(new Error('timeout')), ms);
    p.then(v=>{clearTimeout(t);resolve(v);}, e=>{clearTimeout(t);reject(e);});
  });
}
async function pingBackend() {
  try {
    const r = await withTimeout(fetch(REMOTE_PING, { cache:'no-store' }), 5000);
    if (!r.ok) return false;
    const j = await r.json().catch(()=> ({}));
    return (j?.ok === true) || (j?.status === 'ok');
  } catch { return false; }
}

async function fetchRemoteMove(fen, game) {
  const movetime = phaseMovetime(game);
  const body = {
    fen,
    variant: 'makruk',
    movetime,
    threads: THREADS,
    hash: HASH_MB
    // If you prefer fixed-depth instead of time, add: depth: 18
  };

  const res = await withTimeout(fetch(REMOTE_ENDPOINT, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  }), REMOTE_TIMEOUT);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const mv = extractMoveFromResponse(j);
  if (!mv) throw new Error('Remote returned no move');
  return mv;
}

//////////////////////////// Fallback ///////////////////////////
function pickRandomLegal(game) {
  const moves = [];
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at?.(x,y);
      if (!p || p.c !== game.turn) continue;
      const ms = game.legalMoves?.(x,y) || [];
      for (const m of ms) moves.push({ from:{x,y}, to:{x:m.x,y:m.y} });
    }
  }
  if (!moves.length) return null;
  return moves[(Math.random()*moves.length)|0];
}

//////////////////////////// Public API /////////////////////////
export async function chooseAIMove(game, opts = {}) {
  const fen = getFenFromGame(game);
  setSpinner(true);

  try {
    const alive = await pingBackend();
    if (!alive) throw new Error('backend not alive');
    const mv = await fetchRemoteMove(fen, game);
    setSpinner(false);
    return mv;
  } catch (e) {
    console.warn('[AI] Remote failure → fallback:', e?.message || e);
    const mv = pickRandomLegal(game);
    setSpinner(false);
    if (!mv) return null;
    try {
      if (!sessionStorage.getItem('ai_remote_warned')) {
        alert('Remote AI unavailable; using local fallback.');
        sessionStorage.setItem('ai_remote_warned','1');
      }
    } catch {}
    return mv;
  }
}

export function setAIDifficulty(/* level */){
  return {
    mode: 'Remote (phase movetime) + Fallback',
    server: REMOTE_AI_URL,
    threads: THREADS,
    hashMB: HASH_MB,
    timeoutMs: REMOTE_TIMEOUT
  };
}
export const pickAIMove = chooseAIMove;
