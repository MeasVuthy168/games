// js/history.js — local game history + win-rate. One entry per real
// completed game (checkmate or stalemate/draw) — never for a game that was
// merely reset or abandoned mid-play. Backed by its own localStorage key.

const LS_KEY = 'kc_history_v1';

// Keep the log bounded so localStorage doesn't grow without limit over a
// long install lifetime. Most recent games are kept.
const MAX_ENTRIES = 500;

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch {}
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
