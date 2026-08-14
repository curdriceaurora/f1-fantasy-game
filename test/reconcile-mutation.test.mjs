import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheck, scoredByRace, GUARDS, LEDGER_PATH, DIVERGENCE_PATH } from '../scripts/reconcile-martin.mjs';
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
function baseline() {
  return { ledger: structuredClone(REAL_LEDGER), scored: structuredClone(scoredByRace()) };
}

function check({ ledger, scored }) {
  return runCheck({ ledger, accepted: REAL_ACCEPTED, scored });
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
  // Making our value agree with Martin's is exactly that situation.
  mutations.push({
    name: 'scored: resolve an accepted divergence without removing its manifest entry',
    guard: 'resolved',
    apply: (state) => {
      const entry = REAL_ACCEPTED.divergences.find((divergence) => divergence.kind === 'driver' && divergence.field === 'total');
      state.scored[entry.race].drivers[entry.id].total = entry.martin;
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
