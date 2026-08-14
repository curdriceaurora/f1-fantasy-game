import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadCalendar, loadEntries, resolveCalendarFileName, loadFineReviews, loadFineReview, listNormalizedRaceIds, readJson, seasonPaths } from '../lib/season-store.js';


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

test('resolveCalendarFileName throws error on invalid F1_FANTASY_SEASON_YEAR', () => {
  withTempSeason(() => {
    process.env.F1_FANTASY_SEASON_YEAR = 'invalid';
    assert.throws(() => resolveCalendarFileName(), /Expected a four-digit year/);

    process.env.F1_FANTASY_SEASON_YEAR = '1900';
    assert.throws(() => resolveCalendarFileName(), /was not found in season\/config/);
  });
});

test('loadFineReviews validates fine documents structure and documents array', () => {
  withTempSeason(({ configDir }) => {
    writeFileSync(join(configDir, 'fine-documents.json'), JSON.stringify({
      australia: { reviewed: true, documents: ['https://example.test/doc.pdf'] },
    }));

    const reviews = loadFineReviews();
    assert.ok(reviews.australia);
    assert.strictEqual(reviews.australia.reviewed, true);
    assert.deepStrictEqual(reviews.australia.documents, ['https://example.test/doc.pdf']);

    const review = loadFineReview('australia');
    assert.strictEqual(review.reviewed, true);
  });
});

test('loadFineReviews throws error on invalid or deprecated fine document format', () => {
  withTempSeason(({ configDir }) => {
    writeFileSync(join(configDir, 'fine-documents.json'), JSON.stringify({
      australia: ['https://example.test/deprecated.pdf'],
    }));

    assert.throws(() => loadFineReviews(), /deprecated array format/);
  });
});

test('listNormalizedRaceIds lists json files or returns empty array when folder is missing', () => {
  withTempSeason(() => {
    const raceIds = listNormalizedRaceIds();
    assert.ok(Array.isArray(raceIds));
  });
});

test('readJson returns fallback value when file is missing or corrupted', () => {
  withTempSeason(({ configDir }) => {
    const missing = readJson(join(configDir, 'missing.json'), { fallback: true });
    assert.deepStrictEqual(missing, { fallback: true });

    writeFileSync(join(configDir, 'corrupted.json'), '{ invalid json syntax ');
    const corrupted = readJson(join(configDir, 'corrupted.json'), { fallback: true });
    assert.deepStrictEqual(corrupted, { fallback: true });
  });
});

test('season store handles absent calendars and rejects malformed fine reviews', () => {
  withTempSeason(({ configDir }) => {
    rmSync(configDir, { recursive: true, force: true });
    assert.equal(resolveCalendarFileName(), null);
    assert.deepEqual(loadCalendar(), []);

    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'fine-documents.json'), '[]');
    assert.throws(() => loadFineReviews(), /must be an object keyed by race id/);

    writeFileSync(join(configDir, 'fine-documents.json'), JSON.stringify({ australia: 'reviewed' }));
    assert.throws(() => loadFineReviews(), /must be an object/);

    writeFileSync(join(configDir, 'fine-documents.json'), JSON.stringify({ australia: {} }));
    assert.throws(() => loadFineReviews(), /documents.*array/);
  });
});

test('loadCalendar handles identical date and round deterministically', () => {
  withTempSeason(({ configDir }) => {
    writeFileSync(join(configDir, '2026-calendar.json'), JSON.stringify([
      { id: 'race-1', name: 'Race 1', date: '2026-05-01', round: 1 },
      { id: 'race-2', name: 'Race 2', date: '2026-05-01', round: 1 },
    ]));
    const calendar = loadCalendar();
    assert.equal(calendar.length, 2);
  });
});

test('listNormalizedRaceIds filters out non-json files in the normalized directory', () => {
  withTempSeason(({ configDir }) => {
    const normalizedDir = join(configDir, '..', 'normalized');
    mkdirSync(normalizedDir, { recursive: true });
    writeFileSync(join(normalizedDir, 'australia.json'), '{}');
    writeFileSync(join(normalizedDir, '.DS_Store'), 'junk');
    writeFileSync(join(normalizedDir, 'notes.txt'), 'notes');

    const raceIds = listNormalizedRaceIds();
    assert.deepEqual(raceIds, ['australia']);
  });
});

test('season store covers originalDate sort, invalid dates, non-array configs, and relative paths', () => {
  withTempSeason(({ configDir }) => {
    writeFileSync(join(configDir, '2026-calendar.json'), JSON.stringify([
      { id: 'race-postponed', name: 'Race Postponed', originalDate: '2026-06-01' },
      { id: 'race-dated', name: 'Race Dated', date: '2026-05-01', round: 1 },
      { id: 'race-invalid', name: 'Race Invalid', date: 'invalid-date', round: 2 },
    ]));
    const sorted = loadCalendar();
    assert.equal(sorted[0].id, 'race-dated');
    assert.equal(sorted[1].id, 'race-postponed');
    assert.equal(sorted[2].id, 'race-invalid');

    // Non-array calendar
    writeFileSync(join(configDir, '2026-calendar.json'), JSON.stringify({ notAnArray: true }));
    assert.deepEqual(loadCalendar(), []);

    // Non-array entries
    writeFileSync(join(configDir, 'entries.json'), JSON.stringify({ notAnArray: true }));
    assert.deepEqual(loadEntries(), []);

    // Non-object fine documents
    writeFileSync(join(configDir, 'fine-documents.json'), JSON.stringify(['array-format']));
    assert.throws(() => loadFineReviews(), /must be an object keyed by race id/);

    writeFileSync(join(configDir, 'fine-documents.json'), JSON.stringify({ race1: 'not-an-object' }));
    assert.throws(() => loadFineReviews(), /must be an object/);
  });

  const prev = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = './relative-season-path';
  try {
    const paths = seasonPaths();
    assert.ok(paths.season.endsWith('relative-season-path'));
  } finally {
    if (prev == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = prev;
  }
});



