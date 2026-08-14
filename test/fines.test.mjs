import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeFineFromText, classifySubject, summarizeFineDocumentText, driverFaultDriver, fetchFineSummary, fetchPdfText } from '../lib/fines.js';

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

test('a partially suspended fine only counts the payable part', () => {
  const text = `
    Decision
    The competitor (Scuderia Ferrari HP) is fined €30,000 of which €10,000 is
    suspended for 12 months on condition that the Competitor does not commit a
    similar infringement in the meantime.
  `;

  assert.equal(activeFineFromText(text), 20000);
  const summary = summarizeFineDocumentText('https://example.test/suspended-part.pdf', text);
  assert.equal(summary.warning, null);
  assert.equal(summary.document.fineEuros, 20000);
  assert.deepEqual(summary.document.appliedTo, { type: 'team', id: 'ferrari' });
});

test('a partially suspended fine still counts a separate full fine in the same document', () => {
  const text = `
    Decision
    The competitor (Scuderia Ferrari HP) is fined €30,000 of which €10,000 is
    suspended for 12 months on condition that no similar infringement follows.
    A separate fine of €5,000 is imposed for an unrelated procedural breach.
  `;

  // €20,000 payable from the partial suspension, plus the €5,000 standalone fine.
  assert.equal(activeFineFromText(text), 25000);
  const summary = summarizeFineDocumentText('https://example.test/partial-plus-full.pdf', text);
  assert.equal(summary.warning, null);
  assert.equal(summary.document.fineEuros, 25000);
});

test('an amount-first partial suspension counts only the payable remainder', () => {
  // Canada RBPT (car 30): the suspended part is named second, after the total.
  const text = `
    Decision
    The competitor (Visa Cash App Racing Bulls F1 Team) is fined €30,000, €20,000 of
    which is suspended for a period of 12 months subject to no further breach.
  `;

  assert.equal(activeFineFromText(text), 10000);
});

test('a fine suspended in full by a following sentence counts nothing', () => {
  // Monaco (car 1 / car 16): "This fine is suspended" sits in its own sentence,
  // so the clause scan never sees "suspend" next to the amount.
  const text = `
    Decision
    The competitor (McLaren Mastercard F1 Team) is fined €5,000.  This fine is
    suspended for a period of 12 months subject to no further breach.
  `;

  assert.equal(activeFineFromText(text), 0);
});

test('sponsor-prefixed competitor names still resolve to the canonical team', () => {
  const text = `
    No / Driver
    6 - Isack Hadjar
    Competitor
    Oracle Red Bull Racing
    Decision
    The competitor (Oracle Red Bull Racing) is fined €400.
  `;

  const summary = summarizeFineDocumentText('https://example.test/pit-lane.pdf', text);
  assert.equal(summary.warning, null);
  assert.deepEqual(summary.document.appliedTo, { type: 'team', id: 'red-bull' });
});

test('an unnamed competitor fine is billed to the team that entered the car', () => {
  const text = `
    No / Driver
    23 - Alexander Albon
    Decision
    A fine of €5,000 is also imposed on the Competitor for a breach of Article 12
  `;

  const summary = summarizeFineDocumentText('https://example.test/competitor.pdf', text);
  assert.equal(summary.warning, null);
  assert.deepEqual(summary.document.appliedTo, { type: 'team', id: 'williams' });
});

test('a fine imposed on the driver stays with the driver', () => {
  const text = `
    No / Driver
    23 - Alexander Albon
    Decision
    The driver (Alexander Albon) is fined €5,000.
  `;

  const summary = summarizeFineDocumentText('https://example.test/driver-fine.pdf', text);
  assert.equal(summary.warning, null);
  assert.deepEqual(summary.document.appliedTo, { type: 'driver', id: 'alex-albon' });
});

test('a pit lane speeding fine is charged to the driver, not the competitor', () => {
  const url = 'https://example.test/2026_monaco_grand_prix_-_infringement_-_car_63_-_pit_lane_speeding.pdf';
  const text = `
    The competitor (Mercedes-AMG PETRONAS F1 Team) is fined €100.
    Reason Car 63 exceeded the pit lane speed limit which is set at 60 km/h.
  `;

  const summary = summarizeFineDocumentText(url, text);
  assert.equal(summary.warning, null);
  assert.equal(summary.document.fineEuros, 100);
  assert.deepEqual(summary.document.appliedTo, { type: 'driver', id: 'george-russell' });
});

test('a start procedure infringement is charged to the driver', () => {
  const url = 'https://example.test/2026_barcelona-catalunya_grand_prix_-_infringement_-_car_23_-_start_procedure_infringement.pdf';
  const text = `
    The competitor (Atlassian Williams F1 Team) is fined €5,000.
    Reason Car 23 moved before the start signal was given.
  `;

  const summary = summarizeFineDocumentText(url, text);
  assert.deepEqual(summary.document.appliedTo, { type: 'driver', id: 'alex-albon' });
});

test('a team fine whose reason text mentions a driving phrase still stays with the team', () => {
  // Canada car 14: an unsafe release, but the reason narrates a near "collision
  // with Car 27" — the infringement type comes from the title, not the reason.
  const url = 'https://example.test/2026_canadian_grand_prix_-_infringement_-_car_14_-_unsafe_release_from_garage.pdf';
  const text = `
    The competitor (Aston Martin Aramco F1 Team) is fined €5,000.
    Reason Car 14 was released from its garage into a near collision with Car 27.
  `;

  const summary = summarizeFineDocumentText(url, text);
  assert.deepEqual(summary.document.appliedTo, { type: 'team', id: 'aston-martin' });
});

