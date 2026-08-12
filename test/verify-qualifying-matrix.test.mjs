import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { readTDriverMatrix, diffAgainstEngine, runVerifyQualifyingMatrix } from '../scripts/verify-qualifying-matrix.mjs';

// Martin's TDriver rows, in the workbook's own spelling. Two seats per rank so the
// consistency guard is exercised the way the real 22-row table exercises it.
const ROWS = [
  ['Champion', [0, -2, -4, -6, -9, -13, -20]],
  ['Champion', [0, -2, -4, -6, -9, -13, -20]],
  ['Contender', [3, 0, -2, -4, -6, -9, -13]],
  ['Top Ten', [6, 3, 0, -2, -4, -6, -9]],
  ['Mid Runner', [9, 6, 3, 0, -2, -4, -6]],
  ['Outsider', [12, 9, 6, 3, 0, -2, -4]],
  ['No-Hoper', [15, 12, 9, 6, 3, 0, -2]],
];

async function writeWorkbook(directory, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Tables');
  rows.forEach(([rank, points], index) => {
    const row = sheet.getRow(52 + index);
    row.getCell(8).value = rank;
    points.forEach((value, band) => { row.getCell(10 + band).value = value; });
    row.commit();
  });
  const path = join(directory, 'workbook.xlsx');
  await workbook.xlsx.writeFile(path);
  return path;
}

async function withTempDir(run) {
  const directory = mkdtempSync(join(tmpdir(), 'tdriver-'));
  try {
    // Must await: a synchronous `finally` would delete the directory while the
    // workbook write/read is still in flight.
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('readTDriverMatrix reads one row per rank from Tables!H52:P73', async () => {
  await withTempDir(async (directory) => {
    const matrix = await readTDriverMatrix(await writeWorkbook(directory, ROWS));
    assert.equal(matrix.size, 6);
    // The workbook's "No-Hoper" is mapped to our canonical rank name.
    assert.deepEqual(matrix.get('No Hoper'), [15, 12, 9, 6, 3, 0, -2]);
    assert.equal(matrix.has('No-Hoper'), false);
  });
});

test('readTDriverMatrix rejects two seats of the same rank that disagree', async () => {
  await withTempDir(async (directory) => {
    const rows = structuredClone(ROWS);
    rows[1][1][5] = 2; // second Champion seat, 19th-22nd — the shape of the #59 bug
    const path = await writeWorkbook(directory, rows);
    await assert.rejects(() => readTDriverMatrix(path), /Rank "Champion" is inconsistent/);
  });
});

test('readTDriverMatrix rejects a non-numeric band value rather than scoring it', async () => {
  await withTempDir(async (directory) => {
    const rows = structuredClone(ROWS);
    rows[2][1][0] = 'n/a';
    const path = await writeWorkbook(directory, rows);
    await assert.rejects(() => readTDriverMatrix(path), /non-numeric band value/);
  });
});

test('readTDriverMatrix rejects a workbook with no Tables worksheet', async () => {
  await withTempDir(async (directory) => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Race 1');
    const path = join(directory, 'wrong.xlsx');
    await workbook.xlsx.writeFile(path);
    await assert.rejects(() => readTDriverMatrix(path), /has no "Tables" worksheet/);
  });
});

test('diffAgainstEngine is silent when the workbook agrees with the engine', () => {
  const matrix = new Map([['Outsider', [12, 9, 6, 3, 0, -2, -4]]]);
  assert.deepEqual(diffAgainstEngine(matrix), []);
});

test('diffAgainstEngine names the disagreeing cell', () => {
  // The #59 bug, as the workbook would have reported it.
  const matrix = new Map([['Outsider', [12, 9, 6, 3, 0, -2, -4]]]);
  const engineWithBug = new Map([['Outsider', [12, 9, 6, 3, 0, 2, -4]]]);
  assert.deepEqual(diffAgainstEngine(matrix), []);
  // Feed the mutated row in as the workbook side to prove the comparison is real
  // and not vacuously empty.
  const mismatches = diffAgainstEngine(engineWithBug);
  assert.equal(mismatches.length, 1);
  assert.deepEqual(mismatches[0], { rank: 'Outsider', band: 5, workbook: 2, engine: -2 });
});

test('runVerifyQualifyingMatrix passes on a workbook that matches, and counts the cells', async () => {
  await withTempDir(async (directory) => {
    const result = await runVerifyQualifyingMatrix(await writeWorkbook(directory, ROWS));
    assert.deepEqual(result, { cells: 42, ranks: 6 });
  });
});

test('runVerifyQualifyingMatrix fails when the workbook disagrees with the engine', async () => {
  await withTempDir(async (directory) => {
    const rows = structuredClone(ROWS).filter(([rank]) => rank !== 'Champion');
    rows.find(([rank]) => rank === 'Outsider')[1][5] = 2;
    const path = await writeWorkbook(directory, rows);
    await assert.rejects(() => runVerifyQualifyingMatrix(path), /1 of 35 qualifying-matrix cells disagree/);
  });
});

test('runVerifyQualifyingMatrix explains a missing workbook rather than throwing ENOENT', async () => {
  await assert.rejects(
    () => runVerifyQualifyingMatrix('does-not-exist.xlsx'),
    /gitignored local reference/,
  );
});

test('runVerifyQualifyingMatrix prints usage when given no path', async () => {
  await assert.rejects(() => runVerifyQualifyingMatrix(undefined), /Usage: npm run verify:matrix/);
});
