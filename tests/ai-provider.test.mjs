// tests/ai-provider.test.mjs — Phase 8C regression suite for
// js/ai-provider.js: the Fairy-Stockfish (primary) / local-JS-AI
// (fallback) abstraction behind js/ui.js's and js/ai-vs-ai.js's AIPICK.
//
// Two independent things are tested here, deliberately kept separate:
//   1. tryFairyStockfish() — the real HTTP path, against a local mock
//      server (never the real backend — see setApiBase() below).
//   2. pickMoveCore() — the fallback DECISION logic, driven with fake
//      fairy/fallback functions (no real network, no real Worker) so it
//      can run under Node's test runner without a browser. ES module
//      named exports aren't reassignable from outside their own module,
//      so pickMoveCore takes its two dependencies as parameters instead
//      of the test trying to monkey-patch js/ai.js's exports.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/api.js's getApiBase()/setApiBase() are backed by `localStorage`,
// which isn't a Node global. Without this, setApiBase() below silently
// no-ops (caught by api.js's own try/catch) and every request in this
// file would actually go to the real, hardcoded production backend
// URL — not this test's local mock server. A tiny in-memory polyfill,
// installed before importing api.js, is enough; it is test-only and
// touches no production file.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
}

import { Game, PT, COLORS, piece } from '../js/game.js';
import { setApiBase } from '../js/api.js';
import { tryFairyStockfish, pickMoveCore, LEVEL_MOVETIME_MS } from '../js/ai-provider.js';

function freshGame() {
  return new Game(); // real reset() -> real initialPosition()
}

// ---------------------------------------------------------------------
// Local mock server standing in for ouk-ai-backend's /api/ai/move.
// Never touches the real deployed backend (which, as of Phase 8C, still
// runs the pre-Phase-8B makruk-only contract) — see js/api.js's
// setApiBase(), pointed here before each test that needs it.
// ---------------------------------------------------------------------
let mockResponder = () => ({ status: 200, body: { from: { x: 4, y: 6 }, to: { x: 4, y: 5 } } });
let lastRequestBody = null;

const server = http.createServer((req, res) => {
  let chunks = '';
  req.on('data', (c) => { chunks += c; });
  req.on('end', () => {
    try { lastRequestBody = JSON.parse(chunks || '{}'); } catch { lastRequestBody = null; }
    const { status, body, delayMs } = mockResponder();
    const send = () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (delayMs) setTimeout(send, delayMs); else send();
  });
});

await new Promise((resolve) => server.listen(0, resolve));
const mockPort = server.address().port;
setApiBase(`http://127.0.0.1:${mockPort}`);

after(() => { server.close(); });

