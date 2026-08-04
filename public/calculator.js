import { DRIVERS, TEAMS, DRIVER_RANKS, TEAM_LOGO_SLUGS } from './constants.js';

// ── Selection state ──
const selected = { d: [null, null, null], t: [null, null, null] };

const calculatorMobileQuery = window.matchMedia('(max-width: 640px)');
const bottomSheet = document.getElementById('cs-bottom-sheet');
const bottomSheetPanel = bottomSheet.querySelector('.cs-sheet-panel');
const bottomSheetOptions = bottomSheet.querySelector('.cs-sheet-options');
const bottomSheetTitle = document.getElementById('cs-sheet-title');
const bottomSheetClose = bottomSheet.querySelector('.cs-sheet-close');
const bottomSheetBackdrop = bottomSheet.querySelector('.cs-sheet-backdrop');
let activeBottomSheet = null;

// ── Prediction state ──
const selectedPredictions = {
  homeCircuit: null,  // circuit name string, or null
  driverChampion: null,  // driver fullName string, or null
  constructorChampion: null,  // team name string, or null
  totalClassified: 440,   // integer 0–528
  colaPosition: 12,    // integer P1–P22
};

// ── Driver nationalities (maps driver short name to country flag) ──
const DRIVER_COUNTRIES = {
  'Leclerc': '🇲🇨', 'Russell': '🇬🇧', 'Piastri': '🇦🇺', 'Antonelli': '🇮🇹',
  'Verstappen': '🇳🇱', 'Norris': '🇬🇧', 'Hamilton': '🇬🇧', 'Gasly': '🇫🇷',
  'Lindblad': '🇸🇪', 'Colapinto': '🇦🇷', 'Ocon': '🇫🇷', 'Bearman': '🇬🇧',
  'Hadjar': '🇯🇴', 'Lawson': '🇳🇿', 'Stroll': '🇨🇦', 'Hulkenberg': '🇩🇪',
  'Bortoleto': '🇧🇷', 'Bottas': '🇫🇮', 'Sainz': '🇪🇸', 'Albon': '🇹🇭',
  'Perez': '🇲🇽', 'Alonso': '🇪🇸',
};

// ── Team countries (maps team name to country flag) ──
const TEAM_COUNTRIES = {
  'Mercedes': '🇩🇪', 'Ferrari': '🇮🇹', 'McLaren': '🇬🇧', 'Red Bull': '🇦🇹',
  'Alpine': '🇫🇷', 'Haas': '🇺🇸', 'Racing Bulls': '🇮🇹', 'Audi': '🇩🇪',
  'Cadillac': '🇺🇸', 'Williams': '🇬🇧', 'Aston Martin': '🇬🇧',
};

// ── All 2026 race circuits ──
const HOME_CIRCUITS = [
  { race: 'R1', circuit: 'Australia', flag: '🇦🇺', date: '8 Mar' },
  { race: 'R2', circuit: 'China', flag: '🇨🇳', date: '15 Mar' },
  { race: 'R3', circuit: 'Japan', flag: '🇯🇵', date: '29 Mar' },
  { race: 'R4', circuit: 'Bahrain', flag: '🇧🇭', date: '12 Apr' },
  { race: 'R5', circuit: 'Saudi Arabia', flag: '🇸🇦', date: '19 Apr' },
  { race: 'R6', circuit: 'Miami', flag: '🇺🇸', date: '3 May' },
  { race: 'R7', circuit: 'Canada', flag: '🇨🇦', date: '24 May' },
  { race: 'R8', circuit: 'Monaco', flag: '🇲🇨', date: '7 Jun' },
  { race: 'R9', circuit: 'Spain', flag: '🇪🇸', date: '14 Jun' },
  { race: 'R10', circuit: 'Austria', flag: '🇦🇹', date: '28 Jun' },
  { race: 'R11', circuit: 'Britain', flag: '🇬🇧', date: '5 Jul' },
  { race: 'R12', circuit: 'Belgium', flag: '🇧🇪', date: '19 Jul' },
  { race: 'R13', circuit: 'Hungary', flag: '🇭🇺', date: '26 Jul' },
  { race: 'R14', circuit: 'Netherlands', flag: '🇳🇱', date: '23 Aug' },
  { race: 'R15', circuit: 'Italy', flag: '🇮🇹', date: '31 Aug' },
  { race: 'R16', circuit: 'Madrid', flag: '🇪🇸', date: '13 Sep' },
  { race: 'R17', circuit: 'Azerbaijan', flag: '🇦🇿', date: '26 Sep' },
  { race: 'R18', circuit: 'Singapore', flag: '🇸🇬', date: '11 Oct' },
  { race: 'R19', circuit: 'USA (Austin)', flag: '🇺🇸', date: '25 Oct' },
  { race: 'R20', circuit: 'Mexico', flag: '🇲🇽', date: '1 Nov' },
  { race: 'R21', circuit: 'Brazil', flag: '🇧🇷', date: '8 Nov' },
  { race: 'R22', circuit: 'Las Vegas', flag: '🇺🇸', date: '21 Nov' },
  { race: 'R23', circuit: 'Qatar', flag: '🇶🇦', date: '29 Nov' },
  { race: 'R24', circuit: 'Abu Dhabi', flag: '🇦🇪', date: '6 Dec' },
];

