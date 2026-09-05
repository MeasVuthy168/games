// js/profile.js — Profile screen controller. When signed in, the real
// account (displayName/avatarEmoji/avatarUrl, synced via ouk-ai-backend)
// is the source of truth for identity; signed out, this falls back to the
// purely local guest profile in profile-data.js. Also hosts account
// management (sign in/out, delete account) — moved here from settings.html
// so Settings stays about app preferences and this page owns "your
// account." Google Sign-In is the only way in, so there's no
// password/server-address UI here anymore.

import { getProfile, setProfileName, setProfileAvatar, applyAvatarToElement, BUILTIN_AVATARS } from './profile-data.js';
import { setLanguage, applyTranslations, t } from './i18n.js';
import { recordLoginToday } from './rewards.js';
import * as Api from './api.js';
import { showToast } from './toast.js';
import { getCoins, syncCoinsFromServer } from './coins.js';
import { getHistory, computeWinRate, syncHistoryFromServer } from './history.js';

recordLoginToday();

const LS_KEY = 'kc_settings_v1';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}

// Resize+compress client-side before ever touching localStorage or the
// network — an unresized phone photo can be several MB, which is both
// slow to upload and needlessly close to the backend's avatar size cap.
function resizeImageToDataUrl(file, maxSize = 256, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function fmtDuration(sec) {
  const s = Math.max(0, sec | 0);
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const settings = loadSettings();
  setLanguage(settings.language || 'en');

  const heroAvatar  = document.getElementById('heroAvatar');
  const heroName    = document.getElementById('heroName');

  // Signed in → the real account is "the" profile; signed out → the local
  // guest profile. Both shapes are { name, avatar:{type,value} }.
  function currentIdentity() {
    if (Api.isSignedIn()) {
      const u = Api.getCurrentUser();
      return {
        name: u?.displayName || 'Player',
        avatar: u?.avatarUrl
          ? { type: 'image', value: u.avatarUrl }
          : { type: 'emoji', value: u?.avatarEmoji || BUILTIN_AVATARS[0] },
      };
    }
    return getProfile();
  }

  function renderProfile() {
    const p = currentIdentity();
    heroName.textContent = p.name;
    applyAvatarToElement(heroAvatar, p.avatar);
  }

  renderProfile();
  applyTranslations();

  /* ---------------- coins / AI level / win rate + history ---------------- */
  // Local-device stats only (see api.js's header comment) — coins/history
  // never sync per-account, so this is the same regardless of which
  // account is signed in. Moved here from settings.html per user request.
  const statCoins = document.getElementById('statCoins');
  const statAILevel = document.getElementById('statAILevel');
  const statWinRate = document.getElementById('statWinRate');
  const historyList = document.getElementById('historyList');

  function renderStats() {
    if (statCoins) statCoins.textContent = String(getCoins());
    const lvl = parseInt(settings.aiLevel, 10);
    if (statAILevel) statAILevel.textContent = Number.isInteger(lvl) && lvl >= 1 && lvl <= 10 ? String(lvl) : '5';
    if (statWinRate) {
      const rate = computeWinRate();
      statWinRate.textContent = rate === null ? t('profile.notRated') : `${rate}%`;
    }
  }

  function renderHistory() {
    if (!historyList) return;
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

  renderStats();
  renderHistory();
  // Paint instantly from the local cache above, then (once signed in)
  // pull the real per-account numbers from the backend and repaint — the
  // backend is authoritative for a signed-in account, so this can only
  // change what's shown, never get stuck behind a stale local value.
  if (Api.isSignedIn()) {
    Api.getStats().then((stats) => {
      syncCoinsFromServer(stats);
      syncHistoryFromServer(stats);
      renderStats();
      renderHistory();
    }).catch(() => {});
  }

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
    nameInput.value = currentIdentity().name;
    showModal(nameModal, true);
    nameInput.focus();
  });
  document.getElementById('btnSaveName')?.addEventListener('click', async () => {
    if (Api.isSignedIn()) {
      try {
        await Api.updateProfile({ displayName: nameInput.value });
      } catch (err) {
        showToast(err.message || 'Could not update name', 'error');
        return;
      }
    } else {
      setProfileName(nameInput.value);
    }
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
    const current = currentIdentity().avatar;
    for (const emoji of BUILTIN_AVATARS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-choice' + (current.type === 'emoji' && current.value === emoji ? ' selected' : '');
      btn.textContent = emoji;
      btn.addEventListener('click', async () => {
        if (Api.isSignedIn()) {
          try {
            await Api.updateProfile({ avatarEmoji: emoji });
          } catch (err) {
            showToast(err.message || 'Could not update avatar', 'error');
            return;
          }
        } else {
          setProfileAvatar({ type: 'emoji', value: emoji });
        }
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

  avatarUpload?.addEventListener('change', async () => {
    const file = avatarUpload.files && avatarUpload.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      if (Api.isSignedIn()) {
        await Api.updateProfile({ avatarUrl: dataUrl });
      } else {
        setProfileAvatar({ type: 'image', value: dataUrl });
      }
      renderProfile();
      showModal(avatarModal, false);
    } catch (err) {
      showToast(err.message || 'Could not upload photo', 'error');
    } finally {
      avatarUpload.value = '';
    }
  });

  /* ---------------- account (sign in/out, switch, server, delete) ---------------- */
  // No "verify your email" banner here anymore — sign-up now requires the
  // emailed/texted code before the account is even created (see
  // auth-page.js), so every account is already verified by the time it
  // can sign in.
  const accountSub = document.getElementById('accountSub');
  const btnAccountAction = document.getElementById('btnAccountAction');
  const btnSwitchAccount = document.getElementById('btnSwitchAccount');
  const deleteAccountCard = document.getElementById('deleteAccountCard');

  function renderAccount() {
    if (Api.isSignedIn()) {
      const u = Api.getCurrentUser();
      accountSub.textContent = `Signed in as ${u?.displayName || u?.email || u?.phone || ''}`;
      btnAccountAction.textContent = 'Sign Out';
      if (btnSwitchAccount) btnSwitchAccount.hidden = false;
      if (deleteAccountCard) deleteAccountCard.hidden = false;
    } else {
      accountSub.textContent = 'Not signed in';
      btnAccountAction.textContent = 'Sign In';
      if (btnSwitchAccount) btnSwitchAccount.hidden = true;
      if (deleteAccountCard) deleteAccountCard.hidden = true;
    }
    // Identity source (account vs local guest) depends on sign-in state.
    renderProfile();
  }
  renderAccount();
  // Refresh from the server once so an edit made elsewhere (another tab,
  // another device) is reflected here without waiting for the next sign-in.
  if (Api.isSignedIn()) Api.fetchMe().then(renderAccount).catch(() => {});

  btnAccountAction?.addEventListener('click', () => {
    if (Api.isSignedIn()) { Api.signOut(); renderAccount(); }
    else location.href = 'auth.html?next=profile.html';
  });
  // Real switch: sign out of this account and land back here already on
  // the sign-in form, ready to authenticate as a different one.
  btnSwitchAccount?.addEventListener('click', () => {
    Api.signOut();
    location.href = 'auth.html?next=profile.html';
  });

  /* ---------------- delete account ---------------- */
  // No password prompt — Google Sign-In is the only way in, so a valid
  // signed-in session is the sole authorization needed (see the backend's
  // DELETE /me, which no longer asks for one either).
  const deleteAccountModal = document.getElementById('deleteAccountModal');
  wireCloseHandlers(deleteAccountModal);

  document.getElementById('btnDeleteAccount')?.addEventListener('click', () => {
    showModal(deleteAccountModal, true);
  });
  document.getElementById('btnConfirmDeleteAccount')?.addEventListener('click', async () => {
    try {
      await Api.deleteAccount();
      showModal(deleteAccountModal, false);
      showToast('Account deleted.', 'success');
      setTimeout(() => { location.href = 'index.html'; }, 600);
    } catch (err) {
      showToast(err.message || 'Could not delete account.', 'error');
    }
  });
});
