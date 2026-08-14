import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import ExcelJS from 'exceljs';
import {
  runCheck, generateLedger, scoredByRace, GUARDS, GENERATION_GUARDS, LEDGER_PATH, DIVERGENCE_PATH,
} from '../scripts/reconcile-martin.mjs';
import { DRIVERS, TEAMS } from '../public/constants.js';
import { readJson } from '../lib/season-store.js';
import { EXPECTED_DRIVER_FIELDS, EXPECTED_TEAM_FIELDS } from '../lib/martin-workbook.js';

// Nine holes were found in this gate by review, across six rounds. Every one
// passed CI while checking less than it appeared to, and none was found by a test
// asserting the gate works — they were found by removing coverage and observing
// that the check stayed green.
//
// So this suite asks the opposite question. It perturbs the artifacts and asserts
// each perturbation is caught. A gate's correctness is what it rejects.
//
// Two design rules, both learned from those rounds:
//
// 1. Mutations are GENERATED from the shape, not hand-listed. Adding a field to
//    the schema, or a race to the season, produces new mutations automatically.
//    A hand-written list only re-checks the holes already known.
//
// 2. Each mutation names the GUARD expected to catch it, never a message.
//    Matching messages would make this a change-detector. But asserting only
//    "something failed" is not enough either: several guards catch the same
//    perturbation, so any one of them can be deleted while its neighbours keep
//    the check red. Verified by removing each guard in turn — three could be
//    deleted with the whole suite still green before attribution was added.
//    Naming the guard makes each one individually load-bearing.

const REAL_LEDGER = readJson(LEDGER_PATH, null);
const REAL_ACCEPTED = readJson(DIVERGENCE_PATH, { divergences: [] });

// Driven from the committed artifacts rather than fixtures: this is what CI
// actually reads, and a fixture can drift from it without anyone noticing.
// The manifest is carried in the state, not read directly, so a mutation can
// perturb it too. It is the third artifact the gate depends on and the only one
// expected to shrink over time.
function baseline() {
  return {
    ledger: structuredClone(REAL_LEDGER),
    scored: structuredClone(scoredByRace()),
    accepted: structuredClone(REAL_ACCEPTED),
  };
}

function check({ ledger, scored, accepted }) {
  return runCheck({ ledger, accepted, scored });
}

// A stable, deterministic target for the per-entity mutations. Sorting keeps the
// choice independent of key insertion order.
function firstRace(ledger) {
  return Object.keys(ledger.races).sort()[0];
}

function firstId(record) {
  return Object.keys(record).sort()[0];
}

test('the committed artifacts pass unmutated', () => {
  // Without this the suite could pass by rejecting everything, which would look
  // identical in the results and prove nothing.
  const result = check(baseline());
  assert.equal(result.ok, true, result.lines.join('\n'));
});

// ---------------------------------------------------------------------------
// Mutations, generated over the shape of both projections.
//
// The pairs enumerated here are where every previous hole lived: ledger against
// scored, values against provenance, and each entity against its field schema.
// ---------------------------------------------------------------------------

