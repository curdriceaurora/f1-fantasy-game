import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { scoreRace } from '../scripts/score-race.mjs';
import { normalizedRacePath, scoredRacePath, standingsPath, teamScorePath } from '../lib/season-store.js';

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function stubFetchedRace() {
  return {
    meeting: { meeting_key: 1234 },
    sessions: {
      qualifying: { session_key: 11 },
      sprint: null,
      race: { session_key: 22 },
    },
    drivers: [
      { driver_number: 63, first_name: 'George', last_name: 'Russell', full_name: 'George Russell', team_name: 'Mercedes' },
      { driver_number: 12, first_name: 'Kimi', last_name: 'Antonelli', full_name: 'Kimi Antonelli', team_name: 'Mercedes' },
    ],
    raceResultRows: [
      { driver_number: 63, position: 1, dns: false, dsq: false, dnf: false },
      { driver_number: 12, position: 6, dns: false, dsq: false, dnf: false },
    ],
    qualifyingResultRows: [
      { driver_number: 63, position: 2 },
      { driver_number: 12, position: 4 },
    ],
    sprintResultRows: [],
    laps: [
      { driver_number: 63, lap_duration: 90.1, is_pit_out_lap: false },
      { driver_number: 12, lap_duration: 90.4, is_pit_out_lap: false },
    ],
    gridPenaltyMessages: [],
    raceTimePenaltyMessages: [],
    positionFeed: [
      { driver_number: 63, position: 2, date: '2026-03-08T03:00:00Z' },
      { driver_number: 12, position: 4, date: '2026-03-08T03:00:00Z' },
    ],
  };
}

function stubSprintFetchedRaceWithoutSprintResults() {
  const baseRace = stubFetchedRace();
  return {
    ...baseRace,
    sessions: {
      ...baseRace.sessions,
      sprint: { session_key: 33 },
    },
    sprintResultRows: [],
  };
}

async function withTempSeason(callback) {
  const root = mkdtempSync(join(tmpdir(), 'f1-score-race-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    writeJson(join(seasonDir, 'config', '2026-calendar.json'), [
      { id: 'australia', round: 1, name: 'Australian Grand Prix', meetingName: 'Australia', date: '2026-03-08', isSprintWeekend: false },
    ]);
    writeJson(join(seasonDir, 'config', 'entries.json'), [
      {
        teamId: 'test-team',
        principalName: 'Test Principal',
        displayName: 'Test Entry',
        selectedDriverIds: ['george-russell'],
        selectedConstructorIds: ['mercedes'],
        homeCircuitId: 'japan',
        investmentBonusPerRace: 1,
      },
    ]);
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

test('scoreRace blocks scoring until fine review is explicitly completed', async () => {
  await withTempSeason(async (seasonDir) => {
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), {});

    await assert.rejects(
      () => scoreRace('australia', {
        now: new Date('2026-03-09T12:01:00Z'),
        fetchRaceWeekend: async () => stubFetchedRace(),
        fetchFineSummary: async () => ({ drivers: {}, teams: {}, documents: [], warnings: [] }),
      }),
      /Fine review for australia is incomplete/,
    );
  });
});

test('scoreRace blocks publication before the Monday scoring window opens', async () => {
  await withTempSeason(async (seasonDir) => {
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), {
      australia: { reviewed: true, documents: [], reviewedAt: '2026-03-09T12:00:00Z' },
    });

    await assert.rejects(
      () => scoreRace('australia', {
        now: new Date('2026-03-09T11:59:00Z'),
        fetchRaceWeekend: async () => stubFetchedRace(),
        fetchFineSummary: async () => ({ drivers: {}, teams: {}, documents: [], warnings: [] }),
      }),
      /not yet eligible for Monday scoring/,
    );
  });
});

test('scoreRace fails closed when fine parsing warnings remain', async () => {
  await withTempSeason(async (seasonDir) => {
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), {
      australia: { reviewed: true, documents: ['https://example.test/fine.pdf'], reviewedAt: '2026-03-09T12:00:00Z' },
    });

    await assert.rejects(
      () => scoreRace('australia', {
        now: new Date('2026-03-09T12:01:00Z'),
        fetchRaceWeekend: async () => stubFetchedRace(),
        fetchFineSummary: async () => ({
          drivers: {},
          teams: {},
          documents: [{ url: 'https://example.test/fine.pdf', fineEuros: 2000, finePoints: -1, appliedTo: null }],
          warnings: ['Unable to classify fine subject for https://example.test/fine.pdf'],
        }),
      }),
      /FIA fine parsing is incomplete/,
    );

    assert.equal(readJson(join(seasonDir, 'raw', 'australia', 'fines.json')).warnings.length, 1);
  });
});

test('scoreRace reruns replace outputs cleanly instead of duplicating race totals', async () => {
  await withTempSeason(async (seasonDir) => {
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), {
      australia: { reviewed: true, documents: [], reviewedAt: '2026-03-09T12:00:00Z' },
    });

    const services = {
      now: new Date('2026-03-09T12:01:00Z'),
      fetchRaceWeekend: async () => stubFetchedRace(),
      fetchFineSummary: async () => ({ drivers: {}, teams: {}, documents: [], warnings: [] }),
    };

    await scoreRace('australia', services);
    const firstStanding = readJson(standingsPath());
    const firstTeam = readJson(teamScorePath('test-team'));

    await scoreRace('australia', services);
    const secondStanding = readJson(standingsPath());
    const secondTeam = readJson(teamScorePath('test-team'));

    assert.deepEqual(firstStanding.standings, secondStanding.standings);
    assert.equal(secondTeam.races.length, 1);
    assert.equal(secondTeam.totalPoints, secondTeam.races[0].runningTotal);
    assert.equal(readJson(scoredRacePath('australia')).teams.length, 1);
    assert.ok(readJson(normalizedRacePath('australia')).drivers['george-russell']);
  });
});

test('scoreRace recognizes existing normalized artifacts when evaluating workflow state', async () => {
  await withTempSeason(async (seasonDir) => {
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), {
      australia: { reviewed: true, documents: [], reviewedAt: '2026-03-09T12:00:00Z' },
    });
    writeJson(normalizedRacePath('australia'), {
      raceId: 'australia',
      raceName: 'Australian Grand Prix',
      date: '2026-03-08',
      round: 1,
      drivers: {},
      teams: {},
    });

    await scoreRace('australia', {
      now: new Date('2026-03-09T12:01:00Z'),
      fetchRaceWeekend: async () => stubFetchedRace(),
      fetchFineSummary: async () => ({ drivers: {}, teams: {}, documents: [], warnings: [] }),
    });

    assert.equal(readJson(scoredRacePath('australia')).raceId, 'australia');
  });
});

test('scoreRace fails closed on sprint weekends when sprint results are unavailable', async () => {
  await withTempSeason(async (seasonDir) => {
    writeJson(join(seasonDir, 'config', '2026-calendar.json'), [
      { id: 'china', round: 2, name: 'Chinese Grand Prix', meetingName: 'China', date: '2026-03-15', isSprintWeekend: true },
    ]);
    writeJson(join(seasonDir, 'config', 'fine-documents.json'), {
      china: { reviewed: true, documents: [], reviewedAt: '2026-03-16T12:00:00Z' },
    });

    await assert.rejects(
      () => scoreRace('china', {
        now: new Date('2026-03-16T12:01:00Z'),
        fetchRaceWeekend: async () => stubSprintFetchedRaceWithoutSprintResults(),
        fetchFineSummary: async () => ({ drivers: {}, teams: {}, documents: [], warnings: [] }),
      }),
      /sprint results are missing/,
    );
  });
});
