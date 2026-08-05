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

test('a postponed race passes its status through and still counts as active (only cancelled is excluded)', () => {
  withTempSeason([
    { id: 'run', round: 1, name: 'Run', date: '2026-03-08', isSprintWeekend: false, status: 'scheduled' },
    { id: 'delayed', round: 2, name: 'Delayed', date: '2026-04-01', isSprintWeekend: false, status: 'postponed' },
    { id: 'gone', round: null, name: 'Gone', date: '2026-05-01', isSprintWeekend: false, status: 'cancelled' },
  ], () => {
    const { races, activeCount } = loadCalendarScheduleData();
    assert.equal(races.find((race) => race.id === 'delayed').status, 'postponed');
    assert.equal(activeCount, 2); // scheduled + postponed; cancelled excluded
  });
});

test('an undated postponed race sorts to the end, not to 1970', () => {
  withTempSeason([
    { id: 'opener', round: 1, name: 'Opener', date: '2026-03-08', isSprintWeekend: false, status: 'scheduled' },
    { id: 'undated', round: 4, name: 'Undated', date: null, isSprintWeekend: false, status: 'postponed' },
    { id: 'finale', round: 3, name: 'Finale', date: '2026-12-06', isSprintWeekend: false, status: 'scheduled' },
  ], () => {
    // date: null must not become new Date(null) === 1970 and jump to the front.
    assert.deepEqual(loadCalendar().map((race) => race.id), ['opener', 'finale', 'undated']);
    assert.equal(loadCalendarScheduleData().races.at(-1).id, 'undated');
  });
});

test('a postponed race with only an original date keeps its original slot', () => {
  withTempSeason([
    { id: 'opener', round: 1, name: 'Opener', date: '2026-03-08', isSprintWeekend: false, status: 'scheduled' },
    { id: 'held', round: 2, name: 'Held', date: null, originalDate: '2026-04-19', isSprintWeekend: false, status: 'postponed' },
    { id: 'finale', round: 3, name: 'Finale', date: '2026-12-06', isSprintWeekend: false, status: 'scheduled' },
  ], () => {
    // Falls back to originalDate (April) rather than dropping to the end.
    assert.deepEqual(loadCalendar().map((race) => race.id), ['opener', 'held', 'finale']);
  });
});
