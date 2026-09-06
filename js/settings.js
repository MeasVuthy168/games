// Settings controller
import { pieceThemes, boardThemes } from './themes.js';
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

  // Profile bar preview — editing happens on profile.html. When signed in,
  // the real account's name/photo is the source of truth (kept in sync by
  // profile.js); signed out, this is the purely local guest profile.
  const profName = document.getElementById('profName');
  const profAvatar = document.getElementById('profAvatar');
  if (Api.isSignedIn()) {
    const u = Api.getCurrentUser();
    if (profName) profName.textContent = u?.displayName || 'Player';
    applyAvatarToElement(profAvatar, u?.avatarUrl ? { type: 'image', value: u.avatarUrl } : { type: 'emoji', value: u?.avatarEmoji || '🐯' });
  } else {
    const profile = getProfile();
    if (profName) profName.textContent = profile.name;
    applyAvatarToElement(profAvatar, profile.avatar);
  }

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
  const pieceThemeName = document.getElementById('pieceThemeName');
  const pieceThemePrev = document.getElementById('pieceThemePrev');
  const pieceThemeNext = document.getElementById('pieceThemeNext');
  const boardThemeName = document.getElementById('boardThemeName');
  const boardThemePrev = document.getElementById('boardThemePrev');
  const boardThemeNext = document.getElementById('boardThemeNext');

  // Init UI states
  soundToggle.checked = !!s.sound;
  if (hapticToggle) hapticToggle.checked = s.haptic !== false;
  hintsToggle.checked = s.hints !== false;
  if (animationToggle) animationToggle.checked = s.animationEnabled !== false;
  minutesInput.value  = s.minutes;
  incInput.value      = s.increment;
  (themeRadios.find(r=>r.value===getTheme())||themeRadios[0]).checked = true;
  (languageRadios.find(r=>r.value===s.language)||languageRadios[0]).checked = true;

  function renderThemeSteppers(){
    if (pieceThemeName) pieceThemeName.textContent = pieceThemes[s.pieceTheme]?.name || pieceThemes[0].name;
    if (boardThemeName) boardThemeName.textContent = boardThemes[s.boardTheme]?.name || boardThemes[0].name;
    // Only one real theme ships today — Prev/Next are wired but a no-op
    // until more are registered in js/themes.js.
    if (pieceThemePrev) pieceThemePrev.disabled = pieceThemes.length <= 1;
    if (pieceThemeNext) pieceThemeNext.disabled = pieceThemes.length <= 1;
    if (boardThemePrev) boardThemePrev.disabled = boardThemes.length <= 1;
    if (boardThemeNext) boardThemeNext.disabled = boardThemes.length <= 1;
  }
  renderThemeSteppers();

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

  function stepTheme(key, themes, delta){
    if (themes.length <= 1) return; // nothing to step to yet
    s[key] = (s[key] + delta + themes.length) % themes.length;
    saveSettings(s);
    renderThemeSteppers();
  }
  pieceThemePrev?.addEventListener('click', ()=> stepTheme('pieceTheme', pieceThemes, -1));
  pieceThemeNext?.addEventListener('click', ()=> stepTheme('pieceTheme', pieceThemes, 1));
  boardThemePrev?.addEventListener('click', ()=> stepTheme('boardTheme', boardThemes, -1));
  boardThemeNext?.addEventListener('click', ()=> stepTheme('boardTheme', boardThemes, 1));

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
