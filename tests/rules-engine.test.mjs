// tests/rules-engine.test.mjs — permanent regression suite for the Ouk
// Chaktrang rules engine (js/game.js) and AI search (js/ai-engine.js).
//
// Zero dependencies: uses Node's built-in test runner and assert module
// directly against the real ES modules the app ships (no reimplementation
// of any rule). Run with:
//   node --test tests/
//
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PT, COLORS, piece } from '../js/game.js';
import { findBestMove, positionHash } from '../js/ai-engine.js';

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function mkGame(setup, turn) {
  const g = new Game();
  const b = emptyBoard();
  setup(b);
  g.board = b;
  g.turn = turn;
  g.history = [];
  g.winner = null;
  return g;
}

function sq(x, y) {
  return `${String.fromCharCode(97 + x)}${8 - y}`;
}

function has(moves, x, y) {
  return moves.some(m => m.x === x && m.y === y);
}

function attackerCount(game, kingX, kingY, byColor) {
  let n = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = game.at(x, y);
      if (p && p.c === byColor && game.attacksFrom(x, y).some(m => m.x === kingX && m.y === kingY)) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------
// 1. Check detection: direct, discovered, double, pin, block, capture
// ---------------------------------------------------------------------
describe('check detection', () => {
  test('direct check', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);  // e8
      b[0][0] = piece(PT.KING, COLORS.BLACK);  // a8
    }, COLORS.WHITE);
    assert.equal(g.inCheck(COLORS.WHITE), true);
  });

  test('discovered check: moving a blocker off the shared file exposes the king', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);    // e1
      b[4][4] = piece(PT.KNIGHT, COLORS.WHITE);  // e4, blocks the file
      b[6][4] = piece(PT.ROOK, COLORS.WHITE);    // e2, the discoverer
      b[0][4] = piece(PT.KING, COLORS.BLACK);    // e8
    }, COLORS.WHITE);
    assert.equal(g.inCheck(COLORS.BLACK), false);
    const dest = g.legalMoves(4, 4)[0];
    assert.ok(dest, 'knight must have at least one legal move');
    const r = g.move({ x: 4, y: 4 }, dest);
    assert.equal(r.ok, true);
    assert.equal(g.inCheck(COLORS.BLACK), true);
  });

  test('double check: a single move creates two simultaneous checks', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);    // e1
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);    // e8, blocked by the knight below
      b[5][4] = piece(PT.KNIGHT, COLORS.BLACK);  // e3, blocker about to move
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.BLACK);
    assert.equal(g.inCheck(COLORS.WHITE), false);
    const r = g.move({ x: 4, y: 5 }, { x: 2, y: 6 }); // Ne3-c2
    assert.equal(r.ok, true);
    assert.equal(g.inCheck(COLORS.WHITE), true);
    assert.equal(attackerCount(g, 4, 7, COLORS.BLACK), 2);
  });

  test('pinned piece may only move along the pin line (including capturing the pinner)', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);   // e1
      b[4][4] = piece(PT.ROOK, COLORS.WHITE);   // e4, pinned
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);   // e8, pinning along the e-file
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const moves = g.legalMoves(4, 4).map(m => sq(m.x, m.y)).sort();
    assert.deepEqual(moves, ['e2', 'e3', 'e5', 'e6', 'e7', 'e8'].sort());
  });

  test('interposing a piece on the check line is legal, unrelated moves are not', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);    // e1
      b[6][0] = piece(PT.PAWN, COLORS.WHITE);    // a2, irrelevant to the check
      b[5][2] = piece(PT.KNIGHT, COLORS.WHITE);  // c3, can jump onto e4 to interpose
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);    // e8
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    assert.equal(g.inCheck(COLORS.WHITE), true);
    assert.deepEqual(g.legalMoves(6, 0), []); // a2 pawn: does not resolve check
    const res = g.move({ x: 0, y: 6 }, { x: 0, y: 5 });
    assert.equal(res.ok, false);

    const knightMoves = g.legalMoves(2, 5).map(m => sq(m.x, m.y));
    assert.ok(knightMoves.includes('e4'), 'knight must be able to interpose on e4 to block the check');
    const r2 = g.move({ x: 2, y: 5 }, { x: 4, y: 4 });
    assert.equal(r2.ok, true);
    assert.equal(g.inCheck(COLORS.WHITE), false);
  });

  test('capturing the checking piece resolves check', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);   // e1
      b[6][3] = piece(PT.ROOK, COLORS.WHITE);   // d2, can capture the checker
      b[6][4] = piece(PT.ROOK, COLORS.BLACK);   // e2, checking the king
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    assert.equal(g.inCheck(COLORS.WHITE), true);
    const moves = g.legalMoves(3, 6).map(m => sq(m.x, m.y));
    assert.ok(moves.includes('e2'), 'capturing rook must be a legal move while in check');
    const r = g.move({ x: 3, y: 6 }, { x: 4, y: 6 });
    assert.equal(r.ok, true);
    assert.equal(g.inCheck(COLORS.WHITE), false);
  });
});

