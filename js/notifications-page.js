// js/notifications-page.js — controller for notifications.html. Real
// events only (friend_request, friend_accepted, message, game_*), inserted
// by the backend exactly when those things happen — see ouk-ai-backend's
// friends.js/chat.js/games.js routes.
//
// Each row supports a real swipe gesture (pointer events, so it works for
// touch and mouse alike): swipe left marks it read, swipe right deletes
// it — both act on every notification folded into that row, since
// consecutive messages from the same sender are grouped into one row
// (see groupNotifications below).
import * as Api from './api.js';
import { notificationsEnabled } from './notif-badge.js';

const LABELS = {
  friend_request: (d) => ({ emoji: '👤', text: `<b>${esc(d.fromDisplayName)}</b> sent you a friend request` }),
  friend_accepted: (d) => ({ emoji: '🤝', text: `<b>${esc(d.byDisplayName)}</b> accepted your friend request` }),
  message: (d) => ({ emoji: '💬', text: `<b>${esc(d.fromDisplayName)}</b>: ${esc(d.preview)}` }),
  game_invite: (d) => ({ emoji: '♟️', text: `<b>${esc(d.fromDisplayName)}</b> challenged you to a game` }),
  game_accepted: (d) => ({ emoji: '♟️', text: `<b>${esc(d.byDisplayName)}</b> accepted your challenge` }),
  game_move: (d) => ({ emoji: '➡️', text: `It's your move against <b>${esc(d.byDisplayName)}</b>` }),
  game_over: (d) => ({
    emoji: d.result === 'draw' ? '🤝' : '🏁',
    text: d.result === 'draw'
      ? `Your game with <b>${esc(d.byDisplayName)}</b> ended in a draw`
      : `Game over vs <b>${esc(d.byDisplayName)}</b> — ${esc(d.reason === 'resignation' ? `${d.result} won by resignation` : `${d.result} won`)}`,
  }),
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function targetFor(n) {
  if (n.type === 'message') return `chat.html?friend=${n.data.fromUserId}`;
  if (n.type === 'game_invite' || n.type === 'game_accepted' || n.type === 'game_move' || n.type === 'game_over') {
    return `play.html?mode=online&gameId=${n.data.gameId}`;
  }
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

// Folds a run of consecutive messages from the same sender into one row —
// notifications are already ordered newest-first, so "consecutive" means
// nothing else arrived in between (another sender, a friend request, …).
function groupNotifications(list) {
  const groups = [];
  for (const n of list) {
    const last = groups[groups.length - 1];
    if (n.type === 'message' && last?.type === 'message' && last.items[0].data.fromUserId === n.data.fromUserId) {
      last.items.push(n);
    } else {
      groups.push({ type: n.type, items: [n] });
    }
  }
  return groups;
}

// Real swipe via Pointer Events (covers touch + mouse). Horizontal intent
// is only locked in once the drag clearly isn't a vertical scroll, so the
// page still scrolls normally on a mostly-vertical touch.
function attachSwipe(row, { onSwipeLeft, onSwipeRight, onTap }) {
  const THRESHOLD = 80;
  let startX = 0, startY = 0, dx = 0, dragging = false, horizontal = false, pointerId = null;

  row.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startY = e.clientY; dx = 0; dragging = true; horizontal = false;
    pointerId = e.pointerId;
    row.style.transition = 'none';
  });

  row.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const ddx = e.clientX - startX, ddy = e.clientY - startY;
    if (!horizontal) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      if (Math.abs(ddx) <= Math.abs(ddy)) { dragging = false; return; } // vertical scroll, not our gesture
      horizontal = true;
      row.setPointerCapture(pointerId);
    }
    dx = ddx;
    row.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('swipe-read', dx < -20);
    row.classList.toggle('swipe-delete', dx > 20);
  });

  function finish(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    row.style.transition = 'transform .2s ease';
    if (!horizontal) {
      onTap();
      return;
    }
    if (dx <= -THRESHOLD) {
      row.style.transform = 'translateX(-100%)';
      row.style.opacity = '0';
      onSwipeLeft();
    } else if (dx >= THRESHOLD) {
      row.style.transform = 'translateX(100%)';
      row.style.opacity = '0';
      onSwipeRight();
    } else {
      row.style.transform = 'translateX(0)';
      row.classList.remove('swipe-read', 'swipe-delete');
    }
  }
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', finish);
}

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('notifRoot');
  const notifMenu = document.getElementById('notifMenu');
  const notifMenuList = document.getElementById('notifMenuList');
  const btnNotifMenu = document.getElementById('btnNotifMenu');

  function closeMenu() { notifMenuList.hidden = true; }
  btnNotifMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
    notifMenuList.hidden = !notifMenuList.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!notifMenuList.hidden && !notifMenu.contains(e.target)) closeMenu();
  });

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

  if (!notificationsEnabled()) {
    root.innerHTML = '<div class="empty-note">Notifications are turned off. Enable them in Settings to see friend, chat, and game activity.</div>';
    return;
  }

  notifMenu.hidden = false;

  async function render() {
    try {
      const { notifications } = await Api.getNotifications();
      root.innerHTML = '';
      if (!notifications.length) {
        root.innerHTML = '<div class="empty-note">No notifications yet.</div>';
        return;
      }
      const list = document.createElement('div');
      list.className = 'notif-list';
      for (const group of groupNotifications(notifications)) {
        const first = group.items[0];
        const ids = group.items.map(n => n.id);
        const allRead = group.items.every(n => n.read);
        const meta = group.items.length > 1
          ? { emoji: '💬', text: `<b>${esc(first.data.fromDisplayName)}</b> sent you <b>${group.items.length}</b> messages` }
          : (LABELS[first.type] || (() => ({ emoji: '🔔', text: first.type })))(first.data);

        const wrap = document.createElement('div');
        wrap.className = 'notif-row-wrap';
        const row = document.createElement('div');
        row.className = 'notif-row' + (allRead ? '' : ' unread');
        row.innerHTML = `
          <div class="notif-emoji">${meta.emoji}</div>
          <div class="notif-text">${meta.text}</div>
          ${group.items.length > 1 ? `<div class="notif-count">${group.items.length}</div>` : ''}
          <div class="notif-time">${fmtTime(first.createdAt)}</div>
        `;
        wrap.appendChild(row);
        list.appendChild(wrap);

        attachSwipe(row, {
          onSwipeLeft: async () => {
            await Promise.all(ids.map(id => Api.markNotificationRead(id).catch(() => {})));
            render();
          },
          onSwipeRight: async () => {
            await Promise.all(ids.map(id => Api.deleteNotification(id).catch(() => {})));
            render();
          },
          onTap: async () => {
            if (!allRead) await Promise.all(ids.map(id => Api.markNotificationRead(id).catch(() => {})));
            location.href = targetFor(first);
          },
        });
      }
      root.appendChild(list);
    } catch (err) {
      root.innerHTML = `<div class="empty-note">${esc(err.message || 'Could not load notifications.')}</div>`;
    }
  }

  document.getElementById('btnMarkAllRead').addEventListener('click', async () => {
    closeMenu();
    await Api.markAllNotificationsRead().catch(() => {});
    render();
  });
  document.getElementById('btnDeleteAll').addEventListener('click', async () => {
    closeMenu();
    if (!confirm('Delete all notifications? This cannot be undone.')) return;
    await Api.deleteAllNotifications().catch(() => {});
    render();
  });

  render();
});
