// js/chat-page.js — controller for chat.html. Two views on one page:
// conversation list (no ?friend= param) and a message thread (?friend=<id>).
// Delivery is polling REST (see js/api.js / backend README) — this polls
// the thread every few seconds for new rows, which is a real, working
// (if not push-instant) chat.
import * as Api from './api.js';
import { showToast } from './toast.js';

const POLL_MS = 4000;

function $(sel) { return document.querySelector(sel); }

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
          <div class="conv-name">${c.displayName}</div>
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

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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
      <div class="thread-msgs" id="threadMsgs"></div>
      <form class="thread-composer" id="composerForm">
        <input type="text" id="composerInput" maxlength="2000" placeholder="Message…" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </div>
  `;

  const msgsEl = $('#threadMsgs');
  let lastTimestamp = null;
  let seenIds = new Set();

  function appendMessage(m) {
    if (seenIds.has(m.id)) return;
    seenIds.add(m.id);
    const row = document.createElement('div');
    row.className = 'msg-row' + (m.fromMe ? ' me' : '');
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = m.body;
    row.appendChild(bubble);
    msgsEl.appendChild(row);
    if (!lastTimestamp || m.createdAt > lastTimestamp) lastTimestamp = m.createdAt;
  }

  async function loadInitial() {
    try {
      const messages = await Api.getMessages(friendId);
      for (const m of messages) appendMessage(m);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      await Api.markThreadRead(friendId);
    } catch (err) {
      msgsEl.innerHTML = `<div class="empty-note">${escapeHtml(err.message || 'Could not load messages.')}</div>`;
    }
  }

  async function poll() {
    try {
      const messages = await Api.getMessages(friendId, lastTimestamp);
      if (messages.length) {
        const wasAtBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 40;
        for (const m of messages) appendMessage(m);
        if (wasAtBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
        await Api.markThreadRead(friendId);
      }
    } catch { /* transient network hiccup — try again next tick */ }
  }

  await loadInitial();
  const pollHandle = setInterval(poll, POLL_MS);
  window.addEventListener('beforeunload', () => clearInterval(pollHandle));

  $('#composerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#composerInput');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    input.disabled = true;
    try {
      await Api.sendMessage(friendId, body);
      await poll();
    } catch (err) {
      showToast(err.message || 'Could not send message', 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!Api.isSignedIn()) {
    location.href = `auth.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`;
    return;
  }
  const friendId = new URLSearchParams(location.search).get('friend');
  if (friendId) renderThread(friendId);
  else renderList();
});