// ---------------------------------------------------------------------
// 2. King safety
// ---------------------------------------------------------------------
describe('king safety', () => {
  test('king cannot move into an attacked square', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1
      b[0][3] = piece(PT.ROOK, COLORS.BLACK);  // d8 - covers the d-file
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const moves = g.legalMoves(4, 7).map(m => sq(m.x, m.y));
    assert.ok(!moves.includes('d1'), 'king must not be able to step onto an attacked square');
  });

  test('king cannot remain in check (must make a legality-restoring move)', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[6][0] = piece(PT.PAWN, COLORS.WHITE);
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    // Every legal move for every white piece must leave white NOT in check.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const p = g.at(x, y);
        if (!p || p.c !== COLORS.WHITE) continue;
        for (const mv of g.legalMoves(x, y)) {
          const snap = g._do({ x, y }, mv);
          assert.equal(g.inCheck(COLORS.WHITE), false,
            `${sq(x, y)}-${sq(mv.x, mv.y)} was reported legal but leaves white in check`);
          g._undo({ x, y }, mv, snap);
        }
      }
    }
  });

  test('non-king piece cannot move during check unless it resolves the check', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[6][0] = piece(PT.PAWN, COLORS.WHITE);   // a2, cannot help
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    assert.deepEqual(g.legalMoves(6, 0), []);
    const res = g.move({ x: 0, y: 6 }, { x: 0, y: 5 });
    assert.equal(res.ok, false);
    // and the legal, check-resolving king move IS accepted
    const kingMoves = g.legalMoves(4, 7);
    assert.ok(kingMoves.length > 0);
    const r2 = g.move({ x: 4, y: 7 }, kingMoves[0]);
    assert.equal(r2.ok, true);
  });
});

