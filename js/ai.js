// js/ai.js — FAST version (time budget + TT + no extra root search)

let _bookPromise = null;
async function loadOpeningBook(){
  if (_bookPromise) return _bookPromise;
  _bookPromise = fetch('assets/book-mini.json').then(r=>r.json()).catch(()=> ({}));
  return _bookPromise;
}
function toAlg(sq){ return String.fromCharCode(97+sq.x) + String(8 - sq.y); }
function historyKeyFromGame(game){
  if (!Array.isArray(game.history) || game.history.length===0) return '';
  return game.history.map(m => toAlg(m.from)+toAlg(m.to)).join(' ');
}
function parseBookMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0)-97, fy = 8-(uci.charCodeAt(1)-48);
  const tx = uci.charCodeAt(2)-97, ty = 8-(uci.charCodeAt(3)-48);
  if (fx|fy|tx|ty){} // keep
  const legals = game.legalMoves(fx, fy);
  for (const m of legals){ if (m.x===tx && m.y===ty) return {from:{x:fx,y:fy}, to:{x:tx,y:ty}}; }
  return null;
}

/* ====== Tuning ====== */
const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };

const SEARCH_DEPTH = { Easy:2, Medium:3, Hard:3 };                // trimmed Hard from 4 -> 3
const TEMP_BY_LEVEL = { Easy:0.60, Medium:0.30, Hard:0.0 };
const NODE_LIMIT_BY_LEVEL = { Easy:5_000, Medium:12_000, Hard:18_000 }; // lower caps
const TIME_BUDGET_MS = { Easy:80, Medium:140, Hard:220 };          // soft time budgets

const REP_SHORT_WINDOW = 8, REP_SOFT_PENALTY = 15, REP_HARD_PENALTY = 220;
const BONUS_CAPTURE = 30, BONUS_CHECK = 18, BONUS_PUSH = 6, PENAL_IDLE = 8;
const COUNT_BURN_PENALTY = 12, COUNT_RESEED_BONUS = 80, COUNT_URGENT_NEAR = 3;

function normType(t){ return TYPE_MAP[t] || t; }
function materialSide(game, side){
  let s=0; for (let y=0;y<8;y++) for (let x=0;x<8;x++){
    const p = game.at(x,y); if(!p || p.c!==side) continue;
    const tt = normType(p.t); if (tt!=='K') s += VAL[tt]||0;
  } return s;
}
function materialEval(game){ return materialSide(game,'w') - materialSide(game,'b'); }
function mobilityEval(game){
  let moves=0;
  for (let y=0;y<8;y++) for (let x=0;x<8;x++){
    const p=game.at(x,y); if(!p || p.c!==game.turn) continue;
    moves += game.legalMoves(x,y).length;
  }
  return (game.turn==='w' ? +1 : -1) * Math.min(40, moves);
}
function posKey(game){
  const rows=[];
  for (let y=0;y<8;y++){
    const r=[];
    for (let x=0;x<8;x++){
      const p=game.at(x,y);
      r.push(!p?'.':(p.c==='w'?'w':'b')+normType(p.t));
    }
    rows.push(r.join(''));
  }
  return rows.join('/')+' '+game.turn;
}

class RepTracker{
  constructor(){ this.list=[]; }
  push(k){ this.list.push(k); if(this.list.length>128) this.list.shift(); }
  pop(){ this.list.pop(); }
  softCount(k){ let n=0; for(let i=Math.max(0,this.list.length-REP_SHORT_WINDOW); i<this.list.length; i++){ if(this.list[i]===k) n++; } return n; }
  wouldThreefold(k){ return (this.list.filter(x=>x===k).length+1) >= 3; }
}
function repetitionPenalty(rep, key){
  let p=0, soft=rep.softCount(key);
  if(soft>0) p -= REP_SOFT_PENALTY*soft;
  if(rep.wouldThreefold(key)) p -= REP_HARD_PENALTY;
  return p;
}
function moveDeltaBonus(game, move, captured, gaveCheck){
  let b=0; if(captured) b+=BONUS_CAPTURE; if(gaveCheck) b+=BONUS_CHECK; if(move.isPawnPush) b+=BONUS_PUSH; if(b===0) b-=PENAL_IDLE; return b;
}
function countingAdjust(aiColor, countState, move, captured, matLead){
  if(!countState?.active) return 0;
  let adj=0, aiOwns=(countState.side===aiColor);
  if (aiOwns){
    if (captured) adj+=COUNT_RESEED_BONUS;
    else if (matLead>0) adj-=COUNT_BURN_PENALTY;
    if ((countState.remaining||0) <= COUNT_URGENT_NEAR) adj -= 50;
  } else { if (captured) adj += Math.floor(COUNT_RESEED_BONUS/2); }
  return adj;
}
function centerBias(sq){ const cx=Math.abs(3.5-sq.x), cy=Math.abs(3.5-sq.y); return 8-(cx+cy); }

