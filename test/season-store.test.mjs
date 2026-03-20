import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadCalendar, resolveCalendarFileName } from '../lib/season-store.js';

function withTempSeason(callback) {
  const workingRoot = mkdtempSync(join(tmpdir(), 'f1-season-store-'));
  const seasonDir = join(workingRoot, 'season');
  const configDir = join(seasonDir, 'config');
  mkdirSync(configDir, { recursive: true });

  const previousSeasonDir = process.env.F1_FANTASY_SEASON_DIR;
  const previousSeasonYear = process.env.F1_FANTASY_SEASON_YEAR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    return callback({ configDir });
  } finally {
    if (previousSeasonDir == null) {
      delete process.env.F1_FANTASY_SEASON_DIR;
    } else {
      process.env.F1_FANTASY_SEASON_DIR = previousSeasonDir;
    }
    if (previousSeasonYear == null) {
      delete process.env.F1_FANTASY_SEASON_YEAR;
    } else {
      process.env.F1_FANTASY_SEASON_YEAR = previousSeasonYear;
    }
    rmSync(workingRoot, { recursive: true, force: true });
  }
}

function writeCalendar(configDir, year, value = []) {
  writeFileSync(join(configDir, `${year}-calendar.json`), `${JSON.stringify(value, null, 2)}\n`);
}

test('resolveCalendarFileName honors explicit F1_FANTASY_SEASON_YEAR', () => {
  withTempSeason(({ configDir }) => {
    writeCalendar(configDir, 2026, [{ id: 'australia' }]);
    writeCalendar(configDir, 2027, [{ id: 'melbourne' }]);

    process.env.F1_FANTASY_SEASON_YEAR = '2027';
    assert.equal(resolveCalendarFileName(new Date('2026-01-01T00:00:00Z')), '2027-calendar.json');
  });
});

test('resolveCalendarFileName prefers current UTC year and then latest available', () => {
  withTempSeason(({ configDir }) => {
    writeCalendar(configDir, 2025, [{ id: 'x' }]);
    writeCalendar(configDir, 2026, [{ id: 'y' }]);
    writeCalendar(configDir, 2027, [{ id: 'z' }]);

    delete process.env.F1_FANTASY_SEASON_YEAR;
    assert.equal(resolveCalendarFileName(new Date('2026-03-01T00:00:00Z')), '2026-calendar.json');
    assert.equal(resolveCalendarFileName(new Date('2024-03-01T00:00:00Z')), '2027-calendar.json');
  });
});

test('loadCalendar reads from the resolved season year file', () => {
  withTempSeason(({ configDir }) => {
    writeCalendar(configDir, 2026, [{ id: 'australia' }]);
    writeCalendar(configDir, 2027, [{ id: 'china' }]);

    process.env.F1_FANTASY_SEASON_YEAR = '2027';
    assert.deepEqual(loadCalendar(), [{ id: 'china' }]);
  });
});
