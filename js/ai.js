// js/ai.js — Khmer/Makruk Pro AI (Iterative, Time-Capped, Khmer Eval)
// Levels: Easy | Medium | Hard | Master
// Uses weighted Khmer opening book at assets/book-khmer.json (optional)

const USE_BOOK = true;
const BOOK_URL = 'assets/book-khmer.json';

// Search config (depth, node caps, think time per move)
const SEARCH_DEPTH = { Easy: 2, Medium: 3, Hard: 4, Master: 5 };
const NODE_LIMIT   = { Easy: 6000, Medium: 18000, Hard: 36000, Master: 90000 };
const THINK_MS     = { Easy:  40,  Medium: 120,   Hard: 180,   Master: 260 }; // soft caps

// Quiescence caps
const Q_NODE_LIMIT = 25000;
const Q_DEPTH_MAX  = 7;

// Values & type map (Khmer aliases)
const VAL = { P:100, N:320, B:330, R:520, Q:880, K:0 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };
function T(t){ return TYPE_MAP[t] || t; }

// Khmer-flavored Piece-Square Tables (coarse; 0..7 ranks from White POV)
const PST = {
  // Encourage center & advancement for fish (pawns), a bit more than chess
  P: [
    [  0,  4,  6,  8,  8,  6,  4,  0],
    [  2,  6,  9, 11, 11,  9,  6,  2],
    [  3,  8, 12, 14, 14, 12,  8,  3],
    [  4, 10, 14, 16, 16, 14, 10,  4],
    [  3,  8, 12, 15, 15, 12,  8,  3],
    [  2,  6,  9, 11, 11,  9,  6,  2],
    [  1,  2,  3,  4,  4,  3,  2,  1],
    [  0,  0,  0,  0,  0,  0,  0,  0],
  ],
  // Horses like outposts
  N: [
    [ -6, -2,  0,  2,  2,  0, -2, -6],
    [ -2,  2,  5,  7,  7,  5,  2, -2],
    [  0,  5,  8, 10, 10,  8,  5,  0],
    [  2,  7, 10, 12, 12, 10,  7,  2],
    [  2,  7, 10, 12, 12, 10,  7,  2],
    [  0,  4,  7,  9,  9,  7,  4,  0],
    [ -3,  0,  3,  5,  5,  3,  0, -3],
    [ -6, -3, -1,  1,  1, -1, -3, -6],
  ],
  // Khon (general) likes center and one-step forward utility
  B: [
    [ -3, -1,  0,  1,  1,  0, -1, -3],
    [ -1,  1,  2,  3,  3,  2,  1, -1],
    [  0,  2,  4,  5,  5,  4,  2,  0],
    [  1,  3,  5,  7,  7,  5,  3,  1],
    [  1,  3,  5,  7,  7,  5,  3,  1],
    [  0,  2,  4,  5,  5,  4,  2,  0],
    [ -1,  1,  2,  3,  3,  2,  1, -1],
    [ -3, -1,  0,  1,  1,  0, -1, -3],
  ],
  R: [
    [  0,  1,  2,  3,  3,  2,  1,  0],
    [  1,  3,  4,  6,  6,  4,  3,  1],
    [  1,  4,  6,  8,  8,  6,  4,  1],
    [  1,  4,  7,  9,  9,  7,  4,  1],
    [  1,  4,  7,  9,  9,  7,  4,  1],
    [  1,  4,  6,  8,  8,  6,  4,  1],
    [  1,  3,  4,  6,  6,  4,  3,  1],
    [  0,  1,  2,  3,  3,  2,  1,  0],
  ],
  Q: [
    [ -2, -1,  0,  1,  1,  0, -1, -2],
    [ -1,  1,  2,  3,  3,  2,  1, -1],
    [  0,  2,  4,  6,  6,  4,  2,  0],
    [  1,  3,  6,  8,  8,  6,  3,  1],
    [  1,  3,  6,  8,  8,  6,  3,  1],
    [  0,  2,  4,  6,  6,  4,  2,  0],
    [ -1,  1,  2,  3,  3,  2,  1, -1],
    [ -2, -1,  0,  1,  1,  0, -1, -2],
  ],
  K: [
    [ -6, -6, -6, -6, -6, -6, -6, -6],
    [ -6, -4, -4, -4, -4, -4, -4, -6],
    [ -6, -4, -2, -2, -2, -2, -4, -6],
    [ -6, -4, -2,  0,  0, -2, -4, -6],
    [ -6, -4, -2,  0,  0, -2, -4, -6],
    [ -6, -4, -2, -2, -2, -2, -4, -6],
    [ -6, -4, -4, -4, -4, -4, -4, -6],
    [ -6, -6, -6, -6, -6, -6, -6, -6],
  ],
};

