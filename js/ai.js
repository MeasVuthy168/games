// js/ai.js — Fast Khmer Chess AI (ID + TT + Pruning + Levels + Book)
//
// Public API (unchanged):
//   chooseAIMove(game, { level:'Easy'|'Medium'|'Hard'|'Master', aiColor:'w'|'b', countState })
//   setAIDifficulty(level)
//   pickAIMove (alias)
//
// Depends on your Game API (unchanged): at, turn, legalMoves, move, undo, status(), squareAttacked(), history
// Works with Khmer piece aliases via TYPE_MAP.
//
// ---------------------------------------------------------------------

/* =========================== Tunables ============================ */

// Opening book (optional). Safe if file is missing.
const USE_BOOK = true;
const BOOK_URL = 'assets/book-khmer.json'; // or assets/book-mini.json

// Per-level search settings (time-driven, with max depth as guard)
const LEVEL = {
  Easy:   { timeMs:  60, maxDepth: 3,  nodeCap:  9000,  temp: 0.50 },
  Medium: { timeMs: 120, maxDepth: 4,  nodeCap: 16000, temp: 0.25 },
  Hard:   { timeMs: 220, maxDepth: 5,  nodeCap: 26000, temp: 0.00 },
  Master: { timeMs: 350, maxDepth: 6,  nodeCap: 38000, temp: 0.00 },
};

// Quiescence guard
const Q_NODE_CAP = 15000;
const Q_DEPTH_MAX = 6;

// Futility (only at depth==1, non-captures, non-check)
const FUT_MARGIN = 120;

// LMR: reduce quiet late moves
const LMR_START_INDEX = 4; // after N best moves
const LMR_MIN_DEPTH = 3;

/* ====================== Values / normalization =================== */

const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };
const ATTACKER_VAL = { P:100, N:320, B:330, R:500, Q:900, K:1000 };
function normType(t){ return TYPE_MAP[t] || t; }

/* ============================= Book ============================== */

let _bookPromise=null;
async function loadOpeningBook(){
  if (!USE_BOOK) return {};
  if (_bookPromise) return _bookPromise;
  _bookPromise = fetch(BOOK_URL).then(r=>r.json()).catch(()=> ({}));
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

/* ============================== Eval ============================= */

function materialSide(game, side){
  let s=0;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p || p.c!==side) continue;
    const tt=normType(p.t);
    if (tt!=='K') s += VAL[tt]||0;
  }
  return s;
}
function materialEval(game){ return materialSide(game,'w') - materialSide(game,'b'); }

function mobilityEval(game){
  let moves=0, cap=28;
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y); if(!p || p.c!==game.turn) continue;
      moves += game.legalMoves(x,y).length;
      if (moves>=cap) return (game.turn==='w'?+1:-1)*cap;
    }
  }
  return (game.turn==='w'?+1:-1)*moves;
}

function posKey(game){
  let out='';
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y);
      out += p ? (p.c + (normType(p.t))) : '.';
    }
    out += '/';
  }
  return out + ' ' + game.turn;
}

/* ===================== Repetition discourager ==================== */

const REP_SHORT_WINDOW=8, REP_SOFT_PENALTY=15, REP_HARD_PENALTY=220;

class RepTracker{
  constructor(){ this.list=[]; }
  push(k){ this.list.push(k); if(this.list.length>128) this.list.shift(); }
  pop(){ this.list.pop(); }
  softCount(k){
    let n=0, s=Math.max(0,this.list.length-REP_SHORT_WINDOW);
    for (let i=s;i<this.list.length;i++) if (this.list[i]===k) n++;
    return n;
  }
  wouldThreefold(k){ return (this.list.filter(x=>x===k).length + 1) >= 3; }
}
function repetitionPenalty(rep, key){
  let p=0, soft=rep.softCount(key);
  if (soft>0) p -= REP_SOFT_PENALTY*soft;
  if (rep.wouldThreefold(key)) p -= REP_HARD_PENALTY;
  return p;
}

/* =============== Counting-draw (compat with your UI) ============== */

const COUNT_BURN_PENALTY=12, COUNT_RESEED_BONUS=80, COUNT_URGENT_NEAR=3;
function countingAdjust(aiColor, countState, captured, matLead){
  if (!countState?.active) return 0;
  let adj=0, aiOwns=(countState.side===aiColor);
  if (aiOwns){
    if (captured) adj+=COUNT_RESEED_BONUS;
    else if (matLead>0) adj-=COUNT_BURN_PENALTY;
    if ((countState.remaining||0)<=COUNT_URGENT_NEAR) adj-=50;
  } else if (captured){
    adj += (COUNT_RESEED_BONUS>>1);
  }
  return adj;
}

/* ============================ Move-gen =========================== */

