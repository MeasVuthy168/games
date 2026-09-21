// js/watch.js — Watch/Spectator page controller. Two independent tabs,
// both of them setup/list screens only — actually watching a game (Friends
// Online or AI vs AI) always opens the real play.html, reusing the exact
// same board/clocks/checkmate-presentation a real game has (see js/ui.js's
// own onlineMode/spectateMode/aiVsAiMode), instead of a second, separate
// board implementation living here.
//
// - Friends Online: lists games a participant has explicitly opted into
//   spectator visibility (Api.getLiveGames()) — clicking one opens
//   play.html?mode=spectate&gameId=<id>.
// - AI vs AI: level pickers + Start opens play.html?mode=aivsai&....
import * as Api from './api.js';
import { initTranslations, t } from './i18n.js';
import { MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL, levelBand } from './ai-engine.js';

const LIVE_LIST_POLL_MS = 4000;

document.addEventListener('DOMContentLoaded', () => {
  initTranslations();

  /* ---------------- tabs ---------------- */
  const tabFriend = document.getElementById('tabFriend');
  const tabAI = document.getElementById('tabAI');
  const panelFriend = document.getElementById('panelFriend');
  const panelAI = document.getElementById('panelAI');

  function showTab(which) {
    const isFriend = which === 'friend';
    tabFriend.classList.toggle('active', isFriend);
    tabAI.classList.toggle('active', !isFriend);
    tabFriend.setAttribute('aria-selected', String(isFriend));
    tabAI.setAttribute('aria-selected', String(!isFriend));
    panelFriend.hidden = !isFriend;
    panelAI.hidden = isFriend;
    if (isFriend) startLiveListPolling();
    else stopLiveListPolling();
  }
  tabFriend.addEventListener('click', () => showTab('friend'));
  tabAI.addEventListener('click', () => showTab('ai'));

  /* ---------------- Friends Online: list ---------------- */
  const friendState = document.getElementById('friendState');
  const liveGamesList = document.getElementById('liveGamesList');

  let liveListInterval = null;
  function stopLiveListPolling() {
    if (liveListInterval) { clearInterval(liveListInterval); liveListInterval = null; }
  }

  function showFriendState(kind) {
    if (!kind) { friendState.hidden = true; return; }
    friendState.hidden = false;
    liveGamesList.innerHTML = '';
    friendState.innerHTML = '';

    const icon = document.createElement('div');
    icon.className = 'watch-state-icon';
    const title = document.createElement('div');
    title.className = 'watch-state-title';
    friendState.appendChild(icon);
    friendState.appendChild(title);

    if (kind === 'loading') {
      icon.textContent = '👀';
      title.textContent = t('watch.loading');
    } else if (kind === 'signedOut') {
      icon.textContent = '👀';
      title.textContent = t('watch.signIn');
      const btn = document.createElement('a');
      btn.className = 'primary';
      btn.href = 'auth.html?next=watch.html';
      btn.textContent = t('watch.signInBtn');
      friendState.appendChild(btn);
    } else if (kind === 'empty') {
      icon.textContent = '👀';
      title.textContent = t('watch.noGames');
      const sub = document.createElement('div');
      sub.className = 'watch-state-sub';
      sub.textContent = t('watch.noGamesHint');
      friendState.appendChild(sub);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'primary';
      btn.textContent = t('watch.watchAI');
      btn.addEventListener('click', () => showTab('ai'));
      friendState.appendChild(btn);
    } else if (kind === 'error') {
      icon.textContent = '⚠️';
      title.textContent = t('watch.connectionLost');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary';
      btn.textContent = t('watch.retry');
      btn.addEventListener('click', fetchLiveGames);
      friendState.appendChild(btn);
    }
  }

  function renderLiveList(games) {
    showFriendState(null);
    liveGamesList.innerHTML = '';
    for (const g of games) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'card card-full clickable live-game-row';

      const info = document.createElement('div');
      info.className = 'live-game-info';

      const badge = document.createElement('div');
      badge.className = 'live-badge';
      badge.innerHTML = `<span class="live-dot"></span>${t('watch.live')}`;

      const players = document.createElement('div');
      players.className = 'live-game-players';
      players.textContent = `${g.whiteName}  ⚔  ${g.blackName}`;

      const meta = document.createElement('div');
      meta.className = 'live-game-meta';
      meta.textContent = `${t('watch.move')} ${g.moveCount}`;

      info.appendChild(badge);
      info.appendChild(players);
      info.appendChild(meta);

      const watchBtn = document.createElement('span');
      watchBtn.className = 'pill';
      watchBtn.textContent = t('watch.watchBtn');

      row.appendChild(info);
      row.appendChild(watchBtn);
      // Opens the real play.html (?mode=spectate), which reuses the exact
      // same board/clocks/checkmate-presentation a real game does — same
      // reasoning as the AI vs AI tab's own Start button below.
      row.addEventListener('click', () => { location.href = `play.html?mode=spectate&gameId=${g.id}`; });
      liveGamesList.appendChild(row);
    }
  }

  async function fetchLiveGames() {
    if (!Api.isSignedIn()) { showFriendState('signedOut'); return; }
    try {
      const games = await Api.getLiveGames();
      if (!games.length) showFriendState('empty');
      else renderLiveList(games);
    } catch {
      showFriendState('error');
    }
  }

  function startLiveListPolling() {
    stopLiveListPolling();
    showFriendState('loading');
    fetchLiveGames();
    if (!Api.isSignedIn()) return; // nothing to poll until signed in
    liveListInterval = setInterval(() => { if (!document.hidden) fetchLiveGames(); }, LIVE_LIST_POLL_MS);
  }

  /* ---------------- AI vs AI ---------------- */
  // A setup screen only — Start opens the real play.html (?mode=aivsai),
  // so watching two AIs uses the exact same board/clocks/checkmate
  // presentation a real game does, instead of a second board built here.
  const levelWhiteSel = document.getElementById('aiLevelWhite');
  const levelBlackSel = document.getElementById('aiLevelBlack');
  const btnAIStart = document.getElementById('btnAIStart');

  for (const sel of [levelWhiteSel, levelBlackSel]) {
    for (let l = MIN_LEVEL; l <= MAX_LEVEL; l++) {
      const opt = document.createElement('option');
      opt.value = String(l);
      opt.textContent = `${l} — ${levelBand(l)}`;
      if (l === DEFAULT_LEVEL) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  btnAIStart.addEventListener('click', () => {
    const levelWhite = parseInt(levelWhiteSel.value, 10);
    const levelBlack = parseInt(levelBlackSel.value, 10);
    location.href = `play.html?mode=aivsai&levelWhite=${levelWhite}&levelBlack=${levelBlack}`;
  });

  /* ---------------- cleanup + init ---------------- */
  // Belt-and-suspenders: this is a static multi-page app (navigating away
  // destroys the whole JS realm, so there's no cross-page leak risk), but
  // clearing any live interval on pagehide keeps this page's own timers
  // honest even in a bfcache-restore scenario.
  window.addEventListener('pagehide', stopLiveListPolling);

  showTab('friend');
});
