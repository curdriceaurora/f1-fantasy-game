import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import {
  buildEntries,
  buildEntriesWithMap,
  createStableTeamId,
  syncSeasonEntries,
} from '../scripts/sync-season-entries.mjs';
import { syntheticEntries } from '../scripts/generate-test-corpus.mjs';

function workbookRows(order = ['Alice', 'Bob']) {
  const base = Array.from({ length: 4 }, () => []);
  const templates = {
    Alice: [null, 'Alice Example', 'Apex Hunters', 'Pierre Gasly', 'Franco Colapinto', 'Lance Stroll', 'Alpine', 'Haas', 'Audi', 'Australia', 380, 'George Russell', 'Mercedes', 4, 31],
    Bob: [null, 'Bob Example', 'Brake Late', 'Esteban Ocon', 'Oliver Bearman', 'Nico Hulkenberg', 'Williams', 'Aston Martin', 'Audi', 'Japan', 382, 'Max Verstappen', 'Ferrari', 5, 37],
  };
  return base.concat(order.map((key) => templates[key]));
}

test('stable team ids do not depend on worksheet row order', () => {
  const firstPass = buildEntries(workbookRows(['Alice', 'Bob']), '/tmp/roster.xlsx');
  const secondPass = buildEntries(workbookRows(['Bob', 'Alice']), '/tmp/roster.xlsx');

  const idsByPrincipalFirst = Object.fromEntries(firstPass.map((entry) => [entry.principalName, entry.teamId]));
  const idsByPrincipalSecond = Object.fromEntries(secondPass.map((entry) => [entry.principalName, entry.teamId]));

  assert.deepEqual(idsByPrincipalFirst, idsByPrincipalSecond);
  assert.equal(idsByPrincipalFirst['Alice Example'], createStableTeamId('Alice Example'));
});

test('existing team ids survive display-name edits across workbook reimports', () => {
  const previousImport = buildEntriesWithMap(workbookRows(['Alice', 'Bob']), '/tmp/roster.xlsx');
  const previousEntries = previousImport.entries;
  const renamedRows = workbookRows(['Alice', 'Bob']);
  renamedRows[4][2] = 'Apex Hunters Reloaded';

  const nextImport = buildEntriesWithMap(renamedRows, '/tmp/roster.xlsx', previousEntries, previousImport.teamIdMap);
  const nextEntries = nextImport.entries;
  const previousAlice = previousEntries.find((entry) => entry.principalName === 'Alice Example');
  const nextAlice = nextEntries.find((entry) => entry.principalName === 'Alice Example');

  assert.equal(nextAlice.teamId, previousAlice.teamId);
});

test('existing team ids survive principal-name edits when map aliases are available', () => {
  const previousImport = buildEntriesWithMap(workbookRows(['Alice', 'Bob']), '/tmp/roster.xlsx');
  const previousEntries = previousImport.entries;
  const renamedRows = workbookRows(['Alice', 'Bob']);
  renamedRows[4][1] = 'Alice Example-Smith';

  const nextImport = buildEntriesWithMap(renamedRows, '/tmp/roster.xlsx', previousEntries, previousImport.teamIdMap);
  const previousAlice = previousEntries.find((entry) => entry.displayName === 'Apex Hunters');
  const nextAlice = nextImport.entries.find((entry) => entry.displayName === 'Apex Hunters');

  assert.equal(nextAlice.teamId, previousAlice.teamId);
});

test('existing team ids survive principal and display edits when row placement remains stable', () => {
  const previousImport = buildEntriesWithMap(workbookRows(['Alice', 'Bob']), '/tmp/roster.xlsx');
  const previousEntries = previousImport.entries;
  const renamedRows = workbookRows(['Alice', 'Bob']);
  renamedRows[4][1] = 'Alice Example-Smith';
  renamedRows[4][2] = 'Apex Hunters Reloaded';

  const nextImport = buildEntriesWithMap(renamedRows, '/tmp/roster.xlsx', previousEntries, previousImport.teamIdMap);
  const previousAlice = previousEntries.find((entry) => entry.source.rowNumber === 5);
  const nextAlice = nextImport.entries.find((entry) => entry.source.rowNumber === 5);

  assert.equal(nextAlice.teamId, previousAlice.teamId);
});

