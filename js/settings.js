// Settings controller
const LS_KEY = 'kc_settings_v1';
const THEME_KEY = 'kc_theme';
const DEFAULTS = { minutes: 10, increment: 5, sound: true, hints: true };

// Show in About modal (keep in sync with sw.js if you want)
const APP_VERSION = '1.0.3';
const APP_UPDATED = '2025-10-22';

function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS }; }
  catch { return { ...DEFAULTS }; }
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

document.addEventListener('DOMContentLoaded', ()=>{
  // Profile (placeholder)
  const profName = document.getElementById('profName');
  profName.textContent = localStorage.getItem('kc_profile_name') || 'Guest';

  const soundToggle = document.getElementById('soundToggle');
  const hintsToggle = document.getElementById('hintsToggle');
  const minutesInput = document.getElementById('minutesInput');
  const incInput = document.getElementById('incInput');
  const btnSaveTimer = document.getElementById('btnSaveTimer');
  const btnResetTimer = document.getElementById('btnResetTimer');
  const btnTestBeep = document.getElementById('btnTestBeep');
  const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));

  let s = loadSettings();

  // init
  soundToggle.checked = !!s.sound;
  hintsToggle.checked = s.hints !== false;
  minutesInput.value = s.minutes;
  incInput.value = s.increment;
  (themeRadios.find(r=>r.value===getTheme())||themeRadios[0]).checked = true;

  // events
  soundToggle.addEventListener('change', ()=>{ s.sound=!!soundToggle.checked; saveSettings(s); });
  hintsToggle.addEventListener('change', ()=>{ s.hints=!!hintsToggle.checked; saveSettings(s); });
  btnTestBeep.addEventListener('click', ()=>{ if(soundToggle.checked) toneTest(); });

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

  themeRadios.forEach(r=> r.addEventListener('change', ()=>{ if(r.checked) setTheme(r.value); }));

  // About modal wires
  const aboutModal = document.getElementById('aboutModal');
  const setModal = (show) => { show ? aboutModal.classList.add('show') : aboutModal.classList.remove('show'); };
  document.getElementById('btnAbout').addEventListener('click', ()=>{
    document.getElementById('aboutVersion').textContent = `v${APP_VERSION}`;
    document.getElementById('aboutUpdated').textContent = APP_UPDATED;
    setModal(true);
  });
  aboutModal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', ()=> setModal(false)));
  aboutModal.addEventListener('click', (e)=>{ if(e.target.classList.contains('modal-backdrop')) setModal(false); });
});
