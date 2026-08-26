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
import {
  compareToLedger, detectSourceRegression, ledgerBody, validateProvenance,
} from '../lib/martin-ledger.js';
import {
  assertCompleteSources, detectCoverageLoss, readWorkbook, selectRaceSources,
  validateRaceCoverage, workbookIdentity, workbookModified,
} from '../lib/martin-workbook.js';
import {
  buildConstructorContribution, buildDriverContribution, scoreFinePoints,
  scoreGridPenalty, scoreSprintFinish, scoreTimePenalty,
} from '../lib/score-engine.js';
import { loadCalendar, normalizedRacePath, readJson } from '../lib/season-store.js';

const WORKBOOK_DIR = 'martins-calculations';
export const LEDGER_PATH = 'season/reference/martin-ledger.json';
export const DIVERGENCE_PATH = 'season/reference/accepted-divergence.json';
const GENERATE_COMMAND = 'npm run reconcile:martin -- --generate';

// Scored from the normalized race data rather than from season/scored/*.json.
// The scored artifacts contain only drivers and constructors somebody picked, so
// Piastri, Ocon, Bortoleto and Racing Bulls appeared nowhere and 44 ledger values
// went unchecked. Normalized data holds all 22 seats and 11 constructors, whether
// or not anyone selected them.
//
// Fines are applied here the way publish-scoreboard does — normalized records
// carry `fineEuros` with `finePoints` left at 0 — so the totals compared are the
// same ones the scoreboard publishes.
export function scoredByRace(calendar = loadCalendar(), read = readJson) {
  const races = {};
  for (const race of calendar) {
    const normalized = read(normalizedRacePath(race.id), null);
    if (!normalized) continue;
    const withFines = Object.fromEntries(
      Object.entries(normalized.drivers).map(([id, driver]) => [
        id, { ...driver, finePoints: scoreFinePoints(driver.fineEuros) },
      ]),
    );
    // Mirror the columns the ledger records, so inputs are compared and not only
    // the totals they add up to.
    const drivers = {};
    for (const [id, driver] of Object.entries(withFines)) {
      drivers[id] = {
        total: buildDriverContribution(id, driver, {}).totalPoints,
        grid: driver.qualifyingDsq ? 'dsq' : (driver.gridStart ?? null),
        finish: driver.racePosition ?? null,
        fineEuros: driver.fineEuros || 0,
        gridPenalty: scoreGridPenalty(driver.gridPenaltyPlaces),
        timePenalty: scoreTimePenalty(driver.timePenaltySeconds),
        sprintPoints: driver.sprintPosition ? scoreSprintFinish(driver.sprintPosition) : 0,
        fastestLapPoints: driver.fastestLap ? 2 : 0,
      };
    }
    const teams = {};
    for (const [teamId, team] of Object.entries(normalized.teams)) {
      const contributions = team.driverIds.map((id) => buildDriverContribution(id, withFines[id], {}));
      teams[teamId] = {
        total: buildConstructorContribution(
          teamId,
          { ...team, finePoints: scoreFinePoints(team.fineEuros) },
          contributions,
        ).totalPoints,
        fineEuros: team.fineEuros || 0,
      };
    }
    races[race.id] = { drivers, teams };
  }
  return races;
}

