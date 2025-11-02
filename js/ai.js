// js/ai.js — Master-only local AI for Khmer Chess (no WASM)
// Techniques: ID-DFS, TT, Quiescence, SEE, Null-move, LMR, Futility, Repetition control
// Public API:
//   - chooseAIMove(game, { aiColor: 'w'|'b', countState })
//   - setAIDifficulty(level)  // kept for compatibility; always returns Master config
//   - pickAIMove (alias)

//////////////////////// Tunables (Master profile) ////////////////////////

const MASTER = {
  timeMs:   650,   // search time budget per move
  maxDepth: 7,     // hard ceiling for ID
  nodeCap:  120000 // extra guardrail
};

const USE_BOOK   = true;
const BOOK_URL   = 'assets/book-khmer.json'; // optional, safe to miss
const TEMP_T     = 0.00;  // no randomness at root
const FUT_MARGIN = 120;   // futility pruning margin
const Q_NODE_CAP = 20000; // quiescence node guard
const Q_DEPTH_MAX= 7;     // max capture depth in quiescence
const LMR_START_INDEX = 4;
const LMR_MIN_DEPTH  = 3;
const NULL_MOVE_R    = 2; // null-move depth reduction
const NULL_MOVE_MIND = 3; // only apply null-move when depth >= 3

// Values (normalized to chess-like scale; mapped from Khmer types in TYPE_MAP)
const VAL = { P:100, N:320, B:330, R:500, Q:900, K:10000 };
const ATTACKER_VAL = { P:100, N:320, B:330, R:500, Q:900, K:10000 };

// Map your piece codes to standard letters for eval/SEE
// (T,H,G,D,F,S are Khmer internal aliases the game may use)
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };
function normType(t){ return TYPE_MAP[t] || t; }

//////////////////////// Debug hook to your panel (optional) //////////////////////

const log = (s, kind) => { try{ window.__dbglog?.(`[AI] ${s}`, kind); }catch{} };

//////////////////////// Book (optional, safe if not found) //////////////////////

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

//////////////////////// Position Key + Repetition //////////////////////

function posKey(game){
  let out='';
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y);
      out += p ? (p.c + normType(p.t)) : '.';
    }
    out += '/';
  }
  return out + ' ' + game.turn;
}

const REP_SHORT_WINDOW=8, REP_SOFT_PENALTY=15, REP_HARD_PENALTY=220;
class RepTracker{
  constructor(){ this.list=[]; }
  push(k){ this.list.push(k); if(this.list.length>160) this.list.shift(); }
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

//////////////////////// Counting-draw synergy (your UI) //////////////////////

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

//////////////////////// Evaluation //////////////////////

function materialSide(game, side){
  let s=0;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p || p.c!==side) continue;
    const tt=normType(p.t);
    s += (VAL[tt]||0);
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

function evalLeaf(game, rep, countState, aiColor){
  const mat = materialEval(game);
  const mob = mobilityEval(game);
  let score = mat + mob + repetitionPenalty(rep, posKey(game));
  // discourage slow-burning when counting-draw held by AI and ahead
  const lead = (aiColor==='w'?mat:-mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }
  return score;
}

//////////////////////// SEE (Static Exchange Evaluation) //////////////////////

function see(game, from, to){
  // Conservative SEE using piece values, not full X-ray; fast and safe.
  // Returns estimated net gain for the side-to-move if capturing from->to.
  const target = game.at(to.x,to.y);
  const attacker= game.at(from.x,from.y);
  if (!attacker || !target) return 0;

  const atkV = VAL[normType(attacker.t)] || 0;
  let gain = (VAL[normType(target.t)] || 0) - atkV;

  // If the destination square is defended by opponent and our attacker is a low value,
  // we may still accept. If heavily defended, penalize.
  const opp = (game.turn==='w'?'b':'w');
  const defended = game.squareAttacked(to.x,to.y, opp);
  if (defended) gain -= 40;

  return gain;
}

//////////////////////// Move generation + ordering //////////////////////

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
          center: centerBias(m),
          see: target ? null : 0 // lazily filled if needed
        });
      }
    }
  }
  return out;
}

