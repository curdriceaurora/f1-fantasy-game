import test from 'node:test';
import assert from 'node:assert/strict';
import { compareToLedger, detectSourceRegression, ledgerBody } from '../lib/martin-ledger.js';

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
