// Settings page controller
const LS_KEY = 'kc_settings_v1';
const THEME_KEY = 'kc_theme';
const DEFAULTS = { minutes: 10, increment: 5, sound: true, hints: true };

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

function getTheme() { return localStorage.getItem(THEME_KEY) || 'auto'; }
function setTheme(v) {
  localStorage.setItem(THEME_KEY, v);
  // Let pwa.js apply it globally; trigger now as well:
  const root = document.documentElement;
  if (v === 'dark') root.setAttribute('data-theme', 'dark');
  else if (v === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}

function toneTest() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 700;
  g.gain.value = 0.07;
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.12);
}

document.addEventListener('DOMContentLoaded', () => {
  const soundToggle = document.getElementById('soundToggle');
  const hintsToggle = document.getElementById('hintsToggle');
  const minutesInput = document.getElementById('minutesInput');
  const incInput = document.getElementById('incInput');
  const btnSaveTimer = document.getElementById('btnSaveTimer');
  const btnResetTimer = document.getElementById('btnResetTimer');
  const btnTestBeep = document.getElementById('btnTestBeep');

  const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));

  let s = loadSettings();

  // Initialize controls
  soundToggle.checked = !!s.sound;
  hintsToggle.checked = s.hints !== false; // default true
  minutesInput.value = s.minutes ?? DEFAULTS.minutes;
  incInput.value = s.increment ?? DEFAULTS.increment;

  const currentTheme = getTheme();
  const hit = themeRadios.find(r => r.value === currentTheme) || themeRadios[0];
  hit.checked = true;

  // Wire events
  soundToggle.addEventListener('change', () => {
    s.sound = !!soundToggle.checked;
    saveSettings(s);
  });

  hintsToggle.addEventListener('change', () => {
    s.hints = !!hintsToggle.checked;
    saveSettings(s);
  });

  btnTestBeep.addEventListener('click', () => {
    if (soundToggle.checked) toneTest();
  });

  btnSaveTimer.addEventListener('click', () => {
    const minutes = Math.max(1, Math.min(180, parseInt(minutesInput.value || '10', 10)));
    const inc = Math.max(0, Math.min(60, parseInt(incInput.value || '5', 10)));
    s.minutes = minutes;
    s.increment = inc;
    saveSettings(s);
    alert('Saved. New games will use these timer settings.');
  });

  btnResetTimer.addEventListener('click', () => {
    minutesInput.value = DEFAULTS.minutes;
    incInput.value = DEFAULTS.increment;
  });

  themeRadios.forEach(r => r.addEventListener('change', () => {
    if (!r.checked) return;
    setTheme(r.value);
  }));
});
