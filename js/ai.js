// js/ai.js — Khmer Chess AI (Easy/Medium/Hard) + Opening Book
//
// Public API
//   - chooseAIMove(game, { level:'Easy'|'Medium'|'Hard', aiColor:'w'|'b', countState })
//   - setAIDifficulty(level)
//   - pickAIMove (alias of chooseAIMove for backward-compat)
//
// Game API expectations (same as your code):
//   game.at(x,y) -> {t:'R|N|B|Q|P|K' or Khmer variants T,H,G,D,F,S, c:'w'|'b'} | null
//   game.turn    -> 'w'|'b'
//   game.legalMoves(x,y) -> [{x,y}, ...]
//   game.move({x,y},{x,y}) -> { ok:true, status:{state:'normal|check|checkmate|stalemate'}, captured?:... }
//   game.undo()
//   game.history -> array of {from:{x,y}, to:{x,y}} (used for opening keys)
//
// ---------------------------------------------------------------------

/* ======================= Opening book (lightweight) ======================= */

let _bookPromise = null;
async function loadOpeningBook(){
  if (_bookPromise) return _bookPromise;
  _bookPromise = fetch('assets/book-mini.json').then(r=>r.json()).catch(()=> ({}));
  return _bookPromise;
}

// Convert {x,y} (0..7) to algebraic "a1..h8"
function toAlg(sq){
  const file = String.fromCharCode(97 + sq.x);     // a..h
  const rank = String(8 - sq.y);                    // 8..1
  return file + rank;
}

// Convert history [{from,to},...] to key "e2e4 g8f6 ..." (spaces between plies)
function historyKeyFromGame(game){
  if (!Array.isArray(game.history) || game.history.length===0) return '';
  return game.history.map(m => toAlg(m.from) + toAlg(m.to)).join(' ');
}

// Parse a "e2e4" string into a legal move object for the current position.
// We *only* return a move that exists in game.legalMoves() for its 'from' square.
function parseBookMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx = uci.charCodeAt(0) - 97;  // a..h -> 0..7
  const fy = 8 - (uci.charCodeAt(1) - 48); // '1'..'8' -> rank -> y
  const tx = uci.charCodeAt(2) - 97;
  const ty = 8 - (uci.charCodeAt(3) - 48);
  if (fx<0||fx>7||tx<0||tx>7||fy<0||fy>7||ty<0||ty>7) return null;

  const legals = game.legalMoves(fx, fy);
  for (const m of legals){
    if (m.x === tx && m.y === ty){
      return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
    }
  }
  return null;
}

/* =========================== Config / Tuning =========================== */

const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 }; // K excluded from sum
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };

const SEARCH_DEPTH = { Easy: 2, Medium: 3, Hard: 4 };       // ply
const TEMP_BY_LEVEL = { Easy: 0.60, Medium: 0.30, Hard: 0 }; // softmax temperature
const NODE_LIMIT_BY_LEVEL = { Easy: 6_000, Medium: 18_000, Hard: 50_000 }; // safety cap

// Repetition discouragers
const REP_SHORT_WINDOW = 8;         // last N plies
const REP_SOFT_PENALTY = 15;        // cp per short-repeat revisit
const REP_HARD_PENALTY = 220;       // cp if would cause 3-fold

// Progress incentives
const BONUS_CAPTURE = 30;
const BONUS_CHECK   = 18;
const BONUS_PUSH    = 6;    // fish (pawn) push
const PENAL_IDLE    = 8;

// Counting-draw awareness
const COUNT_BURN_PENALTY = 12;  // idle burn when AI owns counter and is ahead
const COUNT_RESEED_BONUS  = 80; // capture re-seeding the counter
const COUNT_URGENT_NEAR   = 3;  // near-zero threshold

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
  return w - b; // positive means White is ahead
}

function mobilityEval(game){
  // very light: count legal moves of side-to-move
  let moves = 0;
  for (let y=0;y<8;y++){
    for (let x=0;x<8;x++){
      const p = game.at(x,y); if(!p || p.c!==game.turn) continue;
      moves += game.legalMoves(x,y).length;
    }
  }
  // scale small to avoid overpowering material
  return (game.turn==='w' ? +1 : -1) * Math.min(40, moves);
}

// Quick position key; can be upgraded to Zobrist later
function posKey(game){
  const rows = [];
  for (let y=0; y<8; y++){
    const r = [];
    for (let x=0; x<8; x++){
      const p = game.at(x,y);
      if(!p) r.push('.');
      else r.push((p.c==='w'?'w':'b') + (normType(p.t)));
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
  if (T<=0) return scoredMoves[0].move;
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

// Build a move list with light annotations for ordering/scoring
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
        const isPawnPush = (tt==='P' && m.y !== y && !target) || (tt==='P' && m.y !== y);
        out.push({
          from:{x,y},
          to:{x:m.x, y:m.y},
          captureVal: target ? (VAL[normType(target.t)]||0) : 0,
          isPawnPush
        });
      }
    }
  }
  // MVV-LVA-ish order: captures first (higher value), then others
  out.sort((a,b)=>{
    if (b.captureVal !== a.captureVal) return b.captureVal - a.captureVal;
    // small tie-breaker: center bias
    const ca = centerBias(a.to), cb = centerBias(b.to);
    return cb - ca;
  });
  return out;
}

