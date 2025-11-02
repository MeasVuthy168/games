// js/ai.js — Khmer Chess "Master++" Engine (no WASM)
// API (unchanged):
//   - chooseAIMove(game, { aiColor: 'w'|'b', countState })
//   - setAIDifficulty(level) -> returns active Master config
//   - pickAIMove alias

//////////////////////// Master++ Tunables //////////////////////

const MASTER = {
  timeMs:   1500,    // per-move budget (avg). Tune up/down for strength/speed.
  maxDepth: 9,       // hard ceiling (iterative deepening will try to reach this)
  nodeCap:  400_000, // absolute guardrail
};

const USE_BOOK   = true;
const BOOK_URL   = 'assets/book-khmer.json';
const TEMP_T     = 0.00;

// Pruning / reductions
const FUT_MARGIN_BASE = 120;   // futility base margin at depth 1
const RAZOR_MARGIN    = 220;   // razoring margin
const Q_NODE_CAP      = 40_000;
const Q_DEPTH_MAX     = 8;
const LMR_MIN_DEPTH   = 3;
const LMR_BASE_RED    = 1.0;   // base reduction for late quiets
const NULL_MOVE_R     = 2;
const NULL_MOVE_MIND  = 3;

// Repetition control (kept)
const REP_SHORT_WINDOW=8, REP_SOFT_PENALTY=15, REP_HARD_PENALTY=220;

// Counting-draw synergy (kept)
const COUNT_BURN_PENALTY=12, COUNT_RESEED_BONUS=80, COUNT_URGENT_NEAR=3;

// Piece values (mapped via TYPE_MAP)
const VAL = { P:100, N:320, B:330, R:500, Q:900, K:10000 };
const ATTACKER_VAL = { P:100, N:320, B:330, R:500, Q:900, K:10000 };

// Khmer piece aliases → normalized
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };
function normType(t){ return TYPE_MAP[t] || t; }

//////////////////////// Debug hook //////////////////////

const log = (s, kind) => { try{ window.__dbglog?.(`[AI] ${s}`, kind); }catch{} };

//////////////////////// Opening book ////////////////////

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

//////////////////////// Zobrist hashing //////////////////////

// Deterministic PRNG
let _seed = 0x9e3779b1|0;
function rnd32(){
  _seed |= 0; _seed = (_seed + 0x6D2B79F5)|0;
  let t = Math.imul(_seed ^ (_seed>>>15), 1 | _seed);
  t ^= t + Math.imul(t ^ (t>>>7), 61 | t);
  return (t ^ (t>>>14)) >>> 0;
}

// Zobrist table [y][x][pieceIndex], plus side-to-move
const Z = { table: [], side: rnd32() };
const Z_PIECES = []; // map piece code "wP", "bQ", etc. to index
(function initZobrist(){
  const kinds = ['P','N','B','R','Q','K'];
  const colors = ['w','b'];
  colors.forEach(c=> kinds.forEach(k=> Z_PIECES.push(c+k)));
  for (let y=0;y<8;y++){
    Z.table[y]=[];
    for(let x=0;x<8;x++){
      Z.table[y][x]=new Uint32Array(Z_PIECES.length);
      for (let i=0;i<Z_PIECES.length;i++) Z.table[y][x][i]=rnd32();
    }
  }
})();

function pieceIndex(p){
  if (!p) return -1;
  const t = normType(p.t);
  const key = p.c + t;
  const idx = Z_PIECES.indexOf(key);
  return idx;
}

function zobrist(game){
  let h=0>>>0;
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y);
      const idx = pieceIndex(p);
      if (idx>=0) h ^= Z.table[y][x][idx];
    }
  }
  if (game.turn==='w') h ^= Z.side;
  return h>>>0;
}

//////////////////////// Repetition //////////////////////

