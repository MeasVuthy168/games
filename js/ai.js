/* js/ai.js — Khmer Chess AI (Easy/Medium/Hard)
   Requires game.js that exposes:
     - SIZE, COLORS
     - game.turn  ('w'|'b')
     - game.at(x,y) -> { t:'KQRNBP'..., c:'w'|'b' } | null
     - game.legalMoves(x,y) -> [{x,y}, ...]
     - game.move(from,to) -> { ok:true, captured?:object, status?:{state:'check'|'checkmate'|'stalemate'} }
     - game.undo()
*/

import { SIZE, COLORS } from './game.js';

/* ---------- Public API ---------- */
export const LEVELS = {
  Easy:   { depth: 0, randomize: 0.80 },          // mostly random
  Medium: { depth: 2, randomize: 0.15 },          // shallow search + light noise
  Hard:   { depth: 3, randomize: 0.00 }           // deeper search, no noise
};

/** Choose the AI move. Returns Promise<{from:{x,y}, to:{x,y}}> or null */
export function pickAIMove(game, { level = 'Medium', timeMs = 0 } = {}) {
  const cfg = LEVELS[level] || LEVELS.Medium;
  const think = () => _choose(game, cfg);
  // allow UI to breathe
  return new Promise(res => {
    if (timeMs > 0) setTimeout(() => res(think()), timeMs);
    else queueMicrotask(() => res(think()));
  });
}

/* ---------- Internals ---------- */

// Map various encodings to Western letters used by the engine
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };

// Piece values tuned lightly for Khmer chess feel
const VAL = { K: 20000, Q: 900, R: 500, B: 330, N: 320, P: 100 };

// Simple piece-square tables (encourage center & advancement)
// 0..7 from White's view; mirrored for Black when evaluating
const PST_P = [0, 5, 5, 7, 7, 5, 5, 0];
const PST_N = [ -5, 0, 5, 7, 7, 5, 0, -5 ];
const PST_B = [ -2, 1, 2, 3, 3, 2, 1, -2 ];
const PST_R = [ 2, 3, 3, 4, 4, 3, 3, 2 ];
const PST_Q = [ 1, 2, 3, 3, 3, 3, 2, 1 ];
const PST   = { P:PST_P, N:PST_N, B:PST_B, R:PST_R, Q:PST_Q, K:Array(8).fill(0) };

// Limited killer move memory (per-ply)
const KILLERS = Array(8).fill(null);

/** Get all legal moves for the side-to-move */
function enumerateMoves(game) {
  const mv = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const p = game.at(x, y);
      if (!p || p.c !== game.turn) continue;
      const legal = game.legalMoves(x, y);
      for (const to of legal) mv.push({ from:{x, y}, to });
    }
  }
  // Move ordering: captures first (simple MVV/LVA proxy via presence of target)
  mv.sort((a, b) => {
    const A = game.at(a.to.x, a.to.y);
    const B = game.at(b.to.x, b.to.y);
    const ca = A ? 1 : 0, cb = B ? 1 : 0;
    if (cb !== ca) return cb - ca; // captures first
    // killer move bonus (if matches previous killer at this ply)
    return 0;
  });
  return mv;
}

/** Static evaluation from White's perspective (positive = good for White) */
function evaluate(game) {
  let score = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const p = game.at(x, y);
      if (!p) continue;
      const t = TYPE_MAP[p.t] || p.t;
      const s = baseValue(t) + pstBonus(t, x, y, p.c);
      score += (p.c === 'w') ? s : -s;
    }
  }
  return score;
}
const baseValue = t => VAL[t] ?? 0;
function pstBonus(t, x, y, c){
  const rowFromWhite = (c === 'w') ? y : (SIZE - 1 - y);
  const tbl = PST[t] || PST.Q;
  // weight center files more (x: 0..7)
  const fileWeight = [0,1,2,3,3,2,1,0][x];
  return (tbl[rowFromWhite] || 0) * 2 + fileWeight;
}

/** Minimax + alpha-beta (depth ply). Returns { score, move } in White POV. */
function search(game, depth, alpha, beta, rootColor, ply = 0) {
  // Terminal checks
  const moves = enumerateMoves(game);
  if (depth === 0 || moves.length === 0) {
    // Check for mate/stalemate via status after a null probe (approx)
    const val = evaluate(game);
    return { score: (game.turn === rootColor) ? val : -val, move: null };
  }

  let bestMove = null;
  // Maximize for rootColor, minimize for opponent (flip sign trick)
  const maximizing = (game.turn === rootColor);

  // Killer move suggestion
  const killer = KILLERS[ply];
  if (killer) {
    const i = moves.findIndex(m => sameMove(m, killer));
    if (i >= 0) { const [km] = moves.splice(i,1); moves.unshift(km); }
  }

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const r = game.move(m.from, m.to);
      if (!r?.ok) { game.undo(); continue; }

      const child = search(game, depth - 1, alpha, beta, rootColor, ply + 1);
      game.undo();

      if (child.score > best) { best = child.score; bestMove = m; }
      alpha = Math.max(alpha, best);
      if (beta <= alpha) { KILLERS[ply] = m; break; }
    }
    return { score: best, move: bestMove };
  } else {
    let best = Infinity;
    for (const m of moves) {
      const r = game.move(m.from, m.to);
      if (!r?.ok) { game.undo(); continue; }

      const child = search(game, depth - 1, alpha, beta, rootColor, ply + 1);
      game.undo();

      if (child.score < best) { best = child.score; bestMove = m; }
      beta = Math.min(beta, best);
      if (beta <= alpha) { KILLERS[ply] = m; break; }
    }
    return { score: best, move: bestMove };
  }
}

/** Top-level choice wrapper with difficulty config */
function _choose(game, cfg) {
  const all = enumerateMoves(game);
  if (!all.length) return null;

  // EASY: mostly random with small capture bias
  if (cfg.depth === 0) {
    const caps = all.filter(m => !!game.at(m.to.x, m.to.y));
    const pool = (Math.random() < (cfg.randomize ?? 0.8)) ? all : (caps.length ? caps : all);
    return pool[Math.floor(Math.random()*pool.length)];
  }

  // MED/HARD: search
  const rootColor = game.turn;
  let best = search(game, cfg.depth, -Infinity, Infinity, rootColor, 0).move;

  // Add tiny randomness if requested (break ties a bit)
  if (cfg.randomize && best) {
    const sameScoreMoves = tieSet(game, best, cfg.depth, rootColor);
    if (sameScoreMoves.length > 1 && Math.random() < cfg.randomize) {
      best = sameScoreMoves[Math.floor(Math.random() * sameScoreMoves.length)];
    }
  }
  return best || all[0];
}

/** Build a small tie set around best move (same eval within epsilon). */
function tieSet(game, bestMove, depth, rootColor) {
  const EPS = 6;
  const base = scoreFor(game, bestMove, depth, rootColor);
  const moves = enumerateMoves(game);
  const out = [];
  for (const m of moves) {
    const s = scoreFor(game, m, depth, rootColor);
    if (Math.abs(s - base) <= EPS) out.push(m);
  }
  return out;
}
function scoreFor(game, m, depth, rootColor){
  const r = game.move(m.from, m.to);
  if (!r?.ok){ game.undo(); return -Infinity; }
  const sc = search(game, Math.max(0, depth - 1), -Infinity, Infinity, rootColor, 1).score;
  game.undo();
  return sc;
}

function sameMove(a, b){
  return a && b && a.from.x===b.from.x && a.from.y===b.from.y && a.to.x===b.to.x && a.to.y===b.to.y;
}
