import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPitLaneGridPenalties, runCheck, scoredByRace, parseArgs, LEDGER_PATH,
} from '../scripts/reconcile-martin.mjs';

// A ledger must be complete to be trusted, so fixtures are built to the real
// shape — 22 seats and 11 constructors with every compared field — and the rows
// under test are overridden on top.
function driverFields(overrides = {}) {
  return {
    total: 0, grid: 10, finish: 10, fineEuros: 0, gridPenalty: 0,
    timePenalty: 0, sprintPoints: 0, fastestLapPoints: 0, ...overrides,
  };
}

function raceFixture({ drivers = {}, teams = {} } = {}) {
  // Named rows substitute for filler, so the totals stay at exactly 22 and 11 —
  // adding them on top would trip the very completeness check under test.
  const named = Object.entries(drivers);
  const fillerDrivers = Array.from({ length: 22 - named.length }, (_, i) => [`driver-${i}`, driverFields()]);
  const namedTeams = Object.entries(teams);
  const fillerTeams = Array.from({ length: 11 - namedTeams.length }, (_, i) => [`team-${i}`, { total: 0, fineEuros: 0 }]);
  return {
    drivers: Object.fromEntries([...fillerDrivers, ...named.map(([id, o]) => [id, driverFields(o)])]),
    teams: Object.fromEntries([...fillerTeams, ...namedTeams]),
  };
}

function ledgerFixture(overrides) {
  // Provenance is part of a valid ledger, not decoration: runCheck rejects a
  // ledger whose record of which workbook it came from is missing, since that is
  // the only thing standing between us and a stale source.
  return {
    provenance: {
      races: {
        monaco: {
          workbook: 'master.xlsx',
          sha256: 'a'.repeat(64),
          workbookModified: '2026-08-03T16:49:11.000Z',
          sheet: 'Race 8',
        },
      },
    },
    races: { monaco: raceFixture(overrides) },
  };
}

function scoredFixture(overrides) {
  return { monaco: raceFixture(overrides) };
}

const ledger = ledgerFixture({ drivers: { 'alex-albon': { total: 7 } }, teams: { williams: { total: -3, fineEuros: 0 } } });

