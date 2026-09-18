// js/ai-provider.js — Phase 8C: AI provider abstraction.
//
// Same public contract js/ai.js already had (chooseAIMove/pickAIMove
// resolve to {from:{x,y}, to:{x,y}} or null; resetAI()/getLastStats() are
// also passed straight through) — every existing caller (js/ui.js's
// thinkAndPlay(), js/ai-vs-ai.js's dev loop) can import this module
// instead of js/ai.js with no other change.
//
// Fairy-Stockfish (ouk-ai-backend's /api/ai/move, Phase 8B) is the
// PRIMARY provider; the existing local JS AI (js/ai.js, unmodified) is
// the FALLBACK, used whenever Fairy-Stockfish is unreachable, errors,
// times out, or proposes a move this frontend's own Game considers
// illegal. Fairy-Stockfish is never trusted as a rules authority: its
// move is re-validated against the CALLER's own `game.legalMoves()`
// before ever being returned — the caller then applies it through its
// own `game.move()`, exactly as it already does for the local AI. This
// module never mutates `game` itself.
//
// Stale-response safety: js/ui.js's own `aiGen` generation check (see
// thinkAndPlay()) is what actually prevents a late response from ever
// being applied to a newer position — that protection is provider-
// agnostic and already covers this module's responses too. The
// AbortController here is a second, defense-in-depth layer on top of
// that: it stops a request that's no longer wanted from continuing to
// consume network/engine resources, and — critically — stops resetAI()
// from triggering a wasted local-AI fallback search for a position that
// is about to be discarded anyway (see resetAI() below).
//
// Phase 8C.4: an optional `opts.onStatusChange` callback reports which
// attempt is currently running ('fairy' | 'fallback' | 'stale') purely as
// UI metadata — it never affects move selection, the fallback decision,
// or the Promise<{from,to}|null> contract above. The caller (js/ui.js)
// owns turning that into an on-screen indicator, including its own
// stale-generation guard and the "now idle" transition once a call
// completes; this module only ever reports what IT is doing right now.

import { requestAIMove } from './api.js';

// js/ai.js (the fallback) sets `window.AIDebug = ...` at its own module
// top-level, which throws immediately if imported somewhere `window`
// isn't a global — including under Node's test runner (see
// tests/ai-provider.test.mjs, which exercises pickMoveCore()/
// tryFairyStockfish() with fakes and never needs the real fallback to
// load at all). A lazy, cached dynamic import keeps this module safely
// importable in that environment while behaving identically in the
// browser, where the fallback is actually used.
//
// `jsAiModule` (not just the promise) is kept as a separate, plain
// variable so resetAI()/getLastStats() below can stay fully SYNCHRONOUS
// once loaded — matching js/ai.js's own contract exactly, which
// js/ai-vs-ai.js's dev tool depends on (`const stats = getLastStats();`,
// used immediately, never awaited).
let jsAiModule = null;
let jsAiLoading = null;
function loadJsAI() {
  if (jsAiModule) return Promise.resolve(jsAiModule);
  if (!jsAiLoading) jsAiLoading = import('./ai.js').then((m) => { jsAiModule = m; return m; });
  return jsAiLoading;
}

// Phase 8C: conservative, temporary, intentionally NOT tuned or claimed
// equivalent in strength to the local JS AI at the same level number —
// see the Phase 8C report. A single table (not scattered constants) so
// it's easy to retune later without hunting through call sites. Kept
// well under ouk-ai-backend's enginePool.js MOVE_GUARD_EXTRA=1500ms hard
// ceiling margin; the request itself also carries fixed queue+network
// overhead on top of `movetime` (Phase 8C.1's Performance section).
export const LEVEL_MOVETIME_MS = {
  1: 200,  2: 300,  3: 400,  4: 500,  5: 700,
  6: 900,  7: 1200, 8: 1500, 9: 1800, 10: 2200,
};

function movetimeForLevel(level) {
  return LEVEL_MOVETIME_MS[level] || LEVEL_MOVETIME_MS[5];
}

function dbg(...args) {
  // Guards `window` itself, not just the property access — this module
  // also runs under Node's test runner (see tests/ai-provider.test.mjs),
  // where `window` isn't a global at all.
  if (typeof window !== 'undefined') window.AIDebug?.log('[ai-provider]', ...args);
}

function isOnBoardCoord(n) {
  return Number.isInteger(n) && n >= 0 && n < 8;
}

// game.js's at()/legalMoves() index straight into the board array
// (this.board[y][x]) with no bounds check of their own — an out-of-range
// coordinate here would throw inside game.legalMoves() rather than fail
// safely, so this must reject anything malformed BEFORE it ever reaches
// that call (see Step 5: never apply an engine move directly).
function extractMove(data) {
  if (!data || !data.from || !data.to) return null;
  const { from, to } = data;
  if (!isOnBoardCoord(from.x) || !isOnBoardCoord(from.y)) return null;
  if (!isOnBoardCoord(to.x) || !isOnBoardCoord(to.y)) return null;
  return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
}

