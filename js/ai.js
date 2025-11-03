// js/ai.js — Remote-first AI (Render) with spinner, stronger settings, and rich error reporting

// ========= 1) Remote config =========
const REMOTE_AI_URL   = 'https://ouk-ai-backend.onrender.com';
const REMOTE_ENDPOINT = `${REMOTE_AI_URL}/api/ai/move`;
const REMOTE_PING     = `${REMOTE_AI_URL}/ping`;

// Stronger/safer defaults (Render can be slow to wake)
const REMOTE_MOVETIME = 2500;   // ms the engine will think (stronger than before)
const REMOTE_TIMEOUT  = 30000;  // overall network timeout (handles spin-up)
const VARIANT         = 'makruk';

// ========= 2) Spinner =========
function ensureSpinner(){
  let el = document.getElementById('aiSpinner');
  if (!el){
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
    const board = document.getElementById('board') || document.body;
    (board.parentElement || board).appendChild(el);
  }
  return el;
}
function setSpinner(on){ ensureSpinner().style.opacity = on ? '1' : '0'; }

// ========= 3) FEN helpers =========
function getFenFromGame(game){
  try{
    if (typeof game.toFEN === 'function') return game.toFEN();
    if (typeof game.fen   === 'function') return game.fen();
    if (typeof game.fen   === 'string')   return game.fen;
    if (game.state?.fen) return game.state.fen;
  }catch{}
  // last resort (legal empty board FEN)
  return '8/8/8/8/8/8/8/8 w - - 0 1';
}

// ========= 4) UCI helpers =========
function uciToMoveObj(uci){
  if (!uci || typeof uci !== 'string' || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97;
  const fy = 8 - (uci.charCodeAt(1) - 48);
  const tx = uci.charCodeAt(2) - 97;
  const ty = 8 - (uci.charCodeAt(3) - 48);
  if (fx|fy|tx|ty & ~7) return null;
  return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
}
function extractMoveFromResponse(json){
  if (!json) return null;
  if (typeof json.uci      === 'string') return uciToMoveObj(json.uci);
  if (typeof json.bestmove === 'string') return uciToMoveObj(json.bestmove);
  if (typeof json.move     === 'string') return uciToMoveObj(json.move);
  if (json.move && json.move.from && json.move.to) return json.move;
  if (typeof json.raw === 'string'){
    const m = json.raw.match(/bestmove\s+([a-h][1-8][a-h][1-8])/i);
    if (m) return uciToMoveObj(m[1]);
  }
  return null;
}

// ========= 5) Network helpers =========
function withTimeout(promise, ms){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error('timeout')), ms);
    promise.then(v=>{ clearTimeout(t); resolve(v); },
                 e=>{ clearTimeout(t); reject(e); });
  });
}
async function pingBackend(){
  try{
    const r = await withTimeout(fetch(REMOTE_PING, { cache:'no-store' }), 6000);
    if (!r.ok) return false;
    const j = await r.json().catch(()=>({}));
    return j && (j.ok === true || j.status === 'ok');
  }catch{ return false; }
}
async function fetchRemoteMove(fen, variant=VARIANT, movetime=REMOTE_MOVETIME){
  const res = await withTimeout(fetch(REMOTE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ fen, variant, movetime })
  }), REMOTE_TIMEOUT);

  // If server returns an error, read the text to show *why*
  if (!res.ok){
    let serverText = '';
    try{ serverText = await res.text(); }catch{}
    const err = new Error(`HTTP ${res.status}`);
    err.serverText = serverText;
    throw err;
  }
  const json = await res.json();
  const mv = extractMoveFromResponse(json);
  if (!mv){
    const err = new Error('No move found in response');
    err.serverText = JSON.stringify(json);
    throw err;
  }
  return mv;
}

// ========= 6) Fallback (random legal) =========
function pickRandomLegal(game){
  const legals=[];
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at?.(x,y);
      if (!p || p.c !== game.turn) continue;
      const ms = game.legalMoves?.(x,y) || [];
      for (const m of ms) legals.push({ from:{x,y}, to:{x:m.x,y:m.y} });
    }
  }
  if (!legals.length) return null;
  return legals[(Math.random()*legals.length)|0];
}

// ========= 7) Public API =========
export async function chooseAIMove(game, opts={}){
  const fen = getFenFromGame(game);
  setSpinner(true);

  try{
    // 1) quick ping (avoid long dead waits)
    const alive = await pingBackend();
    if (!alive) throw new Error('Backend ping failed');

    // 2) ask backend
    const mv = await fetchRemoteMove(fen, VARIANT, REMOTE_MOVETIME);
    setSpinner(false);
    return mv;

  }catch(err){
    setSpinner(false);

    // Show *why* the server refused (once per session)
    try{
      if (!sessionStorage.getItem('ai_remote_warned')){
        const msg = [
          'Remote AI unavailable; using local fallback.',
          err?.message ? `\n\nError: ${err.message}` : '',
          err?.serverText ? `\n\nServer says:\n${err.serverText}` : ''
        ].join('');
        alert(msg);
        sessionStorage.setItem('ai_remote_warned','1');
      }
      console.error('[AI] Remote call failed:', err?.message, err?.serverText || '');
    }catch{}

    // Fallback
    return pickRandomLegal(game);
  }
}

export function setAIDifficulty(){
  return {
    mode:'Remote+Fallback',
    server:REMOTE_AI_URL,
    movetime:REMOTE_MOVETIME,
    timeoutMs:REMOTE_TIMEOUT,
    variant:VARIANT
  };
}
export const pickAIMove = chooseAIMove;
