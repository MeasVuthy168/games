// js/verify-email-page.js — controller for verify-email.html, the page the
// emailed verification link (from js/auth-page.js's signup or
// js/settings.js's resend button) points to: ?token=...&email=...
import * as Api from './api.js';
import { initTranslations } from './i18n.js';

document.addEventListener('DOMContentLoaded', async () => {
  initTranslations();
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const email = params.get('email') || '';
  const sub = document.getElementById('verifySub');
  const msg = document.getElementById('verifyMsg');

  function showMsg(text, kind) {
    msg.innerHTML = '';
    if (!text) return;
    const el = document.createElement('div');
    el.className = kind === 'ok' ? 'auth-ok' : 'auth-error';
    el.textContent = text;
    msg.appendChild(el);
  }

  if (!token || !email) {
    sub.textContent = '';
    showMsg('This verification link is missing information. Please request a new one from Settings.');
    return;
  }

  try {
    const res = await Api.verifyEmail({ email, token });
    sub.textContent = '';
    showMsg(res.message || 'Email verified.', 'ok');
  } catch (err) {
    sub.textContent = '';
    showMsg(err.message || 'That verification link is invalid or has expired.');
  }
});