// ---------------------------------------------------------------------
// 3. Checkmate / 4. Stalemate
// ---------------------------------------------------------------------
describe('checkmate and stalemate', () => {
  test('known checkmate position: no legal moves + inCheck = checkmate', () => {
    const g = mkGame(b => {
      b[0][0] = piece(PT.KING, COLORS.BLACK);   // a8, boxed by own pawns
      b[1][0] = piece(PT.PAWN, COLORS.BLACK);   // a7
      b[1][1] = piece(PT.PAWN, COLORS.BLACK);   // b7
      b[7][7] = piece(PT.KING, COLORS.WHITE);   // h1
      b[0][7] = piece(PT.ROOK, COLORS.WHITE);   // h8 - mates along the back rank
    }, COLORS.BLACK);
    assert.equal(g.hasAnyLegalMove(COLORS.BLACK), false);
    assert.equal(g.inCheck(COLORS.BLACK), true);
    assert.deepEqual(g.status(), { state: 'checkmate', inCheck: true, toMove: COLORS.BLACK });
  });

  test('stalemate: no legal moves + NOT in check = stalemate', () => {
    const g = mkGame(b => {
      b[0][0] = piece(PT.KING, COLORS.BLACK);   // a8
      const wk = piece(PT.KING, COLORS.WHITE);
      wk.moved = true; // avoid an incidental leap-threat on a8 from b6 (unrelated to this test)
      b[2][1] = wk;                              // b6 - covers a7,b7
      b[1][2] = piece(PT.MET, COLORS.WHITE);    // c7 - covers b8
    }, COLORS.BLACK);
    assert.equal(g.inCheck(COLORS.BLACK), false);
    assert.deepEqual(g.legalMoves(0, 0), []);
    assert.deepEqual(g.status(), { state: 'stalemate', inCheck: false, toMove: COLORS.BLACK });
  });

  test('checkmate takes priority over a Counting Draw reaching its limit on the same move', () => {
    const g = mkGame(b => {
      const bk = piece(PT.KING, COLORS.BLACK);
      bk.moved = true; // avoid an incidental leap-threat on b6 from a8 (unrelated to this test)
      b[0][0] = bk;                              // a8
      const wk = piece(PT.KING, COLORS.WHITE);
      wk.moved = true; // avoid an incidental leap-threat on a8 from b6 (unrelated to this test)
      b[2][1] = wk;                              // b6 - covers a7,b7
      b[0][7] = piece(PT.ROOK, COLORS.WHITE);   // h8 - about to mate via c8
    }, COLORS.WHITE);
    // Piece Count already active, one move away from the limit — if this
    // move were evaluated purely as a counting increment it would hit the
    // draw limit, but it also delivers checkmate; checkmate must win.
    g.counting = {
      active: true, type: 'PIECE', countingSide: COLORS.BLACK, strongerSide: COLORS.WHITE,
      limit: 16, current: 15, remaining: 1, result: null, justStarted: false, justIncremented: false,
    };
    const r = g.move({ x: 7, y: 0 }, { x: 2, y: 0 }); // Rh8-c8#
    assert.equal(r.ok, true);
    assert.equal(r.status.state, 'checkmate');
    assert.equal(g.winner, COLORS.WHITE);
    // The counting phase must be left untouched — _updateCounting() is
    // never called on the checkmate branch (see game.js move()).
    assert.equal(g.counting.current, 15);
    assert.equal(g.counting.result, null);
  });
});

