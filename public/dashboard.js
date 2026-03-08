function formatGeneratedAt(value) {
  if (!value) return 'Waiting for Monday scoring';
  return `Updated ${new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function formatWeekOverWeekDelta(value) {
  if (value == null) return '—';
  if (value === 0) return 'No change';
  return value > 0 ? `+${value}` : `${value}`;
}

function weekOverWeekClass(value) {
  if (value == null || value === 0) return '';
  return value > 0 ? 'component-positive' : 'component-negative';
}

function buildRaceStatusRows(races) {
  const lastEvaluatedRace = [...races].reverse().find((race) => race.status === 'finalized');
  const nextScheduledRace = races.find((race) => race.status === 'not run');
  const rows = [];

  if (lastEvaluatedRace) {
    rows.push({
      ...lastEvaluatedRace,
      statusLabel: 'last evaluated',
      statusName: 'finalized',
    });
  }

  if (nextScheduledRace) {
    rows.push({
      ...nextScheduledRace,
      statusLabel: 'next race',
      statusName: 'next-race',
    });
  }

  return rows;
}

function compareMoverRows(left, right) {
  if (Math.abs(right.wowDelta) !== Math.abs(left.wowDelta)) {
    return Math.abs(right.wowDelta) - Math.abs(left.wowDelta);
  }
  if (right.latestRacePoints !== left.latestRacePoints) {
    return right.latestRacePoints - left.latestRacePoints;
  }
  return left.rank - right.rank;
}

function parseDateValue(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatRaceDate(value) {
  const parsed = parseDateValue(value);
  if (!parsed) return value || '';
  return parsed.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

function statusClass(status) {
  return `status-${String(status).replace(/\s+/g, '-').toLowerCase()}`;
}

function pointsClass(points) {
  if (points > 0) return 'component-positive';
  if (points < 0) return 'component-negative';
  return '';
}

function signedPoints(points) {
  return `${points > 0 ? '+' : ''}${points}`;
}

function formatBestFinish(value) {
  if (value == null) return '—';
  return `P${value}`;
}

const DRIVER_FLAGS = {
  'charles-leclerc': '🇲🇨',
  'george-russell': '🇬🇧',
  'oscar-piastri': '🇦🇺',
  'kimi-antonelli': '🇮🇹',
  'max-verstappen': '🇳🇱',
  'lando-norris': '🇬🇧',
  'lewis-hamilton': '🇬🇧',
  'pierre-gasly': '🇫🇷',
  'arvid-lindblad': '🇬🇧',
  'franco-colapinto': '🇦🇷',
  'esteban-ocon': '🇫🇷',
  'oliver-bearman': '🇬🇧',
  'isack-hadjar': '🇫🇷',
  'liam-lawson': '🇳🇿',
  'lance-stroll': '🇨🇦',
  'nico-hulkenberg': '🇩🇪',
  'gabriel-bortoleto': '🇧🇷',
  'valtteri-bottas': '🇫🇮',
  'carlos-sainz': '🇪🇸',
  'alex-albon': '🇹🇭',
  'sergio-perez': '🇲🇽',
  'fernando-alonso': '🇪🇸',
};

function imageMarkup(imageSlug, type, alt) {
  if (!imageSlug) return '';
  const src = type === 'driver' ? `/images/drivers/${imageSlug}.jpg` : `/images/teams/${imageSlug}.png`;
  const className = type === 'driver' ? 'driver-avatar' : 'team-logo';
  return `<img class="${className}" src="${src}" alt="${alt}" onerror="this.style.display='none'">`;
}

function driverFlag(driverId) {
  return DRIVER_FLAGS[driverId] || '';
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function renderStandings(data) {
  document.getElementById('generated-at').textContent = formatGeneratedAt(data.generatedAt);

  const standingsBody = document.getElementById('standings-body');
  standingsBody.innerHTML = data.standings.map((row) => `
    <tr class="standings-row-link" data-team-href="team.html?team=${encodeURIComponent(row.teamId)}" tabindex="0" role="link" aria-label="Open ${row.displayName}">
      <td><span class="rank-pill">#${row.rank}</span></td>
      <td><span class="team-link">${row.displayName}</span></td>
      <td>${row.principalName}</td>
      <td class="points-strong">${row.totalPoints}</td>
      <td class="${pointsClass(row.latestRacePoints)}">${signedPoints(row.latestRacePoints)}</td>
      <td class="${weekOverWeekClass(row.wowDelta)}">${formatWeekOverWeekDelta(row.wowDelta)}</td>
    </tr>
  `).join('');

  standingsBody.onclick = (event) => {
    const row = event.target.closest('.standings-row-link');
    if (!row) return;
    window.location.href = row.dataset.teamHref;
  };

  standingsBody.onkeydown = (event) => {
    const row = event.target.closest('.standings-row-link');
    if (!row) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    window.location.href = row.dataset.teamHref;
  };

  const raceStatusList = document.getElementById('race-status-list');
  raceStatusList.innerHTML = buildRaceStatusRows(data.races).map((race) => `
    <div class="race-status-item">
      <div class="race-status-top">
        <div>
          <strong>R${race.round} · ${race.name}</strong>
          <div class="card-subtle">${formatRaceDate(race.date)}</div>
        </div>
        <span class="status-pill ${statusClass(race.statusName)}">${race.statusLabel}</span>
      </div>
    </div>
  `).join('');
}

function renderBigMovers(data) {
  const moversRoot = document.getElementById('big-movers');
  const rising = data.standings
    .filter((row) => row.wowDelta > 0)
    .sort(compareMoverRows)
    .slice(0, 3);
  const falling = data.standings
    .filter((row) => row.wowDelta < 0)
    .sort(compareMoverRows)
    .slice(0, 3);

  const renderMoverList = (rows, direction) => {
    if (rows.length === 0) {
      return `<div class="mover-empty">No ${direction === 'up' ? 'upward' : 'downward'} movement yet.</div>`;
    }

    return rows.map((row) => `
      <a class="mover-row mover-row-${direction}" href="team.html?team=${encodeURIComponent(row.teamId)}">
        <div class="mover-copy">
          <div class="mover-primary-line">
            <span class="mover-direction">${direction === 'up' ? '▲' : '▼'}</span>
            <strong class="mover-name">${row.displayName}</strong>
          </div>
          <div class="card-subtle">${row.principalName}</div>
        </div>
        <div class="mover-metrics">
          <div class="mover-delta ${weekOverWeekClass(row.wowDelta)}">${formatWeekOverWeekDelta(row.wowDelta)}</div>
          <div class="card-subtle">Rank #${row.rank} · ${signedPoints(row.latestRacePoints)} last race</div>
        </div>
      </a>
    `).join('');
  };

  moversRoot.innerHTML = `
    <section class="mover-panel">
      <div class="mover-panel-header">
        <div>
          <h3>Risers</h3>
        </div>
      </div>
      <div class="mover-list">
        ${renderMoverList(rising, 'up')}
      </div>
    </section>

    <section class="mover-panel">
      <div class="mover-panel-header">
        <div>
          <h3>Fallers</h3>
        </div>
      </div>
      <div class="mover-list">
        ${renderMoverList(falling, 'down')}
      </div>
    </section>
  `;
}

function renderSelectionStack(targetId, selections, type) {
  document.getElementById(targetId).innerHTML = selections.map((item) => `
    <div class="selection-tile">
      ${imageMarkup(item.imageSlug, type, item.name)}
      <div>
        <h4>${item.name}</h4>
        ${item.teamName ? `<p class="card-subtle">${item.teamName}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function renderRaceDetails(target, race) {
  const details = race.detail;
  const renderComponentRows = (components) => components.map((component) => `
    <div class="component-row"><span>${component.label}</span><strong class="${pointsClass(component.points)}">${signedPoints(component.points)}</strong></div>
  `).join('');

  const renderEntitySummary = (item, type) => `
    <div class="breakdown-entity-header">
      <div class="breakdown-entity-copy">
        ${imageMarkup(item.imageSlug, type, item.name)}
        <div>
          <h5>${item.name}${type === 'driver' ? ` <span class="entity-flag">${driverFlag(item.driverId)}</span>` : ''}</h5>
        </div>
      </div>
      <div class="breakdown-entity-points">
        <strong class="points-strong ${pointsClass(item.totalPoints)}">${signedPoints(item.totalPoints)}</strong>
      </div>
    </div>
  `;

  const renderDriverBlock = (driver) => `
    <article class="breakdown-entity">
      ${renderEntitySummary(driver, 'driver')}
      <div class="breakdown-entity-body">
        <div class="component-list">
          ${renderComponentRows(driver.components)}
        </div>
      </div>
    </article>
  `;

  const renderConstructorBlock = (constructor) => `
    <article class="breakdown-entity">
      ${renderEntitySummary(constructor, 'team')}
      <div class="breakdown-entity-body">
        ${constructor.weightingBreakdown ? `
          <div class="weighting-formula">
            <div class="weighting-row">
              <span>Lead driver</span>
              <span>${constructor.weightingBreakdown.leadDriverName} · ${signedPoints(constructor.weightingBreakdown.leadDriverPoints)}</span>
            </div>
            <div class="weighting-row">
              <span>Second driver</span>
              <span>${constructor.weightingBreakdown.secondDriverName} · ${signedPoints(constructor.weightingBreakdown.secondDriverPoints)}</span>
            </div>
            <div class="weighting-formula-note">${constructor.weightingBreakdown.formula} = ${signedPoints(constructor.weightingBreakdown.weightedPoints)}</div>
          </div>
        ` : ''}
        <div class="component-list">
          ${renderComponentRows(constructor.components)}
        </div>
      </div>
    </article>
  `;

  target.innerHTML += `
    <div class="race-detail">
      <div class="breakdown-toolbar">
        <button type="button" class="breakdown-mode-toggle" aria-expanded="false">Expand calculations</button>
      </div>
      <div class="breakdown-section">
        <div class="breakdown-section-header">
          <div>
            <h4>Driver subtotal</h4>
          </div>
          <strong class="points-strong ${pointsClass(details.driverSubtotal)}">${signedPoints(details.driverSubtotal)}</strong>
        </div>
        <div class="breakdown-entity-list">
          ${details.drivers.map(renderDriverBlock).join('')}
        </div>
      </div>

      <div class="breakdown-section">
        <div class="breakdown-section-header">
          <div>
            <h4>Team subtotal</h4>
          </div>
          <strong class="points-strong ${pointsClass(details.constructorSubtotal)}">${signedPoints(details.constructorSubtotal)}</strong>
        </div>
        <div class="breakdown-entity-list">
          ${details.constructors.map(renderConstructorBlock).join('')}
        </div>
      </div>

      ${details.homeCircuitApplied ? `
        <div class="breakdown-section breakdown-section-compact">
          <div class="breakdown-section-header">
            <div>
              <h4>Home circuit bonus</h4>
            </div>
            <strong class="points-strong ${pointsClass(details.homeCircuitBonusPoints)}">${signedPoints(details.homeCircuitBonusPoints)}</strong>
          </div>
        </div>
      ` : ''}

      <div class="breakdown-section breakdown-section-compact">
        <div class="breakdown-section-header">
          <div>
            <h4>Investment bonus</h4>
          </div>
          <strong class="points-strong ${pointsClass(details.investmentBonusPoints)}">${signedPoints(details.investmentBonusPoints)}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderTeamDetail(team) {
  document.title = `2026 Martin's F1 Fantasy League — ${team.displayName}`;
  document.getElementById('team-page-title').textContent = team.displayName;
  document.getElementById('team-page-copy').textContent = `${team.principalName} · Team Principal`;
  document.getElementById('team-home-circuit').textContent = team.seasonSelections.homeCircuit;
  document.getElementById('team-investment').textContent = `${team.seasonSelections.investmentBonusPerRace} pts/race`;
  document.getElementById('team-total-classified').textContent = team.seasonSelections.totalClassified ?? '—';
  document.getElementById('team-driver-champion').textContent = team.seasonSelections.driverChampion;
  document.getElementById('team-constructor-champion').textContent = team.seasonSelections.constructorChampion;
  document.getElementById('team-colapinto-finish').textContent = formatBestFinish(team.seasonSelections.colapintoBestFinish);

  renderSelectionStack('team-driver-list', team.drivers, 'driver');
  renderSelectionStack('team-constructor-list', team.constructors, 'team');

  const teamRaces = document.getElementById('team-races');
  teamRaces.innerHTML = '';
  const latestDetailedIndex = team.races.reduce((latest, race, index) => (race.detail ? index : latest), -1);

  team.races.forEach((race, index) => {
    if (race.detail) {
      const wrapper = document.createElement('details');
      wrapper.className = 'race-item';
      wrapper.open = latestDetailedIndex === index;
      wrapper.innerHTML = `
        <summary>
          <div class="race-summary-copy">
            <strong>${race.raceName}</strong>
            <span class="card-subtle">${formatRaceDate(race.raceDate)}</span>
          </div>
          <div class="race-summary-points">
            <div class="${pointsClass(race.totalPoints ?? 0)}">${signedPoints(race.totalPoints)} pts</div>
            <div class="race-running-total">${race.runningTotal == null ? '' : `Running total ${race.runningTotal}`}</div>
            <div class="race-toggle-hint">View breakdown</div>
          </div>
        </summary>
      `;
      renderRaceDetails(wrapper, race);
      teamRaces.appendChild(wrapper);
      return;
    }

    const wrapper = document.createElement('article');
    wrapper.className = 'race-item race-item-static';
    wrapper.innerHTML = `
      <div class="race-item-static-body">
        <div class="race-summary-copy">
          <strong>${race.raceName}</strong>
          <span class="card-subtle">${formatRaceDate(race.raceDate)}</span>
        </div>
        <div class="race-summary-points">
          <div class="card-subtle">${race.status === 'awaiting Monday scoring' ? 'Awaiting Monday scoring' : ''}</div>
        </div>
      </div>
    `;
    teamRaces.appendChild(wrapper);
  });

  teamRaces.onclick = (event) => {
    const toggle = event.target.closest('.breakdown-mode-toggle');
    if (!toggle) return;
    const raceDetail = toggle.closest('.race-detail');
    if (!raceDetail) return;
    const expanded = raceDetail.classList.toggle('race-detail-expanded');
    toggle.textContent = expanded ? 'Hide calculations' : 'Expand calculations';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };
}

async function initStandingsPage() {
  const standings = await fetchJson('/api/dashboard/standings');
  renderStandings(standings);
  renderBigMovers(standings);
}

async function initTeamPage() {
  const params = new URLSearchParams(window.location.search);
  const teamId = params.get('team');
  if (!teamId) {
    throw new Error('Missing team query parameter');
  }
  const team = await fetchJson(`/api/dashboard/teams/${encodeURIComponent(teamId)}`);
  renderTeamDetail(team);
}

async function main() {
  const view = document.body.dataset.dashboardView;
  if (view === 'team') {
    await initTeamPage();
    return;
  }
  await initStandingsPage();
}

main().catch((error) => {
  console.error(error);
  const shell = document.querySelector('.dashboard-shell');
  if (shell) {
    shell.innerHTML = `<div class="empty-state">Unable to load dashboard data. ${error.message}</div>`;
  }
});
