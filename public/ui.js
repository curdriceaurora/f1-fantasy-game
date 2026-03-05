// ═══════════════════════════════════════════
// UI FLOW — Screen management, API calls, results
// ═══════════════════════════════════════════

import { TankGame } from './game.js';
import { DEFAULTS, generateTeamName } from './constants.js';

// ── DOM refs ──
const screens = {
  welcome: document.getElementById('screen-welcome'),
  game:    document.getElementById('screen-game'),
  results: document.getElementById('screen-results'),
};
const loading = document.getElementById('loading-overlay');

const inputFirstName   = document.getElementById('input-firstname');
const inputLastName    = document.getElementById('input-lastname');
const inputTeam        = document.getElementById('input-team');
const sliderInvestment = document.getElementById('slider-investment');
const valInvestment    = document.getElementById('val-investment');
const btnPlay          = document.getElementById('btn-play');
const validationMsg    = document.getElementById('validation-msg');

// ── Investment label ──
function updateInvestmentLabel() {
  const inv = parseInt(sliderInvestment.value);
  const bonusPerRace = Math.floor(inv / 2);
  const seasonBonus  = bonusPerRace * 24;
  if (inv === 0) {
    valInvestment.textContent = `£0m → +0 pts/race`;
  } else {
    valInvestment.textContent = `£${inv}m → +${bonusPerRace} pts/race (+${seasonBonus} season)`;
  }
}

// ── Validation ──
function validate() {
  const fn = inputFirstName.value.trim();
  const ln = inputLastName.value.trim();
  const ok = fn.length > 0 && ln.length > 0;

  btnPlay.disabled = !ok;

  if (ok) {
    validationMsg.textContent = '';
    validationMsg.classList.remove('error');
  } else {
    const touched = inputFirstName.dataset.touched || inputLastName.dataset.touched;
    validationMsg.textContent = 'Enter your first and last name to play';
    validationMsg.classList.toggle('error', !!touched);
  }

  inputFirstName.classList.toggle('error', !fn && !!inputFirstName.dataset.touched);
  inputLastName.classList.toggle('error',  !ln && !!inputLastName.dataset.touched);
}

// ── Persist team name only ──
function loadSaved() {
  inputTeam.value = localStorage.getItem('ff1_team') || generateTeamName();
  updateInvestmentLabel();
  validate();
}
function saveFields() {
  localStorage.setItem('ff1_team', inputTeam.value.trim());
}

// ── Screen switching ──
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── API call ──
async function fetchSelection(accuracy) {
  const fullName   = `${inputFirstName.value.trim()} ${inputLastName.value.trim()}`;
  const name       = encodeURIComponent(fullName);
  const team       = encodeURIComponent(inputTeam.value.trim() || generateTeamName());
  const investment = parseInt(sliderInvestment.value);
  const url = `/api/selection?accuracy=${accuracy}&name=${name}&team=${team}&investment=${investment}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Show results ──
function showResults(data) {
  loading.classList.add('hidden');

  // Rank
  document.getElementById('rank-number').textContent = `#${data.rank.toLocaleString()}`;
  document.getElementById('rank-total').textContent  = `/ ${data.totalEntries.toLocaleString()}`;
  document.getElementById('est-points').textContent  = data.estPoints.toLocaleString();

  // Jackpot effect for top 100 in pool
  const container = document.querySelector('.results-container');
  container.classList.remove('jackpot');
  if (data.rank <= 100) container.classList.add('jackpot');

  // Drivers
  const driversEl = document.getElementById('result-drivers');
  driversEl.innerHTML = data.drivers.map(d =>
    `<div class="selection-item">${d.name} <span class="item-cost">£${d.cost}m</span></div>`
  ).join('');

  // Teams
  const teamsEl = document.getElementById('result-teams');
  teamsEl.innerHTML = data.teams.map(t =>
    `<div class="selection-item">${t.name} <span class="item-cost">£${t.cost}m</span></div>`
  ).join('');

  // Cost
  document.getElementById('result-cost').textContent   = data.totalCost;
  document.getElementById('result-invest').textContent = data.investmentValue;

  // Email
  document.getElementById('email-body').textContent = data.emailBody;

  showScreen('results');
}