test('a driver-fault fine for a non-roster car falls back to the entrant team', () => {
  const url = 'https://example.test/2026_belgian_grand_prix_-_infringement_-_car_34_-_pit_lane_speeding.pdf';
  const text = `
    The competitor (Aston Martin Aramco F1 Team) is fined €100.
    Reason Car 34 exceeded the pit lane speed limit.
  `;

  const summary = summarizeFineDocumentText(url, text);
  assert.deepEqual(summary.document.appliedTo, { type: 'team', id: 'aston-martin' });
});

test('the entry line resolves a driver by car number when the name is unknown', () => {
  assert.deepEqual(classifySubject('6 - I. Hadjar-Unknown'), { type: 'driver', id: 'isack-hadjar' });
});

test('a partial suspension is not counted twice when the PDF breaks the words apart', () => {
  // Steward PDFs put line breaks and non-breaking spaces inside this sentence.
  // The reader and the remover must agree, or the paired amounts are read once
  // as a suspension and again as two independent fines.
  const nonBreakingSpace = ' ';
  const text = `
    Decision
    The competitor (Scuderia Ferrari HP) is fined €30,000 of${nonBreakingSpace}which €10,000 is
    suspended for 12 months on condition that the Competitor does not commit a
    similar infringement in the meantime.
  `;

  assert.equal(activeFineFromText(text), 20000);
});

test('driverFaultDriver identifies driver-fault infringements from URL patterns', () => {
  const url1 = 'https://example.test/infringement_-_car_44_-_track_limits.pdf';
  const driver1 = driverFaultDriver(url1, 'Reason Car 44 track limits');
  assert.ok(driver1);
  assert.strictEqual(driver1.id, 'lewis-hamilton');

  const url2 = 'https://example.test/infringement_-_car_12_-_impeding.pdf';
  const driver2 = driverFaultDriver(url2, 'Reason Car 12 impeding');
  assert.ok(driver2);
  assert.strictEqual(driver2.id, 'kimi-antonelli');

  const nonDriverUrl = 'https://example.test/infringement_-_car_44_-_technical_breach.pdf';
  assert.strictEqual(driverFaultDriver(nonDriverUrl, 'Technical breach'), null);
});

test('fetchFineSummary handles fine documents list and summarizes totals', async () => {
  const summary = await fetchFineSummary('australia', []);
  assert.strictEqual(summary.raceId, 'australia');
  assert.deepStrictEqual(summary.drivers, {});
  assert.deepStrictEqual(summary.teams, {});
  assert.deepStrictEqual(summary.documents, []);
});

test('fetchPdfText fetches, parses, caches, and reuses FIA PDF text', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'f1-fia-pdf-cache-'));
  let fetches = 0;
  let parses = 0;
  const options = {
    cacheDir,
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('pdf-bytes') };
    },
    parsePdf: async (buffer) => {
      parses += 1;
      assert.equal(buffer.toString(), 'pdf-bytes');
      return { text: 'Parsed FIA decision' };
    },
  };

  try {
    const url = 'https://fia.test/decision car 63.pdf';
    assert.equal(await fetchPdfText(url, options), 'Parsed FIA decision');
    assert.equal(await fetchPdfText(url, options), 'Parsed FIA decision');
    assert.equal(fetches, 1);
    assert.equal(parses, 1);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('fetchFineSummary aggregates drivers and teams while retaining warnings', async () => {
  const documents = ['driver.pdf', 'team.pdf', 'unknown.pdf', 'no-fine.pdf'];
  const texts = {
    'driver.pdf': 'Driver: Lando Norris\nFine €4,000',
    'team.pdf': 'Competitor: Ferrari\nFine €6,000',
    'unknown.pdf': 'Competitor: Safety delegate\nFine €2,000',
    'no-fine.pdf': 'No financial penalty.',
  };
  const summary = await fetchFineSummary('australia', documents, {
    fetchPdfTextImpl: async (url) => texts[url],
  });

  assert.equal(summary.drivers['lando-norris'], 4000);
  assert.equal(summary.teams.ferrari, 6000);
  assert.equal(summary.documents.length, 4);
  assert.equal(summary.warnings.length, 1);
});

test('parseEuros handles European format numbers with both dots and commas', () => {
  const text = 'The competitor is fined €1.500,00 for pit lane speeding.';
  assert.equal(activeFineFromText(text), 1500);
});

test('activeFineFromText recognizes fully suspended and no operational fine phrases', () => {
  const textFullySuspended = 'The competitor is fined €5,000. This fine is fully suspended for the remainder of the season.';
  assert.equal(activeFineFromText(textFullySuspended), 0);

  const textNoOpFine = 'The competitor is fined €10,000. There is no operational fine due to exceptional circumstances.';
  assert.equal(activeFineFromText(textNoOpFine), 0);
});

test('classifySubject identifies driver from CAR XX (XYZ) steward heading format', () => {
  const subjectWithAcronym = classifySubject('Infringement by CAR 63 (RUS) during Qualifying');
  assert.deepEqual(subjectWithAcronym, { type: 'driver', id: 'george-russell' });

  const subjectWithNumberOnly = classifySubject('Infringement by CAR 44 during Pit Stop');
  assert.deepEqual(subjectWithNumberOnly, { type: 'driver', id: 'lewis-hamilton' });
});

