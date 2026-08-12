import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { basename } from 'path';
import ExcelJS from 'exceljs';
import { resolveDriver, resolveTeam } from './canonical.js';

// Martin numbers his race sheets against the *original* 24-race 2026 calendar,
// which still has Bahrain at 4 and Saudi Arabia at 5. Our calendar renumbers
// around the cancellations, so `round` cannot be used to find his sheet — Monaco
// is his "Race 8" but our round 6. This map is that original numbering, taken
// from the calendar printed in Martins FF1 2026 Rules.docx.
export const MARTIN_SHEET_BY_RACE = {
  australia: 1, china: 2, japan: 3, bahrain: 4, 'saudi-arabia': 5, miami: 6,
  canada: 7, monaco: 8, 'barcelona-catalunya': 9, austria: 10, 'great-britain': 11,
  belgium: 12, hungary: 13, netherlands: 14, italy: 15, spain: 16, azerbaijan: 17,
  singapore: 18, 'united-states': 19, mexico: 20, brazil: 21, 'las-vegas': 22,
  qatar: 23, 'abu-dhabi': 24,
};

// Driver rows 6-27, one per seat. Column B is the driver, X (24) the driver
// total; Y names the constructor and AA (27) its total, on alternating rows.
const FIRST_DRIVER_ROW = 6;
const LAST_DRIVER_ROW = 27;
const DRIVER_NAME_COL = 2;
const DRIVER_TOTAL_COL = 24;
const TEAM_NAME_COL = 25;
const TEAM_TOTAL_COL = 27;

// Every seat and every constructor must be present, or the sheet is not a result
// we can trust. A partially parsed sheet — one alias missed, one formula shape
// unhandled — would otherwise overwrite the ledger with thinner coverage and the
// gate would quietly stop checking the rows that vanished.
export const EXPECTED_DRIVERS = 22;
export const EXPECTED_TEAMS = 11;

// Entity counts alone do not protect the comparison. Dropping a field from every
// driver keeps 22/11 intact while silently removing a whole dimension from the
// check, so the schema is enforced explicitly.
export const EXPECTED_DRIVER_FIELDS = [
  'total', 'grid', 'finish', 'fineEuros', 'gridPenalty', 'timePenalty', 'sprintPoints', 'fastestLapPoints',
];
export const EXPECTED_TEAM_FIELDS = ['total', 'fineEuros'];

// The scoring inputs behind the total, so an error in one that is cancelled by an
// error in another cannot hide. Totals alone tell you *that* you disagree; these
// tell you *why* — and #62's missing grid penalties were an input error that a
// total-only check would have surfaced far later.
const INPUT_COLS = {
  grid: 4,            // D — 'x' when disqualified from qualifying
  fineEuros: 13,      // M
  finish: 14,         // N
  gridPenalty: 17,    // Q — negative points, already capped by Martin
  timePenalty: 18,    // R — negative points
  sprintPoints: 20,   // T
  fastestLapPoints: 23, // W
};

export function workbookIdentity(path) {
  const bytes = readFileSync(path);
  return { workbook: basename(path), sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function readWorkbook(path) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbook;
}

// The workbook's own modified timestamp, not the filesystem's — a file copied or
// re-downloaded gets a fresh mtime on disk while still being the older document.
export function workbookModified(workbook) {
  const modified = workbook.modified || workbook.created;
  return modified ? new Date(modified).toISOString() : null;
}

// Martin's master workbook computes every driver name and total with formulas
// (=VLOOKUP(...), =SUM(P:W)-2*(S)); only his reissued single-race files carry
// hardcoded values. ExcelJS surfaces a formula cell as { formula, result }, so
// reading .value directly yields an object, resolves to no driver, and skips the
// sheet in silence — which reduced the ledger to the four value-only workbooks
// and let a stale Monaco reissue outrank the master.
// Excel also stores a column of identical formulas once: the first cell holds
// { formula, result } and the rest { sharedFormula, result }. Keying off
// "formula" alone read only the top row of each column, so Monaco yielded 2
// drivers of 22. Any cell carrying a cached `result` is a formula cell.
// A result of { error } (e.g. #REF!) is not a value and is dropped.
// Excel also omits the cached value entirely when a formula evaluates to 0, so
// such a cell arrives as { sharedFormula } with no result at all. Falling through
// drops the row, and a driver on exactly 0 points disappears from the ledger —
// which is how Sainz's Belgium score went unchecked, in the very race where
// Martin missed his 10-place grid penalty (#88). openpyxl reads those cells as 0.
function cellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    const result = 'result' in value ? value.result : 0;
    return result && typeof result === 'object' && 'error' in result ? null : result;
  }
  return value;
}

function numberOrZero(value) {
  return typeof value === 'number' ? value : 0;
}

