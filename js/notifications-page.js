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
import { initTranslations, t } from './i18n.js';

// Feather/Lucide-style 24x24 stroke icons — a small badge overlaid on the
// avatar circle names what happened (a real vector icon reads consistently
// across platforms, unlike relying on each OS/browser's own emoji font).
const TYPE_ICONS = {
  friend_request: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  friend_accepted: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  game_invite: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/>',
  game_accepted: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  game_move: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  game_over: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
};

function typeIconSvg(type) {
  const path = TYPE_ICONS[type];
  if (!path) return '';
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

// Colors picked mostly for contrast against the small white badge circle —
// not meaningful beyond "differentiate the event types at a glance".
const TYPE_BADGE_BG = {
  friend_request: '#2f7de1', friend_accepted: '#1c9a5b', message: '#2f7de1',
  game_invite: '#c0392b', game_accepted: '#1c9a5b', game_move: '#e08b1a', game_over: '#555f6e',
};

// { name, preview } are pre-escaped HTML fragments (the name is already
// wrapped in <b>) — t() does plain string substitution, no HTML-escaping
// of its own, matching how the rest of this page already builds row HTML.
const LABELS = {
  friend_request: (d) => ({
    text: t('notif.friendRequest', { name: bold(d.fromDisplayName) }),
    avatarEmoji: d.fromAvatarEmoji, avatarUrl: d.fromAvatarUrl,
  }),
  friend_accepted: (d) => ({
    text: t('notif.friendAccepted', { name: bold(d.byDisplayName) }),
    avatarEmoji: d.byAvatarEmoji, avatarUrl: d.byAvatarUrl,
  }),
  message: (d) => ({
    text: t('notif.message', { name: bold(d.fromDisplayName), preview: esc(d.preview) }),
    avatarEmoji: d.fromAvatarEmoji, avatarUrl: d.fromAvatarUrl,
  }),
  game_invite: (d) => ({
    text: t('notif.gameInvite', { name: bold(d.fromDisplayName) }),
    avatarEmoji: d.fromAvatarEmoji, avatarUrl: d.fromAvatarUrl,
  }),
  game_accepted: (d) => ({
    text: t('notif.gameAccepted', { name: bold(d.byDisplayName) }),
    avatarEmoji: d.byAvatarEmoji, avatarUrl: d.byAvatarUrl,
  }),
  game_move: (d) => ({
    text: t('notif.gameMove', { name: bold(d.byDisplayName) }),
    avatarEmoji: d.byAvatarEmoji, avatarUrl: d.byAvatarUrl,
  }),
  game_over: (d) => {
    const color = t(d.result === 'white' ? 'notif.colorWhite' : 'notif.colorBlack');
    const text = d.result === 'draw'
      ? t('notif.gameOverDraw', { name: bold(d.byDisplayName) })
      : t(d.reason === 'resignation' ? 'notif.gameOverWinResignation' : 'notif.gameOverWin', { name: bold(d.byDisplayName), color });
    return { text, avatarEmoji: d.byAvatarEmoji, avatarUrl: d.byAvatarUrl };
  },
};

function bold(s) { return `<b>${esc(s)}</b>`; }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function setAvatar(el, { emoji, url } = {}) {
  if (!el) return;
  if (url) { el.style.backgroundImage = `url("${url}")`; el.textContent = ''; }
  else { el.style.backgroundImage = ''; el.textContent = emoji || '👤'; }
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
  if (diffMin < 1) return t('notif.timeJustNow');
  if (diffMin < 60) return t('notif.timeMinAgo', { n: diffMin });
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return t('notif.timeHourAgo', { n: diffH });
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
  // The page-transition slide (styles.css) is gated on this class so it
  // never animates the empty <main> the fallback text above gets cleared
  // into — see that file's comment. Marked as soon as SOME stable content
  // (sign-in note / disabled note / the "Loading…" placeholder below) is
  // in root; the slide never waits on render()'s own Api.getNotifications()
  // call, which only replaces root's contents once it resolves.
  const ptRoot = document.querySelector('.page-transition-root');
  function markPtReady() { ptRoot?.classList.add('pt-ready'); }
  const notifMenu = document.getElementById('notifMenu');
  const notifMenuList = document.getElementById('notifMenuList');
  const btnNotifMenu = document.getElementById('btnNotifMenu');
  const btnMarkAllRead = document.getElementById('btnMarkAllRead');
  const btnDeleteAll = document.getElementById('btnDeleteAll');
  if (btnMarkAllRead) btnMarkAllRead.textContent = t('notif.markAllRead');
  if (btnDeleteAll) btnDeleteAll.textContent = t('notif.deleteAll');

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
    note.innerHTML = `<div class="card-left"><div class="card-title">${t('notif.signInTitle')}</div><div class="card-sub">${t('notif.signInSub')}</div></div><div class="card-right">›</div>`;
    note.addEventListener('click', () => { location.href = 'auth.html?next=notifications.html'; });
    root.appendChild(note);
    markPtReady();
    return;
  }

  if (!notificationsEnabled()) {
    root.innerHTML = `<div class="empty-note">${t('notif.emptyDisabled')}</div>`;
    markPtReady();
    return;
  }

  notifMenu.hidden = false;
  root.innerHTML = `<div class="empty-note">Loading…</div>`;
  markPtReady();

  async function render() {
    try {
      const { notifications } = await Api.getNotifications();
      root.innerHTML = '';
      if (!notifications.length) {
        root.innerHTML = `<div class="empty-note">${t('notif.empty')}</div>`;
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
          ? { text: t('notif.groupedMessages', { name: bold(first.data.fromDisplayName), count: group.items.length }), avatarEmoji: first.data.fromAvatarEmoji, avatarUrl: first.data.fromAvatarUrl }
          : (LABELS[first.type] || (() => ({ text: esc(first.type), avatarEmoji: null, avatarUrl: null })))(first.data);

        const wrap = document.createElement('div');
        wrap.className = 'notif-row-wrap';
        wrap.innerHTML = `
          <div class="notif-swipe-bg notif-swipe-bg-read">✓ ${t('notif.swipeRead')}</div>
          <div class="notif-swipe-bg notif-swipe-bg-delete">🗑️ ${t('notif.swipeDelete')}</div>
        `;
        const row = document.createElement('div');
        row.className = 'notif-row' + (allRead ? '' : ' unread');
        row.innerHTML = `
          <div class="notif-avatar-wrap">
            <div class="notif-avatar"></div>
            <div class="notif-badge-icon" style="background:${TYPE_BADGE_BG[first.type] || '#555f6e'}">${typeIconSvg(first.type)}</div>
          </div>
          <div class="notif-text">${meta.text}</div>
          ${group.items.length > 1 ? `<div class="notif-count">${group.items.length}</div>` : ''}
          <div class="notif-time">${fmtTime(first.createdAt)}</div>
        `;
        setAvatar(row.querySelector('.notif-avatar'), { emoji: meta.avatarEmoji, url: meta.avatarUrl });
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
      root.innerHTML = `<div class="empty-note">${esc(err.message || t('notif.loadError'))}</div>`;
    }
  }

  btnMarkAllRead.addEventListener('click', async () => {
    closeMenu();
    await Api.markAllNotificationsRead().catch(() => {});
    render();
  });
  btnDeleteAll.addEventListener('click', async () => {
    closeMenu();
    if (!confirm(t('notif.deleteAllConfirm'))) return;
    await Api.deleteAllNotifications().catch(() => {});
    render();
  });

  render();
});
