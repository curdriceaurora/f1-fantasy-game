import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEntries, createStableTeamId } from '../scripts/sync-season-entries.mjs';
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
  const previousEntries = buildEntries(workbookRows(['Alice', 'Bob']), '/tmp/roster.xlsx');
  const renamedRows = workbookRows(['Alice', 'Bob']);
  renamedRows[4][2] = 'Apex Hunters Reloaded';

  const nextEntries = buildEntries(renamedRows, '/tmp/roster.xlsx', previousEntries);
  const previousAlice = previousEntries.find((entry) => entry.principalName === 'Alice Example');
  const nextAlice = nextEntries.find((entry) => entry.principalName === 'Alice Example');

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
