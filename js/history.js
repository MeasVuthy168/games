// js/history.js — local game history + win-rate. One entry per real
// completed game (checkmate or stalemate/draw) — never for a game that was
// merely reset or abandoned mid-play. A signed-out guest's history is
// purely local (localStorage only, exactly as before). A signed-in
// account's history is namespaced by user id so switching accounts never
// shows another account's games, and is kept in sync with the backend
// (see syncHistoryFromServer() below, and recordGame()'s server push), so
// it's the same on every device.

import * as Api from './api.js';

const GUEST_KEY = 'kc_history_v1';

// Keep the log bounded so localStorage doesn't grow without limit over a
// long install lifetime. Most recent games are kept. Mirrors the
// backend's own per-user cap (see ouk-ai-backend's routes/stats.js).
const MAX_ENTRIES = 500;

function cacheKey() {
  const u = Api.getCurrentUser();
  return u ? `${GUEST_KEY}:${u.id}` : GUEST_KEY;
}

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey()) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try { localStorage.setItem(cacheKey(), JSON.stringify(list)); } catch {}
}

// entry: { date, opponent, mode, result, moves, duration }
//   date     — ISO timestamp string (defaults to now)
//   opponent — display string, e.g. "AI Level 7", "Local Friend", or a real display name
//   mode     — 'ai' | 'friend' | 'online'
//   result   — 'win' | 'loss' | 'draw' (see js/ui.js for whose perspective)
//   moves    — half-move count when the game ended
//   duration — seconds the game lasted
const MODES = ['ai', 'friend', 'online'];
export function recordGame(entry) {
  const rec = {
    date: entry?.date || new Date().toISOString(),
    opponent: entry?.opponent || 'Unknown',
    mode: MODES.includes(entry?.mode) ? entry.mode : 'ai',
    result: ['win', 'loss', 'draw'].includes(entry?.result) ? entry.result : 'draw',
    moves: Number.isFinite(entry?.moves) ? entry.moves : 0,
    duration: Number.isFinite(entry?.duration) ? entry.duration : 0,
  };
  const list = readAll();
  list.unshift(rec); // most recent first
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  writeAll(list);
  if (Api.isSignedIn()) Api.recordGameRemote(rec).catch(() => {});
  return rec;
}

export function getHistory() {
  return readAll();
}

// Percentage of recorded games that are wins, rounded to the nearest
// integer. Draws and losses both count against it. Returns null when there
// are zero completed games so callers can show "Not Rated" instead of 0%.
export function computeWinRate() {
  const list = readAll();
  if (list.length === 0) return null;
  const wins = list.filter(g => g.result === 'win').length;
  return Math.round((wins / list.length) * 100);
}

// Pulls the signed-in account's real game history from the backend and
// makes it this account's new local cache — the backend is the source of
// truth once signed in, so this overwrites rather than merges with
// whatever was cached before. No-op for a signed-out guest. Pass an
// already-fetched Api.getStats() result to avoid a second round trip (see
// profile.js, which also needs the coins half of that same response).
export async function syncHistoryFromServer(stats) {
  if (!Api.isSignedIn()) return getHistory();
  try {
    const data = stats || await Api.getStats();
    writeAll(Array.isArray(data.history) ? data.history : []);
    return getHistory();
  } catch {
    return getHistory();
  }
}
