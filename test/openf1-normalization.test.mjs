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

const sprintCalendarRace = {
  id: 'china',
  name: 'Chinese Grand Prix',
  date: '2026-03-15',
  round: 2,
  isSprintWeekend: true,
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
    gridPenaltyMessages: [
      { date: '2026-03-07T06:30:00Z', message: '5 PLACE GRID PENALTY FOR CAR 63' },
      { date: '2026-03-07T07:00:00Z', message: '10 SECOND TIME PENALTY FOR CAR 63' },
    ],
    raceTimePenaltyMessages: [
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

test('normalizeRaceWeekend applies grid penalties across the weekend but race time penalties only from the race session', () => {
  const normalized = normalizeRaceWeekend(calendarRace, baseFetchedRace(), { drivers: {}, teams: {}, documents: [] });

  assert.equal(normalized.drivers['george-russell'].gridPenaltyPlaces, 5);
  assert.equal(normalized.drivers['george-russell'].gridStart, 4);
  assert.equal(normalized.drivers['george-russell'].timePenaltySeconds, 0);
  assert.equal(normalized.drivers['kimi-antonelli'].timePenaltySeconds, 5);
  assert.equal(normalized.drivers['george-russell'].fastestLap, true);
});

test('retired drivers are classified after finishers, ordered by laps completed', () => {
  const fetchedRace = baseFetchedRace();
  fetchedRace.drivers.push({ driver_number: 44, first_name: 'Lewis', last_name: 'Hamilton', full_name: 'Lewis Hamilton', team_name: 'Ferrari' });
  // Russell finishes P1; Antonelli and Hamilton both retire with different lap counts.
  fetchedRace.raceResultRows = [
    { driver_number: 63, position: 1, dns: false, dsq: false, dnf: false, number_of_laps: 58 },
    { driver_number: 12, position: null, dns: false, dsq: false, dnf: true, number_of_laps: 40 },
    { driver_number: 44, position: null, dns: false, dsq: false, dnf: true, number_of_laps: 55 },
  ];
  fetchedRace.qualifyingResultRows.push({ driver_number: 44, position: 3 });
  fetchedRace.laps.push({ driver_number: 44, lap_duration: 92.5, is_pit_out_lap: false });
  fetchedRace.positionFeed.push({ driver_number: 44, position: 3, date: '2026-03-08T03:01:00Z' });

  const normalized = normalizeRaceWeekend(calendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] });

  assert.equal(normalized.drivers['george-russell'].racePosition, 1);
  // Hamilton did 55 laps, Antonelli 40 — Hamilton is classified P2, Antonelli P3.
  assert.equal(normalized.drivers['lewis-hamilton'].racePosition, 2);
  assert.equal(normalized.drivers['kimi-antonelli'].racePosition, 3);
});

test('FIA final classification and grid override OpenF1 when present', () => {
  const fetchedRace = baseFetchedRace();
  // OpenF1 says Russell P2 with a phantom time penalty; the FIA docs are the truth.
  fetchedRace.raceTimePenaltyMessages = [
    { date: '2026-03-08T05:30:00Z', message: '10 SECOND TIME PENALTY FOR CAR 63' },
  ];
  fetchedRace.fiaResults = {
    finishingPositions: { 'george-russell': 1, 'kimi-antonelli': 5 },
    gridPositions: { 'george-russell': 1, 'kimi-antonelli': 4 },
    penaltySeconds: {}, // FIA lists no penalty for Russell — the OpenF1 one is phantom
  };

  const normalized = normalizeRaceWeekend(calendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] });

  assert.equal(normalized.drivers['george-russell'].racePosition, 1);
  assert.equal(normalized.drivers['george-russell'].gridStart, 1);
  assert.equal(normalized.drivers['george-russell'].timePenaltySeconds, 0);
  assert.equal(normalized.drivers['kimi-antonelli'].racePosition, 5);
});

test('FIA sprint classification overrides OpenF1 sprint positions when present', () => {
  const fetchedRace = baseFetchedRace();
  fetchedRace.sessions.sprint = { session_key: 33 };
  // OpenF1 has the pre-penalty sprint order; the FIA final sprint classification wins.
  fetchedRace.sprintResultRows = [
    { driver_number: 63, position: 3 },
    { driver_number: 12, position: 2 },
  ];
  fetchedRace.fiaResults = {
    finishingPositions: {}, gridPositions: {}, penaltySeconds: {},
    sprintPositions: { 'george-russell': 1, 'kimi-antonelli': 4 },
  };

  const normalized = normalizeRaceWeekend(sprintCalendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] });

  assert.equal(normalized.drivers['george-russell'].sprintPosition, 1);
  assert.equal(normalized.drivers['kimi-antonelli'].sprintPosition, 4);
});

test('normalizeRaceWeekend fails when official grid starts are unavailable', () => {
  const fetchedRace = baseFetchedRace();
  fetchedRace.positionFeed = [];

  assert.throws(
    () => normalizeRaceWeekend(calendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] }),
    /official race grid starts/,
  );
});

test('a sprint weekend scores from the FIA sprint classification even when OpenF1 has no sprint rows', () => {
  const fetchedRace = baseFetchedRace();
  fetchedRace.sessions.sprint = { session_key: 33 };
  fetchedRace.sprintResultRows = []; // OpenF1 omits the sprint result
  fetchedRace.fiaResults = {
    finishingPositions: {}, gridPositions: {}, penaltySeconds: {},
    sprintPositions: { 'george-russell': 2, 'kimi-antonelli': 5 },
  };

  const normalized = normalizeRaceWeekend(sprintCalendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] });

  assert.equal(normalized.drivers['george-russell'].sprintPosition, 2);
  assert.equal(normalized.drivers['kimi-antonelli'].sprintPosition, 5);
});

test('normalizeRaceWeekend fails for sprint weekends when sprint results are missing', () => {
  const fetchedRace = baseFetchedRace();
  fetchedRace.sessions.sprint = { session_key: 33 };
  fetchedRace.sprintResultRows = [];

  assert.throws(
    () => normalizeRaceWeekend(sprintCalendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] }),
    /sprint results are missing/,
  );
});

test('normalizeRaceWeekend fails when lap feed cannot determine fastest lap', () => {
  const fetchedRace = baseFetchedRace();
  fetchedRace.laps = [];

  assert.throws(
    () => normalizeRaceWeekend(calendarRace, fetchedRace, { drivers: {}, teams: {}, documents: [] }),
    /cannot determine fastest lap/,
  );
});