class RepTracker{
  constructor(){ this.list=[]; }
  push(k){ this.list.push(k); if(this.list.length>200) this.list.shift(); }
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

//////////////////////// Counting synergy //////////////////////

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

//////////////////////// Mild PST & phase //////////////////////

const PST = {
  P: [
    0,  6,  6,  8,  8,  6,  6,  0,
    2,  6,  8, 12, 12,  8,  6,  2,
    1,  4,  6, 10, 10,  6,  4,  1,
    0,  2,  4,  6,  6,  4,  2,  0,
    0,  2,  3,  4,  4,  3,  2,  0,
    0,  2,  2,  2,  2,  2,  2,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0
  ],
  N: [
    -6,-2,  0,  2,  2,  0, -2, -6,
    -2, 0,  2,  4,  4,  2,  0, -2,
     0, 2,  6,  8,  8,  6,  2,  0,
     2, 4,  8, 10, 10,  8,  4,  2,
     2, 4,  8, 10, 10,  8,  4,  2,
     0, 2,  6,  8,  8,  6,  2,  0,
    -2, 0,  2,  4,  4,  2,  0, -2,
    -6,-2,  0,  2,  2,  0, -2, -6
  ],
  B: [
     0,  0,  2,  4,  4,  2,  0,  0,
     0,  2,  3,  6,  6,  3,  2,  0,
     2,  3,  6,  8,  8,  6,  3,  2,
     2,  4,  8, 10, 10,  8,  4,  2,
     2,  4,  8, 10, 10,  8,  4,  2,
     2,  3,  6,  8,  8,  6,  3,  2,
     0,  2,  3,  6,  6,  3,  2,  0,
     0,  0,  2,  4,  4,  2,  0,  0
  ],
  R: [
     2,  4,  4,  6,  6,  4,  4,  2,
     3,  6,  6,  8,  8,  6,  6,  3,
     2,  4,  4,  6,  6,  4,  4,  2,
     1,  2,  2,  4,  4,  2,  2,  1,
     1,  2,  2,  4,  4,  2,  2,  1,
     0,  2,  2,  3,  3,  2,  2,  0,
     0,  0,  0,  2,  2,  0,  0,  0,
     0,  0,  0,  1,  1,  0,  0,  0
  ],
  Q: [
     0,  1,  2,  3,  3,  2,  1,  0,
     1,  2,  3,  4,  4,  3,  2,  1,
     2,  3,  5,  6,  6,  5,  3,  2,
     3,  4,  6,  8,  8,  6,  4,  3,
     3,  4,  6,  8,  8,  6,  4,  3,
     2,  3,  5,  6,  6,  5,  3,  2,
     1,  2,  3,  4,  4,  3,  2,  1,
     0,  1,  2,  3,  3,  2,  1,  0
  ],
  K: [
    -4, -2, -2, -1, -1, -2, -2, -4,
    -2,  0,  0,  0,  0,  0,  0, -2,
    -2,  0,  1,  1,  1,  1,  0, -2,
    -1,  0,  1,  2,  2,  1,  0, -1,
    -1,  0,  1,  2,  2,  1,  0, -1,
    -2,  0,  1,  1,  1,  1,  0, -2,
    -2,  0,  0,  0,  0,  0,  0, -2,
    -4, -2, -2, -1, -1, -2, -2, -4
  ]
};

function idx(x,y){ return (y<<3)|x; }

//////////////////////// Evaluation //////////////////////

function materialSide(game, side){
  let s=0;
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p || p.c!==side) continue;
    s += VAL[normType(p.t)]||0;
  }
  return s;
}
function materialEval(game){ return materialSide(game,'w') - materialSide(game,'b'); }

function pstEval(game){
  let score=0;
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const p=game.at(x,y); if(!p) continue;
      const t=normType(p.t); const tbl=PST[t];
      if (!tbl) continue;
      const i = p.c==='w' ? idx(x,y) : idx(7-x,7-y);
      score += (p.c==='w'? +1 : -1) * tbl[i];
    }
  }
  return score;
}

function mobilityEval(game){
  // limited & cheap mobility proxy
  let moves=0;
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y); if(!p || p.c!==game.turn) continue;
      moves += game.legalMoves(x,y).length;
      if (moves>=28) break;
    }
  }
  return (game.turn==='w'?+1:-1)*Math.min(moves,28);
}

