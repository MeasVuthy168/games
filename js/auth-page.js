// js/auth-page.js — controller for auth.html. Google Sign-In is the
// primary/only way to create an account; email/phone+password Sign In and
// Forgot Password stay available (behind a toggle) only for accounts that
// already have a real password from before this change.
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

  const formSignIn = document.getElementById('formSignIn');
  const formForgot = document.getElementById('formForgot');
  const authMsg = document.getElementById('authMsg');
  const linkShowLegacySignIn = document.getElementById('linkShowLegacySignIn');

  function showMsg(text, kind) {
    authMsg.innerHTML = '';
    if (!text) return;
    const el = document.createElement('div');
    el.className = kind === 'ok' ? 'auth-ok' : 'auth-error';
    el.textContent = text;
    authMsg.appendChild(el);
  }

  // Sign-up is Google-only now (see the removed email/phone/OTP form) —
  // Sign In with an existing password stays reachable for legacy accounts
  // created before this change, tucked behind this toggle so Google reads
  // as the primary/default option.
  function showForm(which) {
    formSignIn.hidden = which !== 'signin';
    formForgot.hidden = which !== 'forgot';
    linkShowLegacySignIn.hidden = true; // once in this flow, no need to show the toggle again
    showMsg('');
  }

  linkShowLegacySignIn.addEventListener('click', () => showForm('signin'));
  document.getElementById('linkForgot').addEventListener('click', () => showForm('forgot'));
  document.getElementById('linkBackToSignIn').addEventListener('click', () => showForm('signin'));

  formSignIn.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('');
    try {
      await Api.signIn({
        identifier: document.getElementById('siIdentifier').value.trim(),
        password: document.getElementById('siPassword').value,
      });
      location.href = nextUrl();
    } catch (err) {
      showMsg(err.message || 'Sign in failed');
    }
  });

  formForgot.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('');
    try {
      const res = await Api.forgotPassword(document.getElementById('fpEmail').value);
      showMsg(res.message || 'If that email has an account, a reset link has been sent.', 'ok');
    } catch (err) {
      showMsg(err.message || 'Something went wrong');
    }
  });

  /* ---------------- Sign in with Google ---------------- */
  // Only shown once a real Client ID is configured (see the meta tag in
  // auth.html) — Google's script itself would otherwise reject an empty
  // one, so this button simply never appears rather than showing a broken
  // one. No client secret involved on either end of this flow (see the
  // backend's POST /google for the trust chain).
  const googleClientId = document.querySelector('meta[name="google-signin-client-id"]')?.content?.trim();
  if (googleClientId) {
    async function handleGoogleCredential(response) {
      showMsg('');
      try {
        await Api.googleAuth(response.credential);
        location.href = nextUrl();
      } catch (err) {
        showMsg(err.message || 'Google sign-in failed');
      }
    }
    function initGoogle() {
      google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCredential });
      google.accounts.id.renderButton(document.getElementById('googleSignInBtn'), { theme: 'outline', size: 'large', width: 280 });
      document.getElementById('googleSignInSection').hidden = false;
    }
    if (window.google?.accounts?.id) initGoogle();
    else document.querySelector('script[src="https://accounts.google.com/gsi/client"]')?.addEventListener('load', initGoogle);
  }
});