// ---------------------------------------------------------------------
// 5. Ouk Chaktrang special rules: King leap, Met leap, promotion
// ---------------------------------------------------------------------
describe('Ouk Chaktrang special rules', () => {
  test('King first-move leap is available when unmoved', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const moves = g.legalMoves(4, 7);
    assert.ok(has(moves, 5, 5), 'king should be able to leap to f3 (knight-jump)');
  });

  test('King leap is unavailable once this king has moved', () => {
    const g = mkGame(b => {
      const k = piece(PT.KING, COLORS.WHITE);
      k.moved = true;
      b[7][4] = k;
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    assert.ok(!has(g.legalMoves(4, 7), 5, 5));
  });

  test('Met first-move 2-square advance is available when unmoved', () => {
    const g = mkGame(b => {
      b[6][4] = piece(PT.MET, COLORS.WHITE);   // e2
      b[7][0] = piece(PT.KING, COLORS.WHITE);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    assert.ok(has(g.legalMoves(4, 6), 4, 4), 'met should reach e4 via the 2-square advance');
  });

  test('pawn promotes to Met upon entering the last 3 ranks', () => {
    const g = mkGame(b => {
      b[3][4] = piece(PT.PAWN, COLORS.WHITE);  // e5 (y=3), one step from the promotion zone (y<=2)
      b[7][0] = piece(PT.KING, COLORS.WHITE);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const r = g.move({ x: 4, y: 3 }, { x: 4, y: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.promo, true);
    const now = g.at(4, 2);
    assert.equal(now.t, PT.MET);
  });

  test('a promoted Met cannot use the first-move leap (it is already flagged as moved)', () => {
    const g = mkGame(b => {
      b[3][4] = piece(PT.PAWN, COLORS.WHITE);
      b[7][0] = piece(PT.KING, COLORS.WHITE);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const r = g.move({ x: 4, y: 3 }, { x: 4, y: 2 });
    assert.equal(r.ok, true);
    const now = g.at(4, 2);
    assert.equal(now.moved, true, 'a piece is always flagged moved by _do on arrival');
    assert.ok(!has(g.legalMoves(4, 2), 4, 0), 'promoted met must not have the 2-square advance available');
  });
});

// ---------------------------------------------------------------------
// 5b. R5 (canonical decision B): per-piece/per-square special-move
// gating — an unrelated capture elsewhere on the board must NOT cancel
// another still-unmoved King's/Met's special first move. Only that
// piece's own move (including using the special move itself), or that
// piece being captured, ends its own eligibility. No rank/file/crossing
// mechanism exists or is introduced.
// ---------------------------------------------------------------------
describe('R5 — per-piece/per-square capture gating', () => {
  test('R5-1/R5-2: an unrelated White capture does not cancel White King leap or Met advance', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);   // e1, unmoved
      b[7][3] = piece(PT.MET, COLORS.WHITE);    // d1, unmoved
      b[7][7] = piece(PT.ROOK, COLORS.WHITE);   // h1
      b[0][4] = piece(PT.KING, COLORS.BLACK);   // e8
      b[0][7] = piece(PT.KNIGHT, COLORS.BLACK); // h8, undefended
    }, COLORS.WHITE);
    const r = g.move({ x: 7, y: 7 }, { x: 7, y: 0 }); // Rh1xh8 — unrelated capture
    assert.equal(r.ok, true);
    assert.equal(r.captured?.t, PT.KNIGHT);
    assert.ok(has(g.legalMoves(4, 7), 5, 5), 'King leap must remain legal after an unrelated capture');
    assert.ok(has(g.legalMoves(3, 7), 3, 5), 'Met 2-square advance (d1-d3) must remain legal after an unrelated capture');
  });

  test('R5-3/R5-4: an unrelated Black capture does not cancel Black King leap or Met advance', () => {
    const g = mkGame(b => {
      b[0][4] = piece(PT.KING, COLORS.BLACK);   // e8, unmoved
      b[0][3] = piece(PT.MET, COLORS.BLACK);    // d8, unmoved
      b[0][7] = piece(PT.ROOK, COLORS.BLACK);   // h8
      b[7][4] = piece(PT.KING, COLORS.WHITE);   // e1
      b[7][7] = piece(PT.KNIGHT, COLORS.WHITE); // h1, undefended
    }, COLORS.BLACK);
    const r = g.move({ x: 7, y: 0 }, { x: 7, y: 7 }); // Rh8xh1 — unrelated capture
    assert.equal(r.ok, true);
    assert.equal(r.captured?.t, PT.KNIGHT);
    assert.ok(has(g.legalMoves(4, 0), 5, 2), 'Black King leap must remain legal after an unrelated capture');
    assert.ok(has(g.legalMoves(3, 0), 3, 2), 'Black Met 2-square advance (d8-d6) must remain legal after an unrelated capture');
  });

  test('R5-5: a King\'s own normal (non-leap) move removes its own leap privilege', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const r = g.move({ x: 4, y: 7 }, { x: 4, y: 6 }); // Ke1-e2, an ordinary 1-step move
    assert.equal(r.ok, true);
    assert.ok(!has(g.legalMoves(4, 6), 3, 4) && !has(g.legalMoves(4, 6), 5, 4),
      'king must not have any leap-shaped move available after an ordinary move');
  });

  test('R5-6: a King\'s own leap move (using the privilege) removes it for any further use', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const r = g.move({ x: 4, y: 7 }, { x: 5, y: 5 }); // Ke1-f3, the leap itself
    assert.equal(r.ok, true);
    const now = g.at(5, 5);
    assert.equal(now.moved, true);
    assert.ok(!has(g.legalMoves(5, 5), 6, 3) && !has(g.legalMoves(5, 5), 4, 3),
      'king must not be able to leap again after already using its one-time leap');
  });

  test('R5-7: King leap remains illegal while that King is in check', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1, unmoved
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);  // e8, checks along the open e-file
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    assert.equal(g.inCheck(COLORS.WHITE), true);
    const moves = g.legalMoves(4, 7).map(m => sq(m.x, m.y));
    assert.ok(!moves.includes('f3') && !moves.includes('d3'), 'no leap-shaped destination while in check');
  });

  test('R5-8: an unrelated piece merely sharing the King\'s file (not landing on its square) does not cancel the leap — no rank/file rule exists', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);   // e1, unmoved
      b[4][4] = piece(PT.KHON, COLORS.WHITE);   // e4, blocks the e-file so no check results
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);   // e8
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.BLACK);
    const r = g.move({ x: 4, y: 0 }, { x: 4, y: 3 }); // Re8-e5: same file as the White king, blocked, no check
    assert.equal(r.ok, true);
    assert.equal(g.inCheck(COLORS.WHITE), false, 'the blocker must prevent check for this test to be meaningful');
    assert.ok(has(g.legalMoves(4, 7), 5, 5), 'King leap must remain legal — sharing a file without landing on e1 has no effect');
  });
});

