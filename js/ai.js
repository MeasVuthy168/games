/* ------------------------------------------------------------------
   Remote-first wrapper + spinner
   ------------------------------------------------------------------ */
const AI_REMOTE_BASE = 'https://ouk-ai-backend.onrender.com'; // your live backend
const AI_REMOTE_VARIANT = 'makruk';
const AI_REMOTE_TIME_MS = 1200; // adjust if you want

function __showSpin(){ try{ window.__aiShow?.(); }catch{} }
function __hideSpin(){ try{ window.__aiHide?.(); }catch{} }

// Map UCI like "e2e4" to your game's move object
function uciToMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97;      // a -> 0
  const fy = 8 - (uci.charCodeAt(1) - 48);
  const tx = uci.charCodeAt(2) - 97;
  const ty = 8 - (uci.charCodeAt(3) - 48);
  if ((fx|fy|tx|ty) & ~7) return null;
  const legals = (game.legalMoves?.(fx,fy)) || [];
  for (const m of legals){
    if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
  }
  return null;
}

// We’ll reuse TYPE_MAP later (declared below in your local engine)
// to build a Makruk-compatible FEN if game.toFEN is absent.
function toMakrukFEN(game){
  if (typeof game.toFEN === 'function') return game.toFEN();
  const TM = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };
  const rows = [];
  for (let y=0;y<8;y++){
    let run=0, row='';
    for (let x=0;x<8;x++){
      const p = game.at?.(x,y);
      if (!p){ run++; continue; }
      if (run){ row += String(run); run=0; }
      const t = TM[p.t] || p.t || 'P';
      row += (p.c==='w') ? t : t.toLowerCase();
    }
    if (run) row += String(run);
    rows.push(row||'8');
  }
  const turn = game.turn || 'w';
  return `${rows.join('/') } ${turn} - - 0 1`;
}

async function chooseAIMove_Remote(game, { aiColor='w', movetime=AI_REMOTE_TIME_MS }={}){
  const fen = toMakrukFEN(game);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 15000);
  try{
    const res = await fetch(`${AI_REMOTE_BASE}/api/ai/move`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ fen, variant: AI_REMOTE_VARIANT, movetime, side: aiColor }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const mv = uciToMove(data?.bestmove, game);
    if (!mv) throw new Error('Mapping bestmove failed');
    return mv;
  } finally { clearTimeout(timer); }
}

/* ==================================================================
   Your existing "Master++ Aggressive" LOCAL AI (kept untouched)
   ================================================================== */

// js/ai.js — Khmer Chess "Master++ Aggressive" (no WASM)
//
// Public API (unchanged):
//   - chooseAIMove(game, { aiColor: 'w'|'b', countState })
//   - setAIDifficulty(level)  -> returns active Master config
//   - pickAIMove alias
//
// Highlights:
// - PVS + iterative deepening + aspiration windows
// - Zobrist TT (fast hashing), killer moves, history heuristic
// - LMR, futility, razoring, (guarded) null-move
// - Quiescence with delta-pruning + checks probing
// - Light PST + mobility + king-pressure/threat incentives
// - Softer fear of defended squares => less "escape" behavior
// - Counting-draw synergy + repetition control kept

//////////////////////// Master Profile //////////////////////

const MASTER = {
  timeMs:   1200,     // per-move time budget (tune up/down for strength/speed)
  maxDepth: 9,        // hard ceiling (ID tries to reach this)
  nodeCap:  400_000,  // global guardrail
};

const USE_BOOK   = true;
const BOOK_URL   = 'assets/book-khmer.json';
const TEMP_T     = 0.00; // root randomness (0 = deterministic)

//////////////////////// Pruning / Reductions //////////////////////

const FUT_MARGIN_BASE = 120;
const RAZOR_MARGIN    = 220;
const Q_NODE_CAP      = 40_000;
const Q_DEPTH_MAX     = 8;
const LMR_MIN_DEPTH   = 3;
const LMR_BASE_RED    = 1;     // smaller = search more quiet moves
const NULL_MOVE_R     = 2;
const NULL_MOVE_MIND  = 3;

//////////////////////// Repetition & Counting //////////////////////

const REP_SHORT_WINDOW=8, REP_SOFT_PENALTY=15, REP_HARD_PENALTY=220;

const COUNT_BURN_PENALTY=6;  // softened to reduce over-passivity
const COUNT_RESEED_BONUS=80, COUNT_URGENT_NEAR=3;

//////////////////////// Values //////////////////////

const VAL = { P:100, N:320, B:330, R:500, Q:900, K:10000 };
const ATTACKER_VAL = { P:100, N:320, B:330, R:500, Q:900, K:10000 };

// Khmer aliases → normal
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };
function normType(t){ return TYPE_MAP[t] || t; }

//////////////////////// Debug hook (safe no-op) //////////////////////

const log = (s, kind) => { try{ window.__dbglog?.(`[AI] ${s}`, kind); }catch{} };

//////////////////////// Opening book //////////////////////

let _bookPromise=null;
async function loadOpeningBook(){
  if (!USE_BOOK) return {};
  if (_bookPromise) return _bookPromise;
  _bookPromise = fetch(BOOK_URL).then(r=> r.ok ? r.json() : {}).catch(()=> ({}));
  return _bookPromise;
}
function toAlg(sq){ return String.fromCharCode(97+sq.x) + String(8 - sq.y); }
function historyKeyFromGame(game){
  if (!Array.isArray(game.history) || !game.history.length) return '';
  return game.history.map(m => toAlg(m.from)+toAlg(m.to)).join(' ');
}
function parseBookMove(uci, game){
  if (!uci || uci.length<4) return null;
  const fx=uci.charCodeAt(0)-97, fy=8-(uci.charCodeAt(1)-48);
  const tx=uci.charCodeAt(2)-97, ty=8-(uci.charCodeAt(3)-48);
  if (fx|fy|tx|ty & ~7) return null;
  const legals = game.legalMoves(fx, fy);
  for (const m of legals){
    if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
  }
  return null;
}

/* ……… (the whole of your local engine stays exactly the same) ………
   ⬇️  I’m keeping all your functions unchanged from here down:
   - zobrist / repetition / eval / move ordering
   - quiesce / negamax / iterative deepening
   - chooseAIMove_LocalMaster(game, opts)
   - setAIDifficulty
   - etc.
   (For brevity in this message, I won’t re-expand every line again.)
   Use the same content you pasted previously.
---------------------------------------------------------------------*/

/* ---------------- keep your original LOCAL engine code here ------- */
/* [Your entire existing code from “//////////////////////// Zobrist …”
   all the way down to the end of chooseAIMove_LocalMaster()]        */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------
   FINAL PUBLIC API: spinner + remote-first + local fallback
   ------------------------------------------------------------------ */
export async function chooseAIMove(game, opts={}){
  __showSpin();
  try{
    // 1) try remote engine first
    try{
      const mv = await chooseAIMove_Remote(game, {
        aiColor : opts.aiColor || game.turn,
        movetime: (opts.movetime ?? AI_REMOTE_TIME_MS)
      });
      if (mv) return mv;
    }catch(e){
      console.warn('[AI] remote failed, falling back:', e?.message || e);
    }
    // 2) fallback to your local Master
    return await chooseAIMove_LocalMaster(game, opts);
  } finally {
    __hideSpin();
  }
}

export function setAIDifficulty(/* level */){
  return { timeMs: MASTER.timeMs, maxDepth: MASTER.maxDepth, nodeLimit: MASTER.nodeCap, temperature: 0 };
}

export const pickAIMove = chooseAIMove;
