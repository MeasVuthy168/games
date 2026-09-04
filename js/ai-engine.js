// js/ai-engine.js — Local Makruk search + evaluation.
//
// Pure, board-only logic: no DOM, no network. Operates on a `Game` instance
// (from game.js) via its cheap `_do`/`_undo` make/unmake API, so it is safe
// to run from a Web Worker (see ai-worker.js) or a plain script/tests.
//
// Search: iterative-deepening negamax with alpha-beta pruning, MVV-LVA +
// killer-move ordering, a position transposition table, and an optional
// quiescence search on captures (top difficulty levels only). Iterative deepening enforces
// a hard wall-clock budget — if a depth cannot finish in time, its partial
// results are discarded and the previous depth's best move is returned, so
// the caller never blocks indefinitely.

import { PT } from './game.js';

// ---------------------------------------------------------------------
// Difficulty levels — numeric 1 (weakest/fastest) .. 10 (strongest).
// ---------------------------------------------------------------------
// maxDepth   — ceiling on iterative-deepening depth (plies)
// timeMs     — hard wall-clock budget per move (level 10 == old Expert's
//              budget exactly, so the UI never freezes any longer than it
//              already did)
// useTT      — enable the transposition table
// useKillers — enable killer-move ordering
// quiescence — extend leaf search across captures (and check evasions)
// randomize  — pick randomly among near-best root moves (old "Easy" quirk),
//              kept for the two weakest levels so they aren't perfectly
//              deterministic
//
// This is an interpolation of the previous 4 named tiers (Easy/Medium/
// Hard/Expert ≈ levels 2/4/6/10 below) into 10 steps — same shape, finer
// grain.
export const LEVELS = {
  1:  { maxDepth: 1,  timeMs: 150,  useTT: false, useKillers: false, quiescence: false, randomize: true },
  2:  { maxDepth: 2,  timeMs: 300,  useTT: false, useKillers: false, quiescence: false, randomize: true },
  3:  { maxDepth: 3,  timeMs: 500,  useTT: false, useKillers: false, quiescence: false },
  4:  { maxDepth: 4,  timeMs: 800,  useTT: false, useKillers: false, quiescence: false },
  5:  { maxDepth: 5,  timeMs: 1100, useTT: true,  useKillers: true,  quiescence: false },
  6:  { maxDepth: 6,  timeMs: 1500, useTT: true,  useKillers: true,  quiescence: false },
  7:  { maxDepth: 7,  timeMs: 1900, useTT: true,  useKillers: true,  quiescence: false },
  8:  { maxDepth: 8,  timeMs: 2300, useTT: true,  useKillers: true,  quiescence: true  },
  9:  { maxDepth: 9,  timeMs: 2700, useTT: true,  useKillers: true,  quiescence: true  },
  10: { maxDepth: 10, timeMs: 3000, useTT: true,  useKillers: true,  quiescence: true  },
};
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
export const DEFAULT_LEVEL = 5;

// 1-2 Easy · 3-5 Medium · 6-8 Hard · 9-10 Expert — a short named band next
// to the number, for UI labels.
export function levelBand(n) {
  const lvl = Number(n);
  if (lvl <= 2) return 'Easy';
  if (lvl <= 5) return 'Medium';
  if (lvl <= 8) return 'Hard';
  return 'Expert';
}

// ---------------------------------------------------------------------
// Evaluation weights (centipawn-ish units — tune here)
// ---------------------------------------------------------------------
// Material: Makruk has no queen-equivalent, so the Rook is the strongest
// piece by a wide margin. Met and Knight are roughly comparable "minor"
// attackers. Khon is notably weak — one diagonal step plus one step
// straight forward only, no sliding. Pawns are cheap but ramp up sharply
// as they approach promotion (to Met) on the far 3 ranks.
export const MATERIAL = {
  [PT.KING]:   0,
  [PT.ROOK]:   500,
  [PT.KNIGHT]: 300,
  [PT.MET]:    250,
  [PT.KHON]:   170,
  [PT.PAWN]:   100,
};

const CENTRAL_WEIGHT = {
  [PT.ROOK]:   3,
  [PT.KNIGHT]: 5,
  [PT.MET]:    3,
  [PT.KHON]:   2,
  [PT.PAWN]:   2,
};

