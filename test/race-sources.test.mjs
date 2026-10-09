import test from 'node:test';
import assert from 'node:assert/strict';
import {
  documentPrefixes, eventDocumentsPage, fetchFiaDecisionUrls, fiaDocumentSlug, fiaEventName, meetingToFiaSlug,
} from '../lib/fia-documents.js';
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

// The October Bahrain round is listed on FIA's "Bahrain Grand Prix" event page,
// but every document it publishes is prefixed "2026_bahrain_grand_prix_in_malaysia".
const BAHRAIN_IN_MALAYSIA = {
  id: 'bahrain',
  meetingName: 'Bahrain Grand Prix',
  date: '2026-10-04',
  sources: { fiaDocumentSlug: 'bahrain_grand_prix_in_malaysia' },
};

const BAHRAIN_PAGE = [
  '<a href="/system/files/decision-document/2026_bahrain_grand_prix_in_malaysia_-_infringement_-_car_6_-_changes_to_pu_elements.pdf">doc</a>',
  '<a href="/system/files/decision-document/2026_bahrain_grand_prix_in_malaysia_-_final_starting_grid.pdf">doc</a>',
].join('');

function servePage(html, requested = []) {
  return async (url) => {
    requested.push(url);
    return { ok: true, status: 200, text: async () => html };
  };
}

test('the document slug override replaces the slug taken from the event name', () => {
  assert.equal(fiaDocumentSlug(BAHRAIN_IN_MALAYSIA), 'bahrain_grand_prix_in_malaysia');
  assert.equal(fiaDocumentSlug(BARCELONA), 'barcelona-catalunya_grand_prix');
  assert.equal(fiaDocumentSlug(MONACO), 'monaco_grand_prix');
});

test('document discovery reads the event page but matches the overridden file prefix', async () => {
  const requested = [];
  const urls = await fetchFiaDecisionUrls(BAHRAIN_IN_MALAYSIA, { fetchImpl: servePage(BAHRAIN_PAGE, requested) });

  assert.deepEqual(requested, [eventDocumentsPage('Bahrain Grand Prix')]);
  assert.equal(urls.length, 2);
});

test('an event page whose documents all use another prefix fails instead of reading as no documents', async () => {
  const { sources, ...withoutOverride } = BAHRAIN_IN_MALAYSIA;
  assert.ok(sources);
  await assert.rejects(
    () => fetchFiaDecisionUrls(withoutOverride, { fetchImpl: servePage(BAHRAIN_PAGE) }),
    /files its documents under 2026_bahrain_grand_prix_in_malaysia, not 2026_bahrain_grand_prix\. Set sources\.fiaDocumentSlug for bahrain/,
  );
});

test('an event page with no documents yet still falls back to the landing page', async () => {
  const requested = [];
  const urls = await fetchFiaDecisionUrls(MONACO, { fetchImpl: servePage('<p>No documents</p>', requested) });

  assert.deepEqual(urls, []);
  assert.equal(requested.length, 2);
});

test('document prefixes are read up to the first separator', () => {
  assert.deepEqual(documentPrefixes(BAHRAIN_PAGE, '2026'), ['2026_bahrain_grand_prix_in_malaysia']);
  assert.deepEqual(documentPrefixes(BAHRAIN_PAGE, '2025'), []);
});
