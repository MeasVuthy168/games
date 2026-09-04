// js/notif-badge.js — unread-notifications badge on the bottom nav's
// Notification icon, present on every page that includes this script.
// Real unread count from the backend; respects the user's Settings ->
// Notifications on/off toggle (kc_notif_enabled_v1) and is a no-op when
// signed out.

import * as Api from './api.js';

const ENABLED_KEY = 'kc_notif_enabled_v1';
const POLL_MS = 20000;

export function notificationsEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) !== 'false'; } catch { return true; }
}

export function setNotificationsEnabled(on) {
  try { localStorage.setItem(ENABLED_KEY, on ? 'true' : 'false'); } catch {}
}

function ensureBadgeEl() {
  const link = document.querySelector('#appTabbar a[href="notifications.html"]');
  if (!link) return null;
  let badge = link.querySelector('.nav-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    badge.hidden = true;
    link.appendChild(badge);
  }
  return badge;
}

export async function refreshNotifBadge() {
  const badge = ensureBadgeEl();
  if (!badge) return;
  if (!Api.isSignedIn() || !notificationsEnabled()) { badge.hidden = true; return; }
  try {
    const { unread } = await Api.getNotifications();
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch {
    // transient network hiccup — leave the badge showing whatever it last had
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshNotifBadge();
  setInterval(refreshNotifBadge, POLL_MS);
});