// ===========================================================================
// tryFairyStockfish() — real HTTP path against the local mock server
// ===========================================================================
describe('tryFairyStockfish() — HTTP layer', () => {
  test('P1/P2: success — move is extracted correctly from the response', async () => {
    mockResponder = () => ({ status: 200, body: { uci: 'e2e3', from: { x: 4, y: 6 }, to: { x: 4, y: 5 }, board: [], turn: 'b', counting: {} } });
    const g = freshGame();
    const r = await tryFairyStockfish(g, { level: 5 }, undefined);
    assert.equal(r.aborted, false);
    assert.equal(r.error, null);
    assert.deepEqual(r.move, { from: { x: 4, y: 6 }, to: { x: 4, y: 5 } });
  });

  test('sends only board/turn/counting/movetime — never UI/settings state, never a server-returned field back', async () => {
    mockResponder = () => ({ status: 200, body: { from: { x: 4, y: 6 }, to: { x: 4, y: 5 } } });
    const g = freshGame();
    g.counting = { active: false, type: null, countingSide: null, strongerSide: null, limit: 0, current: 0, remaining: 0, result: null, justStarted: false, justIncremented: false };
    await tryFairyStockfish(g, { level: 3, aiColor: 'w', timeMs: 120 /* must NOT leak into the payload */ }, undefined);
    assert.deepEqual(Object.keys(lastRequestBody).sort(), ['board', 'counting', 'movetime', 'turn']);
    assert.equal(lastRequestBody.turn, g.turn);
    assert.equal(lastRequestBody.movetime, LEVEL_MOVETIME_MS[3]);
    assert.deepEqual(lastRequestBody.counting, g.counting);
  });

  test('P5: malformed response (missing from/to) is reported as an error, not thrown', async () => {
    mockResponder = () => ({ status: 200, body: { uci: 'garbage' } });
    const g = freshGame();
    const r = await tryFairyStockfish(g, { level: 5 }, undefined);
    assert.equal(r.aborted, false);
    assert.equal(r.move, null);
    assert.ok(r.error);
  });

  test('out-of-board coordinates are rejected, never handed to the caller', async () => {
    mockResponder = () => ({ status: 200, body: { from: { x: -1, y: 3 }, to: { x: 4, y: 4 } } });
    const g = freshGame();
    const r = await tryFairyStockfish(g, { level: 5 }, undefined);
    assert.equal(r.move, null);
    assert.ok(r.error);
  });

  test('P6: HTTP 503 (engine timeout) is reported as an error, not thrown', async () => {
    mockResponder = () => ({ status: 503, body: { error: 'engine timeout' } });
    const g = freshGame();
    const r = await tryFairyStockfish(g, { level: 5 }, undefined);
    assert.equal(r.aborted, false);
    assert.equal(r.move, null);
    assert.ok(r.error);
  });

  test('HTTP 422 (no legal move) is reported as an error, not thrown', async () => {
    mockResponder = () => ({ status: 422, body: { error: 'no legal move (bestmove (none))' } });
    const g = freshGame();
    const r = await tryFairyStockfish(g, { level: 5 }, undefined);
    assert.equal(r.move, null);
    assert.ok(r.error);
  });

  test('HTTP 502 (engine move failed legality validation server-side) is reported as an error, not thrown', async () => {
    mockResponder = () => ({ status: 502, body: { error: 'engine move failed project legality validation' } });
    const g = freshGame();
    const r = await tryFairyStockfish(g, { level: 5 }, undefined);
    assert.equal(r.move, null);
    assert.ok(r.error);
  });

  test('P7: network failure (unreachable server) is reported as an error, not thrown', async () => {
    setApiBase('http://127.0.0.1:1'); // reserved/unroutable port -> connection failure
    try {
      const g = freshGame();
      const r = await tryFairyStockfish(g, { level: 5 }, undefined);
      assert.equal(r.aborted, false);
      assert.equal(r.move, null);
      assert.ok(r.error);
    } finally {
      setApiBase(`http://127.0.0.1:${mockPort}`);
    }
  });

  test('P8/P9/G: an aborted request resolves { aborted: true }, distinct from a real failure', async () => {
    mockResponder = () => ({ status: 200, body: { from: { x: 4, y: 6 }, to: { x: 4, y: 5 } }, delayMs: 200 });
    const g = freshGame();
    const controller = new AbortController();
    const p = tryFairyStockfish(g, { level: 5 }, controller.signal);
    controller.abort();
    const r = await p;
    assert.equal(r.aborted, true);
    assert.equal(r.move, null);
    assert.equal(r.error, null);
  });
});

// ===========================================================================
// pickMoveCore() — fallback decision logic, fully fake-driven
// ===========================================================================
function mkKingsAndRook() {
  const g = freshGame();
  g.board = Array.from({ length: 8 }, () => Array(8).fill(null));
  g.board[7][3] = piece(PT.KING, COLORS.WHITE);   // d1
  g.board[7][0] = piece(PT.ROOK, COLORS.WHITE);   // a1
  g.board[0][4] = piece(PT.KING, COLORS.BLACK);   // e8
  g.turn = COLORS.WHITE;
  g.history = []; g.winner = null;
  return g;
}

