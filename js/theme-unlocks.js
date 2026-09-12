// js/theme-unlocks.js — tracks which priced piece/board themes this account
// has unlocked with coins. Local-only, namespaced by user id exactly like
// js/coins.js's own per-account cache (so switching accounts never shows
// another account's purchases) — there is no server endpoint for arbitrary
// per-user data like this (only coins/history/games are synced), so unlock
// state lives on whichever device/account actually bought it, same as every
// other Settings preference (kc_settings_v1) already does.

import * as Api from './api.js';

const KEY = 'kc_theme_unlocks_v1';

function cacheKey() {
  const u = Api.getCurrentUser();
  return u ? `${KEY}:${u.id}` : KEY;
}

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    return {
      piece: Array.isArray(raw?.piece) ? raw.piece : [],
      board: Array.isArray(raw?.board) ? raw.board : [],
    };
  } catch {
    return { piece: [], board: [] };
  }
}

function write(state) {
  try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch {}
}

// kind: 'piece' | 'board'. A theme with no price (or price 0) is always
// unlocked regardless of purchase history.
export function isThemeUnlocked(kind, theme) {
  if (!theme?.price) return true;
  return read()[kind].includes(theme.id);
}

export function unlockTheme(kind, theme) {
  const state = read();
  if (!state[kind].includes(theme.id)) state[kind].push(theme.id);
  write(state);
}