// ── Team colours (mirrors constants.js TEAM_COLORS) ──
const TCOLORS = {
  "Mercedes": "#27f4d2", "Ferrari": "#e8002d",
  "McLaren": "#ff8000", "Red Bull": "#3671c6",
  "Alpine": "#ff87bc", "Haas": "#b6babd",
  "Racing Bulls": "#6692ff", "Audi": "#00e701",
  "Cadillac": "#1d1d1b", "Williams": "#64c4ff",
  "Aston Martin": "#229971",
};

function badgeText(hex) {
  // Returns '#000' for light backgrounds, '#fff' for dark
  const r = parseInt(hex.slice(1, 3), 16),
    g = parseInt(hex.slice(3, 5), 16),
    b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 130 ? '#000' : '#fff';
}

// ── Build all 6 custom dropdowns ──
function buildCustomDropdowns() {
  for (let n = 1; n <= 3; n++) {
    buildDriverDropdown(n);
    buildTeamDropdown(n);
  }
}

// ── Build prediction dropdowns ──
function buildHomeCircuitDropdown() {
  const wrap = document.getElementById('cs-home-circuit');
  const trigger = wrap.querySelector('.cs-trigger');
  const panel = wrap.querySelector('.cs-panel');

  panel.innerHTML = HOME_CIRCUITS.map((c, i) => {
    return `<div class="cs-option cs-circuit-opt" data-index="${i}">
  <span style="font-size:22px;flex-shrink:0;line-height:1">${c.flag}</span>
  <div class="cs-detail">
    <div class="cs-fullname">${c.circuit}</div>
    <div class="cs-meta">
      <span class="cs-rank-chip">${c.race} · ${c.date}</span>
    </div>
  </div>
</div>`;
  }).join('');

  trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
  panel.querySelectorAll('.cs-circuit-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const c = HOME_CIRCUITS[parseInt(opt.dataset.index)];
      selectedPredictions.homeCircuit = c.circuit;
      trigger.classList.remove('cs-untouched');
      trigger.querySelector('.cs-selected-content').innerHTML =
        `<span style="font-size:18px;line-height:1">${c.flag}</span>
     <span class="cs-sel-name">${c.circuit}</span>`;
      closePanel(panel, trigger);
      recalc();
    });
  });
}

function buildDriverChampionDropdown() {
  const wrap = document.getElementById('cs-driver-champion');
  const trigger = wrap.querySelector('.cs-trigger');
  const panel = wrap.querySelector('.cs-panel');

  panel.innerHTML = DRIVERS.map((d, i) => {
    const slug = d.name.toLowerCase();
    const col = TCOLORS[d.team] || '#555';
    const txt = badgeText(col);
    const flag = DRIVER_COUNTRIES[d.name] || '🏁';
    return `<div class="cs-option cs-driverchamp-opt" data-index="${i}">
  <img class="cs-avatar" src="/images/drivers/${slug}.jpg" alt="${d.name}"
       onerror="this.style.visibility='hidden'">
  <div class="cs-detail">
    <div class="cs-fullname">${d.fullName} ${flag}</div>
    <div class="cs-meta">
      <span class="cs-team-badge" style="background:${col};color:${txt}">${d.team}</span>
    </div>
  </div>
</div>`;
  }).join('');

  trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
  panel.querySelectorAll('.cs-driverchamp-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const d = DRIVERS[parseInt(opt.dataset.index)];
      const slug = d.name.toLowerCase();
      const col = TCOLORS[d.team] || '#555';
      const txt = badgeText(col);
      const flag = DRIVER_COUNTRIES[d.name] || '🏁';
      selectedPredictions.driverChampion = d.fullName;
      trigger.classList.remove('cs-untouched');
      trigger.querySelector('.cs-selected-content').innerHTML =
        `<img class="cs-avatar cs-avatar-sm" src="/images/drivers/${slug}.jpg" alt="${d.name}"
          onerror="this.style.visibility='hidden'">
     <span class="cs-sel-name">${d.fullName} ${flag}</span>
     <span class="cs-team-badge" style="background:${col};color:${txt}">${d.team}</span>`;
      closePanel(panel, trigger);
      recalc();
    });
  });
}

