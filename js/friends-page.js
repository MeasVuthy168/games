// js/friends-page.js — controller for friends.html's real online-friends section.
import * as Api from './api.js';
import { showToast } from './toast.js';

document.addEventListener('DOMContentLoaded', () => {
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

  meName.textContent = Api.getCurrentUser()?.displayName || 'You';

  document.getElementById('btnSignOut').addEventListener('click', () => {
    Api.signOut();
    location.reload();
  });

  function personRow({ emoji, name, sub, actions }) {
    const row = document.createElement('div');
    row.className = 'person-row';
    const em = document.createElement('div');
    em.className = 'person-emoji';
    em.textContent = emoji || '🐯';
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
          name: f.displayName,
          actions: [
            btn('Play', 'btn-play', () => challenge(f.userId)),
            btn('Message', 'btn-message', () => { location.href = `chat.html?friend=${f.userId}`; }),
            btn('Remove', 'btn-remove', async () => {
              if (!confirm(`Remove ${f.displayName} as a friend?`)) return;
              await Api.removeFriend(f.userId);
              loadFriends();
            }),
          ],
        }));
      }
    } catch (err) {
      friendsList.innerHTML = '';
      friendsEmpty.hidden = false;
      friendsEmpty.textContent = err.message || 'Could not load friends.';
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
          sub = 'Waiting for them to accept';
          actions = [btn('Cancel', 'btn-decline', async () => { await Api.declineGame(g.id).catch(() => {}); loadGames(); })];
        } else if (g.status === 'pending') {
          sub = 'Challenged you to a game';
          actions = [
            btn('Accept', 'btn-accept', () => { location.href = `play.html?mode=online&gameId=${g.id}`; }),
            btn('Decline', 'btn-decline', async () => { await Api.declineGame(g.id); loadGames(); }),
          ];
        } else {
          sub = g.myTurn ? 'Your move' : `Waiting for ${g.opponentName}`;
          actions = [btn('Continue', 'btn-play', () => { location.href = `play.html?mode=online&gameId=${g.id}`; })];
        }
        gamesList.appendChild(personRow({ emoji: g.opponentAvatar, name: g.opponentName, sub, actions }));
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
          name: r.displayName,
          actions: [
            btn('Accept', 'btn-accept', async () => { await Api.acceptFriendRequest(r.requestId); loadRequests(); loadFriends(); }),
            btn('Decline', 'btn-decline', async () => { await Api.declineFriendRequest(r.requestId); loadRequests(); }),
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
          name: `${u.displayName} (${u.email})`,
          actions: already
            ? [btn('Friend ✓', 'btn-remove', () => {})]
            : [btn('Add Friend', 'btn-accept', async (e) => {
                e.target.disabled = true;
                e.target.textContent = 'Sent';
                try { await Api.sendFriendRequest(u.id); loadRequests(); } catch (err) { showToast(err.message, 'error'); }
              })],
        }));
      }
      if (!users.length) {
        const none = document.createElement('div');
        none.className = 'empty-note';
        none.textContent = 'No matching users.';
        searchResults.appendChild(none);
      }
    } catch (err) {
      searchResults.innerHTML = `<div class="empty-note">${err.message || 'Search failed'}</div>`;
    }
  }

  btnSearch.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  loadFriends();
  loadRequests();
  loadGames();
});
