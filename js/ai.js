// js/ai.js — Khmer/Makruk-friendly AI (Fast + Smarter)
// - Transposition table (TT), killers, history ordering
// - Quiescence search (captures-only) for sharper tactics
// - Optional Khmer opening book (Makruk-ish starts)
// Public API:
//   chooseAIMove(game, { level:'Easy'|'Medium'|'Hard', aiColor:'w'|'b', countState })
//   setAIDifficulty(level)
//   pickAIMove (alias of chooseAIMove)

const USE_BOOK  = true;
const BOOK_URL  = 'assets/book-khmer.json'; // put your Khmer book here

/* ========================= Difficulty / Limits ========================= */
const SEARCH_DEPTH = { Easy:2, Medium:3, Hard:4 };
const NODE_LIMIT   = { Easy:6000, Medium:16000, Hard:36000 };

const Q_DEPTH_MAX   = 6;       // extra plies inside quiescence
const Q_NODE_LIMIT  = 20000;   // global ceiling for qsearch nodes

/* ============================= Piece values ============================ */
// Western letters are used internally. Your Game maps Khmer roles to these types.
const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 };

// repetition discouragers
const REP_SHORT_WINDOW=8, REP_SOFT_PENALTY=15, REP_HARD_PENALTY=220;
// light progress terms
const BONUS_CAPTURE=30, BONUS_CHECK=18, BONUS_PUSH=6, PENAL_IDLE=8;
// counting-draw (from your UI) friendly nudge
const COUNT_BURN_PENALTY=12, COUNT_RESEED_BONUS=80, COUNT_URGENT_NEAR=3;

/* =============================== Book ================================ */
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
  if ((fx|fy|tx|ty) & ~7) return null;
  const legals = game.legalMoves(fx,fy);
  for (const m of legals) if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
  return null;
}

/* ============================= Utilities ============================== */
function materialSide(game, side){
  let s=0;
  for (let y=0;y<8;y++) for (let x=0;x<8;x++){
    const p=game.at(x,y); if(!p || p.c!==side) continue;
    if (p.t!=='K') s += VAL[p.t]||0;
  }
  return s;
}
function materialEval(game){ return materialSide(game,'w') - materialSide(game,'b'); }

// light mobility, capped for speed
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

// compact position key (sufficient for TT in this app)
function posKey(game){
  let out='';
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y);
      out += p ? (p.c + p.t + (p.moved?1:0)) : '.';
    }
    out += '/';
  }
  return out + ' ' + game.turn;
}

class RepTracker{
  constructor(){ this.list=[]; }
  push(k){ this.list.push(k); if(this.list.length>128) this.list.shift(); }
  pop(){ this.list.pop(); }
  softCount(k){
    let n=0, s=Math.max(0,this.list.length-REP_SHORT_WINDOW);
    for(let i=s;i<this.list.length;i++) if(this.list[i]===k) n++;
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

function moveDeltaBonus(game, mv, captured, gaveCheck){
  let b=0; if(captured) b+=BONUS_CAPTURE; if(gaveCheck) b+=BONUS_CHECK;
  if (mv.isPawnPush) b+=BONUS_PUSH; if(!b) b-=PENAL_IDLE; return b;
}
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

/* ========================= Move generation ============================ */
function centerBias(sq){ const cx=Math.abs(3.5-sq.x), cy=Math.abs(3.5-sq.y); return 8-(cx+cy); }

function generateMoves(game){
  const out=[];
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y);
      if (!p || p.c!==game.turn) continue;
      const legals = game.legalMoves(x,y);
      const isPawn = p.t==='P';
      for (const m of legals){
        const tgt = game.at(m.x,m.y);
        out.push({
          from:{x,y}, to:{x:m.x,y:m.y},
          captureVal: tgt ? (VAL[tgt.t]||0) : 0,
          isPawnPush: isPawn && m.y!==y
        });
      }
    }
  }
  // captures first, then center bias (keeps branch small)
  out.sort((a,b)=>{
    if (b.captureVal!==a.captureVal) return b.captureVal-a.captureVal;
    return centerBias(b.to)-centerBias(a.to);
  });
  return out;
}
function generateCaptures(game){
  const out=[];
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y); if(!p || p.c!==game.turn) continue;
      const legals=game.legalMoves(x,y);
      const isPawn = p.t==='P';
      for (const m of legals){
        const tgt=game.at(m.x,m.y);
        if (!tgt) continue;
        out.push({
          from:{x,y}, to:{x:m.x,y:m.y},
          captureVal: VAL[tgt.t]||0,
          isPawnPush: isPawn && m.y!==y
        });
      }
    }
  }
  out.sort((a,b)=> b.captureVal-a.captureVal);
  return out;
}

/* ================= TT / Killers / History ordering ==================== */
const TT = new Map(); // key -> {depth, score, flag, move}
const TT_EXACT=0, TT_LOWER=1, TT_UPPER=2;

const killers = Array.from({length:64}, ()=>[null,null]); // two killers per ply ring-buffer
const historyScore = Object.create(null);

function sameMove(a,b){
  if(!a||!b) return false;
  return a.from.x===b.from.x && a.from.y===b.from.y && a.to.x===b.to.x && a.to.y===b.to.y;
}
function recordKiller(ply, mv){
  const arr=killers[ply%64];
  if (!arr[0] || !sameMove(arr[0], mv)){ arr[1]=arr[0]; arr[0]=mv; }
}
function addHistory(mv, depth){
  const k=`${mv.from.x}${mv.from.y}${mv.to.x}${mv.to.y}`;
  historyScore[k]=(historyScore[k]||0)+depth*depth;
}
function historyValue(mv){
  const k=`${mv.from.x}${mv.from.y}${mv.to.x}${mv.to.y}`;
  return historyScore[k]||0;
}

