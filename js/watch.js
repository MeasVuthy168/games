// js/watch.js — Watch/Spectator page controller. Two independent tabs:
//
// - Friends Online: lists games a participant has explicitly opted into
//   spectator visibility (Api.getLiveGames()/spectateGame()), polled the
//   same way js/ui.js already polls an online game (setInterval + a
//   document.hidden check) — no new realtime transport, matching the
//   existing REST-poll architecture end to end. The server is the sole
//   source of truth for both the board and for who is allowed to see it;
//   this file never renders anything the /spectate endpoint didn't return.
//
// - AI vs AI: a setup screen only (level pickers + Start) — Start opens
//   the real play.html?mode=aivsai, which reuses the exact same board/
//   clocks/checkmate-presentation a real game has (see js/ui.js) instead
//   of a second, separate board implementation living here.
import * as Api from './api.js';
import { initTranslations, t } from './i18n.js';
import { Game, SIZE, COLORS } from './game.js';
import { MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL, levelBand } from './ai-engine.js';
import { boardThemes, pieceImageUrl, clampThemeIndex, activePieceTheme } from './themes.js';

const LIVE_LIST_POLL_MS = 4000;
const SPECTATE_POLL_MS = 1200;

const LS_KEY = 'kc_settings_v1';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}

function sq(x, y) { return `${String.fromCharCode(97 + x)}${8 - y}`; }

// Same fallback rule as everywhere else in the app (see js/ui.js's own
// identical local helper, and profile.js) — a real uploaded photo wins,
// an emoji is the fallback.
function setAvatar(el, { emoji, url } = {}) {
  if (!el) return;
  if (url) { el.style.backgroundImage = `url("${url}")`; el.textContent = ''; }
  else { el.style.backgroundImage = ''; el.textContent = emoji || '🐯'; }
}