// ══════════════════════════
// TANK GAME SETUP
// ══════════════════════════

let tankGame = null;
let resetGameFn = null;

function initTankGame() {
  const canvas      = document.getElementById('game-canvas');
  const sliderAngle = document.getElementById('slider-angle');
  const sliderPower = document.getElementById('slider-power');
  const valAngle    = document.getElementById('val-angle');
  const valPower    = document.getElementById('val-power');
  const btnFire     = document.getElementById('btn-fire');
  const windEl      = document.getElementById('wind-indicator');

  tankGame = new TankGame(canvas, async (accuracy) => {
    loading.classList.remove('hidden');
    try {
      const data = await fetchSelection(accuracy);
      showResults(data);
    } catch (err) {
      console.error('API error:', err);
      loading.classList.add('hidden');
      alert('Failed to fetch selection. Check your connection and try again.');
      resetGame();
    }
  });

  sliderAngle.addEventListener('input', () => {
    const deg = parseInt(sliderAngle.value);
    valAngle.textContent = `${deg}°`;
    tankGame.draw(deg);
  });

  sliderPower.addEventListener('input', () => {
    valPower.textContent = `${sliderPower.value}%`;
  });

  btnFire.addEventListener('click', () => {
    if (tankGame.state !== 'aiming') return;
    btnFire.disabled = true;
    tankGame.fire(parseInt(sliderAngle.value), parseInt(sliderPower.value));
  });

  function resetGame() {
    tankGame.reset();
    btnFire.disabled = false;
    windEl.textContent = tankGame.getWindLabel();
    tankGame.draw(parseInt(sliderAngle.value));
  }

  windEl.textContent = tankGame.getWindLabel();
  tankGame.draw(parseInt(sliderAngle.value));

  return resetGame;
}

// ══════════════════════════
// INIT + EVENT WIRING
// ══════════════════════════

function startGame() {
  saveFields();
  showScreen('game');
  if (!tankGame) {
    resetGameFn = initTankGame();
  } else {
    resetGameFn();
  }
}

function init() {
  loadSaved();

  // Name validation — live + on blur
  [inputFirstName, inputLastName].forEach(el => {
    el.addEventListener('input', validate);
    el.addEventListener('blur', () => {
      el.dataset.touched = '1';
      validate();
    });
  });

  // Team name regenerate
  document.getElementById('btn-regen-team').addEventListener('click', () => {
    inputTeam.value = generateTeamName();
  });

  // Investment slider
  sliderInvestment.addEventListener('input', updateInvestmentLabel);

  // Welcome → Game
  btnPlay.addEventListener('click', startGame);

  // Back button
  document.getElementById('btn-back-game').addEventListener('click', () => {
    if (tankGame) tankGame.reset();
    showScreen('welcome');
  });

  // Results → Try Again
  document.getElementById('btn-try-again').addEventListener('click', startGame);

  // Copy email
  document.getElementById('btn-copy').addEventListener('click', () => {
    const text = document.getElementById('email-body').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy');
      btn.textContent = '✅ Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋 Copy Email';
        btn.classList.remove('copied');
      }, 2000);
    });
  });

  // Mailto
  document.getElementById('btn-mailto').addEventListener('click', () => {
    const body = document.getElementById('email-body').textContent;
    const lines = body.split('\n');
    const subjectLine = lines.find(l => l.startsWith('Subject:'));
    const subject  = subjectLine ? subjectLine.replace('Subject: ', '') : DEFAULTS.emailSubject;
    const mailBody = lines.filter(l => !l.startsWith('To:') && !l.startsWith('Subject:')).join('\n').trim();
    window.open(`mailto:${DEFAULTS.emailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`);
  });
}

init();
