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
export async function ensurePushSubscription() {
  if (!isPushSupported() || !Api.isSignedIn()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // already subscribed on this device
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
