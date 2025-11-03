// js/ai.js — Remote-first AI with spinner + adaptive retries on "engine timeout"

const REMOTE_AI_URL   = 'https://ouk-ai-backend.onrender.com';
const REMOTE_ENDPOINT = `${REMOTE_AI_URL}/api/ai/move`;
const REMOTE_PING     = `${REMOTE_AI_URL}/ping`;

// Try these movetimes in order (strong → faster)
const MOVETIME_STEPS = [1100, 900, 700, 500];  // updated
const HTTP_TIMEOUT   = 45000;                  // updated overall network timeout
const VARIANT        = 'makruk';

// >>> SAFE ENGINE OPTIONS FOR RENDER FREE <<<
const SAFE_THREADS = 1;  // keep CPU usage low
const SAFE_HASH    = 32; // small transposition table to avoid OOM

// ---------- spinner ----------
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

// ---------- helpers ----------
function withTimeout(promise, ms){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error('timeout')), ms);
    promise.then(v=>{ clearTimeout(t); resolve(v); },
                 e=>{ clearTimeout(t); reject(e); });
  });
}
async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function pingBackend(){
  try{
    const r = await withTimeout(fetch(REMOTE_PING, { cache:'no-store' }), 6000);
    if (!r.ok) return false;
    const j = await r.json().catch(()=>({}));
    return j && (j.ok === true || j.status === 'ok');
  }catch{ return false; }
}

function getFenFromGame(game){
  try{
    if (typeof game.toFEN === 'function') return game.toFEN();
    if (typeof game.fen   === 'function') return game.fen();
    if (typeof game.fen   === 'string')   return game.fen;
    if (game.state?.fen)  return game.state.fen;
  }catch{}
  return '8/8/8/8/8/8/8/8 w - - 0 1';
}

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

async function callMoveAPI(fen, movetime){
  // include safe threads/hash so server keeps resource usage low
  const res = await withTimeout(fetch(REMOTE_ENDPOINT, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      fen,
      variant: VARIANT,
      movetime,
      threads: SAFE_THREADS,
      hash: SAFE_HASH
    })
  }), HTTP_TIMEOUT);

  const text = await res.text();
  if (!res.ok){
    const err = new Error(`HTTP ${res.status}`);
    err.serverText = text;
    throw err;
  }
  let json = {};
  try{ json = JSON.parse(text); }catch{
    const err = new Error('Invalid JSON from server');
    err.serverText = text;
    throw err;
  }
  const mv = extractMoveFromResponse(json);
  if (!mv){
    const err = new Error('No move found in response');
    err.serverText = JSON.stringify(json);
    throw err;
  }
  return mv;
}

function pickRandomLegal(game){
  const legals=[];
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const p = game.at?.(x,y);
      if (!p || p.c !== game.turn) continue;
      const ms = game.legalMoves?.(x,y) || [];
      for (const m of ms) legals.push({ from:{x,y}, to:{x:m.x,y:m.y} });
    }
  }
  return legals.length ? legals[(Math.random()*legals.length)|0] : null;
}

// ---------- Public API ----------
export async function chooseAIMove(game, opts = {}){
  const fen = getFenFromGame(game);
  setSpinner(true);

  try{
    // wake the service if needed
    const alive = await pingBackend();
    if (!alive) await sleep(500);

    // adaptive retries on "engine timeout"
    let lastErr = null;
    for (let i=0; i< MOVETIME_STEPS.length; i++){
      const mt = MOVETIME_STEPS[i];
      try{
        if (i>0) await sleep(350); // give the engine breath if it just failed
        const mv = await callMoveAPI(fen, mt);
        setSpinner(false);
        return mv;
      }catch(err){
        lastErr = err;
        const server = (err.serverText||'').toLowerCase();
        const isTimeout = server.includes('engine timeout');
        const isBusy    = server.includes('noengine') || server.includes('pool') || /503|429/.test(err.message||'');
        if (!isTimeout && !isBusy) break; // real error → stop retry ladder
      }
    }

    // all retries failed → fallback
    setSpinner(false);
    try{
      if (!sessionStorage.getItem('ai_remote_warned')){
        const msg = [
          'Remote AI unavailable; using local fallback.',
          lastErr?.message ? `\n\nError: ${lastErr.message}` : '',
          lastErr?.serverText ? `\n\nServer says:\n${lastErr.serverText}` : ''
        ].join('');
        alert(msg);
        sessionStorage.setItem('ai_remote_warned', '1');
      }
    }catch{}
    return pickRandomLegal(game);

  }catch(e){
    setSpinner(false);
    console.error('[AI] unexpected error', e);
    return pickRandomLegal(game);
  }
}

export function setAIDifficulty(){
  return {
    mode: 'Remote+Adaptive+Fallback',
    server: REMOTE_AI_URL,
    movetimes: MOVETIME_STEPS.slice(),
    httpTimeout: HTTP_TIMEOUT,
    variant: VARIANT,
    threads: SAFE_THREADS,
    hash: SAFE_HASH
  };
}
export const pickAIMove = chooseAIMove;
```0
