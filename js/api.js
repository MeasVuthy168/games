// js/api.js — thin client for the real accounts/friends/chat/notifications
// backend (ouk-ai-backend). AI/tournament/rewards logic itself stays fully
// local and offline — this module is for the account layer (sign up/in,
// friends, chat, notifications) plus per-account coin/history sync (see
// js/coins.js and js/history.js, which call the functions below).

const BASE_KEY = 'kc_api_base_v1';
const AUTH_KEY = 'kc_auth_v1';

// Ships pointed at the deployed backend; overridable (e.g. for local dev
// against `node src/app.js`) from Settings without a code change.
const DEFAULT_API_BASE = 'https://ouk-ai-backend.onrender.com';

export function getApiBase() {
  try { return localStorage.getItem(BASE_KEY) || DEFAULT_API_BASE; }
  catch { return DEFAULT_API_BASE; }
}

export function setApiBase(url) {
  try { localStorage.setItem(BASE_KEY, String(url || '').trim() || DEFAULT_API_BASE); } catch {}
}

function readAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); }
  catch { return null; }
}

function writeAuth(auth) {
  try {
    if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(AUTH_KEY);
  } catch {}
}

export function getToken() {
  return readAuth()?.token || null;
}

export function getCurrentUser() {
  return readAuth()?.user || null;
}

export function isSignedIn() {
  return !!getToken();
}

