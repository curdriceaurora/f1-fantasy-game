import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { autoScore } from '../scripts/auto-score.mjs';

const NOW = new Date('2026-03-09T14:00:00Z');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

async function withTempSeason(callback, { finalized = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'f1-auto-score-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    writeJson(join(seasonDir, 'config', '2026-calendar.json'), [
      { id: 'australia', round: 1, name: 'Australian Grand Prix', meetingName: 'Australian Grand Prix', date: '2026-03-08', isSprintWeekend: false },
    ]);
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), {
      australia: {
        reviewed: true,
        documents: ['https://fia.test/australia_fine.pdf'],
        notes: 'Auto-discovered 1 FIA monetary fine document(s).',
        reviewedAt: '2026-03-09T14:00:00.000Z',
      },
    });
    if (finalized) {
      writeJson(join(seasonDir, 'normalized', 'australia.json'), { raceId: 'australia' });
      writeJson(join(seasonDir, 'scored', 'australia.json'), { raceId: 'australia' });
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

test('an unreachable FIA site leaves a finalized race untouched instead of failing the run', async () => {
  await withTempSeason(async (seasonDir) => {
    let scoreRaceCalls = 0;

    await autoScore({
      now: NOW,
      discoverMonetaryFinePdfs: async () => {
        throw new Error('FIA documents page unavailable: 403 (after 4 attempts)');
      },
      scoreRace: async () => {
        scoreRaceCalls += 1;
        return null;
      },
    });

    assert.equal(scoreRaceCalls, 0);
    const review = readJson(join(seasonDir, 'config', 'fine-documents.json')).australia;
    assert.deepEqual(review.documents, ['https://fia.test/australia_fine.pdf']);
    assert.equal(review.reviewedAt, '2026-03-09T14:00:00.000Z');
  }, { finalized: true });
});

test('an unreachable FIA site fails loudly while a race still needs scoring', async () => {
  await withTempSeason(async (seasonDir) => {
    await assert.rejects(
      () => autoScore({
        now: NOW,
        discoverMonetaryFinePdfs: async () => {
          throw new Error('FIA documents page unavailable: 403 (after 4 attempts)');
        },
        scoreRace: async () => assert.fail('scoring must not run without a fine review'),
      }),
      /FIA document discovery failed for Australian Grand Prix: FIA documents page unavailable: 403/,
    );

    const review = readJson(join(seasonDir, 'config', 'fine-documents.json')).australia;
    assert.deepEqual(review.documents, ['https://fia.test/australia_fine.pdf']);
  });
});

test('a successful discovery records the reviewed documents and scores the race', async () => {
  await withTempSeason(async (seasonDir) => {
    const scoredRaces = [];

    await autoScore({
      now: NOW,
      discoverMonetaryFinePdfs: async () => ['https://fia.test/australia_other_fine.pdf'],
      discoverPotentialPenaltyPdfs: async () => ['https://fia.test/australia_initial_decision.pdf'],
      scoreRace: async (raceId) => {
        scoredRaces.push(raceId);
        return {
          race: { name: 'Australian Grand Prix' },
          fineSummary: { documents: [{ url: 'https://fia.test/australia_other_fine.pdf' }] },
          scoreboard: { standings: [] },
        };
      },
    });

    assert.deepEqual(scoredRaces, ['australia']);
    const review = readJson(join(seasonDir, 'config', 'fine-documents.json')).australia;
    assert.equal(review.reviewed, true);
    assert.deepEqual(review.documents, ['https://fia.test/australia_other_fine.pdf']);
    assert.deepEqual(
      readJson(join(seasonDir, 'config', 'fia-document-snapshots.json')).australia.documents,
      ['https://fia.test/australia_initial_decision.pdf'],
    );
  });
});

test('autoScore logs and exits cleanly when no races are eligible yet', async () => {
  await withTempSeason(async () => {
    const earlyDate = new Date('2026-01-01T00:00:00Z');
    let scored = false;
    await autoScore({
      now: earlyDate,
      scoreRace: async () => { scored = true; },
    });
    assert.equal(scored, false);
  });
});

test('autoScore does nothing when race is already finalized with unchanged fine documents', async () => {
  await withTempSeason(async () => {
    let scored = false;
    await autoScore({
      now: NOW,
      discoverMonetaryFinePdfs: async () => ['https://fia.test/australia_fine.pdf'],
      scoreRace: async () => { scored = true; },
    });
    assert.equal(scored, false);
  }, { finalized: true });
});

