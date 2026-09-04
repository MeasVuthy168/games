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

  // Sign-up identity: Email (default, verified async via emailed link) or
  // Phone (verified up front via a Twilio Verify OTP before the account
  // is even created).
  const suModeEmail = document.getElementById('suModeEmail');
  const suModePhone = document.getElementById('suModePhone');
  const suEmailGroup = document.getElementById('suEmailGroup');
  const suPhoneGroup = document.getElementById('suPhoneGroup');
  const suEmail = document.getElementById('suEmail');
  const suPhone = document.getElementById('suPhone');
  const suCodeField = document.getElementById('suCodeField');
  const suCode = document.getElementById('suCode');
  const btnSendCode = document.getElementById('btnSendCode');
  let signupMode = 'email';

  function setSignupMode(mode) {
    signupMode = mode;
    suModeEmail.classList.toggle('active', mode === 'email');
    suModePhone.classList.toggle('active', mode === 'phone');
    suEmailGroup.hidden = mode !== 'email';
    suPhoneGroup.hidden = mode !== 'phone';
    suEmail.required = mode === 'email';
    suPhone.required = mode === 'phone';
  }
  setSignupMode('email');
  suModeEmail.addEventListener('click', () => setSignupMode('email'));
  suModePhone.addEventListener('click', () => setSignupMode('phone'));

  btnSendCode.addEventListener('click', async () => {
    showMsg('');
    const phone = suPhone.value.trim();
    if (!phone) { showMsg('Enter a phone number first (e.g. +85512345678).'); return; }
    btnSendCode.disabled = true;
    const label = btnSendCode.textContent;
    btnSendCode.textContent = 'Sending…';
    try {
      await Api.sendPhoneCode(phone);
      suCodeField.hidden = false;
      suCode.required = true;
      showMsg('Code sent — check your SMS.', 'ok');
    } catch (err) {
      showMsg(err.message || 'Could not send code');
    } finally {
      btnSendCode.disabled = false;
      btnSendCode.textContent = label;
    }
  });

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
        identifier: document.getElementById('siIdentifier').value.trim(),
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
        email: signupMode === 'email' ? suEmail.value : undefined,
        phone: signupMode === 'phone' ? suPhone.value.trim() : undefined,
        code: signupMode === 'phone' ? suCode.value.trim() : undefined,
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
