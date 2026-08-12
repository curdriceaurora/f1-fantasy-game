import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, scoredByRace, parseArgs, LEDGER_PATH } from '../scripts/reconcile-martin.mjs';

const ledger = { races: { monaco: { drivers: { 'alex-albon': 7 }, teams: { williams: -3 } } } };

test('runCheck passes when every scored value matches the ledger', () => {
  const result = runCheck({
    ledger,
    accepted: { divergences: [] },
    scored: { monaco: { drivers: { 'alex-albon': 7 }, teams: { williams: -3 } } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, []);
});

test('runCheck names the driver, both values and the race when scoring drifts', () => {
  const result = runCheck({
    ledger,
    accepted: { divergences: [] },
    scored: { monaco: { drivers: { 'alex-albon': 10 }, teams: { williams: -3 } } },
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /monaco driver alex-albon: ours 10, Martin 7/);
});

test('runCheck tells you to delete an accepted divergence once it stops applying', () => {
  // A stale manifest entry is a hole in the gate: it goes on excusing a
  // driver-race after the underlying gap has been fixed.
  const result = runCheck({
    ledger,
    accepted: { divergences: [{ race: 'monaco', kind: 'driver', id: 'alex-albon', ours: 4, martin: 7, issue: '#84 Q1' }] },
    scored: { monaco: { drivers: { 'alex-albon': 7 }, teams: { williams: -3 } } },
  });
  assert.equal(result.ok, false);
  assert.match(result.lines[0], /no longer applies/);
});

test('runCheck fails loudly when the ledger has never been generated', () => {
  assert.throws(() => runCheck({ ledger: null, accepted: {}, scored: {} }), new RegExp(LEDGER_PATH));
});

test('scoredByRace flattens the scored artifacts to driver and constructor totals', () => {
  const calendar = [{ id: 'monaco' }, { id: 'never-scored' }];
  const read = (path) => (path.includes('monaco')
    ? {
      teams: [
        { drivers: [{ driverId: 'alex-albon', totalPoints: 7 }], constructors: [{ teamId: 'williams', totalPoints: -3 }] },
        // The same driver appears under every entry that picked them; the value
        // is identical, so flattening must not double-count or disagree.
        { drivers: [{ driverId: 'alex-albon', totalPoints: 7 }], constructors: [] },
      ],
    }
    : null);
  const scored = scoredByRace(calendar, read);
  assert.deepEqual(scored.monaco, { drivers: { 'alex-albon': 7 }, teams: { williams: -3 } });
  assert.equal('never-scored' in scored, false);
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
    assert.deepEqual(regressions, []);
    assert.equal(ledger.races.monaco.drivers['lando-norris'], -26);

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
    assert.equal(regressions.length, 1);
    assert.match(regressions[0].message, /older than the recorded master\.xlsx/);
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
