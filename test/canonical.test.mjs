import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_DRIVERS,
  CANONICAL_TEAMS,
  CAR_NUMBER_DRIVER_MAP,
  displayDriverName,
  displayTeamName,
  driverById,
  normalizeText,
  resolveCircuitId,
  resolveDriver,
  resolveDriverByCarNumber,
  resolveTeam,
  teamById,
} from '../lib/canonical.js';

test('canonical driver and team rosters are non-empty and well-formed', () => {
  assert.equal(CANONICAL_DRIVERS.length, 22);
  assert.equal(CANONICAL_TEAMS.length, 11);

  for (const driver of CANONICAL_DRIVERS) {
    assert.ok(driver.id);
    assert.ok(driver.fullName);
    assert.ok(driver.rank);
    assert.ok(driver.imageSlug);
    assert.ok(driver.aliases instanceof Set);
  }

  for (const team of CANONICAL_TEAMS) {
    assert.ok(team.id);
    assert.ok(team.name);
    assert.ok(team.imageSlug);
    assert.ok(team.aliases instanceof Set);
  }
});

test('normalizeText cleans and normalizes strings consistently', () => {
  assert.equal(normalizeText('  Max Verstappen  '), 'max verstappen');
  assert.equal(normalizeText('Oracle Red Bull Racing'), 'oracle red bull racing');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});

test('driverById returns canonical driver or null', () => {
  const verstappen = driverById('max-verstappen');
  assert.ok(verstappen);
  assert.equal(verstappen.fullName, 'Max Verstappen');

  const unknown = driverById('unknown-driver-id');
  assert.equal(unknown, null);
});

test('teamById returns canonical team or null', () => {
  const ferrari = teamById('ferrari');
  assert.ok(ferrari);
  assert.equal(ferrari.name, 'Ferrari');

  const unknown = teamById('unknown-team-id');
  assert.equal(unknown, null);
});

test('resolveDriver handles exact names, aliases, and unknown strings', () => {
  const driverByName = resolveDriver('Lewis Hamilton');
  assert.ok(driverByName);
  assert.equal(driverByName.id, 'lewis-hamilton');

  const driverByAlias = resolveDriver('HAM');
  assert.ok(driverByAlias);
  assert.equal(driverByAlias.id, 'lewis-hamilton');

  const unknown = resolveDriver('Non-Existent Driver 99');
  assert.equal(unknown, null);
});

test('resolveTeam handles exact names, aliases, and unknown strings', () => {
  const teamByName = resolveTeam('Mercedes');
  assert.ok(teamByName);
  assert.equal(teamByName.id, 'mercedes');

  const teamByAlias = resolveTeam('Mercedes-AMG Petronas');
  assert.ok(teamByAlias);
  assert.equal(teamByAlias.id, 'mercedes');

  const unknown = resolveTeam('Non-Existent Constructor 99');
  assert.equal(unknown, null);
});

test('resolveCircuitId matches known circuits and returns null for unknown', () => {
  assert.equal(resolveCircuitId('Australia'), 'australia');
  assert.equal(resolveCircuitId('Monaco'), 'monaco');
  assert.equal(resolveCircuitId('Britain'), 'great-britain');
  assert.equal(resolveCircuitId('Great Britain'), 'great-britain');
  assert.equal(resolveCircuitId('Unknown Circuit Location'), null);
});



test('displayDriverName returns fullName for known drivers and fallback id for unknown', () => {
  assert.equal(displayDriverName('charles-leclerc'), 'Charles Leclerc');
  assert.equal(displayDriverName('custom-driver-id'), 'custom-driver-id');
});

test('displayTeamName returns name for known teams and fallback id for unknown', () => {
  assert.equal(displayTeamName('mclaren'), 'McLaren');
  assert.equal(displayTeamName('custom-team-id'), 'custom-team-id');
});

test('resolveDriverByCarNumber resolves valid car numbers and returns null for unmapped', () => {
  for (const [numberStr, expectedId] of Object.entries(CAR_NUMBER_DRIVER_MAP)) {
    const resolved = resolveDriverByCarNumber(numberStr);
    assert.ok(resolved, `Car number ${numberStr} should resolve`);
    assert.equal(resolved.id, expectedId);
  }

  assert.equal(resolveDriverByCarNumber(0), null);
  assert.equal(resolveDriverByCarNumber(99), null);
  assert.equal(resolveDriverByCarNumber('invalid'), null);
});
