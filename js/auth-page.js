// js/auth-page.js — controller for auth.html. Google Sign-In is the only
// way to sign in or create an account — no password UI at all anymore.
//
// Two different flows depending on how the page is running:
//  - A regular browser tab (Chrome, Safari, ...) uses Google Identity
//    Services' own popup-based button (initGoogle()) — this works fine.
//  - An installed home-screen app on iOS (navigator.standalone === true,
//    set by "Add to Home Screen") CANNOT reliably open the popup window
//    GIS's button needs — window.open is blocked/broken in that context,
//    so tapping the button does nothing at all. For that case, this
//    falls back to a full-page OAuth redirect (buildGoogleOAuthUrl() /
//    handleOAuthRedirectReturn() below) that never needs a popup: the
//    whole app navigates to Google and back, landing here again with the
//    ID token in the URL fragment. Same backend route either way — POST
//    /api/auth/google just verifies whatever ID token it's given.
import * as Api from './api.js';
import { initTranslations } from './i18n.js';

const OAUTH_STATE_KEY = 'kc_google_oauth_state_v1';

function nextUrl() {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/') === false && !n.includes('://') ? n : 'friends.html';
}

function isIOSStandaloneApp() {
  return window.navigator.standalone === true;
}

function randomToken() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

// Google's OpenID Connect implicit flow: response_type=id_token returns
// the ID token in the URL fragment (never sent to any server) after
// navigating back to redirect_uri — no popup, no backend involved in the
// redirect itself. redirect_uri must be registered in Google Cloud
// Console under this Client ID's "Authorized redirect URIs" (a bare URL,
// no query string — that's why `next` travels via `state` instead).
function buildGoogleOAuthUrl(clientId, state) {
  const redirectUri = `${location.origin}${location.pathname}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: randomToken(),
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

document.addEventListener('DOMContentLoaded', () => {
  initTranslations();

  const authMsg = document.getElementById('authMsg');
  function showMsg(text, kind) {
    authMsg.innerHTML = '';
    if (!text) return;
    const el = document.createElement('div');
    el.className = kind === 'ok' ? 'auth-ok' : kind === 'loading' ? 'auth-loading' : 'auth-error';
    el.textContent = text;
    authMsg.appendChild(el);
  }

  // The backend (a free-tier Render service) spins down after inactivity
  // and can take 30-60+ seconds to wake back up on its first request. Ping
  // it as soon as this page loads — while the user is still picking a
  // Google account — so it's hopefully already warm by the time the real
  // sign-in request goes out. Without this (and the loading message
  // below), a cold start looks exactly like sign-in silently doing
  // nothing at all.
  fetch(`${Api.getApiBase()}/ping`).catch(() => {});

  async function finishSignIn(credential, redirectTo) {
    // Visible feedback from the moment we have a credential — otherwise a
    // slow/cold backend looks identical to sign-in doing nothing.
    showMsg('Signing in…', 'loading');
    const slowNotice = setTimeout(() => {
      showMsg('Still signing in — the server is waking up, this can take up to a minute the first time…', 'loading');
    }, 4000);
    try {
      await Api.googleAuth(credential);
      clearTimeout(slowNotice);
      location.href = redirectTo;
    } catch (err) {
      clearTimeout(slowNotice);
      showMsg(err.message || 'Google sign-in failed');
    }
  }

  // Did we just land back here from the full-page OAuth redirect (the
  // standalone-app fallback)? Its response arrives in the URL fragment,
  // e.g. #id_token=...&state=...&nonce=... — never sent to any server.
  function handleOAuthRedirectReturn() {
    if (!location.hash.includes('id_token=') && !location.hash.includes('error=')) return false;
    const params = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search); // don't leave the token in the URL/history

    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(OAUTH_STATE_KEY) || 'null'); } catch { /* ignore */ }
    sessionStorage.removeItem(OAUTH_STATE_KEY);

    const error = params.get('error');
    if (error) { showMsg('Google sign-in was cancelled or failed.'); return true; }

    const idToken = params.get('id_token');
    const state = params.get('state');
    if (!idToken || !saved || state !== saved.state) { showMsg('Google sign-in failed — please try again.'); return true; }

    finishSignIn(idToken, saved.next || 'friends.html');
    return true;
  }

  if (handleOAuthRedirectReturn()) return;

  if (Api.isSignedIn()) {
    location.href = nextUrl();
    return;
  }

  /* ---------------- Sign in with Google ---------------- */
  // Only shown once a real Client ID is configured (see the meta tag in
  // auth.html) — Google's script itself would otherwise reject an empty
  // one, so this button simply never appears rather than showing a broken
  // one. No client secret involved on either end of this flow (see the
  // backend's POST /google for the trust chain).
  const googleClientId = document.querySelector('meta[name="google-signin-client-id"]')?.content?.trim();
  if (!googleClientId) return;

  const section = document.getElementById('googleSignInSection');

  if (isIOSStandaloneApp()) {
    // No popup involved at all — a plain button that navigates the whole
    // installed app to Google and back (see buildGoogleOAuthUrl() above).
    const fallbackBtn = document.getElementById('googleSignInFallbackBtn');
    fallbackBtn.hidden = false;
    fallbackBtn.addEventListener('click', () => {
      const state = randomToken();
      sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ state, next: nextUrl() }));
      location.href = buildGoogleOAuthUrl(googleClientId, state);
    });
    section.hidden = false;
    return;
  }

  function initGoogle() {
    // itp_support tells GSI to route the credential back through an
    // intermediate iframe instead of relying on a cross-site cookie —
    // without it, Safari's Intelligent Tracking Prevention silently
    // drops the callback after the account picker closes (the picker
    // itself still renders fine, since that part doesn't need cookies),
    // which is exactly what "sign-in does nothing on iOS" looks like.
    google.accounts.id.initialize({
      client_id: googleClientId,
      callback: (response) => finishSignIn(response.credential, nextUrl()),
      itp_support: true,
    });
    google.accounts.id.renderButton(document.getElementById('googleSignInBtn'), { theme: 'outline', size: 'large', width: 280 });
    section.hidden = false;
  }
  if (window.google?.accounts?.id) initGoogle();
  else document.querySelector('script[src="https://accounts.google.com/gsi/client"]')?.addEventListener('load', initGoogle);
});