function buildConstructorDropdown() {
  const wrap = document.getElementById('cs-constructor-champion');
  const trigger = wrap.querySelector('.cs-trigger');
  const panel = wrap.querySelector('.cs-panel');

  panel.innerHTML = TEAMS.map((t, i) => {
    const slug = TEAM_LOGO_SLUGS[t.name];
    const col = TCOLORS[t.name] || '#555';
    const flag = TEAM_COUNTRIES[t.name] || '🏁';
    return `<div class="cs-option cs-constructorchamp-opt" data-index="${i}">
  <div class="cs-team-swatch" style="background:${col}"></div>
  ${slug ? `<img class="cs-team-logo" src="/images/teams/${slug}.png" alt="${t.name}" onerror="this.style.display='none'">` : ''}
  <div class="cs-detail">
    <div class="cs-fullname">${t.name} ${flag}</div>
  </div>
</div>`;
  }).join('');

  trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
  panel.querySelectorAll('.cs-constructorchamp-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      const t = TEAMS[parseInt(opt.dataset.index)];
      const slug = TEAM_LOGO_SLUGS[t.name];
      const col = TCOLORS[t.name] || '#555';
      const flag = TEAM_COUNTRIES[t.name] || '🏁';
      selectedPredictions.constructorChampion = t.name;
      trigger.classList.remove('cs-untouched');
      trigger.querySelector('.cs-selected-content').innerHTML =
        `<div class="cs-team-swatch cs-swatch-sm" style="background:${col}"></div>
     ${slug ? `<img class="cs-team-logo cs-team-logo-sm" src="/images/teams/${slug}.png" alt="${t.name}" onerror="this.style.display='none'">` : ''}
     <span class="cs-sel-name">${t.name} ${flag}</span>`;
      closePanel(panel, trigger);
      recalc();
    });
  });
}

function buildDriverDropdown(n) {
  const wrap = document.getElementById(`cs-driver-${n}`);
  const trigger = wrap.querySelector('.cs-trigger');
  const panel = wrap.querySelector('.cs-panel');

  panel.innerHTML = DRIVERS.map((d, i) => {
    const slug = d.name.toLowerCase();
    const col = TCOLORS[d.team] || '#555';
    const txt = badgeText(col);
    const rank = DRIVER_RANKS[i];
    return `<div class="cs-option cs-driver-opt" data-index="${i}" data-n="${n - 1}">
  <img class="cs-avatar" src="/images/drivers/${slug}.jpg" alt="${d.name}"
       onerror="this.style.visibility='hidden'">
  <div class="cs-detail">
    <div class="cs-fullname">${d.fullName}</div>
    <div class="cs-meta">
      <span class="cs-team-badge" style="background:${col};color:${txt}">${d.team}</span>
      <span class="cs-rank-chip">${rank}</span>
      <span class="cs-item-cost">£${d.cost}m</span>
    </div>
  </div>
</div>`;
  }).join('');

  trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
  panel.querySelectorAll('.cs-driver-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      if (opt.classList.contains('cs-costly')) {
        const row = document.getElementById(`cs-driver-${n}`).parentElement;
        row.classList.remove('over-budget-shake');
        void row.offsetWidth; // trigger reflow
        row.classList.add('over-budget-shake');
        return;
      }
      const i = parseInt(opt.dataset.index);
      selected.d[n - 1] = i;
      updateDriverTrigger(n, i);
      closePanel(panel, trigger);
      refreshSelected();
      refreshDisabled();
      refreshCostly();
      recalc();
    });
  });
}

function buildTeamDropdown(n) {
  const wrap = document.getElementById(`cs-team-${n}`);
  const trigger = wrap.querySelector('.cs-trigger');
  const panel = wrap.querySelector('.cs-panel');

  panel.innerHTML = TEAMS.map((t, i) => {
    const slug = TEAM_LOGO_SLUGS[t.name];
    const col = TCOLORS[t.name] || '#555';
    return `<div class="cs-option cs-team-opt" data-index="${i}" data-n="${n - 1}">
  <div class="cs-team-swatch" style="background:${col}"></div>
  ${slug ? `<img class="cs-team-logo" src="/images/teams/${slug}.png" alt="${t.name}" onerror="this.style.display='none'">` : ''}
  <div class="cs-detail">
    <div class="cs-fullname">${t.name}</div>
  </div>
  <span class="cs-item-cost">£${t.cost}m</span>
</div>`;
  }).join('');

  trigger.addEventListener('click', e => { e.stopPropagation(); togglePanel(panel, trigger); });
  panel.querySelectorAll('.cs-team-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      if (opt.classList.contains('cs-costly')) {
        const row = document.getElementById(`cs-team-${n}`).parentElement;
        row.classList.remove('over-budget-shake');
        void row.offsetWidth; // trigger reflow
        row.classList.add('over-budget-shake');
        return;
      }
      const i = parseInt(opt.dataset.index);
      selected.t[n - 1] = i;
      updateTeamTrigger(n, i);
      closePanel(panel, trigger);
      refreshSelected();
      refreshDisabled();
      refreshCostly();
      recalc();
    });
  });
}

