// js/profile-data.js — local player identity (display name + avatar).
// There is no account system anywhere in this app; this is a purely local
// profile the player can edit themselves, persisted under its own
// localStorage key. Single source of truth — settings.html and profile.html
// both read/write through here instead of touching localStorage directly.

const LS_KEY = 'kc_profile_v1';

// Small built-in avatar set (emoji, so no new art assets are invented).
// A player can also upload their own photo — see setProfileAvatar below.
export const BUILTIN_AVATARS = ['🐯', '🐉', '🦁', '🐘', '🦅', '🐢', '🐎', '🦉'];

const DEFAULT_PROFILE = {
  name: 'Player',
  avatar: { type: 'emoji', value: BUILTIN_AVATARS[0] },
};

function isValidAvatar(a) {
  return !!a && (a.type === 'emoji' || a.type === 'image') && typeof a.value === 'string' && !!a.value;
}

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!v || typeof v !== 'object') return { ...DEFAULT_PROFILE };
    return {
      name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : DEFAULT_PROFILE.name,
      avatar: isValidAvatar(v.avatar) ? v.avatar : DEFAULT_PROFILE.avatar,
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function write(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {}
}

export function getProfile() {
  return read();
}

export function setProfileName(name) {
  const p = read();
  p.name = (name || '').trim() || DEFAULT_PROFILE.name;
  write(p);
  return p;
}

export function setProfileAvatar(avatar) {
  const p = read();
  if (isValidAvatar(avatar)) {
    p.avatar = avatar;
    write(p);
  }
  return p;
}

// Shared rendering helper so settings.html's profile bar and profile.html's
// hero card stay visually consistent without duplicating this logic.
// `el` should already carry the page-local `.avatar` base class.
export function applyAvatarToElement(el, avatar) {
  if (!el) return;
  if (avatar && avatar.type === 'image') {
    el.classList.remove('avatar-emoji');
    el.classList.add('avatar-image');
    el.style.backgroundImage = `url("${avatar.value}")`;
    el.textContent = '';
  } else {
    el.classList.remove('avatar-image');
    el.classList.add('avatar-emoji');
    el.style.backgroundImage = '';
    el.textContent = (avatar && avatar.value) || BUILTIN_AVATARS[0];
  }
}
