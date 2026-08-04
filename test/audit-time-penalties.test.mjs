import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimePenaltyAuditReport,
  compareTimePenaltyLedgers,
} from '../scripts/audit-time-penalties.mjs';

const RACE = { id: 'canada', name: 'Canada', round: 7 };

test('audit matches served penalties by car, seconds, and reason', () => {
  const result = compareTimePenaltyLedgers(RACE, {
    fiaResults: { penaltySeconds: { 'nico-hulkenberg': 10 } },
    raceTimePenaltyMessages: [
      { message: 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 27 - SPEEDING IN THE PIT LANE' },
      { message: 'FIA STEWARDS: PENALTY SERVED - 5 SECOND TIME PENALTY FOR CAR 27 - SPEEDING IN THE PIT LANE' },
      { message: 'FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 27 - IGNORING BLUE FLAGS' },
    ],
  });

  assert.deepEqual(result.openf1Ledger, { 'nico-hulkenberg': 10 });
  assert.deepEqual(result.mismatches, []);
});

test('audit reports but does not replace an FIA footer disagreement', () => {
  const result = compareTimePenaltyLedgers({ id: 'monaco', name: 'Monaco', round: 8 }, {
    fiaResults: { penaltySeconds: {} },
    raceTimePenaltyMessages: [
      { message: 'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 63 - SPEEDING IN THE PIT LANE' },
    ],
  });
  const report = buildTimePenaltyAuditReport([result]);

  assert.deepEqual(result.mismatches, [{
    driverId: 'george-russell',
    driverName: 'George Russell',
    fiaSeconds: 0,
    openf1Seconds: 5,
  }]);
  assert.match(report, /FIA footer 0s; OpenF1 inference 5s/);
  assert.match(report, /No scoring data was changed/);
});
