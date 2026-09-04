// js/auth-page.js — controller for auth.html (sign in / sign up / forgot password).
import * as Api from './api.js';

function nextUrl() {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/') === false && !n.includes('://') ? n : 'friends.html';
}

document.addEventListener('DOMContentLoaded', () => {
  if (Api.isSignedIn()) {
    location.href = nextUrl();
    return;
  }

  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const formSignIn = document.getElementById('formSignIn');
  const formSignUp = document.getElementById('formSignUp');
  const formForgot = document.getElementById('formForgot');
  const authMsg = document.getElementById('authMsg');

  function showMsg(text, kind) {
    authMsg.innerHTML = '';
    if (!text) return;
    const el = document.createElement('div');
    el.className = kind === 'ok' ? 'auth-ok' : 'auth-error';
    el.textContent = text;
    authMsg.appendChild(el);
  }

  function showForm(which) {
    formSignIn.hidden = which !== 'signin';
    formSignUp.hidden = which !== 'signup';
    formForgot.hidden = which !== 'forgot';
    tabSignIn.classList.toggle('active', which === 'signin');
    tabSignUp.classList.toggle('active', which === 'signup');
    showMsg('');
  }

  tabSignIn.addEventListener('click', () => showForm('signin'));
  tabSignUp.addEventListener('click', () => showForm('signup'));
  document.getElementById('linkForgot').addEventListener('click', () => showForm('forgot'));
  document.getElementById('linkBackToSignIn').addEventListener('click', () => showForm('signin'));

  formSignIn.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('');
    try {
      await Api.signIn({
        email: document.getElementById('siEmail').value,
        password: document.getElementById('siPassword').value,
      });
      location.href = nextUrl();
    } catch (err) {
      showMsg(err.message || 'Sign in failed');
    }
  });

  formSignUp.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('');
    try {
      await Api.signUp({
        displayName: document.getElementById('suName').value,
        email: document.getElementById('suEmail').value,
        password: document.getElementById('suPassword').value,
      });
      location.href = nextUrl();
    } catch (err) {
      showMsg(err.message || 'Sign up failed');
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
});
