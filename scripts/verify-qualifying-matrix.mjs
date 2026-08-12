#!/usr/bin/env node

// Checks QUALIFYING_MATRIX against Martin's `TDriver` table, which is the
// authoritative source for the §2.1 qualifying points and is NOT the table
// printed in the rules document — that one has two cells wrong (see #70, #71),
// and transcribing it is how the errors in #59 and #60 reached this codebase.
//
// The workbook lives outside the repository (`martins-calculations/` is
// gitignored as a local reference), so this cannot run in CI. It is the
// reproducible form of a check that would otherwise be done by eye. #64 folds
// it into the wider reconcile:martin harness.
//
//   npm run verify:matrix -- 'martins-calculations/<workbook>.xlsx'

import { existsSync } from 'fs';
import ExcelJS from 'exceljs';
import { scoreQualifying } from '../lib/score-engine.js';

// Tables!H52:P73 — 22 driver rows, one per seat. Column H is the rank group,
// J through P are the seven grid bands. Column I ("Lead?") is skipped.
const TDRIVER_FIRST_ROW = 52;
const TDRIVER_LAST_ROW = 73;
const RANK_COLUMN = 8;
const BAND_COLUMNS = [10, 11, 12, 13, 14, 15, 16];

// One grid slot inside each band; null exercises the DNQ column.
const BAND_PROBES = [1, 3, 8, 12, 16, 20, null];

// The workbook writes the rank Martin calls "No-Hoper"; ours is "No Hoper".
const RANK_ALIASES = { 'No-Hoper': 'No Hoper' };

export async function readTDriverMatrix(workbookPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const sheet = workbook.getWorksheet('Tables');
  if (!sheet) {
    throw new Error(`${workbookPath} has no "Tables" worksheet — is this the master workbook?`);
  }

  const matrix = new Map();
  for (let rowNumber = TDRIVER_FIRST_ROW; rowNumber <= TDRIVER_LAST_ROW; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const rawRank = row.getCell(RANK_COLUMN).value;
    if (!rawRank) continue;
    const rank = RANK_ALIASES[rawRank] || rawRank;
    const points = BAND_COLUMNS.map((column) => row.getCell(column).value);
    if (points.some((value) => typeof value !== 'number')) {
      throw new Error(`Row ${rowNumber} (${rank}) has a non-numeric band value: ${JSON.stringify(points)}`);
    }
    const seen = matrix.get(rank);
    // Every seat of a given rank must agree, so a stale edit to one driver's row
    // is caught here rather than silently winning by row order.
    if (seen && seen.join() !== points.join()) {
      throw new Error(`Rank "${rank}" is inconsistent between rows: ${seen.join()} vs ${points.join()}`);
    }
    matrix.set(rank, points);
  }
  if (!matrix.size) {
    throw new Error(`No TDriver rows found in ${workbookPath} at H${TDRIVER_FIRST_ROW}:P${TDRIVER_LAST_ROW}`);
  }
  return matrix;
}

export function diffAgainstEngine(matrix) {
  const mismatches = [];
  for (const [rank, expected] of matrix) {
    const actual = BAND_PROBES.map((position) => scoreQualifying(rank, position));
    expected.forEach((value, index) => {
      if (value !== actual[index]) {
        mismatches.push({ rank, band: index, workbook: value, engine: actual[index] });
      }
    });
  }
  return mismatches;
}

export async function runVerifyQualifyingMatrix(workbookPath) {
  if (!workbookPath) {
    throw new Error("Usage: npm run verify:matrix -- '<path to Martin's master workbook>.xlsx'");
  }
  if (!existsSync(workbookPath)) {
    throw new Error(
      `${workbookPath} not found. Martin's workbooks are gitignored local reference — point this at your own copy.`,
    );
  }
  const matrix = await readTDriverMatrix(workbookPath);
  const mismatches = diffAgainstEngine(matrix);
  const cells = matrix.size * BAND_PROBES.length;

  if (mismatches.length) {
    const bands = ['pole', '2nd-5th', '6th-10th', '11th-14th', '15th-18th', '19th-22nd', 'DNQ'];
    for (const { rank, band, workbook, engine } of mismatches) {
      console.error(`  ${rank} / ${bands[band]}: workbook ${workbook}, engine ${engine}`);
    }
    throw new Error(`${mismatches.length} of ${cells} qualifying-matrix cells disagree with TDriver`);
  }
  console.log(`QUALIFYING_MATRIX matches TDriver on all ${cells} cells (${matrix.size} ranks).`);
  return { cells, ranks: matrix.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVerifyQualifyingMatrix(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
