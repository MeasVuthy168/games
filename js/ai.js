// js/ai.js — Remote Makruk AI using move list (no FEN desync), with debug panel

const REMOTE_AI_URL   = 'https://ouk-ai-backend.onrender.com';
const REMOTE_ENDPOINT = `${REMOTE_AI_URL}/api/ai/move`;
const REMOTE_PING     = `${REMOTE_AI_URL}/ping`;

const MOVETIME_STEPS = [1100, 900, 700, 500];
const HTTP_TIMEOUT   = 45000;
const VARIANT        = 'makruk';

const SAFE_THREADS = 1;
const SAFE_HASH    = 32;

// ===== TEMP DEBUG PANEL =====
const ENABLE_DEBUG = true;
function ensureDebugPanel() {
  if (!ENABLE_DEBUG) return null;

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

    const status = document.createElement('div');
    status.id = 'aiStatusLine';
    status.style.cssText = `
      padding:6px 10px; font-size:13px; background:#fffbe7; color:#444;
      border-top:1px solid #d9d9d9;
      font-family:ui-sans-serif,system-ui;
    `;
    status.textContent = 'Initializing AI status...';

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
        alert('AI debug log copied');
      } catch {
        alert('Copy failed');
      }
    };
  }
  return document.getElementById('aiDebugLog');
}

function updateStatus(text, color) {
  let el = document.getElementById('aiStatusLine');
  if (!el) {
    ensureDebugPanel();
    el = document.getElementById('aiStatusLine');
  }
  if (el) {
    el.textContent = text;
    el.style.color = color || '#222';
  }
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
  if (pre) pre.textContent =
    `Remote: ${REMOTE_AI_URL}\nEndpoint: /api/ai/move\nVariant: ${VARIANT}\n---`;
}
window.AIDebug = { log: logDbg, reset: resetDbg, status: updateStatus };

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
    if (ok && (j.ok === true || j.status === 'ok')) {
      updateStatus('✅ Connected to AI server', 'green');
      return true;
    } else {
      updateStatus('⚠️ Using offline (random) AI — ping failed', 'orange');
      return false;
    }
  }catch(e){
    logDbg('PING failed:', e.message || e);
    updateStatus('⚠️ Using offline (random) AI — network error: ' + e.message, 'orange');
    return false;
  }
}

// ---- encode moves from Game.history to UCI ----
function coordToSquare(x, y){
  // our board: y=0 is top (rank 8), y=7 is bottom (rank 1)
  const file = String.fromCharCode('a'.charCodeAt(0) + x);
  const rank = 8 - y;
  return file + rank;
}

function historyToUciMoves(game){
  const h = game.history || [];
  const list = [];
  for (const mv of h){
    if (!mv.from || !mv.to) continue;
    const u = coordToSquare(mv.from.x, mv.from.y) +
              coordToSquare(mv.to.x, mv.to.y);
    // (optional) handle promotions by appending 'q', but Makruk promotion is rare
    list.push(u);
  }
  logDbg('[AI] historyToUciMoves:', JSON.stringify(list));
  return list;
}

function extractMoveFromResponse(json){
  if (!json) return null;
  const uci = typeof json.uci === 'string' ? json.uci
            : typeof json.bestmove === 'string' ? json.bestmove
            : typeof json.move === 'string' ? json.move
            : null;
  if (!uci) return null;
  const m = uci.trim().match(/^([a-h][1-8])([a-h][1-8])([qrbnQRBN])?$/);
  if (!m) return null;
  const fx = m[1].charCodeAt(0) - 97;
  const fy = 8 - (m[1].charCodeAt(1) - 48);
  const tx = m[2].charCodeAt(0) - 97;
  const ty = 8 - (m[2].charCodeAt(1) - 48);
  if (((fx | fy | tx | ty) & ~7) !== 0) return null;
  return { from:{ x:fx, y:fy }, to:{ x:tx, y:ty } };
}

async function callMoveAPI(moves, movetime){
  const started = performance.now();
  logDbg(`POST /api/ai/move mt=${movetime} thr=${SAFE_THREADS} hash=${SAFE_HASH} moves=${moves.length}`);
  const res = await withTimeout(fetch(REMOTE_ENDPOINT, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({
      variant: VARIANT,
      movetime,
      moves,
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
  updateStatus('✅ Connected to AI server', 'green');
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
  // still log FEN for debugging if you like
  try{
    if (typeof game.toFEN === 'function'){
      logDbg('FEN:', game.toFEN());
    }
  }catch{}

  const moves = historyToUciMoves(game);

  setSpinner(true);
  try{
    const alive = await pingBackend();
    if (!alive) { logDbg('Ping not OK → warmup 500ms'); await sleep(500); }
    let lastErr = null;
    for (let i=0; i< MOVETIME_STEPS.length; i++){
      const mt = MOVETIME_STEPS[i];
      try{
        if (i>0) { logDbg('Retry ladder — short pause'); await sleep(350); }
        const mv = await callMoveAPI(moves, mt);
        setSpinner(false);
        logDbg('MOVE SELECTED:', JSON.stringify(mv));
        updateStatus('✅ Connected to AI server', 'green');
        return mv;
      }catch(err){
        lastErr = err;
        updateStatus('⚠️ Using offline (random) AI — ' + (err.message || 'error'), 'orange');
        const server = (err.serverText||'').toLowerCase();
        const isTimeout = server.includes('engine timeout');
        const isBusy    = server.includes('noengine') || server.includes('pool') || /503|429/.test(err.message||'');
        const isNone    = server.includes('bestmove (none)') || server.includes('"uci":"(none)"') || server.includes('no_legal_move');
        logDbg('Attempt failed:', err.message, ' | server:', (err.serverText||'').slice(0,120));
        if (isNone) { logDbg('Breaking retry ladder (no legal move).'); break; }
        if (!isTimeout && !isBusy) { logDbg('Breaking retry ladder (hard error)'); break; }
      }
    }
    setSpinner(false);
    logDbg('All retries failed → local fallback');
    updateStatus('⚠️ Using offline (random) AI — server unreachable', 'orange');
    return pickRandomLegal(game);
  }catch(e){
    setSpinner(false);
    logDbg('Unexpected error:', e.message || e);
    updateStatus('⚠️ Using offline (random) AI — unexpected error', 'orange');
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

// === periodic backend liveness probe ===
(function aiKeepalive(){
  const PING_URL = REMOTE_PING;
  async function pingOnce(){
    const t0 = performance.now();
    try{
      const r = await fetch(PING_URL, { cache:'no-store' });
      const ok = r.ok;
      const j  = ok ? await r.json() : {};
      const dt = (performance.now() - t0) | 0;
      window.AIDebug?.log(`KEEPALIVE ${ok?'OK':'HTTP'+r.status} in ${dt}ms`, JSON.stringify(j));
      if(ok) window.AIDebug?.status('✅ Connected to AI server', 'green');
      else window.AIDebug?.status('⚠️ Using offline (random) AI — ping failed', 'orange');
    }catch(e){
      window.AIDebug?.log('KEEPALIVE FAIL:', e?.message || e);
      window.AIDebug?.status('⚠️ Using offline (random) AI — network error: ' + e?.message, 'orange');
    }
  }
  setInterval(pingOnce, 20000);
  pingOnce();
})();
