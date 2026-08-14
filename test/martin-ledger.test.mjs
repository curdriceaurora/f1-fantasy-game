import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareToLedger, detectSourceRegression, ledgerBody, validateProvenance,
} from '../lib/martin-ledger.js';

const ledger = {
  provenance: { races: { monaco: { workbook: 'master.xlsx', sha256: 'aaa', workbookModified: '2026-08-03T16:49:11Z', sheet: 'Race 8' } } },
  races: {
    monaco: {
      drivers: {
        'alex-albon': { total: 7, grid: 11 },
        'pierre-gasly': { total: 11, grid: 10 },
      },
      teams: { williams: { total: -3 } },
    },
  },
};

const accepted = {
  divergences: [
    { race: 'monaco', kind: 'driver', id: 'pierre-gasly', field: 'total', ours: 9, martin: 11, issue: '#84 Q1', reason: 'pit-lane rule unknown' },
    { race: 'monaco', kind: 'driver', id: 'pierre-gasly', field: 'grid', ours: 9, martin: 10, issue: '#84 Q1', reason: 'pit-lane rule unknown' },
  ],
};

test('compareToLedger is silent when our scores match Martin, allowing for accepted gaps', () => {
  const scored = { monaco: { drivers: { 'alex-albon': { total: 7, grid: 11 }, 'pierre-gasly': { total: 9, grid: 9 } }, teams: { williams: { total: -3 } } } };
  const result = compareToLedger(scored, ledger, accepted);
  assert.deepEqual(result.unexplained, []);
  assert.deepEqual(result.resolved, []);
});

test('compareToLedger reports a score that drifts away from Martin', () => {
  const scored = { monaco: { drivers: { 'alex-albon': { total: 10, grid: 11 }, 'pierre-gasly': { total: 9, grid: 9 } }, teams: { williams: { total: -3 } } } };
  const result = compareToLedger(scored, ledger, accepted);
  assert.equal(result.unexplained.length, 1);
  assert.deepEqual(result.unexplained[0], { race: 'monaco', kind: 'driver', id: 'alex-albon', field: 'total', ours: 10, martin: 7 });
});

test('compareToLedger reports an accepted divergence that has been fixed, so the manifest can shrink', () => {
  // Gasly now agrees. The manifest entry is stale and must be removed, or it
  // silently masks a future regression on the same driver.
  const scored = { monaco: { drivers: { 'alex-albon': { total: 7, grid: 11 }, 'pierre-gasly': { total: 11, grid: 10 } }, teams: { williams: { total: -3 } } } };
  const result = compareToLedger(scored, ledger, accepted);
  assert.deepEqual(result.unexplained, []);
  assert.equal(result.resolved.length, 2);
  assert.equal(result.resolved[0].id, 'pierre-gasly');
});

test('compareToLedger does not let an accepted entry excuse a different value than the one recorded', () => {
  // The manifest accepts ours=9 against martin=11. Scoring 4 is a new bug, not
  // the known gap, and must not be swallowed.
  const scored = { monaco: { drivers: { 'alex-albon': { total: 7, grid: 11 }, 'pierre-gasly': { total: 4, grid: 9 } }, teams: { williams: { total: -3 } } } };
  const result = compareToLedger(scored, ledger, accepted);
  assert.equal(result.unexplained.length, 1);
  assert.equal(result.unexplained[0].id, 'pierre-gasly');
  assert.equal(result.unexplained[0].field, 'total');
  assert.equal(result.unexplained[0].ours, 4);
});

test('compareToLedger flags a race the ledger covers but our artifacts do not', () => {
  const result = compareToLedger({}, ledger, accepted);
  assert.equal(result.missingRaces.length, 1);
  assert.equal(result.missingRaces[0], 'monaco');
});

test('detectSourceRegression rejects a workbook older than the one already recorded', () => {
  // #79 in automated form: a reissued file can predate the master it supersedes,
  // which neither the filename nor the email date reveals.
  const next = { races: { monaco: { workbook: 'monaco-updated.xlsx', sha256: 'bbb', workbookModified: '2026-08-02T18:37:46Z', sheet: 'Race 8' } } };
  const regressions = detectSourceRegression(ledger.provenance, next);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0].message, /older/i);
});

test('detectSourceRegression accepts a newer workbook for the same race', () => {
  const next = { races: { monaco: { workbook: 'monaco-final.xlsx', sha256: 'ccc', workbookModified: '2026-08-20T09:00:00Z', sheet: 'Race 8' } } };
  assert.deepEqual(detectSourceRegression(ledger.provenance, next), []);
});

test('detectSourceRegression ignores a race the previous ledger did not cover', () => {
  const next = { races: { spain: { workbook: 'master.xlsx', sha256: 'aaa', workbookModified: '2026-08-03T16:49:11Z', sheet: 'Race 9' } } };
  assert.deepEqual(detectSourceRegression(ledger.provenance, next), []);
});