const MOBILITY_WEIGHT       = 4;   // per pseudo-legal move
const KING_SAFETY_WEIGHT    = 12;  // per (shield - exposed) unit around the king
const KING_CENTRAL_WEIGHT   = 4;   // king centralization, scaled by endgame factor
const PAWN_ADVANCE_WEIGHT   = 6;   // per rank advanced from the start rank
const PAWN_NEAR_PROMO_BONUS = 30;  // extra kicker one step from promotion
const HANGING_PENALTY       = 0.5; // fraction of a piece's value if it looks hanging

// Endgame ramps in as total non-king material drops. Starting material for
// both sides combined is 2*(500*2 + 300*2 + 170*2 + 250 + 100*8) = 5980.
const ENDGAME_FULL = 5000;
const ENDGAME_LOW  = 1400;

const MATE_SCORE = 100000;
const INF = Infinity;

// Chebyshev-distance-from-center table: 3.5 at the four center squares,
// falling off towards the edges. Shared by piece centralization and (via
// KING_CENTRAL_WEIGHT) king activity in the endgame.
const CENTRAL_TABLE = Array.from({ length: 8 }, (_, y) =>
  Array.from({ length: 8 }, (_, x) => 3.5 - Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5)))
);

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---------------------------------------------------------------------
// Move generation helpers (reuse Game's own legality logic as the single
// source of truth — see game.js `legalMoves`/`pseudoMoves`/`inCheck`).
// ---------------------------------------------------------------------

function genLegalMoves(game, color) {
  const moves = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = game.at(x, y);
      if (!p || p.c !== color) continue;
      const ls = game.legalMoves(x, y);
      for (const m of ls) {
        moves.push({ from: { x, y }, to: { x: m.x, y: m.y }, piece: p, captured: game.at(m.x, m.y) });
      }
    }
  }
  return moves;
}

function sig(mv) {
  return mv ? `${mv.from.x},${mv.from.y}-${mv.to.x},${mv.to.y}` : null;
}

function hashKey(game) {
  let s = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = game.at(x, y);
      s += p ? p.c + p.t : '.';
    }
  }
  return s;
}

// MVV-LVA captures first, then TT/killer hints, then everything else.
function orderMoves(moves, ttMoveSig, killerPair, ctx) {
  const k0 = killerPair ? killerPair[0] : null;
  const k1 = killerPair ? killerPair[1] : null;

  const scored = moves.map(mv => {
    let score = 0;
    const s = sig(mv);
    if (ttMoveSig && s === ttMoveSig) {
      score = 1_000_000;
    } else if (mv.captured) {
      score = 100_000 + MATERIAL[mv.captured.t] * 10 - MATERIAL[mv.piece.t];
    } else if (ctx.useKillers && (s === k0 || s === k1)) {
      score = 50_000;
    }
    return { mv, score };
  });
  scored.sort((a, b) => b.score - a.score);
  for (let i = 0; i < moves.length; i++) moves[i] = scored[i].mv;
}

function storeKiller(killers, ply, mv) {
  const s = sig(mv);
  const slot = killers[ply] || (killers[ply] = [null, null]);
  if (slot[0] === s) return;
  slot[1] = slot[0];
  slot[0] = s;
}

// ---------------------------------------------------------------------
// Evaluation — clear, tunable weighted sum. Positive favors White; the
// caller flips sign for the side asking ("color").
// ---------------------------------------------------------------------

function kingSafetyTerm(game, k, color) {
  const enemy = game.enemyColor(color);
  let shield = 0, exposed = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = k.x + dx, ny = k.y + dy;
      if (!game.inBounds(nx, ny)) continue;
      const occ = game.at(nx, ny);
      if (occ && occ.c === color) shield++;
      if (game.squareAttacked(nx, ny, enemy)) exposed++;
    }
  }
  return shield - exposed;
}

// Coarse static "is this piece hanging" check. Real tactical awareness
// comes from the search itself (captures ordered first, quiescence at
// Expert) — this term just nudges the static eval so mid-search leaf
// nodes aren't blind to an obviously undefended piece.
function threatTerm(game, pieces, color) {
  const enemy = game.enemyColor(color);
  let term = 0;
  for (const { x, y, p } of pieces) {
    if (p.c !== color || p.t === PT.PAWN || p.t === PT.KING) continue;
    if (game.squareAttacked(x, y, enemy) && !game.squareAttacked(x, y, color)) {
      term -= MATERIAL[p.t] * HANGING_PENALTY;
    }
  }
  return term;
}

