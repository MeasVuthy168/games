// js/ai.js — Khmer Chess AI (faster) + Opening Book
// API: chooseAIMove, setAIDifficulty, pickAIMove (alias)

let _bookPromise = null;
async function loadOpeningBook(){
  if (_bookPromise) return _bookPromise;
  _bookPromise = fetch('assets/book-mini.json').then(r=>r.json()).catch(()=> ({}));
  return _bookPromise;
}

// ---- helpers for book/history ----
function toAlg(sq){ return String.fromCharCode(97+sq.x) + String(8 - sq.y); }
function historyKeyFromGame(game){
  if (!Array.isArray(game.history) || game.history.length===0) return '';
  return game.history.map(m => toAlg(m.from) + toAlg(m.to)).join(' ');
}
function parseBookMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0)-97, fy = 8 - (uci.charCodeAt(1)-48);
  const tx = uci.charCodeAt(2)-97, ty = 8 - (uci.charCodeAt(3)-48);
  if (fx|fy|tx|ty & ~7) return null;
  const legals = game.legalMoves(fx, fy);
  for (const m of legals){ if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} }; }
  return null;
}

/* ====================== Tuning (optimized for mobile) ===================== */

const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };

// shallower but quick
const SEARCH_DEPTH = { Easy: 2, Medium: 3, Hard: 3 };
const TEMP_BY_LEVEL = { Easy: 0.50, Medium: 0.12, Hard: 0.0 }; // Hard≈greedy, Medium almost-greedy
const NODE_LIMIT_BY_LEVEL = { Easy: 6000, Medium: 12000, Hard: 20000 };

// repetition discouragers
const REP_SHORT_WINDOW = 8;
const REP_SOFT_PENALTY = 15;
const REP_HARD_PENALTY = 220;

// progress nudges
const BONUS_CAPTURE = 30;
const BONUS_CHECK   = 18;
const BONUS_PUSH    = 6;
const PENAL_IDLE    = 8;

// counting draw
const COUNT_BURN_PENALTY = 12;
const COUNT_RESEED_BONUS = 80;
const COUNT_URGENT_NEAR  = 3;

/* ============================== Utilities ============================== */

function normType(t){ return TYPE_MAP[t] || t; }

function materialSide(game, side){
  let s = 0;
  for (let y=0; y<8; y++){
    for (let x=0; x<8; x++){
      const p = game.at(x,y); if(!p || p.c!==side) continue;
      const tt = normType(p.t);
      if (tt!=='K') s += VAL[tt]||0;
    }
  }
  return s;
}
function materialEval(game){
  const w = materialSide(game,'w');
  const b = materialSide(game,'b');
  return w - b;
}

// SUPER CHEAP positional bonus (no legalMoves() calls)
function cheapPositional(game){
  // encourage central presence and pawn advancement a little
  let s = 0;
  for (let y=0; y<8; y++){
    for (let x=0; x<8; x++){
      const p = game.at(x,y); if(!p) continue;
      const tt = normType(p.t);
      // center weight
      const cx = Math.abs(3.5 - x), cy = Math.abs(3.5 - y);
      const center = 8 - (cx+cy); // 0..8
      let w = 0;
      if (tt==='P') { // pawns: encourage advance
        // white rows 6..0 (from 6 down), black rows 1..7 (from 1 up)
        w = (p.c==='w' ? (6 - y) : (y - 1)) * 1.2 + center*0.2;
      } else {
        w = center * 0.6;
      }
      s += (p.c==='w' ? +w : -w);
    }
  }
  return Math.trunc(s);
}

// light, string key
function posKey(game){
  const rows = [];
  for (let y=0; y<8; y++){
    const r = [];
    for (let x=0; x<8; x++){
      const p = game.at(x,y);
      r.push(!p ? '.' : (p.c==='w'?'w':'b') + (normType(p.t)));
    }
    rows.push(r.join(''));
  }
  return rows.join('/') + ' ' + game.turn;
}

