import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { normalizeRaceWeekend } from '../lib/openf1.js';
import { reserveByCarNumber, reserveByName, resolveReserve } from '../lib/reserves.js';

function withReserves(reserves, callback) {
  const root = mkdtempSync(join(tmpdir(), 'f1-reserves-'));
  const seasonDir = join(root, 'season');
  mkdirSync(join(seasonDir, 'config'), { recursive: true });
  writeFileSync(join(seasonDir, 'config', 'reserve-drivers.json'), JSON.stringify({ reserves }));
  const previous = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = seasonDir;
  try {
    return callback();
  } finally {
    if (previous == null) delete process.env.F1_FANTASY_SEASON_DIR;
    else process.env.F1_FANTASY_SEASON_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

const TSUNODA = { id: 'yuki-tsunoda', fullName: 'Yuki Tsunoda', driverNumber: 22, teamName: 'Racing Bulls' };

test('a reserve is found by car number and by name', () => {
  withReserves([TSUNODA], () => {
    assert.equal(reserveByCarNumber(22).id, 'yuki-tsunoda');
    assert.equal(reserveByCarNumber('22').id, 'yuki-tsunoda');
    assert.equal(reserveByName('Yuki Tsunoda').id, 'yuki-tsunoda');
    assert.equal(resolveReserve({ driver_number: 22 }).id, 'yuki-tsunoda');
    assert.equal(resolveReserve({ first_name: 'Yuki', last_name: 'Tsunoda' }).id, 'yuki-tsunoda');
  });
});

test('an unconfigured driver matches no reserve', () => {
  withReserves([TSUNODA], () => {
    assert.equal(reserveByCarNumber(99), null);
    assert.equal(reserveByCarNumber('not-a-number'), null);
    assert.equal(reserveByName('Someone Else'), null);
    assert.equal(reserveByName(''), null);
    assert.equal(resolveReserve({}), null);
  });
});

function weekendWithCar22() {
  return {
    meeting: { meeting_key: 1 },
    sessions: { qualifying: { session_key: 11 }, sprint: null, race: { session_key: 22 } },
    drivers: [
      { driver_number: 41, first_name: 'Arvid', last_name: 'Lindblad', full_name: 'Arvid Lindblad', team_name: 'Racing Bulls' },
      { driver_number: 22, first_name: 'Yuki', last_name: 'Tsunoda', full_name: 'Yuki Tsunoda', team_name: 'Racing Bulls' },
    ],
    raceResultRows: [
      { driver_number: 41, position: 12, dns: false, dsq: false, dnf: false },
      { driver_number: 22, position: 11, dns: false, dsq: false, dnf: false },
    ],
    qualifyingResultRows: [{ driver_number: 41, position: 10 }, { driver_number: 22, position: 12 }],
    sprintResultRows: [],
    laps: [
      { driver_number: 41, lap_duration: 91.5, is_pit_out_lap: false },
      { driver_number: 22, lap_duration: 91.9, is_pit_out_lap: false },
    ],
    gridPenaltyMessages: [],
    raceTimePenaltyMessages: [],
    positionFeed: [
      { driver_number: 41, position: 10, date: '2026-08-23T13:00:00Z' },
      { driver_number: 22, position: 12, date: '2026-08-23T13:00:00Z' },
    ],
  };
}

const RACE = { id: 'netherlands', name: 'Dutch Grand Prix', date: '2026-08-23', round: 12, isSprintWeekend: false };

test('a configured reserve enters the weekend under their own id', () => {
  withReserves([TSUNODA], () => {
    const normalized = normalizeRaceWeekend(RACE, weekendWithCar22());
    const reserve = normalized.drivers['yuki-tsunoda'];

    assert.ok(reserve, 'the reserve is admitted rather than rejected');
    assert.equal(reserve.reserve, true);
    assert.equal(reserve.name, 'Yuki Tsunoda');
    assert.equal(reserve.racePosition, 11);
    // The seat owner is absent, which is what lets seat inference see the change.
    assert.equal(normalized.drivers['liam-lawson'], undefined);
    assert.deepEqual(normalized.teams['racing-bulls'].driverIds, ['arvid-lindblad', 'yuki-tsunoda']);
  });
});

test('a driver who is neither on the roster nor configured still stops the run', () => {
  withReserves([], () => {
    assert.throws(
      () => normalizeRaceWeekend(RACE, weekendWithCar22()),
      /Unable to map OpenF1 driver "Yuki Tsunoda" to canonical constants or a configured reserve/,
    );
  });
});