function evaluate(game, color) {
  const pieces = [];
  let whiteMaterial = 0, blackMaterial = 0;

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = game.at(x, y);
      if (!p) continue;
      pieces.push({ x, y, p });
      if (p.t !== PT.KING) {
        if (p.c === 'w') whiteMaterial += MATERIAL[p.t];
        else blackMaterial += MATERIAL[p.t];
      }
    }
  }

  const totalMaterial = whiteMaterial + blackMaterial;
  const endgameFactor = clamp((ENDGAME_FULL - totalMaterial) / (ENDGAME_FULL - ENDGAME_LOW), 0, 1);

  let score = whiteMaterial - blackMaterial;
  let wk = null, bk = null;

  for (const { x, y, p } of pieces) {
    const sign = p.c === 'w' ? 1 : -1;

    if (p.t === PT.KING) {
      if (p.c === 'w') wk = { x, y }; else bk = { x, y };
      score += sign * KING_CENTRAL_WEIGHT * endgameFactor * CENTRAL_TABLE[y][x];
      continue;
    }

    score += sign * (CENTRAL_WEIGHT[p.t] || 0) * CENTRAL_TABLE[y][x];
    score += sign * MOBILITY_WEIGHT * game.pseudoMoves(x, y).length;

    if (p.t === PT.PAWN) {
      const advancement = p.c === 'w' ? Math.max(0, 5 - y) : Math.max(0, y - 2);
      score += sign * PAWN_ADVANCE_WEIGHT * advancement * (1 + endgameFactor);
      if (advancement === 2) score += sign * PAWN_NEAR_PROMO_BONUS;
    }
  }

  const safetyWeight = KING_SAFETY_WEIGHT * (1 - 0.6 * endgameFactor);
  if (wk) score += kingSafetyTerm(game, wk, 'w') * safetyWeight;
  if (bk) score -= kingSafetyTerm(game, bk, 'b') * safetyWeight;

  score += threatTerm(game, pieces, 'w');
  score -= threatTerm(game, pieces, 'b');

  return color === 'w' ? score : -score;
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

// Time control is threaded through `ctx.timeUp` rather than thrown as an
// exception. An exception unwinding through recursive negamax/quiescence
// frames would skip the `_undo` call that follows each `_do` in every
// enclosing frame, permanently corrupting the shared `game` board. Instead,
// once the deadline passes every frame still runs its `_do` → recurse →
// `_undo` in order and only *then* notices `ctx.timeUp` and bails, so the
// board is always left exactly as it was found.

function quiescence(game, alpha, beta, color, ply, ctx) {
  if (ctx.timeUp) return 0;
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) { ctx.timeUp = true; return 0; }

  // Hard safety cap on check-evasion chains (uncapped by maxQPly below,
  // since standing pat mid-check isn't legal) so a long forced-check run
  // can't blow the call stack.
  if (ply - ctx.qRootPly > ctx.maxQPly * 3) return evaluate(game, color);

  const inCheckNow = game.inCheck(color);
  const standPat = inCheckNow ? -MATE_SCORE + ply : evaluate(game, color);

  if (!inCheckNow) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (ply - ctx.qRootPly > ctx.maxQPly) return alpha;
  }

  const all = genLegalMoves(game, color);
  if (inCheckNow && all.length === 0) return -MATE_SCORE + ply;

  const candidates = inCheckNow ? all : all.filter(m => m.captured);
  orderMoves(candidates, null, null, ctx);

  for (const mv of candidates) {
    const snap = game._do(mv.from, mv.to);
    const val = -quiescence(game, -beta, -alpha, game.enemyColor(color), ply + 1, ctx);
    game._undo(mv.from, mv.to, snap);
    if (ctx.timeUp) break;

    if (val >= beta) return beta;
    if (val > alpha) alpha = val;
  }

  return alpha;
}

