import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  readRaceSheet, selectRaceSources, workbookModified, assertCompleteSources, detectCoverageLoss, validateRaceCoverage,
  MARTIN_SHEET_BY_RACE, EXPECTED_DRIVERS, EXPECTED_TEAMS,
} from '../lib/martin-workbook.js';

// A minimal stand-in for one of Martin's race sheets: driver name in B, driver
// total in X, constructor in Y and its total in AA on alternating rows.
function raceSheet(workbook, sheetName, rows) {
  const sheet = workbook.addWorksheet(sheetName);
  rows.forEach(([driver, driverTotal, team, teamTotal], index) => {
    const row = sheet.getRow(6 + index);
    row.getCell(2).value = driver;
    row.getCell(24).value = driverTotal;
    if (team) {
      row.getCell(25).value = team;
      row.getCell(27).value = teamTotal;
    }
    row.commit();
  });
  return workbook;
}

function entry(name, modified, build) {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return { name, sha256: `sha-${name}`, workbookModified: modified, workbook };
}

test('readRaceSheet maps driver and constructor totals to canonical ids', () => {
  const workbook = raceSheet(new ExcelJS.Workbook(), 'Race 8', [
    ['L. Norris', -26, 'McLaren', -19],
    ['O. Piastri', 16, null, null],
  ]);
  const race = readRaceSheet(workbook, 'Race 8');
  assert.equal(race.drivers['lando-norris'].total, -26);
  assert.equal(race.drivers['oscar-piastri'].total, 16);
  assert.equal(race.teams.mclaren.total, -19);
});

test('readRaceSheet returns null for a sheet the workbook does not carry', () => {
  const workbook = raceSheet(new ExcelJS.Workbook(), 'Race 8', [['L. Norris', -26, 'McLaren', -19]]);
  assert.equal(readRaceSheet(workbook, 'Race 9'), null);
});

test('selectRaceSources prefers the more recently modified workbook', () => {
  const sources = selectRaceSources([
    entry('master.xlsx', '2026-08-03T16:49:11Z', (wb) => raceSheet(wb, 'Race 8', [['L. Norris', -19, 'McLaren', -14]])),
    entry('monaco-final.xlsx', '2026-08-20T09:00:00Z', (wb) => raceSheet(wb, 'Race 8', [['L. Norris', -26, 'McLaren', -19]])),
  ]);
  assert.equal(sources.monaco.workbook, 'monaco-final.xlsx');
  assert.equal(sources.monaco.race.drivers['lando-norris'].total, -26);
});

test('selectRaceSources ignores a reissue that is older than the master', () => {
  // The 10 August Monaco attachment was byte-identical to the 2 August one and
  // predated the master's corrections (#79). Supplied later, named "updated",
  // and still stale — only the internal timestamp reveals it.
  const sources = selectRaceSources([
    entry('master.xlsx', '2026-08-03T16:49:11Z', (wb) => raceSheet(wb, 'Race 8', [['L. Norris', -26, 'McLaren', -19]])),
    entry('monaco-updated.xlsx', '2026-08-02T18:37:46Z', (wb) => raceSheet(wb, 'Race 8', [['L. Norris', -20, 'McLaren', -20]])),
  ]);
  assert.equal(sources.monaco.workbook, 'master.xlsx');
  assert.equal(sources.monaco.race.drivers['lando-norris'].total, -26);
});

test('selectRaceSources takes each race from its own newest source', () => {
  const sources = selectRaceSources([
    entry('master.xlsx', '2026-08-03T16:49:11Z', (wb) => {
      raceSheet(wb, 'Race 1', [['M. Verstappen', 25, 'Red Bull', 3]]);
      raceSheet(wb, 'Race 8', [['L. Norris', -26, 'McLaren', -19]]);
    }),
    entry('australia-updated.xlsx', '2026-08-10T07:18:24Z', (wb) => raceSheet(wb, 'Race 1', [['M. Verstappen', 29, 'Red Bull', 5]])),
  ]);
  assert.equal(sources.australia.workbook, 'australia-updated.xlsx');
  assert.equal(sources.australia.race.drivers['max-verstappen'].total, 29);
  assert.equal(sources.monaco.workbook, 'master.xlsx');
});

test('workbookModified reads the document timestamp, not the filesystem', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.modified = new Date('2026-08-03T16:49:11Z');
  assert.equal(workbookModified(workbook), '2026-08-03T16:49:11.000Z');
});