class RepTracker{
  constructor(){ this.list=[]; }
  push(k){ this.list.push(k); if(this.list.length>128) this.list.shift(); }
  pop(){ this.list.pop(); }
  softCount(k){
    let n=0; for(let i=Math.max(0,this.list.length-REP_SHORT_WINDOW); i<this.list.length; i++){
      if(this.list[i]===k) n++;
    }
    return n;
  }
  wouldThreefold(k){
    const total = this.list.filter(x=>x===k).length;
    return (total+1) >= 3;
  }
}
function repetitionPenalty(rep, key){
  let p = 0;
  const soft = rep.softCount(key);
  if (soft>0) p -= REP_SOFT_PENALTY * soft;
  if (rep.wouldThreefold(key)) p -= REP_HARD_PENALTY;
  return p;
}

function moveDeltaBonus(game, move, captured, gaveCheck){
  let b=0;
  if (captured) b += BONUS_CAPTURE;
  if (gaveCheck) b += BONUS_CHECK;
  if (move.isPawnPush) b += BONUS_PUSH;
  if (b===0) b -= PENAL_IDLE;
  return b;
}
function countingAdjust(aiColor, countState, move, captured, matLead){
  if (!countState?.active) return 0;
  let adj = 0;
  const aiOwns = (countState.side === aiColor);
  if (aiOwns){
    if (captured) adj += COUNT_RESEED_BONUS;
    else if (matLead > 0) adj -= COUNT_BURN_PENALTY;
    if (countState.remaining <= COUNT_URGENT_NEAR) adj -= 50;
  } else {
    if (captured) adj += Math.floor(COUNT_RESEED_BONUS/2);
  }
  return adj;
}

function pickByTemperature(scoredMoves, T){
  if (!scoredMoves.length) return null;
  if (T<=0.0) return scoredMoves[0].move;
  const exps = scoredMoves.map(m => Math.exp(m.score / T));
  const sum  = exps.reduce((a,b)=>a+b,0);
  let r = Math.random()*sum;
  for (let i=0;i<scoredMoves.length;i++){
    r -= exps[i];
    if (r<=0) return scoredMoves[i].move;
  }
  return scoredMoves[0].move;
}

/* =========================== Move generation =========================== */

function generateMoves(game){
  const out = [];
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at(x,y);
      if(!p || p.c!==game.turn) continue;
      const tt = normType(p.t);
      const legals = game.legalMoves(x,y);
      for (const m of legals){
        const target = game.at(m.x,m.y);
        const isPawnPush = (tt==='P' && m.y !== y);
        out.push({
          from:{x,y},
          to:{x:m.x, y:m.y},
          captureVal: target ? (VAL[normType(target.t)]||0) : 0,
          isPawnPush
        });
      }
    }
  }
  out.sort((a,b)=>{
    if (b.captureVal !== a.captureVal) return b.captureVal - a.captureVal;
    const ca = centerBias(a.to), cb = centerBias(b.to);
    return cb - ca;
  });
  return out;
}
function centerBias(sq){
  const cx = Math.abs(3.5 - sq.x);
  const cy = Math.abs(3.5 - sq.y);
  return 8 - (cx+cy);
}

/* =============================== Search ================================ */

// tiny leaf cache
const LEAF_CACHE = new Map();
function cacheGet(k){ return LEAF_CACHE.get(k); }
function cachePut(k,v){
  if (LEAF_CACHE.size > 5000) { // simple cap
    LEAF_CACHE.clear();
  }
  LEAF_CACHE.set(k,v);
}

function evalLeaf(game, rep, countState, aiColor){
  const key = posKey(game);
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const mat = materialEval(game);
  // cheap positional (no legalMoves calls)
  const pos = cheapPositional(game);
  let score = mat + pos;

  score += repetitionPenalty(rep, key);

  // counting-draw nudge when we're ahead and own the counter
  const lead = (aiColor==='w' ? mat : -mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }

  cachePut(key, score);
  return score;
}

function make(game, mv){ return game.move(mv.from, mv.to); }
function undo(game){ game.undo(); }