function negamax(game, depth, alpha, beta, color, ply, ctx) {
  if (ctx.timeUp) return 0;
  ctx.nodes++;
  if ((ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) { ctx.timeUp = true; return 0; }

  const alphaOrig = alpha;
  let ttMoveSig = null;
  let key = null;

  if (ctx.useTT) {
    key = hashKey(game) + '|' + color;
    const entry = ctx.tt.get(key);
    if (entry) {
      ttMoveSig = entry.bestMoveSig;
      if (entry.depth >= depth) {
        if (entry.flag === 'exact') return entry.score;
        if (entry.flag === 'lower') alpha = Math.max(alpha, entry.score);
        else if (entry.flag === 'upper') beta = Math.min(beta, entry.score);
        if (alpha >= beta) return entry.score;
      }
    }
  }

  const moves = genLegalMoves(game, color);
  if (moves.length === 0) {
    return game.inCheck(color) ? -MATE_SCORE + ply : 0;
  }

  if (depth <= 0) {
    return ctx.useQuiescence
      ? (ctx.qRootPly = ply, quiescence(game, alpha, beta, color, ply, ctx))
      : evaluate(game, color);
  }

  orderMoves(moves, ttMoveSig, ctx.killers[ply], ctx);

  let best = -INF;
  let bestMoveSig = null;

  for (const mv of moves) {
    const snap = game._do(mv.from, mv.to);
    const val = -negamax(game, depth - 1, -beta, -alpha, game.enemyColor(color), ply + 1, ctx);
    game._undo(mv.from, mv.to, snap);
    if (ctx.timeUp) break;

    if (val > best) { best = val; bestMoveSig = sig(mv); }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (ctx.useKillers && !mv.captured) storeKiller(ctx.killers, ply, mv);
      break;
    }
  }

  // Mate scores are ply-relative (see MATE_SCORE usage above); caching one
  // under a position-only key and replaying it at a different ply via
  // transposition would misreport the mate distance. Simplest safe fix:
  // just don't cache near-mate scores — they're cheap to recompute and rare.
  const isMateScore = Math.abs(best) > MATE_SCORE - 1000;
  if (ctx.useTT && !ctx.timeUp && best > -INF && !isMateScore) {
    const flag = best <= alphaOrig ? 'upper' : (best >= beta ? 'lower' : 'exact');
    if (ctx.tt.size > 200000) ctx.tt.clear();
    ctx.tt.set(key, { depth, score: best, flag, bestMoveSig });
  }

  return best;
}

// Iterative-deepening root search. `game` must already be positioned with
// `game.turn` set to the side to move — that side's best move is returned.
// `level` is a number 1-10 (see LEVELS above).
export function findBestMove(game, level, sharedTT) {
  const levelCfg = LEVELS[level] || LEVELS[DEFAULT_LEVEL];
  const color = game.turn;
  const start = Date.now();

  const ctx = {
    deadline: start + levelCfg.timeMs,
    nodes: 0,
    timeUp: false,
    tt: levelCfg.useTT ? (sharedTT || new Map()) : null,
    useTT: levelCfg.useTT,
    useKillers: levelCfg.useKillers,
    killers: [],
    useQuiescence: levelCfg.quiescence,
    maxQPly: 6,
    qRootPly: 0,
  };

  const rootMoves = genLegalMoves(game, color);
  if (rootMoves.length === 0) {
    return { move: null, stats: { depth: 0, nodes: 0, timeMs: 0, score: 0 } };
  }

  let bestMove = rootMoves[0];
  let bestScore = 0;
  let depthReached = 0;
  let rootBestMoveSig = null;
  let lastCompletedResults = null;

  for (let depth = 1; depth <= levelCfg.maxDepth; depth++) {
    ctx.killers = [];
    orderMoves(rootMoves, rootBestMoveSig, null, ctx);

    let alpha = -INF, beta = INF;
    let curBestScore = -INF, curBestMove = null;
    const results = [];

    for (const mv of rootMoves) {
      const snap = game._do(mv.from, mv.to);
      const val = -negamax(game, depth - 1, -beta, -alpha, game.enemyColor(color), 1, ctx);
      game._undo(mv.from, mv.to, snap);
      if (ctx.timeUp) break; // discard this whole depth — the board is clean, only the result is partial

      results.push({ move: mv, score: val });
      if (val > curBestScore) { curBestScore = val; curBestMove = mv; }
      if (val > alpha) alpha = val;
    }

    if (ctx.timeUp) break;

    bestMove = curBestMove;
    bestScore = curBestScore;
    depthReached = depth;
    rootBestMoveSig = sig(bestMove);
    lastCompletedResults = results;

    if (Math.abs(bestScore) > MATE_SCORE - 1000) break; // forced mate found
    if (Date.now() > ctx.deadline) break;
  }

  // Weakest levels: pick randomly among root moves close to the best score,
  // so they aren't perfectly deterministic.
  if (levelCfg.randomize && lastCompletedResults) {
    const EPS = 40;
    const near = lastCompletedResults.filter(r => r.score >= bestScore - EPS);
    if (near.length > 1) {
      bestMove = near[(Math.random() * near.length) | 0].move;
    }
  }

  return {
    move: bestMove ? { from: bestMove.from, to: bestMove.to } : null,
    stats: { depth: depthReached, nodes: ctx.nodes, timeMs: Date.now() - start, score: bestScore },
  };
}