test('the sheet map follows Martin\'s original calendar, not our renumbered rounds', () => {
  // Monaco is his Race 8 but our round 6; Spain-at-Madrid is his Race 16 while
  // Barcelona is his Race 9. Keying off `round` would silently read the wrong sheet.
  assert.equal(MARTIN_SHEET_BY_RACE.monaco, 8);
  assert.equal(MARTIN_SHEET_BY_RACE['barcelona-catalunya'], 9);
  assert.equal(MARTIN_SHEET_BY_RACE.spain, 16);
  assert.equal(Object.keys(MARTIN_SHEET_BY_RACE).length, 24);
});

test('readRaceSheet reads formula cells by their cached result', async () => {
  // Martin's master workbook computes every driver name and total with formulas
  // (=VLOOKUP(...), =SUM(P:W)-2*(S)); only his reissued single-race files carry
  // hardcoded values. ExcelJS returns a formula cell as { formula, result }, so
  // reading .value directly yields an object and the whole sheet is skipped —
  // which silently reduced the ledger to the four value-only workbooks and let a
  // stale Monaco reissue win over the master.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Race 8');
  const row = sheet.getRow(6);
  row.getCell(2).value = { formula: 'VLOOKUP(1, TDriverX, 2, FALSE)', result: 'L. Norris' };
  row.getCell(24).value = { formula: 'SUM(P6:W6)-2*(S6)', result: -26 };
  row.getCell(25).value = { formula: 'C6', result: 'McLaren' };
  row.getCell(27).value = { formula: '(3*X6+2*X7)/5', result: -19 };
  row.commit();

  const race = readRaceSheet(workbook, 'Race 8');
  assert.equal(race.drivers['lando-norris'].total, -26);
  assert.equal(race.teams.mclaren.total, -19);
});

test('readRaceSheet ignores a formula whose cached result is an error', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Race 8');
  const row = sheet.getRow(6);
  row.getCell(2).value = { formula: 'VLOOKUP(1, TDriverX, 2, FALSE)', result: 'L. Norris' };
  row.getCell(24).value = { formula: 'SUM(P6:W6)', result: { error: '#REF!' } };
  row.commit();
  assert.equal(readRaceSheet(workbook, 'Race 8'), null);
});

test('readRaceSheet reads shared-formula cells, which carry no formula key', () => {
  // Excel stores a column of identical formulas once: the first cell holds
  // { formula, result } and every cell below it { sharedFormula, result }.
  // Keying off "formula" therefore reads only the top row of each column — the
  // Monaco sheet yielded 2 drivers of 22 before this was handled.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Race 8');
  const first = sheet.getRow(6);
  first.getCell(2).value = { formula: 'VLOOKUP(1, TDriverX, 2, FALSE)', result: 'L. Norris' };
  first.getCell(24).value = { formula: 'SUM(P6:W6)-2*(S6)', result: -26 };
  first.commit();
  const second = sheet.getRow(7);
  second.getCell(2).value = { sharedFormula: 'B6', result: 'O. Piastri' };
  second.getCell(24).value = { sharedFormula: 'X6', result: 16 };
  second.commit();

  const race = readRaceSheet(workbook, 'Race 8');
  assert.equal(race.drivers['lando-norris'].total, -26);
  assert.equal(race.drivers['oscar-piastri'].total, 16);
});

test('Martin\'s "RBPT" resolves to Racing Bulls, not Red Bull', () => {
  // His sheets label the team RBPT. Resolving it to red-bull silently merged the
  // two constructors — the later row won, so every race reported a Red Bull total
  // that was actually RBPT's.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Race 8');
  const rows = [['M. Verstappen', -40, 'Red Bull', -15], ['L. Lawson', 24, 'RBPT', 26]];
  rows.forEach(([driver, total, team, teamTotal], index) => {
    const row = sheet.getRow(6 + index);
    row.getCell(2).value = driver;
    row.getCell(24).value = total;
    row.getCell(25).value = team;
    row.getCell(27).value = teamTotal;
    row.commit();
  });
  const race = readRaceSheet(workbook, 'Race 8');
  assert.equal(race.teams['red-bull'].total, -15);
  assert.equal(race.teams['racing-bulls'].total, 26);
});

