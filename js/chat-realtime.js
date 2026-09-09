// js/chat-realtime.js — thin SSE client for real-time chat push (see
// ouk-ai-backend's src/realtime.js for the server side and why SSE).
//
// EventSource's own built-in auto-reconnect can't be used as-is here: the
// stream authenticates via a single-use ticket in the URL, so simply
// letting the browser re-request the exact same URL after a drop would
// always fail (that ticket is already spent). This wrapper instead closes
// the dead connection itself and reconnects with a FRESH ticket, using its
// own capped exponential backoff.
import * as Api from './api.js';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

// Every event type the backend's src/realtime.js/routes/chat.js can push.
const EVENT_TYPES = [
  'message:new', 'message:delivered', 'message:read', 'message:deleted', 'message:pinned', 'message:unpinned',
  'typing:start', 'typing:stop',
  'presence:online', 'presence:offline',
];

// onEvent(type, data) — fired for every server-pushed event, already
// JSON-parsed (type is e.g. 'message:new', 'typing:start', ...). onOpen() —
// fired on every successful (re)connect, including after a drop; the caller
// uses this to backfill anything missed while disconnected (via the
// existing since= REST fallback) rather than trusting SSE alone to never
// miss an event. Returns { stop() } — call it when leaving the page/
// conversation to close the connection and cancel any pending reconnect
// timer (no dangling timers/connections).
export function connectChatStream({ onEvent, onOpen } = {}) {
  let es = null;
  let stopped = false;
  let reconnectTimer = null;
  let attempt = 0;

  async function connect() {
    if (stopped) return;
    let ticket;
    try {
      ticket = await Api.getChatStreamTicket();
    } catch {
      scheduleReconnect();
      return;
    }
    if (stopped) return;

    es = new EventSource(`${Api.getApiBase()}/api/chat/stream?ticket=${encodeURIComponent(ticket)}`);
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (e) => {
        try { onEvent?.(type, JSON.parse(e.data)); } catch { /* malformed event — ignore */ }
      });
    }
    es.onopen = () => { attempt = 0; onOpen?.(); };
    es.onerror = () => {
      // A single-use ticket means there's no reconnecting THIS EventSource
      // instance — always tear down and mint a fresh ticket on the next try.
      es?.close();
      es = null;
      if (!stopped) scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (stopped) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    attempt++;
    reconnectTimer = setTimeout(connect, delay);
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      es?.close();
      es = null;
    },
  };
}
