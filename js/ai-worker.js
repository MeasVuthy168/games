// js/ai-worker.js — runs the local Makruk search off the main thread so the
// board UI never freezes during "AI thinking". Reconstructs a `Game`
// instance from the posted board/turn and hands it to ai-engine.js.

import { Game } from './game.js';
import { findBestMove } from './ai-engine.js';

// Transposition table persists across searches within this worker's
// lifetime (i.e. for the whole game, until ui.js recreates the worker on
// reset/undo) — reused move-to-move for Hard/Expert.
const tt = new Map();

self.onmessage = (e) => {
  const data = e.data || {};
  if (data.type !== 'search') return;

  const { board, turn, level, requestId } = data;
  const game = new Game();
  game.board = board;
  game.turn = turn;
  game.history = [];
  game.winner = null;

  try {
    const result = findBestMove(game, level, tt);
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