// ── Trigger display updates ──
function updateDriverTrigger(n, i) {
  const d = DRIVERS[i];
  const slug = d.name.toLowerCase();
  const col = TCOLORS[d.team] || '#555';
  const txt = badgeText(col);
  document.querySelector(`#cs-driver-${n} .cs-selected-content`).innerHTML =
    `<img class="cs-avatar cs-avatar-sm" src="/images/drivers/${slug}.jpg" alt="${d.name}"
      onerror="this.style.visibility='hidden'">
 <span class="cs-sel-name">${d.fullName}</span>
 <span class="cs-team-badge" style="background:${col};color:${txt}">${d.team}</span>`;
}

function updateTeamTrigger(n, i) {
  const t = TEAMS[i];
  const slug = TEAM_LOGO_SLUGS[t.name];
  const col = TCOLORS[t.name] || '#555';
  document.querySelector(`#cs-team-${n} .cs-selected-content`).innerHTML =
    `<div class="cs-team-swatch cs-swatch-sm" style="background:${col}"></div>
 ${slug ? `<img class="cs-team-logo cs-team-logo-sm" src="/images/teams/${slug}.png" alt="${t.name}" onerror="this.style.display='none'">` : ''}
 <span class="cs-sel-name">${t.name}</span>`;
}

// ── Panel open/close helpers ──
function triggerLabel(trigger) {
  const wrap = trigger.closest('.custom-select-wrap');
  const slotMatch = wrap?.id.match(/^cs-(driver|team)-(\d)$/);
  if (slotMatch) return `Choose ${slotMatch[1]} ${slotMatch[2]}`;
  return trigger.closest('.pred-field')?.querySelector('.pred-label')?.textContent.trim()
    || 'Choose an option';
}

function restoreBottomSheetPanel() {
  if (!activeBottomSheet) return;
  const { panel, parent, nextSibling } = activeBottomSheet;
  panel.classList.add('hidden');
  parent.insertBefore(panel, nextSibling);
}

function closeBottomSheet({ restoreFocus = true } = {}) {
  if (!activeBottomSheet) return;
  const { trigger } = activeBottomSheet;
  restoreBottomSheetPanel();
  activeBottomSheet = null;
  bottomSheet.hidden = true;
  document.body.classList.remove('calc-sheet-open');
  trigger.classList.remove('open');
  trigger.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger.focus();
}

function openBottomSheet(panel, trigger) {
  if (activeBottomSheet) closeBottomSheet({ restoreFocus: false });
  activeBottomSheet = {
    panel,
    trigger,
    parent: panel.parentNode,
    nextSibling: panel.nextSibling,
  };
  bottomSheetTitle.textContent = triggerLabel(trigger);
  bottomSheetOptions.append(panel);
  panel.classList.remove('hidden');
  trigger.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  bottomSheet.hidden = false;
  document.body.classList.add('calc-sheet-open');
  bottomSheetClose.focus();
}

function togglePanel(panel, trigger) {
  if (calculatorMobileQuery.matches) {
    openBottomSheet(panel, trigger);
    return;
  }
  const wasHidden = panel.classList.contains('hidden');
  // Close all first
  document.querySelectorAll('.cs-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.cs-trigger').forEach(t => {
    t.classList.remove('open');
    t.setAttribute('aria-expanded', 'false');
  });
  // Re-open if it was closed
  if (wasHidden) {
    panel.classList.remove('hidden');
    trigger.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  }
}
function closePanel(panel, trigger) {
  if (activeBottomSheet?.panel === panel) {
    closeBottomSheet();
    return;
  }
  panel.classList.add('hidden');
  trigger.classList.remove('open');
  trigger.setAttribute('aria-expanded', 'false');
}

function initTriggerAccessibility() {
  document.querySelectorAll('.cs-trigger').forEach(trigger => {
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', triggerLabel(trigger));
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      trigger.click();
    });
  });
  document.querySelectorAll('.cs-option').forEach(option => {
    option.setAttribute('role', 'option');
    option.setAttribute('tabindex', '0');
    option.setAttribute('aria-selected', String(option.classList.contains('cs-selected')));
    option.setAttribute('aria-disabled', String(option.classList.contains('cs-disabled')));
    option.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (option.classList.contains('cs-disabled')) return;
      option.click();
    });
  });
  document.querySelectorAll('.cs-panel').forEach(panel => panel.setAttribute('role', 'listbox'));
}

