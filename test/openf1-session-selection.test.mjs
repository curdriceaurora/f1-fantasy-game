import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWeekendSessions } from '../lib/openf1.js';

test('selectWeekendSessions chooses main race/qualifying over sprint variants', () => {
  const sessions = [
    { session_key: 11235, session_type: 'Practice', session_name: 'Practice 1', date_start: '2026-03-13T03:30:00+00:00' },
    { session_key: 11236, session_type: 'Qualifying', session_name: 'Sprint Qualifying', date_start: '2026-03-13T07:30:00+00:00' },
    { session_key: 11240, session_type: 'Race', session_name: 'Sprint', date_start: '2026-03-14T03:00:00+00:00' },
    { session_key: 11241, session_type: 'Qualifying', session_name: 'Qualifying', date_start: '2026-03-14T07:00:00+00:00' },
    { session_key: 11245, session_type: 'Race', session_name: 'Race', date_start: '2026-03-15T07:00:00+00:00' },
  ];

  const picked = selectWeekendSessions(sessions);

  assert.equal(picked.qualifyingSession?.session_key, 11241);
  assert.equal(picked.sprintSession?.session_key, 11240);
  assert.equal(picked.raceSession?.session_key, 11245);
});

test('selectWeekendSessions falls back to latest race session when names are non-standard', () => {
  const sessions = [
    { session_key: 2001, session_type: 'Race', session_name: 'Feature Race', date_start: '2026-05-05T10:00:00+00:00' },
    { session_key: 2002, session_type: 'Race', session_name: 'Main Event', date_start: '2026-05-06T10:00:00+00:00' },
  ];

  const picked = selectWeekendSessions(sessions);
  assert.equal(picked.raceSession?.session_key, 2002);
});
