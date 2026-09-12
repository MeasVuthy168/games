// Settings controller
import { pieceThemes, boardThemes, pieceImageUrl } from './themes.js';
import { isThemeUnlocked, unlockTheme } from './theme-unlocks.js';
import { getCoins, canAfford, spendCoins } from './coins.js';
import { getProfile, applyAvatarToElement } from './profile-data.js';
import { setLanguage, applyTranslations } from './i18n.js';
import { MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL } from './ai-engine.js';
import { recordLoginToday } from './rewards.js';
import * as Api from './api.js';
import { notificationsEnabled, setNotificationsEnabled, refreshNotifBadge, requestPushPermission, disablePush } from './notif-badge.js';
import { showToast } from './toast.js';

recordLoginToday();

const LS_KEY = 'kc_settings_v1';
const THEME_KEY = 'kc_theme';
const DEFAULTS = {
  minutes: 10, increment: 5, sound: true, haptic: true, hints: true,
  aiLevel: DEFAULT_LEVEL, aiDebug: false,
  language: 'en', pieceTheme: 0, boardTheme: 0, animationEnabled: true
};

// About App Information
const APP_VERSION  = '1.0.3';
const APP_RELEASED = '2025-10-22';
const APP_DEV      = 'Meas Vuthy';
const APP_EMAIL    = 'measvuthy21@gmail.com';

/* ------------------------------ Helpers ------------------------------ */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    const merged = s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
    const lvl = parseInt(merged.aiLevel, 10);
    merged.aiLevel = (Number.isInteger(lvl) && lvl >= MIN_LEVEL && lvl <= MAX_LEVEL) ? lvl : DEFAULT_LEVEL;
    // Migrate the old (inverted) "instantMove" flag to the new
    // animationEnabled flag, once, without losing existing users'
    // preference — instantMove:true meant "skip the animation", i.e.
    // animationEnabled:false.
    if (s && typeof s.instantMove === 'boolean' && !('animationEnabled' in s)) {
      merged.animationEnabled = !s.instantMove;
    }
    delete merged.instantMove;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }

function getTheme(){ return localStorage.getItem(THEME_KEY) || 'auto'; }
function setTheme(v){
  localStorage.setItem(THEME_KEY, v);
  const root=document.documentElement;
  if(v==='dark') root.setAttribute('data-theme','dark');
  else if(v==='light') root.setAttribute('data-theme','light');
  else root.removeAttribute('data-theme');
}

