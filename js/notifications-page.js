// js/notifications-page.js — controller for notifications.html. Real
// events only (friend_request, friend_accepted, message), inserted by the
// backend exactly when those things happen — see ouk-ai-backend's
// friends.js/chat.js routes.
import * as Api from './api.js';

const LABELS = {
  friend_request: (d) => ({ emoji: '👤', text: `<b>${esc(d.fromDisplayName)}</b> sent you a friend request` }),
  friend_accepted: (d) => ({ emoji: '🤝', text: `<b>${esc(d.byDisplayName)}</b> accepted your friend request` }),
  message: (d) => ({ emoji: '💬', text: `<b>${esc(d.fromDisplayName)}</b>: ${esc(d.preview)}` }),
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function targetFor(n) {
  if (n.type === 'message') return `chat.html?friend=${n.data.fromUserId}`;
  return 'friends.html';
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString();
}

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('notifRoot');
  const actions = document.getElementById('notifActions');

  if (!Api.isSignedIn()) {
    root.innerHTML = '';
    const note = document.createElement('div');
    note.className = 'signin-note card card-full clickable';
    note.style.cursor = 'pointer';
    note.innerHTML = '<div class="card-left"><div class="card-title">Sign in to see notifications</div><div class="card-sub">Friend requests, accepted friends, and chat messages</div></div><div class="card-right">›</div>';
    note.addEventListener('click', () => { location.href = 'auth.html?next=notifications.html'; });
    root.appendChild(note);
    return;
  }

  async function render() {
    try {
      const { notifications, unread } = await Api.getNotifications();
      actions.hidden = unread === 0;
      root.innerHTML = '';
      if (!notifications.length) {
        root.innerHTML = '<div class="empty-note">No notifications yet.</div>';
        return;
      }
      const list = document.createElement('div');
      list.className = 'notif-list';
      for (const n of notifications) {
        const meta = (LABELS[n.type] || (() => ({ emoji: '🔔', text: n.type })))(n.data);
        const row = document.createElement('div');
        row.className = 'notif-row' + (n.read ? '' : ' unread');
        row.innerHTML = `
          <div class="notif-emoji">${meta.emoji}</div>
          <div class="notif-text">${meta.text}</div>
          <div class="notif-time">${fmtTime(n.createdAt)}</div>
        `;
        row.addEventListener('click', async () => {
          if (!n.read) await Api.markNotificationRead(n.id).catch(() => {});
          location.href = targetFor(n);
        });
        list.appendChild(row);
      }
      root.appendChild(list);
    } catch (err) {
      root.innerHTML = `<div class="empty-note">${esc(err.message || 'Could not load notifications.')}</div>`;
    }
  }

  document.getElementById('btnReadAll').addEventListener('click', async () => {
    await Api.markAllNotificationsRead().catch(() => {});
    render();
  });

  render();
});
