import test from 'node:test';
import assert from 'node:assert/strict';
import { eventDocumentsPage, fetchFiaDecisionUrls, fiaEventName, meetingToFiaSlug } from '../lib/fia-documents.js';
import { openf1MeetingName } from '../lib/openf1.js';

// The June race is FIA's "Barcelona-Catalunya Grand Prix", OpenF1's "Barcelona
// Grand Prix", and nobody's "Spanish Grand Prix" — that name belongs to the
// September round in Madrid.
const BARCELONA = {
  id: 'barcelona-catalunya',
  meetingName: 'Barcelona-Catalunya Grand Prix',
  date: '2026-06-14',
  sources: {
    openf1MeetingName: 'Barcelona Grand Prix',
    fiaEventName: 'Barcelona-Catalunya Grand Prix',
  },
};

const MONACO = { id: 'monaco', meetingName: 'Monaco Grand Prix', date: '2026-06-07' };

test('each provider gets the name it files the race under', () => {
  assert.equal(openf1MeetingName(BARCELONA), 'Barcelona Grand Prix');
  assert.equal(fiaEventName(BARCELONA), 'Barcelona-Catalunya Grand Prix');
});

test('races without source overrides fall back to the meeting name', () => {
  assert.equal(openf1MeetingName(MONACO), 'Monaco Grand Prix');
  assert.equal(fiaEventName(MONACO), 'Monaco Grand Prix');
});

test('FIA slugs keep the hyphen inside a hyphenated meeting name', () => {
  assert.equal(meetingToFiaSlug('Barcelona-Catalunya Grand Prix'), 'barcelona-catalunya_grand_prix');
  assert.equal(meetingToFiaSlug('Australian Grand Prix'), 'australian_grand_prix');
  assert.equal(meetingToFiaSlug('São Paulo Grand Prix'), 'sao_paulo_grand_prix');
});

test('document discovery uses the FIA event name, not the calendar meeting name', async () => {
  const requested = [];

  const urls = await fetchFiaDecisionUrls(
    { ...BARCELONA, meetingName: 'Spanish Grand Prix' },
    {
      fetchImpl: async (url) => {
        requested.push(url);
        return {
          ok: true,
          status: 200,
          text: async () => '<a href="/system/files/decision-document/2026_barcelona-catalunya_grand_prix_-_infringement_-_car_12.pdf">doc</a>',
        };
      },
    },
  );

  assert.deepEqual(requested, [eventDocumentsPage('Barcelona-Catalunya Grand Prix')]);
  assert.equal(urls.length, 1);
});
