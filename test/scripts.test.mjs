import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../scripts/score-race.mjs';
import {
  compareTimePenaltyLedgers,
  buildTimePenaltyAuditReport,
  auditTimePenalties,
} from '../scripts/audit-time-penalties.mjs';
import { mulberry32, shuffle } from '../scripts/generate-test-corpus.mjs';

test('score-race parseArgs extracts --race argument cleanly', () => {
  const args1 = parseArgs(['--race', 'australia']);
  assert.deepStrictEqual(args1, { race: 'australia' });

  const args2 = parseArgs([]);
  assert.deepStrictEqual(args2, {});
});

test('generate-test-corpus mulberry32 & shuffle generate deterministic results', () => {
  const rng1 = mulberry32(12345);
  const val1 = rng1();
  const rng2 = mulberry32(12345);
  const val2 = rng2();
  assert.strictEqual(val1, val2);

  const arr = ['a', 'b', 'c', 'd', 'e'];
  const shuffled1 = shuffle(arr, 999);
  const shuffled2 = shuffle(arr, 999);
  assert.deepStrictEqual(shuffled1, shuffled2);
  assert.notDeepStrictEqual(shuffled1, arr);
});

test('audit-time-penalties compareTimePenaltyLedgers detects penalty mismatches', () => {
  const race = { name: 'Australian Grand Prix', round: 1 };
  const fetchedRace = {
    raceTimePenaltyMessages: [
      { date: '2026-03-08T06:00:00Z', message: '5 SECOND TIME PENALTY FOR CAR 63' },
    ],
    fiaResults: {
      penaltySeconds: { 'george-russell': 10 },
    },
  };

  const comparison = compareTimePenaltyLedgers(race, fetchedRace);
  assert.ok(comparison.mismatches);
  assert.strictEqual(comparison.mismatches.length, 1);
  assert.strictEqual(comparison.mismatches[0].fiaSeconds, 10);
  assert.strictEqual(comparison.mismatches[0].openf1Seconds, 5);

  const report = buildTimePenaltyAuditReport([comparison]);
  assert.ok(report.includes('Time-penalty source audit'));
  assert.ok(report.includes('Australian Grand Prix'));
});

test('auditTimePenalties executes cleanly on season fixtures', () => {
  const audit = auditTimePenalties();
  assert.ok(audit);
  assert.ok(Array.isArray(audit.results));
  assert.ok(Array.isArray(audit.failures));
  assert.strictEqual(typeof audit.report, 'string');
});