/* ============================ Make / Undo ============================== */
function make(game,m){ return game.move(m.from,m.to); }
function undo(game){ game.undo(); }

/* =============================== Eval ================================= */
function evalLeaf(game, rep, countState, aiColor){
  const mat = materialEval(game);
  const mob = mobilityEval(game);
  let score = mat + mob + repetitionPenalty(rep, posKey(game));
  const lead = (aiColor==='w' ? mat : -mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near=Math.max(0, 6-(countState.remaining||0));
    score -= COUNT_BURN_PENALTY*near;
  }
  return score;
}

/* ========================= Quiescence Search ========================== */
function quiesce(game, alpha, beta, color, aiColor, rep, qNodes, qDepth=0){
  if (qNodes.count++ > Q_NODE_LIMIT || qDepth>Q_DEPTH_MAX) return color * evalLeaf(game, rep, null, aiColor);

  let stand = color * evalLeaf(game, rep, null, aiColor);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;

  const caps = generateCaptures(game);
  for (const mv of caps){
    const res = make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const score = -quiesce(game, -beta, -alpha, -color, aiColor, rep, qNodes, qDepth+1);

    undo(game);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/* =============================== Search =============================== */
function negamax(game, depth, alpha, beta, color, aiColor, rep, countState, budget, stats, ply=0){
  if (stats.nodes++ > budget.limit) return { score:0, move:null, cutoff:true };

  const st = game.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate') return { score: color * (-100000 + depth), move:null };
    return { score: 0, move:null };
  }

  const key = posKey(game);
  const ttHit = TT.get(key);
  if (ttHit && ttHit.depth>=depth){
    const v=ttHit.score;
    if (ttHit.flag===TT_EXACT) return { score:v, move:ttHit.move||null };
    if (ttHit.flag===TT_LOWER && v>alpha) alpha=v;
    else if (ttHit.flag===TT_UPPER && v<beta) beta=v;
    if (alpha>=beta) return { score:v, move:ttHit.move||null };
  }

  if (depth===0){
    const qNodes={count:0};
    const v = quiesce(game, alpha, beta, color, aiColor, rep, qNodes, 0);
    return { score:v, move:null };
  }

  rep.push(key);

  // Generate + order moves: TT move, captures, killers, history
  let moves = generateMoves(game);
  if (ttHit?.move){
    moves.sort((a,b)=>{
      const A=sameMove(a,ttHit.move), B=sameMove(b,ttHit.move);
      if (A&&!B) return -1; if (B&&!A) return 1; return 0;
    });
  }
  const kArr = killers[ply%64];
  moves.sort((a,b)=>{
    const ka = sameMove(a,kArr[0])||sameMove(a,kArr[1]) ? 1:0;
    const kb = sameMove(b,kArr[0])||sameMove(b,kArr[1]) ? 1:0;
    if (ka!==kb) return kb-ka;
    return (historyValue(b) - historyValue(a));
  });

  let best=-Infinity, bestMove=null;
  let localAlpha=alpha;

  for (const mv of moves){
    const before = game.at(mv.to.x,mv.to.y);
    const res = make(game, mv);
    if (!res?.ok){ undo(game); continue; }

    const mat = materialEval(game);
    const aiLead = (aiColor==='w'?mat:-mat);
    const delta  = moveDeltaBonus(game, mv, !!before, res?.status?.state==='check')
                 + countingAdjust(aiColor, countState, !!before, aiLead);

    const child  = negamax(game, depth-1, -beta, -localAlpha, -color, aiColor, rep, countState, budget, stats, ply+1);
    const score  = (child.cutoff ? -localAlpha : -(child.score)) + (color * delta);

    undo(game);

    if (score > best){
      best=score; bestMove=mv;
      if (best>localAlpha) localAlpha=best;
      if (localAlpha>=beta){
        if (!before) recordKiller(ply, mv);
        break;
      }
    }
  }

  rep.pop();

  // TT store
  let flag=TT_EXACT;
  if      (best <= alpha) flag=TT_UPPER;
  else if (best >= beta)  flag=TT_LOWER;
  TT.set(key, { depth, score:best, flag, move:bestMove });

  if (bestMove && !sameMove(bestMove, killers[ply%64][0])) addHistory(bestMove, depth);

  return { score:best, move:bestMove };
}

/* ============================== Public API ============================ */
export async function chooseAIMove(game, opts={}){
  const level      = opts.level || 'Medium';
  const aiColor    = opts.aiColor || game.turn;
  const countState = opts.countState || null;

  // Opening book first (fast path)
  try{
    const book = await loadOpeningBook();
    if (book && USE_BOOK){
      const key = historyKeyFromGame(game);
      const cand = book[key];
      if (Array.isArray(cand) && cand.length){
        const pick = cand[Math.floor(Math.random()*cand.length)];
        const mv = parseBookMove(pick, game);
        if (mv) return mv;
      }
    }
  }catch{}

  // Engine search
  const depth  = SEARCH_DEPTH[level] ?? 3;
  const budget = { limit: NODE_LIMIT[level] ?? 16000 };
  const rep    = new RepTracker();
  const stats  = { nodes:0 };
  const { move } = negamax(game, depth, -Infinity, Infinity, +1, aiColor, rep, countState, budget, stats, 0);
  return move || null;
}

export function setAIDifficulty(level){
  return { depth: SEARCH_DEPTH[level] ?? 3, nodeLimit: NODE_LIMIT[level] ?? 16000 };
}

// Back-compat for your ui.js import
export const pickAIMove = chooseAIMove;
