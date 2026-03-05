// ═══════════════════════════════════════════
// UI FLOW — Screen management, API calls, results
// ═══════════════════════════════════════════

import { TankGame } from './game.js';
import { DEFAULTS, generateTeamName, TEAM_LOGO_SLUGS, TEAM_COLORS, DRIVERS, TEAMS, PREDICTIONS as DEFAULT_PREDICTIONS } from './constants.js';

// ── Clipboard helper: modern API with execCommand fallback ──
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for HTTP / restricted contexts
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy') ? resolve() : reject();
    } catch (e) {
      reject(e);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

// ── DOM refs ──
const screens = {
  welcome: document.getElementById('screen-welcome'),
  game: document.getElementById('screen-game'),
  results: document.getElementById('screen-results'),
};
const loading = document.getElementById('loading-overlay');

// ── Game state for results screen ──
let gameState = null;
const selectedPredictions = {
  homeCircuit: DEFAULT_PREDICTIONS.homeCircuit,
  driverChampion: DEFAULT_PREDICTIONS.driverChampion,
  constructorChampion: DEFAULT_PREDICTIONS.constructorChampion,
  totalClassified: DEFAULT_PREDICTIONS.totalClassified,
  colaPosition: DEFAULT_PREDICTIONS.bestPosColapinto.match(/\d+/) ? parseInt(DEFAULT_PREDICTIONS.bestPosColapinto) : 12,
};

const inputFirstName = document.getElementById('input-firstname');
const inputLastName = document.getElementById('input-lastname');
const inputTeam = document.getElementById('input-team');
const sliderInvestment = document.getElementById('slider-investment');
const valInvestment = document.getElementById('val-investment');
const btnPlay = document.getElementById('btn-play');
const validationMsg = document.getElementById('validation-msg');

// ── Game screen invest slider ──
const gameSliderInvest = document.getElementById('game-slider-invest');
const gameValInvest = document.getElementById('game-val-invest');

// ── Game screen invest label ──
function updateGameInvestLabel() {
  const inv = parseInt(gameSliderInvest.value);
  const bonusPerRace = Math.floor(inv / 2);
  gameValInvest.textContent = inv === 0
    ? `£0m → no bonus`
    : `£${inv}m → +${bonusPerRace} pts/race`;
  fillSlider(gameSliderInvest, '#ffd700', '#16213e');
}

// ── Slider fill (paints the left portion of the track) ──
function fillSlider(slider, fillColor = '#e10600', emptyColor = '#16213e') {
  const min = parseFloat(slider.min) || 0;
  const max = parseFloat(slider.max) || 100;
  const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
  slider.style.background =
    `linear-gradient(to right, ${fillColor} ${pct}%, ${emptyColor} ${pct}%)`;
}

// ── Investment label ──
function updateInvestmentLabel() {
  const inv = parseInt(sliderInvestment.value);
  const bonusPerRace = Math.floor(inv / 2);
  const seasonBonus = bonusPerRace * 24;
  if (inv === 0) {
    valInvestment.textContent = `£0m → +0 pts/race`;
  } else {
    valInvestment.textContent = `£${inv}m → +${bonusPerRace} pts/race (+${seasonBonus} season)`;
  }
  fillSlider(sliderInvestment);
}

// ── Validation ──
function validate() {
  const fn = inputFirstName.value.trim();
  const ln = inputLastName.value.trim();
  const ok = fn.length > 0 && ln.length > 0;

  btnPlay.disabled = !ok;

  if (ok) {
    validationMsg.textContent = '';
    validationMsg.classList.remove('error', 'info');
  } else {
    const touched = inputFirstName.dataset.touched || inputLastName.dataset.touched;
    if (touched) {
      validationMsg.textContent = '⚠ First and last name are required';
      validationMsg.classList.add('error');
      validationMsg.classList.remove('info');
    } else {
      validationMsg.textContent = 'ⓘ Fields marked * are required to play';
      validationMsg.classList.add('info');
      validationMsg.classList.remove('error');
    }
  }

  inputFirstName.classList.toggle('error', !fn && !!inputFirstName.dataset.touched);
  inputLastName.classList.toggle('error', !ln && !!inputLastName.dataset.touched);
}

// ── Persist team name only ──
function loadSaved() {
  inputTeam.value = localStorage.getItem('ff1_team') || generateTeamName();
  updateInvestmentLabel();
  validate();
}
function saveFields() {
  localStorage.setItem('ff1_team', inputTeam.value.trim());
  localStorage.setItem('ff1_first', inputFirstName.value.trim());
  localStorage.setItem('ff1_last', inputLastName.value.trim());
}

// ── Screen switching ──
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── API call ──
async function fetchSelection(accuracy) {
  const fullName = `${inputFirstName.value.trim()} ${inputLastName.value.trim()}`;
  const name = encodeURIComponent(fullName);
  const team = encodeURIComponent(inputTeam.value.trim() || generateTeamName());
  const investment = parseInt(gameSliderInvest.value);   // reads game-screen slider
  const url = `/api/selection?accuracy=${accuracy}&name=${name}&team=${team}&investment=${investment}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Build email with custom predictions ──
function rebuildEmail() {
  if (!gameState) return;
  const p = selectedPredictions;
  const managerName = gameState.managerName;
  const teamName = gameState.teamName;
  const email = [
    `To: mblewis@ntlworld.com`,
    `Subject: Martin's FF1 2026 - Entry Submission`,
    ``,
    `Hi Martin,`,
    ``,
    `Please find my entry for Martin's FF1 2026 below. Hoping to sneak in before the deadline!`,
    ``,
    `Team Manager: ${managerName}`,
    `Team Name: ${teamName}`,
    ``,
    `Driver 1: ${gameState.drivers[0].name} (${gameState.drivers[0].team}) - £${gameState.drivers[0].cost}m`,
    `Driver 2: ${gameState.drivers[1].name} (${gameState.drivers[1].team}) - £${gameState.drivers[1].cost}m`,
    `Driver 3: ${gameState.drivers[2].name} (${gameState.drivers[2].team}) - £${gameState.drivers[2].cost}m`,
    ``,
    `Team 1: ${gameState.teams[0].name} - £${gameState.teams[0].cost}m`,
    `Team 2: ${gameState.teams[1].name} - £${gameState.teams[1].cost}m`,
    `Team 3: ${gameState.teams[2].name} - £${gameState.teams[2].cost}m`,
    ``,
    `Total Team Cost: £${gameState.totalCost}m`,
    `Investment Value: £${gameState.investmentValue}m`,
    ``,
    `Home Circuit: ${p.homeCircuit}`,
    `Driver Champion: ${p.driverChampion}`,
    `Constructor Champion: ${p.constructorChampion}`,
    `Total Classified: ${p.totalClassified}`,
    `Best Pos. (Colapinto): P${p.colaPosition}`,
    ``,
    `Happy to pay the £15 entry fee electronically - please send me the details.`,
    ``,
    `All the best,`,
    `${managerName}`,
  ].join('\n');
  document.getElementById('email-body').textContent = email;
}