// Pit-lane decisions carry a third state that the numeric ledger cannot express:
// the driver was penalised, but no place count is derivable. Resolved markers
// must agree with the numeric scoring input. Unresolved markers are permitted
// only when the exact zero-vs-Martin divergence remains explicitly accepted.
export function auditPitLaneGridPenalties(
  accepted,
  calendar = loadCalendar(),
  read = readJson,
) {
  const problems = [];
  for (const race of calendar) {
    const normalized = read(normalizedRacePath(race.id), null);
    if (!normalized) continue;
    for (const [driverId, driver] of Object.entries(normalized.drivers)) {
      const marker = driver.pitLaneGridPenalty;
      if (!marker) continue;
      const label = `${race.id} driver ${driverId}`;
      if (marker.numberedGridPenaltyPlaces != null) {
        problems.push(`${label}: pit-lane start also carries a ${marker.numberedGridPenaltyPlaces}-place grid-footer penalty; pit-lane resolution was preferred`);
      }
      if (marker.reason === 'decision-index-unavailable') {
        problems.push(`${label}: FIA decision index was unavailable${marker.detail ? ` — ${marker.detail}` : ''}`);
      } else if (marker.reason === 'decision-candidates-unreadable') {
        problems.push(`${label}: ${marker.candidateUrls?.length || 0} FIA decision candidate(s) could not be read`);
      } else if (!marker.sourceUrl) {
        problems.push(`${label}: pit-lane grid-penalty marker has no steward-decision source`);
      }
      if (marker.status === 'resolved') {
        if (!Number.isInteger(marker.places) || marker.places <= 0) {
          problems.push(`${label}: resolved pit-lane grid penalty has invalid place count ${marker.places}`);
        } else if (driver.gridPenaltyPlaces !== marker.places) {
          problems.push(`${label}: resolved pit-lane grid penalty is ${marker.places} places but scoring uses ${driver.gridPenaltyPlaces}`);
        }
        continue;
      }
      if (marker.status !== 'unresolved') {
        problems.push(`${label}: unknown pit-lane grid-penalty status "${marker.status}"`);
        continue;
      }
      if ('places' in marker || driver.gridPenaltyPlaces !== 0) {
        problems.push(`${label}: unresolved pit-lane grid penalty must not carry a numeric score`);
        continue;
      }
      const acknowledged = (accepted?.divergences || []).some((entry) => (
        entry.race === race.id
          && entry.kind === 'driver'
          && entry.id === driverId
          && entry.field === 'gridPenalty'
          && entry.ours === scoreGridPenalty(driver.gridPenaltyPlaces)
      ));
      if (!acknowledged) {
        problems.push(`${label}: unresolved pit-lane grid penalty is not acknowledged in ${DIVERGENCE_PATH}`);
      }
    }
  }
  return problems;
}

// readWorkbookImpl is injectable so a source with absent timestamp metadata can
// be exercised: ExcelJS stamps a modified date on write, so such a workbook
// cannot be produced by round-tripping one through a file.
export async function generateLedger({ workbookDir = WORKBOOK_DIR, previous = null, readWorkbookImpl = readWorkbook } = {}) {
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
    const workbook = await readWorkbookImpl(path);
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

  // Ways a regeneration can quietly weaken the gate, all fatal — and grouped by
  // guard for the same reason runCheck groups its findings: several of these
  // catch overlapping problems, so a flat list lets one be disconnected while its
  // neighbours keep the run failing and nothing notices.
  //
  // Both ledgers are validated, not just the old one. The previous is checked
  // before it is trusted, since comparing against a damaged record reports no
  // regression and reads as a clean run. The candidate is checked before it is
  // written, so a source that cannot produce sound provenance — a workbook with
  // no internal timestamp, say — fails here rather than producing an artifact
  // guaranteed to fail the next CI check.
  const findings = {
    previousProvenance: previous ? validateProvenance(previous).map((p) => `previous ledger provenance: ${p}`) : [],
    candidateProvenance: validateProvenance({ provenance, races }).map((p) => `generated ledger provenance: ${p}`),
    sourceRegression: detectSourceRegression(previous?.provenance, provenance).map((r) => r.message),
    sourceCompleteness: assertCompleteSources(sources),
    coverageLoss: detectCoverageLoss(previous?.races, races),
  };
  const regressions = Object.values(findings).flat();
  return { ledger: { provenance, races }, findings, regressions, workbooksRead: files.length };
}