// Talks to ouk-ai-backend's POST /api/ai/move (Phase 8B). Sends only the
// project's own authoritative state — never the AI-level/UI settings, and
// never anything the server previously returned (see module comment).
// Resolves to { aborted, move, error } rather than throwing, so the
// caller never needs a try/catch just to distinguish "cancelled" from
// "failed" from "succeeded". Exported (not just used internally) so
// tests/ai-provider.test.mjs can exercise the real HTTP path against a
// local mock server directly, independent of pickMoveCore's fallback
// decision logic (which has its own, fake-function-driven tests).
export async function tryFairyStockfish(game, opts, signal) {
  const movetime = movetimeForLevel(opts.level);
  const start = Date.now();
  let data;
  try {
    data = await requestAIMove(
      { board: game.board, turn: game.turn, counting: game.counting, movetime },
      { signal }
    );
  } catch (err) {
    if (err?.name === 'AbortError') {
      dbg('request aborted (stale generation)');
      return { aborted: true, move: null, error: null };
    }
    dbg('request failed:', err?.message || String(err), `(${Date.now() - start}ms)`);
    return { aborted: false, move: null, error: err };
  }

  const move = extractMove(data);
  const elapsed = Date.now() - start;
  if (!move) {
    dbg('malformed response, falling back', JSON.stringify(data), `(${elapsed}ms)`);
    return { aborted: false, move: null, error: new Error('malformed AI response') };
  }
  dbg(`response in ${elapsed}ms:`, JSON.stringify(move));
  return { aborted: false, move, error: null };
}

// Core decision logic, independent of the real network/local-AI calls —
// takes them as parameters so it can be exercised directly in tests
// without a live backend, a real Worker, or fragile module-export
// monkey-patching (ES module named exports aren't reassignable). The
// exported chooseAIMove() below is a thin wrapper that supplies the real
// implementations.
export async function pickMoveCore(game, opts, fairyFn, fallbackFn) {
  const { aborted, move, error } = await fairyFn(game, opts);

  // A deliberate cancellation (resetAI() raced us) means this exact
  // request is no longer wanted — mirror js/ai.js's own resetAI()
  // convention of resolving with null, and skip the fallback entirely so
  // Restart/Undo never triggers a wasted local-AI search for a position
  // that's already being discarded (js/ui.js's aiGen check would just
  // discard that result anyway).
  if (aborted) {
    // Phase 8C.4: UI-facing status only — never gates move-selection
    // behavior. The caller (js/ui.js) is what actually decides whether
    // this fires anywhere near the DOM, via its own aiGen-guarded
    // setProviderStatus(); this module has no opinion on that.
    opts.onStatusChange?.('stale');
    return null;
  }

  if (move) {
    // Never trust Fairy-Stockfish as a rules authority (see module
    // comment) — re-validate against the CALLER's own current Game
    // before this move is allowed to go anywhere near game.move().
    const legal = game.legalMoves(move.from.x, move.from.y);
    const isLegal = legal.some(m => m.x === move.to.x && m.y === move.to.y);
    if (isLegal) return move;
    dbg('Fairy-Stockfish move failed frontend legality re-check, falling back to JS AI', JSON.stringify(move));
  } else if (error) {
    dbg('Fairy-Stockfish unavailable, falling back to JS AI:', error?.message || String(error));
  }

  // Fallback: existing local JS AI, entirely unmodified, exactly one call
  // — never a retry loop against Fairy-Stockfish first.
  opts.onStatusChange?.('fallback');
  return fallbackFn(game, opts);
}

let currentAbort = null;

export async function chooseAIMove(game, opts = {}) {
  currentAbort = new AbortController();
  const signal = currentAbort.signal;
  // Fires before the request is even sent, so a UI listener can show a
  // "thinking" state immediately rather than waiting for a response —
  // see Phase 8C.4. Purely informational: nothing below reads this back.
  opts.onStatusChange?.('fairy');
  return pickMoveCore(
    game,
    opts,
    (g, o) => tryFairyStockfish(g, o, signal),
    async (g, o) => (await loadJsAI()).chooseAIMove(g, o),
  );
}

export const pickAIMove = chooseAIMove;

// Safe to call any time (Restart/Undo/New Game), matching js/ai.js's own
// resetAI() contract exactly (synchronous, no Promise returned): abort
// whatever this provider currently has in flight, then also tear down
// the local JS AI's own worker/pending state in case a fallback search
// is what's actually running. A no-op if the JS AI was never actually
// loaded (Fairy-Stockfish never failed, so no fallback/worker ever
// started) — the rare case of resetAI() landing while the dynamic import
// is still in flight is handled with a fire-and-forget .then(), since a
// worker that hasn't finished loading yet has nothing in-flight to abort.
export function resetAI() {
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  if (jsAiModule) jsAiModule.resetAI?.();
  else if (jsAiLoading) jsAiLoading.then((m) => m.resetAI?.());
}

export function getLastStats() {
  return jsAiModule ? jsAiModule.getLastStats?.() : null;
}