test('ledgerBody excludes provenance so regeneration from the same workbook is a no-op diff', () => {
  const a = ledgerBody({ ...ledger, generatedAt: '2026-08-12T00:00:00Z' });
  const b = ledgerBody({ ...ledger, generatedAt: '2026-09-01T00:00:00Z' });
  assert.equal(a, b);
});

test('ledgerBody orders keys stably so a rebuild does not diff on ordering alone', () => {
  const shuffled = {
    races: {
      monaco: {
        teams: { williams: { total: -3 } },
        drivers: {
          'pierre-gasly': { grid: 10, total: 11 },
          'alex-albon': { grid: 11, total: 7 },
        },
      },
    },
  };
  assert.equal(ledgerBody(shuffled), ledgerBody(ledger));
});

test('compareToLedger fails on a scored race the ledger does not cover', () => {
  // The set comparison must run both ways. Iterating only over ledger races means
  // the next completed round can be scored and published while the ledger still
  // predates it, and reconciliation stays green on stale coverage.
  const scored = {
    monaco: { drivers: { 'alex-albon': { total: 7, grid: 11 }, 'pierre-gasly': { total: 9, grid: 9 } }, teams: { williams: { total: -3 } } },
    spain: { drivers: { 'carlos-sainz': { total: 12, grid: 4 } }, teams: { williams: { total: 8 } } },
  };
  const result = compareToLedger(scored, ledger, accepted);
  assert.deepEqual(result.unledgeredRaces, ['spain']);
});

test('compareToLedger is silent when the ledger and the scored races match exactly', () => {
  const scored = { monaco: { drivers: { 'alex-albon': { total: 7, grid: 11 }, 'pierre-gasly': { total: 9, grid: 9 } }, teams: { williams: { total: -3 } } } };
  assert.deepEqual(compareToLedger(scored, ledger, accepted).unledgeredRaces, []);
});

// The three mutations below all add something to the scored side. Comparison
// walked ledger -> scored, so anything present only on our side was invisible:
// a new seat, a new constructor, or a new scoring input could be introduced and
// never compared against Martin at all.
const fullLedger = { races: { monaco: { drivers: { a: { total: 1 } }, teams: { t: { total: 2 } } } } };

test('compareToLedger reports a scored driver the ledger does not have', () => {
  const scored = { monaco: { drivers: { a: { total: 1 }, 'reserve-driver': { total: 5 } }, teams: { t: { total: 2 } } } };
  const result = compareToLedger(scored, fullLedger, { divergences: [] });
  assert.equal(result.unmatched.length, 1);
  assert.deepEqual(result.unmatched[0], { race: 'monaco', kind: 'driver', id: 'reserve-driver', field: null });
});

test('compareToLedger reports a scored constructor the ledger does not have', () => {
  const scored = { monaco: { drivers: { a: { total: 1 } }, teams: { t: { total: 2 }, 'reserve-team': { total: 9 } } } };
  const result = compareToLedger(scored, fullLedger, { divergences: [] });
  assert.deepEqual(result.unmatched[0], { race: 'monaco', kind: 'team', id: 'reserve-team', field: null });
});

test('compareToLedger reports a scored field the ledger does not carry', () => {
  // A new scoring input must be added to the ledger too, or it is computed and
  // published without ever being checked against Martin.
  const scored = { monaco: { drivers: { a: { total: 1, newScoreInput: 3 } }, teams: { t: { total: 2 } } } };
  const result = compareToLedger(scored, fullLedger, { divergences: [] });
  assert.deepEqual(result.unmatched[0], { race: 'monaco', kind: 'driver', id: 'a', field: 'newScoreInput' });
});

test('compareToLedger is silent when both sides carry exactly the same shape', () => {
  const scored = { monaco: { drivers: { a: { total: 1 } }, teams: { t: { total: 2 } } } };
  assert.deepEqual(compareToLedger(scored, fullLedger, { divergences: [] }).unmatched, []);
});

// Provenance is the other half of the artifact. The score projections are fully
// validated, but the record of *which Martin we read* was trusted unchecked —
// and it is what detectSourceRegression depends on, so deleting a race's entry
// silently disables stale-source protection for that race.
const provenanceLedger = {
  provenance: {
    races: {
      monaco: {
        workbook: 'master.xlsx',
        sha256: 'a'.repeat(64),
        workbookModified: '2026-08-03T16:49:11.000Z',
        sheet: 'Race 8',
      },
    },
  },
  races: { monaco: { drivers: {}, teams: {} } },
};

test('validateProvenance accepts a well-formed entry', () => {
  assert.deepEqual(validateProvenance(provenanceLedger), []);
});

