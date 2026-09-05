// js/coins.js — coin ledger. A signed-out guest gets a purely local
// balance (localStorage only, exactly as before). A signed-in account
// gets its own separate local balance, namespaced by user id so switching
// accounts never shows another account's coins — and that per-account
// balance is kept in sync with the backend (see syncCoinsFromServer()
// below, and addCoins()/spendCoins()'s server push), so it's the same on
// every device. This module is the single source of truth for the
// player's coin balance — every screen that shows or changes coins must
// go through these functions instead of reading/writing localStorage
// directly.

import * as Api from './api.js';

const GUEST_KEY = 'kc_coins_v1';

// New players (and any brand-new account, before its first server sync)
// start with a small stipend so the balance display and any future spend
// flow (shop, etc. — later parts of this build) have something real to
// work with from the first launch.
const STARTING_BALANCE = 500;

function cacheKey() {
  const u = Api.getCurrentUser();
  return u ? `${GUEST_KEY}:${u.id}` : GUEST_KEY;
}

function clampBalance(n) {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function read() {
  try {
    const raw = localStorage.getItem(cacheKey());
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampBalance(n) : null;
  } catch {
    return null;
  }
}

function write(n) {
  try { localStorage.setItem(cacheKey(), String(clampBalance(n))); } catch {}
}

export function getCoins() {
  const stored = read();
  if (stored !== null) return stored;
  write(STARTING_BALANCE);
  return STARTING_BALANCE;
}

export function addCoins(amount) {
  const add = clampBalance(amount);
  const next = getCoins() + add;
  write(next);
  if (Api.isSignedIn() && add > 0) Api.addCoinsRemote(add).catch(() => {});
  return next;
}

export function canAfford(amount) {
  return getCoins() >= clampBalance(amount);
}

// Returns true and deducts the balance if affordable, false (no change)
// otherwise.
export function spendCoins(amount) {
  const cost = clampBalance(amount);
  if (!canAfford(cost)) return false;
  write(getCoins() - cost);
  if (Api.isSignedIn() && cost > 0) Api.addCoinsRemote(-cost).catch(() => {});
  return true;
}

// Pulls the signed-in account's real balance from the backend and makes
// it this account's new local cache value — the backend is the source of
// truth once signed in, so this overwrites rather than merges with
// whatever was cached before. No-op for a signed-out guest. Pass an
// already-fetched Api.getStats() result to avoid a second round trip (see
// profile.js, which also needs the history half of that same response).
export async function syncCoinsFromServer(stats) {
  if (!Api.isSignedIn()) return getCoins();
  try {
    const data = stats || await Api.getStats();
    write(data.coins);
    return getCoins();
  } catch {
    return getCoins();
  }
}
