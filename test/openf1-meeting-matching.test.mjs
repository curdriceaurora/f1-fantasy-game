import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRaceWeekend } from '../lib/openf1.js';

// OpenF1 carries both 2026 Bahrain meetings: the April event that never ran and
// the October running of the same race at Sepang.
const BAHRAIN_MEETINGS = [
  { meeting_key: 1282, meeting_name: 'Bahrain Grand Prix', location: 'Sakhir', date_start: '2026-04-10T00:00:00+00:00' },
  { meeting_key: 1308, meeting_name: 'Bahrain Grand Prix', location: 'Kuala Lumpur', date_start: '2026-10-02T00:00:00+00:00' },
];

function stubOpenF1(meetings, { onSessions } = {}) {
  return async (url) => {
    const { pathname, searchParams } = new URL(url);
    const endpoint = pathname.split('/').pop();
    const json = (rows) => ({ ok: true, status: 200, json: async () => rows });

    if (endpoint === 'meetings') return json(meetings);
    if (endpoint === 'sessions') {
      onSessions?.(searchParams.get('meeting_key'));
      return json([
        { session_key: 900, session_type: 'Qualifying', session_name: 'Qualifying', date_start: '2026-10-03T00:00:00+00:00' },
        { session_key: 901, session_type: 'Race', session_name: 'Race', date_start: '2026-10-04T00:00:00+00:00' },
      ]);
    }
    if (endpoint === 'drivers') {
      return json([{ driver_number: 63, first_name: 'George', last_name: 'Russell', full_name: 'George Russell', team_name: 'Mercedes' }]);
    }
    if (endpoint === 'session_result') return json([{ driver_number: 63, position: 1, dns: false, dsq: false, dnf: false }]);
    if (endpoint === 'laps') return json([{ driver_number: 63, lap_duration: 90.1, is_pit_out_lap: false }]);
    if (endpoint === 'position') return json([{ driver_number: 63, position: 1, date: '2026-10-04T13:00:00+00:00' }]);
    if (endpoint === 'race_control') return json([]);
    throw new Error(`unexpected OpenF1 endpoint ${endpoint}`);
  };
}

async function withStubbedFetch(fetchImpl, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

test('a relocated race matches the meeting on its new date, not the one it was named for', async () => {
  const sessionsFor = [];

  const weekend = await withStubbedFetch(
    stubOpenF1(BAHRAIN_MEETINGS, { onSessions: (key) => sessionsFor.push(key) }),
    () => fetchRaceWeekend({
      id: 'bahrain',
      meetingName: 'Bahrain Grand Prix',
      date: '2026-10-04',
      status: 'rescheduled',
      originalDate: '2026-04-12',
    }),
  );

  assert.equal(weekend.meeting.meeting_key, 1308);
  assert.equal(weekend.meeting.location, 'Kuala Lumpur');
  assert.ok(sessionsFor.includes('1308'));
});

test('a same-named meeting months away is rejected instead of silently scored', async () => {
  await withStubbedFetch(
    stubOpenF1([BAHRAIN_MEETINGS[1]]),
    () => assert.rejects(
      () => fetchRaceWeekend({ id: 'bahrain', meetingName: 'Bahrain Grand Prix', date: '2026-04-12' }),
      /no "Bahrain Grand Prix" meeting near 2026-04-12 for bahrain; the closest is "Bahrain Grand Prix" starting 2026-10-02/,
    ),
  );
});

test('the OpenF1 name override selects a meeting the calendar names differently', async () => {
  const weekend = await withStubbedFetch(
    stubOpenF1([
      { meeting_key: 1287, meeting_name: 'Barcelona Grand Prix', location: 'Barcelona', date_start: '2026-06-12T00:00:00+00:00' },
      { meeting_key: 1294, meeting_name: 'Spanish Grand Prix', location: 'Madrid', date_start: '2026-09-11T00:00:00+00:00' },
    ]),
    () => fetchRaceWeekend({
      id: 'barcelona-catalunya',
      meetingName: 'Barcelona-Catalunya Grand Prix',
      date: '2026-06-14',
      sources: { openf1MeetingName: 'Barcelona Grand Prix' },
    }),
  );

  assert.equal(weekend.meeting.meeting_key, 1287);
});
