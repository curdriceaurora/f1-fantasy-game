import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseArgs } from '../scripts/score-race.mjs';
import {
  compareTimePenaltyLedgers,
  buildTimePenaltyAuditReport,
  auditTimePenalties,
} from '../scripts/audit-time-penalties.mjs';
import {
  buildHistoricalConstructorSeats,
  buildNormalizedRace,
  buildSeasonMapping,
  fastestLapDriverId,
  fetchHistoricalJson,
  generateTestCorpus,
  injectSyntheticAdjustments,
  loadHistoricalSeason,
  mulberry32,
  normalizePosition,
  normalizeRacePosition,
  pickHistoricalRow,
  shuffle,
  syntheticEntries,
  syntheticPenaltySeed,
} from '../scripts/generate-test-corpus.mjs';

test('score-race parseArgs extracts --race argument cleanly', () => {
  const args1 = parseArgs(['--race', 'australia']);
  assert.deepStrictEqual(args1, { race: 'australia' });

  const args2 = parseArgs([]);
  assert.deepStrictEqual(args2, {});
});

test('generate-test-corpus mulberry32 & shuffle generate deterministic results', () => {
  const rng1 = mulberry32(12345);
  const val1 = rng1();
  const rng2 = mulberry32(12345);
  const val2 = rng2();
  assert.strictEqual(val1, val2);

  const arr = ['a', 'b', 'c', 'd', 'e'];
  const shuffled1 = shuffle(arr, 999);
  const shuffled2 = shuffle(arr, 999);
  assert.deepStrictEqual(shuffled1, shuffled2);
  assert.notDeepStrictEqual(shuffled1, arr);
});

function historicalRace(year = 2025) {
  const constructors = Array.from({ length: 10 }, (_, index) => `constructor-${index + 1}`);
  const results = constructors.flatMap((constructorId, constructorIndex) => [0, 1].map((seatIndex) => ({
    number: String((constructorIndex * 2) + seatIndex + 1),
    grid: String((constructorIndex * 2) + seatIndex + 1),
    position: String((constructorIndex * 2) + seatIndex + 1),
    positionText: String((constructorIndex * 2) + seatIndex + 1),
    status: 'Finished',
    Constructor: { constructorId },
    Driver: { driverId: `${constructorId}-driver-${seatIndex + 1}` },
    FastestLap: constructorIndex === 0 && seatIndex === 0 ? { rank: '1' } : undefined,
  })));
  return {
    round: 1,
    raceId: `sim-${year}-1-test`,
    raceName: 'Test Grand Prix',
    date: `${year}-03-01`,
    results,
    qualifying: structuredClone(results),
    sprint: structuredClone(results.slice(0, 8)),
  };
}

test('historical corpus builders map and normalize a complete season race', () => {
  const race = historicalRace();
  const seats = buildHistoricalConstructorSeats([race]);
  assert.equal(seats.size, 10);
  assert.deepEqual(seats.get('constructor-1'), ['constructor-1-driver-1', 'constructor-1-driver-2']);

  const mapping = buildSeasonMapping(2025, [race]);
  const normalized = buildNormalizedRace(2025, race, mapping);
  assert.equal(Object.keys(normalized.teams).length, 10);
  assert.equal(Object.keys(normalized.drivers).length, 20);
  assert.equal(normalized.sprintWeekend, true);
  assert.equal(Object.values(normalized.drivers).filter((driver) => driver.fastestLap).length, 1);

  assert.equal(normalizePosition('12'), 12);
  assert.equal(normalizePosition('not-a-position'), null);
  assert.equal(normalizeRacePosition({ positionText: 'R', position: '4' }), null);
  assert.equal(normalizeRacePosition({ positionText: '4', position: '4' }), 4);
  assert.equal(fastestLapDriverId(race.results), 'constructor-1-driver-1');
  assert.equal(fastestLapDriverId([]), null);
  assert.equal(pickHistoricalRow(race.results, 'constructor-1', ['constructor-1-driver-2'], 0).Driver.driverId, 'constructor-1-driver-2');
  assert.equal(pickHistoricalRow([], 'missing', [], 0), null);
  assert.equal(syntheticPenaltySeed(2025, 1, 2), 202512);
  assert.deepEqual(injectSyntheticAdjustments(2025, 1, 'driver', 'team', 0), injectSyntheticAdjustments(2025, 1, 'driver', 'team', 0));

  const entries = syntheticEntries([{ id: 'home' }]);
  assert.equal(entries.length, 8);
  assert.equal(entries[0].homeCircuitId, 'home');
});