document.addEventListener('DOMContentLoaded', () => {
  initTranslations();

  const settings = loadSettings();
  const boardTheme = boardThemes[clampThemeIndex(settings.boardTheme, boardThemes)];
  const pieceTheme = activePieceTheme(settings.pieceTheme);
  // Matches the player's own chosen board/piece theme (js/ui.js sets these
  // same two custom properties) so Watch looks like the same app, not a
  // reskinned viewer.
  document.documentElement.style.setProperty('--board-light-img', `url("./${boardTheme.light}")`);
  document.documentElement.style.setProperty('--board-dark-img', `url("./${boardTheme.dark}")`);

  /* ---------------- shared read-only board (no click/drag handlers) ----------------
   * Used by both tabs below — built once here rather than twice. Reuses
   * the exact .board/.cell/.piece classes styles.css already defines for
   * the real interactive board, so this looks native without any new
   * board CSS. */
  function createBoard(containerEl) {
    containerEl.innerHTML = '';
    const cells = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = document.createElement('div');
        c.className = 'cell ' + ((x + y) % 2 ? 'dark' : 'light');
        containerEl.appendChild(c);
        cells.push(c);
      }
    }
    return {
      render(board) {
        for (const c of cells) c.innerHTML = '';
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            const p = board?.[y]?.[x];
            if (!p) continue;
            const el = document.createElement('div');
            el.className = `piece ${p.c === 'w' ? 'white' : 'black'}`;
            el.style.backgroundImage = `url(./${pieceImageUrl(pieceTheme, p.c, p.t)})`;
            cells[y * SIZE + x].appendChild(el);
          }
        }
      },
      setTurn(turn) {
        containerEl.classList.toggle('turn-white', turn === COLORS.WHITE);
        containerEl.classList.toggle('turn-black', turn === COLORS.BLACK);
      },
    };
  }

  function renderCaptured(el, pieceTypes, color) {
    el.innerHTML = '';
    for (const pt of pieceTypes) {
      const s = document.createElement('div');
      s.className = 'captured-piece';
      s.style.backgroundImage = `url(./${pieceImageUrl(pieceTheme, color, pt)})`;
      el.appendChild(s);
    }
  }

  // Replays a game's `history` (from/to/captured/by entries — the same
  // shape both the online-games backend and this file's own AI loop
  // produce) through a FRESH Game() so captured piece TYPES are exact —
  // the stored flag is only ever `captured: true/false`, never which piece.
  // This calls the real engine's own move()/at(), never reimplements move
  // legality, and stops rendering (rather than throwing) if a replay ever
  // disagrees with itself, since this is a display nicety, not the source
  // of truth for the board position.
  function replayForDisplay(history) {
    const replay = new Game();
    const capturedByWhite = []; // black pieces White has captured
    const capturedByBlack = []; // white pieces Black has captured
    const historyLines = [];
    let n = 0;
    for (const h of Array.isArray(history) ? history : []) {
      const before = replay.at(h.to.x, h.to.y);
      const res = replay.move(h.from, h.to);
      if (!res.ok) break;
      n++;
      if (h.captured && before) {
        if (before.c === COLORS.WHITE) capturedByBlack.push(before.t);
        else capturedByWhite.push(before.t);
      }
      const mover = h.by || (n % 2 === 1 ? COLORS.WHITE : COLORS.BLACK);
      historyLines.push(
        `${n}. ${mover === COLORS.WHITE ? 'W' : 'B'} ${sq(h.from.x, h.from.y)}-${sq(h.to.x, h.to.y)}${h.captured ? ' x' : ''}${h.promo ? '=' : ''}`
      );
    }
    return { capturedByWhite, capturedByBlack, historyLines, moveCount: n };
  }

  function renderHistoryPanel(el, lines) {
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

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
    if (isFriend) {
      backToList(); // always resume on the list, never a stale spectate view
    } else {
      stopLiveListPolling();
      stopSpectatePolling();
    }
  }
  tabFriend.addEventListener('click', () => showTab('friend'));
  tabAI.addEventListener('click', () => showTab('ai'));

  /* ---------------- Friends Online: list ---------------- */
  const friendState = document.getElementById('friendState');
  const liveGamesList = document.getElementById('liveGamesList');
  const friendListView = document.getElementById('friendListView');
  const spectateView = document.getElementById('spectateView');

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
      row.addEventListener('click', () => openSpectate(g.id));
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

  /* ---------------- Friends Online: spectator board ---------------- */
  const specBoardEl = document.getElementById('specBoard');
  const specBoard = createBoard(specBoardEl);
  const specNameWhite = document.getElementById('specNameWhite');
  const specNameBlack = document.getElementById('specNameBlack');
  const specAvatarWhite = document.getElementById('specAvatarWhite');
  const specAvatarBlack = document.getElementById('specAvatarBlack');
  const specCapturedByWhite = document.getElementById('specCapturedByWhite');
  const specCapturedByBlack = document.getElementById('specCapturedByBlack');
  const specMoveLabel = document.getElementById('specMoveLabel');
  const specHistoryEl = document.getElementById('specHistory');
  const specBanner = document.getElementById('spectateBanner');

  let spectateInterval = null;
  function stopSpectatePolling() {
    if (spectateInterval) { clearInterval(spectateInterval); spectateInterval = null; }
  }

  function openSpectate(id) {
    stopLiveListPolling();
    friendListView.hidden = true;
    spectateView.hidden = false;
    specBanner.hidden = true;
    startSpectatePolling(id);
  }

  function backToList() {
    stopSpectatePolling();
    spectateView.hidden = true;
    friendListView.hidden = false;
    startLiveListPolling();
  }
  document.getElementById('btnBackToList').addEventListener('click', backToList);

  function startSpectatePolling(id) {
    stopSpectatePolling();
    fetchSpectate(id);
    spectateInterval = setInterval(() => { if (!document.hidden) fetchSpectate(id); }, SPECTATE_POLL_MS);
  }

  async function fetchSpectate(id) {
    try {
      const g = await Api.spectateGame(id);
      renderSpectate(g);
      if (g.status !== 'active') {
        stopSpectatePolling();
        specBanner.hidden = false;
        specBanner.textContent = t('watch.gameEnded');
      } else {
        specBanner.hidden = true;
      }
    } catch (err) {
      // 403/404 = spectating was turned off or the game is gone — that can
      // never succeed again, so stop polling; anything else (network
      // hiccup) is transient, so keep polling in the background while
      // showing the same banner.
      if (err?.status === 403 || err?.status === 404) stopSpectatePolling();
      specBanner.hidden = false;
      specBanner.textContent = (err?.status === 403 || err?.status === 404) ? t('watch.gameEnded') : t('watch.connectionLost');
    }
  }

  function renderSpectate(g) {
    specNameWhite.textContent = g.whiteName;
    specNameBlack.textContent = g.blackName;
    setAvatar(specAvatarWhite, { emoji: g.whiteAvatar, url: g.whiteAvatarUrl });
    setAvatar(specAvatarBlack, { emoji: g.blackAvatar, url: g.blackAvatarUrl });
    specAvatarWhite.hidden = false;
    specAvatarBlack.hidden = false;
    specBoard.render(g.board);
    specBoard.setTurn(g.turn);
    const { capturedByWhite, capturedByBlack, historyLines, moveCount } = replayForDisplay(g.history);
    renderCaptured(specCapturedByWhite, capturedByWhite, COLORS.BLACK);
    renderCaptured(specCapturedByBlack, capturedByBlack, COLORS.WHITE);
    specMoveLabel.textContent = `${t('watch.move')} ${moveCount}`;
    renderHistoryPanel(specHistoryEl, historyLines);
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
  window.addEventListener('pagehide', () => {
    stopLiveListPolling();
    stopSpectatePolling();
  });

  showTab('friend');
});