test('readRaceSheet treats a formula cell with no cached result as zero', () => {
  // Excel omits the cached <v> when a formula evaluates to 0, so ExcelJS yields
  // { sharedFormula } with no result key. Falling through would drop the row, and
  // a driver on exactly 0 points would vanish from the ledger — which is how
  // Sainz's Belgium score (0) went unchecked, the very race where Martin missed
  // his 10-place grid penalty. openpyxl reads the same cells as 0.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Race 12');
  const first = sheet.getRow(6);
  first.getCell(2).value = { formula: 'VLOOKUP(1, TDriverX, 2, FALSE)', result: 'L. Norris' };
  first.getCell(24).value = { formula: 'SUM(P6:W6)', result: 4 };
  first.commit();
  const zero = sheet.getRow(7);
  zero.getCell(2).value = { sharedFormula: 'B6', result: 'C. Sainz Jr' };
  zero.getCell(24).value = { sharedFormula: 'X6' };
  zero.commit();

  const race = readRaceSheet(workbook, 'Race 12');
  assert.equal(race.drivers['carlos-sainz'].total, 0);
});

test('readRaceSheet ignores an unraced sheet, whose template rows are all zero', () => {
  // Martin's master carries all 24 race sheets from the start; the ones not yet
  // run compute 0 for every driver. Treating those as results would put 13 empty
  // races in the ledger and report each as "in the ledger but not scored".
  // A real race cannot total zero for all 22 — position change alone prevents it.
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Race 20');
  ['L. Norris', 'O. Piastri'].forEach((driver, index) => {
    const row = sheet.getRow(6 + index);
    row.getCell(2).value = driver;
    row.getCell(24).value = 0;
    row.commit();
  });
  assert.equal(readRaceSheet(workbook, 'Race 20'), null);
});

test('assertCompleteSources rejects a sheet that parsed fewer than every seat', () => {
  // A missed alias or an unhandled formula shape must not be recorded as a thin
  // ledger: the rows that vanished would simply stop being checked.
  const problems = assertCompleteSources({
    monaco: {
      sheet: 'Race 8',
      workbook: 'master.xlsx',
      race: { drivers: { 'lando-norris': fullDriverFields() }, teams: { mclaren: { total: -19, fineEuros: 0 } } },
    },
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`1/${EXPECTED_DRIVERS} drivers and 1/${EXPECTED_TEAMS} constructors`));
});

test('assertCompleteSources passes a full sheet', () => {
  const drivers = Object.fromEntries(Array.from({ length: EXPECTED_DRIVERS }, (_, i) => [`d${i}`, fullDriverFields()]));
  const teams = Object.fromEntries(Array.from({ length: EXPECTED_TEAMS }, (_, i) => [`t${i}`, { total: i, fineEuros: 0 }]));
  assert.deepEqual(assertCompleteSources({ monaco: { sheet: 'Race 8', workbook: 'm.xlsx', race: { drivers, teams } } }), []);
});

test('detectCoverageLoss reports a race or row the committed ledger had and this run does not', () => {
  const previous = {
    monaco: { drivers: { 'lando-norris': { total: -26 }, 'oscar-piastri': { total: 16 } }, teams: { mclaren: { total: -19 } } },
    belgium: { drivers: { 'carlos-sainz': { total: 0 } }, teams: {} },
  };
  const next = { monaco: { drivers: { 'lando-norris': { total: -26 } }, teams: { mclaren: { total: -19 } } } };
  const losses = detectCoverageLoss(previous, next);
  assert.equal(losses.length, 2);
  assert.match(losses.join(' '), /oscar-piastri dropped out/);
  assert.match(losses.join(' '), /belgium: covered by the committed ledger/);
});

test('detectCoverageLoss is silent when coverage is unchanged or grows', () => {
  const previous = { monaco: { drivers: { 'lando-norris': { total: -26 } }, teams: {} } };
  const next = {
    monaco: { drivers: { 'lando-norris': { total: -26 }, 'oscar-piastri': { total: 16 } }, teams: {} },
    spain: { drivers: { 'carlos-sainz': { total: 4 } }, teams: {} },
  };
  assert.deepEqual(detectCoverageLoss(previous, next), []);
});