// Book support (weighted arrays)
let _book = null;
async function loadOpeningBook(){
  if (!USE_BOOK) return {};
  if (_book) return _book;
  try{ const r = await fetch(BOOK_URL); _book = await r.json(); }catch{ _book = {}; }
  return _book;
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
  for (const m of legals) if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
  return null;
}

// Helpers
function centerBias(sq){ const cx=Math.abs(3.5-sq.x), cy=Math.abs(3.5-sq.y); return 8-(cx+cy); }
function make(game,m){ return game.move(m.from,m.to); }
function undo(game){ game.undo(); }

// Transposition table + killers/history + timers
const TT = new Map();
const killers = Array.from({length:128}, ()=>[null,null]);
const hist = Object.create(null);
function sameMove(a,b){ return !!a && !!b && a.from.x===b.from.x && a.from.y===b.from.y && a.to.x===b.to.x && a.to.y===b.to.y; }
function addHistory(mv, depth){ const k=`${mv.from.x}${mv.from.y}${mv.to.x}${mv.to.y}`; hist[k]=(hist[k]||0)+depth*depth; }
function histScore(mv){ const k=`${mv.from.x}${mv.from.y}${mv.to.x}${mv.to.y}`; return hist[k]||0; }

// Move generation (captures flag + quick ordering)
function generateMoves(game){
  const out=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p||p.c!==game.turn) continue;
    const tt=T(p.t);
    const legals=game.legalMoves(x,y);
    for(const m of legals){
      const t=game.at(m.x,m.y);
      out.push({
        from:{x,y}, to:{x:m.x,y:m.y},
        cap:t? (VAL[T(t.t)]||0) : 0,
        isPawnPush:(tt==='P' && m.y!==y)
      });
    }
  }
  out.sort((a,b)=>{
    if (b.cap!==a.cap) return b.cap-a.cap;
    return centerBias(b.to)-centerBias(a.to);
  });
  return out;
}
function generateCaptures(game){
  const out=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p||p.c!==game.turn) continue;
    const legals=game.legalMoves(x,y);
    for(const m of legals){
      const t=game.at(m.x,m.y);
      if (!t) continue;
      out.push({from:{x,y}, to:{x:m.x,y:m.y}});
    }
  }
  return out;
}

// Evaluation (material + PST + simple features)
function materialSide(game,c){
  let s=0;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p||p.c!==c) continue;
    const tt=T(p.t); if (tt!=='K') s += VAL[tt]||0;
  }
  return s;
}
function materialEval(game){ return materialSide(game,'w') - materialSide(game,'b'); }

function pstEval(game){
  let e=0;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p) continue;
    const tt=T(p.t), v=VAL[tt]||0;
    // PST index from White’s POV; mirror for Black
    const row = (p.c==='w') ? y : (7-y);
    const bonus = (PST[tt] ? PST[tt][row][x] : 0);
    e += (p.c==='w' ? (v + bonus) : -(v + bonus));
  }
  return e;
}

function mobilityEval(game){
  let count=0, cap=32;
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const p=game.at(x,y); if(!p||p.c!==game.turn) continue;
      count += game.legalMoves(x,y).length;
      if (count >= cap) break;
    }
  }
  return (game.turn==='w'?+1:-1)*Math.min(cap, count);
}