test('duplicate principal and display combinations are rejected', () => {
  const rows = workbookRows(['Alice', 'Alice']);
  assert.throws(
    () => buildEntries(rows, '/tmp/roster.xlsx'),
    /Duplicate stable team id/,
  );
});

test('workbook total cost is validated against canonical roster pricing', () => {
  const rows = workbookRows(['Alice']);
  rows[4][14] = 48;

  assert.throws(
    () => buildEntries(rows, '/tmp/roster.xlsx'),
    /Workbook Total Cost mismatch/,
  );
});

test('over-budget rosters are rejected even if the workbook total is blank', () => {
  const rows = workbookRows(['Alice']);
  rows[4][3] = 'George Russell';
  rows[4][4] = 'Lando Norris';
  rows[4][5] = 'Max Verstappen';
  rows[4][6] = 'Mercedes';
  rows[4][7] = 'Ferrari';
  rows[4][8] = 'McLaren';
  rows[4][14] = null;

  assert.throws(
    () => buildEntries(rows, '/tmp/roster.xlsx'),
    /over budget/,
  );
});

test('synthetic corpus entries use the same principal-based stable ids as live imports', () => {
  const calendar = [{ id: 'australia' }];
  const entries = syntheticEntries(calendar);

  for (const entry of entries) {
    assert.equal(entry.teamId, createStableTeamId(entry.principalName));
    assert.notEqual(entry.teamId, entry.displayName);
  }
});

