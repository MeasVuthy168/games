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
import * as Api from './api.js';
import { showToast } from './toast.js';
import { initTranslations, t } from './i18n.js';
import { connectChatStream } from './chat-realtime.js';

const $ = (sel) => document.querySelector(sel);

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
        <span class="thread-name">${escapeHtml(friendName)}</span>
      </div>
      <div class="thread-msgs" id="threadMsgs">
        <div class="load-older-spinner" id="loadOlderSpinner" hidden>${t('chat.loadingOlder')}</div>
      </div>
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

  // ---- state ----
  const nodesById = new Map();   // message id (real or temp) -> row element
  let order = [];                // ids, ascending chronological
  let oldestId = null;           // for before= pagination
  let hasMoreOlder = false;
  let loadingOlder = false;
  let lastKnownTimestamp = null; // for since= reconnect gap-fill
  let nextTempSeq = 1;

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

  function buildRow(m) {
    const row = document.createElement('div');
    row.className = 'msg-row' + (m.fromMe ? ' me' : '');
    row.dataset.day = dayKey(m.createdAt);
    row.dataset.createdAt = m.createdAt;
    row.dataset.msgId = m.id;

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

    updateRowMeta(row, m);
    return row;
  }

  function updateRowMeta(row, m) {
    const meta = row.querySelector('.msg-time');
    if (!meta) return;
    if (m.fromMe) {
      const status = m.pending ? '' : m.failed ? '' : ' · ✓';
      meta.textContent = `${fmtTime(m.createdAt)}${status}`;
      if (m.pending) { meta.textContent = t('chat.sending'); row.classList.add('is-pending'); }
      else row.classList.remove('is-pending');
      if (m.failed) { row.classList.add('is-failed'); meta.textContent = t('chat.sendFailed'); }
      else row.classList.remove('is-failed');
    } else {
      meta.textContent = fmtTime(m.createdAt);
    }
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

  msgsEl.addEventListener('scroll', () => {
    if (msgsEl.scrollTop < 80) loadOlder();
    if (isAtBottom()) newMsgsPill.hidden = true;
  });
  newMsgsPill.addEventListener('click', scrollToBottom);

  await loadInitial();

  const stream = connectChatStream({
    onOpen: backfillSince,
    onMessage: (m) => {
      addIncoming(m);
      if (!m.fromMe) markReadIfViewing();
    },
  });

  // Cleanup on leaving the page: no dangling SSE connection, reconnect
  // timer, or scroll listener (Phase 18 — no memory leaks / background
  // activity once chat isn't open).
  const onLeave = () => stream.stop();
  window.addEventListener('beforeunload', onLeave);
  window.addEventListener('pagehide', onLeave);

  $('#composerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#composerInput');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';

    const tempId = `local-${Date.now()}-${nextTempSeq++}`;
    const optimistic = { id: tempId, fromMe: true, body, createdAt: new Date().toISOString(), pending: true };
    addIncoming(optimistic, { forceScroll: true });

    try {
      const res = await Api.sendMessage(friendId, body);
      // Reconcile: swap the temp row for the real, server-confirmed one so
      // a later SSE echo of this same message (see backend chat.js, which
      // pushes to the sender too) is recognized as a duplicate and skipped.
      const row = nodesById.get(tempId);
      if (row) {
        nodesById.delete(tempId);
        order[order.indexOf(tempId)] = res.id;
        nodesById.set(res.id, row);
        row.dataset.msgId = res.id;
        row.dataset.createdAt = res.createdAt;
        updateRowMeta(row, { fromMe: true, createdAt: res.createdAt, pending: false, failed: false });
        if (!lastKnownTimestamp || res.createdAt > lastKnownTimestamp) lastKnownTimestamp = res.createdAt;
      }
    } catch (err) {
      const row = nodesById.get(tempId);
      if (row) updateRowMeta(row, { fromMe: true, createdAt: optimistic.createdAt, pending: false, failed: true });
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