// ---------------------------------------------------------------------
// 6. Counting Draw
// ---------------------------------------------------------------------
describe('Counting Draw', () => {
  test('bare kings is an immediate draw', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[0][4] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    const r = g.move({ x: 4, y: 7 }, { x: 4, y: 6 });
    assert.equal(r.ok, true);
    assert.equal(g.counting.type, 'BARE_KINGS');
    assert.equal(g.winner, 'draw');
  });

  test('Piece Count initializes the moment a side is reduced to a lone king', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[7][3] = piece(PT.ROOK, COLORS.WHITE);  // d1, will capture the lone black pawn
      b[0][4] = piece(PT.KING, COLORS.BLACK);
      b[3][3] = piece(PT.PAWN, COLORS.BLACK);  // d5 - black's only non-king piece
    }, COLORS.WHITE);
    // Before the capture: an unpromoted pawn is still on the board.
    assert.deepEqual(g.evaluateCountingState(), { eligible: false });
    const r = g.move({ x: 3, y: 7 }, { x: 3, y: 3 }); // Rd1xd5
    assert.equal(r.ok, true);
    assert.equal(g.counting.active, true);
    assert.equal(g.counting.type, 'PIECE');
    assert.equal(g.counting.countingSide, COLORS.BLACK);
    assert.equal(g.counting.strongerSide, COLORS.WHITE);
    assert.equal(g.counting.limit, 16); // one rook
    assert.equal(g.counting.current, g.getTotalBoardPieces()); // starts at total pieces, not 0
    assert.equal(g.counting.justStarted, true);
  });

  test('R9: once active, every completed ply increments progress by exactly 1, regardless of side', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[7][3] = piece(PT.ROOK, COLORS.WHITE);
      b[0][4] = piece(PT.KING, COLORS.BLACK);
      b[3][3] = piece(PT.PAWN, COLORS.BLACK);
    }, COLORS.WHITE);
    g.move({ x: 3, y: 7 }, { x: 3, y: 3 }); // White captures -> phase starts, current = total pieces
    const start = g.counting.current;

    // Black moves its king one step -> now increments too (every ply counts).
    const bMoves = g.legalMoves(4, 0);
    assert.ok(bMoves.length > 0);
    g.move({ x: 4, y: 0 }, bMoves[0]);
    assert.equal(g.counting.current, start + 1);
    assert.equal(g.counting.justIncremented, true);

    // White moves its king one step -> increments again.
    const wMoves = g.legalMoves(4, 7);
    assert.ok(wMoves.length > 0);
    g.move({ x: 4, y: 7 }, wMoves[0]);
    assert.equal(g.counting.current, start + 2);
    assert.equal(g.counting.justIncremented, true);
  });

  test('checkmate delivered mid-count still wins outright, not a draw (also covered above end-to-end)', () => {
    // Sanity re-check of evaluateCountingState()'s own priority note: a
    // position with unpromoted pawns is never counting-eligible regardless
    // of material imbalance.
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[0][4] = piece(PT.KING, COLORS.BLACK);
      b[6][0] = piece(PT.PAWN, COLORS.WHITE);
    }, COLORS.WHITE);
    assert.deepEqual(g.evaluateCountingState(), { eligible: false });
  });
});