test('runCheck passes when every scored value matches the ledger', () => {
  const result = runCheck({
    ledger,
    accepted: { divergences: [] },
    scored: scoredFixture({ drivers: { 'alex-albon': { total: 7 } }, teams: { williams: { total: -3, fineEuros: 0 } } }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, []);
});

test('runCheck names the driver, both values and the race when scoring drifts', () => {
  const result = runCheck({
    ledger,
    accepted: { divergences: [] },
    scored: scoredFixture({ drivers: { 'alex-albon': { total: 10 } }, teams: { williams: { total: -3, fineEuros: 0 } } }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /monaco driver alex-albon total: ours 10, Martin 7/);
});

test('runCheck tells you to delete an accepted divergence once it stops applying', () => {
  // A stale manifest entry is a hole in the gate: it goes on excusing a
  // driver-race after the underlying gap has been fixed.
  const result = runCheck({
    ledger,
    accepted: { divergences: [{ race: 'monaco', kind: 'driver', id: 'alex-albon', field: 'total', ours: 4, martin: 7, issue: '#84 Q1' }] },
    scored: scoredFixture({ drivers: { 'alex-albon': { total: 7 } }, teams: { williams: { total: -3, fineEuros: 0 } } }),
  });
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /no longer applies/);
});

test('runCheck fails loudly when the ledger has never been generated', () => {
  assert.throws(() => runCheck({ ledger: null, accepted: {}, scored: {} }), new RegExp(LEDGER_PATH));
});

test('unresolved pit-lane penalties require an exact accepted divergence', () => {
  const calendar = [{ id: 'china' }];
  const normalized = {
    drivers: {
      'alex-albon': {
        gridPenaltyPlaces: 0,
        pitLaneGridPenalty: {
          status: 'unresolved',
          reason: 'no-place-count-in-race-decision',
          sourceUrl: 'https://fia.test/china-decision.pdf',
        },
      },
    },
  };
  const read = () => normalized;
  const accepted = {
    divergences: [{
      race: 'china', kind: 'driver', id: 'alex-albon', field: 'gridPenalty', ours: 0, martin: -5,
    }],
  };

  assert.deepEqual(auditPitLaneGridPenalties(accepted, calendar, read), []);
  assert.match(
    auditPitLaneGridPenalties({ divergences: [] }, calendar, read).join('\n'),
    /unresolved.*not acknowledged/,
  );
});

test('an unreadable pit-lane decision cannot be hidden by an accepted divergence', () => {
  const problems = auditPitLaneGridPenalties(
    { divergences: [{ race: 'china', kind: 'driver', id: 'alex-albon', field: 'gridPenalty', ours: 0, martin: -5 }] },
    [{ id: 'china' }],
    () => ({
      drivers: {
        'alex-albon': {
          gridPenaltyPlaces: 0,
          pitLaneGridPenalty: {
            status: 'unresolved',
            reason: 'decision-candidates-unreadable',
            candidateUrls: ['https://fia.test/china-decision.pdf'],
          },
        },
      },
    }),
  );

  assert.match(problems.join('\n'), /1 FIA decision candidate\(s\) could not be read/);
});

test('a simultaneous numbered and pit-lane penalty becomes a reconciliation finding', () => {
  const problems = auditPitLaneGridPenalties(
    { divergences: [] },
    [{ id: 'miami' }],
    () => ({
      drivers: {
        'isack-hadjar': {
          gridPenaltyPlaces: 20,
          pitLaneGridPenalty: {
            status: 'resolved',
            places: 20,
            numberedGridPenaltyPlaces: 3,
            sourceUrl: 'https://fia.test/miami-decision.pdf',
          },
        },
      },
    }),
  );

  assert.match(problems.join('\n'), /also carries a 3-place grid-footer penalty/);
});

test('scoredByRace scores every seat in the normalized race, selected or not', () => {
  const calendar = [{ id: 'monaco' }, { id: 'never-normalized' }];
  const read = (path) => (path.includes('monaco')
    ? {
      drivers: {
        'alex-albon': {
          qualifyingPosition: 11, gridStart: 11, racePosition: 8, sprintPosition: null,
          fastestLap: false, gridPenaltyPlaces: 0, timePenaltySeconds: 0, fineEuros: 5100, classified: true,
        },
        'carlos-sainz': {
          qualifyingPosition: 12, gridStart: 12, racePosition: 16, sprintPosition: null,
          fastestLap: false, gridPenaltyPlaces: 0, timePenaltySeconds: 0, fineEuros: 0, classified: true,
        },
      },
      teams: { williams: { driverIds: ['alex-albon', 'carlos-sainz'], fineEuros: 0 } },
    }
    : null);

  const scored = scoredByRace(calendar, read);
  // Albon's €5,100 becomes -3 here, exactly as publish-scoreboard applies it:
  // normalized records carry fineEuros with finePoints left at 0.
  assert.equal(scored.monaco.drivers['alex-albon'].total, 7);
  assert.equal(scored.monaco.drivers['carlos-sainz'].total, -10);
  assert.equal(scored.monaco.teams.williams.total, -3);
  assert.equal('never-normalized' in scored, false);
});

test('parseArgs reads the workbook directory override used from a worktree', () => {
  assert.deepEqual(parseArgs(['--generate', '--workbooks', '/tmp/books']), { generate: true, workbookDir: '/tmp/books' });
  assert.equal(parseArgs([]).generate, false);
  assert.equal(parseArgs([]).workbookDir, 'martins-calculations');
});

test('generateLedger records provenance per race and picks the newest source', async () => {
  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const ExcelJS = (await import('exceljs')).default;
  const { generateLedger } = await import('../scripts/reconcile-martin.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const write = async (name, modified, driverTotal) => {
      const workbook = new ExcelJS.Workbook();
      workbook.modified = new Date(modified);
      const sheet = workbook.addWorksheet('Race 8');
      const row = sheet.getRow(6);
      row.getCell(2).value = 'L. Norris';
      row.getCell(24).value = driverTotal;
      row.getCell(25).value = 'McLaren';
      row.getCell(27).value = -19;
      row.commit();
      await workbook.xlsx.writeFile(join(dir, name));
    };
    await write('master.xlsx', '2026-08-03T16:49:11Z', -26);
    await write('monaco-stale.xlsx', '2026-08-02T18:37:46Z', -20);

    const { ledger, regressions, workbooksRead } = await generateLedger({ workbookDir: dir });
    assert.equal(workbooksRead, 2);
    assert.deepEqual(regressions.filter((r) => !r.includes('drivers and')), []);
    assert.equal(ledger.races.monaco.drivers['lando-norris'].total, -26);

    const source = ledger.provenance.races.monaco;
    assert.equal(source.workbook, 'master.xlsx');
    assert.equal(source.sheet, 'Race 8');
    assert.match(source.sha256, /^[0-9a-f]{64}$/);
    assert.equal(source.workbookModified, '2026-08-03T16:49:11.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateLedger refuses a source older than the one already recorded', async () => {
  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const ExcelJS = (await import('exceljs')).default;
  const { generateLedger } = await import('../scripts/reconcile-martin.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.modified = new Date('2026-08-02T18:37:46Z');
    const sheet = workbook.addWorksheet('Race 8');
    const row = sheet.getRow(6);
    row.getCell(2).value = 'L. Norris';
    row.getCell(24).value = -20;
    row.commit();
    await workbook.xlsx.writeFile(join(dir, 'stale.xlsx'));

    const previous = { provenance: { races: { monaco: { workbook: 'master.xlsx', sha256: 'aaa', workbookModified: '2026-08-03T16:49:11Z', sheet: 'Race 8' } } }, races: {} };
    const { regressions } = await generateLedger({ workbookDir: dir, previous });
    assert.match(regressions.join(' '), /older than the recorded master\.xlsx/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generateLedger explains a missing workbook directory rather than throwing ENOENT', async () => {
  const { generateLedger } = await import('../scripts/reconcile-martin.mjs');
  await assert.rejects(() => generateLedger({ workbookDir: 'no-such-dir' }), /gitignored local reference/);
});

test('the CLI check path passes against the committed ledger and manifest', async () => {
  // Exercises what CI runs. Read-only: check mode never writes, so this asserts
  // the committed ledger, the committed manifest and the scored artifacts are
  // mutually consistent right now — the gate guarding every future change.
  const { runReconcileMartinCli } = await import('../scripts/reconcile-martin.mjs');
  await runReconcileMartinCli([]);
});


test('scoredByRace covers every driver and constructor, not only the selected ones', () => {
  // Piastri, Ocon, Bortoleto and Racing Bulls are picked by nobody, so they are
  // absent from season/scored/*.json — which left 44 ledger values unchecked.
  // Coverage must come from the normalized race data, which holds all 22 seats.
  const scored = scoredByRace();
  const monaco = scored.monaco;
  for (const driverId of ['oscar-piastri', 'esteban-ocon', 'gabriel-bortoleto']) {
    assert.equal(typeof monaco.drivers[driverId].total, 'number', `${driverId} missing`);
  }
  assert.equal(typeof monaco.teams['racing-bulls'].total, 'number');
  assert.equal(Object.keys(monaco.drivers).length, 22);
  assert.equal(Object.keys(monaco.teams).length, 11);
});

test('runCheck rejects a committed ledger with an entity removed', async () => {
  // The generate-time guards protect the write path, but CI trusts the committed
  // file. A hand edit or a bad merge can narrow it, and comparing only what the
  // ledger contains would keep passing on the reduced set.
  const { readJson } = await import('../lib/season-store.js');
  const { LEDGER_PATH: path, DIVERGENCE_PATH } = await import('../scripts/reconcile-martin.mjs');
  const ledger = structuredClone(readJson(path, null));
  delete ledger.races.australia.drivers['lando-norris'];

  const result = runCheck({ ledger, accepted: readJson(DIVERGENCE_PATH, { divergences: [] }), scored: scoredByRace() });
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /australia.*21\/22 drivers/);
});

test('runCheck rejects a committed ledger with a compared field removed', async () => {
  const { readJson } = await import('../lib/season-store.js');
  const { LEDGER_PATH: path, DIVERGENCE_PATH } = await import('../scripts/reconcile-martin.mjs');
  const ledger = structuredClone(readJson(path, null));
  delete ledger.races.australia.drivers['lando-norris'].sprintPoints;

  const result = runCheck({ ledger, accepted: readJson(DIVERGENCE_PATH, { divergences: [] }), scored: scoredByRace() });
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /driver lando-norris is missing field\(s\): sprintPoints/);
});

test('generateLedger refuses to build a ledger whose own provenance is malformed', async () => {
  // A source with no internal timestamp metadata yields workbookModified: null.
  // Generation previously reported 0 regressions and wrote an artifact the very
  // next CI check would reject — the guard existed but ran only against the
  // *previous* ledger, never the candidate being built.
  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const ExcelJS = (await import('exceljs')).default;
  const { generateLedger } = await import('../scripts/reconcile-martin.mjs');

  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Race 8');
    const row = sheet.getRow(6);
    row.getCell(2).value = 'L. Norris';
    row.getCell(24).value = -26;
    row.getCell(25).value = 'McLaren';
    row.getCell(27).value = -19;
    row.commit();
    await workbook.xlsx.writeFile(join(dir, 'no-timestamp.xlsx'));

    // ExcelJS stamps `modified` on write, so the absent-metadata case is injected
    // at the reader rather than faked in the file.
    const readWorkbookImpl = async (path) => {
      const loaded = new ExcelJS.Workbook();
      await loaded.xlsx.readFile(path);
      loaded.modified = undefined;
      loaded.created = undefined;
      return loaded;
    };

    const { ledger, regressions } = await generateLedger({ workbookDir: dir, readWorkbookImpl });
    assert.equal(ledger.provenance.races.monaco.workbookModified, null);
    assert.match(regressions.join(' '), /generated ledger provenance:.*workbookModified/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runCheck reports missing races, unledgered races, and unmatched entities', () => {
  const customLedger = {
    provenance: {
      races: {
        monaco: { workbook: 'master.xlsx', sha256: 'a'.repeat(64), workbookModified: '2026-08-03T16:49:11.000Z', sheet: 'Race 8' },
        china: { workbook: 'master.xlsx', sha256: 'a'.repeat(64), workbookModified: '2026-08-03T16:49:11.000Z', sheet: 'Race 2' },
      },
    },
    races: {
      monaco: raceFixture(),
      china: raceFixture(),
    },
  };
  // Scored has monaco and australia (china is missing from scored; australia is unledgered)
  const scored = {
    monaco: raceFixture(),
    australia: raceFixture(),
  };

  const result = runCheck({
    ledger: customLedger,
    accepted: { divergences: [] },
    scored,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missingRaces, ['china']);
  assert.deepEqual(result.unledgeredRaces, ['australia']);
  assert.ok(result.lines.some((line) => line.includes('china: in the ledger but not scored')));
  assert.ok(result.lines.some((line) => line.includes('australia: scored but absent from the ledger')));
});

test('parseArgs in reconcile-martin parses --generate and --workbooks flags', async () => {
  const { parseArgs } = await import('../scripts/reconcile-martin.mjs');
  assert.deepEqual(parseArgs(['--generate', '--workbooks', '/tmp/workbooks']), {
    generate: true,
    workbookDir: '/tmp/workbooks',
  });
  assert.deepEqual(parseArgs([]), {
    generate: false,
    workbookDir: 'martins-calculations',
  });
});

test('runReconcileMartinCli executes check against committed ledger without error', async () => {
  const { runReconcileMartinCli } = await import('../scripts/reconcile-martin.mjs');
  await assert.doesNotReject(() => runReconcileMartinCli([]));
});

