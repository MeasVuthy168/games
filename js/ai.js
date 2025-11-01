// js/ai.js — Khmer Chess AI (Easy/Medium/Hard) + Opening Book + Aggression Style
//
// Public API
//   - chooseAIMove(game, { level:'Easy'|'Medium'|'Hard', aiColor:'w'|'b', countState })
//   - setAIDifficulty(level)
//   - pickAIMove (alias)
//
// Game API expected:
//   game.at(x,y) -> { t:'R|N|B|Q|P|K' or Khmer variants T,H,G,D,F,S, c:'w'|'b' } | null
//   game.turn    -> 'w'|'b'
//   game.legalMoves(x,y) -> [{x,y}, ...]
//   game.move({x,y},{x,y}) -> { ok:true, status:{state:'normal|check|checkmate|stalemate'}, captured?:... }
//   game.undo()
//   game.history -> [{from:{x,y}, to:{x,y}}]
//
// ---------------------------------------------------------------------
// Opening book (very small; optional)
let _bookPromise = null;
async function loadOpeningBook(){
  if (_bookPromise) return _bookPromise;
  _bookPromise = fetch('assets/book-mini.json').then(r=>r.json()).catch(()=> ({}));
  return _bookPromise;
}
function toAlg(sq){ return String.fromCharCode(97+sq.x) + String(8-sq.y); }
function historyKeyFromGame(game){
  if (!Array.isArray(game.history) || game.history.length===0) return '';
  return game.history.map(m => toAlg(m.from)+toAlg(m.to)).join(' ');
}
function parseBookMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97, fy = 8 - (uci.charCodeAt(1)-48);
  const tx = uci.charCodeAt(2) - 97, ty = 8 - (uci.charCodeAt(3)-48);
  if (fx|fy|tx|ty & ~7) return null; // quick bounds check
  const legals = game.legalMoves(fx, fy);
  for (const m of legals){ if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} }; }
  return null;
}

// ---------------------------------------------------------------------
// Config / Tuning
const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };

const SEARCH_DEPTH = { Easy: 2, Medium: 3, Hard: 4 };       // ply
const TEMP_BY_LEVEL = { Easy: 0.60, Medium: 0.30, Hard: 0 }; // temperature (kept; but we no longer re-search root)
const NODE_LIMIT_BY_LEVEL = { Easy: 6000, Medium: 16000, Hard: 38000 }; // slightly tighter for speed

// Repetition discouragers
const REP_SHORT_WINDOW = 8;
const REP_SOFT_PENALTY = 15;   // cp per revisit in short window
const REP_HARD_PENALTY = 220;  // cp if would cause 3-fold

// Progress incentives (base)
const BONUS_CAPTURE = 30;
const BONUS_CHECK   = 18;
const BONUS_PUSH    = 6;
const PENAL_IDLE    = 8;

// Counting-draw awareness
const COUNT_BURN_PENALTY = 12;
const COUNT_RESEED_BONUS = 80;
const COUNT_URGENT_NEAR  = 3;

// ---- New: Style dials for "human-like aggression" (safe) ----
const STYLE = {
  aggression: 0.6,   // 0..1 (higher = prefers attack/pressure more)
  riskGuard:  0.55,  // 0..1 (higher = avoids bad trades stronger)
  brakeWhenBehind: 80 // cp penalty applied to aggression when eval < -100
};

// ---------------------------------------------------------------------
// Utilities
function normType(t){ return TYPE_MAP[t] || t; }

function materialSide(game, side){
  let s = 0;
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at(x,y); if (!p || p.c!==side) continue;
      const tt = normType(p.t);
      if (tt!=='K') s += VAL[tt]||0;
    }
  }
  return s;
}
function materialEval(game){
  return materialSide(game,'w') - materialSide(game,'b'); // + = White better
}
function mobilityEval(game){
  // very light: count legal moves for side-to-move
  let moves = 0;
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at(x,y); if(!p || p.c!==game.turn) continue;
      moves += game.legalMoves(x,y).length;
    }
  }
  return (game.turn==='w' ? +1 : -1) * Math.min(40, moves);
}
// position key (simple)
function posKey(game){
  const rows=[];
  for (let y=0;y<8;y++){
    const r=[];
    for (let x=0;x<8;x++){
      const p=game.at(x,y);
      r.push(!p ? '.' : (p.c==='w'?'w':'b')+normType(p.t));
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
    } return n;
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

// Center bias
function centerBias(sq){
  const cx = Math.abs(3.5 - sq.x);
  const cy = Math.abs(3.5 - sq.y);
  return 8 - (cx + cy); // larger is better
}

// ---------------------------------------------------------------------
// Move generation (ordered)
function generateMoves(game){
  const out=[];
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
          from:{x,y}, to:{x:m.x,y:m.y},
          moverType:tt,
          captureVal: target ? (VAL[normType(target.t)]||0) : 0,
          isPawnPush
        });
      }
    }
  }
  // captures first, then center bias
  out.sort((a,b)=>{
    if (b.captureVal !== a.captureVal) return b.captureVal - a.captureVal;
    return centerBias(b.to) - centerBias(a.to);
  });
  return out;
}

