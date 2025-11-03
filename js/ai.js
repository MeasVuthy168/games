// js/ai.js — Remote-first AI with spinner + adaptive retries + TEMP DEBUG PANEL

const REMOTE_AI_URL   = 'https://ouk-ai-backend.onrender.com';
const REMOTE_ENDPOINT = `${REMOTE_AI_URL}/api/ai/move`;
const REMOTE_PING     = `${REMOTE_AI_URL}/ping`;

// Try these movetimes in order (strong → faster)
const MOVETIME_STEPS = [1100, 900, 700, 500];  // <- your requested values
const HTTP_TIMEOUT   = 45000;                  // <- your requested value
const VARIANT        = 'makruk';

// Safe options for Render free tier
const SAFE_THREADS = 1;
const SAFE_HASH    = 32;


// put near the other consts
const MAKRUK_START_FEN = 'rnbqkbnr/8/pppppppp/8/8/PPPPPPPP/8/RNBQKBNR w - - 0 1';

// ...keep isEmptyFen(fen) as-is...

// ===== Public API =====
export async function chooseAIMove(game, opts = {}){
  resetDbg();
  let fen = getFenFromGame(game);
  logDbg('FEN:', fen);

  // If board looks empty, use Makruk initial layout instead of bailing
  if (isEmptyFen(fen)) {
    logDbg('Empty FEN detected → using Makruk start FEN.');
    fen = MAKRUK_START_FEN;
  }

  setSpinner(true);
  // ...rest of your function stays the same...
}

// ===== TEMP DEBUG PANEL =====
const ENABLE_DEBUG = true;
function ensureDebugPanel() {
  if (!ENABLE_DEBUG) return null;

  let cardBelow; // anchor: the Chat card if available
  // Try by id
  cardBelow = document.getElementById('chatCard');
  // Try a simple contains-text finder
  if (!cardBelow) {
    const allCards = Array.from(document.querySelectorAll('*'));
    cardBelow = allCards.find(el =>
      /សន្ទនា|Chat/i.test(el.textContent || '') && el.getBoundingClientRect().height > 40
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
      `<strong style="font-weight:700;color:#17355d">AI Debug (temp)</strong>
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

    panel.appendChild(bar);
    panel.appendChild(pre);
    host.appendChild(panel);

    // insert under chat card or at end of body
    if (cardBelow && cardBelow.parentElement) {
      cardBelow.parentElement.insertBefore(host, cardBelow.nextSibling);
    } else {
      document.body.appendChild(host);
    }

    // wire buttons
    document.getElementById('aiDbgToggle').onclick = () => {
      const hidden = pre.style.display === 'none';
      pre.style.display = hidden ? 'block' : 'none';
      document.getElementById('aiDbgToggle').textContent = hidden ? 'Hide' : 'Show';
    };
    document.getElementById('aiDbgCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent);
        alert('AI debug log copied');
      } catch {
        alert('Copy failed');
      }
    };
  }
  return document.getElementById('aiDebugLog');
}
function logDbg(...args) {
  if (!ENABLE_DEBUG) return;
  const pre = ensureDebugPanel();
  if (!pre) return;
  const ts = new Date().toLocaleTimeString();
  pre.textContent += `\n[${ts}] ${args.join(' ')}`;
  pre.scrollTop = pre.scrollHeight;
}
function resetDbg() {
  const pre = ensureDebugPanel();
  if (pre) pre.textContent = `Remote: ${REMOTE_AI_URL}\nEndpoint: /api/ai/move\nVariant: ${VARIANT}\n---`;
}
window.AIDebug = { log: logDbg, reset: resetDbg }; // handy from console

// ===== Spinner =====
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

// ===== Helpers =====
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
    const ok = r.ok;
    let j = {};
    try { j = await r.json(); } catch {}
    logDbg(`PING ${ok ? 'OK' : 'HTTP'+r.status} ->`, JSON.stringify(j));
    return ok && (j.ok === true || j.status === 'ok');
  }catch(e){
    logDbg('PING failed:', e.message || e);
    return false;
  }
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

// NEW: detect empty-board FEN (prevents pointless remote calls)
function isEmptyFen(fen){
  return typeof fen === 'string' && /^8\/8\/8\/8\/8\/8\/8\/8\s[wb]\s/.test(fen);
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
  const started = performance.now();
  logDbg(`POST /api/ai/move mt=${movetime} thr=${SAFE_THREADS} hash=${SAFE_HASH}`);
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
    logDbg(`HTTP ${res.status}`, text.slice(0, 200));
    const err = new Error(`HTTP ${res.status}`);
    err.serverText = text;
    throw err;
  }
  let json = {};
  try{ json = JSON.parse(text); }
  catch{
    logDbg('Invalid JSON:', text.slice(0, 200));
    const err = new Error('Invalid JSON from server');
    err.serverText = text;
    throw err;
  }

  // If backend explicitly says no move, treat as hard stop
  if (json && (json.uci === '(none)' || /bestmove\s+\(none\)/i.test(json.raw || '') || json.error === 'no_legal_move')) {
    logDbg('Engine reported no legal move:', JSON.stringify(json).slice(0, 200));
    const err = new Error('No move found in response');
    err.serverText = JSON.stringify(json);
    throw err;
  }

  const mv = extractMoveFromResponse(json);
  if (!mv){
    logDbg('No move in response:', JSON.stringify(json).slice(0, 200));
    const err = new Error('No move found in response');
    err.serverText = JSON.stringify(json);
    throw err;
  }
  logDbg(`OK in ${(performance.now()-started|0)}ms →`, json.uci || json.bestmove || '');
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

// ===== Public API =====
export async function chooseAIMove(game, opts = {}){
  resetDbg();
  const fen = getFenFromGame(game);
  logDbg('FEN:', fen);

  // NEW: don’t call backend if the board is empty/uninitialized
  if (isEmptyFen(fen)) {
    logDbg('Blocked remote call: empty-board FEN. Start a game first.');
    return null;
  }

  setSpinner(true);

  try{
    const alive = await pingBackend();
    if (!alive) { logDbg('Ping not OK → warmup 500ms'); await sleep(500); }

    let lastErr = null;
    for (let i=0; i< MOVETIME_STEPS.length; i++){
      const mt = MOVETIME_STEPS[i];
      try{
        if (i>0) { logDbg('Retry ladder — short pause'); await sleep(350); }
        const mv = await callMoveAPI(fen, mt);
        setSpinner(false);
        logDbg('MOVE SELECTED:', JSON.stringify(mv));
        return mv;
      }catch(err){
        lastErr = err;
        const server = (err.serverText||'').toLowerCase();
        const isTimeout = server.includes('engine timeout');
        const isBusy    = server.includes('noengine') || server.includes('pool') || /503|429/.test(err.message||'');
        const isNone    = server.includes('bestmove (none)') || server.includes('"uci":"(none)"') || server.includes('no_legal_move');

        logDbg('Attempt failed:', err.message, ' | server:', (err.serverText||'').slice(0,120));
        if (isNone) { logDbg('Breaking retry ladder (no legal move).'); break; }
        if (!isTimeout && !isBusy) { logDbg('Breaking retry ladder (hard error)'); break; }
      }
    }

    // all retries failed → fallback
    setSpinner(false);
    logDbg('All retries failed → local fallback');
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
    logDbg('Unexpected error:', e.message || e);
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
