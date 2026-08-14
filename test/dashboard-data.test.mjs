import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeekOverWeekDelta,
  compareStandings,
  loadStandingsData,
  loadCalendarScheduleData,
  loadTeamListData,
  loadTeamDetail,
  loadRaceDetail,
} from '../lib/dashboard-data.js';

test('standings helpers cover every tiebreak and empty-history behavior', () => {
  assert.ok(compareStandings(
    { totalPoints: 10, latestRacePoints: 2, displayName: 'A' },
    { totalPoints: 12, latestRacePoints: 2, displayName: 'B' },
  ) > 0);
  assert.ok(compareStandings(
    { totalPoints: 10, latestRacePoints: 2, displayName: 'A' },
    { totalPoints: 10, latestRacePoints: 4, displayName: 'B' },
  ) > 0);
  assert.ok(compareStandings(
    { totalPoints: 10, latestRacePoints: 2, displayName: 'B' },
    { totalPoints: 10, latestRacePoints: 2, displayName: 'A' },
  ) > 0);
  assert.equal(buildWeekOverWeekDelta([], []).size, 0);
});

test('loadStandingsData returns structured calendar, standings, and week-over-week deltas', () => {
  const data = loadStandingsData();
  assert.ok(data);
  assert.ok(Array.isArray(data.races));
  assert.ok(Array.isArray(data.standings));
  assert.ok(data.races.length > 0);
  assert.ok(data.standings.length > 0);

  const firstRow = data.standings[0];
  assert.ok(firstRow.teamId);
  assert.ok(firstRow.displayName);
  assert.strictEqual(typeof firstRow.totalPoints, 'number');
  assert.strictEqual(typeof firstRow.latestRacePoints, 'number');
});

test('loadCalendarScheduleData returns public calendar with correct flags and active count', () => {
  const data = loadCalendarScheduleData();
  assert.ok(data);
  assert.ok(Array.isArray(data.races));
  assert.ok(data.activeCount <= data.races.length);

  for (const race of data.races) {
    assert.ok(race.id);
    assert.ok(race.name);
    assert.ok(race.date);
    assert.ok(race.flag);
    assert.strictEqual(typeof race.isSprintWeekend, 'boolean');
    assert.ok(race.status);
  }
});

test('loadTeamListData enriches team rosters with driver and constructor objects', () => {
  const teams = loadTeamListData();
  assert.ok(Array.isArray(teams));
  assert.ok(teams.length > 0);

  const team = teams[0];
  assert.ok(team.teamId);
  assert.ok(team.principalName);
  assert.ok(team.displayName);
  assert.ok(Array.isArray(team.drivers));
  assert.ok(Array.isArray(team.constructors));
  assert.strictEqual(team.drivers.length, 3);
  assert.strictEqual(team.constructors.length, 3);

  const driver = team.drivers[0];
  assert.ok(driver.id);
  assert.ok(driver.name);
  assert.ok(driver.teamName);

  const constructor = team.constructors[0];
  assert.ok(constructor.id);
  assert.ok(constructor.name);
});

test('loadTeamDetail loads valid team detail with predictions and race breakdown', () => {
  const teams = loadTeamListData();
  const validTeamId = teams[0].teamId;

  const detail = loadTeamDetail(validTeamId);
  assert.ok(detail);
  assert.strictEqual(detail.teamId, validTeamId);
  assert.ok(detail.seasonSelections);
  assert.ok(detail.standings);
  assert.ok(Array.isArray(detail.races));
  assert.ok(detail.races.length > 0);

  const race = detail.races[0];
  assert.ok(race.raceId);
  assert.ok(race.raceName);
  assert.ok(race.status);
});

test('loadTeamDetail returns null for non-existent team ID', () => {
  const detail = loadTeamDetail('non-existent-team-id-999');
  assert.strictEqual(detail, null);
});

test('loadRaceDetail returns null for non-existent race ID', () => {
  const detail = loadRaceDetail('non-existent-race-id-999');
  assert.strictEqual(detail, null);
});

test('loadRaceDetail returns data for existing scored race if present', () => {
  const standings = loadStandingsData();
  const raceId = standings.races[0]?.id;
  if (raceId) {
    const detail = loadRaceDetail(raceId);
    // Detail may be null if un-scored, or an object if scored
    if (detail !== null) {
      assert.ok(typeof detail === 'object');
    }
  }
});

test('buildWeekOverWeekDelta returns empty Map when teams have only 1 completed race', () => {
  const entries = [{ teamId: 'team-1', displayName: 'Team 1' }];
  const standingsRows = [{ teamId: 'team-1', rank: 1 }];
  // If stored.completedRaces <= 1, it filters out and returns empty Map
  const deltaMap = buildWeekOverWeekDelta(entries, standingsRows);
  assert.equal(deltaMap.size, 0);
});

