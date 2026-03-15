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

test('activeFineFromText captures both "fine €X" and "€X fine" wording', () => {
  const text = `
    Driver: George Russell
    A fine of €4,000 is imposed.
    Additional sanction: €7,500 fine for procedural breach.
  `;

  assert.equal(activeFineFromText(text), 11500);
});

test('activeFineFromText subtracts suspended amounts when suspension wording is nearby', () => {
  const text = `
    Competitor: Mercedes
    Financial penalty of €8,000.
    Of which €3,000 is suspended until 31 December.
  `;

  assert.equal(activeFineFromText(text), 5000);
});

test('activeFineFromText ignores euro values with no fine context', () => {
  const text = `
    Competitor: Mercedes
    Deposit amount €20,000
    Administrative reference €1,000
  `;

  assert.equal(activeFineFromText(text), 0);
});

test('activeFineFromText deduplicates repeated same-value euro renderings in one clause', () => {
  const text = `
    Competitor: Alpine
    Car 10 is fined €5.000 (€5,000) for the same infringement.
  `;

  assert.equal(activeFineFromText(text), 5000);
});

test('activeFineFromText deduplicates repeated sanction amount across narrative clauses', () => {
  const text = `
    The Competitor is fined €5.000.
    Accordingly, the stewards impose a fine of €5,000 on the Competitor.
  `;

  assert.equal(activeFineFromText(text), 5000);
});
