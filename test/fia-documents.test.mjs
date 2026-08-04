import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverMonetaryFinePdfs,
  eventDocumentsPage,
  fetchFiaDecisionUrls,
  isPotentialFineDocument,
  isPotentialResultDocument,
} from '../lib/fia-documents.js';

const RACE = { id: 'belgium', meetingName: 'Belgian Grand Prix', date: '2026-07-19' };

function pageWith(...fileNames) {
  const links = fileNames
    .map((name) => `<a href="/system/files/decision-document/${name}">doc</a>`)
    .join('\n');
  return { ok: true, status: 200, text: async () => `<html>${links}</html>` };
}

test('documents are read from the event page, not the championship landing page', async () => {
  const requested = [];

  const urls = await fetchFiaDecisionUrls(RACE, {
    fetchImpl: async (url) => {
      requested.push(url);
      return pageWith('2026_belgian_grand_prix_-_infringement_-_car_44.pdf');
    },
  });

  assert.deepEqual(requested, [eventDocumentsPage('Belgian Grand Prix')]);
  assert.deepEqual(urls, ['https://www.fia.com/system/files/decision-document/2026_belgian_grand_prix_-_infringement_-_car_44.pdf']);
});

test('the landing page is a fallback when the event page has nothing for this race', async () => {
  const requested = [];

  const urls = await fetchFiaDecisionUrls(RACE, {
    fetchImpl: async (url) => {
      requested.push(url);
      return requested.length === 1
        ? pageWith('2025_belgian_grand_prix_-_infringement_-_car_44.pdf')
        : pageWith('2026_belgian_grand_prix_-_infringement_-_car_16.pdf');
    },
  });

  assert.equal(requested.length, 2);
  assert.equal(requested[1], 'https://www.fia.com/documents/championships/fia-formula-one-world-championship-14');
  assert.deepEqual(urls, ['https://www.fia.com/system/files/decision-document/2026_belgian_grand_prix_-_infringement_-_car_16.pdf']);
});

test('documents from other seasons and other meetings are ignored', async () => {
  const urls = await fetchFiaDecisionUrls(RACE, {
    fetchImpl: async () => pageWith(
      '2026_belgian_grand_prix_-_infringement_-_car_44.pdf',
      '2025_belgian_grand_prix_-_infringement_-_car_44.pdf',
      '2026_hungarian_grand_prix_-_infringement_-_car_6.pdf',
    ),
  });

  assert.deepEqual(urls, ['https://www.fia.com/system/files/decision-document/2026_belgian_grand_prix_-_infringement_-_car_44.pdf']);
});

test('classification documents are not treated as fine candidates', () => {
  assert.equal(isPotentialFineDocument('https://fia.test/2026_belgian_grand_prix_-_infringement_-_car_44.pdf'), true);
  assert.equal(isPotentialFineDocument('https://fia.test/2026_belgian_grand_prix_-_final_race_classification.pdf'), false);
  assert.equal(isPotentialFineDocument('https://fia.test/2026_belgian_grand_prix_-_reprimand_-_car_44.pdf'), false);
});

test('appeals and rights of review are monitored without entering fine scoring', () => {
  const appeal = 'https://fia.test/grand_prix_-_appeal_of_decision.pdf';
  const rightOfReview = 'https://fia.test/grand_prix_-_right_of_review_petition.pdf';

  assert.equal(isPotentialResultDocument(appeal), true);
  assert.equal(isPotentialResultDocument(rightOfReview), true);
  assert.equal(isPotentialFineDocument(appeal), false);
  assert.equal(isPotentialFineDocument(rightOfReview), false);
});

test('fine discovery excludes an appeal that restates an active fine', async () => {
  const appealFile = '2026_belgian_grand_prix_-_appeal_of_decision_-_car_44.pdf';
  let pdfReads = 0;

  const urls = await discoverMonetaryFinePdfs(RACE, {
    fetchImpl: async () => pageWith(appealFile),
    fetchPdfTextImpl: async () => {
      pdfReads += 1;
      return 'The Stewards confirm the €25,000 fine imposed on the driver.';
    },
  });

  assert.deepEqual(urls, []);
  assert.equal(pdfReads, 0);
});
