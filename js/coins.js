// js/coins.js — local coin ledger. Purely offline: a single number kept in
// localStorage. This module is the single source of truth for the player's
// coin balance — every screen that shows or changes coins must go through
// these functions instead of reading/writing localStorage directly.

const LS_KEY = 'kc_coins_v1';

// New players start with a small stipend so the balance display and any
// future spend flow (shop, etc. — later parts of this build) have something
// real to work with from the first launch.
const STARTING_BALANCE = 500;

function clampBalance(n) {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function read() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampBalance(n) : null;
  } catch {
    return null;
  }
}

function write(n) {
  try { localStorage.setItem(LS_KEY, String(clampBalance(n))); } catch {}
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
  return true;
}