test('validateProvenance rejects a ledger with no provenance at all', () => {
  const problems = validateProvenance({ races: { monaco: { drivers: {}, teams: {} } } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no provenance/i);
});

test('validateProvenance rejects a race whose provenance entry was removed', () => {
  // The consequential one: with monaco's entry gone, detectSourceRegression has
  // nothing to compare against and an older source would be accepted.
  const ledger = structuredClone(provenanceLedger);
  delete ledger.provenance.races.monaco;
  assert.match(validateProvenance(ledger).join(' '), /monaco: scored in the ledger but has no provenance/);
});

test('validateProvenance rejects provenance for a race the ledger does not carry', () => {
  const ledger = structuredClone(provenanceLedger);
  ledger.provenance.races.spain = { ...ledger.provenance.races.monaco, sheet: 'Race 16' };
  assert.match(validateProvenance(ledger).join(' '), /spain: has provenance but no race data/);
});

test('validateProvenance rejects a missing or malformed sha256', () => {
  const missing = structuredClone(provenanceLedger);
  delete missing.provenance.races.monaco.sha256;
  assert.match(validateProvenance(missing).join(' '), /sha256/);

  const malformed = structuredClone(provenanceLedger);
  malformed.provenance.races.monaco.sha256 = 'not-a-hash';
  assert.match(validateProvenance(malformed).join(' '), /sha256/);
});

test('validateProvenance rejects a missing or unparseable workbookModified', () => {
  const missing = structuredClone(provenanceLedger);
  delete missing.provenance.races.monaco.workbookModified;
  assert.match(validateProvenance(missing).join(' '), /workbookModified/);

  const malformed = structuredClone(provenanceLedger);
  malformed.provenance.races.monaco.workbookModified = 'sometime last week';
  assert.match(validateProvenance(malformed).join(' '), /workbookModified/);
});

test('validateProvenance rejects a missing workbook name', () => {
  const ledger = structuredClone(provenanceLedger);
  delete ledger.provenance.races.monaco.workbook;
  assert.match(validateProvenance(ledger).join(' '), /workbook/);
});

test('validateProvenance rejects a sheet that is not the one that race lives on', () => {
  // Monaco is Martin's Race 8. A provenance entry citing another sheet means the
  // ledger was built from the wrong data even if every value looks plausible.
  const ledger = structuredClone(provenanceLedger);
  ledger.provenance.races.monaco.sheet = 'Race 9';
  assert.match(validateProvenance(ledger).join(' '), /sheet "Race 9".*expected "Race 8"/);
});

test('compareToLedger marks unexplained when scored race omits a driver present in ledger', () => {
  const testLedger = {
    races: {
      monaco: {
        drivers: {
          'alex-albon': { total: 7, grid: 10, finish: 10, fineEuros: 0, gridPenalty: 0, timePenalty: 0, sprintPoints: 0, fastestLapPoints: 0 },
        },
        teams: {},
      },
    },
  };
  const scored = {
    monaco: {
      drivers: {}, // alex-albon missing
      teams: {},
    },
  };
  const result = compareToLedger(scored, testLedger, { divergences: [] });
  assert.ok(result.unexplained.length > 0);
  assert.equal(result.unexplained[0].id, 'alex-albon');
  assert.equal(result.unexplained[0].ours, null);
  assert.equal(result.unexplained[0].martin, 7);
});

test('validateProvenance flags missing and orphaned provenance entries', () => {
  const missingRaceProv = structuredClone(provenanceLedger);
  delete missingRaceProv.provenance.races.monaco;
  assert.match(validateProvenance(missingRaceProv).join(' '), /scored in the ledger but has no provenance entry/);

  const orphanRaceProv = structuredClone(provenanceLedger);
  orphanRaceProv.provenance.races.spain = { workbook: 'spain.xlsx', sha256: 'a'.repeat(64), workbookModified: '2026-08-01T00:00:00Z', sheet: 'Race 9' };
  assert.match(validateProvenance(orphanRaceProv).join(' '), /has provenance but no race data in the ledger/);
});

test('compareToLedger finds unmatched fields present in scored data but missing in ledger', () => {
  const testLedger = {
    races: {
      monaco: {
        drivers: {
          'alex-albon': { total: 7 },
        },
        teams: {},
      },
    },
  };
  const scored = {
    monaco: {
      drivers: {
        'alex-albon': { total: 7, extraField: 99 },
      },
      teams: {},
    },
  };
  const result = compareToLedger(scored, testLedger, { divergences: [] });
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].field, 'extraField');
});

test('validateProvenance handles null ledger and ledgerBody sorts nested objects', () => {
  assert.match(validateProvenance(null).join(' '), /the ledger has no provenance/);

  const customLedger = {
    races: {
      monaco: {
        drivers: {
          'alex-albon': {
            z_field: { b: 2, a: 1 },
            a_field: 10,
          },
        },
        teams: {},
      },
    },
  };
  const body = ledgerBody(customLedger);
  assert.ok(body.indexOf('"a_field"') < body.indexOf('"z_field"'));
});




