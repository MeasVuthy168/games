// js/rewards.js — Daily/objective rewards. Purely local and data-driven:
// objectives are defined once below and their progress is advanced only by
// real gameplay events reported by callers (an AI game actually won, a
// tournament actually won, the app actually opened on a new calendar day)
// — never by merely viewing rewards.html. Single source of truth for its
// own localStorage key; coins are still only ever moved through coins.js.

import { addCoins } from './coins.js';
import { levelBand } from './ai-engine.js';

const LS_KEY = 'kc_rewards_v1';

function defaultState() {
  return {
    loginStreak: { lastDate: null, current: 0, longest: 0 },
    aiWinsTotal: 0,
    hardAiWinsTotal: 0,
    tournamentsWonTotal: 0,
    claimed: {}, // { [objectiveId]: true }
  };
}

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!v || typeof v !== 'object') return defaultState();
    const d = defaultState();
    return {
      ...d,
      ...v,
      loginStreak: { ...d.loginStreak, ...(v.loginStreak || {}) },
      claimed: (v.claimed && typeof v.claimed === 'object') ? v.claimed : {},
    };
  } catch {
    return defaultState();
  }
}

function write(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Call on every app page load. Idempotent within a calendar day — only the
// first call each day advances the streak, so it's safe to call from every
// page's bootstrap without inflating progress.
export function recordLoginToday() {
  const s = read();
  const today = dateStr(new Date());
  if (s.loginStreak.lastDate === today) return s;

  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = dateStr(y);

  s.loginStreak.current = (s.loginStreak.lastDate === yesterday) ? s.loginStreak.current + 1 : 1;
  s.loginStreak.lastDate = today;
  s.loginStreak.longest = Math.max(s.loginStreak.longest, s.loginStreak.current);
  write(s);
  return s;
}

export function getLoginStreak() {
  return read().loginStreak;
}

// Called from ui.js right where a real completed game is recorded
// (recordGameEnd, itself only reached from concludeIfOver on an actual
// checkmate/stalemate) — never from a UI-only toggle.
// mode: 'ai' | 'friend'; result: 'win' | 'loss' | 'draw'.
export function notifyGameResult({ mode, result, aiLevel }) {
  if (mode !== 'ai' || result !== 'win') return read();
  const s = read();
  s.aiWinsTotal += 1;
  const band = levelBand(aiLevel);
  if (band === 'Hard' || band === 'Expert') s.hardAiWinsTotal += 1;
  write(s);
  return s;
}

// Called from tournament.js right after a full bracket win grants its own
// coin reward — a second, independent counter for the Rewards objectives
// below (tournament.js keeps its own lifetime stats for its own UI).
export function notifyTournamentWin() {
  const s = read();
  s.tournamentsWonTotal += 1;
  write(s);
  return s;
}

// Objective definitions. Adapted from the reference "online" objective set
// to what's actually real in this offline app:
//   - "play daily" / login streak -> real calendar-day streak, above.
//   - "win N ranked/random games" -> win N real local AI games.
//   - "defeat a Pro player" -> win at Hard/Expert AI band (closest local
//     stand-in for a strong opponent).
//   - tournament objectives -> real Tournament completions (js/tournament.js).
const OBJECTIVES_DEF = [
  { id: 'login_streak_3',   title: 'Login Streak: 3 Days',        target: 3, reward: 100, metric: s => s.loginStreak.current },
  { id: 'win_5_ai',         title: 'Win 5 AI Games',               target: 5, reward: 150, metric: s => s.aiWinsTotal },
  { id: 'win_hard_3',       title: 'Defeat Hard/Expert AI ×3',     target: 3, reward: 250, metric: s => s.hardAiWinsTotal },
  { id: 'win_tournament_1', title: 'Win a Tournament',             target: 1, reward: 300, metric: s => s.tournamentsWonTotal },
  { id: 'win_tournament_3', title: 'Win 3 Tournaments',            target: 3, reward: 600, metric: s => s.tournamentsWonTotal },
];

// Unlock policy: every objective is visible and unlocked from the start.
// Simpler than tiered unlocking and still meaningful here since progress
// itself (not visibility) is what's gated behind real play.
export function getObjectives() {
  const s = read();
  return OBJECTIVES_DEF.map(def => {
    const raw = def.metric(s);
    const progress = Math.min(def.target, raw);
    const completed = raw >= def.target;
    return {
      id: def.id,
      title: def.title,
      target: def.target,
      progress,
      reward: def.reward,
      unlocked: true,
      completed,
      claimed: !!s.claimed[def.id],
    };
  });
}

export function claimReward(id) {
  const s = read();
  const def = OBJECTIVES_DEF.find(d => d.id === id);
  if (!def) return { ok: false, reason: 'unknown' };
  if (s.claimed[id]) return { ok: false, reason: 'already_claimed' };
  if (def.metric(s) < def.target) return { ok: false, reason: 'incomplete' };

  s.claimed[id] = true;
  write(s);
  addCoins(def.reward);
  return { ok: true, reward: def.reward };
}