// ---------------------------------------------------------------------
// 6b. R8 (canonical decision B): the counting limit is fixed the moment
// a phase starts and never changes again for that phase, even when a
// later capture shrinks the stronger side's material category.
// ---------------------------------------------------------------------
describe('R8 — counting limit fixed at phase start', () => {
  test('R8-1: 2 Rooks -> initial limit is 8', () => {
    const g = mkGame(b => {
      b[7][7] = piece(PT.KING, COLORS.WHITE);   // h1
      b[7][0] = piece(PT.ROOK, COLORS.WHITE);   // a1
      b[1][7] = piece(PT.ROOK, COLORS.WHITE);   // h7, will capture the pawn
      b[0][0] = piece(PT.KING, COLORS.BLACK);   // a8
      b[0][7] = piece(PT.PAWN, COLORS.BLACK);   // h8, the board's only pawn
    }, COLORS.WHITE);
    const r = g.move({ x: 7, y: 1 }, { x: 7, y: 0 }); // Rh7xh8
    assert.equal(r.ok, true);
    assert.equal(g.counting.type, 'PIECE');
    assert.equal(g.counting.limit, 8);
  });

  test('R8-2 + R9 combined: 2R -> capture reduces to 1R, limit stays 8, progress keeps advancing every ply', () => {
    const g = mkGame(b => {
      b[7][7] = piece(PT.KING, COLORS.WHITE);   // h1
      b[7][0] = piece(PT.ROOK, COLORS.WHITE);   // a1, undefended — Black king can take it next
      b[1][7] = piece(PT.ROOK, COLORS.WHITE);   // h7, will capture the pawn
      b[6][0] = piece(PT.KING, COLORS.BLACK);   // a2, adjacent to White's a1 rook
      b[0][7] = piece(PT.PAWN, COLORS.BLACK);   // h8, the board's only pawn
    }, COLORS.WHITE);

    // Ply 1 (White): Rh7xh8 removes the last pawn -> Piece Count starts, 2R -> limit 8.
    let r = g.move({ x: 7, y: 1 }, { x: 7, y: 0 });
    assert.equal(r.ok, true);
    assert.equal(g.counting.limit, 8);
    const afterStart = g.counting.current;

    // Ply 2 (Black): Ka2xa1 captures a White rook -> material is now 1 Rook,
    // but the limit must stay frozen at 8 (NOT jump to 16), and this ply
    // still advances progress (R9: every ply counts, including this capture).
    r = g.move({ x: 0, y: 6 }, { x: 0, y: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.captured?.t, PT.ROOK);
    assert.equal(g.counting.limit, 8, 'limit must remain frozen at the original 2-Rook value');
    assert.equal(g.counting.current, afterStart + 1);
    assert.equal(g.counting.justIncremented, true);

    // Ply 3 (White): shuffle the remaining rook -> limit still frozen, progress advances again.
    const wMoves = g.legalMoves(7, 0);
    assert.ok(wMoves.length > 0);
    r = g.move({ x: 7, y: 0 }, wMoves[0]);
    assert.equal(r.ok, true);
    assert.equal(g.counting.limit, 8, 'limit must still be frozen after a further ply');
    assert.equal(g.counting.current, afterStart + 2);
  });

  test('R8-3: 2 Khons -> capture one Khon, limit remains 22', () => {
    const g = mkGame(b => {
      b[7][7] = piece(PT.KING, COLORS.WHITE);   // h1
      b[7][0] = piece(PT.KHON, COLORS.WHITE);   // a1
      b[7][1] = piece(PT.KHON, COLORS.WHITE);   // b1, undefended — Black king can take it
      b[6][1] = piece(PT.KING, COLORS.BLACK);   // b2, adjacent to White's b1 khon
    }, COLORS.WHITE);
    // No pawns anywhere and Black is already a lone king, so Piece Count
    // becomes active on White's very first move (2 Khons -> limit 22).
    let r = g.move({ x: 7, y: 7 }, { x: 6, y: 7 }); // Kh1-g1, plain shuffle
    assert.equal(r.ok, true);
    assert.equal(g.counting.type, 'PIECE');
    assert.equal(g.counting.limit, 22);
    const afterStart = g.counting.current;

    r = g.move({ x: 1, y: 6 }, { x: 1, y: 7 }); // Kb2xb1 — reduces White to 1 Khon
    assert.equal(r.ok, true);
    assert.equal(r.captured?.t, PT.KHON);
    assert.equal(g.counting.limit, 22, 'limit must remain frozen at the original 2-Khon value');
    assert.equal(g.counting.current, afterStart + 1);
  });

  test('R8-4: 2 Knights -> capture one Knight, limit remains 32', () => {
    const g = mkGame(b => {
      b[7][7] = piece(PT.KING, COLORS.WHITE);     // h1
      b[7][0] = piece(PT.KNIGHT, COLORS.WHITE);   // a1
      b[7][1] = piece(PT.KNIGHT, COLORS.WHITE);   // b1, undefended — Black king can take it
      b[6][1] = piece(PT.KING, COLORS.BLACK);     // b2, adjacent to White's b1 knight
    }, COLORS.WHITE);
    let r = g.move({ x: 7, y: 7 }, { x: 6, y: 7 }); // Kh1-g1, plain shuffle
    assert.equal(r.ok, true);
    assert.equal(g.counting.type, 'PIECE');
    assert.equal(g.counting.limit, 32);
    const afterStart = g.counting.current;

    r = g.move({ x: 1, y: 6 }, { x: 1, y: 7 }); // Kb2xb1 — reduces White to 1 Knight
    assert.equal(r.ok, true);
    assert.equal(r.captured?.t, PT.KNIGHT);
    assert.equal(g.counting.limit, 32, 'limit must remain frozen at the original 2-Knight value');
    assert.equal(g.counting.current, afterStart + 1);
  });
});

// ---------------------------------------------------------------------
// 7. Transposition-table position hash correctness
// ---------------------------------------------------------------------
describe('positionHash correctness (Fix 2 regression)', () => {
  test('identical board layouts with different King.moved must not collide', () => {
    const setup = (moved) => (b) => {
      const k = piece(PT.KING, COLORS.WHITE);
      k.moved = moved;
      b[7][4] = k;
      b[0][4] = piece(PT.KING, COLORS.BLACK);
      b[0][0] = piece(PT.ROOK, COLORS.BLACK);
    };
    const gA = mkGame(setup(false), COLORS.WHITE);
    const gC = mkGame(setup(true), COLORS.WHITE);

    const movesA = gA.legalMoves(4, 7).length;
    const movesC = gC.legalMoves(4, 7).length;
    assert.notEqual(movesA, movesC);

    const hashA = positionHash(gA, COLORS.WHITE);
    const hashC = positionHash(gC, COLORS.WHITE);
    assert.notEqual(hashA, hashC, 'positionHash must distinguish differing King.moved state');
  });

  test('positions that truly are identical still hash identically (no false positives)', () => {
    const baseBoard = () => {
      const b = emptyBoard();
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[0][4] = piece(PT.KING, COLORS.BLACK);
      return b;
    };
    const gA = mkGame(baseBoard, COLORS.WHITE);
    const gB = mkGame(baseBoard, COLORS.WHITE);
    assert.equal(positionHash(gA, COLORS.WHITE), positionHash(gB, COLORS.WHITE));
  });
});

// ---------------------------------------------------------------------
// 8. AI move legality (Fix 4 preservation check)
// ---------------------------------------------------------------------
describe('AI move legality', () => {
  test('every move the AI proposes, at every level, is accepted by game.move()', () => {
    function opening() { return new Game(); }
    for (let lvl = 1; lvl <= 10; lvl++) {
      const g = opening();
      const { move } = findBestMove(g, lvl, new Map());
      assert.ok(move, `level ${lvl} must propose a move in the opening position`);
      const r = g.move(move.from, move.to);
      assert.equal(r.ok, true, `level ${lvl} proposed an illegal move: ${sq(move.from.x, move.from.y)}-${sq(move.to.x, move.to.y)}`);
    }
  });

  test('AI never proposes a move while its own king is left in check', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[6][0] = piece(PT.PAWN, COLORS.WHITE);
      b[0][4] = piece(PT.ROOK, COLORS.BLACK);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE);
    for (let lvl = 1; lvl <= 10; lvl++) {
      const g2 = new Game();
      g2.board = g.board.map(row => row.map(p => (p ? { ...p } : null)));
      g2.turn = g.turn; g2.history = []; g2.winner = null;
      const { move } = findBestMove(g2, lvl, new Map());
      assert.ok(move, `level ${lvl} must find a legal response while in check`);
      assert.ok(
        !(move.from.x === 6 && move.from.y === 0),
        `level ${lvl} must not move the irrelevant a2 pawn while in check`
      );
    }
  });
});