function centerBias(sq){ const cx=Math.abs(3.5-sq.x), cy=Math.abs(3.5-sq.y); return 8-(cx+cy); }

function generateMoves(game){
  const out=[];
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const p=game.at(x,y); if(!p || p.c!==game.turn) continue;
      const tt=normType(p.t);
      const legals=game.legalMoves(x,y);
      for(const m of legals){
        const target=game.at(m.x,m.y);
        out.push({
          from:{x,y}, to:{x:m.x,y:m.y},
          attackerType: tt,
          isCapture: !!target,
          targetType: target ? normType(target.t) : null,
          mvv: target ? (VAL[normType(target.t)]||0) : 0,
          lva: ATTACKER_VAL[tt] || 0,
          center: centerBias(m)
        });
      }
    }
  }
  return out;
}

/* ========================= Ordering heuristic ==================== */

function moveScoreHeuristic(game, mv){
  let score = 0;

  // Captures first: MVV/LVA strong bias
  if (mv.isCapture){
    score += 12000 + mv.mvv*12 - mv.lva;
  } else {
    score += mv.center;
  }

  // Destination safety
  const opp = (game.turn==='w'?'b':'w');
  const defended = game.squareAttacked(mv.to.x, mv.to.y, opp);

  if (mv.isCapture){
    score += defended ? -60 : +220;
    if (mv.attackerType==='K'){ // King capture policy
      if (mv.mvv>200) score += 400; else score += defended ? -200 : +200;
    }
  } else {
    score += defended ? -20 : +10;
  }
  return score;
}
function orderMoves(game, moves){
  for (const mv of moves) mv._hs = moveScoreHeuristic(game, mv);
  moves.sort((a,b)=> b._hs - a._hs);
  return moves;
}

/* ========================== TT + helpers ========================= */

const TT = new Map(); // key -> { depth, score, flag, move }
const TT_EXACT=0, TT_LOWER=1, TT_UPPER=2;

function sameMove(a,b){ return !!a && !!b && a.from.x===b.from.x && a.from.y===b.from.y && a.to.x===b.to.x && a.to.y===b.to.y; }
function make(game,m){ return game.move(m.from,m.to); }
function undo(game){ game.undo(); }

/* ========================= Evaluation nodes ====================== */

function evalLeaf(game, rep, countState, aiColor){
  const mat = materialEval(game);
  const mob = mobilityEval(game);
  let score = mat + mob + repetitionPenalty(rep, posKey(game));
  // counting-draw nudge (optional)
  const lead = (aiColor==='w'?mat:-mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }
  return score;
}

/* ============================ Quiescence ========================= */

function quiesce(game, alpha, beta, color, aiColor, timers, qStat, depthQ=0){
  if (timers.timeUp()) return alpha;
  if (qStat.nodes++ > Q_NODE_CAP || depthQ>Q_DEPTH_MAX) return color * evalLeaf(game, timers.rep, null, aiColor);

  let stand = color * evalLeaf(game, timers.rep, null, aiColor);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  const caps = orderMoves(game, generateMoves(game).filter(m=>m.isCapture));
  for (const mv of caps){
    const res = make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const score = -quiesce(game, -beta, -alpha, -color, aiColor, timers, qStat, depthQ+1);

    undo(game);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;

    if (timers.timeUp()) break;
  }
  return alpha;
}

/* ============================== Search ========================== */

