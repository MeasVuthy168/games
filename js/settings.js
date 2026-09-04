// Settings controller
import { LEVELS, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL, levelBand } from './ai-engine.js';
import { pieceThemes, boardThemes } from './themes.js';
import { getProfile, applyAvatarToElement } from './profile-data.js';
import { setLanguage, getLanguage, applyTranslations, t } from './i18n.js';
import { recordLoginToday } from './rewards.js';
import * as Api from './api.js';
import { notificationsEnabled, setNotificationsEnabled, refreshNotifBadge } from './notif-badge.js';

recordLoginToday();

const LS_KEY = 'kc_settings_v1';
const THEME_KEY = 'kc_theme';
const DEFAULTS = {
  minutes: 10, increment: 5, sound: true, hints: true,
  aiLevel: DEFAULT_LEVEL, aiDebug: false,
  language: 'en', pieceTheme: 0, boardTheme: 0, instantMove: false
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

function toneTest(){
  const ctx = new (window.AudioContext||window.webkitAudioContext)();
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type='square'; o.frequency.value=700; g.gain.value=0.07;
  o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0+0.12);
}

function bandKey(n) {
  const band = levelBand(n).toLowerCase(); // 'easy'|'medium'|'hard'|'expert'
  return `settings.band.${band}`;
}

/* ------------------------------ DOM Ready ------------------------------ */
document.addEventListener('DOMContentLoaded', ()=>{

  // Load settings + language first so applyTranslations() below is correct.
  let s = loadSettings();
  setLanguage(s.language);

  // Profile bar (real local profile — editing happens on profile.html)
  const profName = document.getElementById('profName');
  const profAvatar = document.getElementById('profAvatar');
  const profile = getProfile();
  if (profName) profName.textContent = profile.name;
  applyAvatarToElement(profAvatar, profile.avatar);

  // Elements
  const soundToggle = document.getElementById('soundToggle');
  const hintsToggle = document.getElementById('hintsToggle');
  const instantMoveToggle = document.getElementById('instantMoveToggle');
  const minutesInput = document.getElementById('minutesInput');
  const incInput = document.getElementById('incInput');
  const btnSaveTimer = document.getElementById('btnSaveTimer');
  const btnResetTimer = document.getElementById('btnResetTimer');
  const btnTestBeep = document.getElementById('btnTestBeep');
  const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));
  const languageRadios = Array.from(document.querySelectorAll('input[name="language"]'));
  const aiDebugToggle = document.getElementById('aiDebugToggle');
  const aiLevelRange = document.getElementById('aiLevelRange');
  const aiLevelValue = document.getElementById('aiLevelValue');
  const aiLevelBand = document.getElementById('aiLevelBand');
  const pieceThemeName = document.getElementById('pieceThemeName');
  const pieceThemePrev = document.getElementById('pieceThemePrev');
  const pieceThemeNext = document.getElementById('pieceThemeNext');
  const boardThemeName = document.getElementById('boardThemeName');
  const boardThemePrev = document.getElementById('boardThemePrev');
  const boardThemeNext = document.getElementById('boardThemeNext');

  // Init UI states
  soundToggle.checked = !!s.sound;
  hintsToggle.checked = s.hints !== false;
  if (instantMoveToggle) instantMoveToggle.checked = !!s.instantMove;
  minutesInput.value  = s.minutes;
  incInput.value      = s.increment;
  (themeRadios.find(r=>r.value===getTheme())||themeRadios[0]).checked = true;
  (languageRadios.find(r=>r.value===s.language)||languageRadios[0]).checked = true;
  if (aiDebugToggle) aiDebugToggle.checked = !!s.aiDebug;

  function renderAILevel(){
    if (!aiLevelRange) return;
    aiLevelRange.value = s.aiLevel;
    if (aiLevelValue) aiLevelValue.textContent = String(s.aiLevel);
    if (aiLevelBand) {
      aiLevelBand.setAttribute('data-i18n', bandKey(s.aiLevel));
      aiLevelBand.textContent = t(bandKey(s.aiLevel));
    }
  }
  renderAILevel();

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
  hintsToggle.addEventListener('change', ()=>{ s.hints=!!hintsToggle.checked; saveSettings(s); });
  instantMoveToggle?.addEventListener('change', ()=>{ s.instantMove=!!instantMoveToggle.checked; saveSettings(s); });
  btnTestBeep.addEventListener('click', ()=>{ if(soundToggle.checked) toneTest(); });

  aiLevelRange?.addEventListener('input', ()=>{
    s.aiLevel = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parseInt(aiLevelRange.value, 10) || DEFAULT_LEVEL));
    renderAILevel();
    saveSettings(s);
  });
  aiDebugToggle?.addEventListener('change', ()=>{ s.aiDebug = !!aiDebugToggle.checked; saveSettings(s); });

  languageRadios.forEach(r =>
    r.addEventListener('change', ()=>{
      if(!r.checked) return;
      s.language = r.value; saveSettings(s);
      setLanguage(s.language);
      applyTranslations();
      renderAILevel(); // band label text depends on language too
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
    alert('Saved. New games will use these timer settings.');
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

  // ------------------------------ Account ------------------------------
  const accountSub = document.getElementById('accountSub');
  const btnAccountAction = document.getElementById('btnAccountAction');
  function renderAccount() {
    if (Api.isSignedIn()) {
      const u = Api.getCurrentUser();
      accountSub.textContent = `Signed in as ${u?.displayName || u?.email || ''}`;
      btnAccountAction.textContent = 'Sign Out';
    } else {
      accountSub.textContent = 'Not signed in';
      btnAccountAction.textContent = 'Sign In';
    }
  }
  renderAccount();
  btnAccountAction?.addEventListener('click', () => {
    if (Api.isSignedIn()) { Api.signOut(); renderAccount(); }
    else location.href = 'auth.html?next=settings.html';
  });

  const apiBaseInput = document.getElementById('apiBaseInput');
  if (apiBaseInput) apiBaseInput.value = Api.getApiBase();
  document.getElementById('btnSaveApiBase')?.addEventListener('click', () => {
    Api.setApiBase(apiBaseInput.value);
    apiBaseInput.value = Api.getApiBase();
    alert('Server address saved.');
  });

  const notifToggle = document.getElementById('notifToggle');
  if (notifToggle) notifToggle.checked = notificationsEnabled();
  notifToggle?.addEventListener('change', () => {
    setNotificationsEnabled(notifToggle.checked);
    refreshNotifBadge();
  });

  applyTranslations();
});