// ── Home circuits with drivers ──
const HOME_CIRCUITS = [
  { circuit: 'Australia', drivers: ['Piastri'] },
  { circuit: 'Canada', drivers: ['Stroll'] },
  { circuit: 'Monaco', drivers: ['Leclerc'] },
  { circuit: 'Spain', drivers: ['Sainz', 'Alonso'] },
  { circuit: 'Britain', drivers: ['Hamilton', 'Russell', 'Norris', 'Bearman', 'Lindblad'] },
  { circuit: 'Netherlands', drivers: ['Verstappen'] },
  { circuit: 'Italy', drivers: ['Antonelli'] },
  { circuit: 'Madrid', drivers: ['Sainz', 'Alonso'] },
  { circuit: 'Mexico', drivers: ['Perez'] },
  { circuit: 'Brazil', drivers: ['Bortoleto'] },
];

// ── Initialize prediction dropdowns and sliders ──
function initializePredictions() {
  // Home Circuit dropdown
  const homeCircuitWrap = document.getElementById('cs-home-circuit');
  if (homeCircuitWrap) {
    const trigger = homeCircuitWrap.querySelector('.cs-trigger');
    const panel = homeCircuitWrap.querySelector('.cs-panel');
    panel.innerHTML = HOME_CIRCUITS.map((h, i) => `
      <div class="cs-option cs-home-circuit-opt" data-circuit="${h.circuit}">
        <div class="cs-detail">
          <div class="cs-fullname">${h.circuit}</div>
          <div class="cs-meta">${h.drivers.join(', ')}</div>
        </div>
      </div>
    `).join('');
    trigger.querySelector('.cs-placeholder').textContent = selectedPredictions.homeCircuit;
    trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
    panel.querySelectorAll('.cs-home-circuit-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const circuit = opt.dataset.circuit;
        selectedPredictions.homeCircuit = circuit;
        trigger.querySelector('.cs-placeholder').textContent = circuit;
        closePanel(panel, trigger);
        rebuildEmail();
      });
    });
  }

  // Driver Champion dropdown
  const driverChampWrap = document.getElementById('cs-driver-champion');
  if (driverChampWrap) {
    const trigger = driverChampWrap.querySelector('.cs-trigger');
    const panel = driverChampWrap.querySelector('.cs-panel');
    panel.innerHTML = DRIVERS.map((d, i) => `
      <div class="cs-option cs-driver-champ-opt" data-name="${d.fullName}">
        <div class="cs-detail">
          <div class="cs-fullname">${d.fullName}</div>
          <div class="cs-meta">${d.team}</div>
        </div>
      </div>
    `).join('');
    trigger.querySelector('.cs-placeholder').textContent = selectedPredictions.driverChampion;
    trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
    panel.querySelectorAll('.cs-driver-champ-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const name = opt.dataset.name;
        selectedPredictions.driverChampion = name;
        trigger.querySelector('.cs-placeholder').textContent = name;
        closePanel(panel, trigger);
        rebuildEmail();
      });
    });
  }

  // Constructor Champion dropdown
  const constructorChampWrap = document.getElementById('cs-constructor-champion');
  if (constructorChampWrap) {
    const trigger = constructorChampWrap.querySelector('.cs-trigger');
    const panel = constructorChampWrap.querySelector('.cs-panel');
    panel.innerHTML = TEAMS.map((t, i) => `
      <div class="cs-option cs-constructor-champ-opt" data-name="${t.name}">
        <div class="cs-detail">
          <div class="cs-fullname">${t.name}</div>
        </div>
      </div>
    `).join('');
    trigger.querySelector('.cs-placeholder').textContent = selectedPredictions.constructorChampion;
    trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
    panel.querySelectorAll('.cs-constructor-champ-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const name = opt.dataset.name;
        selectedPredictions.constructorChampion = name;
        trigger.querySelector('.cs-placeholder').textContent = name;
        closePanel(panel, trigger);
        rebuildEmail();
      });
    });
  }

  // Initialize custom sliders
  function initCustomSliders() {
    const sliders = document.querySelectorAll('.custom-slider-container');

    sliders.forEach(slider => {
      const min = parseFloat(slider.getAttribute('data-min'));
      const max = parseFloat(slider.getAttribute('data-max'));
      const invert = slider.getAttribute('data-invert') === 'true';
      let currentVal = parseFloat(slider.getAttribute('data-val'));

      const track = slider.querySelector('.cs-track');
      const fill = slider.querySelector('.cs-fill');
      const thumb = slider.querySelector('.cs-thumb');
      const tooltip = slider.querySelector('.cs-tooltip');
      const isCola = slider.id === 'cs-colapinto';

      function updateDOM(val) {
        let pct = (val - min) / (max - min);
        // clamp
        pct = Math.max(0, Math.min(1, pct));

        // Calculate the percentage
        const percentString = (pct * 100).toFixed(2) + '%';
        thumb.style.left = percentString;
        if (fill) fill.style.width = percentString;

        // Logical value
        let logicalVal = Math.round(min + pct * (max - min));
        if (invert) {
          logicalVal = max - Math.round(pct * (max - min)); // P22 -> P1
        }

        // Update display and state
        if (isCola) {
          selectedPredictions.colaPosition = logicalVal;
          if (tooltip) tooltip.textContent = `P${logicalVal}`;
        } else {
          selectedPredictions.totalClassified = logicalVal;
          if (tooltip) tooltip.textContent = logicalVal;
        }
        slider.setAttribute('data-val', val);
      }

      function handleDrag(e) {
        const rect = track.getBoundingClientRect();
        // Calculate X position relative to track
        let x = e.clientX - rect.left;
        let pct = x / rect.width;

        pct = Math.max(0, Math.min(1, pct));
        let val = min + pct * (max - min);
        val = Math.round(val);

        // Remove untouched state and fade hints
        slider.classList.remove('untouched');
        if (isCola) {
          const hint = document.getElementById('cola-hint');
          if (hint) hint.classList.add('faded');
        } else {
          const hint = document.getElementById('classified-hint');
          if (hint) hint.classList.add('faded');
        }

        updateDOM(val);
        rebuildEmail();
      }

      // Initialize initial value
      let initVal = currentVal;
      if (isCola) {
        // Cola starts at 11, data-val is 11, logical is P12. 
        // If invert is true, pct maps left to right -> P22 to P1.
        // min=1 max=22. 
        initVal = invert ? 23 - selectedPredictions.colaPosition : selectedPredictions.colaPosition;
      } else {
        initVal = selectedPredictions.totalClassified;
      }
      updateDOM(initVal);

      // Event Listeners for dragging
      let isDragging = false;

      slider.addEventListener('pointerdown', (e) => {
        isDragging = true;
        slider.setPointerCapture(e.pointerId);
        handleDrag(e);
      });

      slider.addEventListener('pointermove', (e) => {
        if (isDragging && slider.hasPointerCapture(e.pointerId)) {
          handleDrag(e);
        }
      });

      slider.addEventListener('pointerup', (e) => {
        isDragging = false;
        slider.releasePointerCapture(e.pointerId);
        recalc(); // recalc if implemented
      });

      slider.addEventListener('pointercancel', (e) => {
        isDragging = false;
        slider.releasePointerCapture(e.pointerId);
      });
    });
  }

  initCustomSliders();

  // Close panels when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.cs-panel').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.cs-trigger').forEach(t => t.classList.remove('open'));
  });
}