function generateMoves(game){
  const out=[];
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p || p.c!==game.turn) continue;
    const tt=normType(p.t), legals=game.legalMoves(x,y);
    for(const m of legals){
      const target=game.at(m.x,m.y);
      const isPawnPush=(tt==='P' && m.y!==y);
      out.push({
        from:{x,y}, to:{x:m.x,y:m.y},
        captureVal: target ? (VAL[normType(target.t)]||0) : 0,
        isPawnPush,
        ordBias: (target?1000:0) + centerBias({x:m.x,y:m.y})
      });
    }
  }
  // order: captures (value), then center bias
  out.sort((a,b)=> (b.captureVal-a.captureVal) || (b.ordBias-a.ordBias));
  return out;
}

/* ===== Transposition Table (exact by (posKey, depth)) ===== */
const TT = new Map(); // key: `${posKey}|d|t`
function ttGet(k,d,t){ return TT.get(k+'|'+d+'|'+t) || null; }
function ttPut(k,d,t,val){ TT.set(k+'|'+d+'|'+t, val); }

/* ===== Negamax with time budget ===== */
function evalLeaf(game, rep, countState, aiColor){
  const key=posKey(game), mat=materialEval(game), mob=mobilityEval(game);
  let score=mat+mob;
  score += repetitionPenalty(rep, key);
  const lead = (aiColor==='w' ? mat : -mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }
  return score;
}
function make(game, mv){ return game.move(mv.from, mv.to); }
function undo(game){ game.undo(); }

function negamax(game, depth, alpha, beta, color, aiColor, rep, countState, budget, stats, deadline){
  if (stats.nodes++ > budget.limit) return { score:0, move:null, cutoff:true };
  if (deadline && performance.now() > deadline) return { score:0, move:null, cutoff:true };

  const st = game?.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate'){
      const mateScore = -100000 + depth;
      return { score: color * mateScore, move:null };
    }
    return { score: 0, move:null };
  }
  if (depth===0){
    const leaf = evalLeaf(game, rep, countState, aiColor);
    return { score: color * leaf, move:null };
  }

  const pkey = posKey(game);
  const ttHit = ttGet(pkey, depth, game.turn);
  if (ttHit) return ttHit; // quick reuse

  rep.push(pkey);

  let best=-Infinity, bestMove=null;
  const moves=generateMoves(game);
  if (!moves.length){
    const leaf=evalLeaf(game, rep, countState, aiColor);
    rep.pop();
    return { score: color*leaf, move:null };
  }

  for (const mv of moves){
    const before=game.at(mv.to.x,mv.to.y);
    const res=make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const gaveCheck = res?.status?.state==='check';
    const mat = materialEval(game);
    const aiLead = (aiColor==='w'?mat:-mat);
    const deltaAdj = moveDeltaBonus(game, mv, !!before, !!gaveCheck)
                   + countingAdjust(aiColor, countState, mv, !!before, aiLead);

    const child = negamax(game, depth-1, -beta, -alpha, -color, aiColor, rep, countState, budget, stats, deadline);
    const childScore = (child.cutoff ? -alpha : -(child.score)) + (color * deltaAdj);

    undo(game);

    if (childScore > best){ best=childScore; bestMove=mv; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (deadline && performance.now() > deadline) break;
  }

  rep.pop();
  const out = { score:best, move:bestMove };
  ttPut(pkey, depth, game.turn, out); // store exact
  return out;
}

/* ===== Public API ===== */
export async function chooseAIMove(game, opts={}){
  const level      = opts.level || 'Medium';
  const aiColor    = opts.aiColor || game.turn;
  const countState = opts.countState || null;

  // 1) Opening book (instant)
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

  // 2) Timed search
  const depth  = SEARCH_DEPTH[level] ?? 3;
  const temp   = TEMP_BY_LEVEL[level] ?? 0;
  const budget = { limit: NODE_LIMIT_BY_LEVEL[level] ?? 20000 };
  const timeMs = Math.max(40, opts.timeMs ?? TIME_BUDGET_MS[level] ?? 120);
  const deadline = performance.now() + timeMs;

  const rep = new RepTracker();
  const stats = { nodes:0 };

  const res = negamax(game, depth, -Infinity, Infinity, +1, aiColor, rep, countState, budget, stats, deadline);
  let best = res.move;
  if (!best){
    // fallback: pick any legal move quickly
    const moves = generateMoves(game);
    return moves[0] || null;
  }

  if (temp > 0){
    // Cheap temperature: sample from top-K by static heuristic (no second searches)
    const K = 5;
    const moves = generateMoves(game).slice(0, K);
    if (moves.length){
      // softmax on simple ordBias (captures/center) to add variety
      const exps = moves.map(m => Math.exp(m.ordBias / Math.max(0.01,temp)));
      const sum  = exps.reduce((a,b)=>a+b,0);
      let r = Math.random()*sum;
      for (let i=0;i<moves.length;i++){ r -= exps[i]; if (r<=0) return moves[i]; }
      return moves[0];
    }
  }
  return best;
}

export function setAIDifficulty(level){
  return {
    depth: SEARCH_DEPTH[level] ?? 3,
    temperature: TEMP_BY_LEVEL[level] ?? 0,
    nodeLimit: NODE_LIMIT_BY_LEVEL[level] ?? 20000,
    timeMs: TIME_BUDGET_MS[level] ?? 120
  };
}

// Back-compat alias for older imports
export const pickAIMove = chooseAIMove;
