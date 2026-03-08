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