// ---------------------------------------------------------------------
// 9. AI Level 1-10 strength scaling (Fix 1 regression)
// ---------------------------------------------------------------------
describe('AI level scaling', () => {
  test('search resources (nodes) are non-decreasing from level 5 to level 10 on opening/middlegame/endgame positions', () => {
    function middlegame() {
      const g = new Game();
      const b = emptyBoard();
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[6][3] = piece(PT.MET, COLORS.WHITE);
      b[5][2] = piece(PT.ROOK, COLORS.WHITE);
      b[5][5] = piece(PT.ROOK, COLORS.WHITE);
      b[4][1] = piece(PT.KNIGHT, COLORS.WHITE);
      b[4][6] = piece(PT.KNIGHT, COLORS.WHITE);
      b[3][3] = piece(PT.KHON, COLORS.WHITE);
      b[3][4] = piece(PT.KHON, COLORS.WHITE);
      b[5][0] = piece(PT.PAWN, COLORS.WHITE);
      b[5][7] = piece(PT.PAWN, COLORS.WHITE);
      b[4][2] = piece(PT.PAWN, COLORS.WHITE);
      b[4][5] = piece(PT.PAWN, COLORS.WHITE);
      b[0][3] = piece(PT.KING, COLORS.BLACK);
      b[1][4] = piece(PT.MET, COLORS.BLACK);
      b[2][2] = piece(PT.ROOK, COLORS.BLACK);
      b[2][5] = piece(PT.ROOK, COLORS.BLACK);
      b[3][1] = piece(PT.KNIGHT, COLORS.BLACK);
      b[3][6] = piece(PT.KNIGHT, COLORS.BLACK);
      b[2][0] = piece(PT.PAWN, COLORS.BLACK);
      b[2][7] = piece(PT.PAWN, COLORS.BLACK);
      b[3][2] = piece(PT.PAWN, COLORS.BLACK);
      b[3][5] = piece(PT.PAWN, COLORS.BLACK);
      g.board = b; g.turn = COLORS.WHITE; g.history = []; g.winner = null;
      return g;
    }
    function endgame() {
      const g = new Game();
      const b = emptyBoard();
      b[2][3] = piece(PT.KING, COLORS.BLACK);
      b[3][3] = piece(PT.MET, COLORS.BLACK);
      b[4][3] = piece(PT.MET, COLORS.WHITE);
      b[5][3] = piece(PT.KING, COLORS.WHITE);
      g.board = b; g.turn = COLORS.WHITE; g.history = []; g.winner = null;
      return g;
    }
    for (const factory of [() => new Game(), middlegame, endgame]) {
      let prevNodes = 0;
      for (let lvl = 5; lvl <= 10; lvl++) {
        const { stats } = findBestMove(factory(), lvl, new Map());
        assert.ok(stats.nodes >= prevNodes,
          `level ${lvl} searched fewer nodes (${stats.nodes}) than the level below it (${prevNodes})`);
        prevNodes = stats.nodes;
      }
    }
  });

  test('mate-in-1 is found at every level', () => {
    for (let lvl = 1; lvl <= 10; lvl++) {
      const g = mkGame(b => {
        b[0][0] = piece(PT.KING, COLORS.BLACK);
        b[1][0] = piece(PT.PAWN, COLORS.BLACK);
        b[1][1] = piece(PT.PAWN, COLORS.BLACK);
        b[7][7] = piece(PT.KING, COLORS.WHITE);
        b[1][7] = piece(PT.ROOK, COLORS.WHITE);
      }, COLORS.WHITE);
      const { move } = findBestMove(g, lvl, new Map());
      assert.ok(move);
      const r = g.move(move.from, move.to);
      assert.equal(r.ok, true);
      assert.equal(r.status.state, 'checkmate', `level ${lvl} chose ${sq(move.from.x, move.from.y)}-${sq(move.to.x, move.to.y)} which is not mate`);
    }
  });
});