function evalLeaf(game, rep, countState, aiColor){
  const mat = materialEval(game);
  const pst = pstEval(game);
  const mob = mobilityEval(game);
  let score = mat + pst + mob + repetitionPenalty(rep, zobrist(game));
  const lead = (aiColor==='w'?mat:-mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }
  return score;
}

//////////////////////// SEE (fast, conservative) //////////////////////

function see(game, from, to){
  const attacker= game.at(from.x,from.y);
  const target  = game.at(to.x,to.y);
  if (!attacker || !target) return 0;
  const atkV = VAL[normType(attacker.t)]||0;
  let gain   = (VAL[normType(target.t)]||0) - atkV;
  const opp  = (game.turn==='w'?'b':'w');
  if (game.squareAttacked(to.x,to.y, opp)) gain -= 40;
  return gain;
}

//////////////////////// Move gen + ordering //////////////////////

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
          _hs: 0
        });
      }
    }
  }
  return out;
}

//////////////////////// TT, Killer, History //////////////////////

const TT = new Map(); // key -> {depth, score, flag, move, age}
const TT_EXACT=0, TT_LOWER=1, TT_UPPER=2;

const KILLER = Array.from({length:128},()=>[null,null]); // two per ply
const HIST   = new Map(); // key "fxfy-tx ty" -> score

function histKey(m){ return ((m.from.x<<6)|(m.from.y<<3)|m.to.x) + (m.to.y<<9); }
function histGet(k){ return HIST.get(k)|0; }
function histAdd(k, v){ HIST.set(k, Math.min(50000, (HIST.get(k)|0)+v)); }

function orderMoves(game, moves, ttMove, ply){
  for (const mv of moves){
    let score = 0;
    if (ttMove && mv.from.x===ttMove.from.x && mv.from.y===ttMove.from.y && mv.to.x===ttMove.to.x && mv.to.y===ttMove.to.y){
      score = 3_000_000; // hash move first
    } else if (mv.isCapture){
      score = 2_000_000 + mv.mvv*12 - mv.lva;
      if (mv.mvv >= 300) score += see(game, mv.from, mv.to);
    } else {
      // killer?
      const k0=KILLER[ply][0], k1=KILLER[ply][1];
      if (k0 && mv.from.x===k0.from.x && mv.from.y===k0.from.y && mv.to.x===k0.to.x && mv.to.y===k0.to.y) score = 1_000_500;
      else if (k1 && mv.from.x===k1.from.x && mv.from.y===k1.from.y && mv.to.x===k1.to.x && mv.to.y===k1.to.y) score = 1_000_400;
      else score = 200_000 + histGet(histKey(mv)) + mv.center;
    }
    mv._hs = score;
  }
  moves.sort((a,b)=> b._hs - a._hs);
  return moves;
}

//////////////////////// Helpers //////////////////////

function make(game,m){ return game.move(m.from,m.to); }
function undo(game){ game.undo(); }

//////////////////////// Quiescence //////////////////////

function quiesce(game, alpha, beta, color, aiColor, timers, qStat, depthQ=0, allowChecks=true){
  if (timers.timeUp()) return alpha;
  if (qStat.nodes++ > Q_NODE_CAP || depthQ>Q_DEPTH_MAX) return color * evalLeaf(game, timers.rep, null, aiColor);

  // Stand pat
  let stand = color * evalLeaf(game, timers.rep, null, aiColor);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  // Delta pruning for hopeless small captures
  const delta = 975; // queen-ish margin
  if (stand + delta < alpha) return alpha;

  // Captures (+ optionally checking moves)
  let moves = generateMoves(game).filter(m=>m.isCapture);
  if (allowChecks) {
    // add checking quiets lightly: we detect by result status
    const quiets = generateMoves(game).filter(m=>!m.isCapture);
    // only consider top 2 quiets by center bias to probe checks quickly
    quiets.sort((a,b)=> b.center - a.center);
    moves = moves.concat(quiets.slice(0,2));
  }
  orderMoves(game, moves, null, 0);

  for (const mv of moves){
    // Simple futility inside q-search: skip tiny captures far below alpha
    if (mv.isCapture===false) {
      // only keep if it gives check
    }

    const res = make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const givesCheck = (res?.status?.state==='check');
    if (!mv.isCapture && !givesCheck){ undo(game); continue; }

    const score = -quiesce(game, -beta, -alpha, -color, aiColor, timers, qStat, depthQ+1, allowChecks && givesCheck);
    undo(game);

    if (score >= beta) return beta;
    if (score > alpha) alpha = score;

    if (timers.timeUp()) break;
  }
  return alpha;
}

