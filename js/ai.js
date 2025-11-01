// js/ai.js — Khmer Chess AI (FAST) + Opening Book
//
// Public API
//   - chooseAIMove(game, { level:'Easy'|'Medium'|'Hard', aiColor:'w'|'b', countState })
//   - setAIDifficulty(level)
//   - pickAIMove (alias)
//
// Game API expected:
//   game.at(x,y) -> {t:'R|N|B|Q|P|K' or T,H,G,D,F,S, c:'w'|'b'} | null
//   game.turn    -> 'w'|'b'
//   game.legalMoves(x,y) -> [{x,y}, ...]
//   game.move({x,y},{x,y}) -> { ok:true, status:{state:'normal|check|checkmate|stalemate'} }
//   game.undo()
//   game.history -> [{from:{x,y}, to:{x,y}}]
//
// Focus: speed. We avoid re-searching root moves; we keep a small eval
// and rely on the principal variation from a single negamax call.

let _bookPromise = null;
async function loadOpeningBook(){
  if (_bookPromise) return _bookPromise;
  _bookPromise = fetch('assets/book-mini.json').then(r=>r.json()).catch(()=> ({}));
  return _bookPromise;
}

function toAlg(sq){ return String.fromCharCode(97+sq.x) + String(8 - sq.y); }
function historyKeyFromGame(game){
  if (!Array.isArray(game.history) || !game.history.length) return '';
  return game.history.map(m => toAlg(m.from) + toAlg(m.to)).join(' ');
}
function parseBookMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0)-97, fy = 8-(uci.charCodeAt(1)-48);
  const tx = uci.charCodeAt(2)-97, ty = 8-(uci.charCodeAt(3)-48);
  if (fx|fy|tx|ty & ~7) return null;
  const legals = game.legalMoves(fx, fy);
  for (const m of legals) if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
  return null;
}

/* ---------------------- Tuning (faster defaults) ---------------------- */

const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };

// Slightly shallower but snappy:
const SEARCH_DEPTH = { Easy: 2, Medium: 2, Hard: 3 };
const NODE_LIMIT   = { Easy: 4000, Medium: 10000, Hard: 20000 };

const REP_SHORT_WINDOW = 8, REP_SOFT_PENALTY = 15, REP_HARD_PENALTY = 220;
const BONUS_CAPTURE=30, BONUS_CHECK=18, BONUS_PUSH=6, PENAL_IDLE=8;
const COUNT_BURN_PENALTY=12, COUNT_RESEED_BONUS=80, COUNT_URGENT_NEAR=3;

function normType(t){ return TYPE_MAP[t] || t; }

/* ------------------------------ Eval ---------------------------------- */

function materialSide(game, side){
  let s=0;
  for (let y=0;y<8;y++) for (let x=0;x<8;x++){
    const p = game.at(x,y); if (!p || p.c!==side) continue;
    const tt = normType(p.t); if (tt!=='K') s += VAL[tt]||0;
  }
  return s;
}
function materialEval(game){ return materialSide(game,'w') - materialSide(game,'b'); }

// Light (faster) mobility: count until a small cap, then stop
function mobilityEval(game){
  let moves = 0, cap = 24; // cap keeps this cheap
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at(x,y); if (!p || p.c!==game.turn) continue;
      const ls = game.legalMoves(x,y);
      moves += ls.length;
      if (moves>=cap) return (game.turn==='w'?+1:-1)*cap;
    }
  }
  return (game.turn==='w'?+1:-1) * moves;
}

function posKey(game){
  let out = '';
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at(x,y);
      out += p ? (p.c + (normType(p.t))) : '.';
    }
    out += '/';
  }
  return out + ' ' + game.turn;
}

class RepTracker{
  constructor(){ this.list=[]; }
  push(k){ this.list.push(k); if (this.list.length>128) this.list.shift(); }
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
  if (soft>0) p -= REP_SOFT_PENALTY * soft;
  if (rep.wouldThreefold(key)) p -= REP_HARD_PENALTY;
  return p;
}