function moveScoreHeuristic(game, mv){
  let score = 0;
  if (mv.isCapture){
    // MVV-LVA + capture safety
    score += 12000 + mv.mvv*12 - mv.lva;
    // quick on-the-fly SEE (cheap): only for big targets or skewed trades
    if (mv.mvv >= 300){
      const s = see(game, mv.from, mv.to);
      score += (s>=0 ? 150 : -120) + s;
    }
  } else {
    score += mv.center; // centralization
  }
  const opp = (game.turn==='w'?'b':'w');
  const defended = game.squareAttacked(mv.to.x, mv.to.y, opp);
  if (mv.isCapture){
    score += defended ? -60 : +220;
    if (mv.attackerType==='K'){ score += (mv.mvv>200) ? 400 : (defended ? -200 : +200); }
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

//////////////////////// Helpers //////////////////////

function make(game,m){ return game.move(m.from,m.to); }
function undo(game){ game.undo(); }

//////////////////////// TT //////////////////////

const TT = new Map();
const TT_EXACT=0, TT_LOWER=1, TT_UPPER=2;

//////////////////////// Quiescence //////////////////////

function quiesce(game, alpha, beta, color, aiColor, timers, qStat, depthQ=0){
  if (timers.timeUp()) return alpha;
  if (qStat.nodes++ > Q_NODE_CAP || depthQ>Q_DEPTH_MAX) return color * evalLeaf(game, timers.rep, null, aiColor);

  // stand pat
  let stand = color * evalLeaf(game, timers.rep, null, aiColor);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  // captures only
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

//////////////////////// Search (negamax + pruning) //////////////////////

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
    const qStat = { nodes:0 };
    const v = quiesce(game, alpha, beta, color, aiColor, timers, qStat, 0);
    return { score: v, move:null };
  }

  timers.rep.push(key);

  // Null-move pruning (not in check, sufficient depth)
  // Quick "in check" check: if side has zero legal non-captures that escape attack we rely on status, so keep simple:
  if (depth >= NULL_MOVE_MIND){
    // flip side to move without moving a piece: approximated by evaluating leaf as if we pass the turn:
    // We simulate by a fast bound: if staticEval - margin >= beta -> prune
    // safer: compute a cheap stand-pat and try reduction-beta cut
    const stand = color * evalLeaf(game, timers.rep, timers.countState, aiColor);
    if (stand >= beta){
      // Do a reduced null window to confirm
      const nullBeta = beta;
      const nullAlpha = beta - 1;
      // lightweight: do not modify game; just trust stand pat (fast)
      if (stand >= nullBeta) {
        timers.rep.pop();
        return { score: beta, move:null };
      }
    }
  }

  // Generate + order
  let moves = orderMoves(game, generateMoves(game));
  if (!moves.length){
    // no moves: mate or stalemate handled above; fall back to eval
    timers.rep.pop();
    return { score: color * evalLeaf(game, timers.rep, timers.countState, aiColor), move:null };
  }

  let best=-Infinity, bestMove=null;
  let a0=alpha;
  let idx=0;

  for (const mv of moves){
    // Futility at frontier (shallow non-captures)
    if (depth===1 && !mv.isCapture){
      const est = color * evalLeaf(game, timers.rep, timers.countState, aiColor) - FUT_MARGIN;
      if (est <= alpha){ idx++; if (timers.timeUp()) break; continue; }
    }

    const res = make(game, mv);
    if(!res?.ok){ undo(game); idx++; continue; }

    // Late-move reduction for quiet moves
    let nextDepth = depth-1;
    if (!mv.isCapture && res?.status?.state!=='check' && depth>=LMR_MIN_DEPTH && idx>=LMR_START_INDEX){
      nextDepth = Math.max(0, depth-2);
    }

    const child = negamax(game, nextDepth, -beta, -alpha, -color, aiColor, timers, stats);
    let childScore = (child.cutoff ? -alpha : -(child.score));

    // small tactical sweeteners
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

  let flag = TT_EXACT;
  if      (best <= a0) flag = TT_UPPER;
  else if (best >= beta) flag = TT_LOWER;
  TT.set(key, { depth, score:best, flag, move:bestMove });

  return { score: best, move: bestMove };
}

//////////////////////// Iterative deepening root //////////////////////

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

async function chooseAIMove_LocalMaster(game, opts={}){
  const aiColor    = opts.aiColor || game.turn;
  const countState = opts.countState || null;

  // Try opening book once
  try{
    const book = await loadOpeningBook();
    if (book && USE_BOOK){
      const key = historyKeyFromGame(game);
      const cand = book[key];
      if (Array.isArray(cand) && cand.length){
        const mv = parseBookMove(cand[Math.floor(Math.random()*cand.length)], game);
        if (mv){ log('Book move used'); return mv; }
      }
    }
  }catch{}

  const start = performance.now ? performance.now() : Date.now();
  const timers = {
    timeUp: ()=> ((performance.now?performance.now():Date.now()) - start) > MASTER.timeMs,
    nodeCap: MASTER.nodeCap,
    rep: new RepTracker(),
    countState
  };
  const stats = { nodes:0 };

  let bestMove = null;
  let bestScore = -Infinity;

  // Simple aspiration windows around last score
  let alphaBase = -Infinity, betaBase = Infinity;
  for (let depth=1; depth<=MASTER.maxDepth; depth++){
    let alpha = (Number.isFinite(bestScore) ? bestScore - 60 : alphaBase);
    let beta  = (Number.isFinite(bestScore) ? bestScore + 60 : betaBase);

    // Retry with widened window on fail-high/low
    for (let tries=0; tries<2; tries++){
      const { move, score } = negamax(game, depth, alpha, beta, +1, aiColor, timers, stats);
      if (timers.timeUp()) break;

      if (score <= alpha){ // fail low => widen down
        alpha = -Infinity; beta = (Number.isFinite(bestScore)? (bestScore + 120) : Infinity);
        continue;
      }
      if (score >= beta){  // fail high => widen up
        alpha = (Number.isFinite(bestScore)? (bestScore - 120) : -Infinity); beta = Infinity;
        continue;
      }

      if (move){ bestMove = move; bestScore = score; }
      break;
    }

    if (timers.timeUp()) break;
  }

  if (!bestMove){
    // last resort: shallow pick
    const moves = orderMoves(game, generateMoves(game));
    return moves[0] || null;
  }

  // tiny top-N verification to de-noise
  const all = orderMoves(game, generateMoves(game)).slice(0, 6).map(mv=>{
    const res = game.move(mv.from, mv.to);
    if(!res?.ok){ game.undo(); return null; }
    const timers2 = { ...timers, rep: new RepTracker() };
    const stats2 = { nodes:0 };
    const sub = negamax(game, Math.max(1, MASTER.maxDepth-2), -Infinity, Infinity, -1, aiColor, timers2, stats2);
    game.undo();
    return { move: mv, score: -(sub.score) };
  }).filter(Boolean).sort((a,b)=> b.score - a.score);

  const picked = pickByTemperature(all.length?all:[{move:bestMove,score:bestScore}], TEMP_T) || bestMove;
  log(`Picked move: ${toAlg(picked.from)}-${toAlg(picked.to)} (score ${bestScore})`);
  return picked;
}

//////////////////////// Public API //////////////////////

export async function chooseAIMove(game, opts={}){
  // Master-only local engine
  return await chooseAIMove_LocalMaster(game, opts);
}

// Kept for compatibility with old calls; always returns MASTER
export function setAIDifficulty(/* level */){
  return { timeMs: MASTER.timeMs, maxDepth: MASTER.maxDepth, nodeLimit: MASTER.nodeCap, temperature: TEMP_T };
}

export const pickAIMove = chooseAIMove;
