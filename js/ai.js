// js/ai.js — Force Remote Makruk Engine + solid local backup (Master++)
//
// Public API:
//   - chooseAIMove(game, { aiColor: 'w'|'b', countState })
//   - setAIDifficulty(level)
//   - pickAIMove (alias)

// ===== Remote engine config =====
const BACKEND_BASE =
  (localStorage.getItem('kc_backend_url') || 'https://ouk-ai-backend.onrender.com').replace(/\/+$/,'');
const FORCE_REMOTE = true;           // never silently fallback if remote fails
const REMOTE_MOVETIME_MS = 2500;     // 2.5s ~ decent strength on mobile

// ===== Helpers to talk to your backend =====
function readFEN(game){
  try { if (typeof game.toFEN === 'function') return game.toFEN(); } catch{}
  try { if (typeof game.toFen === 'function') return game.toFen(); } catch{}
  // very basic fallback: rely on engine to reject; better to expose toFEN() in your game
  return game.fen || '';
}

function parseUciToMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97;
  const fy = 8 - (uci.charCodeAt(1) - 48);
  const tx = uci.charCodeAt(2) - 97;
  const ty = 8 - (uci.charCodeAt(3) - 48);
  const legals = (game.legalMoves && game.legalMoves(fx, fy)) || [];
  for (const m of legals){
    if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
  }
  return null;
}

async function requestRemoteMove(game, { aiColor }){
  const t0 = performance.now ? performance.now() : Date.now();
  const fen = readFEN(game);
  const body = { fen, variant: 'makruk', movetime: REMOTE_MOVETIME_MS };

  // Let UI know we’re using remote
  try { window.dispatchEvent(new CustomEvent('ai:phase',{ detail:{ phase:'remote', fen } })); } catch{}

  const res = await fetch(`${BACKEND_BASE}/api/ai/move`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });

  const elapsed = (performance.now ? performance.now() : Date.now()) - t0;
  try { window.dispatchEvent(new CustomEvent('ai:elapsed',{ detail:{ ms: elapsed } })); } catch{}

  if (!res.ok) throw new Error(`Remote AI HTTP ${res.status}`);
  const data = await res.json().catch(()=> ({}));
  const uci = data?.uci || data?.bestmove || data?.move;
  const mv = parseUciToMove(uci, game);
  if (!mv) throw new Error('Remote AI returned no legal move');
  return mv;
}

// ====== Local search (shortened Master++) — used ONLY if FORCE_REMOTE=false ======

// Tunables
const MASTER = { timeMs: 1200, maxDepth: 9, nodeCap: 400_000 };
const USE_BOOK = false, TEMP_T = 0.0;
const FUT_MARGIN_BASE = 120, RAZOR_MARGIN = 220, Q_NODE_CAP = 40_000, Q_DEPTH_MAX = 8;
const LMR_MIN_DEPTH = 3, LMR_BASE_RED = 1, NULL_MOVE_MIND = 3;

const VAL = { P:100, N:320, B:330, R:500, Q:900, K:10000 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };
const normType = t => TYPE_MAP[t] || t;

const TT = new Map(); const TT_EXACT=0, TT_LOWER=1, TT_UPPER=2;

function zobrist(game){
  // simple hash: piece type * coords * turn (fast; ok for fallback)
  let h = (game.turn==='w'? 17:29);
  for (let y=0;y<8;y++) for (let x=0;x<8;x++){
    const p = game.at(x,y);
    if (!p) continue;
    const v = (p.c==='w'? 1:2) * ((VAL[normType(p.t)]||3) + 7) * (x+1) * (y+1);
    h = (h*1315423911 ^ v) >>> 0;
  }
  return h>>>0;
}
function materialEval(g){
  let s=0;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=g.at(x,y); if(!p) continue;
    s += (p.c==='w'?+1:-1) * (VAL[normType(p.t)]||0);
  }
  return s;
}
function centerBias(sq){ const cx=Math.abs(3.5-sq.x), cy=Math.abs(3.5-sq.y); return 8-(cx+cy); }
function generateMoves(g){
  const out=[];
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=g.at(x,y); if(!p || p.c!==g.turn) continue;
    const legals=g.legalMoves(x,y);
    for(const m of legals){
      const t=g.at(m.x,m.y);
      out.push({
        from:{x,y}, to:{x:m.x,y:m.y},
        isCapture:!!t, mvv: t ? (VAL[normType(t.t)]||0) : 0, center:centerBias(m)
      });
    }
  }
  return out;
}
function orderMoves(g, moves, ttMove, ply=0){
  for(const mv of moves){
    let sc = 0;
    if (ttMove && mv.from.x===ttMove.from.x && mv.from.y===ttMove.from.y && mv.to.x===ttMove.to.x && mv.to.y===ttMove.to.y) sc = 3_000_000;
    else if (mv.isCapture) sc = 2_000_000 + mv.mvv*12;
    else sc = 200_000 + mv.center;
    mv._hs = sc;
  }
  moves.sort((a,b)=> b._hs - a._hs);
  return moves;
}
function make(g,m){ return g.move(m.from,m.to); }
function undo(g){ g.undo(); }