function centerBias(sq){
  // prefer central squares a bit
  const cx = Math.abs(3.5 - sq.x);
  const cy = Math.abs(3.5 - sq.y);
  return 8 - (cx+cy); // larger is better
}

/* =============================== Search ================================ */

function evalLeaf(game, rep, countState, aiColor){
  const key = posKey(game);
  const mat = materialEval(game);
  const mob = mobilityEval(game);
  let score = mat + mob;

  // White-centric -> convert to side-to-move perspective in negamax wrapper
  score += repetitionPenalty(rep, key);

  // Counting-draw nudge when we're ahead and own the counter
  const lead = (aiColor==='w' ? mat : -mat); // AI material lead in centipawns
  if (countState?.active && lead>0 && countState.side===aiColor){
    const near = Math.max(0, 6 - (countState.remaining||0));
    score -= (COUNT_BURN_PENALTY * near);
  }
  return score;
}

function make(game, mv){ return game.move(mv.from, mv.to); }
function undo(game){ game.undo(); }

function negamax(game, depth, alpha, beta, color, aiColor, rep, countState, budget, stats){
  if (stats.nodes++ > budget.limit) return { score: 0, move: null, cutoff:true };

  // terminal?
  const st = game?.status?.();
  if (st && (st.state==='checkmate' || st.state==='stalemate')){
    if (st.state==='checkmate'){
      // side-to-move is checkmated -> huge negative for them (color perspective)
      const mateScore = -100000 + (depth); // prefer faster mates
      return { score: color * mateScore, move:null };
    } else {
      return { score: 0, move:null }; // draw
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
    // no legal moves -> stalemate or checkmate already handled, but safe return:
    const leaf = evalLeaf(game, rep, countState, aiColor);
    rep.pop();
    return { score: color * leaf, move:null };
  }

  for (const mv of moves){
    // make
    const before = game.at(mv.to.x, mv.to.y);
    const res = make(game, mv);
    if(!res?.ok){ undo(game); continue; }

    const gaveCheck = res?.status?.state === 'check';

    // Per-move delta adjustments (progress + counting awareness)
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
    if (alpha >= beta) break; // cutoff
  }

  rep.pop();
  return { score: best, move: bestMove };
}

/* ============================== Public API ============================= */

export async function chooseAIMove(game, opts={}){
  const level      = opts.level || 'Medium';
  const aiColor    = opts.aiColor || (game.turn); // default: whoever is to move
  const countState = opts.countState || null;

  // ---------- Opening book first ----------
  try{
    const book = await loadOpeningBook();
    const key  = historyKeyFromGame(game);     // e.g., "e2e4 e7e5 g1f3 ..."
    const cand = book[key];
    if (Array.isArray(cand) && cand.length){
      // pick a random book move to keep variety
      const pick = cand[Math.floor(Math.random()*cand.length)];
      const mv = parseBookMove(pick, game);
      if (mv) return mv;
    }
  }catch{ /* ignore book errors */ }

  // ---------- Engine search fallback ----------
  const depth  = SEARCH_DEPTH[level] ?? 3;
  const temp   = TEMP_BY_LEVEL[level] ?? 0;
  const budget = { limit: NODE_LIMIT_BY_LEVEL[level] ?? 20000 };

  const rep = new RepTracker();
  const stats = { nodes: 0 };

  // Root search: color = +1 for side-to-move
  const { move: principal, score } = negamax(
    game, depth, -Infinity, Infinity, +1, aiColor, rep, countState, budget, stats
  );

  if (!principal) return null;

  // Build a small top list for temperature sampling
  const rootMoves = generateMoves(game).map(mv=>{
    const before = game.at(mv.to.x, mv.to.y);
    const res = game.move(mv.from, mv.to);
    if(!res?.ok){ game.undo(); return null; }

    const rep2 = new RepTracker(); rep2.list = rep.list.slice();
    const stats2 = { nodes: 0 };
    const sub = negamax(game, depth-1, -Infinity, Infinity, -1, aiColor, rep2, countState, budget, stats2);
    game.undo();

    return {
      move: mv,
      score: -(sub.score) + moveDeltaBonus(game, mv, !!before, res?.status?.state==='check')
    };
  }).filter(Boolean);

  rootMoves.sort((a,b)=> b.score - a.score);

  const picked = pickByTemperature(rootMoves, temp) || principal;

  // (Optional) console debug
  // console.log(`[AI ${level}] nodes=${stats.nodes} score=${score|0} picked=`, picked);

  return picked;
}

export function setAIDifficulty(level){
  return {
    depth: SEARCH_DEPTH[level] ?? 3,
    temperature: TEMP_BY_LEVEL[level] ?? 0,
    nodeLimit: NODE_LIMIT_BY_LEVEL[level] ?? 20000
  };
}

// Backward compatibility (older UI imports)
export const pickAIMove = chooseAIMove;
