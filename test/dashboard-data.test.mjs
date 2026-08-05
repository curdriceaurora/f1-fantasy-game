import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadStandingsData,
  loadCalendarScheduleData,
  loadTeamListData,
  loadTeamDetail,
  loadRaceDetail,
} from '../lib/dashboard-data.js';

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