// ── Dropdown panel toggle helpers ──
function togglePanel(panel, trigger) {
  const wasHidden = panel.classList.contains('hidden');
  document.querySelectorAll('.cs-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.cs-trigger').forEach(t => t.classList.remove('open'));
  if (wasHidden) {
    panel.classList.remove('hidden');
    trigger.classList.add('open');
  }
}
function closePanel(panel, trigger) {
  panel.classList.add('hidden');
  trigger.classList.remove('open');
}

// ── Show results ──
function showResults(data) {
  loading.classList.add('hidden');

  // Rank
  document.getElementById('rank-number').textContent = `#${data.rank.toLocaleString()}`;
  document.getElementById('rank-total').textContent = `/ ${data.totalEntries.toLocaleString()}`;
  document.getElementById('est-points').textContent = data.estPoints.toLocaleString();

  // Jackpot effect for top 100 in pool
  const container = document.querySelector('.results-container');
  container.classList.remove('jackpot');
  if (data.rank <= 100) container.classList.add('jackpot');

  // Drivers
  const driversEl = document.getElementById('result-drivers');
  driversEl.innerHTML = data.drivers.map(d => {
    const slug = d.name.toLowerCase();
    return `<div class="selection-item">
      <img class="driver-avatar" src="/images/drivers/${slug}.jpg" alt="${d.name}" onerror="this.style.display='none'">
      <span>${d.name}</span>
      <span class="item-cost">£${d.cost}m</span>
    </div>`;
  }).join('');

  // Teams
  const teamsEl = document.getElementById('result-teams');
  teamsEl.innerHTML = data.teams.map(t => {
    const slug = TEAM_LOGO_SLUGS[t.name];
    const col = TEAM_COLORS[t.name] || '#555';
    return `<div class="selection-item">
      <div class="team-swatch-sm" style="background:${col}"></div>
      ${slug ? `<img class="team-logo-sm" src="/images/teams/${slug}.png" alt="${t.name}" onerror="this.style.display='none'">` : ''}
      <span>${t.name}</span>
      <span class="item-cost">£${t.cost}m</span>
    </div>`;
  }).join('');

  // Cost
  document.getElementById('result-cost').textContent = data.totalCost;
  document.getElementById('result-invest').textContent = data.investmentValue;

  // Email
  document.getElementById('email-body').textContent = data.emailBody;

  // Store game state for prediction updates
  gameState = {
    managerName: inputFirstName.value.trim() + ' ' + inputLastName.value.trim(),
    teamName: inputTeam.value.trim(),
    drivers: data.drivers,
    teams: data.teams,
    totalCost: data.totalCost,
    investmentValue: data.investmentValue,
  };

  // Initialize predictions from defaults and set up handlers
  initializePredictions();

  showScreen('results');
}