function moveDeltaBonus(game, mv, captured, gaveCheck){
  let b=0; if(captured) b+=BONUS_CAPTURE; if(gaveCheck) b+=BONUS_CHECK;
  if (mv.isPawnPush) b+=BONUS_PUSH; if(!b) b-=PENAL_IDLE; return b;
}
function countingAdjust(aiColor, countState, captured, matLead){
  if (!countState?.active) return 0;
  let adj=0, aiOwns = (countState.side===aiColor);
  if (aiOwns){
    if (captured) adj += COUNT_RESEED_BONUS;
    else if (matLead>0) adj -= COUNT_BURN_PENALTY;
    if ((countState.remaining||0) <= COUNT_URGENT_NEAR) adj -= 50;
  } else {
    if (captured) adj += (COUNT_RESEED_BONUS>>1);
  }
  return adj;
}

/* -------------------------- Move generation --------------------------- */

function centerBias(sq){ const cx=Math.abs(3.5-sq.x), cy=Math.abs(3.5-sq.y); return 8-(cx+cy); }

function generateMoves(game){
  const out=[];
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p=game.at(x,y); if(!p || p.c!==game.turn) continue;
      const tt=normType(p.t), legals=game.legalMoves(x,y);
      for (const m of legals){
        const target=game.at(m.x,m.y);
        const isPawnPush = (tt==='P' && m.y!==y);
        out.push({
          from:{x,y}, to:{x:m.x,y:m.y},
          captureVal: target ? (VAL[normType(target.t)]||0) : 0,
          isPawnPush
        });
      }
    }
  }
  out.sort((a,b)=>{
    if (b.captureVal!==a.captureVal) return b.captureVal-a.captureVal;
    return centerBias(b.to)-centerBias(a.to);
  });
  return out;
}

/* ------------------------------ Search -------------------------------- */

function evalLeaf(game, rep, countState, aiColor){
  const mat = materialEval(game);
  const mob = mobilityEval(game);
  let score = mat + mob + repetitionPenalty(rep, posKey(game));
  const lead = (aiColor==='w' ? mat : -mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }
  return score;
}
function make(game,m){ return game.move(m.from,m.to); }
function undo(game){ game.undo(); }

function negamax(game, depth, alpha, beta, color, aiColor, rep, countState, budget, stats){
  if (stats.nodes++ > budget.limit) return { score: 0, move:null, cutoff:true };
  const st = game?.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate') return { score: color * (-100000 + depth), move:null };
    return { score:0, move:null };
  }
  if (depth===0) return { score: color * evalLeaf(game, rep, countState, aiColor), move:null };

  rep.push(posKey(game));
  let best=-Infinity, bestMove=null;
  const moves = generateMoves(game);
  if (!moves.length){
    rep.pop();
    return { score: color * evalLeaf(game, rep, countState, aiColor), move:null };
  }

  for (const mv of moves){
    const before = game.at(mv.to.x, mv.to.y);
    const res = make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const mat = materialEval(game);
    const aiLead = (aiColor==='w'?mat:-mat);
    const delta = moveDeltaBonus(game, mv, !!before, res?.status?.state==='check')
                + countingAdjust(aiColor, countState, !!before, aiLead);

    const child = negamax(game, depth-1, -beta, -alpha, -color, aiColor, rep, countState, budget, stats);
    const childScore = (child.cutoff ? -alpha : -(child.score)) + (color * delta);

    undo(game);

    if (childScore>best){ best=childScore; bestMove=mv; }
    if (best>alpha) alpha=best;
    if (alpha>=beta) break;
  }
  rep.pop();
  return { score:best, move:bestMove };
}

/* ------------------------------ Public -------------------------------- */

export async function chooseAIMove(game, opts={}){
  const level      = opts.level || 'Medium';
  const aiColor    = opts.aiColor || game.turn;
  const countState = opts.countState || null;

  // Opening book first
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

  const depth  = SEARCH_DEPTH[level] ?? 2;
  const budget = { limit: NODE_LIMIT[level] ?? 10000 };
  const rep = new RepTracker();
  const stats = { nodes:0 };

  const { move } = negamax(game, depth, -Infinity, Infinity, +1, aiColor, rep, countState, budget, stats);
  return move || null;
}

export function setAIDifficulty(level){
  return {
    depth: SEARCH_DEPTH[level] ?? 2,
    nodeLimit: NODE_LIMIT[level] ?? 10000
  };
}
export const pickAIMove = chooseAIMove;