test('assertCompleteSources rejects a driver missing a compared field', () => {
  // Entity counts alone do not protect field coverage: dropping sprintPoints from
  // every driver kept 22/11 intact and lost a whole comparison dimension.
  const drivers = Object.fromEntries(Array.from({ length: EXPECTED_DRIVERS }, (_, i) => [`d${i}`, fullDriverFields()]));
  delete drivers.d3.sprintPoints;
  const teams = Object.fromEntries(Array.from({ length: EXPECTED_TEAMS }, (_, i) => [`t${i}`, { total: i, fineEuros: 0 }]));
  const problems = assertCompleteSources({ monaco: { sheet: 'Race 8', workbook: 'm.xlsx', race: { drivers, teams } } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /driver d3 is missing field\(s\): sprintPoints/);
});

test('assertCompleteSources rejects a constructor missing a compared field', () => {
  const drivers = Object.fromEntries(Array.from({ length: EXPECTED_DRIVERS }, (_, i) => [`d${i}`, fullDriverFields()]));
  const teams = Object.fromEntries(Array.from({ length: EXPECTED_TEAMS }, (_, i) => [`t${i}`, { total: i, fineEuros: 0 }]));
  delete teams.t0.fineEuros;
  const problems = assertCompleteSources({ monaco: { sheet: 'Race 8', workbook: 'm.xlsx', race: { drivers, teams } } });
  assert.match(problems[0], /team t0 is missing field\(s\): fineEuros/);
});

test('detectCoverageLoss reports a field that disappeared from an entity', () => {
  const previous = { monaco: { drivers: { 'lando-norris': { total: -26, sprintPoints: 0 } }, teams: {} } };
  const next = { monaco: { drivers: { 'lando-norris': { total: -26 } } }, teams: {} };
  const losses = detectCoverageLoss(previous, next);
  assert.equal(losses.length, 1);
  assert.match(losses[0], /lando-norris lost field sprintPoints/);
});

function fullDriverFields() {
  return {
    total: 0, grid: 1, finish: 1, fineEuros: 0, gridPenalty: 0, timePenalty: 0, sprintPoints: 0, fastestLapPoints: 0,
  };
}

test('validateRaceCoverage rejects a field nobody expects, on either side', () => {
  // A new scoring input added to one projection but not the other would be
  // computed, published, and never compared. The schema is exact for that reason.
  const drivers = Object.fromEntries(Array.from({ length: EXPECTED_DRIVERS }, (_, i) => [`d${i}`, fullDriverFields()]));
  drivers.d0.newScoreInput = 3;
  const teams = Object.fromEntries(Array.from({ length: EXPECTED_TEAMS }, (_, i) => [`t${i}`, { total: i, fineEuros: 0 }]));
  const problems = validateRaceCoverage({ monaco: { drivers, teams } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /driver d0 has unexpected field\(s\): newScoreInput/);
});

test('readRaceSheet parses qualifying DSQ x as dsq, drops all-zero unrun templates, and handles formula errors', () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Race 1');
  const row = sheet.getRow(6);
  row.getCell(2).value = 'M. Verstappen';
  row.getCell(4).value = 'x'; // qualifying DSQ
  row.getCell(24).value = 25;
  row.getCell(25).value = 'Red Bull';
  row.getCell(27).value = 25;
  row.commit();

  const race = readRaceSheet(wb, 'Race 1');
  assert.ok(race);
  assert.equal(race.drivers['max-verstappen'].grid, 'dsq');

  // All-zero unrun template
  const unrunWb = new ExcelJS.Workbook();
  const unrunSheet = unrunWb.addWorksheet('Race 2');
  const unrunRow = unrunSheet.getRow(6);
  unrunRow.getCell(2).value = 'M. Verstappen';
  unrunRow.getCell(24).value = 0;
  unrunRow.commit();
  assert.equal(readRaceSheet(unrunWb, 'Race 2'), null);

  // Formula with error
  const errWb = new ExcelJS.Workbook();
  const errSheet = errWb.addWorksheet('Race 3');
  const errRow = errSheet.getRow(6);
  errRow.getCell(2).value = { formula: 'VLOOKUP()', result: { error: '#REF!' } };
  errRow.commit();
  assert.equal(readRaceSheet(errWb, 'Race 3'), null);
});

test('detectCoverageLoss detects missing races and missing entities', () => {
  const prev = {
    monaco: { drivers: { 'lando-norris': { total: 1 } }, teams: { mclaren: { total: 1 } } },
    spain: { drivers: { 'carlos-sainz': { total: 1 } }, teams: {} },
  };
  const next = {
    monaco: { drivers: {}, teams: {} }, // lando-norris and mclaren dropped
    // spain completely missing
  };
  const losses = detectCoverageLoss(prev, next);
  assert.ok(losses.some((msg) => msg.includes('missing from this run')));
  assert.ok(losses.some((msg) => msg.includes('driver lando-norris dropped')));
  assert.ok(losses.some((msg) => msg.includes('team mclaren dropped')));
});

