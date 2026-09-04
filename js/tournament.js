// js/tournament.js — local single-player AI-bracket tournament.
//
// There is no matchmaking backend anywhere in this app, so "Tournament"
// means a real bracket against the local AI engine: the human plays a
// short sequence of rounds at increasing difficulty (see ROUND_LEVELS).
// Every round is a genuine game played on play.html (see js/ui.js's
// tournament-mode branch) — this module only tracks the bracket's state
// and grants the completion reward; it never simulates a result itself.

import { addCoins } from './coins.js';
import { notifyTournamentWin } from './rewards.js';

const LS_KEY = 'kc_tournament_v1';

// 4 rounds, AI level stepping low -> mid -> high -> near-max across the
// Easy/Medium/Hard/Expert bands (see js/ai-engine.js levelBand()).
export const ROUND_LEVELS = [2, 5, 8, 10];
export const TOTAL_ROUNDS = ROUND_LEVELS.length;
export const COMPLETION_REWARD = 500;

function defaultState() {
  return {
    status: 'idle',          // 'idle' | 'in_progress' | 'completed' | 'failed'
    currentRound: 0,          // 1-based while in_progress
    rounds: [],                // [{round, level, result}] for the current/most recent run
    tournamentsWon: 0,         // lifetime, for this module's own UI
    tournamentsPlayed: 0,
    lastRewardGranted: 0,      // coins granted by the most recently completed run
  };
}

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!v || typeof v !== 'object') return defaultState();
    return { ...defaultState(), ...v, rounds: Array.isArray(v.rounds) ? v.rounds : [] };
  } catch {
    return defaultState();
  }
}

function write(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

export function getState() {
  return read();
}

export function startTournament() {
  const s = read();
  s.status = 'in_progress';
  s.currentRound = 1;
  s.rounds = [];
  s.lastRewardGranted = 0;
  write(s);
  return s;
}

// Level for the round currently in progress, or null if no run is active.
export function getCurrentRoundLevel() {
  const s = read();
  if (s.status !== 'in_progress') return null;
  return ROUND_LEVELS[s.currentRound - 1] ?? null;
}

// Called from ui.js's tournament-mode hook right after a real game
// concludes (checkmate or stalemate already detected by game.js).
// `result` is 'win' | 'loss' | 'draw' from the human player's perspective.
// A draw ends the run the same as a loss — the bracket only advances on an
// outright round win. Returns the updated state.
export function recordRoundResult(result) {
  const s = read();
  if (s.status !== 'in_progress') return s;

  const level = ROUND_LEVELS[s.currentRound - 1];
  s.rounds.push({ round: s.currentRound, level, result });

  if (result === 'win') {
    if (s.currentRound >= TOTAL_ROUNDS) {
      s.status = 'completed';
      s.tournamentsWon += 1;
      s.tournamentsPlayed += 1;
      s.lastRewardGranted = COMPLETION_REWARD;
      addCoins(COMPLETION_REWARD);
      notifyTournamentWin();
    } else {
      s.currentRound += 1;
    }
  } else {
    s.status = 'failed';
    s.tournamentsPlayed += 1;
    s.lastRewardGranted = 0;
  }

  write(s);
  return s;
}

// Clears the current/most recent run back to 'idle' (round history and
// lifetime won/played counters are untouched). Used by the "Play Again"
// action so a fresh bracket can start.
export function resetTournament() {
  const s = read();
  s.status = 'idle';
  s.currentRound = 0;
  s.rounds = [];
  s.lastRewardGranted = 0;
  write(s);
  return s;
}

export function isActive() {
  return read().status === 'in_progress';
}
