// js/chat-page.js — controller for chat.html. Two views on one page:
// conversation list (no ?friend= param) and a message thread (?friend=<id>).
//
// Thread delivery: real-time via Server-Sent Events (js/chat-realtime.js),
// backed by the same persisted `messages` table as before. Sending still
// goes through a normal POST — SSE only pushes what arrives (this side's
// own send included, so a second open tab/device stays in sync too).
// A REST since=/before= fallback (js/api.js's getMessages) backfills
// anything missed on (re)connect and paginates older history — nothing
// here depends on the SSE connection being up every second.
//
// Also covers delivered/read receipts, presence (online/last-seen), and a
// typing indicator — all pushed over the same SSE connection, no separate
// polling (see js/chat-realtime.js's EVENT_TYPES).
import * as Api from './api.js';
import { showToast } from './toast.js';
import { initTranslations, t } from './i18n.js';
import { connectChatStream } from './chat-realtime.js';

const $ = (sel) => document.querySelector(sel);
const TYPING_IDLE_MS = 2500;   // stop signaling "typing" after this much idle time
const TYPING_HIDE_MS = 5000;   // hide the friend's indicator if 'stop' is ever lost
const PRESENCE_REFRESH_MS = 60000; // re-render "last seen X ago" text periodically

// A small hand-picked set rather than a full emoji-picker library/dependency
// (Phase 13: "do not add a huge dependency unless necessary") — these render
// correctly from each platform's own system emoji font on both iPhone and
// Android without pulling in any image/sprite assets.
const EMOJI_LIST = [
  '😀','😂','🥹','😍','😘','😉','😊','🙂','😅','😭',
  '😢','😡','😱','🥳','😴','🤔','😎','🙄','😬','🤗',
  '👍','👎','👏','🙏','💪','🤝','👋','✌️','🤞','👌',
  '❤️','🧡','💛','💚','💙','💜','🖤','💔','💕','💯',
  '🔥','⭐','✨','🎉','🎂','☕','🍕','⚽','♟️','🤦',
];

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayKey(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtDaySeparator(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return t('chat.today');
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('chat.yesterday');
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtLastSeen(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diffMin = Math.floor((Date.now() - then) / 60000);
  if (diffMin < 1) return t('chat.lastSeenJustNow');
  if (diffMin < 60) return t('chat.lastSeenMinAgo', { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t('chat.lastSeenHoursAgo', { n: diffH });
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('chat.lastSeenYesterday');
  return t('chat.lastSeenDate', { date: new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Feather/Lucide-style 24x24 stroke icons, matching the outline icons
// already used elsewhere in the app (see play.html's fullscreen icons).
// Module-scope (not nested in renderThread) since both the message
// long-press menu and the conversation-row swipe menu share this set.
const MENU_ICONS = {
  copy: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="16" y2="15"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  trashUsers: '<path d="M3 6h11"/><path d="M12 6l-.4 5.5"/><path d="M5 6l.7 11.2A2 2 0 0 0 7.7 19H10"/><path d="M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/><circle cx="17" cy="14" r="1.8"/><path d="M13.8 21c0-1.7 1.4-3 3.2-3s3.2 1.3 3.2 3"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  bellOff: '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="2" y1="2" x2="22" y2="22"/>',
};

function menuIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = MENU_ICONS[name] || '';
  return svg;
}

function setConvAvatar(el, { emoji, url } = {}) {
  if (!el) return;
  if (url) { el.style.backgroundImage = `url("${url}")`; el.textContent = ''; }
  else { el.style.backgroundImage = ''; el.textContent = emoji || '🐯'; }
}

// Compact Messenger-style relative time for the conversation row's
// right-aligned timestamp ("now" / "5m" / "3h" / "2d" / a short date) —
// deliberately terser than fmtLastSeen's full "Last seen X ago" sentence,
// which doesn't fit a single row's right edge.
function fmtConvTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return t('chat.timeNow');
  if (diffMin < 60) return t('chat.timeMinShort', { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return t('chat.timeHourShort', { n: diffH });
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return t('chat.timeDayShort', { n: diffD });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Pointer-Events horizontal swipe for a conversation row: swipe left
// commits immediately (mark as read); swipe right reveals a small bottom
// sheet of conversation-level actions instead of committing anything by
// itself, since "mark as unread / Pin / Mute / Delete / unfriend" is too
// much to represent as instant single-direction swipe actions the way
// notifications-page.js's read/delete swipe does.
function attachConvSwipe(row, { bgRead, bgMenu, onSwipeLeft, onSwipeRight, onTap }) {
  const THRESHOLD = 70;
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
      if (Math.abs(ddx) <= Math.abs(ddy)) { dragging = false; return; }
      horizontal = true;
      row.setPointerCapture(pointerId);
    }
    // Once this is a real horizontal drag, stop the browser from also
    // interpreting the same touch as its own gesture — iOS Safari's
    // edge-swipe-back and rubber-band overscroll both compete for a
    // horizontal touch move and can eat some of the movement before our
    // handler sees it, which reads as "the swipe feels unreliable/wrong"
    // on a real touchscreen even though the exact same drag replays
    // correctly with a mouse (no competing gesture there to hijack it).
    e.preventDefault();
    dx = ddx;
    row.style.transform = `translateX(${dx}px)`;
    if (bgRead) bgRead.classList.toggle('show', dx < -20);
    if (bgMenu) bgMenu.classList.toggle('show', dx > 20);
  }, { passive: false });

  function finish(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    row.style.transition = 'transform .2s ease';
    row.style.transform = 'translateX(0)';
    if (bgRead) bgRead.classList.remove('show');
    if (bgMenu) bgMenu.classList.remove('show');
    if (!horizontal) { onTap(); return; }
    if (dx <= -THRESHOLD) onSwipeLeft();
    else if (dx >= THRESHOLD) onSwipeRight();
  }
  row.addEventListener('pointerup', finish);
  row.addEventListener('pointercancel', finish);
}

function convMenuItem(label, onClick, iconName, { danger } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-menu-item' + (danger ? ' danger' : '');
  btn.appendChild(menuIcon(iconName));
  const span = document.createElement('span');
  span.textContent = label;
  btn.appendChild(span);
  btn.addEventListener('click', onClick);
  return btn;
}

// View shell + SSE subscription are set up exactly once per page load (this
// runs once from the DOMContentLoaded handler at the bottom of the file);
// loadConversations() below is the repeatable part, called both for the
// initial fill and every time a live event or a menu action means the list
// needs to reflect new data — it never rebuilds the shell or reconnects the
// stream, so calling it often is cheap and doesn't pile up connections.
async function renderList() {
  const listView = $('#listView');
  listView.hidden = false;
  $('#threadView').hidden = true;

  listView.innerHTML = `
    <div class="chat-list" id="chatList"></div>
    <div class="msg-menu-overlay" id="convMenuOverlay" hidden>
      <div class="msg-menu" id="convMenu"></div>
    </div>
  `;
  const chatList = $('#chatList');
  const menuOverlay = $('#convMenuOverlay');
  const menuEl = $('#convMenu');

  function closeConvMenu() {
    menuOverlay.hidden = true;
    menuEl.innerHTML = '';
  }
  menuOverlay.addEventListener('click', (e) => { if (e.target === menuOverlay) closeConvMenu(); });

  async function openConvMenu(c) {
    menuEl.innerHTML = '';
    menuEl.appendChild(convMenuItem(t('chat.menuMarkUnread'), async () => {
      closeConvMenu();
      try { await Api.markThreadUnread(c.userId); loadConversations(); } catch { showToast(t('chat.actionFailed'), 'error'); }
    }, 'mail'));
    menuEl.appendChild(convMenuItem(c.pinned ? t('chat.menuUnpin') : t('chat.menuPin'), async () => {
      closeConvMenu();
      try { await Api.setConversationPrefs(c.userId, { pinned: !c.pinned }); loadConversations(); } catch { showToast(t('chat.actionFailed'), 'error'); }
    }, 'pin'));
    menuEl.appendChild(convMenuItem(c.muted ? t('chat.menuUnmute') : t('chat.menuMute'), async () => {
      closeConvMenu();
      try { await Api.setConversationPrefs(c.userId, { muted: !c.muted }); loadConversations(); } catch { showToast(t('chat.actionFailed'), 'error'); }
    }, 'bellOff'));
    const delBtn = convMenuItem(t('chat.menuDeleteConv'), async () => {
      closeConvMenu();
      if (!window.confirm(t('chat.deleteConvConfirm'))) return;
      try { await Api.deleteConversation(c.userId); loadConversations(); } catch { showToast(t('chat.actionFailed'), 'error'); }
    }, 'trash', { danger: true });
    menuEl.appendChild(delBtn);
    const unfriendBtn = convMenuItem(t('chat.menuUnfriend'), async () => {
      closeConvMenu();
      if (!window.confirm(t('friends.removeConfirm', { name: c.displayName }))) return;
      try { await Api.removeFriend(c.userId); loadConversations(); } catch { showToast(t('chat.actionFailed'), 'error'); }
    }, 'trashUsers', { danger: true });
    menuEl.appendChild(unfriendBtn);
    menuEl.appendChild(convMenuItem(t('chat.menuCancel'), closeConvMenu));
    menuOverlay.hidden = false;
  }

  async function loadConversations() {
    try {
      const conversations = await Api.getConversations();
      if (!conversations.length) {
        chatList.innerHTML = '<div class="empty-note">No conversations yet. Message a friend from the Friend tab.</div>';
        return;
      }
      chatList.innerHTML = '';
      for (const c of conversations) {
        const wrap = document.createElement('div');
        wrap.className = 'conv-row-wrap';
        wrap.innerHTML = `
          <div class="conv-bg conv-bg-read">${t('chat.swipeRead')}</div>
          <div class="conv-bg conv-bg-menu">${t('chat.swipeMore')}</div>
        `;
        const row = document.createElement('div');
        row.className = 'conv-row' + (c.unread ? ' unread' : '');
        row.innerHTML = `
          <span class="conv-dot"></span>
          <div class="conv-avatar"></div>
          <div class="conv-meta">
            <div class="conv-top">
              <span class="conv-name">${escapeHtml(c.displayName)}</span>
              <span class="conv-time">${c.lastMessage ? fmtConvTime(c.lastMessage.createdAt) : ''}</span>
            </div>
            <div class="conv-bottom">
              <span class="conv-preview">${c.lastMessage ? (c.lastMessage.fromMe ? t('chat.youPrefix') : '') + escapeHtml(c.lastMessage.deleted ? t('chat.deletedMessage') : c.lastMessage.body) : t('chat.sayHello')}</span>
              ${c.unread ? `<span class="conv-badge">${c.unread > 9 ? '9+' : c.unread}</span>` : ''}
              ${c.muted ? `<span class="conv-muted-icon">${menuIcon('bellOff').outerHTML}</span>` : ''}
            </div>
          </div>
        `;
        setConvAvatar(row.querySelector('.conv-avatar'), { emoji: c.avatarEmoji, url: c.avatarUrl });
        wrap.appendChild(row);
        attachConvSwipe(row, {
          bgRead: wrap.querySelector('.conv-bg-read'),
          bgMenu: wrap.querySelector('.conv-bg-menu'),
          onTap: () => { location.href = `chat.html?friend=${c.userId}`; },
          onSwipeLeft: async () => {
            try { await Api.markThreadRead(c.userId); loadConversations(); } catch { /* best-effort */ }
          },
          onSwipeRight: () => openConvMenu(c),
        });
        chatList.appendChild(wrap);
      }
    } catch (err) {
      chatList.innerHTML = `<div class="empty-note">${escapeHtml(err.message || 'Could not load conversations.')}</div>`;
    }
  }

  await loadConversations();

  // Live updates: a friend's incoming message, this account's own send from
  // another tab/device, or a read/delete elsewhere should all be reflected
  // here immediately, not only after a manual refresh/back-navigation — the
  // list previously only ever (re)fetched on page load. Any of these event
  // types can change what a row shows (preview text, unread badge/dot,
  // ordering), so just refetch the whole list rather than patching a single
  // row; it's a small, infrequent request either way.
  const stream = connectChatStream({
    onOpen: () => loadConversations(),
    onEvent: (type) => {
      // Every event on this stream already belongs to this account (the
      // server only ever publishes to a conversation's own two
      // participants) — no extra filtering needed here.
      if (type === 'message:new' || type === 'message:read' || type === 'message:deleted') loadConversations();
    },
  });
  const onLeave = () => stream.stop();
  window.addEventListener('beforeunload', onLeave);
  window.addEventListener('pagehide', onLeave);
}

async function renderThread(friendId) {
  const threadView = $('#threadView');
  $('#listView').hidden = true;
  threadView.hidden = false;

  const myId = Api.getCurrentUser()?.id;
  let friendName = 'Friend', friendEmoji = '🐯', friendAvatarUrl = null;
  try {
    const friends = await Api.getFriends();
    const f = friends.find(x => x.userId === friendId);
    if (f) { friendName = f.displayName; friendEmoji = f.avatarEmoji; friendAvatarUrl = f.avatarUrl; }
    else { threadView.innerHTML = '<div class="empty-note">You are not friends with this person.</div>'; return; }
  } catch {
    // fall through with defaults
  }

  threadView.innerHTML = `
    <div class="thread-wrap">
      <div class="thread-header">
        <a href="chat.html">‹</a>
        <div class="thread-avatar" id="threadAvatar"></div>
        <div class="thread-header-meta">
          <span class="thread-name">${escapeHtml(friendName)}</span>
          <span class="thread-presence" id="presenceStatus"></span>
        </div>
      </div>
      <button type="button" class="pinned-banner" id="pinnedBanner" hidden></button>
      <div class="thread-msgs" id="threadMsgs">
        <div class="load-older-spinner" id="loadOlderSpinner" hidden>${t('chat.loadingOlder')}</div>
      </div>
      <div class="typing-indicator" id="typingIndicator" hidden></div>
      <button type="button" class="new-msgs-pill" id="newMsgsPill" hidden>↓ <span data-i18n="chat.newMessages">${t('chat.newMessages')}</span></button>
      <div class="reply-preview" id="replyPreview" hidden>
        <div class="reply-preview-text">
          <div class="reply-preview-label">${t('chat.replyingTo')}</div>
          <div class="reply-preview-body" id="replyPreviewBody"></div>
        </div>
        <button type="button" class="reply-preview-cancel" id="replyPreviewCancel" aria-label="Cancel">✕</button>
      </div>
      <div class="emoji-panel" id="emojiPanel" hidden></div>
      <form class="thread-composer" id="composerForm">
        <button type="button" class="emoji-btn" id="emojiBtn" aria-label="${t('chat.emoji')}">😊</button>
        <input type="text" id="composerInput" maxlength="2000" placeholder="Message…" autocomplete="off" />
        <button type="submit" id="composerSend">Send</button>
      </form>
    </div>
    <div class="msg-menu-overlay" id="msgMenuOverlay" hidden>
      <div class="msg-menu" id="msgMenu"></div>
    </div>
    <div class="info-modal-overlay" id="infoModalOverlay" hidden>
      <div class="info-modal" id="infoModal"></div>
    </div>
  `;

  setConvAvatar($('#threadAvatar'), { emoji: friendEmoji, url: friendAvatarUrl });

  const msgsEl = $('#threadMsgs');
  const olderSpinner = $('#loadOlderSpinner');
  const newMsgsPill = $('#newMsgsPill');
  const typingEl = $('#typingIndicator');
  const presenceEl = $('#presenceStatus');
  const pinnedBanner = $('#pinnedBanner');
  const replyPreview = $('#replyPreview');
  const replyPreviewBody = $('#replyPreviewBody');
  const menuOverlay = $('#msgMenuOverlay');
  const menuEl = $('#msgMenu');
  const infoOverlay = $('#infoModalOverlay');
  const infoModal = $('#infoModal');

  // ---- state ----
  const nodesById = new Map();   // message id (real or temp) -> row element
  const dataById = new Map();    // message id -> last-known full message object (for the long-press menu/reply/info)
  let order = [];                // ids, ascending chronological
  let oldestId = null;           // for before= pagination
  let hasMoreOlder = false;
  let loadingOlder = false;
  let lastKnownTimestamp = null; // for since= reconnect gap-fill
  let nextTempSeq = 1;
  // FIFO of temp ids for sends still awaiting confirmation. Needed because
  // the sender's own message can be confirmed by EITHER the POST response
  // OR the SSE echo of it (this account is subscribed to its own sends too,
  // for multi-tab sync) — whichever arrives first, arriving no longer has a
  // fixed order once the POST route does extra awaited work (delivered_at)
  // before responding. reconcileTemp() below is idempotent so either path
  // can call it safely without ever producing a second bubble.
  const tempIdQueue = [];

  function isAtBottom() {
    return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
  }

  function scrollToBottom() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
    newMsgsPill.hidden = true;
  }

  // Only the handful of date-separator nodes get touched here — message
  // bubbles themselves are never re-created, so this stays cheap even on a
  // long, already-rendered thread (Phase 18: no repeated full re-render).
  function refreshDateSeparators() {
    for (const el of msgsEl.querySelectorAll('.date-sep')) el.remove();
    let prevDay = null;
    for (const id of order) {
      const node = nodesById.get(id);
      if (!node) continue;
      const day = node.dataset.day;
      if (day !== prevDay) {
        const sep = document.createElement('div');
        sep.className = 'date-sep';
        sep.textContent = fmtDaySeparator(node.dataset.createdAt);
        msgsEl.insertBefore(sep, node);
        prevDay = day;
      }
    }
  }

  // status: 'sending' | 'failed' | 'sent' | 'delivered' | 'read' (own
  // messages only — an incoming message never shows a status tick).
  function statusTicks(status) {
    if (status === 'read' || status === 'delivered') return '✓✓';
    if (status === 'sent') return '✓';
    return '';
  }

  function updateRowMeta(row, { fromMe, createdAt, status }) {
    const meta = row.querySelector('.msg-time');
    if (!meta) return;
    row.classList.remove('is-pending', 'is-failed', 'status-read');
    if (!fromMe) { meta.textContent = fmtTime(createdAt); return; }
    if (status === 'sending') { row.classList.add('is-pending'); meta.textContent = t('chat.sending'); return; }
    if (status === 'failed') { row.classList.add('is-failed'); meta.textContent = t('chat.sendFailed'); return; }
    row.classList.toggle('status-read', status === 'read');
    meta.textContent = `${fmtTime(createdAt)} · ${statusTicks(status)}`;
  }

  // (Re)renders the bubble's content area (reply-quote + body/deleted-
  // placeholder) from `m` — split out from buildRow() so a later delete/pin
  // SSE event can update an EXISTING row in place without rebuilding it.
  function renderBubbleContent(bubble, m) {
    bubble.innerHTML = '';
    if (m.replyTo) {
      const quote = document.createElement('div');
      quote.className = 'reply-quote';
      quote.textContent = m.replyTo.deleted ? t('chat.deletedMessage') : (m.replyTo.body || '');
      bubble.appendChild(quote);
    }
    const text = document.createElement('div');
    text.className = 'msg-bubble-text';
    if (m.deleted) { text.classList.add('is-deleted'); text.textContent = t('chat.deletedMessage'); }
    else { text.textContent = m.body; }
    bubble.appendChild(text);
  }

  function buildRow(m) {
    dataById.set(m.id, m);
    const row = document.createElement('div');
    row.className = 'msg-row' + (m.fromMe ? ' me' : '');
    row.dataset.day = dayKey(m.createdAt);
    row.dataset.createdAt = m.createdAt;
    row.dataset.msgId = m.id;
    row.dataset.status = m.status || (m.read ? 'read' : m.delivered ? 'delivered' : 'sent');

    const group = document.createElement('div');
    group.className = 'msg-group';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    renderBubbleContent(bubble, m);
    const meta = document.createElement('div');
    meta.className = 'msg-time';
    group.appendChild(bubble);
    group.appendChild(meta);
    row.appendChild(group);
    attachLongPress(bubble, row);

    updateRowMeta(row, { fromMe: m.fromMe, createdAt: m.createdAt, status: row.dataset.status });
    return row;
  }

  // ---- long-press message menu (Phase 7) ----
  const LONG_PRESS_MS = 550;
  let replyTarget = null; // the message object currently being replied to, or null

  // Takes the ROW element (not a fixed id) and reads its current
  // data-msg-id at the moment the press actually fires — a fixed id
  // captured at attach time would go stale the instant an optimistic
  // send's temp id gets renamed to its real one by reconcileTemp().
  function attachLongPress(el, row) {
    let timer = null;
    let moved = false;
    const start = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // long-press via left-click-hold only, for desktop parity
      moved = false;
      timer = setTimeout(() => { if (!moved) openMenu(row.dataset.msgId); }, LONG_PRESS_MS);
    };
    const cancel = () => { clearTimeout(timer); timer = null; };
    const onMove = () => { moved = true; cancel(); };
    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointermove', onMove);
  }

  function closeMenu() {
    menuOverlay.hidden = true;
    menuEl.innerHTML = '';
  }

  function menuItem(label, onClick, iconName) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-menu-item';
    if (iconName) btn.appendChild(menuIcon(iconName));
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.addEventListener('click', () => { closeMenu(); onClick(); });
    return btn;
  }

  function openMenu(id) {
    const m = dataById.get(id);
    if (!m || m.id.startsWith('local-')) return; // no menu on a still-pending optimistic bubble
    menuEl.innerHTML = '';
    if (!m.deleted) {
      menuEl.appendChild(menuItem(t('chat.menuCopy'), () => copyMessage(m), 'copy'));
      menuEl.appendChild(menuItem(t('chat.menuReply'), () => startReply(m), 'reply'));
      menuEl.appendChild(menuItem(m.pinned ? t('chat.menuUnpin') : t('chat.menuPin'), () => togglePin(m), 'pin'));
    }
    if (m.fromMe) menuEl.appendChild(menuItem(t('chat.menuInfo'), () => showInfo(id), 'info'));
    if (!m.deleted) {
      const delMe = menuItem(t('chat.menuDeleteMe'), () => confirmDelete(m, 'me'), 'trash');
      delMe.classList.add('danger');
      menuEl.appendChild(delMe);
      if (m.fromMe) {
        const delAll = menuItem(t('chat.menuDeleteEveryone'), () => confirmDelete(m, 'everyone'), 'trashUsers');
        delAll.classList.add('danger');
        menuEl.appendChild(delAll);
      }
    }
    menuEl.appendChild(menuItem(t('chat.menuCancel'), () => {}));
    menuOverlay.hidden = false;
  }
  menuOverlay.addEventListener('click', (e) => { if (e.target === menuOverlay) closeMenu(); });

  async function copyMessage(m) {
    try { await navigator.clipboard.writeText(m.body || ''); showToast(t('chat.copied'), 'success'); }
    catch { showToast(t('chat.copied'), 'success'); /* clipboard permission denied — still non-fatal */ }
  }

  function startReply(m) {
    replyTarget = m;
    replyPreviewBody.textContent = m.deleted ? t('chat.deletedMessage') : m.body;
    replyPreview.hidden = false;
    $('#composerInput').focus();
  }
  function clearReply() {
    replyTarget = null;
    replyPreview.hidden = true;
  }
  $('#replyPreviewCancel').addEventListener('click', clearReply);

  async function togglePin(m) {
    try {
      if (m.pinned) await Api.unpinMessage(friendId, m.id);
      else await Api.pinMessage(friendId, m.id);
    } catch { showToast(t('chat.pinFailed'), 'error'); }
  }

  async function confirmDelete(m, scope) {
    if (!window.confirm(t('chat.deleteConfirm'))) return;
    try {
      await Api.deleteMessage(friendId, m.id, scope);
      if (scope === 'everyone') applyDeleted(m.id);
      else removeRowLocally(m.id);
    } catch { showToast(t('chat.deleteFailed'), 'error'); }
  }

  function applyDeleted(id) {
    const row = nodesById.get(id);
    const m = dataById.get(id);
    if (!row || !m) return;
    m.deleted = true;
    m.body = null;
    dataById.set(id, m);
    const bubble = row.querySelector('.msg-bubble');
    if (bubble) renderBubbleContent(bubble, m);
    if (m.pinned) { m.pinned = false; refreshPinnedBanner(); }
  }

  function removeRowLocally(id) {
    const row = nodesById.get(id);
    if (row) row.remove();
    nodesById.delete(id);
    dataById.delete(id);
    const idx = order.indexOf(id);
    if (idx !== -1) order.splice(idx, 1);
    refreshDateSeparators();
    applyGrouping();
  }

  function setPinnedFlag(id, pinned) {
    // At most one pinned message per conversation server-side — mirror
    // that locally by clearing any other row's pinned flag first.
    if (pinned) for (const [otherId, data] of dataById) if (data.pinned && otherId !== id) { data.pinned = false; }
    const m = dataById.get(id);
    if (m) m.pinned = pinned;
    refreshPinnedBanner();
  }

  async function refreshPinnedBanner() {
    const pinnedEntry = [...dataById.values()].find(m => m.pinned);
    if (!pinnedEntry) {
      // Might be pinned further back than what's currently loaded (e.g.
      // right after opening the thread) — check the server once.
      try {
        const pinned = await Api.getPinnedMessage(friendId);
        if (pinned) {
          pinnedBanner.hidden = false;
          pinnedBanner.textContent = `📌 ${pinned.deleted ? t('chat.deletedMessage') : pinned.body}`;
          pinnedBanner.dataset.msgId = pinned.id;
          return;
        }
      } catch { /* leave banner as-is */ }
      pinnedBanner.hidden = true;
      pinnedBanner.textContent = '';
      return;
    }
    pinnedBanner.hidden = false;
    pinnedBanner.textContent = `📌 ${pinnedEntry.deleted ? t('chat.deletedMessage') : pinnedEntry.body}`;
    pinnedBanner.dataset.msgId = pinnedEntry.id;
  }
  pinnedBanner.addEventListener('click', () => {
    const id = pinnedBanner.dataset.msgId;
    const row = id && nodesById.get(id);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function showInfo(id) {
    const row = nodesById.get(id);
    const m = dataById.get(id);
    if (!row || !m) return;
    const status = row.dataset.status;
    const line = (label, shown) => `<div class="info-row"><span>${label}</span><span>${shown}</span></div>`;
    infoModal.innerHTML = `
      <h3>${t('chat.infoTitle')}</h3>
      ${line(t('chat.infoSent'), fmtTime(m.createdAt))}
      ${line(t('chat.infoDelivered'), (status === 'delivered' || status === 'read') ? fmtTime(m.createdAt) : t('chat.infoNotYet'))}
      ${line(t('chat.infoRead'), status === 'read' ? fmtTime(m.createdAt) : t('chat.infoNotYet'))}
      <button type="button" class="info-modal-close" id="infoModalClose">${t('chat.close')}</button>
    `;
    infoOverlay.hidden = false;
    $('#infoModalClose').addEventListener('click', () => { infoOverlay.hidden = true; });
  }
  infoOverlay.addEventListener('click', (e) => { if (e.target === infoOverlay) infoOverlay.hidden = true; });

  // Never downgrades (e.g. a late 'delivered' push arriving after we
  // already know a message was read shouldn't un-blue its ticks).
  const STATUS_RANK = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 0 };
  function setStatus(id, status) {
    const row = nodesById.get(id);
    if (!row) return;
    const current = row.dataset.status || 'sent';
    if ((STATUS_RANK[status] ?? 0) < (STATUS_RANK[current] ?? 0)) return;
    row.dataset.status = status;
    updateRowMeta(row, { fromMe: true, createdAt: row.dataset.createdAt, status });
  }

  // Groups consecutive same-sender messages (Phase 15): the CSS collapses
  // the gap between them; only the metadata line still shows per-message.
  function applyGrouping() {
    let prevSender = null;
    for (const id of order) {
      const node = nodesById.get(id);
      if (!node) continue;
      const sender = node.classList.contains('me') ? 'me' : 'them';
      node.classList.toggle('grouped', sender === prevSender);
      prevSender = sender;
    }
  }

  // Inserts in the right chronological SLOT rather than always appending —
  // guards against a rare out-of-order SSE delivery ever showing an older
  // message below a newer one.
  function insertInOrder(m) {
    if (nodesById.has(m.id)) return null;
    const row = buildRow(m);
    let insertBeforeIdx = order.length;
    for (let i = order.length - 1; i >= 0; i--) {
      const other = nodesById.get(order[i]);
      if (other && other.dataset.createdAt <= m.createdAt) { insertBeforeIdx = i + 1; break; }
      insertBeforeIdx = i;
    }
    const beforeId = order[insertBeforeIdx];
    const beforeNode = beforeId ? nodesById.get(beforeId) : null;
    if (beforeNode) msgsEl.insertBefore(row, beforeNode); else msgsEl.appendChild(row);
    order.splice(insertBeforeIdx, 0, m.id);
    nodesById.set(m.id, row);
    if (!lastKnownTimestamp || m.createdAt > lastKnownTimestamp) lastKnownTimestamp = m.createdAt;
    return row;
  }

  // Swaps the oldest still-pending optimistic (temp-id) row for its real,
  // server-confirmed id — idempotent, so it's safe to call from both the
  // POST response AND the SSE echo of the same send, whichever wins the
  // race; the second caller finds nothing left to reconcile and no-ops.
  function reconcileTemp(real) {
    const tempId = tempIdQueue.shift();
    if (!tempId) return false;
    const row = nodesById.get(tempId);
    if (!row) return false;
    nodesById.delete(tempId);
    const idx = order.indexOf(tempId);
    if (idx !== -1) order[idx] = real.id;
    nodesById.set(real.id, row);
    const data = dataById.get(tempId);
    dataById.delete(tempId);
    if (data) { data.id = real.id; dataById.set(real.id, data); }
    row.dataset.msgId = real.id;
    row.dataset.createdAt = real.createdAt;
    const status = real.delivered ? 'delivered' : 'sent';
    row.dataset.status = status;
    updateRowMeta(row, { fromMe: true, createdAt: real.createdAt, status });
    if (!lastKnownTimestamp || real.createdAt > lastKnownTimestamp) lastKnownTimestamp = real.createdAt;
    return true;
  }

  function prependMessages(msgs) {
    const wasHeight = msgsEl.scrollHeight;
    // oldest-first input; insert as a contiguous block right after the spinner.
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (nodesById.has(m.id)) continue;
      const row = buildRow(m);
      olderSpinner.after(row);
      order.unshift(m.id);
      nodesById.set(m.id, row);
    }
    refreshDateSeparators();
    applyGrouping();
    // Preserve the exact scroll position the user was at (prepending above
    // the viewport would otherwise yank the view down).
    msgsEl.scrollTop += (msgsEl.scrollHeight - wasHeight);
  }

  function addIncoming(m, { forceScroll = false } = {}) {
    const wasAtBottom = isAtBottom();
    const row = insertInOrder(m);
    if (!row) return; // duplicate — SSE echo of something already rendered
    refreshDateSeparators();
    applyGrouping();
    if (forceScroll || (m.fromMe && !m.pending) || wasAtBottom) {
      scrollToBottom();
    } else {
      newMsgsPill.hidden = false;
    }
  }

  async function markReadIfViewing() {
    if (!isAtBottom()) return;
    try { await Api.markThreadRead(friendId); } catch { /* transient — next chance will retry */ }
  }

  async function loadInitial() {
    try {
      const { messages, hasMore } = await Api.getMessages(friendId);
      for (const m of messages) insertInOrder(m);
      refreshDateSeparators();
      applyGrouping();
      oldestId = order[0] || null;
      hasMoreOlder = hasMore;
      scrollToBottom();
      await markReadIfViewing();
    } catch (err) {
      msgsEl.innerHTML = `<div class="empty-note">${escapeHtml(err.message || 'Could not load messages.')}</div>`;
    }
  }

  async function loadOlder() {
    if (loadingOlder || !hasMoreOlder || !oldestId) return;
    loadingOlder = true;
    olderSpinner.hidden = false;
    try {
      const { messages, hasMore } = await Api.getMessages(friendId, { before: oldestId });
      if (messages.length) {
        prependMessages(messages);
        oldestId = order[0] || oldestId;
      }
      hasMoreOlder = hasMore;
    } catch { /* leave hasMoreOlder as-is — user can retry by scrolling again */ }
    finally {
      olderSpinner.hidden = true;
      loadingOlder = false;
    }
  }

  async function backfillSince() {
    try {
      const { messages } = await Api.getMessages(friendId, { since: lastKnownTimestamp });
      for (const m of messages) addIncoming(m);
      if (messages.length) await markReadIfViewing();
    } catch { /* will retry on the next reconnect/open */ }
  }

  // ---- presence ----
  let presenceRefreshTimer = null;
  let lastPresence = null;
  function renderPresence() {
    if (!presenceEl || !lastPresence) return;
    if (lastPresence.online) { presenceEl.textContent = `🟢 ${t('chat.online')}`; presenceEl.classList.add('is-online'); return; }
    presenceEl.classList.remove('is-online');
    presenceEl.textContent = fmtLastSeen(lastPresence.lastActiveAt);
  }
  async function loadPresence() {
    try {
      lastPresence = await Api.getChatPresence(friendId);
      renderPresence();
    } catch { /* header just shows nothing — not worth retrying aggressively */ }
  }

  // ---- typing indicator (incoming) ----
  let typingHideTimer = null;
  function showFriendTyping() {
    if (!typingEl) return;
    typingEl.hidden = false;
    typingEl.textContent = `${friendName} ${t('chat.typing')}`;
    clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(hideFriendTyping, TYPING_HIDE_MS); // safety net if 'stop' is ever lost
  }
  function hideFriendTyping() {
    clearTimeout(typingHideTimer);
    if (typingEl) typingEl.hidden = true;
  }

  // ---- typing indicator (outgoing) — debounced: at most one 'start' per
  // burst of keystrokes, one 'stop' after idle/send/leave. Never one
  // request per keystroke. ----
  let typingActive = false;
  let typingIdleTimer = null;
  function stopTypingSignal() {
    clearTimeout(typingIdleTimer);
    if (!typingActive) return;
    typingActive = false;
    Api.sendTyping(friendId, false).catch(() => {});
  }
  function onComposerInput() {
    const hasText = !!$('#composerInput').value.trim();
    if (hasText && !typingActive) {
      typingActive = true;
      Api.sendTyping(friendId, true).catch(() => {});
    }
    clearTimeout(typingIdleTimer);
    if (hasText) typingIdleTimer = setTimeout(stopTypingSignal, TYPING_IDLE_MS);
    else stopTypingSignal();
  }

  msgsEl.addEventListener('scroll', () => {
    if (msgsEl.scrollTop < 80) loadOlder();
    if (isAtBottom()) newMsgsPill.hidden = true;
  });
  newMsgsPill.addEventListener('click', scrollToBottom);
  $('#composerInput').addEventListener('input', onComposerInput);

  // ---- emoji picker (Phase 13) ----
  const emojiBtn = $('#emojiBtn');
  const emojiPanel = $('#emojiPanel');
  if (!emojiPanel.childElementCount) {
    for (const em of EMOJI_LIST) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-item';
      b.textContent = em;
      b.addEventListener('click', () => insertEmoji(em));
      emojiPanel.appendChild(b);
    }
  }
  function insertEmoji(em) {
    const input = $('#composerInput');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + em + input.value.slice(end);
    const caret = start + em.length;
    input.focus();
    input.setSelectionRange(caret, caret);
    onComposerInput(); // an emoji counts as "typing" too, same debounce as text
  }
  emojiBtn.addEventListener('click', () => { emojiPanel.hidden = !emojiPanel.hidden; });
  document.addEventListener('click', (e) => {
    if (!emojiPanel.hidden && !emojiPanel.contains(e.target) && e.target !== emojiBtn) emojiPanel.hidden = true;
  });

  await loadInitial();
  await loadPresence();
  refreshPinnedBanner();
  presenceRefreshTimer = setInterval(renderPresence, PRESENCE_REFRESH_MS);

  const stream = connectChatStream({
    onOpen: () => { backfillSince(); loadPresence(); },
    onEvent: (type, data) => {
      switch (type) {
        case 'message:new': {
          // The push payload carries fromUserId/toUserId (not a
          // viewer-relative fromMe) — computed here so a second open tab
          // of the SENDER'S OWN account also renders its own message on
          // the right, not just the recipient's tab.
          const isMine = data.fromUserId === myId;
          // The SSE payload only carries a bare replyToId (not the
          // resolved {body, fromMe} snippet the REST endpoints join in) —
          // build it from whatever's already rendered in this thread. If
          // the replied-to message isn't currently loaded (rare — replying
          // to something further back than what's on screen), the quote
          // is simply omitted for this live-rendered instance; the next
          // full fetch (reload, or scrolling that message into view via
          // pagination) shows it correctly either way.
          const cachedReply = data.replyToId ? dataById.get(data.replyToId) : null;
          const replyTo = cachedReply
            ? { id: data.replyToId, body: cachedReply.deleted ? null : cachedReply.body, deleted: !!cachedReply.deleted, fromMe: cachedReply.fromMe }
            : null;
          // If this is an echo of a send THIS tab made, reconcile the
          // pending optimistic row first — whichever of the POST response
          // or this SSE echo happens to arrive first (see reconcileTemp's
          // own comment: extra awaited work server-side before responding
          // means arrival order isn't guaranteed). addIncoming() below is
          // then a safe no-op either way, since insertInOrder() already
          // dedupes by id and reconcileTemp() just claimed that id.
          if (isMine) reconcileTemp({ id: data.id, createdAt: data.createdAt, delivered: false });
          addIncoming({ ...data, fromMe: isMine, replyTo });
          if (!isMine) markReadIfViewing();
          break;
        }
        case 'message:delivered':
          for (const id of data.ids || []) setStatus(id, 'delivered');
          break;
        case 'message:read':
          for (const id of data.ids || []) setStatus(id, 'read');
          break;
        case 'message:deleted':
          if (data.scope === 'everyone') applyDeleted(data.id);
          break;
        case 'message:pinned':
          setPinnedFlag(data.id, true);
          break;
        case 'message:unpinned':
          setPinnedFlag(data.id, false);
          break;
        case 'typing:start':
          if (data.userId === friendId) showFriendTyping();
          break;
        case 'typing:stop':
          if (data.userId === friendId) hideFriendTyping();
          break;
        case 'presence:online':
          if (data.userId === friendId) { lastPresence = { online: true }; renderPresence(); }
          break;
        case 'presence:offline':
          if (data.userId === friendId) { lastPresence = { online: false, lastActiveAt: data.lastActiveAt }; renderPresence(); }
          break;
      }
    },
  });

  // Cleanup on leaving the page: no dangling SSE connection, reconnect
  // timer, presence-refresh interval, typing timers, or scroll listener
  // (Phase 18 — no memory leaks / background activity once chat isn't open).
  const onLeave = () => {
    stream.stop();
    clearInterval(presenceRefreshTimer);
    clearTimeout(typingHideTimer);
    stopTypingSignal();
  };
  window.addEventListener('beforeunload', onLeave);
  window.addEventListener('pagehide', onLeave);

  $('#composerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#composerInput');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    stopTypingSignal();

    const replyingTo = replyTarget; // snapshot — clearReply() below resets the module-level one
    clearReply();

    const tempId = `local-${Date.now()}-${nextTempSeq++}`;
    tempIdQueue.push(tempId);
    const optimistic = {
      id: tempId, fromMe: true, body, createdAt: new Date().toISOString(), status: 'sending',
      replyTo: replyingTo ? { id: replyingTo.id, body: replyingTo.deleted ? null : replyingTo.body, deleted: !!replyingTo.deleted, fromMe: replyingTo.fromMe } : null,
    };
    addIncoming(optimistic, { forceScroll: true });

    try {
      const res = await Api.sendMessage(friendId, body, replyingTo?.id);
      // Reconcile the temp row to its real id — a no-op if the SSE echo of
      // this same send already won that race and did it first (see the
      // 'message:new' case above); either way, apply the definitive
      // delivered status via setStatus's own never-downgrade guard, since
      // an SSE-driven reconcile only had a placeholder to work with.
      reconcileTemp({ id: res.id, createdAt: res.createdAt, delivered: res.delivered });
      setStatus(res.id, res.delivered ? 'delivered' : 'sent');
    } catch (err) {
      const idx = tempIdQueue.indexOf(tempId);
      if (idx !== -1) tempIdQueue.splice(idx, 1);
      const row = nodesById.get(tempId);
      if (row) { row.dataset.status = 'failed'; updateRowMeta(row, { fromMe: true, createdAt: optimistic.createdAt, status: 'failed' }); }
      showToast(err.message || 'Could not send message', 'error');
    } finally {
      input.focus();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTranslations();
  if (!Api.isSignedIn()) {
    location.href = `auth.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`;
    return;
  }
  const friendId = new URLSearchParams(location.search).get('friend');
  if (friendId) renderThread(friendId);
  else renderList();
});
