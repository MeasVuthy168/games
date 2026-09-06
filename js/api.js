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

/* ---------------- auth ---------------- */

export async function signUp({ email, phone, code, password, displayName }) {
  const data = await request('/api/auth/signup', { method: 'POST', body: { email, phone, code, password, displayName }, auth: false });
  writeAuth(data);
  return data.user;
}

export async function sendPhoneCode(phone) {
  return request('/api/auth/phone/send-code', { method: 'POST', body: { phone }, auth: false });
}

export async function sendEmailCode(email) {
  return request('/api/auth/email/send-code', { method: 'POST', body: { email }, auth: false });
}

export async function googleAuth(credential) {
  const data = await request('/api/auth/google', { method: 'POST', body: { credential }, auth: false });
  writeAuth(data);
  return data.user;
}

// `identifier` is either an email or a phone number — the backend tells
// them apart by whether it contains "@".
export async function signIn({ identifier, password }) {
  const isEmail = identifier.includes('@');
  const body = isEmail ? { email: identifier, password } : { phone: identifier, password };
  const data = await request('/api/auth/signin', { method: 'POST', body, auth: false });
  writeAuth(data);
  return data.user;
}

export async function verifyEmail({ email, token }) {
  return request('/api/auth/verify-email', { method: 'POST', body: { email, token }, auth: false });
}

export async function resendVerification() {
  return request('/api/auth/resend-verification', { method: 'POST' });
}

export async function forgotPassword(email) {
  return request('/api/auth/forgot-password', { method: 'POST', body: { email }, auth: false });
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

export async function changePassword({ currentPassword, newPassword }) {
  const data = await request('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  writeAuth(data);
  return data.user;
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

export async function getMessages(friendId, since) {
  const q = since ? `?since=${encodeURIComponent(since)}` : '';
  const data = await request(`/api/chat/${friendId}/messages${q}`);
  return data.messages;
}

export async function sendMessage(friendId, body) {
  return request(`/api/chat/${friendId}/messages`, { method: 'POST', body: { body } });
}

export async function markThreadRead(friendId) {
  return request(`/api/chat/${friendId}/read`, { method: 'POST' });
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
