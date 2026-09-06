// js/push-client.js — Web Push subscribe/unsubscribe: the piece that lets
// a real notification reach this device even while every tab/PWA window
// is fully closed. Distinct from js/notif-badge.js's in-page polling
// (setInterval + toast/native-notification), which only ever works while
// a page is open — this is what was missing for a real background push.
//
// Receiving side: sw.js's `push` event listener. Sending side:
// ouk-ai-backend's src/push.js, triggered from src/notify.js whenever a
// real event (friend request, game move, ...) happens server-side.

import * as Api from './api.js';

// A PushSubscription is per BROWSER/ORIGIN, not per account — switching
// which account is signed in on the same device does NOT itself change
// or clear it (see ensurePushSubscription() below for why that matters).
// This tracks whose account the *server* currently has this device's one
// subscription attached to, so a real account switch on a shared device
// is detected and re-synced instead of silently leaving the previous
// account's id on the row (which is what let one account see push
// notifications meant for another that had used the same device/browser).
const SUBSCRIBED_USER_KEY = 'kc_push_subscribed_user_id';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

let vapidPublicKeyCache = null;
async function fetchVapidPublicKey() {
  if (vapidPublicKeyCache !== null) return vapidPublicKeyCache;
  try {
    const { publicKey } = await Api.getVapidPublicKey();
    vapidPublicKeyCache = publicKey || '';
  } catch {
    vapidPublicKeyCache = '';
  }
  return vapidPublicKeyCache;
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

// Subscribes this device to Web Push and persists it server-side against
// whoever is signed in. Safe to call repeatedly — pushManager.subscribe()
// itself returns the existing subscription when one is already active, so
// this never creates duplicates for the same browser/device.
export async function subscribeToPush() {
  if (!isPushSupported() || !Api.isSignedIn()) return false;
  try {
    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) return false; // backend has no VAPID keys configured yet
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await Api.subscribePush(sub.toJSON());
    try { localStorage.setItem(SUBSCRIBED_USER_KEY, Api.getCurrentUser()?.id || ''); } catch {}
    return true;
  } catch (e) {
    console.warn('[push-client] subscribe failed', e);
    return false;
  }
}

// Best-effort: unsubscribes locally AND tells the backend to forget this
// device, so turning the setting back on later starts clean instead of
// the backend still holding a subscription the browser already dropped.
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return;
  try { localStorage.removeItem(SUBSCRIBED_USER_KEY); } catch {}
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    if (Api.isSignedIn()) await Api.unsubscribePush(endpoint).catch(() => {});
  } catch { /* best-effort — a failed unsubscribe here just means the next
               enable/disable cycle re-syncs it */ }
}

// Self-healing, called on every page load (see js/notif-badge.js): if
// notifications are already enabled and OS permission is already granted
// but this device somehow has no active subscription (an existing
// "notifications on" user from before this feature shipped, a subscription
// the browser silently dropped, cleared site data, ...), quietly
// (re)establish one. Never prompts for permission itself — Notification.
// permission must already be 'granted' for this to do anything at all.
//
// Also re-subscribes when a DIFFERENT account is now signed in on this
// device than the one the server currently has this subscription
// attached to. A PushSubscription belongs to the browser/origin, not to
// whichever account is signed in — switching accounts on a shared device
// (sign out, sign in as someone else) leaves the OLD account's id on the
// row otherwise, so that device keeps receiving pushes meant for the
// account that isn't even signed in anymore (a real cross-account leak,
// not just stale data). Re-POSTing the exact same subscription under the
// new account's token re-associates it via the backend's own upsert.
export async function ensurePushSubscription() {
  if (!isPushSupported() || !Api.isSignedIn()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const myId = Api.getCurrentUser()?.id || '';
    let lastSubscribedId = '';
    try { lastSubscribedId = localStorage.getItem(SUBSCRIBED_USER_KEY) || ''; } catch {}
    if (existing && lastSubscribedId === myId) return; // already subscribed, same account as last time
    await subscribeToPush();
  } catch { /* best-effort */ }
}

// sw.js's pushsubscriptionchange handler (key rotation/expiry) rotates the
// subscription itself but can't call the backend from that scope — it
// posts the new subscription to any open page instead, which relays it.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'PUSH_RESUBSCRIBED' && e.data.subscription) {
      Api.subscribePush(e.data.subscription).catch(() => {});
    }
  });
}
