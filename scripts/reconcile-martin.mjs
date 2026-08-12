#!/usr/bin/env node

// Two modes, deliberately separated by what they need:
//
//   --generate   reads Martin's workbooks and rewrites the ledger. Local only:
//                `martins-calculations/` is gitignored and CI cannot see it.
//                Pass --workbooks <dir> when running from a worktree, which does
//                not carry the ignored directory.
//   --check      compares our scored artifacts against the committed ledger.
//                Needs no workbook, which is what makes it enforceable in CI.
//
// The split is the point. A tool that only runs locally is a reminder; a gate
// that runs on every build is a control. #62 accumulated 13 missing grid
// penalties across seven rounds precisely because nothing failed.

import { existsSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { compareToLedger, detectSourceRegression, ledgerBody } from '../lib/martin-ledger.js';
import { readWorkbook, selectRaceSources, workbookIdentity, workbookModified } from '../lib/martin-workbook.js';
import { loadCalendar, readJson, scoredRacePath } from '../lib/season-store.js';

const WORKBOOK_DIR = 'martins-calculations';
export const LEDGER_PATH = 'season/reference/martin-ledger.json';
export const DIVERGENCE_PATH = 'season/reference/accepted-divergence.json';
const GENERATE_COMMAND = 'npm run reconcile:martin -- --generate';

export function scoredByRace(calendar = loadCalendar(), read = readJson) {
  const races = {};
  for (const race of calendar) {
    const scored = read(scoredRacePath(race.id), null);
    if (!scored) continue;
    const drivers = {};
    const teams = {};
    for (const team of scored.teams || []) {
      for (const driver of team.drivers || []) drivers[driver.driverId] = driver.totalPoints;
      for (const constructor of team.constructors || []) teams[constructor.teamId] = constructor.totalPoints;
    }
    races[race.id] = { drivers, teams };
  }
  return races;
}

export async function generateLedger({ workbookDir = WORKBOOK_DIR, previous = null } = {}) {
  if (!existsSync(workbookDir)) {
    throw new Error(`${workbookDir} not found. Martin's workbooks are gitignored local reference — this mode only runs locally.`);
  }
  const files = readdirSync(workbookDir)
    .filter((name) => name.endsWith('.xlsx') && !name.startsWith('~$'))
    .sort();
  if (!files.length) throw new Error(`No .xlsx files in ${workbookDir}`);

  const entries = [];
  for (const name of files) {
    const path = join(workbookDir, name);
    const workbook = await readWorkbook(path);
    entries.push({ ...workbookIdentity(path), name, workbookModified: workbookModified(workbook), workbook });
  }

  const sources = selectRaceSources(entries);
  const provenance = { races: {}, generatedBy: GENERATE_COMMAND };
  const races = {};
  for (const [raceId, source] of Object.entries(sources)) {
    provenance.races[raceId] = {
      workbook: source.workbook,
      sha256: source.sha256,
      workbookModified: source.workbookModified,
      sheet: source.sheet,
    };
    races[raceId] = source.race;
  }

  // Refuse to record a source older than the one already cited for that race.
  const regressions = detectSourceRegression(previous?.provenance, provenance);
  return { ledger: { provenance, races }, regressions, workbooksRead: files.length };
}

export function runCheck({ ledger, accepted, scored }) {
  if (!ledger) {
    throw new Error(`${LEDGER_PATH} is missing. Run \`${GENERATE_COMMAND}\` against Martin's workbooks.`);
  }
  const result = compareToLedger(scored, ledger, accepted);
  const lines = [];
  for (const row of result.unexplained) {
    lines.push(`  ${row.race} ${row.kind} ${row.id}: ours ${row.ours}, Martin ${row.martin}`);
  }
  for (const row of result.resolved) {
    lines.push(`  ${row.race} ${row.kind} ${row.id}: accepted divergence no longer applies — remove it from ${DIVERGENCE_PATH}`);
  }
  for (const raceId of result.missingRaces) {
    lines.push(`  ${raceId}: in the ledger but not scored`);
  }
  return { ...result, lines, ok: !lines.length };
}

function parseArgs(argv) {
  const index = argv.indexOf('--workbooks');
  return {
    generate: argv.includes('--generate'),
    workbookDir: index >= 0 ? argv[index + 1] : WORKBOOK_DIR,
  };
}

async function main(argv) {
  const { generate, workbookDir } = parseArgs(argv);
  const previous = readJson(LEDGER_PATH, null);

  if (generate) {
    const { ledger, regressions, workbooksRead } = await generateLedger({ workbookDir, previous });
    if (regressions.length) {
      for (const regression of regressions) console.error(`  ${regression.message}`);
      throw new Error(`${regressions.length} race(s) would be taken from a workbook older than the one already recorded`);
    }
    const races = Object.keys(ledger.races).length;
    // generatedAt sits outside the compared body on purpose: regenerating from
    // the same workbooks must produce a byte-identical diff, or the ledger churns
    // on every run and a real change stops standing out in review.
    writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(`Ledger written from ${workbooksRead} workbook(s), covering ${races} race(s).`);
    for (const [raceId, source] of Object.entries(ledger.provenance.races)) {
      console.log(`  ${raceId.padEnd(22)} ${source.sheet.padEnd(8)} ${source.workbook} (modified ${source.workbookModified})`);
    }
    if (previous && ledgerBody(previous) === ledgerBody(ledger)) console.log('Scores unchanged from the committed ledger.');
    return;
  }

  const result = runCheck({
    ledger: previous,
    accepted: readJson(DIVERGENCE_PATH, { divergences: [] }),
    scored: scoredByRace(),
  });
  if (result.ok) {
    const races = Object.keys(previous.races).length;
    console.log(`Reconciled against Martin's ledger: ${races} race(s), no unexplained divergence.`);
    return;
  }
  console.error('Reconciliation against Martin\'s ledger failed:');
  for (const line of result.lines) console.error(line);
  throw new Error(`${result.unexplained.length} unexplained divergence(s), ${result.resolved.length} stale accepted entr(ies)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export { main, parseArgs };