bottomSheetClose.addEventListener('click', () => closeBottomSheet());
bottomSheetBackdrop.addEventListener('click', () => closeBottomSheet());
bottomSheet.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeBottomSheet();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = [...bottomSheetPanel.querySelectorAll(
    'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )].filter(element => element.getClientRects().length > 0);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

calculatorMobileQuery.addEventListener('change', event => {
  if (!event.matches) closeBottomSheet({ restoreFocus: false });
});

// Highlight the currently selected option in each panel
function refreshSelected() {
  document.querySelectorAll('.cs-driver-opt').forEach(opt => {
    const i = parseInt(opt.dataset.index), n = parseInt(opt.dataset.n);
    const isSelected = selected.d[n] === i;
    opt.classList.toggle('cs-selected', isSelected);
    opt.setAttribute('aria-selected', String(isSelected));
  });
  document.querySelectorAll('.cs-team-opt').forEach(opt => {
    const i = parseInt(opt.dataset.index), n = parseInt(opt.dataset.n);
    const isSelected = selected.t[n] === i;
    opt.classList.toggle('cs-selected', isSelected);
    opt.setAttribute('aria-selected', String(isSelected));
  });
}

// Grey-out options already chosen in another slot
function refreshDisabled() {
  document.querySelectorAll('.cs-driver-opt').forEach(opt => {
    const i = parseInt(opt.dataset.index), n = parseInt(opt.dataset.n);
    // Disable if this driver is selected in any OTHER slot
    const isDisabled = selected.d.some((s, j) => s === i && j !== n);
    opt.classList.toggle('cs-disabled', isDisabled);
    opt.setAttribute('aria-disabled', String(isDisabled));
    opt.tabIndex = isDisabled ? -1 : 0;
  });
  document.querySelectorAll('.cs-team-opt').forEach(opt => {
    const i = parseInt(opt.dataset.index), n = parseInt(opt.dataset.n);
    const isDisabled = selected.t.some((s, j) => s === i && j !== n);
    opt.classList.toggle('cs-disabled', isDisabled);
    opt.setAttribute('aria-disabled', String(isDisabled));
    opt.tabIndex = isDisabled ? -1 : 0;
  });
}

// Subdue options that would push the total over £50m
function refreshCostly() {
  const driverSpend = selected.d.reduce((s, i) => s + (i !== null ? DRIVERS[i].cost : 0), 0);
  const teamSpend = selected.t.reduce((s, i) => s + (i !== null ? TEAMS[i].cost : 0), 0);
  const totalSpent = driverSpend + teamSpend;

  document.querySelectorAll('.cs-driver-opt').forEach(opt => {
    const i = parseInt(opt.dataset.index), n = parseInt(opt.dataset.n);
    // Free up the current slot's cost (we'd be replacing it)
    const slotCost = selected.d[n] !== null ? DRIVERS[selected.d[n]].cost : 0;
    opt.classList.toggle('cs-costly', DRIVERS[i].cost > 50 - totalSpent + slotCost);
  });

  document.querySelectorAll('.cs-team-opt').forEach(opt => {
    const i = parseInt(opt.dataset.index), n = parseInt(opt.dataset.n);
    const slotCost = selected.t[n] !== null ? TEAMS[selected.t[n]].cost : 0;
    opt.classList.toggle('cs-costly', TEAMS[i].cost > 50 - totalSpent + slotCost);
  });
}

// Close panels when clicking outside any dropdown
document.addEventListener('click', () => {
  if (activeBottomSheet) return;
  document.querySelectorAll('.cs-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.cs-trigger').forEach(t => {
    t.classList.remove('open');
    t.setAttribute('aria-expanded', 'false');
  });
});

const stickyBudgetBar = document.getElementById('sticky-budget-bar');
let receiptPassedTop = false;

function syncStickyBudgetVisibility() {
  stickyBudgetBar.hidden = !calculatorMobileQuery.matches || !receiptPassedTop;
}

function renderStickyBudget(total, bonusPerRace) {
  let state = 'normal';
  let text = `£${total}m / £50m · +${bonusPerRace} pts/race`;
  if (total > 50) {
    state = 'over';
    text = `❌ Over budget by £${total - 50}m`;
  } else if (total >= 48) {
    state = 'optimal';
    text += ' ✅ OK';
  }
  stickyBudgetBar.dataset.state = state;
  stickyBudgetBar.textContent = text;
}

function initStickyBudgetBar() {
  const receipt = document.querySelector('.calc-totals-receipt');
  const observer = new IntersectionObserver(([entry]) => {
    receiptPassedTop = entry.boundingClientRect.bottom <= 0;
    syncStickyBudgetVisibility();
  });
  observer.observe(receipt);
  calculatorMobileQuery.addEventListener('change', syncStickyBudgetVisibility);
}

// ── Recalculate totals ──
function recalc() {
  let driverTotal = 0, teamTotal = 0;
  let allFilled = true;
  const selDrivers = [], selTeams = [];

  for (let n = 1; n <= 3; n++) {
    const dIdx = selected.d[n - 1];
    const tIdx = selected.t[n - 1];
    const dBadge = document.getElementById(`cost-d${n}`);
    const tBadge = document.getElementById(`cost-t${n}`);

    if (dIdx !== null) {
      const d = DRIVERS[dIdx];
      driverTotal += d.cost;
      dBadge.textContent = `£${d.cost}m`;
      selDrivers.push({ ...d, slot: n });
      document.getElementById(`cs-driver-${n}`).parentElement.classList.add('filled');
    } else {
      dBadge.textContent = '—';
      allFilled = false;
      document.getElementById(`cs-driver-${n}`).parentElement.classList.remove('filled');
    }

    if (tIdx !== null) {
      const t = TEAMS[tIdx];
      teamTotal += t.cost;
      tBadge.textContent = `£${t.cost}m`;
      selTeams.push({ ...t, slot: n });
      document.getElementById(`cs-team-${n}`).parentElement.classList.add('filled');
    } else {
      tBadge.textContent = '—';
      allFilled = false;
      document.getElementById(`cs-team-${n}`).parentElement.classList.remove('filled');
    }
  }

  const total = driverTotal + teamTotal;
  const investment = Math.max(0, 50 - total);
  const bonusPerRace = Math.floor(investment / 2);
  const seasonBonus = bonusPerRace * 24;
  const overBudget = total > 50;
  const pct = Math.min(100, (total / 50) * 100);

  document.getElementById('calc-spent').textContent = `£${total}m / £50m`;
  document.getElementById('calc-invest').textContent = `£${investment}m unspent`;
  document.getElementById('calc-bonus').textContent = `+${bonusPerRace} pts/race`;
  document.getElementById('calc-season').textContent = `+${seasonBonus} pts`;
  renderStickyBudget(total, bonusPerRace);

  const bar = document.getElementById('calc-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('over', overBudget);

  const nameVal = document.getElementById('calc-name').value.trim();
  const teamVal = document.getElementById('calc-team-name').value.trim();
  const nameOk = nameVal.length > 0;
  const teamOk = teamVal.length > 0;

  const predsTouched = document.querySelectorAll('.cs-untouched, .untouched').length === 0;

  const status = document.getElementById('calc-status');
  const copyBtn = document.getElementById('calc-copy');
  const mailtoBtn = document.getElementById('calc-mailto');
  const enabled = allFilled && !overBudget && nameOk && teamOk && predsTouched;

  if (!allFilled) {
    status.className = 'calc-status empty';
    status.textContent = 'Select all 6 core picks to see your entry';
  } else if (overBudget) {
    status.className = 'calc-status bad';
    status.textContent = `❌ Over budget by £${total - 50}m — adjust your picks`;
  } else if (!predsTouched) {
    status.className = 'calc-status empty';
    status.textContent = 'Make all 5 season predictions above';
  } else if (!nameOk || !teamOk) {
    status.className = 'calc-status empty';
    status.textContent = !nameOk ? 'Enter your name to copy your entry' : 'Enter your team name to copy your entry';
  } else {
    status.className = 'calc-status ok';
    status.textContent = `✅ Ready to send — £${total}m spent, £${investment}m invested`;
  }
  copyBtn.disabled = !enabled;
  mailtoBtn.disabled = !enabled;

  window._calcState = { selDrivers, selTeams, total, investment, allFilled, overBudget };
}

window.recalc = recalc;

// ── Clipboard helper: modern API with execCommand fallback ──
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy') ? resolve() : reject(); }
    catch (e) { reject(e); }
    finally { document.body.removeChild(ta); }
  });
}

