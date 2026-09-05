// js/rewards-page.js — controller for rewards.html.
import * as Rewards from './rewards.js';
import { initTranslations } from './i18n.js';

document.addEventListener('DOMContentLoaded', () => {
  initTranslations();
  Rewards.recordLoginToday();

  const streakLine = document.getElementById('streakLine');
  const objList = document.getElementById('objList');

  function render() {
    const streak = Rewards.getLoginStreak();
    streakLine.textContent = `Login streak: ${streak.current} day${streak.current === 1 ? '' : 's'}`;

    objList.innerHTML = '';
    for (const obj of Rewards.getObjectives()) {
      const card = document.createElement('div');
      card.className = 'obj-card' + (obj.completed ? ' is-complete' : '');

      const top = document.createElement('div');
      top.className = 'obj-top';
      const title = document.createElement('div');
      title.className = 'obj-title';
      title.textContent = obj.title;
      const reward = document.createElement('div');
      reward.className = 'obj-reward';
      reward.textContent = `+${obj.reward} coins`;
      top.appendChild(title);
      top.appendChild(reward);

      const bar = document.createElement('div');
      bar.className = 'obj-bar';
      const fill = document.createElement('div');
      fill.className = 'obj-bar-fill';
      fill.style.width = `${Math.round((obj.progress / obj.target) * 100)}%`;
      bar.appendChild(fill);

      const bottom = document.createElement('div');
      bottom.className = 'obj-bottom';
      const progressText = document.createElement('div');
      progressText.className = 'obj-progress-text';
      progressText.textContent = `${obj.progress} / ${obj.target}`;

      const claimBtn = document.createElement('button');
      claimBtn.type = 'button';
      if (obj.claimed) {
        claimBtn.className = 'obj-claim claimed';
        claimBtn.textContent = 'Claimed';
        claimBtn.disabled = true;
      } else if (obj.completed) {
        claimBtn.className = 'obj-claim can-claim';
        claimBtn.textContent = 'Claim';
        claimBtn.addEventListener('click', () => {
          const res = Rewards.claimReward(obj.id);
          if (res.ok) render();
        });
      } else {
        claimBtn.className = 'obj-claim';
        claimBtn.textContent = 'Claim';
        claimBtn.disabled = true;
      }

      bottom.appendChild(progressText);
      bottom.appendChild(claimBtn);

      card.appendChild(top);
      card.appendChild(bar);
      card.appendChild(bottom);
      objList.appendChild(card);
    }
  }

  render();
});