function quiesce(g, a, b, color){
  let stand = color * materialEval(g);
  if (stand >= b) return b;
  if (stand > a) a = stand;

  let moves = generateMoves(g).filter(m=>m.isCapture);
  orderMoves(g, moves, null, 0);
  for (const mv of moves){
    const res = make(g, mv);
    if(!res?.ok){ undo(g); continue; }
    const score = -quiesce(g, -b, -a, -color);
    undo(g);
    if (score >= b) return b;
    if (score > a) a = score;
  }
  return a;
}

function negamax(g, depth, alpha, beta, color, ply){
  const key = zobrist(g);
  const tt  = TT.get(key);
  let ttMove= tt?.move || null;
  if (tt && tt.depth >= depth){
    const v = tt.score;
    if (tt.flag===TT_EXACT) return { score:v, move:ttMove };
    if (tt.flag===TT_LOWER && v > alpha) alpha = v;
    if (tt.flag===TT_UPPER && v < beta) beta = v;
    if (alpha >= beta) return { score:v, move:ttMove };
  }
  if (depth===0) return { score: quiesce(g, alpha, beta, color), move:null };

  let moves = orderMoves(g, generateMoves(g), ttMove, ply);
  if (!moves.length) return { score: color*materialEval(g), move:null };
  let best=-Infinity, bestMove=null, a0=alpha, i=0;

  for (const mv of moves){
    const res = make(g,mv);
    if(!res?.ok){ undo(g); i++; continue; }

    let child;
    if (i===0) child = negamax(g, depth-1, -beta, -alpha, -color, ply+1);
    else {
      child = negamax(g, depth-1, -alpha-1, -alpha, -color, ply+1);
      if (child.score > alpha) child = negamax(g, depth-1, -beta, -alpha, -color, ply+1);
    }
    const sc = -child.score; undo(g);
    if (sc > best){ best=sc; bestMove=mv; }
    if (best > alpha){ alpha = best; if (alpha >= beta) break; }
    i++;
  }
  let flag = TT_EXACT; if (best <= a0) flag=TT_UPPER; else if (best >= beta) flag=TT_LOWER;
  TT.set(key,{depth,score:best,flag,move:bestMove});
  return { score: best, move: bestMove };
}

async function chooseAIMove_LocalMaster(game){
  let best=null, last=0;
  const start=Date.now();
  for (let d=1; d<=MASTER.maxDepth; d++){
    let a = (d>2 ? last-90 : -Infinity);
    let b = (d>2 ? last+90 :  Infinity);
    for (let t=0; t<2; t++){
      const { move, score } = negamax(game, d, a, b, +1, 0);
      if (Date.now()-start > MASTER.timeMs){ d = MASTER.maxDepth+1; break; }
      if (score <= a){ a=-Infinity; b=(last+140); continue; }
      if (score >= b){ a=(last-140); b=Infinity; continue; }
      if (move){ best=move; last=score; }
      break;
    }
    if (Date.now()-start > MASTER.timeMs) break;
  }
  if (!best){
    const mv = orderMoves(game, generateMoves(game), null, 0)[0];
    return mv || null;
  }
  return best;
}

// ===== Public API =====
export async function chooseAIMove(game, opts={}){
  try {
    return await requestRemoteMove(game, opts);
  } catch (e) {
    console.warn('[AI] remote failed:', e?.message||e);
    if (FORCE_REMOTE) {
      // UI courtesy: hide spinner shortly after error
      setTimeout(()=>{ try{ window.__aiHide?.(); }catch{} }, 600);
      alert('Remote AI unavailable. Please check your backend (Render) is LIVE.');
      throw e;
    }
  }
  // Optional fallback (only if FORCE_REMOTE === false)
  return await chooseAIMove_LocalMaster(game);
}

export function setAIDifficulty(){
  return { timeMs: REMOTE_MOVETIME_MS, maxDepth: 'remote', nodeLimit: 'remote', temperature: 0 };
}

export const pickAIMove = chooseAIMove;
