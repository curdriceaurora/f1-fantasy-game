import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, scoredByRace, parseArgs, LEDGER_PATH } from '../scripts/reconcile-martin.mjs';

const ledger = { races: { monaco: { drivers: { 'alex-albon': { total: 7 } }, teams: { williams: { total: -3 } } } } };

test('runCheck passes when every scored value matches the ledger', () => {
  const result = runCheck({
    ledger,
    accepted: { divergences: [] },
    scored: { monaco: { drivers: { 'alex-albon': { total: 7 } }, teams: { williams: { total: -3 } } } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, []);
});

test('runCheck names the driver, both values and the race when scoring drifts', () => {
  const result = runCheck({
    ledger,
    accepted: { divergences: [] },
    scored: { monaco: { drivers: { 'alex-albon': { total: 10 } }, teams: { williams: { total: -3 } } } },
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /monaco driver alex-albon total: ours 10, Martin 7/);
});

test('runCheck tells you to delete an accepted divergence once it stops applying', () => {
  // A stale manifest entry is a hole in the gate: it goes on excusing a
  // driver-race after the underlying gap has been fixed.
  const result = runCheck({
    ledger,
    accepted: { divergences: [{ race: 'monaco', kind: 'driver', id: 'alex-albon', field: 'total', ours: 4, martin: 7, issue: '#84 Q1' }] },
    scored: { monaco: { drivers: { 'alex-albon': { total: 7 } }, teams: { williams: { total: -3 } } } },
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /no longer applies/);
});

test('runCheck fails loudly when the ledger has never been generated', () => {
  assert.throws(() => runCheck({ ledger: null, accepted: {}, scored: {} }), new RegExp(LEDGER_PATH));
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
  const { main } = await import('../scripts/reconcile-martin.mjs');
  await main([]);
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
