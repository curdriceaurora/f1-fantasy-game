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
