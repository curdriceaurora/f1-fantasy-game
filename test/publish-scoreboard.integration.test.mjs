import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { rebuildScoreboard } from '../lib/publish-scoreboard.js';
import { readJson, withFixtureSeason } from './helpers/season-fixture.mjs';

for (const year of [2023, 2024, 2025]) {
  test(`rebuildScoreboard produces consistent standings for the ${year} synthetic season`, async () => {
    await withFixtureSeason(year, async ({ seasonDir }) => {
      const result = rebuildScoreboard();
      const standings = readJson(join(seasonDir, 'scored', 'standings.json'));
      const entries = readJson(join(seasonDir, 'config', 'entries.json'));
      const calendar = readJson(join(seasonDir, 'config', '2026-calendar.json'));

      assert.equal(result.standings.length, entries.length);
      assert.equal(standings.standings.length, entries.length);
      assert.equal(result.normalizedRaces.length, calendar.length);

      const teamFiles = readdirSync(join(seasonDir, 'scored', 'teams')).filter((file) => file.endsWith('.json'));
      assert.equal(teamFiles.length, entries.length);

      for (const entry of entries) {
        const teamFilePath = join(seasonDir, 'scored', 'teams', `${entry.teamId}.json`);
        assert.equal(existsSync(teamFilePath), true);

        const teamFile = readJson(teamFilePath);
        const raceTotal = teamFile.races.reduce((sum, race) => sum + race.totalPoints, 0);
        assert.equal(teamFile.races.length, calendar.length);
        assert.equal(teamFile.totalPoints, raceTotal);
        assert.equal(teamFile.completedRaces, calendar.length);
        assert.equal(teamFile.races.at(-1).runningTotal, teamFile.totalPoints);
      }

      for (const race of calendar) {
        const raceFile = readJson(join(seasonDir, 'scored', `${race.id}.json`));
        assert.equal(raceFile.teams.length, entries.length);
      }

      const totals = standings.standings.map((row) => row.totalPoints);
      const sortedTotals = [...totals].sort((left, right) => right - left);
      assert.deepEqual(totals, sortedTotals);
    });
  });
}

test('rebuildScoreboard removes stale team score files after entries change', async () => {
  await withFixtureSeason(2023, async ({ seasonDir }) => {
    const ghostFile = join(seasonDir, 'scored', 'teams', 'ghost-team.json');
    mkdirSync(join(seasonDir, 'scored', 'teams'), { recursive: true });
    writeFileSync(ghostFile, '{}\n');

    assert.equal(existsSync(ghostFile), true);
    rebuildScoreboard();
    assert.equal(existsSync(ghostFile), false);
  });
});

test('rebuildScoreboard breaks ties by latest race points and then alphabetically by display name', async () => {
  await withFixtureSeason(2023, async ({ seasonDir }) => {
    const entriesPath = join(seasonDir, 'config', 'entries.json');
    const entries = [
      {
        teamId: 'team-a',
        principalName: 'Alice',
        displayName: 'Beta Racing',
        selectedDriverIds: ['george-russell', 'kimi-antonelli', 'esteban-ocon'],
        selectedConstructorIds: ['mercedes', 'alpine', 'williams'],
        homeCircuitId: 'australia',
        investmentBonusPerRace: 0,
        predictions: {},
      },
      {
        teamId: 'team-b',
        principalName: 'Bob',
        displayName: 'Alpha Racing',
        selectedDriverIds: ['george-russell', 'kimi-antonelli', 'esteban-ocon'],
        selectedConstructorIds: ['mercedes', 'alpine', 'williams'],
        homeCircuitId: 'australia',
        investmentBonusPerRace: 0,
        predictions: {},
      },
    ];
    writeFileSync(entriesPath, JSON.stringify(entries, null, 2));

    const result = rebuildScoreboard();
    assert.equal(result.standings.length, 2);
    // Identical points and latestRacePoints -> alphabetical by displayName ('Alpha Racing' before 'Beta Racing')
    assert.equal(result.standings[0].displayName, 'Alpha Racing');
    assert.equal(result.standings[1].displayName, 'Beta Racing');
  });
});