// ── Build the entry email in the same format Martin receives ──
function buildEntryEmail(managerName, teamName, s) {
  const pred = selectedPredictions;
  const homeCircuit = pred.homeCircuit || '[fill in — the one race where your score is doubled]';
  const driverChamp = pred.driverChampion || "[fill in — your pick for 2026 World Drivers' Champion]";
  const consChamp = pred.constructorChampion || '[fill in — your pick for 2026 World Constructors\' Champion]';

  return [
    `To: Email Martin`,
    `Subject: Martin's FF1 2026 - Entry Submission`,
    ``,
    `Hi Martin,`,
    ``,
    `Please find my entry for Martin's FF1 2026 below. Hoping to sneak in before the deadline!`,
    ``,
    `Team Manager: ${managerName}`,
    `Team Name: ${teamName}`,
    ``,
    `Driver 1: ${s.selDrivers[0].fullName} (${s.selDrivers[0].team}) - £${s.selDrivers[0].cost}m`,
    `Driver 2: ${s.selDrivers[1].fullName} (${s.selDrivers[1].team}) - £${s.selDrivers[1].cost}m`,
    `Driver 3: ${s.selDrivers[2].fullName} (${s.selDrivers[2].team}) - £${s.selDrivers[2].cost}m`,
    ``,
    `Team 1: ${s.selTeams[0].name} - £${s.selTeams[0].cost}m`,
    `Team 2: ${s.selTeams[1].name} - £${s.selTeams[1].cost}m`,
    `Team 3: ${s.selTeams[2].name} - £${s.selTeams[2].cost}m`,
    ``,
    `Total Team Cost: £${s.total}m`,
    `Investment Value: £${s.investment}m`,
    ``,
    `Home Circuit: ${homeCircuit}`,
    `Driver Champion: ${driverChamp}`,
    `Constructor Champion: ${consChamp}`,
    `Total Classified: ${pred.totalClassified}`,
    `Best Pos. (Colapinto): P${pred.colaPosition}`,
    ``,
    `Happy to pay the £15 entry fee electronically - please send me the details.`,
    ``,
    `All the best,`,
    `${managerName}`,
  ].join('\n');
}