test('historical provider retries 429 and rejects terminal responses', async () => {
  let calls = 0;
  const sleeps = [];
  const payload = await fetchHistoricalJson('2025.json', {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, status: 429 }
        : { ok: true, json: async () => ({ ok: true }) };
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });
  assert.deepEqual(payload, { ok: true });
  assert.deepEqual(sleeps, [1500]);

  await assert.rejects(
    fetchHistoricalJson('broken.json', { fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /Unable to fetch broken\.json: 500/,
  );
});

test('loadHistoricalSeason assembles schedule, race, qualifying, and sprint data', async () => {
  const race = historicalRace(2024);
  const result = (rows, key) => ({ MRData: { RaceTable: { Races: [{ [key]: rows }] } } });
  const loaded = await loadHistoricalSeason(2024, async (pathname) => {
    if (pathname === '2024.json?limit=100') {
      return { MRData: { RaceTable: { Races: [{
        round: '1', raceName: race.raceName, date: race.date, Circuit: { circuitId: 'test' },
      }] } } };
    }
    if (pathname.includes('/results.')) return result(race.results, 'Results');
    if (pathname.includes('/qualifying.')) return result(race.qualifying, 'QualifyingResults');
    return result(race.sprint, 'SprintResults');
  });

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].raceId, 'sim-2024-1-test');
  assert.equal(loaded[0].results.length, 20);
});