function projectionMutations() {
  const mutations = [];
  for (const side of ['ledger', 'scored']) {
    for (const [kind, fields] of [['drivers', EXPECTED_DRIVER_FIELDS], ['teams', EXPECTED_TEAM_FIELDS]]) {
      const at = (state) => {
        const races = side === 'ledger' ? state.ledger.races : state.scored;
        const raceId = firstRace(state.ledger);
        return { record: races[raceId][kind], raceId };
      };

      const coverage = side === 'ledger' ? 'ledgerCoverage' : 'scoredCoverage';

      mutations.push({
        name: `${side}: remove a ${kind.slice(0, -1)}`,
        guard: coverage,
        apply: (state) => { const { record } = at(state); delete record[firstId(record)]; },
      });
      mutations.push({
        name: `${side}: add an unexpected ${kind.slice(0, -1)}`,
        guard: coverage,
        apply: (state) => {
          const { record } = at(state);
          record['interloper-id'] = structuredClone(record[firstId(record)]);
        },
      });
      mutations.push({
        name: `${side}: add an unexpected field to a ${kind.slice(0, -1)}`,
        guard: coverage,
        apply: (state) => { const { record } = at(state); record[firstId(record)].unexpectedField = 1; },
      });
      mutations.push({
        name: `${side}: corrupt a ${kind.slice(0, -1)} total`,
        guard: 'unexplained',
        apply: (state) => {
          const { record } = at(state);
          const entity = record[firstId(record)];
          entity.total = (entity.total ?? 0) + 999;
        },
      });

      // One mutation per compared field, so a field added to the schema is
      // automatically exercised rather than waiting to be remembered.
      for (const field of fields) {
        mutations.push({
          name: `${side}: remove ${kind.slice(0, -1)} field "${field}"`,
          guard: coverage,
          apply: (state) => { const { record } = at(state); delete record[firstId(record)][field]; },
        });
      }
    }
  }

  mutations.push({
    name: 'ledger: remove a whole race',
    guard: 'unledgeredRaces',
    apply: (state) => { delete state.ledger.races[firstRace(state.ledger)]; },
  });
  mutations.push({
    name: 'scored: add a race the ledger does not cover',
    guard: 'unledgeredRaces',
    apply: (state) => {
      const raceId = firstRace(state.ledger);
      state.scored['unledgered-race'] = structuredClone(state.scored[raceId]);
    },
  });
  mutations.push({
    name: 'scored: remove a whole race',
    guard: 'missingRaces',
    apply: (state) => { delete state.scored[firstRace(state.ledger)]; },
  });

  // Renaming keeps the entity count and field schema intact, so neither coverage
  // guard fires. Only the symmetric ledger-vs-scored comparison can see it —
  // which is what makes this the one mutation that pins findUnmatched.
  mutations.push({
    name: 'scored: rename a driver to one the ledger does not carry',
    guard: 'unmatched',
    apply: (state) => {
      const record = state.scored[firstRace(state.ledger)].drivers;
      const id = firstId(record);
      record['renamed-driver'] = record[id];
      delete record[id];
    },
  });

  // The stale-manifest guard: an accepted divergence that no longer applies is a
  // hole, because it goes on excusing a row after the real gap has been fixed.
  //
  // The entry is synthesised rather than taken from the committed manifest. That
  // file is *expected* to empty as Martin's answers land — it is the point of the
  // whole exercise — and a mutation that reads from it would stop pinning this
  // guard at precisely the moment the manifest reached zero. Depending on the
  // data being untidy to test the tidying-up mechanism is the wrong way round.
  mutations.push({
    name: 'manifest: an accepted divergence that no longer applies',
    guard: 'resolved',
    apply: (state) => {
      const raceId = firstRace(state.ledger);
      const id = firstId(state.scored[raceId].drivers);
      // Claims a disagreement on a row where both sides already agree, so the
      // entry can never match and is stale by construction.
      state.accepted.divergences.push({
        race: raceId, kind: 'driver', id, field: 'total', ours: -9999, martin: -8888, issue: 'synthetic',
      });
    },
  });

  return mutations;
}

function provenanceMutations() {
  const mutations = [
    {
      guard: 'provenance',
      name: 'provenance: remove it entirely',
      apply: (state) => { delete state.ledger.provenance; },
    },
    {
      guard: 'provenance',
      name: 'provenance: remove the races map',
      apply: (state) => { delete state.ledger.provenance.races; },
    },
    {
      guard: 'provenance',
      name: 'provenance: remove one race\'s entry',
      apply: (state) => { delete state.ledger.provenance.races[firstRace(state.ledger)]; },
    },
    {
      guard: 'provenance',
      name: 'provenance: add an entry for a race the ledger lacks',
      apply: (state) => {
        const raceId = firstRace(state.ledger);
        state.ledger.provenance.races['phantom-race'] = structuredClone(state.ledger.provenance.races[raceId]);
      },
    },
  ];

  // Each recorded field, both absent and malformed. The malformed case matters
  // separately: a present-but-unparseable timestamp still disables stale-source
  // protection while looking populated.
  const malformed = {
    workbook: '',
    sha256: 'not-a-sha',
    workbookModified: 'sometime last week',
    sheet: 'Race 99',
  };
  for (const [field, badValue] of Object.entries(malformed)) {
    mutations.push({
      guard: 'provenance',
      name: `provenance: remove "${field}"`,
      apply: (state) => { delete state.ledger.provenance.races[firstRace(state.ledger)][field]; },
    });
    mutations.push({
      guard: 'provenance',
      name: `provenance: malform "${field}"`,
      apply: (state) => { state.ledger.provenance.races[firstRace(state.ledger)][field] = badValue; },
    });
  }

  return mutations;
}

