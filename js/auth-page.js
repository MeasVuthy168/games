// js/auth-page.js — controller for auth.html. Google Sign-In is the only
// way to sign in or create an account — no password UI at all anymore.
import * as Api from './api.js';
import { initTranslations } from './i18n.js';

function nextUrl() {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/') === false && !n.includes('://') ? n : 'friends.html';
}

document.addEventListener('DOMContentLoaded', () => {
  initTranslations();
  if (Api.isSignedIn()) {
    location.href = nextUrl();
    return;
  }

  // The backend (a free-tier Render service) spins down after inactivity
  // and can take 30-60+ seconds to wake back up on its first request. Ping
  // it as soon as this page loads — while the user is still picking a
  // Google account — so it's hopefully already warm by the time the real
  // sign-in request goes out. Without this (and the loading message
  // below), a cold start looks exactly like sign-in silently doing
  // nothing at all.
  fetch(`${Api.getApiBase()}/ping`).catch(() => {});

  const authMsg = document.getElementById('authMsg');

  function showMsg(text, kind) {
    authMsg.innerHTML = '';
    if (!text) return;
    const el = document.createElement('div');
    el.className = kind === 'ok' ? 'auth-ok' : kind === 'loading' ? 'auth-loading' : 'auth-error';
    el.textContent = text;
    authMsg.appendChild(el);
  }

  /* ---------------- Sign in with Google ---------------- */
  // Only shown once a real Client ID is configured (see the meta tag in
  // auth.html) — Google's script itself would otherwise reject an empty
  // one, so this button simply never appears rather than showing a broken
  // one. No client secret involved on either end of this flow (see the
  // backend's POST /google for the trust chain).
  const googleClientId = document.querySelector('meta[name="google-signin-client-id"]')?.content?.trim();
  if (googleClientId) {
    async function handleGoogleCredential(response) {
      // Visible feedback from the moment Google hands back a credential —
      // otherwise a slow/cold backend looks identical to sign-in doing
      // nothing, which is exactly what was being reported.
      showMsg('Signing in…', 'loading');
      const slowNotice = setTimeout(() => {
        showMsg('Still signing in — the server is waking up, this can take up to a minute the first time…', 'loading');
      }, 4000);
      try {
        await Api.googleAuth(response.credential);
        clearTimeout(slowNotice);
        location.href = nextUrl();
      } catch (err) {
        clearTimeout(slowNotice);
        showMsg(err.message || 'Google sign-in failed');
      }
    }
    function initGoogle() {
      // itp_support tells GSI to route the credential back through an
      // intermediate iframe instead of relying on a cross-site cookie —
      // without it, Safari's Intelligent Tracking Prevention silently
      // drops the callback after the account picker closes (the picker
      // itself still renders fine, since that part doesn't need cookies),
      // which is exactly what "sign-in does nothing on iOS" looks like.
      google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCredential, itp_support: true });
      google.accounts.id.renderButton(document.getElementById('googleSignInBtn'), { theme: 'outline', size: 'large', width: 280 });
      document.getElementById('googleSignInSection').hidden = false;
    }
    if (window.google?.accounts?.id) initGoogle();
    else document.querySelector('script[src="https://accounts.google.com/gsi/client"]')?.addEventListener('load', initGoogle);
  }
});
