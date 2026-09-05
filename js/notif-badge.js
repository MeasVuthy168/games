// js/notif-badge.js — unread-notifications badge on the bottom nav's
// Notification icon, present on every page that includes this script.
// Real unread count from the backend; respects the user's Settings ->
// Notifications on/off toggle (kc_notif_enabled_v1) and is a no-op when
// signed out.
//
// Also surfaces brand-new notifications two extra ways, on any page
// (except notifications.html, which already shows its own live list, and
// except game_move — already visible live on the board itself): an
// in-app toast, and — if the user has granted permission — a real OS
// notification (shows in the system notification center / iOS Control
// Center's notification list, not just inside the page; routed through
// the registered Service Worker on browsers — Android Chrome included —
// that require that instead of the plain Notification constructor). That
// native notification only fires while this page is open and polling;
// there's no push subscription behind it, so it can't wake a fully-closed
// app the way a real push service would.

import * as Api from './api.js';
import { showToast } from './toast.js';

const ENABLED_KEY = 'kc_notif_enabled_v1';
const SEEN_KEY = 'kc_notif_seen_ids_v1';
const POLL_MS = 20000;

// Opt-in, not opt-out — a fresh install has never set this key, so it
// must default to off until the user explicitly turns it on in Settings.
export function notificationsEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) === 'true'; } catch { return false; }
}

export function setNotificationsEnabled(on) {
  try { localStorage.setItem(ENABLED_KEY, on ? 'true' : 'false'); } catch {}
}

// Only ever called from a direct user action (the Settings toggle turning
// on) — never unprompted on page load, which browsers themselves
// discourage (and often block outright).
export async function requestPushPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

// Same event types as notifications-page.js's LABELS map, but plain text
// (no <b> markup) since both the toast and the native Notification body
// render as plain text, not HTML.
function describe(n) {
  const d = n.data || {};
  switch (n.type) {
    case 'friend_request': return { emoji: '👤', text: `${d.fromDisplayName} sent you a friend request` };
    case 'friend_accepted': return { emoji: '🤝', text: `${d.byDisplayName} accepted your friend request` };
    case 'message': return { emoji: '💬', text: `${d.fromDisplayName}: ${d.preview}` };
    case 'game_invite': return { emoji: '♟️', text: `${d.fromDisplayName} challenged you to a game` };
    case 'game_accepted': return { emoji: '♟️', text: `${d.byDisplayName} accepted your challenge` };
    case 'game_move': return { emoji: '➡️', text: `It's your move against ${d.byDisplayName}` };
    case 'game_over': return {
      emoji: d.result === 'draw' ? '🤝' : '🏁',
      text: d.result === 'draw'
        ? `Your game with ${d.byDisplayName} ended in a draw`
        : `Game over vs ${d.byDisplayName} — ${d.reason === 'resignation' ? `${d.result} won by resignation` : `${d.result} won`}`,
    };
    default: return { emoji: '🔔', text: 'You have a new notification' };
  }
}

function targetFor(n) {
  if (n.type === 'message') return `chat.html?friend=${n.data.fromUserId}`;
  if (n.type === 'game_invite' || n.type === 'game_accepted' || n.type === 'game_move' || n.type === 'game_over') {
    return `play.html?mode=online&gameId=${n.data.gameId}`;
  }
  return 'friends.html';
}

function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}

function markSeen(ids) {
  try {
    const merged = [...getSeenIds(), ...ids];
    localStorage.setItem(SEEN_KEY, JSON.stringify(merged.slice(-300)));
  } catch {}
}

async function fireNativeNotification(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const { emoji, text } = describe(n);
  const options = { body: text, icon: 'assets/icons/icon-192.png', tag: n.id, data: { url: targetFor(n) } };
  try {
    // Android Chrome throws ("Illegal constructor") on `new Notification()`
    // called directly from a page — it requires going through a Service
    // Worker registration instead (see sw.js's notificationclick handler
    // for the tap-to-open behavior this needs on that path). Desktop
    // Chrome/Firefox and iOS Safari are fine with either, so prefer the
    // SW route whenever js/pwa.js has already registered one.
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) { await reg.showNotification(`${emoji} Khmer Chess`, options); return; }
    const notif = new Notification(`${emoji} Khmer Chess`, options);
    notif.onclick = () => { window.focus(); location.href = targetFor(n); };
  } catch { /* some browsers restrict constructing Notification directly outside a service worker; safe to skip */ }
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
  if (!Api.isSignedIn() || !notificationsEnabled()) { if (badge) badge.hidden = true; return; }
  try {
    const { notifications, unread } = await Api.getNotifications();
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread > 9 ? '9+' : String(unread);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }

    // Toast + native notification for anything genuinely new since the
    // last poll. Skipped entirely on the very first time this ever runs
    // on a device (nothing to compare against yet), so opening the app
    // for the first time doesn't dump a wall of toasts for old activity —
    // and skipped on notifications.html itself, which already shows a
    // live list of the same things.
    const hasRunBefore = localStorage.getItem(SEEN_KEY) !== null;
    const onNotifPage = (location.pathname.split('/').pop() || '') === 'notifications.html';
    if (hasRunBefore && !onNotifPage) {
      const seen = getSeenIds();
      // game_move ("it's your move against X") is already visible live on
      // the board itself for anyone actually in that game — toasting it
      // too is just a redundant interruption every time a move comes in.
      const fresh = notifications.filter(n => !n.read && !seen.has(n.id) && n.type !== 'game_move');
      for (const n of fresh.slice(0, 3)) { // cap so a burst of activity doesn't flood the screen with toasts
        const { text } = describe(n);
        showToast(text, 'info');
        fireNativeNotification(n);
      }
    }
    markSeen(notifications.map(n => n.id));
  } catch {
    // transient network hiccup — leave the badge showing whatever it last had
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshNotifBadge();
  setInterval(refreshNotifBadge, POLL_MS);
});
