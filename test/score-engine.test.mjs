import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFantasyTeam } from '../lib/score-engine.js';

test('home circuit negative totals clamp to zero before the investment bonus is added', () => {
  const entry = {
    teamId: 'test-team',
    principalName: 'Test Principal',
    displayName: 'Test Entry',
    selectedDriverIds: ['george-russell'],
    selectedConstructorIds: ['mercedes'],
    homeCircuitId: 'australia',
    investmentBonusPerRace: 3,
  };

  const normalizedRace = {
    raceId: 'australia',
    raceName: 'Australian Grand Prix',
    date: '2026-03-08',
    drivers: {
      'george-russell': {
        qualifyingPosition: 20,
        sprintPosition: null,
        gridStart: 20,
        racePosition: null,
        fastestLap: false,
        gridPenaltyPlaces: 0,
        timePenaltySeconds: 0,
        finePoints: 0,
        classified: false,
      },
      'kimi-antonelli': {
        qualifyingPosition: 19,
        sprintPosition: null,
        gridStart: 19,
        racePosition: null,
        fastestLap: false,
        gridPenaltyPlaces: 0,
        timePenaltySeconds: 0,
        finePoints: 0,
        classified: false,
      },
    },
    teams: {
      mercedes: {
        teamId: 'mercedes',
        driverIds: ['george-russell', 'kimi-antonelli'],
        finePoints: 0,
      },
    },
  };

  const scored = scoreFantasyTeam(entry, normalizedRace);

  assert.equal(scored.homeCircuitApplied, true);
  assert.ok(scored.baseSubtotal < 0);
  assert.equal(scored.homeCircuitBonusPoints, -scored.baseSubtotal);
  assert.equal(scored.totalPoints, 3);
});

test('sprint positions are included in driver race totals on sprint weekends', () => {
  const entry = {
    teamId: 'test-team',
    principalName: 'Test Principal',
    displayName: 'Test Entry',
    selectedDriverIds: ['george-russell', 'kimi-antonelli'],
    selectedConstructorIds: [],
    homeCircuitId: 'japan',
    investmentBonusPerRace: 0,
  };

  const baseDrivers = {
    'george-russell': {
      qualifyingPosition: 4,
      sprintPosition: null,
      gridStart: 3,
      racePosition: 2,
      fastestLap: false,
      gridPenaltyPlaces: 0,
      timePenaltySeconds: 0,
      finePoints: 0,
      classified: true,
    },
    'kimi-antonelli': {
      qualifyingPosition: 8,
      sprintPosition: null,
      gridStart: 8,
      racePosition: 7,
      fastestLap: false,
      gridPenaltyPlaces: 0,
      timePenaltySeconds: 0,
      finePoints: 0,
      classified: true,
    },
  };

  const withoutSprint = scoreFantasyTeam(entry, {
    raceId: 'china',
    raceName: 'Chinese Grand Prix',
    date: '2026-03-15',
    drivers: structuredClone(baseDrivers),
    teams: {},
  });

  const withSprint = scoreFantasyTeam(entry, {
    raceId: 'china',
    raceName: 'Chinese Grand Prix',
    date: '2026-03-15',
    drivers: {
      ...structuredClone(baseDrivers),
      'george-russell': { ...baseDrivers['george-russell'], sprintPosition: 2 },
      'kimi-antonelli': { ...baseDrivers['kimi-antonelli'], sprintPosition: 12 },
    },
    teams: {},
  });

  assert.equal(withSprint.totalPoints - withoutSprint.totalPoints, 7);
  const georgeComponents = withSprint.drivers.find((driver) => driver.driverId === 'george-russell')?.components || [];
  const kimiComponents = withSprint.drivers.find((driver) => driver.driverId === 'kimi-antonelli')?.components || [];
  assert.ok(georgeComponents.some((component) => component.label === 'Sprint P2' && component.points === 7));
  assert.ok(kimiComponents.some((component) => component.label === 'Sprint P12' && component.points === 0));
});