function passedFishBonus(game){
  // very light: award advancing fish with no enemy fish ahead on same file
  let score=0;
  for(let x=0;x<8;x++){
    let bestW=-1, bestB=-1;
    for(let y=0;y<8;y++){
      const p=game.at(x,y);
      if(!p || T(p.t)!=='P') continue;
      if(p.c==='w') bestW = Math.max(bestW, 7-y);
      else bestB = Math.max(bestB, y);
    }
    if (bestW>=0 && bestB<=(6-bestW)) score += 6 + bestW; // white passed
    if (bestB>=0 && bestW<=(6-bestB)) score -= (6 + bestB); // black passed
  }
  return score;
}

function rookOpenFile(game){
  // tiny bonus if rook has no friendly fish on same file blocking
  let score=0;
  for(let x=0;x<8;x++){
    let wPawn=false,bPawn=false, wR=false,bR=false;
    for(let y=0;y<8;y++){
      const p=game.at(x,y); if(!p) continue;
      const tt=T(p.t);
      if(tt==='P'){ if(p.c==='w') wPawn=true; else bPawn=true; }
      if(tt==='R'){ if(p.c==='w') wR=true; else bR=true; }
    }
    if (wR && !wPawn) score += 8;
    if (bR && !bPawn) score -= 8;
  }
  return score;
}

function kingSafety(game){
  // discourage exposed kings (very light)
  const adj = [[0,1],[1,0],[-1,0],[1,1],[-1,1],[1,-1],[-1,-1],[0,-1]];
  function ring(c){
    let sc=0, k=null;
    outer: for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const p=game.at(x,y); if(p&&p.c===c && T(p.t)==='K'){ k={x,y}; break outer; }
    }
    if(!k) return 0;
    for(const [dx,dy] of adj){
      const nx=k.x+dx, ny=k.y+dy;
      if(nx<0||ny<0||nx>7||ny>7) continue;
      const q=game.at(nx,ny);
      if(q && q.c===c) sc += 1;
    }
    return sc;
  }
  return (ring('w') - ring('b')) * 2; // more friendly ring = safer
}

function staticEval(game){
  // combine terms
  return materialEval(game)
       + pstEval(game)
       + mobilityEval(game)
       + passedFishBonus(game)
       + rookOpenFile(game)
       + kingSafety(game);
}

// Quiescence
function quiesce(game,alpha,beta,color,qNodes,depth=0){
  if(qNodes.count++>Q_NODE_LIMIT || depth>Q_DEPTH_MAX) return color * staticEval(game);
  let stand = color * staticEval(game);
  if(stand>=beta) return beta;
  if(stand>alpha) alpha=stand;
  const caps=generateCaptures(game);
  for(const mv of caps){
    const res=make(game,mv); if(!res?.ok){undo(game);continue;}
    const score = -quiesce(game,-beta,-alpha,-color,qNodes,depth+1);
    undo(game);
    if(score>=beta) return beta;
    if(score>alpha) alpha=score;
  }
  return alpha;
}