test('rebuildScoreboard removes orphaned scored team files and ignores non-json files', async () => {
  await withFixtureSeason(2023, async ({ seasonDir }) => {
    const { mkdirSync, existsSync } = await import('node:fs');
    const scoredTeamsDir = join(seasonDir, 'scored', 'teams');
    mkdirSync(scoredTeamsDir, { recursive: true });

    const orphanedPath = join(scoredTeamsDir, 'deleted-team.json');
    const nonJsonPath = join(scoredTeamsDir, '.DS_Store');

    writeFileSync(orphanedPath, JSON.stringify({ teamId: 'deleted-team' }));
    writeFileSync(nonJsonPath, 'junk');

    assert.equal(existsSync(orphanedPath), true);

    rebuildScoreboard();

    assert.equal(existsSync(orphanedPath), false);
    assert.equal(existsSync(nonJsonPath), true);
  });
});

test('rebuildScoreboard breaks standings ties by latestRacePoints', async () => {
  await withFixtureSeason(2023, async ({ seasonDir }) => {
    const entriesPath = join(seasonDir, 'config', 'entries.json');
    const calendarPath = join(seasonDir, 'config', '2026-calendar.json');

    // Create 2 races where both races have identical scores
    writeFileSync(calendarPath, JSON.stringify([
      { id: 'race-1', name: 'Race 1', date: '2026-03-08', round: 1 },
      { id: 'race-2', name: 'Race 2', date: '2026-03-15', round: 2 },
    ]));

    const normRace = (id, date, round) => ({
      raceId: id,
      raceName: id,
      date,
      round,
      drivers: {
        'max-verstappen': { gridStart: 1, racePosition: 1, gridPenaltyPlaces: 0, timePenaltySeconds: 0, fineEuros: 0 },
      },
      teams: {
        'red-bull': { driverIds: ['max-verstappen'], fineEuros: 0 },
      },
    });
    writeFileSync(join(seasonDir, 'normalized', 'race-1.json'), JSON.stringify(normRace('race-1', '2026-03-08', 1)));
    writeFileSync(join(seasonDir, 'normalized', 'race-2.json'), JSON.stringify(normRace('race-2', '2026-03-15', 2)));

    // Both teams pick Verstappen & Red Bull.
    // Team A (Alpha Racing) has homeCircuitId: "race-1" -> Race 1 gets 2X, Race 2 gets X (latest = X).
    // Team B (Beta Racing) has homeCircuitId: "race-2" -> Race 1 gets X, Race 2 gets 2X (latest = 2X).
    // Both have total = 3X (135 pts).
    // Beta Racing MUST rank 1st on latestRacePoints (90 > 45) despite Alpha being alphabetical 1st.
    const entries = [
      {
        teamId: 'team-a',
        principalName: 'Alice',
        displayName: 'Alpha Racing',
        selectedDriverIds: ['max-verstappen'],
        selectedConstructorIds: ['red-bull'],
        homeCircuitId: 'race-1',
        investmentBonusPerRace: 0,
        predictions: {},
      },
      {
        teamId: 'team-b',
        principalName: 'Bob',
        displayName: 'Beta Racing',
        selectedDriverIds: ['max-verstappen'],
        selectedConstructorIds: ['red-bull'],
        homeCircuitId: 'race-2',
        investmentBonusPerRace: 0,
        predictions: {},
      },
    ];
    writeFileSync(entriesPath, JSON.stringify(entries, null, 2));

    const result = rebuildScoreboard();
    assert.equal(result.standings.length, 2);
    assert.equal(result.standings[0].totalPoints, result.standings[1].totalPoints);
    assert.ok(result.standings[0].latestRacePoints > result.standings[1].latestRacePoints);
    assert.equal(result.standings[0].teamId, 'team-b');
    assert.equal(result.standings[0].displayName, 'Beta Racing');
    assert.equal(result.standings[1].teamId, 'team-a');
    assert.equal(result.standings[1].displayName, 'Alpha Racing');
  });
});