test('generateTestCorpus writes a complete deterministic fixture offline', async () => {
  const outputRoot = mkdtempSync(join(tmpdir(), 'f1-generated-corpus-'));
  try {
    await generateTestCorpus({
      years: [2025],
      outputRoot,
      loadHistoricalSeason: async () => [historicalRace(2025)],
    });
    const seasonRoot = join(outputRoot, '2025', 'season');
    const calendar = JSON.parse(readFileSync(join(seasonRoot, 'config', '2026-calendar.json')));
    const manifest = JSON.parse(readFileSync(join(outputRoot, '2025', 'manifest.json')));
    assert.equal(calendar.length, 1);
    assert.equal(manifest.races, 1);
    assert.equal(manifest.historicalSeason, 2025);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('historical mapping rejects an incomplete constructor field', () => {
  const race = historicalRace();
  race.results = race.results.filter((row) => row.Constructor.constructorId !== 'constructor-10');
  assert.throws(() => buildSeasonMapping(2025, [race]), /Expected 10 historical constructors/);
});

test('generate-selections Python CLI emits the documented compact schema', () => {
  const workingDir = mkdtempSync(join(tmpdir(), 'f1-selections-python-'));
  mkdirSync(join(workingDir, 'data'));
  try {
    const python = process.env.PYTHON || 'python3';
    const result = spawnSync(python, [join(process.cwd(), 'scripts', 'generate-selections.py')], {
      cwd: workingDir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(readFileSync(join(workingDir, 'data', 'selections.json')));
    assert.equal(output.meta.count, output.entries.length);
    assert.ok(output.meta.count > 0);
    assert.equal(output.meta.maxPts, output.entries[0].p);
    assert.equal(output.meta.minPts, output.entries.at(-1).p);
    for (const entry of output.entries.slice(0, 20)) {
      assert.deepEqual(Object.keys(entry).sort(), ['d', 'p', 't']);
      assert.equal(entry.d.length, 3);
      assert.equal(entry.t.length, 3);
      assert.ok(entry.d.every((index) => Number.isInteger(index) && index >= 0 && index < 22));
      assert.ok(entry.t.every((index) => Number.isInteger(index) && index >= 0 && index < 11));
    }
  } finally {
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('audit-time-penalties compareTimePenaltyLedgers detects penalty mismatches', () => {
  const race = { name: 'Australian Grand Prix', round: 1 };
  const fetchedRace = {
    raceTimePenaltyMessages: [
      { date: '2026-03-08T06:00:00Z', message: '5 SECOND TIME PENALTY FOR CAR 63' },
    ],
    fiaResults: {
      penaltySeconds: { 'george-russell': 10 },
    },
  };

  const comparison = compareTimePenaltyLedgers(race, fetchedRace);
  assert.ok(comparison.mismatches);
  assert.strictEqual(comparison.mismatches.length, 1);
  assert.strictEqual(comparison.mismatches[0].fiaSeconds, 10);
  assert.strictEqual(comparison.mismatches[0].openf1Seconds, 5);

  const report = buildTimePenaltyAuditReport([comparison]);
  assert.ok(report.includes('Time-penalty source audit'));
  assert.ok(report.includes('Australian Grand Prix'));
});

test('auditTimePenalties executes cleanly on season fixtures', () => {
  const audit = auditTimePenalties();
  assert.ok(audit);
  assert.ok(Array.isArray(audit.results));
  assert.ok(Array.isArray(audit.failures));
  assert.strictEqual(typeof audit.report, 'string');
});

test('buildTimePenaltyAuditReport formats failures cleanly', () => {
  const report = buildTimePenaltyAuditReport([], [
    { raceName: 'Australian Grand Prix', reason: 'Missing telemetry' },
  ]);
  assert.ok(report.includes('## Audit failures'));
  assert.ok(report.includes('- **Australian Grand Prix:** Missing telemetry'));
});

test('generateTeamName produces valid non-empty string', async () => {
  const { generateTeamName } = await import('../public/constants.js');
  const name = generateTeamName();
  assert.equal(typeof name, 'string');
  assert.ok(name.length > 0);
});

test('resolveApiRoute handles nested bracket params and resolution', async () => {
  const { resolveApiRoute, resolveStaticPath, createAppServer } = await import('../server.js');
  const matched = resolveApiRoute('/api/dashboard/teams/alpha-team');
  assert.ok(matched);
  assert.equal(matched.params.teamId, 'alpha-team');
  assert.ok(matched.filePath.endsWith('[teamId].js'));

  const unmatched = resolveApiRoute('/api/non-existent/deep/route');
  assert.equal(unmatched, null);

  // Escaping public root
  const escaped = resolveStaticPath('/public', '/../secret.txt');
  assert.equal(escaped, null);

  // Server error and not found handling
  const server = createAppServer({
    importApiModule: async () => { throw new Error('API failure'); },
  });
  assert.ok(server);
});


test('auditTimePenalties handles races missing FIA penalty footer ledger and runAuditTimePenaltiesCli writes report', async () => {
  const { auditTimePenalties, runAuditTimePenaltiesCli } = await import('../scripts/audit-time-penalties.mjs');
  const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const root = mkdtempSync(join(tmpdir(), 'f1-pen-audit-'));
  const seasonDir = join(root, 'season');
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    mkdirSync(join(seasonDir, 'config'), { recursive: true });
    mkdirSync(join(seasonDir, 'scored'), { recursive: true });
    mkdirSync(join(seasonDir, 'raw', 'australia'), { recursive: true });

    writeFileSync(join(seasonDir, 'config', '2026-calendar.json'), JSON.stringify([
      { id: 'australia', name: 'Australian Grand Prix', date: '2026-03-08' },
    ]));
    writeFileSync(join(seasonDir, 'scored', 'australia.json'), JSON.stringify({
      drivers: {},
    }));
    // Write openf1.json without fiaResults.penaltySeconds
    writeFileSync(join(seasonDir, 'raw', 'australia', 'openf1.json'), JSON.stringify({
      fiaResults: {},
    }));

    const audit = auditTimePenalties();
    assert.equal(audit.failures.length, 1);
    assert.match(audit.failures[0].reason, /no FIA penalty footer ledger/);

    const written = [];
    const summaryFile = join(root, 'summary.md');
    process.env.GITHUB_STEP_SUMMARY = summaryFile;

    runAuditTimePenaltiesCli({
      auditTimePenalties: () => audit,
      stdout: { write: (text) => written.push(text) },
      setExitCode: false,
    });


    assert.ok(written.length > 0);
    assert.match(written[0], /Audit failures/);

    // Test mismatch report generation and unknown driver fallbacks
    const { compareTimePenaltyLedgers, buildTimePenaltyAuditReport } = await import('../scripts/audit-time-penalties.mjs');
    const mismatchComparison = compareTimePenaltyLedgers(
      { id: 'australia', name: 'Australian Grand Prix', round: 1 },
      {
        fiaResults: { penaltySeconds: { 'max-verstappen': 5 } },
        raceTimePenaltyMessages: [
          { message: '10 SECOND TIME PENALTY FOR CAR 3 (VER) - CAUSING A COLLISION', date: '2026-03-08T05:00:00Z' },
          { message: '5 SECOND TIME PENALTY FOR CAR 999 - SPEEDING', date: '2026-03-08T05:10:00Z' },
        ],
      },
    );
    assert.equal(mismatchComparison.mismatches.length, 2);

    const report = buildTimePenaltyAuditReport([mismatchComparison]);
    assert.match(report, /Australian Grand Prix/);
    assert.match(report, /FIA footer 5s; OpenF1 inference 10s/);
  } finally {
    delete process.env.GITHUB_STEP_SUMMARY;
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('fetchHistoricalJson handles 429 rate limit retries and throws on terminal error', async () => {
  const { fetchHistoricalJson } = await import('../scripts/generate-test-corpus.mjs');
  let calls = 0;
  const mockFetch429 = async () => {
    calls += 1;
    if (calls < 3) {
      return { ok: false, status: 429 };
    }
    return { ok: true, json: async () => ({ result: 'success' }) };
  };

  const result = await fetchHistoricalJson('test-endpoint', {
    fetchImpl: mockFetch429,
    sleep: async () => {},
  });
  assert.deepEqual(result, { result: 'success' });
  assert.equal(calls, 3);

  // Terminal non-429 error
  await assert.rejects(
    () => fetchHistoricalJson('bad-endpoint', {
      fetchImpl: async () => ({ ok: false, status: 500 }),
      sleep: async () => {},
    }),
    /Unable to fetch bad-endpoint: 500/,
  );
});



test('generate-test-corpus throws on incomplete historical data and applies synthetic adjustments', async () => {
  const { buildNormalizedRace, injectSyntheticAdjustments } = await import('../scripts/generate-test-corpus.mjs');
  const emptyRace = { round: 1, results: [], qualifying: [], sprint: [] };
  const mapping = { currentTeamToHistorical: new Map(), driverMap: new Map() };
  assert.throws(
    () => buildNormalizedRace(2023, emptyRace, mapping),
    /Incomplete historical data/,
  );

  const adj2026 = injectSyntheticAdjustments(2026, 1, 'max-verstappen', 'red-bull', 0);
  assert.ok(typeof adj2026.driverFineEuros === 'number');
});