// ══════════════════════════
// TANK GAME SETUP
// ══════════════════════════

let tankGame = null;
let resetGameFn = null;

function initTankGame() {
  const canvas = document.getElementById('game-canvas');
  const sliderAngle = document.getElementById('slider-angle');
  const sliderPower = document.getElementById('slider-power');
  const valAngle = document.getElementById('val-angle');
  const valPower = document.getElementById('val-power');
  const btnFire = document.getElementById('btn-fire');
  const windEl = document.getElementById('wind-indicator');

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
    fillSlider(sliderAngle);
  });

  sliderPower.addEventListener('input', () => {
    valPower.textContent = `${sliderPower.value}%`;
    fillSlider(sliderPower);
  });

  gameSliderInvest.addEventListener('input', updateGameInvestLabel);

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
    fillSlider(sliderAngle);
    fillSlider(sliderPower);
    updateGameInvestLabel();
  }

  windEl.textContent = tankGame.getWindLabel();
  tankGame.draw(parseInt(sliderAngle.value));
  fillSlider(sliderAngle);
  fillSlider(sliderPower);
  updateGameInvestLabel();

  return resetGame;
}

// ══════════════════════════
// INIT + EVENT WIRING
// ══════════════════════════

function startGame(syncInvestment = false) {
  saveFields();
  // Sync game invest slider from welcome screen when entering via Play
  if (syncInvestment) {
    gameSliderInvest.value = sliderInvestment.value;
  }
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

  // Investment slider — dismiss hint + stop pulse on first touch
  sliderInvestment.addEventListener('input', updateInvestmentLabel);
  sliderInvestment.addEventListener('input', () => {
    sliderInvestment.classList.remove('untouched');
    document.getElementById('invest-hint')?.classList.add('faded');
  }, { once: true });

  // Welcome → Game (sync investment from welcome screen)
  btnPlay.addEventListener('click', () => startGame(true));

  // Back button
  document.getElementById('btn-back-game').addEventListener('click', () => {
    if (tankGame) tankGame.reset();
    showScreen('welcome');
  });

  // Results → Try Again (keep current game-screen investment)
  document.getElementById('btn-try-again').addEventListener('click', () => startGame(false));

  // Copy email
  document.getElementById('btn-copy').addEventListener('click', () => {
    const text = document.getElementById('email-body').textContent;
    const btn = document.getElementById('btn-copy');
    copyText(text).then(() => {
      btn.textContent = '✅ Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋 Copy Email';
        btn.classList.remove('copied');
      }, 2000);
    }).catch(() => {
      btn.textContent = '⚠️ Select text above';
      setTimeout(() => { btn.textContent = '📋 Copy Email'; }, 3000);
    });
  });

  // Mailto
  document.getElementById('btn-mailto').addEventListener('click', () => {
    const body = document.getElementById('email-body').textContent;
    const lines = body.split('\n');
    const subjectLine = lines.find(l => l.startsWith('Subject:'));
    const subject = subjectLine ? subjectLine.replace('Subject: ', '') : DEFAULTS.emailSubject;
    const mailBody = lines.filter(l => !l.startsWith('To:') && !l.startsWith('Subject:')).join('\n').trim();
    window.open(`mailto:${DEFAULTS.emailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`);
  });
}

init();
