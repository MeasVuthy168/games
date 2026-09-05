// ui.js — Khmer Chess (Play page) — Makruk AI with remote engine + fallback + end flashes + DnD + premove

import { Game, SIZE, COLORS, PT } from './game.js';
import * as AI from './ai.js';
import { DEFAULT_LEVEL } from './ai-engine.js';
import * as History from './history.js';
import * as Tournament from './tournament.js';
import * as Rewards from './rewards.js';
import * as Api from './api.js';
import { pieceThemes, boardThemes, pieceImageUrl, clampThemeIndex } from './themes.js';
import { showToast } from './toast.js';
import { initTranslations } from './i18n.js';

const AIPICK   = AI.pickAIMove || AI.chooseAIMove;

const LS_KEY   = 'kc_settings_v1';
const SAVE_KEY = 'kc_game_state_makruk_v1';

const DEFAULTS = {
  minutes: 10,
  increment: 5,
  sound: true,
  hints: true,
  aiColor: 'b', // fallback: human plays White, AI plays Black, until the player picks a role
  aiLevel: DEFAULT_LEVEL,
  aiDebug: false,
  instantMove: false,
  pieceTheme: 0,
  boardTheme: 0
};

/* ---------------- storage ---------------- */

function saveGameState(game, clocks) {
  const s = {
    board: game.board,
    turn: game.turn,
    history: game.history,
    msW: clocks.msW,
    msB: clocks.msB,
    clockTurn: clocks.turn
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {}
}

function loadGameState() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
  catch { return null; }
}

function clearGameState() {
  try { localStorage.removeItem(SAVE_KEY); } catch {}
}

function loadSettings() {
  const mode = new URLSearchParams(location.search).get('mode') || 'ai';
  const isFriendMode = mode === 'friend';

  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    const merged = s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
    // Normalize aiLevel to an integer 1-10 — guards against stale settings
    // saved before the Easy/Medium/Hard/Expert → 1-10 refactor.
    const lvl = parseInt(merged.aiLevel, 10);
    merged.aiLevel = Number.isInteger(lvl) && lvl >= 1 && lvl <= 10 ? lvl : DEFAULT_LEVEL;
    if (isFriendMode) {
      // Two humans, pass-and-play on the same device — no AI.
      merged.aiEnabled = false;
    } else {
      // Force Makruk AI vs human, but respect the player's chosen color
      // (set on the home screen's role picker: White / Black / Random)
      // and the player's chosen difficulty (Settings → AI).
      merged.aiEnabled = true;
      if (merged.aiColor !== 'w' && merged.aiColor !== 'b') merged.aiColor = 'b';
    }
    return merged;
  } catch {
    return isFriendMode
      ? { ...DEFAULTS, aiEnabled: false }
      : { ...DEFAULTS, aiEnabled: true, aiColor: 'b' };
  }
}

/* ---------------- audio ---------------- */

class AudioBeeper {
  constructor() {
    this.enabled = true;
    this.bank = {
      move:    new Audio('assets/sfx/move.mp3'),
      capture: new Audio('assets/sfx/capture.mp3'),
      select:  new Audio('assets/sfx/select.mp3'),
      error:   new Audio('assets/sfx/error.mp3'),
      check:   new Audio('assets/sfx/check.mp3'),
      // No dedicated win/lose clips are shipped; reuse existing sfx as stand-ins.
      win:     new Audio('assets/sfx/check.mp3'),
      lose:    new Audio('assets/sfx/error.mp3')
    };
    for (const k in this.bank) this.bank[k].preload = 'auto';
  }
  play(name, vol = 1) {
    if (!this.enabled) return;
    const src = this.bank[name]; if (!src) return;
    const a = src.cloneNode(true); a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(()=>{});
  }
  move(){ this.play('move', .9); }
  capture(){ this.play('capture', 1.0); }
  select(){ this.play('select', .85); }
  error(){ this.play('error', .9); }
  check(){ this.play('check', 1.0); }
  sfxWin(){ this.play('win', 1.0); }
  sfxLose(){ this.play('lose', 1.0); }
}
const beeper = new AudioBeeper();

function vibrate(pattern){ if (navigator.vibrate) navigator.vibrate(pattern); }

/* ---------------- clocks ---------------- */