function negamax(game, depth, alpha, beta, color, aiColor, rep, countState, budget, stats){
  if (stats.nodes++ > budget.limit) return { score: 0, move: null, cutoff:true };

  const st = game?.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate'){
      const mateScore = -100000 + (depth);
      return { score: color * mateScore, move:null };
    } else {
      return { score: 0, move:null };
    }
  }

  if (depth===0){
    const leaf = evalLeaf(game, rep, countState, aiColor);
    return { score: color * leaf, move:null };
  }

  const key = posKey(game);
  rep.push(key);

  let best = -Infinity;
  let bestMove = null;

  const moves = generateMoves(game);
  if (moves.length===0){
    const leaf = evalLeaf(game, rep, countState, aiColor);
    rep.pop();
    return { score: color * leaf, move:null };
  }

  for (const mv of moves){
    const before = game.at(mv.to.x, mv.to.y);
    const res = make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const gaveCheck = res?.status?.state === 'check';
    const mat = materialEval(game);
    const aiLead = (aiColor==='w' ? mat : -mat);
    const deltaAdj = moveDeltaBonus(game, mv, !!before, !!gaveCheck)
                   + countingAdjust(aiColor, countState, mv, !!before, aiLead);

    const child = negamax(
      game, depth-1, -beta, -alpha, -color, aiColor, rep, countState, budget, stats
    );
    const childScore = (child.cutoff ? -alpha : -(child.score)) + (color * deltaAdj);

    undo(game);

    if (childScore > best){
      best = childScore;
      bestMove = mv;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }

  rep.pop();
  return { score: best, move: bestMove };
}

/* ============================== Public API ============================= */

export async function chooseAIMove(game, opts={}){
  const level      = opts.level || 'Medium';
  const aiColor    = opts.aiColor || (game.turn);
  const countState = opts.countState || null;

  // ---- Opening book first ----
  try{
    const book = await loadOpeningBook();
    const key  = historyKeyFromGame(game);
    const cand = book[key];
    if (Array.isArray(cand) && cand.length){
      const pick = cand[Math.floor(Math.random()*cand.length)];
      const mv = parseBookMove(pick, game);
      if (mv) return mv;
    }
  }catch{}

  // ---- Engine search ----
  const depth  = SEARCH_DEPTH[level] ?? 3;
  const temp   = TEMP_BY_LEVEL[level] ?? 0;
  const budget = { limit: NODE_LIMIT_BY_LEVEL[level] ?? 20000 };

  const rep = new RepTracker();
  const stats = { nodes: 0 };

  const { move: principal } = negamax(
    game, depth, -Infinity, Infinity, +1, aiColor, rep, countState, budget, stats
  );
  if (!principal) return null;

  // Fast path: if temperature is ~greedy, just play principal
  if (temp <= 0.1) return principal;

  // Otherwise, rescore only TOP-K moves for a little variety
  const K = 4;
  const roots = generateMoves(game).slice(0, K).map(mv=>{
    const before = game.at(mv.to.x, mv.to.y);
    const res = game.move(mv.from, mv.to);
    if(!res?.ok){ game.undo(); return null; }

    const rep2 = new RepTracker(); rep2.list = rep.list.slice();
    const stats2 = { nodes: 0 };
    const sub = negamax(game, Math.max(1, depth-1), -Infinity, Infinity, -1, aiColor, rep2, countState, budget, stats2);
    game.undo();

    return {
      move: mv,
      score: -(sub.score) + moveDeltaBonus(game, mv, !!before, res?.status?.state==='check')
    };
  }).filter(Boolean);

  roots.sort((a,b)=> b.score - a.score);

  return pickByTemperature(roots, temp) || principal;
}

export function setAIDifficulty(level){
  return {
    depth: SEARCH_DEPTH[level] ?? 3,
    temperature: TEMP_BY_LEVEL[level] ?? 0,
    nodeLimit: NODE_LIMIT_BY_LEVEL[level] ?? 20000
  };
}

export const pickAIMove = chooseAIMove;