// ---------------------------------------------------------------------
// Evaluation helpers at leaves and per-move deltas
function evalLeaf(game, rep, countState, aiColor){
  const key = posKey(game);
  const mat = materialEval(game);
  const mob = mobilityEval(game);

  let score = mat + mob;
  score += repetitionPenalty(rep, key);

  // Counting-draw nudge when we're ahead and own the counter
  const lead = (aiColor==='w' ? mat : -mat);
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }
  return score;
}

// Aggression-aware delta (safe)
function moveDeltaBonus(moverType, move, capturedPiece, gaveCheck, sideEvalCp){
  const myVal  = VAL[moverType] || 0;
  const capVal = capturedPiece ? (VAL[normType(capturedPiece.t)] || 0) : 0;

  // base aggression bonus (scaled)
  let b = 0;
  b += STYLE.aggression * (
        (capVal ? BONUS_CAPTURE : 0) +
        (gaveCheck ? BONUS_CHECK : 0) +
        (move.isPawnPush ? BONUS_PUSH : 0)
      );

  // risk guard: avoid obviously bad material trades
  const trade = capVal - myVal; // negative if we trade down
  if (capturedPiece && trade < 0) {
    b += trade * STYLE.riskGuard; // trade is negative -> penalty
  }

  // brake when we're already behind to avoid over-pushing
  if (sideEvalCp < -100) {
    b -= STYLE.brakeWhenBehind * STYLE.aggression;
  }

  if (b === 0) b -= PENAL_IDLE;
  return b;
}

// Counting-draw adjust (unchanged)
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

// ---------------------------------------------------------------------
// Negamax search (no extra root re-search; faster)
function make(game, mv){ return game.move(mv.from, mv.to); }
function undo(game){ game.undo(); }

function negamax(game, depth, alpha, beta, color, aiColor, rep, countState, budget, stats){
  if (stats.nodes++ > budget.limit) return { score: 0, move: null, cutoff:true };

  // terminal?
  const st = game?.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate'){
      const mateScore = -100000 + depth; // prefer faster mates
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
    // Grab mover type BEFORE making the move (fast)
    const mover = game.at(mv.from.x, mv.from.y);
    const moverType = normType(mover?.t);

    const targetBefore = game.at(mv.to.x, mv.to.y);
    const res = make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const gaveCheck = res?.status?.state === 'check';

    // Eval after move to gauge "sideEval" from AI perspective
    const mat = materialEval(game);
    const aiLead = (aiColor==='w' ? mat : -mat);

    const deltaAdj = moveDeltaBonus(moverType, mv, targetBefore, !!gaveCheck, aiLead)
                   + countingAdjust(aiColor, countState, mv, !!targetBefore, aiLead);

    const child = negamax(
      game, depth-1, -beta, -alpha, -color, aiColor, rep, countState, budget, stats
    );
    const childScore = (child.cutoff ? -alpha : -(child.score)) + (color * deltaAdj);

    undo(game);

    if (childScore > best){ best = childScore; bestMove = mv; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // cutoff
  }

  rep.pop();
  return { score: best, move: bestMove };
}

// ---------------------------------------------------------------------
// Public API
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
  }catch{ /* ignore */ }

  // 2) Engine search (single pass -> faster)
  const depth  = SEARCH_DEPTH[level] ?? 3;
  const budget = { limit: NODE_LIMIT_BY_LEVEL[level] ?? 20000 };

  const rep = new RepTracker();
  const stats = { nodes: 0 };

  const { move } = negamax(
    game, depth, -Infinity, Infinity, +1, aiColor, rep, countState, budget, stats
  );
  return move || null;
}

export function setAIDifficulty(level){
  return {
    depth: SEARCH_DEPTH[level] ?? 3,
    temperature: TEMP_BY_LEVEL[level] ?? 0,
    nodeLimit: NODE_LIMIT_BY_LEVEL[level] ?? 20000
  };
}

// Backward compatibility alias
export const pickAIMove = chooseAIMove;