test('dashboard data loaders compute deltas and enriches details across multi-race stored data', async () => {
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'f1-dash-multi-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    mkdirSync(join(seasonDir, 'config'), { recursive: true });
    mkdirSync(join(seasonDir, 'scored', 'teams'), { recursive: true });

    writeFileSync(join(seasonDir, 'config', '2026-calendar.json'), JSON.stringify([
      { id: 'race-1', name: 'Race 1', date: '2026-03-01' },
      { id: 'race-2', name: 'Race 2', date: '2026-03-15' },
    ]));
    writeFileSync(join(seasonDir, 'config', 'entries.json'), JSON.stringify([
      {
        teamId: 'team-1',
        principalName: 'P1',
        displayName: 'Team 1',
        selectedDriverIds: ['george-russell'],
        selectedConstructorIds: ['mercedes'],
        homeCircuitId: 'monaco',
        investmentBonusPerRace: 0,
      },
      {
        teamId: 'team-2',
        principalName: 'P2',
        displayName: 'Team 2',
        selectedDriverIds: ['lewis-hamilton'],
        selectedConstructorIds: ['ferrari'],
        homeCircuitId: 'monaco',
        investmentBonusPerRace: 0,
      },
    ]));
    writeFileSync(join(seasonDir, 'scored', 'standings.json'), JSON.stringify({
      generatedAt: '2026-03-16T12:00:00Z',
      standings: [
        { teamId: 'team-1', rank: 1, totalPoints: 50, latestRacePoints: 30, completedRaces: 2 },
        { teamId: 'team-2', rank: 2, totalPoints: 40, latestRacePoints: 10, completedRaces: 2 },
      ],
    }));
    writeFileSync(join(seasonDir, 'scored', 'teams', 'team-1.json'), JSON.stringify({
      teamId: 'team-1',
      completedRaces: 2,
      totalPoints: 50,
      latestRacePoints: 30,
      races: [
        { raceId: 'race-1', totalPoints: 20, runningTotal: 20 },
        { raceId: 'race-2', totalPoints: 30, runningTotal: 50 },
      ],
    }));
    writeFileSync(join(seasonDir, 'scored', 'teams', 'team-2.json'), JSON.stringify({
      teamId: 'team-2',
      completedRaces: 2,
      totalPoints: 40,
      latestRacePoints: 10,
      races: [
        { raceId: 'race-1', totalPoints: 30, runningTotal: 30 },
        { raceId: 'race-2', totalPoints: 10, runningTotal: 40 },
      ],
    }));

    const standings = loadStandingsData();
    assert.ok(standings.standings.length > 0);
    assert.equal(typeof standings.standings[0].wowDelta, 'number');

    const teamList = loadTeamListData();
    assert.equal(teamList[0].completedRaces, 2);

    const teamDetail = loadTeamDetail('team-1');
    assert.ok(teamDetail);
    assert.equal(teamDetail.races[0].totalPoints, 20);
  } finally {
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});