for (const mutation of [...projectionMutations(), ...provenanceMutations()]) {
  test(`caught — ${mutation.name}`, () => {
    const state = baseline();
    mutation.apply(state);
    const result = check(state);
    assert.equal(result.ok, false, `mutation went undetected: ${mutation.name}`);
    // Attribution, not wording: the named guard must be the one that fired, so
    // deleting it cannot be masked by another guard happening to catch the same
    // perturbation.
    const caught = GUARDS[mutation.guard](result);
    assert.ok(caught.length > 0, `${mutation.name}: expected guard "${mutation.guard}" to fire`);
  });
}

test('every guard the check exposes is pinned by at least one mutation', () => {
  // Without this, a guard can be added and left unexercised, or an existing one
  // can stop being covered when a mutation is retargeted. Three guards were
  // deletable with the suite green before attribution existed.
  const pinned = new Set([...projectionMutations(), ...provenanceMutations()].map((mutation) => mutation.guard));
  for (const guard of Object.keys(GUARDS)) {
    assert.ok(pinned.has(guard), `guard "${guard}" is not pinned by any mutation`);
  }
});

test('the generated mutation set covers every compared field on both sides', () => {
  // Guards the generator itself. If it silently stopped enumerating — the failure
  // mode of a harness that looks thorough — the suite would still pass while
  // testing almost nothing, which is the exact shape of the holes it exists for.
  const names = projectionMutations().map((mutation) => mutation.name);
  for (const side of ['ledger', 'scored']) {
    for (const field of EXPECTED_DRIVER_FIELDS) {
      assert.ok(names.includes(`${side}: remove driver field "${field}"`), `missing driver ${field} on ${side}`);
    }
    for (const field of EXPECTED_TEAM_FIELDS) {
      assert.ok(names.includes(`${side}: remove team field "${field}"`), `missing team ${field} on ${side}`);
    }
  }
  // 2 sides x 2 kinds x (4 shape mutations + fields), plus 5 race/comparison ones.
  const expected = 2 * (2 * 4 + EXPECTED_DRIVER_FIELDS.length + EXPECTED_TEAM_FIELDS.length) + 5;
  assert.equal(names.length, expected);
});

// ---------------------------------------------------------------------------
// Generation path.
//
// Everything above exercises runCheck, which is what CI runs. But the ledger CI
// reads is produced by generateLedger, and its guards were unpinned: review
// showed assertCompleteSources could be disconnected entirely with the whole
// suite still green. Direct tests of the helper prove the helper works; they say
// nothing about whether generation still calls it.
//
// These mutations perturb the *sources* rather than the artifacts, and assert the
// generation guard that must object.
// ---------------------------------------------------------------------------

const FULL_SHEET = 'Race 8';
const MONACO = 'monaco';

// A complete, valid source: 22 seats and 11 constructors, so the completeness
// guard is satisfied and any failure comes from the mutation under test rather
// than from the fixture being thin.
async function writeWorkbook(directory, name, { modified = '2026-08-03T16:49:11Z', drivers = DRIVERS, teams = TEAMS } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.modified = modified ? new Date(modified) : undefined;
  workbook.created = modified ? new Date(modified) : undefined;
  const sheet = workbook.addWorksheet(FULL_SHEET);
  drivers.forEach((driver, index) => {
    const row = sheet.getRow(6 + index);
    row.getCell(2).value = `${driver.fullName.split(' ')[0][0]}. ${driver.fullName.split(' ').slice(1).join(' ')}`;
    row.getCell(4).value = index + 1;
    row.getCell(13).value = 0;
    row.getCell(14).value = index + 1;
    row.getCell(17).value = 0;
    row.getCell(18).value = 0;
    row.getCell(20).value = 0;
    row.getCell(23).value = 0;
    // Non-zero somewhere, or the sheet reads as an unraced template.
    row.getCell(24).value = index === 0 ? 25 : index;
    if (index < teams.length) {
      row.getCell(25).value = teams[index].name;
      row.getCell(26).value = 0;
      row.getCell(27).value = index;
    }
    row.commit();
  });
  await workbook.xlsx.writeFile(join(directory, name));
}

