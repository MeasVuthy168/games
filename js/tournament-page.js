// js/tournament-page.js — controller for tournament.html.
import * as Tournament from './tournament.js';
import { levelBand } from './ai-engine.js';
import { recordLoginToday } from './rewards.js';

recordLoginToday();

const RESULT_LABEL = { win: 'Won', loss: 'Lost', draw: 'Draw' };

document.addEventListener('DOMContentLoaded', () => {
  const tournEmoji  = document.getElementById('tournEmoji');
  const tournStatus = document.getElementById('tournStatus');
  const tournSub    = document.getElementById('tournSub');
  const roundList   = document.getElementById('roundList');
  const statWon     = document.getElementById('statWon');
  const statPlayed  = document.getElementById('statPlayed');
  const btnAction   = document.getElementById('btnAction');

  function roundFor(state, roundNum) {
    return state.rounds.find(r => r.round === roundNum) || null;
  }

  function render() {
    const state = Tournament.getState();

    statWon.textContent = String(state.tournamentsWon);
    statPlayed.textContent = String(state.tournamentsPlayed);

    if (state.status === 'idle') {
      tournEmoji.textContent = '🏆';
      tournStatus.textContent = 'Not started';
      tournSub.textContent = 'Beat the local AI through 4 rounds of rising difficulty.';
      btnAction.textContent = 'Start Tournament';
    } else if (state.status === 'in_progress') {
      tournEmoji.textContent = '⚔️';
      tournStatus.textContent = `Round ${state.currentRound} of ${Tournament.TOTAL_ROUNDS}`;
      const lvl = Tournament.ROUND_LEVELS[state.currentRound - 1];
      tournSub.textContent = `Next up: AI Level ${lvl} (${levelBand(lvl)})`;
      btnAction.textContent = `Play Round ${state.currentRound}`;
    } else if (state.status === 'completed') {
      tournEmoji.textContent = '🥇';
      tournStatus.textContent = 'Champion!';
      tournSub.textContent = `You won the tournament and earned ${Tournament.COMPLETION_REWARD} coins.`;
      btnAction.textContent = 'Play Again';
    } else if (state.status === 'failed') {
      tournEmoji.textContent = '💔';
      const lostAt = state.rounds[state.rounds.length - 1];
      tournStatus.textContent = `Eliminated in Round ${lostAt ? lostAt.round : state.currentRound}`;
      tournSub.textContent = 'No reward this run — try again from Round 1.';
      btnAction.textContent = 'Try Again';
    }

    roundList.innerHTML = '';
    for (let i = 0; i < Tournament.TOTAL_ROUNDS; i++) {
      const roundNum = i + 1;
      const level = Tournament.ROUND_LEVELS[i];
      const played = roundFor(state, roundNum);
      const isCurrent = state.status === 'in_progress' && state.currentRound === roundNum;

      const row = document.createElement('div');
      row.className = 'round-row' +
        (isCurrent ? ' is-current' : '') +
        (played?.result === 'win' ? ' is-won' : '') +
        (played && played.result !== 'win' ? ' is-lost' : '');

      const num = document.createElement('div');
      num.className = 'round-num';
      num.textContent = played?.result === 'win' ? '✓' : (played ? '✕' : String(roundNum));

      const meta = document.createElement('div');
      meta.className = 'round-meta';
      const title = document.createElement('div');
      title.className = 'round-title';
      title.textContent = `Round ${roundNum} — AI Level ${level}`;
      const sub = document.createElement('div');
      sub.className = 'round-sub';
      sub.textContent = played
        ? RESULT_LABEL[played.result] || played.result
        : (isCurrent ? `${levelBand(level)} · up next` : levelBand(level));
      meta.appendChild(title);
      meta.appendChild(sub);

      row.appendChild(num);
      row.appendChild(meta);
      roundList.appendChild(row);
    }
  }

  btnAction.addEventListener('click', () => {
    const state = Tournament.getState();
    let round, level;

    if (state.status === 'idle' || state.status === 'completed' || state.status === 'failed') {
      const fresh = Tournament.startTournament();
      round = fresh.currentRound;
      level = Tournament.ROUND_LEVELS[round - 1];
    } else {
      round = state.currentRound;
      level = Tournament.ROUND_LEVELS[round - 1];
    }

    location.href = `play.html?mode=ai&tournamentRound=${round}&aiLevel=${level}`;
  });

  render();
});
