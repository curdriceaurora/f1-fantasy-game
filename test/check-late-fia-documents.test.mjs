import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import {
  buildLateDocumentReport,
  checkLateFiaDocuments,
  newlyPublishedDocuments,
} from '../scripts/check-late-fia-documents.mjs';

const NOW = new Date('2026-04-09T14:30:00Z');

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

async function withTempSeason(callback, snapshots = {}) {
  const root = mkdtempSync(join(tmpdir(), 'f1-late-documents-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    writeJson(join(seasonDir, 'config', '2026-calendar.json'), [
      { id: 'australia', round: 1, name: 'Australia', meetingName: 'Australian Grand Prix', date: '2026-03-08' },
      { id: 'china', round: 2, name: 'China', meetingName: 'Chinese Grand Prix', date: '2026-03-15' },
    ]);
    writeJson(join(seasonDir, 'config', 'fia-document-snapshots.json'), snapshots);
    for (const raceId of ['australia', 'china']) {
      writeJson(join(seasonDir, 'normalized', `${raceId}.json`), { raceId });
      writeJson(join(seasonDir, 'scored', `${raceId}.json`), { raceId });
    }
    return await callback(seasonDir);
  } finally {
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('newlyPublishedDocuments returns a stable deduplicated delta', () => {
  assert.deepEqual(
    newlyPublishedDocuments(['https://fia.test/a.pdf'], [
      'https://fia.test/b.pdf',
      'https://fia.test/a.pdf',
      'https://fia.test/b.pdf',
    ]),
    ['https://fia.test/b.pdf'],
  );
});

test('first scan records a baseline without raising late-document alerts', async () => {
  await withTempSeason(async (seasonDir) => {
    const result = await checkLateFiaDocuments({
      now: NOW,
      discoverPotentialPenaltyPdfs: async (race) => [`https://fia.test/${race.id}/initial.pdf`],
    });

    assert.deepEqual(result.alerts, []);
    assert.deepEqual(result.initialized, ['australia', 'china']);
    const snapshots = readJson(join(seasonDir, 'config', 'fia-document-snapshots.json'));
    assert.deepEqual(snapshots.australia.documents, ['https://fia.test/australia/initial.pdf']);
  });
});

test('a new document is reported once and added to the stored snapshot', async () => {
  const initial = 'https://fia.test/australia/initial.pdf';
  const appeal = 'https://fia.test/australia/appeal_decision.pdf';

  await withTempSeason(async (seasonDir) => {
    const result = await checkLateFiaDocuments({
      now: NOW,
      discoverPotentialPenaltyPdfs: async (race) => (race.id === 'australia' ? [initial, appeal] : []),
    });

    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].race.id, 'australia');
    assert.deepEqual(result.alerts[0].documents, [appeal]);
    assert.deepEqual(
      readJson(join(seasonDir, 'config', 'fia-document-snapshots.json')).australia.documents,
      [appeal, initial],
    );

    const repeated = await checkLateFiaDocuments({
      now: NOW,
      discoverPotentialPenaltyPdfs: async (race) => (race.id === 'australia' ? [initial, appeal] : []),
    });
    assert.deepEqual(repeated.alerts, []);
  }, {
    australia: { documents: [initial], recordedAt: '2026-03-09T14:00:00Z' },
    china: { documents: [], recordedAt: '2026-03-16T14:00:00Z' },
  });
});

test('one FIA failure does not prevent other finalized races being checked', async () => {
  await withTempSeason(async () => {
    const result = await checkLateFiaDocuments({
      now: NOW,
      discoverPotentialPenaltyPdfs: async (race) => {
        if (race.id === 'australia') throw new Error('FIA unavailable');
        return ['https://fia.test/china/new_decision.pdf'];
      },
    });

    assert.deepEqual(result.failures, [{
      raceId: 'australia',
      raceName: 'Australia',
      reason: 'FIA unavailable',
    }]);
    assert.equal(result.alerts[0].race.id, 'china');
  }, {
    australia: { documents: [], recordedAt: '2026-03-09T14:00:00Z' },
    china: { documents: [], recordedAt: '2026-03-16T14:00:00Z' },
  });
});

test('notification report names the race, links documents, and states no rescore occurred', () => {
  const report = buildLateDocumentReport([{
    race: { name: 'Australia', round: 1 },
    documents: ['https://fia.test/appeal_decision.pdf'],
  }]);

  assert.match(report, /Australia \(Round 1\)/);
  assert.match(report, /\[appeal decision\.pdf\]\(https:\/\/fia\.test\/appeal_decision\.pdf\)/);
  assert.match(report, /no race was rescored/i);
});
