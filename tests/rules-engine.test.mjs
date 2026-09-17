// tests/rules-engine.test.mjs — permanent regression suite for the Ouk
// Chaktrang rules engine (js/game.js) and AI search (js/ai-engine.js).
//
// Zero dependencies: uses Node's built-in test runner and assert module
// directly against the real ES modules the app ships (no reimplementation
// of any rule). Run with:
//   node --test tests/
//
// Every constructed position sets `captureOccurred` explicitly rather than
// leaving it at the Game default, so tests that aren't specifically about
// the King/Met first-move leap don't accidentally get extra leap-based
// moves or attack squares from freshly-placed (`moved: false`) kings/mets.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PT, COLORS, piece } from '../js/game.js';
import { findBestMove, positionHash } from '../js/ai-engine.js';

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

function mkGame(setup, turn, { captureOccurred = true } = {}) {
  const g = new Game();
  const b = emptyBoard();
  setup(b);
  g.board = b;
  g.turn = turn;
  g.history = [];
  g.winner = null;
  g.captureOccurred = captureOccurred;
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
      b[2][1] = piece(PT.KING, COLORS.WHITE);   // b6 - covers a7,b7
      b[1][2] = piece(PT.MET, COLORS.WHITE);    // c7 - covers b8
    }, COLORS.BLACK);
    assert.equal(g.inCheck(COLORS.BLACK), false);
    assert.deepEqual(g.legalMoves(0, 0), []);
    assert.deepEqual(g.status(), { state: 'stalemate', inCheck: false, toMove: COLORS.BLACK });
  });

  test('checkmate takes priority over a Counting Draw reaching its limit on the same move', () => {
    const g = mkGame(b => {
      b[0][0] = piece(PT.KING, COLORS.BLACK);   // a8
      b[2][1] = piece(PT.KING, COLORS.WHITE);   // b6 - covers a7,b7
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
  test('King first-move leap is available when unmoved and no capture has occurred', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE, { captureOccurred: false });
    const moves = g.legalMoves(4, 7);
    assert.ok(has(moves, 5, 5), 'king should be able to leap to f3 (knight-jump)');
  });

  test('King leap is unavailable once captureOccurred is true', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE, { captureOccurred: true });
    assert.ok(!has(g.legalMoves(4, 7), 5, 5));
  });

  test('King leap is unavailable once this king has moved', () => {
    const g = mkGame(b => {
      const k = piece(PT.KING, COLORS.WHITE);
      k.moved = true;
      b[7][4] = k;
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE, { captureOccurred: false });
    assert.ok(!has(g.legalMoves(4, 7), 5, 5));
  });

  test('Met first-move 2-square advance is available when unmoved and no capture has occurred', () => {
    const g = mkGame(b => {
      b[6][4] = piece(PT.MET, COLORS.WHITE);   // e2
      b[7][0] = piece(PT.KING, COLORS.WHITE);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE, { captureOccurred: false });
    assert.ok(has(g.legalMoves(4, 6), 4, 4), 'met should reach e4 via the 2-square advance');
  });

  test('Met 2-square advance is unavailable once captureOccurred is true', () => {
    const g = mkGame(b => {
      b[6][4] = piece(PT.MET, COLORS.WHITE);
      b[7][0] = piece(PT.KING, COLORS.WHITE);
      b[0][0] = piece(PT.KING, COLORS.BLACK);
    }, COLORS.WHITE, { captureOccurred: true });
    assert.ok(!has(g.legalMoves(4, 6), 4, 4));
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
    }, COLORS.WHITE, { captureOccurred: false });
    const r = g.move({ x: 4, y: 3 }, { x: 4, y: 2 });
    assert.equal(r.ok, true);
    const now = g.at(4, 2);
    assert.equal(now.moved, true, 'a piece is always flagged moved by _do on arrival');
    assert.ok(!has(g.legalMoves(4, 2), 4, 0), 'promoted met must not have the 2-square advance available');
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
    }, COLORS.WHITE, { captureOccurred: true });
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
    }, COLORS.WHITE, { captureOccurred: false });
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

  test('Piece Count only advances on the stronger side\'s own completed moves', () => {
    const g = mkGame(b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);
      b[7][3] = piece(PT.ROOK, COLORS.WHITE);
      b[0][4] = piece(PT.KING, COLORS.BLACK);
      b[3][3] = piece(PT.PAWN, COLORS.BLACK);
    }, COLORS.WHITE, { captureOccurred: false });
    g.move({ x: 3, y: 7 }, { x: 3, y: 3 }); // White captures -> phase starts, current = total pieces
    const afterStart = g.counting.current;

    // Black moves its king one step -> must NOT increment (black is the counting side, not stronger).
    const bMoves = g.legalMoves(4, 0);
    assert.ok(bMoves.length > 0);
    g.move({ x: 4, y: 0 }, bMoves[0]);
    assert.equal(g.counting.current, afterStart);
    assert.equal(g.counting.justIncremented, false);

    // White moves its king one step -> must increment (white is the stronger side).
    const wMoves = g.legalMoves(4, 7);
    assert.ok(wMoves.length > 0);
    g.move({ x: 4, y: 7 }, wMoves[0]);
    assert.equal(g.counting.current, afterStart + 1);
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
// 7. Transposition-table position hash correctness
// ---------------------------------------------------------------------
describe('positionHash correctness (Fix 2 regression)', () => {
  test('identical board layouts with different captureOccurred must not collide', () => {
    const setup = b => {
      b[7][4] = piece(PT.KING, COLORS.WHITE);  // e1, unmoved
      b[0][4] = piece(PT.KING, COLORS.BLACK);  // e8
      b[0][0] = piece(PT.ROOK, COLORS.BLACK);
    };
    const gA = mkGame(setup, COLORS.WHITE, { captureOccurred: false });
    const gB = mkGame(setup, COLORS.WHITE, { captureOccurred: true });

    const movesA = gA.legalMoves(4, 7).length;
    const movesB = gB.legalMoves(4, 7).length;
    assert.notEqual(movesA, movesB, 'these two positions must actually have different legal move counts');

    const hashA = positionHash(gA, COLORS.WHITE);
    const hashB = positionHash(gB, COLORS.WHITE);
    assert.notEqual(hashA, hashB, 'positionHash must distinguish differing captureOccurred state');
  });

  test('identical board layouts with different King.moved must not collide', () => {
    const setup = (moved) => (b) => {
      const k = piece(PT.KING, COLORS.WHITE);
      k.moved = moved;
      b[7][4] = k;
      b[0][4] = piece(PT.KING, COLORS.BLACK);
      b[0][0] = piece(PT.ROOK, COLORS.BLACK);
    };
    const gA = mkGame(setup(false), COLORS.WHITE, { captureOccurred: false });
    const gC = mkGame(setup(true), COLORS.WHITE, { captureOccurred: false });

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
    const gA = mkGame(baseBoard, COLORS.WHITE, { captureOccurred: true });
    const gB = mkGame(baseBoard, COLORS.WHITE, { captureOccurred: true });
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
      g2.turn = g.turn; g2.history = []; g2.winner = null; g2.captureOccurred = g.captureOccurred;
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
