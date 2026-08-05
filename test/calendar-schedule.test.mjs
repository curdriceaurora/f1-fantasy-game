import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { loadCalendarScheduleData } from '../lib/dashboard-data.js';
import { loadCalendar } from '../lib/season-store.js';

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withTempSeason(calendar, callback) {
  const root = mkdtempSync(join(tmpdir(), 'f1-calendar-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;
  try {
    writeJson(join(seasonDir, 'config', '2026-calendar.json'), calendar);
    return callback();
  } finally {
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

// A race whose date changes without being physically moved in the JSON must still
// be sequenced chronologically — this is the regression the calendar fix addresses.
const OUT_OF_ORDER_CALENDAR = [
  { id: 'later', round: 3, name: 'Later', date: '2026-10-04', isSprintWeekend: false, status: 'scheduled' },
  { id: 'earlier', round: 1, name: 'Earlier', date: '2026-03-08', isSprintWeekend: false, status: 'scheduled' },
  { id: 'gone', round: null, name: 'Gone', date: '2026-04-19', isSprintWeekend: false, status: 'cancelled' },
  { id: 'middle', round: 2, name: 'Middle', date: '2026-06-07', isSprintWeekend: true, status: 'scheduled' },
];

test('loadCalendar returns races in date order regardless of JSON array order', () => {
  withTempSeason(OUT_OF_ORDER_CALENDAR, () => {
    assert.deepEqual(
      loadCalendar().map((race) => race.id),
      ['earlier', 'gone', 'middle', 'later'],
    );
  });
});

test('calendar schedule is date-ordered and excludes cancelled races from the active count', () => {
  withTempSeason(OUT_OF_ORDER_CALENDAR, () => {
    const { races, activeCount } = loadCalendarScheduleData();
    assert.deepEqual(races.map((race) => race.id), ['earlier', 'gone', 'middle', 'later']);
    assert.equal(activeCount, 3);
    const gone = races.find((race) => race.id === 'gone');
    assert.equal(gone.status, 'cancelled');
    assert.equal(gone.round, null);
    assert.equal(races.find((race) => race.id === 'middle').isSprintWeekend, true);
  });
});
