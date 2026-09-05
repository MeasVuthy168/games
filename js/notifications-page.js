// js/notifications-page.js — controller for notifications.html. Real
// events only (friend_request, friend_accepted, message, game_*), inserted
// by the backend exactly when those things happen — see ouk-ai-backend's
// friends.js/chat.js/games.js routes.
//
// Each row supports a real swipe gesture (pointer events, so it works for
// touch and mouse alike), Gmail-style: swipe left deletes, swipe right
// marks read — both act on every notification folded into that row, since
// consecutive messages from the same sender (and consecutive "it's your
// move" pings for the same game) are grouped into one row (see
// groupNotifications below).
import * as Api from './api.js';
import { notificationsEnabled } from './notif-badge.js';
import { initTranslations } from './i18n.js';

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

// Folds a run of consecutive messages from the same sender (or consecutive
// "it's your move" pings for the same game — see games.js's dedup on
// insert, this only ever matters for anything already in the DB before
// that existed) into one row — notifications are already ordered
// newest-first, so "consecutive" means nothing else arrived in between
// (another sender/game, a friend request, …).
function groupNotifications(list) {
  const groups = [];
  for (const n of list) {
    const last = groups[groups.length - 1];
    if (n.type === 'message' && last?.type === 'message' && last.items[0].data.fromUserId === n.data.fromUserId) {
      last.items.push(n);
    } else if (n.type === 'game_move' && last?.type === 'game_move' && last.items[0].data.gameId === n.data.gameId) {
      last.items.push(n);
    } else {
      groups.push({ type: n.type, items: [n] });
    }
  }
  return groups;
}

// Real swipe via Pointer Events (covers touch + mouse). Horizontal intent
// is only locked in once the drag clearly isn't a vertical scroll, so the
// page still scrolls normally on a mostly-vertical touch. bgDelete/bgRead
// are the reveal layers sitting under the row (see notifications.html) —
// dragging left uncovers bgDelete on the right side of the wrap, dragging
// right uncovers bgRead on the left side (Gmail's swipe convention).
function attachSwipe(row, { bgDelete, bgRead, onSwipeLeft, onSwipeRight, onTap }) {
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
    bgDelete.classList.toggle('show', dx < -20);
    bgRead.classList.toggle('show', dx > 20);
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
      bgDelete.classList.remove('show');
      bgRead.classList.remove('show');
    }
  }
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', finish);
}

document.addEventListener('DOMContentLoaded', async () => {
  initTranslations();
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
        // A grouped "it's your move" still just says "it's your move" —
        // only one move is actually pending regardless of how many stale
        // pings got folded together, and the .notif-count badge already
        // conveys that. Grouped messages get their own "N messages" text.
        const meta = group.items.length > 1 && first.type === 'message'
          ? { emoji: '💬', text: `<b>${esc(first.data.fromDisplayName)}</b> sent you <b>${group.items.length}</b> messages` }
          : (LABELS[first.type] || (() => ({ emoji: '🔔', text: first.type })))(first.data);

        const wrap = document.createElement('div');
        wrap.className = 'notif-row-wrap';
        wrap.innerHTML = `
          <div class="notif-swipe-bg notif-swipe-bg-read">✓ Read</div>
          <div class="notif-swipe-bg notif-swipe-bg-delete">🗑️ Delete</div>
        `;
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
          bgDelete: wrap.querySelector('.notif-swipe-bg-delete'),
          bgRead: wrap.querySelector('.notif-swipe-bg-read'),
          onSwipeLeft: async () => {
            await Promise.all(ids.map(id => Api.deleteNotification(id).catch(() => {})));
            render();
          },
          onSwipeRight: async () => {
            await Promise.all(ids.map(id => Api.markNotificationRead(id).catch(() => {})));
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