export function readRaceSheet(workbook, sheetName) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return null;
  const drivers = {};
  const teams = {};
  for (let rowNumber = FIRST_DRIVER_ROW; rowNumber <= LAST_DRIVER_ROW; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const driver = resolveDriver(String(cellValue(row.getCell(DRIVER_NAME_COL)) || ''));
    const driverTotal = cellValue(row.getCell(DRIVER_TOTAL_COL));
    if (driver && typeof driverTotal === 'number') {
      const grid = cellValue(row.getCell(INPUT_COLS.grid));
      drivers[driver.id] = {
        total: driverTotal,
        // 'x' marks a qualifying disqualification, which Martin scores in the
        // DNQ column rather than the band of the slot the driver starts from.
        grid: typeof grid === 'string' && grid.toLowerCase() === 'x' ? 'dsq' : (grid ?? null),
        finish: cellValue(row.getCell(INPUT_COLS.finish)) ?? null,
        fineEuros: numberOrZero(cellValue(row.getCell(INPUT_COLS.fineEuros))),
        gridPenalty: numberOrZero(cellValue(row.getCell(INPUT_COLS.gridPenalty))),
        timePenalty: numberOrZero(cellValue(row.getCell(INPUT_COLS.timePenalty))),
        sprintPoints: numberOrZero(cellValue(row.getCell(INPUT_COLS.sprintPoints))),
        fastestLapPoints: numberOrZero(cellValue(row.getCell(INPUT_COLS.fastestLapPoints))),
      };
    }
    const team = resolveTeam(String(cellValue(row.getCell(TEAM_NAME_COL)) || ''));
    const teamTotal = cellValue(row.getCell(TEAM_TOTAL_COL));
    if (team && typeof teamTotal === 'number') {
      teams[team.id] = { total: teamTotal, fineEuros: numberOrZero(cellValue(row.getCell(26))) };
    }
  }
  // Martin's master carries all 24 race sheets from the start, and the ones not
  // yet run compute 0 for every driver. Those are templates, not results: a race
  // that has actually happened cannot total zero for all 22, since position
  // change alone moves almost everyone.
  const raced = Object.values(drivers).some((driver) => driver.total !== 0);
  return Object.keys(drivers).length && raced ? { drivers, teams } : null;
}

// Completeness is enforced where the ledger is written, not in the parser: a
// partially parsed sheet — one alias missed, one formula shape unhandled — would
// otherwise overwrite the ledger with thinner coverage, and the gate would
// quietly stop checking the rows that vanished. Kept out of readRaceSheet so the
// parser stays independently testable.
function missingFields(fields, expected) {
  return expected.filter((field) => !(field in (fields || {})));
}

// Shared by both paths on purpose. The generate-time guard protects what we
// write; the check-time guard protects what CI reads, since the committed ledger
// can be narrowed by a hand edit or a bad merge long after it was generated.
// Two sets of rules would be their own hole, so there is only one.
export function validateRaceCoverage(races, describe = (raceId) => raceId) {
  const problems = [];
  for (const [raceId, race] of Object.entries(races || {})) {
    const where = describe(raceId);
    const drivers = Object.keys(race?.drivers || {}).length;
    const teams = Object.keys(race?.teams || {}).length;
    if (drivers !== EXPECTED_DRIVERS || teams !== EXPECTED_TEAMS) {
      problems.push(`${where}: ${drivers}/${EXPECTED_DRIVERS} drivers and ${teams}/${EXPECTED_TEAMS} constructors`);
    }
    for (const [kind, record, expected] of [
      ['driver', race?.drivers, EXPECTED_DRIVER_FIELDS],
      ['team', race?.teams, EXPECTED_TEAM_FIELDS],
    ]) {
      for (const [id, fields] of Object.entries(record || {})) {
        const missing = missingFields(fields, expected);
        if (missing.length) problems.push(`${where}: ${kind} ${id} is missing field(s): ${missing.join(', ')}`);
      }
    }
  }
  return problems;
}

export function assertCompleteSources(sources) {
  const races = Object.fromEntries(Object.entries(sources).map(([raceId, source]) => [raceId, source.race]));
  return validateRaceCoverage(
    races,
    (raceId) => `${raceId} (${sources[raceId].sheet} of ${sources[raceId].workbook})`,
  ).map((problem) => problem.replace(/: (\d+\/)/, ': parsed $1'));
}

// A race or a row that the previous ledger covered must not silently disappear.
// Losing coverage is indistinguishable from passing, so it has to fail.
export function detectCoverageLoss(previousRaces, nextRaces) {
  const losses = [];
  for (const [raceId, before] of Object.entries(previousRaces || {})) {
    const after = nextRaces[raceId];
    if (!after) {
      losses.push(`${raceId}: covered by the committed ledger but missing from this run`);
      continue;
    }
    for (const kind of ['drivers', 'teams']) {
      for (const [id, fields] of Object.entries(before[kind] || {})) {
        const now = after[kind]?.[id];
        if (!now) {
          losses.push(`${raceId}: ${kind.slice(0, -1)} ${id} dropped out of the ledger`);
          continue;
        }
        // Field-level loss too: an entity can survive while a compared dimension
        // quietly disappears from it.
        for (const field of Object.keys(fields || {})) {
          if (!(field in now)) losses.push(`${raceId}: ${kind.slice(0, -1)} ${id} lost field ${field}`);
        }
      }
    }
  }
  return losses;
}

// Pick, per race, the sheet from the most recently modified workbook that carries
// it. Resolution is by the workbook's internal timestamp and never by filename or
// by the order files were supplied: Martin reissues single-race files that
// supersede the master, and at least one reissue was itself stale (#79).
// Each entry is { name, sha256, workbookModified, workbook } — `name` is the
// filename for the record, `workbook` the parsed ExcelJS document.
export function selectRaceSources(entries) {
  const chosen = {};
  for (const entry of entries) {
    for (const [raceId, sheetNumber] of Object.entries(MARTIN_SHEET_BY_RACE)) {
      const sheetName = `Race ${sheetNumber}`;
      const race = readRaceSheet(entry.workbook, sheetName);
      if (!race) continue;
      const current = chosen[raceId];
      if (current && new Date(current.workbookModified) >= new Date(entry.workbookModified)) continue;
      chosen[raceId] = {
        workbook: entry.name,
        sha256: entry.sha256,
        workbookModified: entry.workbookModified,
        sheet: sheetName,
        race,
      };
    }
  }
  return chosen;
}
