import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFantasyTeam, buildConstructorContribution, buildDriverContribution } from '../lib/score-engine.js';

test('qualifying points use the grid position at the start, not the qualifying result', () => {
  // Russell (Contender) qualifies P5 but takes a grid penalty and starts P12.
  const contribution = buildDriverContribution('george-russell', {
    qualifyingPosition: 5, gridStart: 12, racePosition: 12, sprintPosition: null,
    fastestLap: false, gridPenaltyPlaces: 0, timePenaltySeconds: 0, finePoints: 0, classified: true,
  }, { raceId: 'x', raceName: 'X' });
  const quali = contribution.components.find((c) => /Qualifying/.test(c.label));
  // Grid P12 is the 11th-14th band (-4 for a Contender), not P5's 2nd-5th (0).
  assert.equal(quali.points, -4);
});

test('position change scores from the improvement baseline (qualifying DSQ), not the real grid start', () => {
  // Verstappen (Champion) was disqualified in qualifying: real grid P20, but the
  // improvement baseline is the last grid slot (22). He finishes P6.
  const contribution = buildDriverContribution('max-verstappen', {
    qualifyingPosition: null, gridStart: 20, improvementGrid: 22, racePosition: 6, sprintPosition: null,
    fastestLap: false, gridPenaltyPlaces: 0, timePenaltySeconds: 0, finePoints: 0, classified: true,
  }, { raceId: 'australia', raceName: 'Australia' });
  const positionChange = contribution.components.find((c) => /^Position change/.test(c.label));
  assert.equal(positionChange.points, (22 - 6) * 2); // 32, not (20 - 6) * 2 = 28
  // The exceptional baseline is labelled and preserved so the artifact self-reconciles.
  assert.equal(positionChange.label, 'Position change (from P22)');
  assert.equal(contribution.improvementGrid, 22);
  assert.equal(contribution.gridStart, 20);
});

test('position change falls back to the grid start when no improvement baseline is set', () => {
  const contribution = buildDriverContribution('max-verstappen', {
    qualifyingPosition: null, gridStart: 4, racePosition: 1, sprintPosition: null,
    fastestLap: false, gridPenaltyPlaces: 0, timePenaltySeconds: 0, finePoints: 0, classified: true,
  }, { raceId: 'x', raceName: 'X' });
  const positionChange = contribution.components.find((c) => c.label === 'Position change');
  assert.equal(positionChange.points, (4 - 1) * 2);
  assert.equal(contribution.improvementGrid, 4);
});

test('a race DSQ keeps qualifying points and scores the position loss from last place', () => {
  const contribution = buildDriverContribution('george-russell', {
    qualifyingPosition: 1, gridStart: 1, improvementGrid: 1, racePosition: 22, sprintPosition: 22,
    fastestLap: false, gridPenaltyPlaces: 0, timePenaltySeconds: 0, finePoints: 0, classified: false,
  }, { raceId: 'x', raceName: 'X' });

  assert.equal(contribution.components.find((c) => /^Qualifying/.test(c.label)).points, 3);
  assert.equal(contribution.components.find((c) => /^Sprint/.test(c.label)).points, 0);
  assert.equal(contribution.components.find((c) => /^Race finish/.test(c.label)).points, 0);
  assert.equal(contribution.components.find((c) => /^Position change/.test(c.label)).points, -42);
});

test('constructor weighting favours the roster lead driver, not the higher scorer that race', () => {
  // Ferrari's designated lead is Leclerc; Hamilton outscored him this race.
  const contribution = buildConstructorContribution(
    'ferrari',
    { driverIds: ['charles-leclerc', 'lewis-hamilton'], finePoints: 0 },
    [
      { driverId: 'charles-leclerc', name: 'Charles Leclerc', totalPoints: -23 },
      { driverId: 'lewis-hamilton', name: 'Lewis Hamilton', totalPoints: 23 },
    ],
  );

  // 3×lead(Leclerc -23) + 2×second(Hamilton 23) = -23; ceil(-23/5) = -4.
  assert.equal(contribution.weightingBreakdown.leadDriverId, 'charles-leclerc');
  assert.equal(contribution.totalPoints, -4);
});

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