function negamax(game, depth, alpha, beta, color, aiColor, timers, stats){
  if (timers.timeUp() || stats.nodes++ > timers.nodeCap) return { score: 0, move:null, cutoff:true };

  const st = game?.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate') return { score: color * (-100000 + depth), move:null };
    return { score: 0, move:null };
  }

  const key = posKey(game);
  const tt = TT.get(key);
  if (tt && tt.depth >= depth){
    let v = tt.score;
    if (tt.flag===TT_EXACT) return { score:v, move:tt.move||null };
    if (tt.flag===TT_LOWER && v > alpha) alpha = v;
    else if (tt.flag===TT_UPPER && v < beta) beta = v;
    if (alpha >= beta) return { score:v, move:tt.move||null };
  }

  if (depth===0){
    const qStat = { nodes:0 }; // shared cap in timers
    const v = quiesce(game, alpha, beta, color, aiColor, timers, qStat, 0);
    return { score: v, move:null };
  }

  timers.rep.push(key);

  let moves = orderMoves(game, generateMoves(game));
  if (!moves.length){
    timers.rep.pop();
    return { score: color * evalLeaf(game, timers.rep, timers.countState, aiColor), move:null };
  }

  let best=-Infinity, bestMove=null;
  let a0=alpha;
  let idx=0;

  for (const mv of moves){
    const before = game.at(mv.to.x, mv.to.y);
    const res = make(game, mv);
    if(!res?.ok){ undo(game); idx++; continue; }

    // Futility prune at shallow depth: skip hopeless quiets
    if (depth===1 && !mv.isCapture && res?.status?.state!=='check'){
      const est = color * evalLeaf(game, timers.rep, timers.countState, aiColor) - FUT_MARGIN;
      if (est <= alpha){ undo(game); idx++; if (timers.timeUp()) break; continue; }
    }

    // Late Move Reductions: reduce depth for quiet late moves
    let nextDepth = depth-1;
    if (!mv.isCapture && res?.status?.state!=='check' && depth>=LMR_MIN_DEPTH && idx>=LMR_START_INDEX){
      nextDepth = depth-2; // simple LMR
      if (nextDepth < 0) nextDepth = 0;
    }

    const child = negamax(game, nextDepth, -beta, -alpha, -color, aiColor, timers, stats);
    let childScore = (child.cutoff ? -alpha : -(child.score));

    // Small delta bonus for captures/checks + counting
    if (mv.isCapture || res?.status?.state==='check'){
      const mat = materialEval(game);
      const aiLead = (aiColor==='w'?mat:-mat);
      if (mv.isCapture) childScore += 24 + countingAdjust(aiColor, timers.countState, true, aiLead);
      if (res?.status?.state==='check') childScore += 14;
    }

    undo(game);

    if (childScore > best){
      best = childScore; bestMove = mv;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }

    idx++;
    if (timers.timeUp()) break;
  }

  timers.rep.pop();

  // TT store
  let flag = TT_EXACT;
  if      (best <= a0) flag = TT_UPPER;
  else if (best >= beta) flag = TT_LOWER;
  TT.set(key, { depth, score:best, flag, move:bestMove });

  return { score: best, move: bestMove };
}

/* ======================= Root / iterative deepening ==================== */

function pickByTemperature(items, T){
  if (!items.length) return null;
  if (T<=0) return items[0].move;
  const exps = items.map(m => Math.exp(m.score / Math.max(1,T)));
  const sum  = exps.reduce((a,b)=>a+b,0);
  let r = Math.random()*sum;
  for (let i=0;i<items.length;i++){
    r -= exps[i];
    if (r<=0) return items[i].move;
  }
  return items[0].move;
}

/* ============================== Public API ============================= */

export async function chooseAIMove(game, opts={}){
  const level      = opts.level || 'Medium';
  const L          = LEVEL[level] || LEVEL.Medium;
  const aiColor    = opts.aiColor || game.turn;
  const countState = opts.countState || null;

  // 1) Opening book
  try{
    const book = await loadOpeningBook();
    if (book && USE_BOOK){
      const key = historyKeyFromGame(game);
      const cand = book[key];
      if (Array.isArray(cand) && cand.length){
        const mv = parseBookMove(cand[Math.floor(Math.random()*cand.length)], game);
        if (mv) return mv;
      }
    }
  }catch{}

  // 2) Iterative deepening within time/node budget
  const start = performance.now ? performance.now() : Date.now();
  const timers = {
    timeUp: ()=> ((performance.now?performance.now():Date.now()) - start) > L.timeMs,
    nodeCap: L.nodeCap,
    rep: new RepTracker(),
    countState
  };
  const stats = { nodes:0 };

  let bestMove = null;
  let bestScore = -Infinity;

  for (let depth=1; depth<=L.maxDepth; depth++){
    const { move, score } = negamax(game, depth, -Infinity, Infinity, +1, aiColor, timers, stats);
    if (move){ bestMove = move; bestScore = score; }
    if (timers.timeUp()) break;
  }

  if (!bestMove) return null;

  // Small top list for temperature pick (keeps Easy/Medium human-ish)
  const all = orderMoves(game, generateMoves(game)).slice(0, 6).map(mv=>{
    const res = game.move(mv.from, mv.to);
    if(!res?.ok){ game.undo(); return null; }
    const timers2 = { ...timers, rep: new RepTracker() };
    const stats2 = { nodes:0 };
    const sub = negamax(game, Math.max(1, (LEVEL[level]?.maxDepth||3)-1), -Infinity, Infinity, -1, aiColor, timers2, stats2);
    game.undo();
    return { move: mv, score: -(sub.score) };
  }).filter(Boolean).sort((a,b)=> b.score - a.score);

  const picked = pickByTemperature(all.length?all:[{move:bestMove,score:bestScore}], L.temp) || bestMove;
  return picked;
}

export function setAIDifficulty(level){
  const L = LEVEL[level] || LEVEL.Medium;
  return { timeMs: L.timeMs, maxDepth: L.maxDepth, nodeLimit: L.nodeCap, temperature: L.temp };
}
export const pickAIMove = chooseAIMove;
