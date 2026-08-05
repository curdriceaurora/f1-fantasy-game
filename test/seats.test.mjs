import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_SEATS,
  inferRaceSeatOccupants,
  resolveSeatOccupants,
  seatForDriver,
  seatsForTeam,
  validateSeatOccupantOverrides,
} from '../lib/seats.js';

test('canonical roster maps every driver to one of two team seats', () => {
  assert.equal(CANONICAL_SEATS.length, 22);
  assert.equal(new Set(CANONICAL_SEATS.map((seat) => seat.id)).size, 22);
  assert.equal(seatsForTeam('mercedes').length, 2);
  assert.equal(seatForDriver('george-russell').id, 'mercedes:1');
  assert.equal(seatForDriver('isack-hadjar').teamId, 'red-bull');
  assert.equal(seatForDriver('liam-lawson').teamId, 'racing-bulls');
});

test('seat occupants resolve independently for qualifying, sprint, and race', () => {
  const resolved = resolveSeatOccupants('george-russell', {
    'mercedes:1': {
      sprint: 'kimi-antonelli',
      race: 'reserve-driver',
    },
  });

  assert.deepEqual(resolved.occupants, {
    qualifying: 'george-russell',
    sprint: 'kimi-antonelli',
    race: 'reserve-driver',
  });
});

test('a single constructor-lineup change follows the missing roster seat', () => {
  const inferred = inferRaceSeatOccupants({
    'red-bull': { driverIds: ['max-verstappen', 'reserve-driver'] },
    'racing-bulls': { driverIds: ['liam-lawson', 'arvid-lindblad'] },
  }, {}, 'australia');

  assert.equal(inferred['red-bull:1'], 'max-verstappen');
  assert.equal(inferred['red-bull:2'], 'reserve-driver');
  assert.equal(inferred['racing-bulls:1'], 'liam-lawson');
  assert.equal(inferred['racing-bulls:2'], 'arvid-lindblad');
});

test('seat overrides fail loudly for unknown occupants and unresolved empty seats', () => {
  assert.throws(
    () => validateSeatOccupantOverrides(
      { 'mercedes:1': { race: 'missing-reserve' } },
      ['george-russell'],
      'test-race',
    ),
    /unavailable race occupant/,
  );
  assert.throws(
    () => validateSeatOccupantOverrides(
      { 'mercedes:1': { race: null } },
      ['george-russell'],
      'test-race',
    ),
    /empty-seat scoring is blocked pending Martin's ruling/,
  );
});

test('two simultaneous replacements require explicit seat mappings', () => {
  assert.throws(
    () => inferRaceSeatOccupants(
      { mercedes: { driverIds: ['reserve-one', 'reserve-two'] } },
      {},
      'test-race',
    ),
    /Cannot unambiguously resolve mercedes seat changes/,
  );
});