test('syncSeasonEntries reads the workbook and writes all season configuration', async () => {
  const root = mkdtempSync(join(tmpdir(), 'f1-roster-sync-'));
  const workbookPath = join(root, 'roster.xlsx');
  const seasonDir = join(root, 'season');
  const previousSeasonDir = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;

  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Starting Roster');
    sheet.getCell('A1').value = new Date('2026-01-01T00:00:00Z');
    sheet.getCell('A2').value = { formula: '1+1', result: 2 };
    sheet.getCell('A3').value = { richText: [{ text: 'Header' }] };
    sheet.getCell('A4').value = { text: 'Rules', hyperlink: 'https://example.test/rules' };
    sheet.addRow([
      null,
      'Alice Example',
      'Apex Hunters',
      'Pierre Gasly',
      'Franco Colapinto',
      'Lance Stroll',
      'Alpine',
      'Haas',
      'Audi',
      'Australia',
      380,
      'George Russell',
      'Mercedes',
      4,
      { formula: '10+21', result: 31 },
    ]);
    await workbook.xlsx.writeFile(workbookPath);

    const result = await syncSeasonEntries(workbookPath);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].principalName, 'Alice Example');
    assert.equal(result.scoreboard.standings.length, 1);
    assert.equal(JSON.parse(readFileSync(join(seasonDir, 'config', 'entries.json'))).length, 1);
    assert.ok(JSON.parse(readFileSync(join(seasonDir, 'config', 'catalog.json'))).drivers.length > 0);
    assert.equal(JSON.parse(readFileSync(join(seasonDir, 'config', 'team-id-map.json'))).entries.length, 1);
  } finally {
    if (previousSeasonDir == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previousSeasonDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test('syncSeasonEntries rejects a workbook without the roster sheet', async () => {
  const root = mkdtempSync(join(tmpdir(), 'f1-roster-missing-sheet-'));
  const workbookPath = join(root, 'roster.xlsx');
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Other');
    await workbook.xlsx.writeFile(workbookPath);
    await assert.rejects(syncSeasonEntries(workbookPath), /Starting Roster/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two distinct roster labels resolving to the same team are rejected at import', () => {
  // The #88 bug: Martin labels Racing Bulls "RBPT", the alias table mapped it to
  // red-bull, and both collapsed into one constructor — eight managers held the
  // wrong team for eleven races while their picks still looked plausible. That
  // exact pair no longer collides, so the guard is exercised with another pair
  // that does.
  //
  // The check assumes each driver and team appears under one label per roster,
  // which holds for Martin's: he writes "RBPT" or "Red Bull", never both spellings
  // of one team, and one form of each driver's name throughout.
  const header = ['', 'Team Principal', 'Team Name', 'Driver 1', 'Driver 2', 'Driver 3', 'Team 1', 'Team 2', 'Team 3', 'Circuit', 'Classified', 'Champion', 'Constructor', 'Last driver', 'Cost'];
  // Russell 12 + Hamilton 9 + Stroll 5 + team1 13 + Audi 5 + Haas 6 = 50.
  const row = (principal, team1) => ['', principal, `${principal} Racing`, 'G. Russell', 'L. Hamilton', 'L. Stroll', team1, 'Audi', 'Haas', 'Britain', 400, 'G. Russell', 'Mercedes', 8, 50];
  // Data rows begin at index 4; the workbook carries a title block above the header.
  const rows = [[], [], [], header, row('Alpha', 'Red Bull'), row('Beta', 'Red Bull Racing')];

  assert.throws(
    () => buildEntries(rows, 'roster.xlsx'),
    /"Red Bull" and "Red Bull Racing" both resolve to red-bull/,
  );
});

test('the same team written the same way twice is not a collision', () => {
  const header = ['', 'Team Principal', 'Team Name', 'Driver 1', 'Driver 2', 'Driver 3', 'Team 1', 'Team 2', 'Team 3', 'Circuit', 'Classified', 'Champion', 'Constructor', 'Last driver', 'Cost'];
  const row = (principal) => ['', principal, `${principal} Racing`, 'G. Russell', 'L. Hamilton', 'L. Stroll', 'Red Bull', 'Audi', 'Haas', 'Britain', 400, 'G. Russell', 'Mercedes', 8, 50];
  assert.equal(buildEntries([[], [], [], header, row('Alpha'), row('Beta')], 'roster.xlsx').length, 2);
});

test('the collision guard covers the prediction columns too', () => {
  // Predictions resolve through the same alias table as the picks, so a collision
  // there corrupts a driver- or constructor-champion prediction just as silently.
  // Selections and predictions are the same kind of reference and must be checked
  // together — a guard on part of the surface is a guard with a hole in it.
  const header = ['', 'Team Principal', 'Team Name', 'Driver 1', 'Driver 2', 'Driver 3', 'Team 1', 'Team 2', 'Team 3', 'Circuit', 'Classified', 'Champion', 'Constructor', 'Last driver', 'Cost'];
  const row = (principal, constructorChampion) => ['', principal, `${principal} Racing`, 'G. Russell', 'L. Hamilton', 'L. Stroll', 'Red Bull', 'Audi', 'Haas', 'Britain', 400, 'G. Russell', constructorChampion, 8, 50];
  assert.throws(
    () => buildEntries([[], [], [], header, row('Alpha', 'Red Bull'), row('Beta', 'Red Bull Racing')], 'roster.xlsx'),
    /"Red Bull" and "Red Bull Racing" both resolve to red-bull/,
  );
});

test('the collision guard covers the driver-champion prediction', () => {
  const header = ['', 'Team Principal', 'Team Name', 'Driver 1', 'Driver 2', 'Driver 3', 'Team 1', 'Team 2', 'Team 3', 'Circuit', 'Classified', 'Champion', 'Constructor', 'Last driver', 'Cost'];
  const row = (principal, driverChampion) => ['', principal, `${principal} Racing`, 'G. Russell', 'L. Hamilton', 'L. Stroll', 'Red Bull', 'Audi', 'Haas', 'Britain', 400, driverChampion, 'Mercedes', 8, 50];
  assert.throws(
    () => buildEntries([[], [], [], header, row('Alpha', 'G. Russell'), row('Beta', 'George Russell')], 'roster.xlsx'),
    /both resolve to george-russell/,
  );
});