// Negamax with LMR, killers/history, TT
function search(game, depth, alpha, beta, color, budget, stats, ply, deadline){
  if (stats.nodes++ > budget.limit) return {score:0, move:null, cutoff:true};
  if (deadline && performance.now() > deadline) return {score:0, move:null, cutoff:true};

  if (depth === 0){
    const qNodes={count:0};
    return { score: quiesce(game, alpha, beta, color, qNodes, 0), move:null };
  }

  const key = posKey(game);
  const cached = TT.get(key);
  if (cached && cached.depth >= depth) return { score: cached.score, move: cached.move };

  const moves = generateMoves(game);
  if (!moves.length) return { score: color * staticEval(game), move:null };

  // killer/history ordering
  const ks = killers[ply%killers.length];
  moves.sort((a,b)=>{
    const isKa = sameMove(a,ks[0])||sameMove(a,ks[1]) ? 1:0;
    const isKb = sameMove(b,ks[0])||sameMove(b,ks[1]) ? 1:0;
    if (isKa!==isKb) return isKb - isKa;
    return (histScore(b) - histScore(a));
  });

  let best=-Infinity, bestMove=null;
  let localAlpha = alpha;
  let idx=0;

  for (const mv of moves){
    const res = make(game, mv); if(!res?.ok){ undo(game); continue; }

    // Late Move Reduction: reduce depth on quiet, late moves
    const isCapture = !!res.captured;
    const gaveCheck = res?.status?.state==='check';
    const doLMR = (depth>=3 && idx>=4 && !isCapture && !gaveCheck);
    const nextDepth = doLMR ? depth-2 : depth-1;

    const child = search(game, nextDepth, -beta, -localAlpha, -color, budget, stats, ply+1, deadline);
    let score = -(child.score);

    // if reduced search raises alpha, re-search full depth once
    if (doLMR && score > localAlpha) {
      const retry = search(game, depth-1, -beta, -localAlpha, -color, budget, stats, ply+1, deadline);
      score = -(retry.score);
    }

    undo(game);
    if (score > best){ best=score; bestMove=mv; }
    if (best > localAlpha) localAlpha = best;
    if (localAlpha >= beta){
      if (!isCapture){ // record killer on quiet cutoff
        const arr = killers[ply%killers.length];
        if (!sameMove(arr[0], mv)) { arr[1]=arr[0]; arr[0]=mv; }
      }
      break;
    }
    idx++;
  }

  if (bestMove) addHistory(bestMove, depth);
  TT.set(key, { depth, score:best, move:bestMove });
  return { score:best, move:bestMove };
}

function posKey(game){
  let s='';
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const p=game.at(x,y);
      s += p ? (p.c + T(p.t)) : '.';
    }
    s+='/';
  }
  return s + ' ' + game.turn;
}

// Iterative deepening with soft time cap
async function searchIterative(game, maxDepth, nodeCap, msCap){
  const budget = { limit: nodeCap };
  const stats  = { nodes: 0 };
  const deadline = performance.now() + (msCap || 0);

  let bestMove = null, bestScore = 0;
  for (let d=1; d<=maxDepth; d++){
    const r = search(game, d, -Infinity, Infinity, +1, budget, stats, 0, msCap?deadline:null);
    if (r.cutoff) break;
    if (r.move){ bestMove = r.move; bestScore = r.score; }
    // small aspiration: if close to time or nodes, stop
    if ((msCap && performance.now() > deadline-8) || stats.nodes > budget.limit*0.9) break;
  }
  // console.debug(`[AI] depth=${maxDepth} nodes=${stats.nodes} score=${bestScore|0}`);
  return bestMove;
}

/* ====================== Public API ====================== */
export async function chooseAIMove(game, opts={}){
  const level = opts.level || 'Medium';

  // 1) Khmer weighted book
  try{
    const book = await loadOpeningBook();
    const key  = historyKeyFromGame(game);
    const list = book[key];
    if (Array.isArray(list) && list.length){
      // weighted array already duplicated — random pick is weighted
      const pick = list[(Math.random() * list.length) | 0];
      const mv = parseBookMove(pick, game);
      if (mv) return mv;
    }
  }catch{/* ignore */}

  // 2) Engine (iterative, time-capped)
  const maxDepth = SEARCH_DEPTH[level] ?? 3;
  const nodeCap  = NODE_LIMIT[level] ?? 20000;
  const msCap    = THINK_MS[level] ?? 120;

  const mv = await searchIterative(game, maxDepth, nodeCap, msCap);
  return mv || null;
}

export function setAIDifficulty(level){
  return {
    depth: SEARCH_DEPTH[level] ?? 3,
    nodeLimit: NODE_LIMIT[level] ?? 20000,
    thinkMs: THINK_MS[level] ?? 120
  };
}

// Back-compat alias (your UI imports pickAIMove)
export const pickAIMove = chooseAIMove;
