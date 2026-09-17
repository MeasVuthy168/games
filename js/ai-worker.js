// js/ai-worker.js — runs the local Makruk search off the main thread so the
// board UI never freezes during "AI thinking". Reconstructs a `Game`
// instance from the posted board/turn and hands it to ai-engine.js.

import { Game } from './game.js';
import { findBestMove, mulberry32 } from './ai-engine.js';

// Transposition table persists across searches within this worker's
// lifetime (i.e. for the whole game, until ui.js recreates the worker on
// reset/undo) — reused move-to-move for Hard/Expert.
const tt = new Map();

// AI-vs-AI only: one independent RNG stream per color, persisted the same
// way `tt` is (for the life of this worker — reset along with everything
// else on Reset/Undo, since resetAI() tears the whole worker down). Kept
// separate per color rather than sharing a single generator so White's and
// Black's tie-break draws are genuinely independent of each other, not just
// separate calls into the same shared sequence. A debug seed (if the caller
// supplies one) makes both streams — and therefore the whole game —
// reproducible for testing; otherwise each is seeded from real entropy once,
// the first time that color actually needs it.
const rngByColor = Object.create(null);
function rngFor(color, seed) {
  if (seed != null) return (rngByColor[color] = mulberry32((seed >>> 0) + (color === 'w' ? 0 : 1)));
  if (!rngByColor[color]) {
    rngByColor[color] = mulberry32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  }
  return rngByColor[color];
}

self.onmessage = (e) => {
  const data = e.data || {};
  if (data.type !== 'search') return;

  const { board, turn, level, requestId, aiVsAi, positionHistory, seed } = data;
  const game = new Game();
  game.board = board;
  game.turn = turn;
  game.history = [];
  game.winner = null;

  try {
    const opts = aiVsAi
      ? { tieBreak: true, rng: rngFor(turn, seed), positionHistory: positionHistory || null }
      : {};
    const result = findBestMove(game, level, tt, opts);
    self.postMessage({ type: 'result', requestId, move: result.move, stats: result.stats });
  } catch (err) {
    self.postMessage({
      type: 'result',
      requestId,
      move: null,
      stats: { error: String((err && err.message) || err) },
    });
  }
};