async function withWorkbookDir(run) {
  const directory = mkdtempSync(join(tmpdir(), 'mutation-gen-'));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const GENERATION_MUTATIONS = [
  {
    name: 'generation: a source that parses fewer than every seat',
    guard: 'sourceCompleteness',
    build: async (dir) => { await writeWorkbook(dir, 'partial.xlsx', { drivers: DRIVERS.slice(0, 5) }); },
  },
  {
    name: 'generation: a source with no internal timestamp metadata',
    guard: 'candidateProvenance',
    // ExcelJS stamps a date on write, so the absent-metadata case is injected at
    // the reader rather than faked in the file.
    build: async (dir) => { await writeWorkbook(dir, 'no-timestamp.xlsx'); },
    readWorkbookImpl: async (path) => {
      const loaded = new ExcelJS.Workbook();
      await loaded.xlsx.readFile(path);
      loaded.modified = undefined;
      loaded.created = undefined;
      return loaded;
    },
  },
  {
    name: 'generation: a source older than the one already recorded',
    guard: 'sourceRegression',
    build: async (dir) => { await writeWorkbook(dir, 'stale.xlsx', { modified: '2026-08-02T18:37:46Z' }); },
    previous: {
      provenance: {
        races: {
          [MONACO]: {
            workbook: 'master.xlsx',
            sha256: 'a'.repeat(64),
            workbookModified: '2026-08-03T16:49:11.000Z',
            sheet: FULL_SHEET,
          },
        },
      },
      races: {},
    },
  },
  {
    name: 'generation: coverage that has shrunk since the committed ledger',
    guard: 'coverageLoss',
    build: async (dir) => { await writeWorkbook(dir, 'current.xlsx'); },
    // The committed ledger covered a driver this run does not produce.
    previous: {
      provenance: {
        races: {
          [MONACO]: {
            workbook: 'older.xlsx',
            sha256: 'b'.repeat(64),
            workbookModified: '2026-08-01T00:00:00.000Z',
            sheet: FULL_SHEET,
          },
        },
      },
      races: { [MONACO]: { drivers: { 'ghost-driver': { total: 1 } }, teams: {} } },
    },
  },
  {
    name: 'generation: a previous ledger whose provenance is damaged',
    guard: 'previousProvenance',
    build: async (dir) => { await writeWorkbook(dir, 'current.xlsx'); },
    previous: {
      provenance: { races: { [MONACO]: { workbook: 'older.xlsx', sha256: 'nope', sheet: FULL_SHEET } } },
      races: { [MONACO]: { drivers: {}, teams: {} } },
    },
  },
];

test('generation accepts a complete, well-formed source', async () => {
  // The inverse again: without it these mutations could pass by rejecting
  // everything, including valid input.
  await withWorkbookDir(async (dir) => {
    await writeWorkbook(dir, 'good.xlsx');
    const { regressions } = await generateLedger({ workbookDir: dir });
    assert.deepEqual(regressions, []);
  });
});

for (const mutation of GENERATION_MUTATIONS) {
  test(`caught — ${mutation.name}`, async () => {
    await withWorkbookDir(async (dir) => {
      await mutation.build(dir);
      const result = await generateLedger({
        workbookDir: dir,
        previous: mutation.previous ?? null,
        ...(mutation.readWorkbookImpl ? { readWorkbookImpl: mutation.readWorkbookImpl } : {}),
      });
      assert.ok(result.regressions.length > 0, `mutation went undetected: ${mutation.name}`);
      const caught = GENERATION_GUARDS[mutation.guard](result);
      assert.ok(caught.length > 0, `${mutation.name}: expected guard "${mutation.guard}" to fire`);
    });
  });
}

test('every generation guard is pinned by at least one mutation', () => {
  const pinned = new Set(GENERATION_MUTATIONS.map((mutation) => mutation.guard));
  for (const guard of Object.keys(GENERATION_GUARDS)) {
    assert.ok(pinned.has(guard), `generation guard "${guard}" is not pinned by any mutation`);
  }
});
