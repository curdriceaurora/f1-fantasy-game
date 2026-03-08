import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRaceWeekend } from '../lib/openf1.js';

const calendarRace = {
  id: 'australia',
  name: 'Australian Grand Prix',
  date: '2026-03-08',
  round: 1,
  isSprintWeekend: false,
};

function baseFetchedRace() {
  return {
    meeting: { meeting_key: 1234 },
    sessions: {
      qualifying: { session_key: 11 },
      sprint: null,
      race: { session_key: 22 },
    },
    drivers: [
      { driver_number: 63, first_name: 'George', last_name: 'Russell', full_name: 'George Russell', team_name: 'Mercedes' },
      { driver_number: 12, first_name: 'Kimi', last_name: 'Antonelli', full_name: 'Kimi Antonelli', team_name: 'Mercedes' },
    ],
    raceResultRows: [
      { driver_number: 63, position: 2, dns: false, dsq: false, dnf: false },
      { driver_number: 12, position: 6, dns: false, dsq: false, dnf: false },
    ],
    qualifyingResultRows: [
      { driver_number: 63, position: 1 },
      { driver_number: 12, position: 5 },
    ],
    sprintResultRows: [],
    laps: [
      { driver_number: 63, lap_duration: 91.2, is_pit_out_lap: false },
      { driver_number: 12, lap_duration: 91.8, is_pit_out_lap: false },
    ],
    raceControlMessages: [
      { date: '2026-03-07T06:30:00Z', message: '5 PLACE GRID PENALTY FOR CAR 63' },
      { date: '2026-03-08T05:30:00Z', message: '5 SECOND TIME PENALTY FOR CAR 12' },
    ],
    positionFeed: [
      { driver_number: 63, position: 4, date: '2026-03-08T03:00:00Z' },
      { driver_number: 12, position: 5, date: '2026-03-08T03:00:00Z' },
      { driver_number: 63, position: 2, date: '2026-03-08T03:01:00Z' },
      { driver_number: 12, position: 6, date: '2026-03-08T03:01:00Z' },
    ],
  };
}

test('normalizeRaceWeekend applies grid and time penalties from aggregated race control messages', () => {
  const normalized = normalizeRaceWeekend(calendarRace, baseFetchedRace(), { drivers: {}, teams: {}, documents: [] });

  assert.equal(normalized.drivers['george-russell'].gridPenaltyPlaces, 5);
  assert.equal(normalized.drivers['george-russell'].gridStart, 4);
  assert.equal(normalized.drivers['kimi-antonelli'].timePenaltySeconds, 5);
  assert.equal(normalized.drivers['george-russell'].fastestLap, true);
});

test('normalizeRaceWeekend fails when official grid starts are unavailable', () => {
  const fetchedRace = baseFetchedRace();
  fetchedRace.positionFeed = [];

  assert.throws(
    () => normalizeRaceWeekend(calendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] }),
    /official race grid starts/,
  );
});
