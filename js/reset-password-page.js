// js/reset-password-page.js — controller for reset-password.html, the
// page the emailed reset link (from js/auth-page.js's forgot-password
// flow) points to: ?token=...&email=...
import * as Api from './api.js';

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const email = params.get('email') || '';
  const form = document.getElementById('formReset');
  const msg = document.getElementById('resetMsg');
  const sub = document.getElementById('resetSub');

  function showMsg(text, kind) {
    msg.innerHTML = '';
    if (!text) return;
    const el = document.createElement('div');
    el.className = kind === 'ok' ? 'auth-ok' : 'auth-error';
    el.textContent = text;
    msg.appendChild(el);
  }

  if (!token || !email) {
    showMsg('This reset link is missing information. Please request a new one from the sign-in page.');
    form.hidden = true;
    return;
  }
  sub.textContent = `Resetting the password for ${email}.`;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('');
    try {
      const res = await Api.resetPassword({ email, token, password: document.getElementById('rpPassword').value });
      showMsg(res.message || 'Password updated. Please sign in again.', 'ok');
      form.hidden = true;
      setTimeout(() => { location.href = 'auth.html'; }, 1500);
    } catch (err) {
      showMsg(err.message || 'That reset link is invalid or has expired.');
    }
  });
});
