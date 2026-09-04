// js/profile.js — Profile screen controller. Reads through the local
// modules (coins/history/profile-data) rather than touching localStorage
// directly, so this screen always agrees with whatever settings.html or a
// completed game just wrote.

import { getCoins } from './coins.js';
import { getHistory, computeWinRate } from './history.js';
import { getProfile, setProfileName, setProfileAvatar, applyAvatarToElement, BUILTIN_AVATARS } from './profile-data.js';
import { setLanguage, applyTranslations, t } from './i18n.js';
import { recordLoginToday } from './rewards.js';

recordLoginToday();

const LS_KEY = 'kc_settings_v1';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}

function fmtDuration(sec) {
  const s = Math.max(0, sec | 0);
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
  setLanguage(loadSettings().language || 'en');

  const heroAvatar  = document.getElementById('heroAvatar');
  const heroName    = document.getElementById('heroName');
  const statCoins   = document.getElementById('statCoins');
  const statAILevel = document.getElementById('statAILevel');
  const statWinRate = document.getElementById('statWinRate');
  const historyList = document.getElementById('historyList');

  function renderProfile() {
    const p = getProfile();
    heroName.textContent = p.name;
    applyAvatarToElement(heroAvatar, p.avatar);
  }

  function renderStats() {
    statCoins.textContent = String(getCoins());
    const lvl = parseInt(loadSettings().aiLevel, 10);
    statAILevel.textContent = Number.isInteger(lvl) && lvl >= 1 && lvl <= 10 ? String(lvl) : '5';
    const rate = computeWinRate();
    statWinRate.textContent = rate === null ? t('profile.notRated') : `${rate}%`;
  }

  function renderHistory() {
    const games = getHistory();
    historyList.innerHTML = '';
    if (games.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'card-sub';
      empty.textContent = t('profile.history.empty');
      historyList.appendChild(empty);
      return;
    }
    for (const g of games) {
      const row = document.createElement('div');
      row.className = 'history-row';

      const meta = document.createElement('div');
      meta.className = 'history-meta';
      const opp = document.createElement('div');
      opp.className = 'history-opponent';
      opp.textContent = g.opponent;
      const date = document.createElement('div');
      date.className = 'history-date';
      const d = new Date(g.date);
      const when = isNaN(d.getTime()) ? g.date : d.toLocaleString();
      date.textContent = `${when} · ${g.moves} ${t('profile.history.moves')} · ${fmtDuration(g.duration)}`;
      meta.appendChild(opp);
      meta.appendChild(date);

      const badge = document.createElement('div');
      badge.className = `history-badge ${g.result}`;
      badge.textContent = t(`profile.history.${g.result}`);

      row.appendChild(meta);
      row.appendChild(badge);
      historyList.appendChild(row);
    }
  }

  renderProfile();
  renderStats();
  renderHistory();
  applyTranslations();

  /* ---------------- shared modal helpers ---------------- */
  function showModal(modal, show) {
    modal.classList.toggle('show', show);
    modal.setAttribute('aria-hidden', show ? 'false' : 'true');
  }
  function wireCloseHandlers(modal) {
    modal.querySelectorAll('[data-close]').forEach(el =>
      el.addEventListener('click', () => showModal(modal, false))
    );
    modal.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) showModal(modal, false);
    });
  }

  /* ---------------- edit name ---------------- */
  const nameModal = document.getElementById('nameModal');
  const nameInput = document.getElementById('nameInput');
  wireCloseHandlers(nameModal);

  document.getElementById('btnEditName')?.addEventListener('click', () => {
    nameInput.value = getProfile().name;
    showModal(nameModal, true);
    nameInput.focus();
  });
  document.getElementById('btnSaveName')?.addEventListener('click', () => {
    setProfileName(nameInput.value);
    renderProfile();
    showModal(nameModal, false);
  });

  /* ---------------- edit avatar ---------------- */
  const avatarModal = document.getElementById('avatarModal');
  const avatarGrid = document.getElementById('avatarGrid');
  const avatarUpload = document.getElementById('avatarUpload');
  wireCloseHandlers(avatarModal);

  function renderAvatarGrid() {
    avatarGrid.innerHTML = '';
    const current = getProfile().avatar;
    for (const emoji of BUILTIN_AVATARS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-choice' + (current.type === 'emoji' && current.value === emoji ? ' selected' : '');
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        setProfileAvatar({ type: 'emoji', value: emoji });
        renderProfile();
        renderAvatarGrid();
      });
      avatarGrid.appendChild(btn);
    }
  }

  document.getElementById('btnEditAvatar')?.addEventListener('click', () => {
    renderAvatarGrid();
    showModal(avatarModal, true);
  });

  avatarUpload?.addEventListener('change', () => {
    const file = avatarUpload.files && avatarUpload.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setProfileAvatar({ type: 'image', value: String(reader.result) });
      renderProfile();
      showModal(avatarModal, false);
      avatarUpload.value = '';
    };
    reader.readAsDataURL(file);
  });
});
