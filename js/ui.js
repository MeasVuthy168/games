// ui.js — Khmer Chess (Play page) — Makruk AI with remote engine + fallback + end flashes + DnD + premove

import { Game, SIZE, COLORS, PT, emptyCounting } from './game.js';
import * as AI from './ai.js';
import { DEFAULT_LEVEL } from './ai-engine.js';
import * as History from './history.js';
import * as Tournament from './tournament.js';
import * as Rewards from './rewards.js';
import * as Api from './api.js';
import { pieceThemes, boardThemes, pieceImageUrl, clampThemeIndex, preloadPieceImages, activePieceTheme } from './themes.js';
import { showToast } from './toast.js';
import { initTranslations, t } from './i18n.js';

const AIPICK   = AI.pickAIMove || AI.chooseAIMove;

const LS_KEY   = 'kc_settings_v1';
const SAVE_KEY = 'kc_game_state_makruk_v1';

const DEFAULTS = {
  minutes: 10,
  increment: 5,
  sound: true,
  haptic: true,
  hints: true,
  aiColor: 'b', // fallback: human plays White, AI plays Black, until the player picks a role
  aiLevel: DEFAULT_LEVEL,
  aiDebug: false,
  animationEnabled: true,
  pieceTheme: 0,
  boardTheme: 0
};

/* ---------------- storage ---------------- */

function saveGameState(game, clocks) {
  const s = {
    board: game.board,
    turn: game.turn,
    history: game.history,
    // Counting Draw is real game state (which move it's on, whose count
    // it is), not a setting — it belongs in the resumable game-state save,
    // never in kc_settings_v1.
    counting: game.counting,
    // Whether any capture has happened yet — gates the King's/Neang's
    // first-move special openings (see game.js). Real game state, same
    // reasoning as `counting` above.
    captureOccurred: game.captureOccurred,
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
    // Migrate the old (inverted) "instantMove" flag to the new
    // animationEnabled flag, once, without losing existing users'
    // preference — instantMove:true meant "skip the animation", i.e.
    // animationEnabled:false. (Mirrors the same migration in settings.js.)
    if (s && typeof s.instantMove === 'boolean' && !('animationEnabled' in s)) {
      merged.animationEnabled = !s.instantMove;
    }
    delete merged.instantMove;
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
    const SOURCES = {
      move:    'assets/sfx/move.mp3',
      capture: 'assets/sfx/capture.mp3',
      select:  'assets/sfx/select.mp3',
      error:   'assets/sfx/error.mp3',
      check:   'assets/sfx/check.mp3',
      // No dedicated clips are shipped for every event below; reuse the
      // closest existing sfx as a stand-in rather than shipping new assets.
      lose:      'assets/sfx/error.mp3',
      promotion: 'assets/sfx/capture.mp3',
      draw:      'assets/sfx/select.mp3',
    };
    // A small fixed-size, round-robin pool of real <audio> elements per
    // sound, built once and reused for the whole session — instead of
    // cloneNode()-ing a brand new element on every single play(). A real
    // game easily plays 50+ sounds, and WebKit/iOS Safari handles many
    // short-lived audio elements far worse than Chromium: that unbounded
    // per-move object creation is what read as the game gradually getting
    // laggier the longer a game went on, especially on iPhone. POOL_SIZE
    // only needs to comfortably exceed how many instances of the SAME
    // sound could ever legitimately overlap (never more than 1-2 here).
    const POOL_SIZE = 3;
    this.pools = {};
    this.poolIdx = {};
    for (const name in SOURCES) {
      this.pools[name] = Array.from({ length: POOL_SIZE }, () => {
        const a = new Audio(SOURCES[name]);
        a.preload = 'auto';
        return a;
      });
      this.poolIdx[name] = 0;
    }
  }
  play(name, vol = 1) {
    if (!this.enabled) return;
    const pool = this.pools[name]; if (!pool) return;
    const a = pool[this.poolIdx[name]];
    this.poolIdx[name] = (this.poolIdx[name] + 1) % pool.length;
    a.pause();
    a.currentTime = 0;
    a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(()=>{});
  }
  move(){ this.play('move', .9); }
  capture(){ this.play('capture', 1.0); }
  select(){ this.play('select', .85); }
  error(){ this.play('error', .9); }
  // The checkmate MOMENT's own sound — a plain check() cue, fired once by
  // presentGameResult() right as the king's checkmate glow pulses. WIN's
  // own celebrate() (below) is a deliberately DIFFERENT sound fired later
  // at the card reveal, so a win-via-checkmate never plays the same clip
  // twice back to back (this round's explicit "no duplicate feedback"
  // rule for CHECKMATE + WIN).
  check(){ this.play('check', 1.0); }
  sfxLose(){ this.play('lose', 1.0); }
  promotion(){ this.play('promotion', .9); }
  draw(){ this.play('draw', .8); }

  // Counting Draw sounds — generated Web Audio tones rather than shipping
  // 3 more small mp3 files (play.html used to reference count-start.mp3/
  // count-end.mp3 that were never actually added as real assets). Reuses
  // this same class/instance, gated by the same `enabled` flag as every
  // other sound here — nothing about Sound/Haptic/Animation independence
  // changes for these.
  tone(freq, durationMs, vol = 0.35, waveType = 'sine') {
    if (!this.enabled) return;
    try {
      if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this._ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = waveType;
      osc.frequency.value = freq;
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durationMs / 1000 + 0.02);
    } catch { /* Web Audio unsupported/blocked — never break gameplay */ }
  }
  countStart(){ this.tone(880, 120, 0.35); }
  count(){ this.tone(660, 70, 0.25); }
  countWarning(){ this.tone(520, 90, 0.35, 'square'); }

  // WIN's own celebration flourish — a short ascending two-note chime,
  // reusing the same Web Audio tone() this class already uses for
  // counting cues rather than a second sound system. Fired once at the
  // result card's reveal (see presentGameResult()), always AFTER and
  // always DIFFERENT from the earlier checkmate-moment check() cue, so
  // the two never sound like the same clip playing twice.
  celebrate(){
    this.tone(660, 110, 0.3);
    setTimeout(() => this.tone(880, 160, 0.32), 90);
  }
}
const beeper = new AudioBeeper();

// Low-level primitive — a bare wrapper around navigator.vibrate. Gameplay
// code calls triggerHaptic(type) instead; this is only what that function
// calls into. navigator.vibrate is unsupported on iOS Safari and some other
// browsers — when it's missing this is simply a no-op, never an error.
function vibrate(pattern){ if (navigator.vibrate) navigator.vibrate(pattern); }

/* ---------------- centralized Animation/Haptic settings ----------------
 * initUI() sets `currentSettings` once per page load (there is exactly one
 * play.html per page, so this mirrors the existing single `beeper` — no
 * per-instance state needed). Kept at module scope, not inside initUI,
 * so showEndFlash() (also module-level, since it's reused by the online-
 * play code path before initUI's own closures exist) can reach the same
 * Haptic setting that every move-handling path already uses. */
let currentSettings = null;
// The OS-level "reduce motion" request is a hard ceiling on top of the
// app's own Animation toggle — either one being "off" means no decorative
// animation. Read once initUI() runs (matchMedia needs a real window).
let prefersReducedMotionMQ = null;
function isAnimationEnabled(){
  if (prefersReducedMotionMQ?.matches) return false;
  return !currentSettings || currentSettings.animationEnabled !== false;
}
function isHapticEnabled(){ return !currentSettings || currentSettings.haptic !== false; }