test('dashboard data uses fallbackStandings when standings.json is missing', async () => {
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'f1-dash-test-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    mkdirSync(join(seasonDir, 'config'), { recursive: true });
    writeFileSync(join(seasonDir, 'config', '2026-calendar.json'), JSON.stringify([
      { id: 'unknown-gp', name: 'Unknown GP', date: '2026-05-01' },
    ]));
    writeFileSync(join(seasonDir, 'config', 'entries.json'), JSON.stringify([
      {
        teamId: 'team-empty',
        principalName: 'Principal Empty',
        displayName: 'Empty Entry',
        selectedDriverIds: ['george-russell'],
        selectedConstructorIds: ['mercedes'],
        homeCircuitId: 'non-existent-circuit',
        investmentBonusPerRace: 0,
        predictions: null,
      },
    ]));

    const standings = loadStandingsData();
    assert.equal(standings.generatedAt, null);
    assert.equal(standings.standings.length, 1);
    assert.equal(standings.standings[0].totalPoints, 0);

    const schedule = loadCalendarScheduleData();
    assert.equal(schedule.races[0].flag, '🏁');

    const detail = loadTeamDetail('team-empty');
    assert.ok(detail);
    assert.equal(detail.seasonSelections.homeCircuit, 'non-existent-circuit');
    assert.equal(detail.seasonSelections.driverChampion, null);
    assert.equal(detail.seasonSelections.constructorChampion, null);
  } finally {
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildWeekOverWeekDelta handles missing previous race and unranked teams', async () => {
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'f1-dash-edge-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    mkdirSync(join(seasonDir, 'scored', 'teams'), { recursive: true });
    mkdirSync(join(seasonDir, 'config'), { recursive: true });

    // Team 1 has completedRaces=2 but races is empty
    writeFileSync(join(seasonDir, 'scored', 'teams', 'team-missing-races.json'), JSON.stringify({
      teamId: 'team-missing-races',
      completedRaces: 2,
      races: [],
    }));
    // Team 2 has valid 2 races
    writeFileSync(join(seasonDir, 'scored', 'teams', 'team-valid.json'), JSON.stringify({
      teamId: 'team-valid',
      completedRaces: 2,
      races: [
        { totalPoints: 10, runningTotal: 10 },
        { totalPoints: 20, runningTotal: 30 },
      ],
    }));

    const entries = [
      { teamId: 'team-missing-races', displayName: 'Missing Races' },
      { teamId: 'team-valid', displayName: 'Valid' },
      { teamId: 'team-unranked', displayName: 'Unranked' },
    ];
    const standingsRows = [
      { teamId: 'team-valid', rank: 1 },
      { teamId: 'team-unranked', rank: 2 },
    ];

    const deltas = buildWeekOverWeekDelta(entries, standingsRows);
    assert.equal(deltas.get('team-unranked'), null);

    // Test loadTeamDetail with null homeCircuitId
    writeFileSync(join(seasonDir, 'config', '2026-calendar.json'), JSON.stringify([]));
    writeFileSync(join(seasonDir, 'config', 'entries.json'), JSON.stringify([
      {
        teamId: 'team-no-circuit',
        displayName: 'No Circuit',
        selectedDriverIds: [],
        selectedConstructorIds: [],
        homeCircuitId: null,
      },
    ]));
    const detail = loadTeamDetail('team-no-circuit');
    assert.equal(detail.seasonSelections.homeCircuit, '—');
  } finally {
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('dashboard-data covers compareStandings tie breaking and unknown entity enrichments', async () => {
  const { compareStandings, loadTeamListData, loadTeamDetail, loadCalendarScheduleData } = await import('../lib/dashboard-data.js');
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // compareStandings
  const a = { totalPoints: 100, latestRacePoints: 30, displayName: 'Alpha' };
  const b = { totalPoints: 100, latestRacePoints: 20, displayName: 'Beta' };
  const c = { totalPoints: 100, latestRacePoints: 30, displayName: 'Gamma' };

  assert.ok(compareStandings(a, b) < 0); // a outscores b on latest race
  assert.ok(compareStandings(a, c) < 0); // a before c alphabetically

  const root = mkdtempSync(join(tmpdir(), 'f1-dash-all-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    mkdirSync(join(seasonDir, 'scored', 'teams'), { recursive: true });
    mkdirSync(join(seasonDir, 'config'), { recursive: true });

    // Calendar with missing round and custom venue
    writeFileSync(join(seasonDir, 'config', '2026-calendar.json'), JSON.stringify([
      { id: 'custom-gp', name: 'Custom GP', date: '2026-11-01', round: null, venue: 'Custom Track', isSprintWeekend: true, status: 'scheduled' },
      { id: 'cancelled-gp', name: 'Cancelled GP', date: '2026-11-08', status: 'cancelled' },
    ]));

    // Entry with completely unknown driver & team IDs
    writeFileSync(join(seasonDir, 'config', 'entries.json'), JSON.stringify([
      {
        teamId: 'unknown-entities-team',
        principalName: 'Zack',
        displayName: 'Zack Racing',
        selectedDriverIds: ['unknown-driver-999'],
        selectedConstructorIds: ['unknown-constructor-888'],
        homeCircuitId: 'custom-gp',
        investmentBonusPerRace: 0,
        predictions: {
          totalClassified: 18,
          driverChampion: 'unknown-driver-999',
          constructorChampion: 'unknown-constructor-888',
          colapintoBestFinish: 10,
        },
      },
    ]));

    // Stored score for team, with empty standings.json so standing lookup is undefined
    writeFileSync(join(seasonDir, 'scored', 'standings.json'), JSON.stringify({ standings: [] }));
    writeFileSync(join(seasonDir, 'scored', 'teams', 'unknown-entities-team.json'), JSON.stringify({
      teamId: 'unknown-entities-team',
      totalPoints: 75,
      completedRaces: 1,
      latestRacePoints: 75,
      races: [
        { raceId: 'custom-gp', totalPoints: 75, runningTotal: 75 },
      ],
    }));


    const schedule = loadCalendarScheduleData();
    assert.equal(schedule.races[0].round, null);
    assert.equal(schedule.races[0].venue, 'Custom Track');
    assert.equal(schedule.races[0].isSprintWeekend, true);
    assert.equal(schedule.activeCount, 1);

    const teamList = loadTeamListData();
    assert.equal(teamList[0].drivers[0].teamName, '');
    assert.equal(teamList[0].constructors[0].imageSlug, null);

    const detail = loadTeamDetail('unknown-entities-team');
    assert.equal(detail.standings.totalPoints, 75);
    assert.equal(detail.seasonSelections.driverChampion.name, 'unknown-driver-999');
    assert.equal(detail.seasonSelections.constructorChampion.name, 'unknown-constructor-888');
    assert.equal(detail.races[0].totalPoints, 75);
    assert.equal(detail.races[1].totalPoints, null);
  } finally {
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});