window.copySelection = function () {
  const s = window._calcState;
  const managerName = document.getElementById('calc-name').value.trim();
  const teamName = document.getElementById('calc-team-name').value.trim();
  if (!s || !s.allFilled || s.overBudget || !managerName || !teamName) return;
  const text = buildEntryEmail(managerName, teamName, s);

  const preview = document.getElementById('calc-preview');
  preview.textContent = text;
  preview.classList.add('visible');

  const btn = document.getElementById('calc-copy');
  copyText(text).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📧 Copy Entry Email'; }, 2000);
  }).catch(() => {
    btn.textContent = '⚠️ Select & copy text below';
    setTimeout(() => { btn.textContent = '📧 Copy Entry Email'; }, 3000);
  });
};

window.openMailto = function () {
  const s = window._calcState;
  const managerName = document.getElementById('calc-name').value.trim();
  const teamName = document.getElementById('calc-team-name').value.trim();
  if (!s || !s.allFilled || s.overBudget || !managerName || !teamName) return;
  const text = buildEntryEmail(managerName, teamName, s);
  const lines = text.split('\n');
  const subject = `Martin's FF1 2026 - Entry Submission`;
  const body = lines.filter(l => !l.startsWith('To:') && !l.startsWith('Subject:')).join('\n').trim();
  window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
};

// ── Init ──
buildCustomDropdowns();
refreshCostly();

// ── Prediction dropdowns ──
buildHomeCircuitDropdown();
buildDriverChampionDropdown();
buildConstructorDropdown();
initTriggerAccessibility();
initStickyBudgetBar();

