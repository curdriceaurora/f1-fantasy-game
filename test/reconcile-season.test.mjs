import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { reconcileSeason } from '../scripts/reconcile-season.mjs';

const NOW = new Date('2026-04-06T14:00:00Z');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

async function withTempSeason(callback, { finalized = [], fineDocuments = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'f1-reconcile-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    writeJson(join(seasonDir, 'config', '2026-calendar.json'), [
      { id: 'australia', round: 1, name: 'Australian Grand Prix', meetingName: 'Australian Grand Prix', date: '2026-03-08', isSprintWeekend: false },
      { id: 'china', round: 2, name: 'Chinese Grand Prix', meetingName: 'Chinese Grand Prix', date: '2026-03-15', isSprintWeekend: false },
      { id: 'japan', round: 3, name: 'Japanese Grand Prix', meetingName: 'Japanese Grand Prix', date: '2026-03-29', isSprintWeekend: false },
      { id: 'bahrain', round: 4, name: 'Bahrain Grand Prix', meetingName: 'Bahrain Grand Prix', date: '2026-05-10', isSprintWeekend: false },
    ]);
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), fineDocuments);
    for (const raceId of finalized) {
      writeJson(join(seasonDir, 'normalized', `${raceId}.json`), { raceId });
      writeJson(join(seasonDir, 'scored', `${raceId}.json`), { raceId });
    }
    return await callback(seasonDir);
  } finally {
    if (previous == null) {
      delete process.env.F1_FANTASY_SEASON_DIR;
    } else {
      process.env.F1_FANTASY_SEASON_DIR = previous;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

function stubScoreRace(scored) {
  return async (raceId) => {
    scored.push(raceId);
    return {
      race: { name: raceId },
      fineSummary: { documents: [] },
      scoreboard: { standings: [] },
    };
  };
}

test('races skipped by earlier failures are picked up, and future races are left alone', async () => {
  await withTempSeason(async () => {
    const scored = [];

    const result = await reconcileSeason({
      now: NOW,
      discoverMonetaryFinePdfs: async () => [],
      discoverPotentialPenaltyPdfs: async () => [],
      scoreRace: stubScoreRace(scored),
    });

    // bahrain is not eligible until its publication Monday.
    assert.deepEqual(scored, ['australia', 'china', 'japan']);
    assert.deepEqual(result.failed, []);
  });
});

test('a finalized race whose fine documents still match is left untouched', async () => {
  await withTempSeason(async () => {
    const scored = [];

    const result = await reconcileSeason({
      now: NOW,
      discoverMonetaryFinePdfs: async (race) => (race.id === 'china' ? ['https://fia.test/china.pdf'] : []),
      discoverPotentialPenaltyPdfs: async () => [],
      scoreRace: stubScoreRace(scored),
    });

    assert.deepEqual(scored, ['china', 'japan']);
    assert.deepEqual(result.unchanged, ['australia']);
  }, {
    finalized: ['australia', 'china'],
    fineDocuments: {
      australia: { reviewed: true, documents: [], notes: '', reviewedAt: null },
      china: { reviewed: true, documents: [], notes: '', reviewedAt: null },
    },
  });
});

test('force rescores finalized races whose documents have not changed', async () => {
  await withTempSeason(async () => {
    const scored = [];

    await reconcileSeason({
      now: NOW,
      force: true,
      discoverMonetaryFinePdfs: async () => [],
      discoverPotentialPenaltyPdfs: async () => [],
      scoreRace: stubScoreRace(scored),
    });

    assert.deepEqual(scored, ['australia', 'china', 'japan']);
  }, {
    finalized: ['australia'],
    fineDocuments: { australia: { reviewed: true, documents: [], notes: '', reviewedAt: null } },
  });
});

test('one unscoreable race does not strand the rest of the catch-up', async () => {
  await withTempSeason(async (seasonDir) => {
    const scored = [];

    const result = await reconcileSeason({
      now: NOW,
      discoverMonetaryFinePdfs: async (race) => {
        if (race.id === 'china') throw new Error('FIA documents page unavailable: 403 (after 4 attempts)');
        return [];
      },
      discoverPotentialPenaltyPdfs: async () => [],
      scoreRace: stubScoreRace(scored),
    });

    assert.deepEqual(scored, ['australia', 'japan']);
    assert.deepEqual(result.failed.map((failure) => failure.raceId), ['china']);
    // A failed discovery must never be recorded as a completed fine review.
    assert.equal(readJson(join(seasonDir, 'config', 'fine-documents.json')).china, undefined);
  });
});

test('dry run reports the pending races without writing anything', async () => {
  await withTempSeason(async (seasonDir) => {
    const result = await reconcileSeason({
      now: NOW,
      dryRun: true,
      discoverMonetaryFinePdfs: async () => assert.fail('dry run must not hit the network'),
      scoreRace: async () => assert.fail('dry run must not score'),
    });

    assert.deepEqual(result, { scored: [], unchanged: [], failed: [] });
    assert.deepEqual(readJson(join(seasonDir, 'config', 'fine-documents.json')), {});
  });
});

test('reconcileSeason handles season before any eligible races', async () => {
  await withTempSeason(async () => {
    const earlyDate = new Date('2026-01-01T00:00:00Z');
    const result = await reconcileSeason({
      now: earlyDate,
      scoreRace: async () => assert.fail('should not score'),
    });
    assert.deepEqual(result, { scored: [], unchanged: [], failed: [] });
  });
});