// One centralized haptic dispatcher for every game event — mirrors
// beeper's role for sound. Recommended patterns per event, in ms:
// short single pulses for light feedback, longer/multi-pulse patterns for
// heavier events (checkmate, win). Unsupported devices/browsers already
// no-op silently inside vibrate() above.
const HAPTIC_PATTERNS = {
  select:    12,
  move:      18,
  capture:   [20, 40, 30],
  check:     [30, 40, 30],       // short double pulse
  checkmate: [40, 30, 40, 30, 70], // stronger pattern
  promotion: 25,
  win:       [30, 30, 30, 30, 60],
  loss:      [50, 80, 50],
  draw:      [20, 40, 20],
  error:     40,
  countStart:   15,
  count:        10,     // very short pulse per counted move
  countWarning: [25, 20, 25], // slightly stronger, final 1-2 counted moves
};
function triggerHaptic(type){
  if (!isHapticEnabled()) return;
  const pattern = HAPTIC_PATTERNS[type];
  if (pattern != null) vibrate(pattern);
}

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
    // Ticks at ~10Hz (matching format()'s own tenths-of-a-second display
    // precision below), not requestAnimationFrame's 60Hz+ — the display
    // never showed anything finer than 0.1s anyway, so the extra frames
    // were pure continuous CPU/DOM-update overhead for the entire game's
    // duration, not a visible improvement. Elapsed time itself still comes
    // from a real performance.now() delta each tick (not a fixed 100ms
    // assumption), so the countdown stays accurate regardless of any
    // scheduling jitter — only the update RATE changed, not the accuracy.
    const tick = () => {
      if (!this.running) return;
      const now = performance.now(); const dt = now - last; last = now;
      if (this.turn === COLORS.WHITE) this.msW = Math.max(0, this.msW - dt);
      else this.msB = Math.max(0, this.msB - dt);
      this._u(this.msW, this.msB);
      if (this.msW <= 0 || this.msB <= 0){ this.stop(); return; }
    };
    this._t = setInterval(tick, 100);
  }
  stop(){ this.running = false; if (this._t) clearInterval(this._t); this._t=null; }
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

/* ---------------- result celebration overlay ---------------- */

function $(s, r=document){ return r.querySelector(s); }

// WIN-only celebration particles — lightweight DOM spans, never a canvas
// or external library. Only ever called while Animation is on (callers
// guard this too; repeated here as a hard floor), so under Animation off
// or prefers-reduced-motion no particle node is ever created at all, not
// merely hidden. Self-contained inside .flash-particles (overflow:hidden
// in CSS), so this can never cover the board or cause page scroll.
function clearParticles(){
  const el = document.getElementById('flashParticles');
  if (el) el.innerHTML = '';
}
function spawnCelebrationParticles(){
  if (!isAnimationEnabled()) return;
  const el = document.getElementById('flashParticles');
  if (!el) return;
  clearParticles();
  const count = 16 + Math.floor(Math.random() * 9); // 16–24
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    const angle = Math.random() * Math.PI * 2;
    const dist = 55 + Math.random() * 85;
    p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
    p.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
    p.style.setProperty('--delay', Math.round(Math.random() * 120) + 'ms');
    p.style.setProperty('--dur', Math.round(600 + Math.random() * 400) + 'ms');
    p.style.setProperty('--hue', Math.round(30 + Math.random() * 55) + 'deg'); // warm gold/amber range
    frag.appendChild(p);
  }
  el.appendChild(frag);
}

// Fills the optional small summary block (Opponent/Moves/Time) — purely
// display of data the app already computes for History.recordGame()
// elsewhere; never a new statistic. Any row missing a value is hidden
// individually so a friend-mode game (no single "opponent") or an online
// game just shows fewer rows rather than a blank one.
function populateSummary(summary){
  const box = document.getElementById('flashSummary');
  if (!box) return;
  if (!summary) { box.hidden = true; return; }
  const rows = [
    ['summaryOpponentRow', 'summaryOpponent', summary.opponent],
    ['summaryMovesRow',    'summaryMoves',    summary.moves != null ? String(summary.moves) : null],
    ['summaryTimeRow',     'summaryTime',     summary.timeText || null],
  ];
  let any = false;
  for (const [rowId, valId, val] of rows) {
    const row = document.getElementById(rowId);
    const valEl = document.getElementById(valId);
    const show = val != null && val !== '';
    if (row) row.hidden = !show;
    if (valEl && show) valEl.textContent = val;
    any = any || show;
  }
  box.hidden = !any;
}

// Low-level "reveal the result now" — the one place that actually shows
// the overlay and plays its final sound/haptic. Kept callable directly
// (window.showEndFlash, unchanged signature) for quick manual/automated
// checks that don't care about the new delayed-presentation timing;
// presentGameResult() below is what real gameplay calls, and it always
// ends by calling this exact function once the presentation delay (if
// any) has elapsed.
function showEndFlash(opts){
  const { type='win', title:titleText, sub:subText, icon:iconText, reason:reasonText, summary } = opts || {};
  const overlay = $('#flashOverlay');
  const card = overlay.querySelector('.flash-card');
  const iconEl = $('#flashIcon');
  const title = $('#flashTitle');
  const sub = $('#flashSub');
  const reasonEl = $('#flashReason');

  overlay.classList.remove('type-win', 'type-lose', 'type-draw');
  overlay.classList.add(type === 'win' ? 'type-win' : type === 'lose' ? 'type-lose' : 'type-draw');

  const defaultIcon  = type === 'win' ? '🏆' : type === 'lose' ? '😔' : '🤝';
  const defaultTitle = type === 'win' ? t('result.win') : type === 'lose' ? t('result.loss') : t('result.draw');
  if (iconEl) iconEl.textContent = iconText || defaultIcon;
  title.textContent = titleText || defaultTitle;
  sub.textContent = subText || '';
  if (reasonEl) { reasonEl.textContent = reasonText || ''; reasonEl.hidden = !reasonText; }
  populateSummary(summary);

  if (type === 'win') { beeper.celebrate(); triggerHaptic('win'); }
  else if (type === 'lose') { beeper.sfxLose(); triggerHaptic('loss'); }
  else { beeper.draw(); triggerHaptic('draw'); }

  // A short, professional entrance for the result card — the only
  // "decorative" part of this overlay Animation OFF should skip; the
  // result text/buttons themselves always render, animated or not.
  card?.classList.toggle('flash-enter', isAnimationEnabled());

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden','false');
}
window.showEndFlash = showEndFlash;