export function signOut() {
  writeAuth(null);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

/* ---------------- auth ----------------
 * Google Login is the only sign-up/sign-in path the app's UI exposes (see
 * js/auth-page.js / auth.html). signUp, signIn, sendPhoneCode, sendEmailCode,
 * forgotPassword, changePassword, and resendVerification were legacy
 * password/email/phone-code exports with zero callers anywhere in the
 * frontend and were removed here; the backend routes behind them are left
 * untouched (existing password-based accounts, has_password on `users`, and
 * this session's own backend test suites still exercise them directly).
 * resetPassword/verifyEmail are kept below since reset-password.html and
 * verify-email.html (reachable from emailed links, not app navigation)
 * still call them. */

export async function googleAuth(credential) {
  const data = await request('/api/auth/google', { method: 'POST', body: { credential }, auth: false });
  writeAuth(data);
  return data.user;
}

export async function verifyEmail({ email, token }) {
  return request('/api/auth/verify-email', { method: 'POST', body: { email, token }, auth: false });
}

export async function resetPassword({ email, token, password }) {
  return request('/api/auth/reset-password', { method: 'POST', body: { email, token, password }, auth: false });
}

export async function fetchMe() {
  const data = await request('/api/auth/me', { method: 'GET' });
  const cur = readAuth();
  if (cur) writeAuth({ ...cur, user: data.user });
  return data.user;
}

export async function updateProfile({ displayName, avatarEmoji, avatarUrl }) {
  const data = await request('/api/auth/me', { method: 'PATCH', body: { displayName, avatarEmoji, avatarUrl } });
  const cur = readAuth();
  if (cur) writeAuth({ ...cur, user: data.user });
  return data.user;
}

export async function logoutAllDevices() {
  await request('/api/auth/logout-all', { method: 'POST' });
  signOut();
}

export async function deleteAccount() {
  await request('/api/auth/me', { method: 'DELETE' });
  signOut();
}

/* ---------------- users / friends ---------------- */

export async function searchUsers(q) {
  const data = await request(`/api/users/search?q=${encodeURIComponent(q)}`);
  return data.users;
}

export async function sendFriendRequest(toUserId) {
  return request('/api/friends/requests', { method: 'POST', body: { toUserId } });
}

export async function getFriendRequests() {
  return request('/api/friends/requests');
}

export async function acceptFriendRequest(requestId) {
  return request(`/api/friends/requests/${requestId}/accept`, { method: 'POST' });
}

export async function declineFriendRequest(requestId) {
  return request(`/api/friends/requests/${requestId}/decline`, { method: 'POST' });
}

export async function getFriends() {
  const data = await request('/api/friends');
  return data.friends;
}

export async function removeFriend(userId) {
  return request(`/api/friends/${userId}`, { method: 'DELETE' });
}

/* ---------------- chat ---------------- */

export async function getConversations() {
  const data = await request('/api/chat/conversations');
  return data.conversations;
}

// `opts.since` (ISO timestamp) — messages strictly after it, ascending
// (reconnect gap-fill). `opts.before` (a message id) — the page of
// messages immediately before it, ascending (infinite-scroll-up). Neither
// — the most recent page (initial load). Returns { messages, hasMore }.
export async function getMessages(friendId, opts = {}) {
  const params = new URLSearchParams();
  if (opts.since) params.set('since', opts.since);
  if (opts.before) params.set('before', opts.before);
  const q = params.toString() ? `?${params}` : '';
  const data = await request(`/api/chat/${friendId}/messages${q}`);
  return { messages: data.messages, hasMore: !!data.hasMore };
}

export async function sendMessage(friendId, body, replyToId) {
  return request(`/api/chat/${friendId}/messages`, { method: 'POST', body: replyToId ? { body, replyToId } : { body } });
}

export async function markThreadRead(friendId) {
  return request(`/api/chat/${friendId}/read`, { method: 'POST' });
}

export async function getChatPresence(friendId) {
  return request(`/api/chat/${friendId}/presence`);
}

export async function sendTyping(friendId, isTyping) {
  return request(`/api/chat/${friendId}/typing`, { method: 'POST', body: { typing: isTyping } });
}

// scope: 'me' (hides it from just this account's view) or 'everyone'
// (server-validated — only the original sender's request is honored).
export async function deleteMessage(friendId, messageId, scope) {
  return request(`/api/chat/${friendId}/messages/${messageId}`, { method: 'DELETE', body: { scope } });
}

export async function pinMessage(friendId, messageId) {
  return request(`/api/chat/${friendId}/messages/${messageId}/pin`, { method: 'POST' });
}

export async function unpinMessage(friendId, messageId) {
  return request(`/api/chat/${friendId}/messages/${messageId}/pin`, { method: 'DELETE' });
}

export async function getPinnedMessage(friendId) {
  const data = await request(`/api/chat/${friendId}/pinned`);
  return data.pinned;
}

// Mints a short-lived, single-use ticket for opening the chat SSE stream
// (see js/chat-realtime.js) — EventSource can't send an Authorization
// header, so this is how it authenticates instead.
export async function getChatStreamTicket() {
  const data = await request('/api/chat/stream-ticket', { method: 'POST' });
  return data.ticket;
}

/* ---------------- notifications ---------------- */

export async function getNotifications() {
  return request('/api/notifications');
}

export async function markNotificationRead(id) {
  return request(`/api/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead() {
  return request('/api/notifications/read-all', { method: 'POST' });
}

export async function deleteNotification(id) {
  return request(`/api/notifications/${id}`, { method: 'DELETE' });
}

export async function deleteAllNotifications() {
  return request('/api/notifications', { method: 'DELETE' });
}

/* ---------------- web push (real notifications while the app is closed) ---------------- */

export async function getVapidPublicKey() {
  return request('/api/push/vapid-public-key', { auth: false });
}

export async function subscribePush(subscription) {
  return request('/api/push/subscribe', { method: 'POST', body: { subscription } });
}

export async function unsubscribePush(endpoint) {
  return request('/api/push/unsubscribe', { method: 'POST', body: { endpoint } });
}

/* ---------------- online games ---------------- */

export async function challengeFriend(friendId) {
  return request('/api/games/challenge', { method: 'POST', body: { friendId } });
}

export async function getGames() {
  const data = await request('/api/games');
  return data.games;
}

export async function getGame(id) {
  return request(`/api/games/${id}`);
}

export async function acceptGame(id) {
  return request(`/api/games/${id}/accept`, { method: 'POST' });
}

export async function declineGame(id) {
  return request(`/api/games/${id}/decline`, { method: 'POST' });
}

export async function makeGameMove(id, from, to) {
  return request(`/api/games/${id}/move`, { method: 'POST', body: { from, to } });
}

export async function resignGame(id) {
  return request(`/api/games/${id}/resign`, { method: 'POST' });
}

/* ---------------- spectating (watch.html) ----------------
 * Read-only for a non-participant — the backend enforces this itself
 * (spectator_enabled gate on /live and /:id/spectate; every mutating route
 * above still requires participant match), these are just thin wrappers. */

// Games another participant has opted into spectator visibility, minus my
// own (nothing to "watch" in a game I'm already playing).
export async function getLiveGames() {
  const data = await request('/api/games/live');
  return data.games;
}

// Sanitized read-only view of one spectator-enabled game — no move/resign/
// accept/decline equivalent exists for this path.
export async function spectateGame(id) {
  const data = await request(`/api/games/${id}/spectate`);
  return data.game;
}

// Participant-only opt-in/out toggle for whether MY game can be listed/
// watched by non-participants at all. Off by default.
export async function setSpectatorEnabled(id, enabled) {
  return request(`/api/games/${id}/spectator`, { method: 'PATCH', body: { enabled: !!enabled } });
}

/* ---------------- stats (coins + game history) ---------------- */

export async function getStats() {
  return request('/api/stats');
}

export async function addCoinsRemote(delta) {
  return request('/api/stats/coins', { method: 'POST', body: { delta } });
}

export async function recordGameRemote(entry) {
  return request('/api/stats/history', { method: 'POST', body: entry });
}

export { ApiError };