// ── Prediction sliders ──
function initCustomSliders() {
  const sliders = document.querySelectorAll('.custom-slider-container');

  sliders.forEach(slider => {
    const min = parseFloat(slider.getAttribute('data-min'));
    const max = parseFloat(slider.getAttribute('data-max'));
    const invert = slider.getAttribute('data-invert') === 'true';
    const currentVal = parseFloat(slider.getAttribute('data-val'));

    const track = slider.querySelector('.cs-track');
    const fill = slider.querySelector('.cs-fill');
    const thumb = slider.querySelector('.cs-thumb');
    const tooltip = slider.querySelector('.cs-tooltip');
    const isCola = slider.id === 'cs-colapinto';
    const control = slider.closest('.custom-slider-control');
    const minusButton = control.querySelector('.btn-minus');
    const plusButton = control.querySelector('.btn-plus');

    slider.setAttribute('role', 'slider');
    slider.setAttribute('tabindex', '0');
    slider.setAttribute('aria-orientation', 'horizontal');
    slider.setAttribute('aria-valuemin', String(min));
    slider.setAttribute('aria-valuemax', String(max));
    slider.setAttribute('aria-label', isCola ? 'Colapinto best finish' : 'Total classified');

    function logicalFromRaw(rawValue) {
      return invert ? (max + min) - rawValue : rawValue;
    }

    function rawFromLogical(logicalValue) {
      return invert ? (max + min) - logicalValue : logicalValue;
    }

    function markTouched() {
      slider.classList.remove('untouched');
      const hint = document.getElementById(isCola ? 'cola-hint' : 'classified-hint');
      if (hint) hint.classList.add('faded');
    }

    function updateDOM(val) {
      const rawValue = Math.max(min, Math.min(max, Math.round(val)));
      let pct = (rawValue - min) / (max - min);
      pct = Math.max(0, Math.min(1, pct));

      const percentString = (pct * 100).toFixed(2) + '%';
      thumb.style.left = percentString;
      if (fill) fill.style.width = percentString;

      const logicalVal = logicalFromRaw(rawValue);

      if (isCola) {
        selectedPredictions.colaPosition = logicalVal;
        if (tooltip) tooltip.textContent = `P${logicalVal}`;
        slider.setAttribute('aria-valuetext', `Position ${logicalVal}`);
      } else {
        selectedPredictions.totalClassified = logicalVal;
        if (tooltip) tooltip.textContent = logicalVal;
        slider.removeAttribute('aria-valuetext');
      }
      slider.setAttribute('aria-valuenow', String(logicalVal));
      slider.setAttribute('data-val', String(rawValue));
    }

    function setLogicalValue(logicalValue, { haptic = false } = {}) {
      const nextLogical = Math.max(min, Math.min(max, Math.round(logicalValue)));
      const currentLogical = Number(slider.getAttribute('aria-valuenow'));
      if (nextLogical === currentLogical) return;
      markTouched();
      updateDOM(rawFromLogical(nextLogical));
      recalc();
      if (haptic && 'vibrate' in navigator) navigator.vibrate(10);
    }

    function applyStep(direction) {
      const currentLogical = Number(slider.getAttribute('aria-valuenow'));
      const logicalDelta = invert ? -direction : direction;
      setLogicalValue(currentLogical + logicalDelta, { haptic: true });
    }

    function handleDrag(e) {
      const rect = track.getBoundingClientRect();
      let x = e.clientX - rect.left;
      let pct = x / rect.width;

      pct = Math.max(0, Math.min(1, pct));
      let val = min + pct * (max - min);
      val = Math.round(val);

      markTouched();
      updateDOM(val);
    }

    let initVal = currentVal;
    if (isCola) {
      initVal = invert ? 23 - selectedPredictions.colaPosition : selectedPredictions.colaPosition;
    } else {
      initVal = selectedPredictions.totalClassified;
    }
    updateDOM(initVal);

    minusButton.addEventListener('click', () => applyStep(-1));
    plusButton.addEventListener('click', () => applyStep(1));

    slider.addEventListener('keydown', event => {
      let nextLogical = null;
      const currentLogical = Number(slider.getAttribute('aria-valuenow'));
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        nextLogical = currentLogical + (invert ? -1 : 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        nextLogical = currentLogical + (invert ? 1 : -1);
      } else if (event.key === 'Home') {
        nextLogical = invert ? max : min;
      } else if (event.key === 'End') {
        nextLogical = invert ? min : max;
      }
      if (nextLogical === null) return;
      event.preventDefault();
      setLogicalValue(nextLogical, { haptic: true });
    });

    let isDragging = false;

    slider.addEventListener('pointerdown', (e) => {
      isDragging = true;
      slider.classList.add('is-dragging');
      try { slider.setPointerCapture(e.pointerId); } catch { /* Pointer capture is optional. */ }
      handleDrag(e);
    });

    slider.addEventListener('pointermove', (e) => {
      if (isDragging) {
        handleDrag(e);
      }
    });

    slider.addEventListener('pointerup', (e) => {
      isDragging = false;
      slider.classList.remove('is-dragging');
      try {
        if (slider.hasPointerCapture(e.pointerId)) {
          slider.releasePointerCapture(e.pointerId);
        }
      } catch { /* Pointer capture is optional. */ }
      if (typeof window.recalc === 'function') window.recalc();
    });

    slider.addEventListener('pointercancel', (e) => {
      isDragging = false;
      slider.classList.remove('is-dragging');
      try {
        if (slider.hasPointerCapture(e.pointerId)) {
          slider.releasePointerCapture(e.pointerId);
        }
      } catch { /* Pointer capture is optional. */ }
    });
  });
}

initCustomSliders();


// Pre-fill name + team from landing page if previously set
const _savedName = localStorage.getItem('ff1_name') || '';
if (_savedName) document.getElementById('calc-name').value = _savedName;
const _savedTeam = localStorage.getItem('ff1_team');
if (_savedTeam) document.getElementById('calc-team-name').value = _savedTeam;

// Name + team name changes re-evaluate button state
document.getElementById('calc-name').addEventListener('input', recalc);
document.getElementById('calc-team-name').addEventListener('input', recalc);

// Parse URL params to pre-fill selections from game
const params = new URLSearchParams(window.location.search);
if (params.toString()) {
  for (let i = 1; i <= 3; i++) {
    if (params.has(`d${i}`)) {
      const idx = parseInt(params.get(`d${i}`));
      selected.d[i - 1] = idx;
      updateDriverTrigger(i, idx);
    }
    if (params.has(`t${i}`)) {
      const idx = parseInt(params.get(`t${i}`));
      selected.t[i - 1] = idx;
      updateTeamTrigger(i, idx);
    }
  }

  if (params.has('name')) {
    document.getElementById('calc-name').value = params.get('name');
  }
  if (params.has('team')) {
    document.getElementById('calc-team-name').value = params.get('team');
  }

  refreshSelected();
  refreshDisabled();
  refreshCostly();

  // Clean up URL without reloading
  window.history.replaceState({}, document.title, window.location.pathname);
}

recalc();
