import test from 'node:test';
import assert from 'node:assert/strict';
import { activeFineFromText, summarizeFineDocumentText } from '../lib/fines.js';

test('suspended fines do not create active penalties', () => {
  const text = `
    Competitor: McLaren
    Fine of €10,000 of which is suspended
  `;
  assert.equal(activeFineFromText(text), 0);
  const summary = summarizeFineDocumentText('https://example.test/suspended.pdf', text);
  assert.equal(summary.warning, null);
  assert.equal(summary.document.fineEuros, 0);
});

test('driver fines are classified and converted into points', () => {
  const text = `
    Document 1
    Driver: Lando Norris
    Fine €4,000
  `;

  const summary = summarizeFineDocumentText('https://example.test/driver.pdf', text);
  assert.equal(summary.warning, null);
  assert.deepEqual(summary.document.appliedTo, { type: 'driver', id: 'lando-norris' });
  assert.equal(summary.document.fineEuros, 4000);
  assert.equal(summary.document.finePoints, -2);
});

test('unclassified fine subjects surface warnings instead of silently zeroing out', () => {
  const text = `
    Document 1
    Competitor: Safety delegate
    Fine €2,000
  `;

  const summary = summarizeFineDocumentText('https://example.test/unknown.pdf', text);
  assert.match(summary.warning, /Unable to classify fine subject/);
  assert.equal(summary.document.finePoints, -1);
  assert.equal(summary.document.appliedTo, null);
});