export function runCheck({ ledger, accepted, scored, pitLanePenaltyFindings = [] }) {
  if (!ledger) {
    throw new Error(`${LEDGER_PATH} is missing. Run \`${GENERATE_COMMAND}\` against Martin's workbooks.`);
  }
  // Findings are grouped by which guard produced them, not flattened into prose.
  //
  // The mutation harness needs to assert that each guard is individually
  // load-bearing: several of them catch the same perturbation, so with a single
  // list of strings a guard can be deleted while its neighbours keep the check
  // failing and nothing notices. Attribution by category lets the harness pin
  // each guard without matching message wording, which would only turn it into a
  // change-detector.
  const findings = {
    // Provenance first: without it the ledger's values may be right while the
    // record of which workbook they came from is gone, and with it the only
    // defence against a stale source.
    provenance: validateProvenance(ledger),
    // The committed ledger is validated, not just read. The generate guards
    // cannot protect a file edited by hand or mangled by a merge afterwards.
    ledgerCoverage: validateRaceCoverage(ledger.races, (raceId) => `${raceId} (committed ledger)`),
    // The scored side too: it is the comparison projection, so an entity or field
    // appearing there without a counterpart is a hole, not a curiosity.
    scoredCoverage: validateRaceCoverage(scored, (raceId) => `${raceId} (scored)`),
    pitLaneResolution: pitLanePenaltyFindings,
  };

  const result = compareToLedger(scored, ledger, accepted);
  const lines = [
    ...findings.provenance.map((problem) => `provenance: ${problem}`),
    ...findings.ledgerCoverage,
    ...findings.scoredCoverage,
    ...findings.pitLaneResolution.map((problem) => `pit-lane resolution: ${problem}`),
  ].map((problem) => `  ${problem}`);

  for (const row of result.unexplained) {
    lines.push(`  ${row.race} ${row.kind} ${row.id} ${row.field}: ours ${row.ours}, Martin ${row.martin}`);
  }
  for (const row of result.resolved) {
    lines.push(`  ${row.race} ${row.kind} ${row.id} ${row.field}: accepted divergence no longer applies — remove it from ${DIVERGENCE_PATH}`);
  }
  for (const raceId of result.missingRaces) {
    lines.push(`  ${raceId}: in the ledger but not scored`);
  }
  for (const row of result.unmatched) {
    lines.push(row.field
      ? `  ${row.race} ${row.kind} ${row.id}: field ${row.field} is scored but absent from the ledger`
      : `  ${row.race} ${row.kind} ${row.id}: scored but absent from the ledger`);
  }
  for (const raceId of result.unledgeredRaces) {
    lines.push(`  ${raceId}: scored but absent from the ledger — regenerate with \`${GENERATE_COMMAND}\``);
  }

  return { ...result, findings, lines, ok: !lines.length };
}

// Which guard produced each kind of finding, for both paths. Named here so the
// mutation harness and the implementation cannot drift apart silently: a guard
// added without an entry here is a guard nothing can pin.
export const GENERATION_GUARDS = Object.freeze({
  previousProvenance: (result) => result.findings.previousProvenance,
  candidateProvenance: (result) => result.findings.candidateProvenance,
  sourceRegression: (result) => result.findings.sourceRegression,
  sourceCompleteness: (result) => result.findings.sourceCompleteness,
  coverageLoss: (result) => result.findings.coverageLoss,
});

export const GUARDS = Object.freeze({
  provenance: (result) => result.findings.provenance,
  ledgerCoverage: (result) => result.findings.ledgerCoverage,
  scoredCoverage: (result) => result.findings.scoredCoverage,
  pitLaneResolution: (result) => result.findings.pitLaneResolution,
  unexplained: (result) => result.unexplained,
  resolved: (result) => result.resolved,
  missingRaces: (result) => result.missingRaces,
  unmatched: (result) => result.unmatched,
  unledgeredRaces: (result) => result.unledgeredRaces,
});

export function parseArgs(argv) {
  const index = argv.indexOf('--workbooks');
  return {
    generate: argv.includes('--generate'),
    workbookDir: index >= 0 ? argv[index + 1] : WORKBOOK_DIR,
  };
}


export async function runReconcileMartinCli(argv = []) {
  const { generate, workbookDir } = parseArgs(argv);
  const previous = readJson(LEDGER_PATH, null);

  if (generate) {
    const { ledger, regressions, workbooksRead } = await generateLedger({ workbookDir, previous });
    if (regressions.length) {
      for (const regression of regressions) console.error(`  ${regression}`);
      throw new Error(`${regressions.length} problem(s) would weaken the ledger — refusing to write it`);
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

  const accepted = readJson(DIVERGENCE_PATH, { divergences: [] });
  const result = runCheck({
    ledger: previous,
    accepted,
    scored: scoredByRace(),
    pitLanePenaltyFindings: auditPitLaneGridPenalties(accepted),
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
  runReconcileMartinCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