//////////////////////// Negamax + PVS //////////////////////

function negamax(game, depth, alpha, beta, color, aiColor, timers, stats, ply, allowNull=true){
  if (timers.timeUp() || stats.nodes++ > timers.nodeCap) return { score: 0, move:null, cutoff:true, pv:null };

  // terminal?
  const st = game?.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate') return { score: color * (-100000 + ply), move:null, pv:null };
    return { score: 0, move:null, pv:null };
  }

  const key = zobrist(game);
  const tt = TT.get(key);
  let ttMove = tt?.move || null;
  if (tt && tt.depth >= depth){
    let v = tt.score;
    if (tt.flag===TT_EXACT) return { score:v, move:ttMove, pv:null };
    if (tt.flag===TT_LOWER && v > alpha) alpha = v;
    else if (tt.flag===TT_UPPER && v < beta) beta = v;
    if (alpha >= beta) return { score:v, move:ttMove, pv:null };
  }

  if (depth===0){
    const qStat = { nodes:0 };
    const v = quiesce(game, alpha, beta, color, aiColor, timers, qStat, 0, true);
    return { score: v, move:null, pv:null };
  }

  // Razoring (shallow, safe)
  if (depth===1){
    const sp = color * evalLeaf(game, timers.rep, timers.countState, aiColor);
    if (sp + RAZOR_MARGIN <= alpha){
      const qStat = { nodes:0 };
      const v = quiesce(game, alpha, beta, color, aiColor, timers, qStat, 0, false);
      if (v <= alpha) return { score:v, move:null, pv:null };
    }
  }

  // Null-move pruning (not in check)
  if (allowNull && depth>=NULL_MOVE_MIND){
    const stand = color * evalLeaf(game, timers.rep, timers.countState, aiColor);
    if (stand >= beta){
      // verify with reduced shallow search (no real null move available in this API)
      return { score: beta, move:null, pv:null };
    }
  }

  // Generate + order
  let moves = orderMoves(game, generateMoves(game), ttMove, ply);
  if (!moves.length){
    // No legal moves: return static eval (safety)
    return { score: color * evalLeaf(game, timers.rep, timers.countState, aiColor), move:null, pv:null };
  }

  let best=-Infinity, bestMove=null, pvLine=null;
  const a0=alpha;
  let idx=0;

  // PVS
  for (const mv of moves){
    // Frontier futility for quiets at depth 1
    if (depth===1 && !mv.isCapture){
      const est = color * evalLeaf(game, timers.rep, timers.countState, aiColor) - (FUT_MARGIN_BASE);
      if (est <= alpha){ idx++; if (timers.timeUp()) break; continue; }
    }

    const res = make(game, mv);
    if(!res?.ok){ undo(game); idx++; continue; }

    // Late move reduction for quiets not giving check
    let nextDepth = depth-1;
    let reduced = false;
    if (!mv.isCapture && res?.status?.state!=='check' && depth>=LMR_MIN_DEPTH && idx>=3){
      const red = Math.min(2, 1 + ((idx>7)|0)) * LMR_BASE_RED;
      nextDepth = Math.max(0, depth-1 - red|0);
      reduced = nextDepth < depth-1;
    }

    // First move: full window; others: PVS zero-window then re-search on fail-high
    let child;
    if (idx===0){
      child = negamax(game, nextDepth, -beta, -alpha, -color, aiColor, timers, stats, ply+1, true);
    } else {
      child = negamax(game, nextDepth, -alpha-1, -alpha, -color, aiColor, timers, stats, ply+1, true);
      if (!child.cutoff && child.score > alpha){
        // re-search with full window
        child = negamax(game, nextDepth, -beta, -alpha, -color, aiColor, timers, stats, ply+1, true);
      }
    }

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
      if (best > alpha){
        alpha = best;
        pvLine = child?.pv ? [mv, ...child.pv] : [mv];
      }
      if (alpha >= beta){
        // store killer move for quiet beta cutoffs
        if (!mv.isCapture){
          const kslot = KILLER[ply];
          if (!kslot[0] || !(kslot[0].from.x===mv.from.x && kslot[0].from.y===mv.from.y && kslot[0].to.x===mv.to.x && kslot[0].to.y===mv.to.y)){
            kslot[1]=kslot[0]; kslot[0]={from:mv.from,to:mv.to};
          }
          histAdd(histKey(mv), depth*depth);
        }
        break;
      }
    }

    idx++;
    if (timers.timeUp()) break;
  }

  // TT store
  let flag = TT_EXACT;
  if      (best <= a0) flag = TT_UPPER;
  else if (best >= beta) flag = TT_LOWER;
  TT.set(key, { depth, score:best, flag, move:bestMove, age:0 });

  return { score: best, move: bestMove, pv: pvLine };
}

