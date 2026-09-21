// js/chat-badge.js — unread-messages badge on the bottom nav's Chat icon,
// present on every page that includes this script. Mirrors js/notif-badge.js's
// own badge pattern (same polling architecture, same .nav-badge element/
// styling), but counts real chat unread specifically — summed straight from
// Api.getConversations()'s own per-conversation `unread` (the same count
// chat.html's own conversation list already shows per row), not derived
// from /api/notifications. A no-op when signed out.
//
// This is a separate signal from js/notif-badge.js's Notification badge on
// purpose: that badge now excludes `message`-type notifications (see its
// own refreshNotifBadge()), so a new chat message shows up exactly once —
// here, on the Chat tab it actually belongs to — instead of inflating two
// different badges for the same event.
import * as Api from './api.js';

const POLL_MS = 20000; // matches notif-badge.js's own poll rate

function ensureBadgeEl() {
  const link = document.querySelector('#appTabbar a[href="chat.html"]');
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

export async function refreshChatBadge() {
  const badge = ensureBadgeEl();
  if (!Api.isSignedIn()) { if (badge) badge.hidden = true; return; }
  try {
    const conversations = await Api.getConversations();
    const unread = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
    if (!badge) return;
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
  refreshChatBadge();
  setInterval(refreshChatBadge, POLL_MS);
});