/* ------------------------------ DOM Ready ------------------------------ */
document.addEventListener('DOMContentLoaded', ()=>{

  // Load settings + language first so applyTranslations() below is correct.
  let s = loadSettings();
  setLanguage(s.language);

  // Grandfather in whatever theme was already active before this device
  // had any purchase requirement — a theme that was free when picked must
  // never turn itself unselectable/locked out from under an existing
  // choice just because it now carries a price.
  const activePiece = pieceThemes[s.pieceTheme];
  if (activePiece && !isThemeUnlocked('piece', activePiece)) unlockTheme('piece', activePiece);
  const activeBoard = boardThemes[s.boardTheme];
  if (activeBoard && !isThemeUnlocked('board', activeBoard)) unlockTheme('board', activeBoard);

  // Profile bar preview — editing happens on profile.html. When signed in,
  // the real account's name/photo is the source of truth (kept in sync by
  // profile.js); signed out, this is the purely local guest profile.
  const profName = document.getElementById('profName');
  const profAvatar = document.getElementById('profAvatar');
  function renderProfileBar() {
    if (Api.isSignedIn()) {
      const u = Api.getCurrentUser();
      if (profName) profName.textContent = u?.displayName || 'Player';
      applyAvatarToElement(profAvatar, u?.avatarUrl ? { type: 'image', value: u.avatarUrl } : { type: 'emoji', value: u?.avatarEmoji || '🐯' });
    } else {
      const profile = getProfile();
      if (profName) profName.textContent = profile.name;
      applyAvatarToElement(profAvatar, profile.avatar);
    }
  }
  renderProfileBar();
  // This is a separate .html page, not a route in an SPA — navigating
  // "back" from profile.html after editing the avatar there often restores
  // this page from the browser's back/forward cache (bfcache) instead of
  // re-running this script, so it kept showing whatever avatar was current
  // when the page was first left. pageshow with event.persisted fires on
  // exactly that bfcache restore and nowhere else, so this only re-renders
  // when the stale-DOM situation can actually happen.
  window.addEventListener('pageshow', (e) => { if (e.persisted) renderProfileBar(); });

  // Elements
  const soundToggle = document.getElementById('soundToggle');
  const hapticToggle = document.getElementById('hapticToggle');
  const hintsToggle = document.getElementById('hintsToggle');
  const animationToggle = document.getElementById('animationToggle');
  const minutesInput = document.getElementById('minutesInput');
  const incInput = document.getElementById('incInput');
  const btnSaveTimer = document.getElementById('btnSaveTimer');
  const btnResetTimer = document.getElementById('btnResetTimer');
  const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));
  const languageRadios = Array.from(document.querySelectorAll('input[name="language"]'));
  const pieceThemeGrid = document.getElementById('pieceThemeGrid');
  const boardThemeGrid = document.getElementById('boardThemeGrid');
  const pieceThemeCoins = document.getElementById('pieceThemeCoins');
  const boardThemeCoins = document.getElementById('boardThemeCoins');

  // Shared coin-balance readout shown above both theme grids — kept in
  // sync after every purchase so "how many coins do I have" is answered
  // right where coins actually get spent.
  function renderThemeCoinBalances() {
    const text = `🪙 ${getCoins()}`;
    if (pieceThemeCoins) pieceThemeCoins.textContent = text;
    if (boardThemeCoins) boardThemeCoins.textContent = text;
  }

  // Shared unlock flow for both theme grids: locked + affordable asks for
  // confirmation and spends coins on accept; locked + unaffordable just
  // explains why. Returns true if the theme is unlocked and ready to select
  // (either it already was, or the purchase just succeeded).
  function tryUnlock(kind, theme) {
    if (isThemeUnlocked(kind, theme)) return true;
    const price = theme.price;
    if (!canAfford(price)) {
      showToast(`Not enough coins — ${theme.name} costs ${price}, you have ${getCoins()}.`, 'error');
      return false;
    }
    if (!confirm(`Unlock ${theme.name} for ${price} coins?`)) return false;
    if (!spendCoins(price)) {
      showToast('Not enough coins.', 'error');
      return false;
    }
    unlockTheme(kind, theme);
    showToast(`${theme.name} unlocked!`, 'success');
    renderThemeCoinBalances();
    return true;
  }

  // Init UI states
  soundToggle.checked = !!s.sound;
  if (hapticToggle) hapticToggle.checked = s.haptic !== false;
  hintsToggle.checked = s.hints !== false;
  if (animationToggle) animationToggle.checked = s.animationEnabled !== false;
  minutesInput.value  = s.minutes;
  incInput.value      = s.increment;
  (themeRadios.find(r=>r.value===getTheme())||themeRadios[0]).checked = true;
  (languageRadios.find(r=>r.value===s.language)||languageRadios[0]).checked = true;

  // Piece theme: a tappable grid of swatches (each a small side-by-side
  // preview of that theme's own King artwork, light + dark) instead of a
  // blind Prev/Next cycle — rebuilt from js/themes.js's pieceThemes on
  // every render so a theme added there needs no markup changes here.
  function renderPieceThemeGrid(){
    if (!pieceThemeGrid) return;
    pieceThemeGrid.innerHTML = '';
    pieceThemes.forEach((theme, idx) => {
      const unlocked = isThemeUnlocked('piece', theme);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'piece-theme-choice'
        + (s.pieceTheme === idx ? ' selected' : '')
        + (unlocked ? '' : ' locked');

      const swatch = document.createElement('div');
      swatch.className = 'piece-theme-swatch';
      for (const color of ['w', 'b']) {
        const span = document.createElement('span');
        span.style.backgroundImage = `url("${pieceImageUrl(theme, color, 'K')}")`;
        swatch.appendChild(span);
      }

      const label = document.createElement('div');
      label.className = 'piece-theme-choice-name';
      label.textContent = theme.name;

      btn.appendChild(swatch);
      btn.appendChild(label);
      if (!unlocked) {
        const price = document.createElement('div');
        price.className = 'theme-choice-price';
        price.textContent = `🔒 ${theme.price}`;
        btn.appendChild(price);
      }
      btn.addEventListener('click', () => {
        if (!tryUnlock('piece', theme)) return;
        if (s.pieceTheme === idx) return;
        s.pieceTheme = idx;
        saveSettings(s);
        renderPieceThemeGrid();
      });
      pieceThemeGrid.appendChild(btn);
    });
  }
  renderPieceThemeGrid();

  // Board theme: a tappable grid of swatches (each a small 2x2 checkerboard
  // built from that theme's own light/dark tile images) instead of a blind
  // Prev/Next cycle — rebuilt from js/themes.js's boardThemes on every
  // render so a theme added there needs no markup changes here.
  function renderBoardThemeGrid(){
    if (!boardThemeGrid) return;
    boardThemeGrid.innerHTML = '';
    boardThemes.forEach((theme, idx) => {
      const unlocked = isThemeUnlocked('board', theme);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'board-theme-choice'
        + (s.boardTheme === idx ? ' selected' : '')
        + (unlocked ? '' : ' locked');

      const swatch = document.createElement('div');
      swatch.className = 'board-theme-swatch';
      for (let cell = 0; cell < 4; cell++) {
        const span = document.createElement('span');
        const isLight = cell === 0 || cell === 3; // alternating checker pattern
        span.style.backgroundImage = `url("${isLight ? theme.light : theme.dark}")`;
        swatch.appendChild(span);
      }

      const label = document.createElement('div');
      label.className = 'board-theme-choice-name';
      label.textContent = theme.name;

      btn.appendChild(swatch);
      btn.appendChild(label);
      if (!unlocked) {
        const price = document.createElement('div');
        price.className = 'theme-choice-price';
        price.textContent = `🔒 ${theme.price}`;
        btn.appendChild(price);
      }
      btn.addEventListener('click', () => {
        if (!tryUnlock('board', theme)) return;
        if (s.boardTheme === idx) return;
        s.boardTheme = idx;
        saveSettings(s);
        renderBoardThemeGrid();
      });
      boardThemeGrid.appendChild(btn);
    });
  }
  renderBoardThemeGrid();
  renderThemeCoinBalances();

  // Event bindings
  soundToggle.addEventListener('change', ()=>{ s.sound=!!soundToggle.checked; saveSettings(s); });
  hapticToggle?.addEventListener('change', ()=>{ s.haptic=!!hapticToggle.checked; saveSettings(s); });
  hintsToggle.addEventListener('change', ()=>{ s.hints=!!hintsToggle.checked; saveSettings(s); });
  animationToggle?.addEventListener('change', ()=>{ s.animationEnabled=!!animationToggle.checked; saveSettings(s); });

  languageRadios.forEach(r =>
    r.addEventListener('change', ()=>{
      if(!r.checked) return;
      s.language = r.value; saveSettings(s);
      setLanguage(s.language);
      applyTranslations();
    })
  );

  btnSaveTimer.addEventListener('click', ()=>{
    const m = Math.max(1, Math.min(180, parseInt(minutesInput.value||'10',10)));
    const inc = Math.max(0, Math.min(60, parseInt(incInput.value||'5',10)));
    s.minutes=m; s.increment=inc; saveSettings(s);
    showToast('Saved. New games will use these timer settings.', 'success');
  });

  btnResetTimer.addEventListener('click', ()=>{
    minutesInput.value = DEFAULTS.minutes;
    incInput.value = DEFAULTS.increment;
  });

  themeRadios.forEach(r=>
    r.addEventListener('change', ()=>{ if(r.checked) setTheme(r.value); })
  );

  /* ------------------------------ About Modal ------------------------------ */
  const aboutModal = document.getElementById('aboutModal');
  const setModal = (show) => {
    show ? aboutModal.classList.add('show') : aboutModal.classList.remove('show');
  };

  const btnAbout = document.getElementById('btnAbout');
  if (btnAbout){
    btnAbout.addEventListener('click', ()=>{
      document.getElementById('aboutVersion').textContent  = `v${APP_VERSION}`;
      document.getElementById('aboutReleased').textContent = APP_RELEASED;
      setModal(true);
    });
  }

  // Hidden developer-mode affordance: 5 taps on the version line within 3s
  // reveals a link to the AI-vs-AI engine test page. Never shown in normal
  // navigation — see ai-vs-ai.html's own ?dev=1 gate.
  const aboutVersion = document.getElementById('aboutVersion');
  const btnDevMode = document.getElementById('btnDevMode');
  let devTapCount = 0, devTapTimer = null;
  aboutVersion?.addEventListener('click', () => {
    devTapCount++;
    clearTimeout(devTapTimer);
    devTapTimer = setTimeout(() => { devTapCount = 0; }, 3000);
    if (devTapCount >= 5 && btnDevMode) {
      btnDevMode.hidden = false;
      devTapCount = 0;
    }
  });
  btnDevMode?.addEventListener('click', () => {
    location.href = 'ai-vs-ai.html?dev=1';
  });

  // Close modal handlers
  aboutModal.querySelectorAll('[data-close]').forEach(el =>
    el.addEventListener('click', ()=> setModal(false))
  );
  aboutModal.addEventListener('click', (e)=>{
    if(e.target.classList.contains('modal-backdrop')) setModal(false);
  });

  // Account, email verification, and the advanced server address now all
  // live on profile.html (see js/profile.js) — settings.html only shows a
  // preview card linking there.

  const notifToggle = document.getElementById('notifToggle');
  if (notifToggle) notifToggle.checked = notificationsEnabled();
  notifToggle?.addEventListener('change', () => {
    setNotificationsEnabled(notifToggle.checked);
    if (notifToggle.checked) {
      // Ask for real OS-level notification permission right when the user
      // opts in — never unprompted on page load. Also establishes the Web
      // Push subscription so notifications can reach this device while
      // it's closed, not just while a page is open polling.
      requestPushPermission();
    } else {
      // Stop any further push to this device; in-page polling/toast is
      // already gated by notificationsEnabled() above.
      disablePush();
    }
    refreshNotifBadge();
  });

  applyTranslations();
});