describe('pickMoveCore() — fallback decision logic', () => {
  test('legal Fairy-Stockfish move is returned as-is, fallback never called', async () => {
    const g = mkKingsAndRook();
    let fallbackCalled = false;
    const fairyFn = async () => ({ aborted: false, move: { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } }, error: null }); // Ra1-a2, legal
    const fallbackFn = async () => { fallbackCalled = true; return { from: { x: 3, y: 7 }, to: { x: 3, y: 6 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.deepEqual(result, { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } });
    assert.equal(fallbackCalled, false);
  });

  test('P3/P4: illegal Fairy-Stockfish move (per the CURRENT frontend Game) triggers exactly one JS-AI fallback call', async () => {
    const g = mkKingsAndRook();
    let fallbackCalls = 0;
    const fairyFn = async () => ({ aborted: false, move: { from: { x: 3, y: 7 }, to: { x: 3, y: 0 } }, error: null }); // King d1-d8: not legal
    const fallbackFn = async () => { fallbackCalls++; return { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(result, { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } });
  });

  test('P5: fairyFn reporting an error (malformed response) triggers exactly one fallback call', async () => {
    const g = mkKingsAndRook();
    let fallbackCalls = 0;
    const fairyFn = async () => ({ aborted: false, move: null, error: new Error('malformed AI response') });
    const fallbackFn = async () => { fallbackCalls++; return { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(result, { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } });
  });

  test('P6/P7: fairyFn reporting a timeout/network error triggers exactly one fallback call, not a retry against Fairy-Stockfish', async () => {
    const g = mkKingsAndRook();
    let fairyCalls = 0, fallbackCalls = 0;
    const fairyFn = async () => { fairyCalls++; return { aborted: false, move: null, error: new Error('engine timeout') }; };
    const fallbackFn = async () => { fallbackCalls++; return { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } }; };
    await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fairyCalls, 1, 'no retry against Fairy-Stockfish before falling back');
    assert.equal(fallbackCalls, 1, 'exactly one fallback call');
  });

  test('P8/P9/P10/G: an aborted (stale) request resolves null and never calls the fallback', async () => {
    const g = mkKingsAndRook();
    let fallbackCalled = false;
    const fairyFn = async () => ({ aborted: true, move: null, error: null });
    const fallbackFn = async () => { fallbackCalled = true; return { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(result, null);
    assert.equal(fallbackCalled, false, 'a stale/cancelled request must not trigger a wasted fallback search');
  });

  test('P12: exactly one move is ever returned/applied per call, never two', async () => {
    const g = mkKingsAndRook();
    let fairyCalls = 0, fallbackCalls = 0;
    const fairyFn = async () => { fairyCalls++; return { aborted: false, move: { from: { x: 0, y: 7 }, to: { x: 0, y: 6 } }, error: null }; };
    const fallbackFn = async () => { fallbackCalls++; return { from: { x: 3, y: 7 }, to: { x: 3, y: 6 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fairyCalls, 1);
    assert.equal(fallbackCalls, 0);
    assert.ok(result.from && result.to, 'exactly one move object returned');
  });

  test('P13: a move that is legal on an OLD position but the position has since concluded is still checked against the CURRENT game (checkmate -> no legal moves -> fallback)', async () => {
    // Board where White is already checkmated — no legal moves exist for White at all.
    const g = freshGame();
    g.board = Array.from({ length: 8 }, () => Array(8).fill(null));
    g.board[0][0] = piece(PT.ROOK, COLORS.WHITE);   // a8
    g.board[0][7] = piece(PT.KING, COLORS.BLACK);   // h8
    g.board[1][6] = piece(PT.PAWN, COLORS.BLACK);   // g7
    g.board[1][7] = piece(PT.PAWN, COLORS.BLACK);   // h7
    g.board[7][7] = piece(PT.KING, COLORS.WHITE);   // h1
    g.turn = COLORS.BLACK;
    g.history = []; g.winner = null;
    assert.equal(g.status().state, 'checkmate');

    let fallbackCalls = 0;
    // A stale Fairy-Stockfish move computed for a position before checkmate happened.
    const fairyFn = async () => ({ aborted: false, move: { from: { x: 7, y: 1 }, to: { x: 7, y: 2 } }, error: null });
    const fallbackFn = async () => { fallbackCalls++; return null; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fallbackCalls, 1, 'a move illegal on the current (post-checkmate) position must fall through to the fallback path');
    assert.equal(result, null, 'and the fallback itself correctly reports no move for a concluded game');
  });
});

// ===========================================================================
// Phase 8C.2 — Fairy-Stockfish cambodian Met leap "true leaper" regression.
//
// Root cause (confirmed by source-level inspection of Fairy-Stockfish
// 14.0.1 XQ's movegen.cpp, Phase 8C.2): the cambodian variant's Met/Fers
// 2-square first-move leap is generated as an unconditional (true) leap —
// it checks only the destination square, never the intermediate one. This
// is a known, permanent characteristic of that specific engine build, NOT
// a bug in this project's FEN adapter or rules engine. The project's own
// Met rule (js/game.js) correctly requires the intermediate square to be
// empty, so any "eXeY"-shaped Met leap Fairy-Stockfish proposes while that
// square is occupied is illegal per the project and must always be caught
// by pickMoveCore()'s frontend legality re-check and safely replaced by
// the JS AI fallback — never applied, never retried, never silently
// dropped. These tests pin that exact contract permanently.
// ===========================================================================
function mkMetLeapBlocked(blockerColor) {
  const g = freshGame();
  g.board = Array.from({ length: 8 }, () => Array(8).fill(null));
  g.board[7][4] = piece(PT.MET, COLORS.WHITE);        // e1, unmoved
  g.board[6][4] = piece(PT.KNIGHT, blockerColor);     // e2 — blocks the leap regardless of color
  g.board[7][7] = piece(PT.KING, COLORS.WHITE);       // h1
  g.board[0][0] = piece(PT.KING, COLORS.BLACK);       // a8
  g.turn = COLORS.WHITE;
  g.history = []; g.winner = null;
  return g;
}
const FSF_SHAPED_E1E3 = { from: { x: 4, y: 7 }, to: { x: 4, y: 5 } }; // e1->e3

describe('Phase 8C.2: Fairy-Stockfish "true leaper" Met-leap disagreement is always caught', () => {
  test('1. friendly piece blocking e2: FSF-shaped e1e3 is rejected by project legality, fallback called exactly once, illegal move never returned', async () => {
    const g = mkMetLeapBlocked(COLORS.WHITE);
    assert.equal(
      g.legalMoves(4, 7).some(m => m.x === 4 && m.y === 5), false,
      'sanity check: the project itself must consider this leap illegal while e2 is occupied'
    );
    let fallbackCalls = 0;
    const fairyFn = async () => ({ aborted: false, move: FSF_SHAPED_E1E3, error: null });
    const fallbackFn = async () => { fallbackCalls++; return { from: { x: 7, y: 7 }, to: { x: 6, y: 7 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fallbackCalls, 1);
    assert.notDeepEqual(result, FSF_SHAPED_E1E3, 'the illegal leap must never be the returned/applied move');
  });

  test('2. enemy piece blocking e2: same rejection/fallback behavior', async () => {
    const g = mkMetLeapBlocked(COLORS.BLACK);
    assert.equal(g.legalMoves(4, 7).some(m => m.x === 4 && m.y === 5), false);
    let fallbackCalls = 0;
    const fairyFn = async () => ({ aborted: false, move: FSF_SHAPED_E1E3, error: null });
    const fallbackFn = async () => { fallbackCalls++; return { from: { x: 7, y: 7 }, to: { x: 6, y: 7 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fallbackCalls, 1);
    assert.notDeepEqual(result, FSF_SHAPED_E1E3);
  });

  test('3. no retry against Fairy-Stockfish for this illegal shape: fairyFn called exactly once, fallback called exactly once', async () => {
    const g = mkMetLeapBlocked(COLORS.WHITE);
    let fairyCalls = 0, fallbackCalls = 0;
    const fairyFn = async () => { fairyCalls++; return { aborted: false, move: FSF_SHAPED_E1E3, error: null }; };
    const fallbackFn = async () => { fallbackCalls++; return { from: { x: 7, y: 7 }, to: { x: 6, y: 7 } }; };
    await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(fairyCalls, 1, 'no retry against Fairy-Stockfish before falling back');
    assert.equal(fallbackCalls, 1, 'exactly one fallback call');
  });

  test('4. aborted/stale request for this exact illegal Met leap: resolves null, fallback is NOT called', async () => {
    const g = mkMetLeapBlocked(COLORS.WHITE);
    let fallbackCalled = false;
    // Aborted before pickMoveCore ever sees a move — mirrors resetAI()
    // racing a Restart/Undo against this exact in-flight illegal-shaped request.
    const fairyFn = async () => ({ aborted: true, move: null, error: null });
    const fallbackFn = async () => { fallbackCalled = true; return { from: { x: 7, y: 7 }, to: { x: 6, y: 7 } }; };
    const result = await pickMoveCore(g, { level: 5 }, fairyFn, fallbackFn);
    assert.equal(result, null);
    assert.equal(fallbackCalled, false, 'a stale/cancelled request must not trigger a wasted fallback search');
  });

  // 5. Live-engine regression: pins the exact known discrepancy against
  // the real installed binary (not a fake fairyFn). Skips gracefully if
  // the binary isn't present in this checkout (e.g. games repo checked
  // out without ouk-ai-backend alongside it) rather than failing hard —
  // this is a cross-repo sanity pin, not a required correctness gate
  // (that gate is tests 1-4 above, which need no binary at all). If this
  // test ever starts FAILING TO REPRODUCE (i.e. FSF stops offering
  // e1e3), that means upstream Fairy-Stockfish changed this behavior —
  // a good signal, not a regression, and worth revisiting Phase 8C.2's
  // classification at that point.
  test('5. live-engine pin: Fairy-Stockfish cambodian still offers e1e3 with e2 occupied (documents the known discrepancy)', async (t) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const enginePath = path.join(__dirname, '..', '..', 'ouk-ai-backend', 'bin', 'fairy-stockfish');
    if (!fs.existsSync(enginePath)) {
      t.skip('ouk-ai-backend/bin/fairy-stockfish not found in this checkout — skipping live-engine pin');
      return;
    }

    const proc = spawn(enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const lines = [];
    proc.stdout.on('data', (d) => { buf += d.toString(); });
    const send = (cmd) => proc.stdin.write(cmd + '\n');

    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (buf.includes('uciok')) { clearInterval(check); resolve(); }
      }, 20);
      send('uci');
    });
    send('setoption name UCI_Variant value cambodian');
    send('ucinewgame');
    buf = '';
    send('position fen 7k/8/8/8/8/8/4N3/4M2K w E - 0 1'); // Met e1, Knight e2, matches mkMetLeapBlocked
    send('go perft 1');
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (buf.includes('Nodes searched')) { clearInterval(check); resolve(); }
      }, 20);
    });
    proc.kill();

    assert.match(buf, /^e1e3: 1$/m, 'documents the known engine behavior this suite protects against — see Phase 8C.2');
  });
});

// ===========================================================================
// Generation-guard fix model (Step 1) — reproduces the exact try/catch/
// finally shape js/ui.js's thinkAndPlay() uses, to prove the FIXED
// pattern (guard finally on myGen === aiGen) actually prevents a stale
// call from clearing a newer generation's lock, and that the BUGGY
// (unguarded) pattern would not. thinkAndPlay() itself lives inside
// initUI()'s closure and isn't independently importable — behavioral
// confirmation of the real function is in the Phase 8C browser smoke
// tests; this proves the logic pattern in isolation.
// ===========================================================================
describe('Step 1: stale-generation AILock fix (model of thinkAndPlay()\'s pattern)', () => {
  async function runPattern({ guarded }) {
    let aiGen = 0;
    let AILock = false;
    const lockHistory = [];
    function setBoardBusy(on) { AILock = !!on; lockHistory.push(on); }

    async function thinkAndPlayLike(resolveAfterMs, resolveWith) {
      if (AILock) return;
      const myGen = aiGen;
      setBoardBusy(true);
      try {
        const move = await new Promise((resolve) => setTimeout(() => resolve(resolveWith), resolveAfterMs));
        if (myGen !== aiGen) return;
        void move;
      } finally {
        if (guarded) {
          if (myGen === aiGen) setBoardBusy(false);
        } else {
          setBoardBusy(false); // the pre-fix, buggy behavior
        }
      }
    }

    // Old call starts (slow — simulates network latency), then Restart
    // fires before it resolves: aiGen++ and a NEW call starts immediately.
    // Timings are chosen so the OLD call resolves strictly BETWEEN the new
    // call's start and the new call's own resolution (t=5 start-new,
    // t=40 old-resolves, t=65 new-resolves) — that middle window (checked
    // at t=50) is exactly where the bug lives: has the stale call's
    // finally already fired, while the new search is still genuinely in
    // flight?
    const oldCall = thinkAndPlayLike(40, { from: 'stale' });
    await new Promise((r) => setTimeout(r, 5)); // let the old call's setBoardBusy(true) land
    aiGen++;                          // Restart/Undo
    setBoardBusy(false);              // Restart/Undo's own unlock
    const newCall = thinkAndPlayLike(60, { from: 'fresh' }); // starts at t=5, resolves at t=65

    await new Promise((r) => setTimeout(r, 45)); // now at t=50: old call (resolves t=40) is done; new call (resolves t=65) is not
    const lockedWhileNewSearchInFlight = AILock;

    await Promise.all([oldCall, newCall]);
    return { lockedWhileNewSearchInFlight, finalLock: AILock };
  }

  test('FIXED pattern: a stale response cannot clear the newer generation\'s lock', async () => {
    const { lockedWhileNewSearchInFlight, finalLock } = await runPattern({ guarded: true });
    assert.equal(lockedWhileNewSearchInFlight, true, 'board must still read locked while the NEW search is genuinely in flight');
    assert.equal(finalLock, false, 'unlocked once the new (current) call itself finishes');
  });

  test('reproduces the pre-fix bug: an UNGUARDED finally incorrectly unlocks mid-new-search', async () => {
    const { lockedWhileNewSearchInFlight } = await runPattern({ guarded: false });
    assert.equal(lockedWhileNewSearchInFlight, false, 'demonstrates the bug this phase fixed: the stale call\'s finally clears the lock while the new search is still running');
  });
});
