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

async function renderList() {
  const listView = $('#listView');
  listView.hidden = false;
  $('#threadView').hidden = true;

  listView.innerHTML = '<div class="chat-list" id="chatList"></div>';
  const chatList = $('#chatList');

  try {
    const conversations = await Api.getConversations();
    if (!conversations.length) {
      chatList.innerHTML = '<div class="empty-note">No conversations yet. Message a friend from the Friend tab.</div>';
      return;
    }
    for (const c of conversations) {
      const row = document.createElement('div');
      row.className = 'conv-row';
      row.innerHTML = `
        <div class="conv-emoji">${c.avatarEmoji || '🐯'}</div>
        <div class="conv-meta">
          <div class="conv-name">${escapeHtml(c.displayName)}</div>
          <div class="conv-preview">${c.lastMessage ? (c.lastMessage.fromMe ? 'You: ' : '') + escapeHtml(c.lastMessage.body) : 'Say hello!'}</div>
        </div>
        ${c.unread ? `<div class="conv-badge">${c.unread}</div>` : ''}
      `;
      row.addEventListener('click', () => { location.href = `chat.html?friend=${c.userId}`; });
      chatList.appendChild(row);
    }
  } catch (err) {
    chatList.innerHTML = `<div class="empty-note">${escapeHtml(err.message || 'Could not load conversations.')}</div>`;
  }
}

async function renderThread(friendId) {
  const threadView = $('#threadView');
  $('#listView').hidden = true;
  threadView.hidden = false;

  const myId = Api.getCurrentUser()?.id;
  let friendName = 'Friend', friendEmoji = '🐯';
  try {
    const friends = await Api.getFriends();
    const f = friends.find(x => x.userId === friendId);
    if (f) { friendName = f.displayName; friendEmoji = f.avatarEmoji; }
    else { threadView.innerHTML = '<div class="empty-note">You are not friends with this person.</div>'; return; }
  } catch {
    // fall through with defaults
  }

  threadView.innerHTML = `
    <div class="thread-wrap">
      <div class="thread-header">
        <a href="chat.html">‹</a>
        <span>${friendEmoji}</span>
        <div class="thread-header-meta">
          <span class="thread-name">${escapeHtml(friendName)}</span>
          <span class="thread-presence" id="presenceStatus"></span>
        </div>
      </div>
      <div class="thread-msgs" id="threadMsgs">
        <div class="load-older-spinner" id="loadOlderSpinner" hidden>${t('chat.loadingOlder')}</div>
      </div>
      <div class="typing-indicator" id="typingIndicator" hidden></div>
      <button type="button" class="new-msgs-pill" id="newMsgsPill" hidden>↓ <span data-i18n="chat.newMessages">${t('chat.newMessages')}</span></button>
      <form class="thread-composer" id="composerForm">
        <input type="text" id="composerInput" maxlength="2000" placeholder="Message…" autocomplete="off" />
        <button type="submit" id="composerSend">Send</button>
      </form>
    </div>
  `;

  const msgsEl = $('#threadMsgs');
  const olderSpinner = $('#loadOlderSpinner');
  const newMsgsPill = $('#newMsgsPill');
  const typingEl = $('#typingIndicator');
  const presenceEl = $('#presenceStatus');

  // ---- state ----
  const nodesById = new Map();   // message id (real or temp) -> row element
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

  function buildRow(m) {
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
    bubble.textContent = m.body;
    const meta = document.createElement('div');
    meta.className = 'msg-time';
    group.appendChild(bubble);
    group.appendChild(meta);
    row.appendChild(group);

    updateRowMeta(row, { fromMe: m.fromMe, createdAt: m.createdAt, status: row.dataset.status });
    return row;
  }

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

  await loadInitial();
  await loadPresence();
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
          // If this is an echo of a send THIS tab made, reconcile the
          // pending optimistic row first — whichever of the POST response
          // or this SSE echo happens to arrive first (see reconcileTemp's
          // own comment: extra awaited work server-side before responding
          // means arrival order isn't guaranteed). addIncoming() below is
          // then a safe no-op either way, since insertInOrder() already
          // dedupes by id and reconcileTemp() just claimed that id.
          if (isMine) reconcileTemp({ id: data.id, createdAt: data.createdAt, delivered: false });
          addIncoming({ ...data, fromMe: isMine });
          if (!isMine) markReadIfViewing();
          break;
        }
        case 'message:delivered':
          for (const id of data.ids || []) setStatus(id, 'delivered');
          break;
        case 'message:read':
          for (const id of data.ids || []) setStatus(id, 'read');
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

    const tempId = `local-${Date.now()}-${nextTempSeq++}`;
    tempIdQueue.push(tempId);
    const optimistic = { id: tempId, fromMe: true, body, createdAt: new Date().toISOString(), status: 'sending' };
    addIncoming(optimistic, { forceScroll: true });

    try {
      const res = await Api.sendMessage(friendId, body);
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