// Close/reset buttons
document.addEventListener('click', (e)=>{
  if (e.target?.id === 'flashClose'){
    $('#flashOverlay')?.classList.remove('show');
    $('#flashOverlay')?.setAttribute('aria-hidden','true');
    // Tournament mode: round is already recorded (see handleTournamentEnd in
    // initUI) — hand control back to the bracket screen instead of just
    // dismissing the flash and staying on this ad-hoc board.
    if (window.__kcTournamentActive) location.href = 'tournament.html';
    else if (window.__kcOnlineActive) location.href = 'friends.html';
  }
  if (e.target?.id === 'flashAgain'){
    $('#flashOverlay')?.classList.remove('show');
    $('#flashOverlay')?.setAttribute('aria-hidden','true');
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

  // Only AI/local-friend games get the page locked (see play.html's
  // .board-locked CSS) — online games have a real chat form that can sit
  // below the fold, so that page must stay scrollable to reach it.
  if (!onlineMode) document.body.classList.add('board-locked');

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
  // Fire-and-forget, as early as possible — warms every piece image into
  // the browser's decoded-image cache well before a first move can need it.
  preloadPieceImages(pieceThemes[clampThemeIndex(settings.pieceTheme, pieceThemes)]);
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
  currentSettings = settings; // see isAnimationEnabled()/isHapticEnabled() above
  prefersReducedMotionMQ = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  // A couple of effects (the check/checkmate king pulse) are always shown
  // for correctness — even with Animation off the square must still be
  // marked — but only their *pulsing* is decorative; this class lets CSS
  // tell those two things apart without a second JS-side condition.
  document.body.classList.toggle('kc-anim-off', !isAnimationEnabled());

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

  // Shows a real uploaded photo when there is one, an emoji otherwise —
  // same fallback rule as everywhere else in the app (see profile.js).
  function setAvatar(el, { emoji, url } = {}) {
    if (!el) return;
    if (url) { el.style.backgroundImage = `url("${url}")`; el.textContent = ''; }
    else { el.style.backgroundImage = ''; el.textContent = emoji || '🐯'; }
  }

  // Player-name rows are fixed to board geometry (top = Black rank, bottom =
  // White rank) — only the *labels* change with the chosen role/mode.
  function applyPlayerLabels() {
    const elNameTop    = document.getElementById('nameBlack');
    const elNameBottom = document.getElementById('nameWhite');
    const elAvatarTop    = document.getElementById('avatarBlack');
    const elAvatarBottom = document.getElementById('avatarWhite');
    const elResign = document.getElementById('btnResign');
    if (!elNameTop || !elNameBottom) return;
    // Which side is called what depends on the chosen piece theme — Silver
    // & Gold's pieces aren't literally "White"/"Black", so the label
    // shouldn't say so (a Red & Blue player seeing their opponent
    // labeled "· ខ្មៅ" while the AI's pieces are visibly red was the
    // original bug report this fixes).
    const pieceColors = activePieceTheme(settings.pieceTheme).colors;
    if (onlineMode) {
      // The board is flipped for Black (see `flipped` above) so your own
      // pieces always end up at the bottom — keep these labels in sync.
      // A real online opponent gets their real name + photo instead of a
      // generic side label, and Resign lives right on their row instead
      // of its own separate control row above everything.
      const meIsWhite = onlineState.myColor === COLORS.WHITE;
      const me = Api.getCurrentUser();
      elNameTop.textContent    = onlineState.opponentName + (meIsWhite ? ` · ${pieceColors.b.short}` : ` · ${pieceColors.w.short}`);
      elNameBottom.textContent = 'អ្នក (You)' + (meIsWhite ? ` · ${pieceColors.w.short}` : ` · ${pieceColors.b.short}`);
      setAvatar(elAvatarTop, { emoji: onlineState.opponentAvatar, url: onlineState.opponentAvatarUrl });
      setAvatar(elAvatarBottom, { emoji: me?.avatarEmoji, url: me?.avatarUrl });
      if (elAvatarTop) elAvatarTop.hidden = false;
      if (elAvatarBottom) elAvatarBottom.hidden = false;
      if (elResign) elResign.hidden = false;
    } else if (settings.aiEnabled) {
      const aiIsWhite = settings.aiColor === COLORS.WHITE;
      elNameTop.textContent    = (aiIsWhite ? 'អ្នក (You)' : 'Master (AI)') + ` · ${pieceColors.b.short}`;
      elNameBottom.textContent = (aiIsWhite ? 'Master (AI)' : 'អ្នក (You)') + ` · ${pieceColors.w.short}`;
      if (elAvatarTop) elAvatarTop.hidden = true;
      if (elAvatarBottom) elAvatarBottom.hidden = true;
      if (elResign) elResign.hidden = true;
    } else {
      elNameTop.textContent    = `អ្នកទី១ · ${pieceColors.b.label}`;
      elNameBottom.textContent = `អ្នកទី២ · ${pieceColors.w.label}`;
      if (elAvatarTop) elAvatarTop.hidden = true;
      if (elAvatarBottom) elAvatarBottom.hidden = true;
      if (elResign) elResign.hidden = true;
    }
  }
  applyPlayerLabels();

  // Online games have no server-enforced time control, so a local countdown
  // would just be misleading — hide just the clock, not the whole row
  // (which now also carries the real name/photo and, on top, Resign).
  if (onlineMode) {
    document.getElementById('clockB')?.style.setProperty('display', 'none');
    document.getElementById('clockW')?.style.setProperty('display', 'none');
    document.getElementById('localControls')?.setAttribute('hidden', '');
  }

  const clocks = new Clocks((w, b) => {
    if (clockW) clockW.textContent = clocks.format(w);
    if (clockB) clockB.textContent = clocks.format(b);
  });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // Build board
  elBoard.innerHTML = '';
  const cells = [];
  // render() tracks what piece (if any) it last actually painted into each
  // board square here — see render() for why: real devices (especially
  // WebKit/iOS) visibly struggle to recreate and re-paint 64 piece images
  // every single move, so it only touches the handful of squares whose
  // piece actually changed instead of wiping and rebuilding the whole board.
  const renderedPiece = Array.from({ length: SIZE }, () => new Array(SIZE).fill(undefined));
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

  // Last-move arrow: a single thin SVG line overlaid across the board's
  // content area (see styles.css's #lastMoveArrow for why it's
  // position:absolute rather than a grid-spanning item). Built once
  // here; render() below just moves its endpoints and toggles opacity.
  const lastMoveArrowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  lastMoveArrowSvg.id = 'lastMoveArrow';
  lastMoveArrowSvg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  lastMoveArrowSvg.setAttribute('preserveAspectRatio', 'none');
  // fill="none" is set inline (not just via styles.css) so this path can
  // never render as a solid filled wedge -- an SVG <path> defaults to a
  // BLACK fill, and a filled 3-point knight-arrow path draws as a solid
  // triangle (its open ends implicitly closed for fill purposes). Same
  // for the marker's own fill="none" is NOT needed there since that one
  // IS meant to be filled (it's the solid arrowhead), but this line
  // itself must stay unfilled regardless of stylesheet load timing.
  // refX="10" (not the arrowhead triangle's own midpoint) anchors the
  // marker at its visual TIP -- (10,5) is the pointed vertex of the
  // M0,0 L10,5 L0,10 Z triangle below -- so the path's endpoint
  // coordinate IS where the tip is drawn, not somewhere back along the
  // shaft. Without this the tip visibly overshoots past wherever the
  // path math says it should stop, which is what made the arrow miss
  // the square's true center despite the endpoint being pulled in to
  // sit right on it.
  lastMoveArrowSvg.innerHTML =
    '<defs><marker id="lastMoveArrowhead" viewBox="0 0 10 10" refX="10" refY="5" ' +
    'markerWidth="4" markerHeight="4" orient="auto-start-reverse">' +
    '<path class="last-move-arrowhead" d="M0,0 L10,5 L0,10 Z"/></marker></defs>' +
    '<path class="last-move-arrow-line" fill="none" d="" opacity="0" marker-end="url(#lastMoveArrowhead)" />';
  elBoard.appendChild(lastMoveArrowSvg);
  const lastMoveArrowLine = lastMoveArrowSvg.querySelector('.last-move-arrow-line');

  // Visual (flip-aware) column/row for a board square — the same
  // mirroring gridSlot() applies, so the arrow always points the way the
  // move actually reads on screen even when the board is flipped for an
  // online Black player.
  const visualCol = (x) => (flipped ? SIZE - 1 - x : x);
  const visualRow = (y) => (flipped ? SIZE - 1 - y : y);

  // Pulls `from` toward `to` by `amount` grid units, capped at 40% of
  // that pair's own distance so a short segment (e.g. a knight arrow's
  // 1-square closing leg) never gets eaten away to nothing.
  function pullToward(from, to, amount) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(amount, len * 0.4) / len;
    return { x: from.x + dx * t, y: from.y + dy * t };
  }

  // Grid units pulled back from each square's true center. Deliberately
  // tiny and NOT scaled by move distance -- the explicit ask was for
  // both ends to land AT the true center of their square, not just
  // "near" it, so this is only enough to keep the path's own endpoint
  // (and its round linecap) from poking out past the now-correctly-
  // anchored arrowhead marker (see refX="10" above).
  const ARROW_INSET = 0.03;

  // Points the arrow from mv.from -> mv.to, or hides it when mv is
  // falsy (fresh game / undo back past the first move). A straight move
  // (every piece but the knight only ever moves in a straight line) is
  // one segment between the two square centers, each end pulled in a
  // bit so the line travels the gap between the pieces rather than
  // piercing through their glyphs. A knight's actual path is an L, not
  // a diagonal -- drawing it as a straight line cuts across whatever
  // piece happens to sit on that diagonal, which is exactly the
  // "arrow doesn't match how the piece actually moved" complaint this
  // fixes. Bent at the corner of the knight's own 2x1 box (long leg
  // first, short leg into the destination), matching how lichess/
  // chess.com draw knight-move arrows.
  function updateLastMoveArrow(mv) {
    if (!mv) { lastMoveArrowLine.setAttribute('d', ''); lastMoveArrowLine.setAttribute('opacity', '0'); return; }
    const from = { x: visualCol(mv.from.x) + 0.5, y: visualRow(mv.from.y) + 0.5 };
    const to   = { x: visualCol(mv.to.x)   + 0.5, y: visualRow(mv.to.y)   + 0.5 };
    const dx = mv.to.x - mv.from.x, dy = mv.to.y - mv.from.y;
    const isKnightMove = (Math.abs(dx) === 2 && Math.abs(dy) === 1) || (Math.abs(dx) === 1 && Math.abs(dy) === 2);

    let d;
    if (isKnightMove) {
      const bend = Math.abs(dx) === 2 ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
      const start = pullToward(from, bend, ARROW_INSET);
      const end   = pullToward(to, bend, ARROW_INSET);
      d = `M ${start.x} ${start.y} L ${bend.x} ${bend.y} L ${end.x} ${end.y}`;
    } else {
      const start = pullToward(from, to, ARROW_INSET);
      const end   = pullToward(to, from, ARROW_INSET);
      d = `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    }
    lastMoveArrowLine.setAttribute('d', d);
    lastMoveArrowLine.setAttribute('opacity', '1');
  }

  // Single place that ever touches .last-from/.last-to + the arrow, for
  // BOTH the real last move (render(), driven by game.history) and the
  // premove preview (onCellTap's isAITurn() branch below, which queues a
  // move while the AI thinks). Routing both through here is what keeps
  // them from drifting apart — a premove that only updated the gold
  // squares and left the arrow pointing at the previous real move (or
  // vice versa) is exactly the "arrow doesn't match the highlighted
  // squares" bug this fixes.
  function applyLastMoveHighlight(mv) {
    for (const c of cells) c.classList.remove('last-from', 'last-to');
    if (mv) {
      cells[gridSlot(mv.from.x, mv.from.y)]?.classList.add('last-from');
      cells[gridSlot(mv.to.x, mv.to.y)]?.classList.add('last-to');
    }
    updateLastMoveArrow(mv);
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
    // Same reasoning as applyPlayerLabels(): which side is called what
    // depends on the chosen piece theme, not a fixed ស/ខ្មៅ.
    const pieceColors = activePieceTheme(settings.pieceTheme).colors;
    const side = game.turn === COLORS.WHITE ? pieceColors.w.short : pieceColors.b.short;
    const st = game.status();
    if (st.state === 'checkmate') {
      const w = game.turn === COLORS.WHITE ? pieceColors.b.short : pieceColors.w.short;
      return `វេនខាង (${side}) · ${KH.checkmate} · ${w} ឈ្នះ`;
    }
    if (st.state === 'stalemate') return KH.stalemate;
    if (st.state === 'check')     return `វេនខាង (${side}) · ${KH.check}${whoSuffix(game.turn)}`;
    return `វេនខាង (${side})${whoSuffix(game.turn)}`;
  }

  /* ====== Result presentation (delayed celebration) ======
   * Architecture (this round): the GAME ENGINE already decides win/loss/
   * draw synchronously inside game.js's move() (game.winner is set before
   * this file ever sees the result) — nothing here ever decides who won.
   * All that's delayed is the VISUAL reveal: presentGameResult() is the
   * one authoritative entry point every ending path calls (checkmate/
   * stalemate/counting locally, and the online finished-game branch);
   * it guards against being shown twice (`resultShown`), stages the
   * checkmate glow/sound/haptic + WIN particles + card reveal through a
   * short setTimeout chain when Animation is on, and collapses to an
   * immediate reveal (sound/haptic still firing) when it's off. Every
   * scheduled step re-checks `resultGen` so a Reset/Undo that fires mid-
   * sequence safely drops whatever was still pending (section 21/23/30 of
   * this round's spec) instead of showing a stale result over a fresh
   * board, or leaking a timer/particle past it.
   */
  let resultShown = false;
  let resultGen = 0;
  let resultTimers = [];
  function clearResultTimers() {
    for (const id of resultTimers) clearTimeout(id);
    resultTimers = [];
  }
  function scheduleResult(fn, delay) {
    const id = setTimeout(fn, delay);
    resultTimers.push(id);
    return id;
  }
  // Called by New Game / Undo — the only two controls that can touch an
  // already-finished game — so a pending or already-shown celebration
  // never lingers into whatever comes next.
  function resetResultPresentation() {
    resultGen++;
    clearResultTimers();
    resultShown = false;
    clearParticles();
    const overlay = document.getElementById('flashOverlay');
    overlay?.classList.remove('show');
    overlay?.setAttribute('aria-hidden', 'true');
  }

  // Small, already-computed data only — never a new statistic. `opponent`
  // is omitted (row hidden) for friend mode, which has no single opponent.
  function buildSummary(opponent) {
    const elapsedMs = Date.now() - gameStartedAt;
    return {
      opponent: opponent || null,
      moves: game.history.length,
      timeText: clocks.format(elapsedMs).replace(/\.\d$/, ''),
    };
  }

  // Turns a {result, reason, opponentName, extra} payload (spec section 20)
  // into the localized copy + icon showEndFlash() actually renders. Pure —
  // reads only what's handed to it, never game/counting state directly, so
  // it's still correct even if called from a scheduled callback after the
  // board has already moved on.
  function buildResultPresentation({ result, reason, opponentName, extra }) {
    const type = result === 'WIN' ? 'win' : result === 'LOSS' ? 'lose' : 'draw';
    let title = extra?.titleOverride;
    let sub = extra?.descOverride;
    let reasonText = '';

    if (result === 'DRAW_COUNTING') {
      title = title || t('result.drawCounting');
      sub = sub || t('result.drawCountingDesc');
      const c = extra?.counting;
      if (c && c.type !== 'BARE_KINGS' && c.limit > 0) {
        reasonText = t('result.countFinal', { current: c.current, limit: c.limit });
      }
    } else if (result === 'DRAW') {
      title = title || t('result.draw');
      sub = sub || t('result.drawDesc');
      if (reason === 'STALEMATE') reasonText = '';
    } else if (result === 'WIN') {
      title = title || t('result.win');
      sub = sub || (opponentName ? t('result.winDesc', { opponent: opponentName }) : '');
      if (reason === 'CHECKMATE') reasonText = t('result.checkmate');
    } else { // LOSS
      title = title || t('result.loss');
      sub = sub || (opponentName ? t('result.lossDesc', { opponent: opponentName }) : '');
      if (reason === 'CHECKMATE') reasonText = t('result.checkmate');
      else if (reason === 'RESIGNATION') reasonText = t('result.resignation');
    }

    return { type, title, sub, reason: reasonText, summary: extra?.summary || null };
  }

  // The single authoritative entry point for ending a game's presentation
  // (spec section 20/21). `result`/`reason` use the plain-string API the
  // spec itself proposes (WIN/LOSS/DRAW/DRAW_COUNTING, CHECKMATE/
  // STALEMATE/COUNTING/RESIGNATION) — deliberately NOT game.js's own
  // lowercase 'w'/'b'/'draw' winner values, so this presentation-layer
  // vocabulary can never be confused with (or accidentally fed back into)
  // the engine's own authoritative state.
  function presentGameResult({ result, reason, opponentName, extra } = {}) {
    if (resultShown) return; // one authoritative presentation per game — never duplicate (section 21)
    resultShown = true;
    const myGen = resultGen;
    const opts = buildResultPresentation({ result, reason, opponentName, extra });

    if (!isAnimationEnabled()) {
      // Animation OFF: no transitions, no particles — but Sound/Haptic are
      // independent settings and must still fire (section 2/17).
      if (reason === 'CHECKMATE') { beeper.check(); triggerHaptic('checkmate'); }
      showEndFlash(opts);
      return;
    }

    // Animation ON — final move animation (~260ms, matches the existing
    // move-animation lock) already played before this was even called;
    // stage the rest: checkmate glow/sound/haptic -> celebration
    // (particles start here for WIN) -> card reveal, landing the card at
    // ~700-1000ms after the final move as the spec asks.
    const settleMs = 260;
    const checkmateMs = reason === 'CHECKMATE' ? 400 : 200;
    const celebrateMs = 250;

    if (reason === 'CHECKMATE') {
      scheduleResult(() => {
        if (myGen !== resultGen) return;
        beeper.check();
        triggerHaptic('checkmate');
      }, settleMs);
    }
    scheduleResult(() => {
      if (myGen !== resultGen) return;
      if (result === 'WIN') spawnCelebrationParticles();
    }, settleMs + checkmateMs);
    scheduleResult(() => {
      if (myGen !== resultGen) return;
      showEndFlash(opts);
    }, settleMs + checkmateMs + celebrateMs);
  }

  // One js/history.js entry per real completed game — called only from the
  // checkmate/stalemate branches below, never on Reset/Undo.
  function recordGameEnd(kind, matedColor) {
    const mode = settings.aiEnabled ? 'ai' : 'friend';
    let result;
    if (kind === 'stalemate' || kind === 'counting') {
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
  function concludeIfOver(res) {
    const status = res?.status;
    if (status?.state === 'checkmate') {
      const result = recordGameEnd('checkmate', status.toMove);
      const winnerColor = status.toMove === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
      if (settings.aiEnabled) {
        const humanWon = winnerColor !== settings.aiColor;
        presentGameResult({
          result: humanWon ? 'WIN' : 'LOSS',
          reason: 'CHECKMATE',
          opponentName: 'Master (AI)',
          extra: { summary: buildSummary('Master (AI)') },
        });
      } else {
        // Friend mode: two local humans passing one device — there's no
        // single "the player" to show a personalized WIN/LOSS for, so this
        // keeps the existing side-based win announcement, just through the
        // same new timing/celebration pipeline as every other ending.
        const pieceColors = activePieceTheme(settings.pieceTheme).colors;
        const sideTxt = winnerColor === COLORS.WHITE ? pieceColors.w.short : pieceColors.b.short;
        presentGameResult({
          result: 'WIN',
          reason: 'CHECKMATE',
          extra: {
            titleOverride: `ខាង${sideTxt}ឈ្នះ!`,
            descOverride: 'ល្បែងត្រូវបញ្ចប់។',
            summary: buildSummary('Local Friend'),
          },
        });
      }
      handleTournamentEnd(result);
      return true;
    }
    if (status?.state === 'stalemate') {
      const result = recordGameEnd('stalemate', null);
      presentGameResult({ result: 'DRAW', reason: 'STALEMATE', extra: { summary: buildSummary() } });
      handleTournamentEnd(result);
      return true;
    }
    // Counting Draw ("រាប់ស្មើ") — checkmate/stalemate above are checked
    // FIRST and always win the priority order (Part 10): a checkmate
    // delivered on the very last allowed counted move is only ever
    // reached via the branches above, never this one, because game.js's
    // own move() only ever sets counting.result to 'draw' when the game
    // is NOT already over some other way.
    if (res?.counting?.result === 'draw') {
      const result = recordGameEnd('counting', null);
      presentGameResult({
        result: 'DRAW_COUNTING',
        reason: 'COUNTING',
        extra: { counting: { ...res.counting }, summary: buildSummary() },
      });
      handleTournamentEnd(result);
      return true;
    }
    return false;
  }

  /* ====== render with animations ====== */
  // Centralized check/checkmate king-square highlight — computed straight
  // from the authoritative game engine's own status() (never from any
  // animation/UI state, per this round's "animation is presentation-only"
  // rule), so it's correct for every path that calls render(): human tap,
  // drag-drop, AI, online polling, reset, and undo alike.
  function applyCheckHighlight() {
    for (const c of cells) c.classList.remove('in-check', 'in-check-mate');
    const st = game.status();
    if (st.state !== 'check' && st.state !== 'checkmate') return;
    const k = game.findKing(st.toMove);
    if (!k) return;
    const cell = cells[gridSlot(k.x, k.y)];
    cell?.classList.add(st.state === 'checkmate' ? 'in-check-mate' : 'in-check');
  }

  // Counting Draw UI ("រាប់ស្មើ") — reads game.counting directly (the
  // engine's own authoritative state, updated inside game.js's move()) and
  // never computes eligibility/progress itself, per this feature's central
  // architecture rule. The progress bar/badge/pulse markup already existed
  // in play.html/styles.css (built, then never wired up) — reused as-is.
  function renderCounting() {
    const label = document.getElementById('count-label');
    const bar = document.getElementById('count-bar');
    if (!label || !bar) return;

    const c = game.counting;
    // BARE_KINGS is an immediate draw with no "progress" to show — the
    // end-flash overlay covers it; a countdown bar here would be
    // meaningless for it (limit is 0).
    if (!c || !c.active || c.type === 'BARE_KINGS') {
      label.style.display = 'none';
      bar.style.display = 'none';
      return;
    }

    const animate = isAnimationEnabled();
    const text = `${c.current} / ${c.limit}`;
    const numberEl = document.getElementById('count-number');
    const badgeEl = document.getElementById('count-badge');
    if (numberEl) numberEl.textContent = text;
    if (badgeEl) badgeEl.textContent = text;

    const prefixEl = document.getElementById('count-label-prefix');
    if (prefixEl) {
      const key = c.type === 'BOARD' ? 'counting.board' : 'counting.piece';
      prefixEl.setAttribute('data-i18n', key);
      prefixEl.textContent = t(key);
    }

    label.style.display = '';
    bar.style.display = '';

    const barFill = document.getElementById('count-bar-fill');
    if (barFill) {
      barFill.style.width = Math.min(100, Math.round((c.current / c.limit) * 100)) + '%';
      // Part 15: remaining<=2 is a warning, remaining<=1 is the strong
      // warning — the warning COLOR is game-state information and always
      // shown; only the continuous pulse/shake animations are decorative
      // and skipped when Animation is off.
      barFill.classList.toggle('low', c.remaining <= 2);
    }
    bar.classList.toggle('urgent', c.remaining <= 1 && animate);
    label.classList.toggle('pulse', c.remaining <= 2 && animate);
  }

  function render() {
    const animate = isAnimationEnabled();
    for (const c of cells) {
      c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture','last-move-pulse');
    }

    const last = game.history[game.history.length - 1];
    // Real on-screen cell size, so the slide-in travels the piece's actual
    // move distance instead of a fixed small offset — a 12px nudge read as
    // an instant snap regardless of how far the piece actually moved,
    // which is what made every move look too fast.
    const cellPx = animate ? (cells[0]?.getBoundingClientRect().width || 44) : 0;

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = game.at(x, y);
        const isMoveDest = !!(last && last.to.x === x && last.to.y === y && animate);
        const key = p ? p.c + p.t : null;
        // Skip squares whose piece hasn't actually changed since last
        // render — recreating a `.piece` div means a fresh background-image
        // for the browser to paint, and doing that for all 64 squares on
        // every single move (most of which didn't change at all) is what
        // made real devices visibly struggle to paint the board in time
        // for the move that DID happen to even show up.
        if (key === renderedPiece[y][x] && !isMoveDest) continue;
        renderedPiece[y][x] = key;

        const cell = cells[gridSlot(x, y)];
        cell.innerHTML = '';
        if (!p) continue;

        const s = document.createElement('div');
        s.className = `piece ${p.c === 'w' ? 'white' : 'black'}`;
        setPieceBG(s, p);
        cell.appendChild(s);

        // Driven by the Web Animations API (element.animate()) rather than
        // a CSS class carrying an `animation`, and started only AFTER the
        // piece is already in the DOM — a CSS animation-on-insert (the
        // previous approach) raced WebKit's own compositor-layer setup for
        // that brand-new element on real iOS: the piece stayed invisible
        // for a chunk of the slide, only painting once it was already
        // mostly (or fully) there. Explicitly constructing the animation
        // via JS forces the engine to commit the element's normal paint
        // first, so it's visible while it travels instead of popping in
        // partway through. Skipped entirely — the piece just appears in
        // place — whenever Animation is OFF, either by the user's own
        // Settings toggle or the OS's prefers-reduced-motion (isMoveDest
        // is only ever true when `animate` is also true).
        if (isMoveDest){
          // flip the animation direction too, so the slide-in matches the
          // piece's actual on-screen movement rather than its raw board delta
          const sign = flipped ? -1 : 1;
          const dx = sign * (last.from.x - last.to.x) * cellPx;
          const dy = sign * (last.from.y - last.to.y) * cellPx;
          const SLIDE_MS = 260;
          // Every `.cell` is its own stacking context (position:relative +
          // z-index:1), so a piece translated across a NEIGHBORING cell
          // during the slide paints behind that cell whenever it comes
          // later in DOM order (i.e. whenever the move's direction happens
          // to travel toward an earlier-painted cell) — the piece visibly
          // slides "under the board" and only reappears on top once it
          // settles back into its own cell. Lifting the piece's own cell
          // above every other cell for the moment it's animating fixes
          // this regardless of which direction the move travels.
          cell.classList.add('cell-sliding');
          // Every piece — knights included — glides in a plain straight
          // line; no separate bounce/scale treatment for knights (matches
          // the reference: a knight move reads as the same smooth slide as
          // any other piece, not a distinct "hop"). Plain 'ease-out' here,
          // not the previous steep custom curve (cubic-bezier(.25,.8,.35,1)
          // reaches ~80% of the distance in the first quarter of the
          // duration) — that front-loading made the slide read as an
          // instant snap with a barely-visible tail, even though it was
          // technically animating the whole time.
          const slideAnim = s.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }],
            { duration: SLIDE_MS, easing: 'ease-out', fill: 'both' }
          );
          // Last-move pulse (item 4: "let the piece move, THEN briefly
          // pulse the destination square") is chained off this same
          // .finished promise rather than a fixed CSS animation-delay,
          // so it stays exactly in sync with the slide even if the
          // browser throttles/pauses it (backgrounded tab, etc.).
          slideAnim.finished.then(() => {
            cell.classList.remove('cell-sliding');
            cell.classList.add('last-move-pulse');
          }).catch(() => {});
          // Promotion pop layers on top of the slide that just carried the
          // pawn to this square, timed to start right as the slide finishes.
          if (last.promo) {
            s.animate(
              [
                { transform: 'scale(.7)', filter: 'drop-shadow(0 0 0 rgba(255,214,64,0))' },
                { transform: 'scale(1.12)', filter: 'drop-shadow(0 0 10px rgba(255,214,64,.85))', offset: 0.55 },
                { transform: 'scale(1)', filter: 'drop-shadow(0 0 0 rgba(255,214,64,0))' },
              ],
              { duration: 320, easing: 'ease-out', delay: SLIDE_MS, fill: 'both' }
            );
          }
        }
      }
    }

    applyLastMoveHighlight(last);
    if (last?.captured && animate){
      const toIdx = gridSlot(last.to.x, last.to.y);
      cells[toIdx]?.classList.add('last-capture');
      const rp = document.createElement('div'); rp.className = 'capture-ripple';
      cells[toIdx]?.appendChild(rp); setTimeout(()=> rp.remove(), 350);
    }

    applyCheckHighlight();
    renderCounting();
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
  // `skipVisualReplay` — true only when this call is confirming a move the
  // mover already applied optimistically in onOnlineCellTap() below (same
  // from/to as what the server just echoed back): the board already shows
  // it and was already animated/beeped once, so render()/sound/haptic are
  // skipped here to avoid replaying the slide animation a second time for
  // a position that hasn't actually changed. Every other call site (the
  // 3000ms→1000ms opponent-move poll, and the post-error re-sync in
  // attemptOnlineMove) omits it and gets the normal full replay.
  function applyOnlineGameState(g, { skipVisualReplay = false } = {}) {
    const prevUpdatedAt = onlineState?.updatedAt;
    onlineState = g;
    game.board = g.board;
    game.turn = g.turn;
    // Counting Draw is server-authoritative for online games too (see
    // src/routes/games.js) — mirror it directly rather than recomputing
    // locally, so both players always see the exact same count.
    game.counting = g.counting || emptyCounting();
    game.history = [];
    if (g.history?.length) {
      const lastMove = g.history[g.history.length - 1];
      game.history = [{ from: lastMove.from, to: lastMove.to, captured: !!lastMove.captured, promo: !!lastMove.promo }];
    }
    // Server-authoritative, same reasoning as `counting` above — the
    // truncated `game.history` here (last move only) can't be used to
    // derive this, so it's computed from the server's full move history
    // instead (also gates showHints()'s King/Neang special-move dots for
    // an online game, so those correctly stop appearing the moment either
    // player's client sees a capture in the shared history).
    game.captureOccurred = !!g.history?.some(h => h.captured);

    if (g.status === 'active') {
      renderOnlineBanner();
      if (!skipVisualReplay) render();
      setBoardBusy(!g.myTurn);
    } else if (g.status === 'pending') {
      renderOnlineBanner();
    }

    if (g.status === 'finished' && !onlineFinished) {
      onlineFinished = true;
      stopOnlinePolling();
      setBoardBusy(false);
      if (!skipVisualReplay) render();
      const myWon = (g.result === 'white' && g.myColor === 'w') || (g.result === 'black' && g.myColor === 'b');
      const isDraw = g.result === 'draw';
      // Online games carry no explicit "why did it end" field, but it's
      // fully derivable from data already mirrored above: a draw with
      // counting.result==='draw' is a Counting Draw (never a stalemate,
      // since game.js's own priority order — mirrored server-side too —
      // never lets counting fire on a stalemate); any win/loss where the
      // shared engine's own status() reads 'checkmate' on this final
      // board was a real mate, otherwise it was a resignation.
      const st = game.status();
      let result, reason;
      if (isDraw) {
        const isCounting = g.counting?.result === 'draw' && g.counting.type !== 'BARE_KINGS';
        result = isCounting ? 'DRAW_COUNTING' : 'DRAW';
        reason = isCounting ? 'COUNTING' : 'STALEMATE';
      } else {
        result = myWon ? 'WIN' : 'LOSS';
        reason = st.state === 'checkmate' ? 'CHECKMATE' : 'RESIGNATION';
      }
      presentGameResult({
        result, reason,
        opponentName: g.opponentName,
        extra: { counting: g.counting, summary: buildSummary(g.opponentName) },
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
    } else if (!skipVisualReplay && prevUpdatedAt !== g.updatedAt && g.history?.length) {
      // Sound and Haptic are independent settings — each is gated by its
      // own toggle, never by the other (beeper.* already checks
      // beeper.enabled internally; triggerHaptic() checks isHapticEnabled()).
      const last = g.history[g.history.length - 1];
      if (last.captured) beeper.capture(); else beeper.move();
      triggerHaptic(last.captured ? 'capture' : 'move');
      if (last.promo) { beeper.promotion(); triggerHaptic('promotion'); }
      // game.board/turn already mirror server truth above, so the shared
      // engine's own status() is authoritative here too, exactly as it is
      // for local/AI moves — never inferred from animation state. A real
      // game-ending checkmate is handled by the `g.status === 'finished'`
      // branch above instead (this branch only ever sees an ongoing game).
      const st = game.status();
      if (st.state === 'check') { beeper.check(); triggerHaptic('check'); }
      applyCountingFeedback(g.counting);
    }
  }

  async function attemptOnlineMove(from, to) {
    setBoardBusy(true);
    try {
      const { game: g } = await Api.makeGameMove(onlineGameId, from, to);
      // If the server echoes back exactly the move we already applied
      // optimistically in onOnlineCellTap(), the board is already showing
      // it (and already got its sound/haptic/animation) — skip replaying
      // that visually. Any other outcome (shouldn't normally happen, since
      // both sides run the same rules engine, but covers edge cases like a
      // promotion choice mismatch) falls back to the normal full replay.
      const last = g.history?.[g.history.length - 1];
      const confirmsOptimistic = !!last
        && last.from.x === from.x && last.from.y === from.y
        && last.to.x === to.x && last.to.y === to.y;
      applyOnlineGameState(g, { skipVisualReplay: confirmsOptimistic });
    } catch (err) {
      beeper.error(); triggerHaptic('error');
      if (err.status !== 400 && err.status !== 409) showToast(err.message || 'Move failed', 'error');
      // Roll back the optimistic local move: re-sync from the server's
      // authoritative state, since the client's guess (board/turn/counting)
      // may now be wrong — e.g. the opponent's move landed first and this
      // one was rejected as out of turn.
      try {
        const { game: g } = await Api.getGame(onlineGameId);
        applyOnlineGameState(g);
      } catch {
        setBoardBusy(!onlineState.myTurn);
      }
    }
  }

  function onOnlineCellTap(e) {
    if (!onlineState || onlineState.status !== 'active' || !onlineState.myTurn) { beeper.error(); return; }
    const x = +e.currentTarget.dataset.x;
    const y = +e.currentTarget.dataset.y;
    const p = game.at(x, y);

    if (p && p.c === onlineState.myColor) {
      selected = { x, y }; showHints(x, y);
      beeper.select(); triggerHaptic('select');
      return;
    }
    if (!selected) { beeper.error(); triggerHaptic('error'); flashIllegal(x, y); return; }
    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok) {
      selected = null; legal = []; clearHints();
      beeper.error(); triggerHaptic('error'); flashIllegal(x, y); return;
    }
    const from = { ...selected }, to = { x, y };
    selected = null; legal = []; clearHints();

    // Optimistic update (online-friend latency audit, Phase 2): apply the
    // move locally right away with the same shared rules engine used for
    // legal-move hints (game.js, kept in sync with the server's
    // gameEngine.js), instead of waiting on the full network round trip
    // to see it. The server call below remains authoritative — on success
    // this just gets silently confirmed (see attemptOnlineMove), and on
    // failure it gets rolled back by re-syncing from the server.
    const optimistic = game.move(from, to);
    if (optimistic.ok) {
      render();
      if (optimistic.captured) beeper.capture(); else beeper.move();
      triggerHaptic(optimistic.captured ? 'capture' : 'move');
      if (optimistic.promo) { beeper.promotion(); triggerHaptic('promotion'); }
      if (optimistic.status?.state === 'check') { beeper.check(); triggerHaptic('check'); }
      applyCountingFeedback(optimistic.counting);
    }
    attemptOnlineMove(from, to);
  }

  // 1000ms (was 3000ms) — the online-friend performance audit measured
  // this interval as the dominant source of "feels slow" for the
  // receiving player: at a flat N-ms interval, average opponent-move
  // detection latency is ~N/2 and worst case is N, regardless of how fast
  // the network/backend/DB actually are. 1000ms trades roughly 3x the
  // poll request volume for cutting that average from ~1500ms to ~500ms
  // and the worst case from 3000ms to 1000ms.
  const ONLINE_POLL_MS = 1000;

  function startOnlinePolling() {
    onlinePollHandle = setInterval(async () => {
      if (onlineFinished || document.hidden) return;
      try {
        const { game: g } = await Api.getGame(onlineGameId);
        if (g.updatedAt !== onlineState.updatedAt || g.status !== onlineState.status) applyOnlineGameState(g);
      } catch { /* transient — try again next tick */ }
    }, ONLINE_POLL_MS);
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
        const { messages } = await Api.getMessages(opponentId);
        for (const m of messages) appendMsg(m);
        msgsEl.scrollTop = msgsEl.scrollHeight;
        await Api.markThreadRead(opponentId);
      } catch { /* chat is a bonus feature here — a failed load shouldn't block the game */ }
    }

    async function poll() {
      try {
        const { messages } = await Api.getMessages(opponentId, { since: lastTs });
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

        applyMoveFeedback(res2, { captured: !!before2 });

        clocks.switchedByMove(prev2);
        render(); saveGameState(game, clocks);

        concludeIfOver(res2);
        return;
      }

      applyMoveFeedback(res, { captured: !!before });

      clocks.switchedByMove(prevTurn);
      render(); saveGameState(game, clocks);

      concludeIfOver(res);

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

  // Clears both the click-based hint classes AND the drag-based ones
  // ('drag-legal'/'drag-target') — local (non-online) play runs the
  // click/tap-to-move handler (onCellTap/showHints) and the pointer-based
  // drag-and-drop handler (startDrag/endDrag) side by side on the same
  // cells, so a selection made through EITHER path must wipe whatever the
  // OTHER path left behind, or the two pieces' legal-move sets stay
  // visible at once (see startDrag()'s own call to this).
  const clearHints = () => {
    for (const c of cells) c.classList.remove('selected','hint-move','hint-capture','drag-legal','drag-target');
  };

  const hintsEnabled = () => settings.hints !== false;

  // Briefly blocks new input while a move's animation is visually still
  // running, so a fast double-tap can't select another piece or fire a
  // second move before the first one has settled (item 24). A no-op —
  // input is never delayed — when Animation is off.
  let animLock = false;
  function lockForAnimation() {
    if (!isAnimationEnabled()) return;
    animLock = true;
    setTimeout(() => { animLock = false; }, 320); // covers the slide + promo-pop
  }

  // Short shake/reject cue for an illegal-move attempt (item 18) — the
  // board/game state is never touched by this, purely visual+audible+haptic
  // feedback on the square the player tried to move to.
  function flashIllegal(x, y) {
    const cell = cells[gridSlot(x, y)];
    if (!cell) return;
    cell.classList.remove('reject-shake');
    void cell.offsetWidth; // restart the animation if retapped rapidly
    cell.classList.add('reject-shake');
    setTimeout(() => cell.classList.remove('reject-shake'), 260);
  }

  // Counting Draw feedback — reads game.js's own authoritative counting
  // state (res.counting, straight off the same move() call that computed
  // check/checkmate) and never re-derives eligibility/progress itself.
  // The Auto Draw case plays no extra sound/haptic of its own here — that
  // is the existing draw sound/haptic already fired by showEndFlash() via
  // concludeIfOver(), so this never doubles up on the same event.
  function applyCountingFeedback(counting) {
    if (!counting || !counting.active || counting.result === 'draw') return;
    if (counting.justStarted) {
      beeper.countStart();
      triggerHaptic('countStart');
    } else if (counting.justIncremented) {
      // "Final 1-2 moves" warning window — matches the visual .low
      // threshold in renderCounting() below, so sound/haptic/color all
      // agree on when the count is running out.
      if (counting.remaining <= 2) { beeper.countWarning(); triggerHaptic('countWarning'); }
      else { beeper.count(); triggerHaptic('count'); }
    }
  }

  // Single centralized feedback path for every move that actually lands —
  // human tap, drag-drop, and AI (both the primary engine move and its
  // random-fallback) alike, so Sound/Haptic/check-detection behavior can
  // never drift between the human and AI paths (item 5/19). Sound and
  // Haptic are each gated only by their own setting (beeper.* already
  // checks beeper.enabled internally; triggerHaptic() checks
  // isHapticEnabled()) — never by each other or by Animation. Check is
  // read straight off res.status, which game.move() itself already
  // computed from the authoritative engine — never inferred from any
  // animation state. Checkmate's own sound/haptic are deliberately NOT
  // fired here — presentGameResult() (called moments later via
  // concludeIfOver) fires them itself, timed to land with the checkmate
  // glow/celebration instead of instantly at move-time, so this round's
  // delayed-presentation feature never doubles that feedback up.
  function applyMoveFeedback(res, { captured }) {
    if (captured) { beeper.capture(); triggerHaptic('capture'); }
    else { beeper.move(); triggerHaptic('move'); }
    if (res.promo) { beeper.promotion(); triggerHaptic('promotion'); }
    if (res.status?.state === 'check') { beeper.check(); triggerHaptic('check'); }
    applyCountingFeedback(res.counting);
    lockForAnimation();
  }

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
    if (animLock) return; // an animation is still visually settling
    if (game.winner) return; // game already over (checkmate/stalemate/Counting Draw) — input locked
    const x = +e.currentTarget.dataset.x;
    const y = +e.currentTarget.dataset.y;
    const p = game.at(x, y);

    // If AI turn → allow premove selection for the human's own color
    if (isAITurn() || AILock) {
      if (p && p.c === humanColor()){
        if (!selected){
          selected = {x,y}; showHints(x,y);
          // Picking a NEW piece to premove (after already queuing a
          // different one) previously left the OLD premove's gold
          // squares on the board, stale and unrelated to whatever gets
          // queued next. Reset back to the real last move first — a
          // completed premove below re-applies its own highlight right
          // over this, so there's nothing to undo in the normal case.
          applyLastMoveHighlight(game.history[game.history.length - 1]);
          beeper.select(); triggerHaptic('select'); return;
        }
        const ok = legal.some(m => m.x===x && m.y===y);
        if (ok){
          premove = { from:{...selected}, to:{x,y} };
          // Same shared helper render() uses for the real last move, so
          // the gold squares and the arrow can never drift apart here
          // either. render() overwrites this with the real AI move the
          // moment its reply actually lands.
          applyLastMoveHighlight(premove);
          beeper.select(); triggerHaptic('select');
        } else { beeper.error(); triggerHaptic('error'); flashIllegal(x, y); }
      } else { beeper.error(); triggerHaptic('error'); flashIllegal(x, y); }
      return;
    }

    // Select piece
    if (p && p.c === game.turn) {
      selected = { x, y }; showHints(x, y);
      beeper.select(); triggerHaptic('select'); return;
    }

    // No selection yet
    if (!selected) { beeper.error(); triggerHaptic('error'); flashIllegal(x, y); return; }

    // Check if target is legal
    const ok = legal.some(m => m.x === x && m.y === y);
    if (!ok) {
      selected = null; legal = []; clearHints();
      beeper.error(); triggerHaptic('error'); flashIllegal(x, y); return;
    }

    const from   = { ...selected };
    const to     = { x, y };
    const before = game.at(to.x, to.y);
    const prev   = game.turn;
    const res    = game.move(from, to);

    if (res.ok) {
      applyMoveFeedback(res, { captured: !!before });

      clocks.switchedByMove(prev);
      selected = null; legal = []; clearHints();
      render(); saveGameState(game, clocks);

      if (!concludeIfOver(res)) {
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
    // A prior click-based selection (onCellTap/showHints) may still have
    // 'hint-move'/'hint-capture' dots showing for a DIFFERENT piece —
    // without clearing them here, starting a drag on this piece just adds
    // its own 'drag-legal' dots on top, showing both pieces' legal moves
    // at once (visually "hints shown everywhere").
    clearHints();
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
    if (d?.ghost){ d.ghost.remove(); }
    if (!d) return;

    const dest = cellAtXY(px, py);

    // A release with no real movement (still on the origin square) is a
    // plain tap-to-select, not a move attempt — a piece's own square is
    // never one of its own legal destinations, so falling through to the
    // "illegal destination" branch below fired a spurious error beep/
    // haptic/shake on every single tap-to-select on touch devices,
    // immediately followed by the separate click-based tap-to-move
    // handler (onCellTap) correctly selecting the piece and playing its
    // own select sound right after — a jarring error-then-select double
    // cue for what the player experiences as one simple tap. The
    // 'selected'/'drag-legal' highlighting startDrag() already applied
    // is exactly right as-is, so just leave it alone.
    if (dest && dest.x === d.from.x && dest.y === d.from.y) return;

    for (const c of cells) c.classList.remove('drag-target','drag-legal','selected');
    if (!dest){ beeper.error(); triggerHaptic('error'); return; }
    const ok = d.legal.some(m => m.x===dest.x && m.y===dest.y);
    if (!ok){ beeper.error(); triggerHaptic('error'); flashIllegal(dest.x, dest.y); return; }

    const before = game.at(dest.x, dest.y);
    const prev   = game.turn;
    const res    = game.move(d.from, {x:dest.x, y:dest.y});
    if (!res?.ok){ beeper.error(); triggerHaptic('error'); flashIllegal(dest.x, dest.y); return; }

    applyMoveFeedback(res, { captured: !!before });
    clocks.switchedByMove(prev);
    render(); saveGameState(game, clocks);

    if (!concludeIfOver(res)) { thinkAndPlay(); }
  }

  // Only decides whether a REAL DRAG should start — it must never fire its
  // own error feedback for "no drag here", since the click-based tap-to-
  // move handler (onCellTap, registered on the very same cells further
  // below) already runs for every tap that doesn't start a drag and
  // already gives correct feedback for every case (premove select/error
  // during the AI's turn, select/error/move otherwise). Firing beeper.error()
  // here too used to double-beep error+correct-sound on nearly every tap
  // that wasn't the start of a drag on your own piece — including the
  // destination tap of a normal two-tap move and every premove-select tap
  // during the AI's turn — since a bare tap always fails the "is this
  // draggable" check even when onCellTap is about to handle it correctly.
  function onCellPointerDown(e){
    if (animLock) return; // an animation is still visually settling
    if (game.winner) return; // game already over (checkmate/stalemate/Counting Draw) — input locked
    if (isAITurn() || AILock) return; // premove selection is handled entirely by onCellTap
    const x = +e.currentTarget.dataset.x, y = +e.currentTarget.dataset.y;
    const p = game.at(x,y);
    if (!p || p.c !== game.turn) return; // not a draggable piece — let onCellTap process this tap instead
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
    game.board    = saved.board;
    game.turn     = saved.turn;
    game.history  = saved.history || [];
    game.counting = saved.counting || emptyCounting();
    // A save from before this field existed won't have it — derive it
    // from the (fully restored, for local games) history instead.
    game.captureOccurred = typeof saved.captureOccurred === 'boolean'
      ? saved.captureOccurred
      : game.history.some(h => h.captured);
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
    resetResultPresentation(); // New Game always clears any pending/shown celebration first
    game.reset();
    gameStartedAt = Date.now();
    selected = null; legal = []; premove = null; clearHints(); clearGameState();
    clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    if (isAITurn()) thinkAndPlay();
  });

  btnUndo?.addEventListener('click', () => {
    aiGen++; AI.resetAI?.(); setBoardBusy(false);
    resetResultPresentation(); // Undoing out of a just-finished game clears its celebration too
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
    if (s) {
      const key = wasRunning ? 'play.menu.resume' : 'play.menu.pause';
      s.setAttribute('data-i18n', key);
      s.textContent = t(key);
    }
  });

  window.addEventListener('beforeunload', () => saveGameState(game, clocks));

  initFullscreenButton();
  initPlayMenu();

  return game;
}

/* ---------------- fullscreen toggle ----------------
 * A page-level control, independent of game mode — deliberately outside
 * #localControls so it isn't hidden for online games. Not all browsers
 * support the Fullscreen API for arbitrary elements (notably iOS Safari,
 * which has none), so the button only ever appears when it can actually
 * do something; never break gameplay if the browser refuses. */
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
function isFullscreenSupported() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}
async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch { /* denied or unsupported at runtime — leave the page as-is */ }
}
async function exitFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch {}
}

function initFullscreenButton() {
  const btn = document.getElementById('btnFullscreen');
  if (!btn || !isFullscreenSupported()) return;
  btn.hidden = false;

  const enterIcon = document.getElementById('fsEnterIcon');
  const exitIcon  = document.getElementById('fsExitIcon');
  const label     = document.getElementById('fsLabel');

  function syncButton() {
    const active = !!fullscreenElement();
    const key = active ? 'play.menu.fullscreenExit' : 'play.menu.fullscreenEnter';
    if (enterIcon) enterIcon.hidden = active;
    if (exitIcon)  exitIcon.hidden  = !active;
    if (label) { label.setAttribute('data-i18n', key); label.textContent = t(key); }
    btn.title = t(key);
  }

  btn.addEventListener('click', () => {
    if (fullscreenElement()) exitFullscreen(); else enterFullscreen();
  });
  document.addEventListener('fullscreenchange', syncButton);
  document.addEventListener('webkitfullscreenchange', syncButton);
  syncButton();
}

/* ---------------- top-right "more" menu ----------------
 * Reset/Pause/Undo/Fullscreen live here now instead of their own button
 * rows — same open/close-on-outside-click/close-on-item-click pattern as
 * notifications.html's #notifMenu (see js/notifications-page.js). */
function initPlayMenu() {
  const menu = document.getElementById('playMenu');
  const list = document.getElementById('playMenuList');
  const btn  = document.getElementById('btnPlayMenu');
  if (!menu || !list || !btn) return;

  function closeMenu() { list.hidden = true; }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('button')) closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!list.hidden && !menu.contains(e.target)) closeMenu();
  });
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
