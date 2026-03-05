// ═══════════════════════════════════════════
// UI FLOW — Screen management, API calls, results
// ═══════════════════════════════════════════

import { TankGame } from './game.js';
import { SlotMachine } from './slots.js';
import { DEFAULTS } from './constants.js';

// ── DOM refs ──
const screens = {
  welcome: document.getElementById('screen-welcome'),
  game:    document.getElementById('screen-game'),
  slots:   document.getElementById('screen-slots'),
  results: document.getElementById('screen-results'),
};
const loading = document.getElementById('loading-overlay');

const inputName = document.getElementById('input-name');
const inputTeam = document.getElementById('input-team');

// ── Persist user fields ──
function loadSaved() {
  inputName.value = localStorage.getItem('ff1_name') || DEFAULTS.managerName;
  inputTeam.value = localStorage.getItem('ff1_team') || DEFAULTS.teamName;
}
function saveFields() {
  localStorage.setItem('ff1_name', inputName.value.trim());
  localStorage.setItem('ff1_team', inputTeam.value.trim());
}

// ── Screen switching ──
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── API call ──
async function fetchSelection(params) {
  const name = encodeURIComponent(inputName.value.trim() || DEFAULTS.managerName);
  const team = encodeURIComponent(inputTeam.value.trim() || DEFAULTS.teamName);

  let url = `/api/selection?name=${name}&team=${team}`;
  if (params.mode === 'random') {
    url += '&mode=random';
  } else {
    url += `&accuracy=${params.accuracy}`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Show results ──
function showResults(data) {
  loading.classList.add('hidden');

  // Rank
  document.getElementById('rank-number').textContent = `#${data.rank.toLocaleString()}`;
  document.getElementById('est-points').textContent = data.estPoints.toLocaleString();

  // Jackpot effect
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
  document.getElementById('result-cost').textContent = data.totalCost;
  document.getElementById('result-invest').textContent = data.investmentValue;

  // Email
  document.getElementById('email-body').textContent = data.emailBody;

  showScreen('results');
}

// ══════════════════════════
// TANK GAME SETUP
// ══════════════════════════

let tankGame = null;

function initTankGame() {
  const canvas = document.getElementById('game-canvas');
  const sliderAngle = document.getElementById('slider-angle');
  const sliderPower = document.getElementById('slider-power');
  const valAngle = document.getElementById('val-angle');
  const valPower = document.getElementById('val-power');
  const btnFire = document.getElementById('btn-fire');
  const windEl = document.getElementById('wind-indicator');

  tankGame = new TankGame(canvas, async (accuracy) => {
    // Projectile landed — fetch selection
    loading.classList.remove('hidden');
    try {
      const data = await fetchSelection({ accuracy });
      showResults(data);
    } catch (err) {
      console.error('API error:', err);
      loading.classList.add('hidden');
      alert('Failed to fetch selection. Check your connection and try again.');
      resetGame();
    }
  });

  // Update displays
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
    const angle = parseInt(sliderAngle.value);
    const power = parseInt(sliderPower.value);
    tankGame.fire(angle, power);
  });

  function resetGame() {
    tankGame.reset();
    btnFire.disabled = false;
    windEl.textContent = tankGame.getWindLabel();
    tankGame.draw(parseInt(sliderAngle.value));
  }

  // Initial draw
  windEl.textContent = tankGame.getWindLabel();
  tankGame.draw(parseInt(sliderAngle.value));

  // Expose reset
  return resetGame;
}

// ══════════════════════════
// SLOT MACHINE SETUP
// ══════════════════════════

let slotMachine = null;

function initSlotMachine() {
  const r1 = document.getElementById('reel-1');
  const r2 = document.getElementById('reel-2');
  const r3 = document.getElementById('reel-3');
  const btnSpin = document.getElementById('btn-spin');

  slotMachine = new SlotMachine(r1, r2, r3, (apiResult) => {
    // Reels stopped — show results
    showResults(apiResult);
    btnSpin.disabled = false;
  });

  btnSpin.addEventListener('click', async () => {
    if (slotMachine.spinning) return;
    btnSpin.disabled = true;
    saveFields();

    try {
      // Fetch from API
      const data = await fetchSelection({ mode: 'random' });
      // Start spinning (will call onComplete when done)
      slotMachine.spin(data);
    } catch (err) {
      console.error('API error:', err);
      btnSpin.disabled = false;
      alert('Failed to fetch selection. Check your connection and try again.');
    }
  });
}

// ══════════════════════════
// INIT + EVENT WIRING
// ══════════════════════════

let resetGameFn = null;

function init() {
  loadSaved();

  // Welcome → Game
  document.getElementById('btn-aim').addEventListener('click', () => {
    saveFields();
    showScreen('game');
    if (!tankGame) {
      resetGameFn = initTankGame();
    } else {
      resetGameFn();
    }
  });

  // Welcome → Slots
  document.getElementById('btn-slots').addEventListener('click', () => {
    saveFields();
    showScreen('slots');
    if (!slotMachine) {
      initSlotMachine();
    } else {
      slotMachine.reset();
    }
  });

  // Back buttons
  document.getElementById('btn-back-game').addEventListener('click', () => {
    if (tankGame) tankGame.reset();
    showScreen('welcome');
  });
  document.getElementById('btn-back-slots').addEventListener('click', () => {
    showScreen('welcome');
  });

  // Results → replay
  document.getElementById('btn-aim-again').addEventListener('click', () => {
    showScreen('game');
    if (resetGameFn) resetGameFn();
    else resetGameFn = initTankGame();
  });
  document.getElementById('btn-spin-again').addEventListener('click', () => {
    showScreen('slots');
    if (!slotMachine) initSlotMachine();
    else slotMachine.reset();
  });
  document.getElementById('btn-home').addEventListener('click', () => {
    showScreen('welcome');
  });

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
    // Extract subject from body (line 2)
    const lines = body.split('\n');
    const subjectLine = lines.find(l => l.startsWith('Subject:'));
    const subject = subjectLine ? subjectLine.replace('Subject: ', '') : DEFAULTS.emailSubject;
    // Remove To: and Subject: lines for the body
    const mailBody = lines.filter(l => !l.startsWith('To:') && !l.startsWith('Subject:')).join('\n').trim();
    const mailto = `mailto:${DEFAULTS.emailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`;
    window.open(mailto);
  });
}

init();