class Clocks {
  constructor(update) {
    this.msW = 0; this.msB = 0; this.running = false;
    this.turn = COLORS.WHITE; this.increment = 0; this._t = null; this._u = update;
  }
  init(min, inc, turn = COLORS.WHITE) {
    this.msW = min * 60 * 1000; this.msB = min * 60 * 1000;
    this.increment = inc * 1000; this.turn = turn; this.stop(); this._u(this.msW, this.msB);
  }
  start() {
    if (this.running) return; this.running = true;
    let last = performance.now();
    const tick = () => {
      if (!this.running) return;
      const now = performance.now(); const dt = now - last; last = now;
      if (this.turn === COLORS.WHITE) this.msW = Math.max(0, this.msW - dt);
      else this.msB = Math.max(0, this.msB - dt);
      this._u(this.msW, this.msB);
      if (this.msW <= 0 || this.msB <= 0){ this.stop(); return; }
      this._t = requestAnimationFrame(tick);
    };
    this._t = requestAnimationFrame(tick);
  }
  stop(){ this.running = false; if (this._t) cancelAnimationFrame(this._t); this._t=null; }
  pauseResume(){ this.running ? this.stop() : this.start(); }
  switchedByMove(prev) {
    if (prev === COLORS.WHITE) this.msW += this.increment;
    else this.msB += this.increment;
    this.turn = (prev === COLORS.WHITE) ? COLORS.BLACK : COLORS.WHITE;
    this._u(this.msW, this.msB); this.start();
  }
  format(ms){
    const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000), t = Math.floor((ms%1000)/100);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`;
  }
}

/* ---------------- end-flash overlay ---------------- */

function $(s, r=document){ return r.querySelector(s); }

function showEndFlash(opts){
  const { type='win', title:titleText, sub:subText } = opts||{};
  const overlay = $('#flashOverlay');
  const title = $('#flashTitle');
  const sub = $('#flashSub');
  const rip = $('#ripWrap');
  const fw = overlay.querySelector('.fireworks');

  // Defaults
  fw.style.display = 'none';
  rip.style.display = 'none';

  if (type === 'win'){
    title.textContent = titleText || 'អ្នកឈ្នះ!';
    sub.textContent   = subText || 'អុកស្លាប់! ល្បែងត្រូវបញ្ចប់។';
    fw.style.display  = 'block';
    beeper.sfxWin();
  } else if (type === 'lose'){
    title.textContent = titleText || 'អ្នកចាញ់!';
    sub.textContent   = subText || 'អុកស្លាប់! ល្បែងត្រូវបញ្ចប់។';
    rip.style.display = 'block';
    beeper.sfxLose();
  } else {
    title.textContent = 'ស្មើ!';
    sub.innerHTML     = '<span class="draw-badge">ល្បែងត្រូវបញ្ចប់</span>';
  }

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden','false');
  $('#appTabbar')?.classList.add('is-hidden');
}
window.showEndFlash = showEndFlash;

// Close/reset buttons
document.addEventListener('click', (e)=>{
  if (e.target?.id === 'flashClose'){
    $('#flashOverlay')?.classList.remove('show');
    $('#flashOverlay')?.setAttribute('aria-hidden','true');
    $('#appTabbar')?.classList.remove('is-hidden');
    // Tournament mode: round is already recorded (see handleTournamentEnd in
    // initUI) — hand control back to the bracket screen instead of just
    // dismissing the flash and staying on this ad-hoc board.
    if (window.__kcTournamentActive) location.href = 'tournament.html';
    else if (window.__kcOnlineActive) location.href = 'friends.html';
  }
  if (e.target?.id === 'flashAgain'){
    $('#flashOverlay')?.classList.remove('show');
    $('#flashOverlay')?.setAttribute('aria-hidden','true');
    $('#appTabbar')?.classList.remove('is-hidden');
    if (window.__kcTournamentActive) { location.href = 'tournament.html'; return; }
    if (window.__kcOnlineActive) { location.href = 'friends.html'; return; }
    // call reset
    $('#btnReset')?.click();
  }
});

/* ---------------- main UI ---------------- */

export async function initUI() {
  initTranslations();
  const elBoard  = document.getElementById('board');
  const elTurn   = document.getElementById('turnLabel');
  const btnReset = document.getElementById('btnReset');
  const btnUndo  = document.getElementById('btnUndo');
  const btnPause = document.getElementById('btnPause');
  const clockW   = document.getElementById('clockW');
  const clockB   = document.getElementById('clockB');

  const KH = {
    white: 'ស',
    black: 'ខ្មៅ',
    check: 'អុក',
    checkmate: 'អុកស្លាប់',
    stalemate: 'អាប់'
  };

  Rewards.recordLoginToday();

  // Tournament mode: tournament.html sends the player here with
  // ?mode=ai&tournamentRound=N&aiLevel=L for a single bracket round. This
  // reuses this same single-game screen/loop rather than a second board
  // implementation — see handleTournamentEnd() below for how the result is
  // reported back to js/tournament.js.
  const urlParams = new URLSearchParams(location.search);
  const tRoundParam = parseInt(urlParams.get('tournamentRound'), 10);
  const tLevelParam = parseInt(urlParams.get('aiLevel'), 10);
  const tournamentMode = Number.isInteger(tRoundParam) && tRoundParam >= 1 &&
    Number.isInteger(tLevelParam) && tLevelParam >= 1 && tLevelParam <= 10;
  window.__kcTournamentActive = tournamentMode;

  // Online mode: friends.html sends the player here with
  // ?mode=online&gameId=<id> for a real game against a friend, backed by
  // ouk-ai-backend's /api/games/* routes (server-authoritative moves — see
  // applyOnlineGameState/attemptOnlineMove below). Reuses this same
  // single-game screen rather than a second board implementation.
  const onlineGameId = urlParams.get('gameId');
  const onlineMode = urlParams.get('mode') === 'online' && !!onlineGameId;
  window.__kcOnlineActive = onlineMode;
  let onlineState = null; // latest {status,myColor,turn,myTurn,board,history,result,opponentId,opponentName,...}

  if (onlineMode) {
    if (!Api.isSignedIn()) {
      location.href = `auth.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    try {
      const resp = await Api.getGame(onlineGameId);
      onlineState = resp.game;
    } catch (err) {
      alert(err.message || 'Could not load this game.');
      location.href = 'friends.html';
      return;
    }
  }

  const game = new Game();
  const settings = loadSettings();
  if (tournamentMode) {
    // Fixed seat + the round's assigned difficulty, regardless of whatever
    // role/level the player last picked for ad-hoc games. Always start the
    // round on a clean board, never a resumed in-progress game.
    settings.aiEnabled = true;
    settings.aiColor = 'b';
    settings.aiLevel = tLevelParam;
    clearGameState();
  }
  if (onlineMode) {
    // No AI, no local save/resume — this board mirrors server truth only.
    settings.aiEnabled = false;
    if (onlineState.board) {
      game.board = onlineState.board;
      game.turn = onlineState.turn;
    }
  }
  beeper.enabled = !!settings.sound;

  // Online games are played on separate devices, so each player expects
  // their own pieces at the bottom of their own screen — flip the board
  // for whoever is playing Black instead of always rendering White's
  // side down (which is what local same-device pass-and-play still does).
  const flipped = onlineMode && onlineState.myColor === COLORS.BLACK;
  function gridSlot(x, y) {
    return flipped ? (SIZE - 1 - y) * SIZE + (SIZE - 1 - x) : y * SIZE + x;
  }

  // When a real game actually concludes (checkmate/stalemate), this feeds
  // js/history.js's `duration` field. Reset on every fresh game (Reset
  // button); a resumed (reloaded) game just restarts the clock from now.
  let gameStartedAt = Date.now();

  function applyBoardTheme() {
    const idx = clampThemeIndex(settings.boardTheme, boardThemes);
    const theme = boardThemes[idx];
    document.documentElement.style.setProperty('--board-light-img', `url("./${theme.light}")`);
    document.documentElement.style.setProperty('--board-dark-img', `url("./${theme.dark}")`);
  }
  applyBoardTheme();

  window.AIDebug?.log('[UI] init — Makruk AI (local engine)');

  let AILock = false;
  let aiGen = 0; // bumped on Restart/Undo so a still-in-flight AI search
                 // from before that change is ignored when it resolves.

  function setBoardBusy(on) {
    AILock = !!on;
    if (elBoard) elBoard.style.pointerEvents = on ? 'none' : 'auto';
    document.body.classList.toggle('ai-thinking', !!on);
  }

  function isAITurn() {
    if (!settings.aiEnabled) return false;
    if (settings.aiColor === 'w' && game.turn === COLORS.WHITE) return true;
    if (settings.aiColor === 'b' && game.turn === COLORS.BLACK) return true;
    return false;
  }

  // The human's own color when playing vs AI (AI takes the other one).
  function humanColor() {
    if (!settings.aiEnabled) return null;
    return settings.aiColor === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
  }

  // Player-name rows are fixed to board geometry (top = Black rank, bottom =
  // White rank) — only the *labels* change with the chosen role/mode.
  function applyPlayerLabels() {
    const elNameTop    = document.getElementById('nameBlack');
    const elNameBottom = document.getElementById('nameWhite');
    if (!elNameTop || !elNameBottom) return;
    if (onlineMode) {
      // The board is flipped for Black (see `flipped` above) so your own
      // pieces always end up at the bottom — keep these labels in sync.
      const meIsWhite = onlineState.myColor === COLORS.WHITE;
      elNameTop.textContent    = onlineState.opponentName + (meIsWhite ? ' · ខ្មៅ' : ' · ស');
      elNameBottom.textContent = 'អ្នក (You)' + (meIsWhite ? ' · ស' : ' · ខ្មៅ');
    } else if (settings.aiEnabled) {
      const aiIsWhite = settings.aiColor === COLORS.WHITE;
      elNameTop.textContent    = (aiIsWhite ? 'អ្នក (You)' : 'Master (AI)') + ' · ខ្មៅ';
      elNameBottom.textContent = (aiIsWhite ? 'Master (AI)' : 'អ្នក (You)') + ' · ស';
    } else {
      elNameTop.textContent    = 'អ្នកទី១ · ខ្មៅ (Black)';
      elNameBottom.textContent = 'អ្នកទី២ · ស (White)';
    }
  }
  applyPlayerLabels();

  // Online games have no server-enforced time control, so a local countdown
  // would just be misleading — hide the clocks entirely instead of faking one.
  if (onlineMode) {
    document.getElementById('timersTop')?.style.setProperty('display', 'none');
    document.getElementById('timersBottom')?.style.setProperty('display', 'none');
    document.getElementById('localControls')?.setAttribute('hidden', '');
    document.getElementById('onlineControls')?.removeAttribute('hidden');
  }

  const clocks = new Clocks((w, b) => {
    if (clockW) clockW.textContent = clocks.format(w);
    if (clockB) clockB.textContent = clocks.format(b);
  });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // Build board
  elBoard.innerHTML = '';
  const cells = [];
  for (let gy = 0; gy < SIZE; gy++) {
    for (let gx = 0; gx < SIZE; gx++) {
      // dataset.x/y always name the real board square this grid slot holds
      // (flipped or not), so click handlers and game logic never need to
      // know about the visual flip — only this mapping does.
      const bx = flipped ? SIZE - 1 - gx : gx;
      const by = flipped ? SIZE - 1 - gy : gy;
      const c = document.createElement('div');
      c.className = 'cell ' + ((bx + by) % 2 ? 'dark' : 'light');
      c.dataset.x = bx;
      c.dataset.y = by;
      elBoard.appendChild(c);
      cells.push(c);
    }
  }

  function applyTurnClass() {
    elBoard.classList.toggle('turn-white', game.turn === COLORS.WHITE);
    elBoard.classList.toggle('turn-black', game.turn === COLORS.BLACK);
  }

  function setPieceBG(span, p){
    const idx = clampThemeIndex(settings.pieceTheme, pieceThemes);
    const theme = pieceThemes[idx];
    span.style.backgroundImage = `url(./${pieceImageUrl(theme, p.c, p.t)})`;
  }

  // Who-plays suffix so the current player's role is always explicit,
  // regardless of which color they picked (White or Black).
  function whoSuffix(color) {
    if (onlineMode) return color === onlineState.myColor ? ' · វេនអ្នក (You)' : ` · វេន ${onlineState.opponentName}`;
    if (!settings.aiEnabled) return '';
    return color === settings.aiColor ? ' · វេន Master (AI)' : ' · វេនអ្នក (You)';
  }

  function khTurnLabel() {
    const side = game.turn === COLORS.WHITE ? KH.white : KH.black;
    const st = game.status();
    if (st.state === 'checkmate') {
      const w = side === 'ស' ? 'ខ្មៅ' : 'ស';
      return `វេនខាង (${side}) · ${KH.checkmate} · ${w} ឈ្នះ`;
    }
    if (st.state === 'stalemate') return KH.stalemate;
    if (st.state === 'check')     return `វេនខាង (${side}) · ${KH.check}${whoSuffix(game.turn)}`;
    return `វេនខាង (${side})${whoSuffix(game.turn)}`;
  }

  // Localized end-of-game announcement, correct for any chosen color/role.
  function announceCheckmate(matedColor) {
    const winnerColor = matedColor === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
    const sideTxt = (c) => c === COLORS.WHITE ? 'ស' : 'ខ្មៅ';
    if (settings.aiEnabled) {
      const humanWon = winnerColor !== settings.aiColor;
      const matedRole = matedColor === settings.aiColor ? ' (Master/AI)' : ' (អ្នក/You)';
      showEndFlash({
        type: humanWon ? 'win' : 'lose',
        title: humanWon ? 'អ្នកឈ្នះ!' : 'អ្នកចាញ់!',
        sub: `អុកស្លាប់ខាង${sideTxt(matedColor)}${matedRole}! ល្បែងត្រូវបញ្ចប់។`
      });
    } else {
      showEndFlash({
        type: 'win',
        title: `ខាង${sideTxt(winnerColor)}ឈ្នះ!`,
        sub: `អុកស្លាប់ខាង${sideTxt(matedColor)}! ល្បែងត្រូវបញ្ចប់។`
      });
    }
  }

  // One js/history.js entry per real completed game — called only from the
  // checkmate/stalemate branches below, never on Reset/Undo.
  function recordGameEnd(kind, matedColor) {
    const mode = settings.aiEnabled ? 'ai' : 'friend';
    let result;
    if (kind === 'stalemate') {
      result = 'draw';
    } else {
      const winnerColor = matedColor === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
      if (settings.aiEnabled) {
        result = winnerColor !== settings.aiColor ? 'win' : 'loss';
      } else {
        // Friend mode is two humans passing one device — there's no single
        // "the player" to score against, so this is recorded from White's
        // (bottom seat's) perspective as a stand-in.
        result = winnerColor === COLORS.WHITE ? 'win' : 'loss';
      }
    }
    History.recordGame({
      date: new Date().toISOString(),
      opponent: settings.aiEnabled ? `AI Level ${settings.aiLevel}` : 'Local Friend',
      mode,
      result,
      moves: game.history.length,
      duration: Math.round((Date.now() - gameStartedAt) / 1000),
    });

    // Daily Rewards progress: only ever advanced from this real completed-
    // game path, never from opening rewards.html itself.
    Rewards.notifyGameResult({ mode, result, aiLevel: settings.aiLevel });

    return result;
  }

  // Tournament mode: report the round's real result to js/tournament.js
  // right where the game actually ended (win/loss/draw already resolved by
  // recordGameEnd above). No-op outside tournament mode.
  function handleTournamentEnd(result) {
    if (!tournamentMode) return;
    Tournament.recordRoundResult(result);
  }

  // Shared tail for every place a move can end the game: records history
  // once, then shows the existing win/lose/draw flash. Returns true if the
  // game ended (so callers know not to also call thinkAndPlay()).
  function concludeIfOver(status) {
    if (status?.state === 'checkmate') {
      const result = recordGameEnd('checkmate', status.toMove);
      announceCheckmate(status.toMove);
      handleTournamentEnd(result);
      return true;
    }
    if (status?.state === 'stalemate') {
      const result = recordGameEnd('stalemate', null);
      showEndFlash({ type: 'draw' });
      handleTournamentEnd(result);
      return true;
    }
    return false;
  }

  /* ====== render with animations ====== */
  function render() {
    for (const c of cells) {
      c.innerHTML = '';
      c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture');
    }

    const last = game.history[game.history.length - 1];

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = game.at(x, y);
        if (!p) continue;
        const cell = cells[gridSlot(x, y)];

        // compute delta for small animation (skipped entirely when
        // settings.instantMove is on — moves just appear in place)
        let dx = '0px', dy = '0px', klass = '';
        if (last && last.to.x === x && last.to.y === y && !settings.instantMove){
          // flip the animation direction too, so the slide-in matches the
          // piece's actual on-screen movement rather than its raw board delta
          const sign = flipped ? -1 : 1;
          dx = sign * (last.from.x - last.to.x) * 12 + 'px';
          dy = sign * (last.from.y - last.to.y) * 12 + 'px';
          const isKnight = (p.t === PT.KNIGHT);
          klass = isKnight ? 'anim-hop' : 'anim-slide';
        }

        const s = document.createElement('div');
        s.className = `piece ${p.c === 'w' ? 'white' : 'black'} ${klass}`.trim();
        s.style.setProperty('--dx', dx);
        s.style.setProperty('--dy', dy);
        setPieceBG(s, p);
        cell.appendChild(s);
      }
    }

    if (last) {
      const fromIdx = gridSlot(last.from.x, last.from.y);
      const toIdx   = gridSlot(last.to.x, last.to.y);
      cells[fromIdx]?.classList.add('last-from');
      cells[toIdx]?.classList.add('last-to');
      if (last.captured){
        cells[toIdx]?.classList.add('last-capture');
        const rp = document.createElement('div'); rp.className = 'capture-ripple';
        cells[toIdx]?.appendChild(rp); setTimeout(()=> rp.remove(), 350);
      }
    }

    if (elTurn) elTurn.textContent = khTurnLabel();
    applyTurnClass();
  }

  /* ====== Online play (real games between friends, server-authoritative) ====== */

  let onlinePollHandle = null;
  let onlineChatPollHandle = null;
  let onlineFinished = false;

  function stopOnlinePolling() {
    if (onlinePollHandle) clearInterval(onlinePollHandle);
    if (onlineChatPollHandle) clearInterval(onlineChatPollHandle);
    onlinePollHandle = null;
    onlineChatPollHandle = null;
  }

  function renderOnlineBanner() {
    const banner = document.getElementById('onlineStatusBanner');
    if (!banner) return;
    const amChallenger = onlineState.myColor === COLORS.WHITE && onlineState.status === 'pending';
    if (onlineState.status === 'pending') {
      banner.hidden = false;
      elBoard.style.display = 'none';
      banner.innerHTML = '';
      if (amChallenger) {
        banner.textContent = `Waiting for ${onlineState.opponentName} to accept your challenge…`;
      } else {
        banner.appendChild(document.createTextNode(`${onlineState.opponentName} challenged you to a game.`));
        banner.appendChild(document.createElement('br'));
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'primary'; acceptBtn.textContent = 'Accept';
        acceptBtn.style.margin = '.5rem .3rem 0';
        acceptBtn.addEventListener('click', async () => {
          try { await Api.acceptGame(onlineGameId); const { game: g } = await Api.getGame(onlineGameId); applyOnlineGameState(g); }
          catch (err) { showToast(err.message || 'Could not accept', 'error'); }
        });
        const declineBtn = document.createElement('button');
        declineBtn.className = 'secondary'; declineBtn.textContent = 'Decline';
        declineBtn.style.margin = '.5rem .3rem 0';
        declineBtn.addEventListener('click', async () => {
          try { await Api.declineGame(onlineGameId); } catch {}
          location.href = 'friends.html';
        });
        banner.appendChild(acceptBtn);
        banner.appendChild(declineBtn);
      }
    } else {
      banner.hidden = true;
      elBoard.style.display = '';
    }
  }

  // Mirrors server-truth game state into the local board for rendering —
  // this is display/input-gating only; the server (ouk-ai-backend's
  // /api/games/:id/move, reusing the exact same rules engine) is what
  // actually validates and applies every move.
  function applyOnlineGameState(g) {
    const prevUpdatedAt = onlineState?.updatedAt;
    onlineState = g;
    game.board = g.board;
    game.turn = g.turn;
    game.history = [];
    if (g.history?.length) {
      const lastMove = g.history[g.history.length - 1];
      game.history = [{ from: lastMove.from, to: lastMove.to, captured: !!lastMove.captured }];
    }

    if (g.status === 'active') {
      renderOnlineBanner();
      render();
      setBoardBusy(!g.myTurn);
    } else if (g.status === 'pending') {
      renderOnlineBanner();
    }

    if (g.status === 'finished' && !onlineFinished) {
      onlineFinished = true;
      stopOnlinePolling();
      setBoardBusy(false);
      render();
      const myWon = (g.result === 'white' && g.myColor === 'w') || (g.result === 'black' && g.myColor === 'b');
      const isDraw = g.result === 'draw';
      showEndFlash({
        type: isDraw ? 'draw' : (myWon ? 'win' : 'lose'),
        title: isDraw ? undefined : (myWon ? 'អ្នកឈ្នះ!' : 'អ្នកចាញ់!'),
        sub: `ល្បែងជាមួយ ${g.opponentName} ត្រូវបញ្ចប់។`,
      });
      History.recordGame({
        date: new Date().toISOString(),
        opponent: g.opponentName,
        mode: 'online',
        result: isDraw ? 'draw' : (myWon ? 'win' : 'loss'),
        moves: (g.history || []).length,
        duration: Math.round((Date.now() - gameStartedAt) / 1000),
      });
      // Real online wins are intentionally excluded from AI-specific Daily
      // Rewards objectives — Rewards.notifyGameResult only counts mode:'ai'.
    } else if (prevUpdatedAt !== g.updatedAt && beeper.enabled && g.history?.length) {
      const last = g.history[g.history.length - 1];
      if (last.captured) { beeper.capture(); vibrate([20, 40, 30]); } else beeper.move();
    }
  }

  async function attemptOnlineMove(from, to) {
    setBoardBusy(true);
    try {
      const { game: g } = await Api.makeGameMove(onlineGameId, from, to);
      applyOnlineGameState(g);
    } catch (err) {
      beeper.error(); vibrate(40);
      if (err.status !== 400 && err.status !== 409) showToast(err.message || 'Move failed', 'error');
      setBoardBusy(!onlineState.myTurn);
    }
  }

  function onOnlineCellTap(e) {
    if (!onlineState || onlineState.status !== 'active' || !onlineState.myTurn) { beeper.error(); return; }
    const x = +e.currentTarget.dataset.x;
    const y = +e.currentTarget.dataset.y;
    const p = game.at(x, y);

    if (p && p.c === onlineState.myColor) {
      selected = { x, y }; showHints(x, y);
      if (beeper.enabled) beeper.select();
      return;
    }
    if (!selected) { if (beeper.enabled) beeper.error(); vibrate(40); return; }
    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok) {
      selected = null; legal = []; clearHints();
      if (beeper.enabled) beeper.error(); vibrate(40); return;
    }
    const from = { ...selected }, to = { x, y };
    selected = null; legal = []; clearHints();
    attemptOnlineMove(from, to);
  }

  function startOnlinePolling() {
    onlinePollHandle = setInterval(async () => {
      if (onlineFinished || document.hidden) return;
      try {
        const { game: g } = await Api.getGame(onlineGameId);
        if (g.updatedAt !== onlineState.updatedAt || g.status !== onlineState.status) applyOnlineGameState(g);
      } catch { /* transient — try again next tick */ }
    }, 3000);
  }

  // Real chat, reusing the same friend-chat backend the Friend tab's
  // chat.html talks to — the opponent is always a friend (challenges are
  // friend-gated server-side), so no separate "game chat" concept is needed.
  function setupOnlineChat(opponentId) {
    const card = document.getElementById('chatCard');
    if (!card) return;
    card.hidden = false;
    card.classList.remove('chat-panel');
    card.innerHTML = `
      <div class="online-chat">
        <div class="card-title">សន្ទនា (Chat)</div>
        <div class="online-chat-msgs" id="onlineChatMsgs"></div>
        <form class="online-chat-form" id="onlineChatForm">
          <input type="text" id="onlineChatInput" maxlength="2000" placeholder="Message…" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </div>
    `;
    const msgsEl = document.getElementById('onlineChatMsgs');
    let lastTs = null;
    const seen = new Set();

    function appendMsg(m) {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      const row = document.createElement('div');
      row.className = 'msg-row' + (m.fromMe ? ' me' : '');
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.textContent = m.body;
      row.appendChild(bubble);
      msgsEl.appendChild(row);
      if (!lastTs || m.createdAt > lastTs) lastTs = m.createdAt;
    }

    async function loadInitial() {
      try {
        const messages = await Api.getMessages(opponentId);
        for (const m of messages) appendMsg(m);
        msgsEl.scrollTop = msgsEl.scrollHeight;
        await Api.markThreadRead(opponentId);
      } catch { /* chat is a bonus feature here — a failed load shouldn't block the game */ }
    }

    async function poll() {
      try {
        const messages = await Api.getMessages(opponentId, lastTs);
        if (messages.length) {
          for (const m of messages) appendMsg(m);
          msgsEl.scrollTop = msgsEl.scrollHeight;
          await Api.markThreadRead(opponentId);
        }
      } catch { /* try again next tick */ }
    }

    loadInitial();
    onlineChatPollHandle = setInterval(poll, 4000);

    document.getElementById('onlineChatForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('onlineChatInput');
      const body = input.value.trim();
      if (!body) return;
      input.value = '';
      try { await Api.sendMessage(opponentId, body); await poll(); }
      catch (err) { showToast(err.message || 'Could not send message', 'error'); }
    });
  }

  /* ====== AI helpers & logic (with fallback + debug) ====== */

  function pickRandomLegalFor(color) {
    const moves = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const p = game.at(x, y);
      if (!p || p.c !== color) continue;
      const ms = game.legalMoves(x, y);
      for (const m of ms) moves.push({ from:{x,y}, to:{x:m.x,y:m.y} });
    }
    if (!moves.length) return null;
    return moves[(Math.random() * moves.length) | 0];
  }

  async function thinkAndPlay() {
    if (AILock || !isAITurn()) return;
    const myGen = aiGen;
    setBoardBusy(true);

    try {
      const aiOpts = { level: settings.aiLevel, aiColor: settings.aiColor, timeMs: 120 };
      const aiMove = await Promise.resolve(AIPICK(game, aiOpts));
      window.AIDebug?.log('[UI] thinkAndPlay: AI move (raw) =', JSON.stringify(aiMove));

      // Board was reset/undone while this search was in flight — the move
      // (if any) no longer applies to the current position. Drop it silently.
      if (myGen !== aiGen) return;

      if (!aiMove || !aiMove.from || !aiMove.to) {
        window.AIDebug?.log('[UI] AI returned null → disabling AI');
        showToast('AI error. AI play has been stopped.', 'error'); settings.aiEnabled = false; return;
      }

      const from = { x: aiMove.from.x, y: aiMove.from.y };
      const to   = { x: aiMove.to.x,   y: aiMove.to.y   };

      const prevTurn = game.turn;
      const before   = game.at(to.x, to.y);
      let res = game.move(from, to);

      if (!res || !res.ok) {
        window.AIDebug?.log('[UI] engine move illegal → fallback random');
        const fb = pickRandomLegalFor(settings.aiColor);
        if (!fb) { settings.aiEnabled = false; return; }
        const before2 = game.at(fb.to.x, fb.to.y);
        const prev2 = game.turn;
        const res2 = game.move(fb.from, fb.to);
        if (!res2?.ok){ settings.aiEnabled=false; return; }

        if (beeper.enabled){
          before2 ? (beeper.capture(), vibrate([20,40,30])) : beeper.move();
          if (res2.status?.state === 'check') beeper.check();
        }

        clocks.switchedByMove(prev2);
        render(); saveGameState(game, clocks);

        concludeIfOver(res2.status);
        return;
      }

      if (beeper.enabled){
        before ? (beeper.capture(), vibrate([20,40,30])) : beeper.move();
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prevTurn);
      render(); saveGameState(game, clocks);

      concludeIfOver(res.status);

    } catch (e) {
      console.error('[AI] thinkAndPlay failed', e);
      window.AIDebug?.log('[UI] thinkAndPlay ERROR:', e?.message || String(e));
      showToast('AI error. AI play has been stopped.', 'error');
      settings.aiEnabled = false;
    } finally {
      setBoardBusy(false);
      window.AIDebug?.log('[UI] thinkAndPlay END turn=', game.turn);
    }
  }

  /* ========== Human move + Tap-to-move ========== */

  let selected = null;
  let legal = [];
  let premove = null; // queued move while AI thinks

  const clearHints = () => {
    for (const c of cells) c.classList.remove('selected','hint-move','hint-capture');
  };

  const hintsEnabled = () => settings.hints !== false;

  function showHints(x, y) {
    clearHints();
    const cell = cells[gridSlot(x, y)];
    cell.classList.add('selected');
    legal = game.legalMoves(x, y);
    if (!hintsEnabled()) return;
    for (const m of legal) {
      const t = game.at(m.x, m.y);
      const c = cells[gridSlot(m.x, m.y)];
      c.classList.add(t ? 'hint-capture' : 'hint-move');
    }
  }

  function onCellTap(e) {
    const x = +e.currentTarget.dataset.x;
    const y = +e.currentTarget.dataset.y;
    const p = game.at(x, y);

    // If AI turn → allow premove selection for the human's own color
    if (isAITurn() || AILock) {
      if (p && p.c === humanColor()){
        if (!selected){ selected = {x,y}; showHints(x,y); beeper.select(); return; }
        const ok = legal.some(m => m.x===x && m.y===y);
        if (ok){
          premove = { from:{...selected}, to:{x,y} };
          cells[gridSlot(selected.x, selected.y)].classList.add('last-from');
          cells[gridSlot(x, y)].classList.add('last-to');
          beeper.select();
        } else { beeper.error(); }
      } else { beeper.error(); }
      vibrate(30);
      return;
    }

    // Select piece
    if (p && p.c === game.turn) {
      selected = { x, y }; showHints(x, y);
      if (beeper.enabled) beeper.select(); return;
    }

    // No selection yet
    if (!selected) { if (beeper.enabled) beeper.error(); vibrate(40); return; }

    // Check if target is legal
    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok) {
      selected = null; legal = []; clearHints();
      if (beeper.enabled) beeper.error(); vibrate(40); return;
    }

    const from   = { ...selected };
    const to     = { x, y };
    const before = game.at(to.x, to.y);
    const prev   = game.turn;
    const res    = game.move(from, to);

    if (res.ok) {
      if (beeper.enabled) {
        if (before) { beeper.capture(); vibrate([20, 40, 30]); }
        else { beeper.move(); }
        if (res.status?.state === 'check') beeper.check();
      }

      clocks.switchedByMove(prev);
      selected = null; legal = []; clearHints();
      render(); saveGameState(game, clocks);

      if (!concludeIfOver(res.status)) {
        thinkAndPlay();
      }
    }
  }

  for (const c of cells) {
    c.addEventListener('click', onlineMode ? onOnlineCellTap : onCellTap, { passive: true });
  }

  /* ========== Drag & Drop (pointer) ========== */

  function boardRect(){ return elBoard.getBoundingClientRect(); }
  function cellAtXY(px, py){
    const r = boardRect(); if (!r.width || !r.height) return null;
    const cw = r.width / 8, ch = r.height / 8;
    const x = Math.min(7, Math.max(0, Math.floor((px - r.left) / cw)));
    const y = Math.min(7, Math.max(0, Math.floor((py - r.top)  / ch)));
    if (px < r.left || py < r.top || px > r.right || py > r.bottom) return null;
    return { x, y, idx: y*SIZE + x, el: cells[y*SIZE + x] };
  }

  let dragging = null;        // { from:{x,y}, ghost:El, legal:[{x,y,el}] }
  let dragPointerId = null;

  function legalForSquare(x, y){
    const ls = game.legalMoves(x,y) || [];
    return ls.map(m => ({ x:m.x, y:m.y, el: cells[m.y*SIZE+m.x] }));
  }

  function startDrag(x, y, clientX, clientY, pointerId){
    const p = game.at(x, y); if (!p) return;
    if (p.c !== game.turn) return;
    dragging = { from:{x,y}, legal: legalForSquare(x,y) };
    dragPointerId = pointerId;

    const g = document.createElement('div');
    g.className = 'drag-ghost';
    const tmp = document.createElement('div'); tmp.style.display='none'; setPieceBG(tmp, p);
    g.style.backgroundImage = tmp.style.backgroundImage;
    document.body.appendChild(g);
    dragging.ghost = g;
    moveGhost(clientX, clientY);

    cells[y*SIZE+x].classList.add('selected');
    if (hintsEnabled()) for (const t of dragging.legal) t.el.classList.add('drag-legal');
  }

  function moveGhost(px, py){
    if (!dragging?.ghost) return;
    dragging.ghost.style.left = px+'px';
    dragging.ghost.style.top  = py+'px';
    for (const c of cells) c.classList.remove('drag-target');
    const dest = cellAtXY(px, py);
    if (dest && dragging.legal.some(m => m.x===dest.x && m.y===dest.y)){
      dest.el.classList.add('drag-target');
    }
  }

  function endDrag(px, py){
    const d = dragging; dragging = null;
    for (const c of cells) c.classList.remove('drag-target','drag-legal','selected');
    if (d?.ghost){ d.ghost.remove(); }
    if (!d) return;

    const dest = cellAtXY(px, py);
    if (!dest){ beeper.error(); vibrate(40); return; }
    const ok = d.legal.some(m => m.x===dest.x && m.y===dest.y);
    if (!ok){ beeper.error(); vibrate(40); return; }

    const before = game.at(dest.x, dest.y);
    const prev   = game.turn;
    const res    = game.move(d.from, {x:dest.x, y:dest.y});
    if (!res?.ok){ beeper.error(); vibrate(40); return; }

    if (beeper.enabled){
      before ? (beeper.capture(), vibrate([20,40,30])) : beeper.move();
      if (res.status?.state === 'check') beeper.check();
    }
    clocks.switchedByMove(prev);
    render(); saveGameState(game, clocks);

    if (!concludeIfOver(res.status)) { thinkAndPlay(); }
  }

  function onCellPointerDown(e){
    if (isAITurn() || AILock) { beeper.error(); vibrate(40); return; }
    const x = +e.currentTarget.dataset.x, y = +e.currentTarget.dataset.y;
    const p = game.at(x,y);
    if (!p || p.c !== game.turn){ if (beeper.enabled) beeper.error(); return; }
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
    startDrag(x,y, e.clientX, e.clientY, e.pointerId);
  }
  function onCellPointerMove(e){ if (dragging && e.pointerId===dragPointerId){ moveGhost(e.clientX, e.clientY); } }
  function onCellPointerUp(e){ if (e.pointerId===dragPointerId){ endDrag(e.clientX, e.clientY); dragPointerId=null; } }

  if (!onlineMode) {
    // Tap-to-move only for online games — simpler and fully functional;
    // drag-and-drop is a nice-to-have that isn't worth the extra
    // client/server round-trip complexity here.
    for (const c of cells){
      c.addEventListener('pointerdown', onCellPointerDown, { passive:false });
      c.addEventListener('pointermove', onCellPointerMove, { passive:true });
      c.addEventListener('pointerup',   onCellPointerUp,   { passive:true });
      c.addEventListener('pointercancel', onCellPointerUp, { passive:true });
    }
  }

  if (onlineMode) {
    renderOnlineBanner();
    if (onlineState.status === 'active') {
      render();
      setBoardBusy(!onlineState.myTurn);
      startOnlinePolling();
    } else if (onlineState.status === 'pending') {
      startOnlinePolling(); // watch for the other side accepting/declining
    }
    setupOnlineChat(onlineState.opponentId);

    document.getElementById('btnResign')?.addEventListener('click', async () => {
      if (onlineState.status !== 'active') return;
      if (!confirm(`Resign this game against ${onlineState.opponentName}?`)) return;
      try { await Api.resignGame(onlineGameId); const { game: g } = await Api.getGame(onlineGameId); applyOnlineGameState(g); }
      catch (err) { showToast(err.message || 'Could not resign', 'error'); }
    });

    window.addEventListener('beforeunload', stopOnlinePolling);
    return game;
  }

  // resume or fresh start
  const saved = loadGameState();
  if (saved) {
    game.board   = saved.board;
    game.turn    = saved.turn;
    game.history = saved.history || [];
    render();
    clocks.start();
  } else {
    render();
    clocks.start();
  }

  // AI first move (if ever AI=White later)
  if (isAITurn()) thinkAndPlay();

  /* -------- controls -------- */

  btnReset?.addEventListener('click', () => {
    aiGen++; AI.resetAI?.(); setBoardBusy(false);
    game.reset();
    gameStartedAt = Date.now();
    selected = null; legal = []; premove = null; clearHints(); clearGameState();
    clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    if (isAITurn()) thinkAndPlay();
  });

  btnUndo?.addEventListener('click', () => {
    aiGen++; AI.resetAI?.(); setBoardBusy(false);
    if (!game.undo()) return;
    // Playing vs AI: also undo the AI's reply so control returns to the human.
    if (isAITurn()) game.undo();

    selected = null; legal = []; premove = null; clearHints();
    clocks.turn = game.turn;
    render(); saveGameState(game, clocks);
  });

  btnPause?.addEventListener('click', () => {
    const wasRunning = clocks.running;
    clocks.pauseResume();
    const i = btnPause?.querySelector('img');
    const s = btnPause?.querySelector('span');
    if (i) i.src = wasRunning ? 'assets/ui/play.png' : 'assets/ui/pause.png';
    if (s) s.textContent = wasRunning ? 'ចាប់ផ្ដើម' : 'ផ្អាក';
  });

  window.addEventListener('beforeunload', () => saveGameState(game, clocks));

  return game;
}

/* ---------------- service worker (unchanged) ---------------- */

const SW_URL = './sw.js';
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // See js/pwa.js for why this only reloads when a controller already
      // existed (a genuine update), not on a page's very first-ever visit.
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: './', updateViaCache: 'none' });
      reg.update();
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing; if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage({ type: 'SKIP_WAITING' });
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        if (!window.__reloadedForSW) { window.__reloadedForSW = true; location.reload(); }
      });
      setInterval(() => reg.update(), 60 * 1000);
    } catch (err) {
      console.log('SW registration failed:', err);
    }
  });
}
