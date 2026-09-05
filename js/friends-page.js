// js/friends-page.js — controller for friends.html's real online-friends section.
import * as Api from './api.js';
import { showToast } from './toast.js';
import { initTranslations, t } from './i18n.js';
import { applyAvatarToElement } from './profile-data.js';

document.addEventListener('DOMContentLoaded', () => {
  initTranslations();
  const signedOutView = document.getElementById('signedOutView');
  const signedInView = document.getElementById('signedInView');

  if (!Api.isSignedIn()) {
    signedOutView.hidden = false;
    document.getElementById('btnGoSignIn').addEventListener('click', () => {
      location.href = 'auth.html?next=friends.html';
    });
    return;
  }

  signedInView.hidden = false;
  const meName = document.getElementById('meName');
  const searchInput = document.getElementById('searchInput');
  const btnSearch = document.getElementById('btnSearch');
  const searchResults = document.getElementById('searchResults');
  const incomingLabel = document.getElementById('incomingLabel');
  const incomingList = document.getElementById('incomingList');
  const friendsList = document.getElementById('friendsList');
  const friendsEmpty = document.getElementById('friendsEmpty');

  meName.textContent = Api.getCurrentUser()?.displayName || t('friends.you');

  document.getElementById('btnSignOut').addEventListener('click', () => {
    Api.signOut();
    location.reload();
  });

  function personRow({ emoji, avatarUrl, name, sub, actions }) {
    const row = document.createElement('div');
    row.className = 'person-row';
    const em = document.createElement('div');
    em.className = 'person-emoji avatar avatar-emoji';
    applyAvatarToElement(em, avatarUrl ? { type: 'image', value: avatarUrl } : { type: 'emoji', value: emoji || '🐯' });
    const nm = document.createElement('div');
    nm.className = 'person-name';
    nm.textContent = name;
    if (sub) {
      const subEl = document.createElement('div');
      subEl.className = 'person-sub';
      subEl.textContent = sub;
      nm.appendChild(document.createElement('br'));
      nm.appendChild(subEl);
    }
    const act = document.createElement('div');
    act.className = 'person-actions';
    for (const a of actions) act.appendChild(a);
    row.appendChild(em);
    row.appendChild(nm);
    row.appendChild(act);
    return row;
  }

  function btn(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  async function challenge(friendId) {
    try {
      const res = await Api.challengeFriend(friendId);
      location.href = `play.html?mode=online&gameId=${res.id}`;
    } catch (err) {
      if (err.status === 409) {
        // Already have a game with this friend — find it and go straight there.
        const games = await Api.getGames();
        const existing = games.find(g => g.opponentId === friendId && (g.status === 'pending' || g.status === 'active'));
        if (existing) { location.href = `play.html?mode=online&gameId=${existing.id}`; return; }
      }
      showToast(err.message || 'Could not start a game', 'error');
    }
  }

  async function loadFriends() {
    try {
      const friends = await Api.getFriends();
      friendsList.innerHTML = '';
      friendsEmpty.hidden = friends.length !== 0;
      for (const f of friends) {
        friendsList.appendChild(personRow({
          emoji: f.avatarEmoji,
          avatarUrl: f.avatarUrl,
          name: f.displayName,
          actions: [
            btn(t('friends.play'), 'btn-play', () => challenge(f.userId)),
            btn(t('friends.message'), 'btn-message', () => { location.href = `chat.html?friend=${f.userId}`; }),
            btn(t('friends.remove'), 'btn-remove', async () => {
              if (!confirm(t('friends.removeConfirm', { name: f.displayName }))) return;
              await Api.removeFriend(f.userId);
              loadFriends();
            }),
          ],
        }));
      }
    } catch (err) {
      friendsList.innerHTML = '';
      friendsEmpty.hidden = false;
      friendsEmpty.textContent = err.message || t('friends.couldNotLoad');
    }
  }

  async function loadGames() {
    try {
      const games = (await Api.getGames()).filter(g => g.status === 'pending' || g.status === 'active');
      const gamesList = document.getElementById('gamesList');
      const gamesLabel = document.getElementById('gamesLabel');
      gamesList.innerHTML = '';
      gamesLabel.hidden = games.length === 0;
      for (const g of games) {
        const amChallenger = g.myColor === 'w';
        let sub, actions;
        if (g.status === 'pending' && amChallenger) {
          sub = t('friends.waitingAccept');
          actions = [btn(t('friends.cancel'), 'btn-decline', async () => { await Api.declineGame(g.id).catch(() => {}); loadGames(); })];
        } else if (g.status === 'pending') {
          sub = t('friends.challengedYou');
          actions = [
            btn(t('friends.accept'), 'btn-accept', () => { location.href = `play.html?mode=online&gameId=${g.id}`; }),
            btn(t('friends.decline'), 'btn-decline', async () => { await Api.declineGame(g.id); loadGames(); }),
          ];
        } else {
          sub = g.myTurn ? t('friends.yourMove') : t('friends.waitingFor', { name: g.opponentName });
          actions = [btn(t('friends.continue'), 'btn-play', () => { location.href = `play.html?mode=online&gameId=${g.id}`; })];
        }
        gamesList.appendChild(personRow({ emoji: g.opponentAvatar, avatarUrl: g.opponentAvatarUrl, name: g.opponentName, sub, actions }));
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadRequests() {
    try {
      const { incoming } = await Api.getFriendRequests();
      incomingList.innerHTML = '';
      incomingLabel.hidden = incoming.length === 0;
      for (const r of incoming) {
        incomingList.appendChild(personRow({
          emoji: r.avatarEmoji,
          avatarUrl: r.avatarUrl,
          name: r.displayName,
          actions: [
            btn(t('friends.accept'), 'btn-accept', async () => { await Api.acceptFriendRequest(r.requestId); loadRequests(); loadFriends(); }),
            btn(t('friends.decline'), 'btn-decline', async () => { await Api.declineFriendRequest(r.requestId); loadRequests(); }),
          ],
        }));
      }
    } catch (err) {
      incomingLabel.hidden = true;
      console.error(err);
    }
  }

  async function doSearch() {
    const q = searchInput.value.trim();
    searchResults.innerHTML = '';
    if (q.length < 2) return;
    try {
      const users = await Api.searchUsers(q);
      const existingFriends = new Set((await Api.getFriends()).map(f => f.userId));
      for (const u of users) {
        const already = existingFriends.has(u.id);
        searchResults.appendChild(personRow({
          emoji: u.avatarEmoji,
          avatarUrl: u.avatarUrl,
          name: `${u.displayName} (${u.email})`,
          actions: already
            ? [btn(t('friends.alreadyFriend'), 'btn-remove', () => {})]
            : [btn(t('friends.addFriend'), 'btn-accept', async (e) => {
                e.target.disabled = true;
                e.target.textContent = t('friends.sent');
                try { await Api.sendFriendRequest(u.id); loadRequests(); } catch (err) { showToast(err.message, 'error'); }
              })],
        }));
      }
      if (!users.length) {
        const none = document.createElement('div');
        none.className = 'empty-note';
        none.textContent = t('friends.noMatches');
        searchResults.appendChild(none);
      }
    } catch (err) {
      searchResults.innerHTML = `<div class="empty-note">${err.message || t('friends.searchFailed')}</div>`;
    }
  }

  btnSearch.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  loadFriends();
  loadRequests();
  loadGames();
});