//////////////////////// Iterative deepening //////////////////////

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

  // Opening book
  try{
    const book = await loadOpeningBook();
    if (book && USE_BOOK){
      const key = historyKeyFromGame(game);
      const cand = book[key];
      if (Array.isArray(cand) && cand.length){
        const mv = parseBookMove(cand[Math.floor(Math.random()*cand.length)], game);
        if (mv){ log('Book move'); return mv; }
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
  let lastScore = 0;

  // aspiration window around lastScore
  for (let depth=1; depth<=MASTER.maxDepth; depth++){
    let alpha = (depth>2 ? lastScore - 60 : -Infinity);
    let beta  = (depth>2 ? lastScore + 60 :  Infinity);

    // 2 retries with widened windows
    for (let tries=0; tries<2; tries++){
      const { move, score } = negamax(game, depth, alpha, beta, +1, aiColor, timers, stats, 0, true);
      if (timers.timeUp()) break;

      if (score <= alpha){ alpha = -Infinity; beta = (Number.isFinite(lastScore)? (lastScore + 120) : Infinity); continue; }
      if (score >= beta ){ alpha = (Number.isFinite(lastScore)? (lastScore - 120) : -Infinity); beta = Infinity; continue; }

      if (move){ bestMove = move; bestScore = score; lastScore = score; }
      break;
    }

    if (timers.timeUp()) break;
  }

  if (!bestMove){
    const moves = orderMoves(game, generateMoves(game), null, 0);
    return moves[0] || null;
  }

  // small top-N verification
  const top = orderMoves(game, generateMoves(game), null, 0).slice(0, 6).map(mv=>{
    const res = game.move(mv.from, mv.to);
    if(!res?.ok){ game.undo(); return null; }
    const timers2 = { ...timers, rep: new RepTracker() };
    const stats2 = { nodes:0 };
    const sub = negamax(game, Math.max(1, MASTER.maxDepth-2), -Infinity, Infinity, -1, aiColor, timers2, stats2, 1, true);
    game.undo();
    return { move: mv, score: -(sub.score) };
  }).filter(Boolean).sort((a,b)=> b.score - a.score);

  const picked = pickByTemperature(top.length?top:[{move:bestMove,score:bestScore}], TEMP_T) || bestMove;
  log(`Picked ${toAlg(picked.from)}-${toAlg(picked.to)}; nodes=${stats.nodes}`);
  return picked;
}

//////////////////////// Public API //////////////////////

export async function chooseAIMove(game, opts={}){
  return await chooseAIMove_LocalMaster(game, opts);
}

export function setAIDifficulty(/* level */){
  return { timeMs: MASTER.timeMs, maxDepth: MASTER.maxDepth, nodeLimit: MASTER.nodeCap, temperature: TEMP_T };
}

export const pickAIMove = chooseAIMove;
