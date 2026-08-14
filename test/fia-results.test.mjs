import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFinalClassification, parseStartingGrid, parseGridPenalties, fetchRaceResults } from '../lib/fia-results.js';

test('fetchRaceResults handles missing or failing PDF downloads gracefully', async () => {
  const race = { date: '2026-03-08', id: 'australia', meetingName: 'Australian Grand Prix', isSprintWeekend: false };
  const mockHtml = '<a href="/system/files/decision-document/2026_australian_grand_prix_-_doc.pdf">doc</a>';
  const options = { maxAttempts: 1, retryDelayMs: 0, fetch: async () => ({ ok: true, status: 200, text: async () => mockHtml }), fetchPdfTextImpl: async () => '' };
  const results = await fetchRaceResults(race, options);
  assert.ok(results);
  assert.ok(typeof results.finishingPositions === 'object');
  assert.ok(typeof results.gridPositions === 'object');
});

test('parseFinalClassification numbers classified finishers then retirees by list order', () => {
  // Classified rows are prefixed "{position}{carNumber}"; retirees list the car
  // number only and continue the numbering (the FIA lists them by laps).
  const text = `
NO  DRIVERNAT ENTRANTLAPS TIME PTS
112Kimi ANTONELLIMercedes-AMG PETRONAS F1 Team782:23:31.24325
244Lewis HAMILTONScuderia Ferrari HP782:23:37.51418
36Isack HADJAROracle Red Bull Racing782:23:54.63715
NOT CLASSIFIED
16Charles LECLERCScuderia Ferrari HP641:25:42.849DNF
3Max VERSTAPPENOracle Red Bull Racing0DNF
FASTEST LAP
12Kimi ANTONELLIMercedes-AMG PETRONAS F1 Team
`;

  const { positions } = parseFinalClassification(text);
  assert.equal(positions.get('kimi-antonelli'), 1);
  assert.equal(positions.get('lewis-hamilton'), 2);
  assert.equal(positions.get('isack-hadjar'), 3);
  assert.equal(positions.get('charles-leclerc'), 4);
  assert.equal(positions.get('max-verstappen'), 5);
});

test('parseFinalClassification reads the time-penalty list, including multipliers', () => {
  const text = `
112Kimi ANTONELLIMercedes-AMG PETRONAS F1 Team7825
NOT CLASSIFIED
3Max VERSTAPPENOracle Red Bull Racing0DNF
* PENALTIES
Car 43 - 5 second time penalty - Speeding in the pit lane
Car 10 - 2 x 5 second time penalty - Speeding in the pit lane
`;

  const { penalties } = parseFinalClassification(text);
  assert.equal(penalties.get('franco-colapinto'), 5); // car 43
  assert.equal(penalties.get('pierre-gasly'), 10); // car 10, 2 x 5s
});

test('parseFinalClassification identifies every FIA disqualified row', () => {
  const text = `
112Kimi ANTONELLIMercedes-AMG PETRONAS F1 Team7825
NOT CLASSIFIED
14Fernando ALONSOAston Martin Aramco F1 Team4DNF
16Charles LECLERCScuderia Ferrari HPDQ
44Lewis HAMILTONScuderia Ferrari HPDSQ
10Pierre GASLYBWT Alpine F1 TeamDISQUALIFIED
11Sergio PEREZCadillac DQ Racing TeamDNF
FASTEST LAP
`;

  const { positions, disqualified } = parseFinalClassification(text);
  assert.equal(positions.get('charles-leclerc'), 3);
  assert.deepEqual(
    [...disqualified].sort(),
    ['charles-leclerc', 'lewis-hamilton', 'pierre-gasly'],
  );
  assert.equal(disqualified.has('sergio-perez'), false);
});

test('parseStartingGrid maps each grid slot to its driver', () => {
  const text = `
1
12Kimi ANTONELLI
Mercedes-AMG PETRONAS F1 Team
1:12.051
2
3Max VERSTAPPEN
Oracle Red Bull Racing
1:12.094
8
1Lando NORRIS
McLaren Mastercard F1 Team
1:12.765
`;

  const grid = parseStartingGrid(text);
  assert.equal(grid.get('kimi-antonelli'), 1);
  assert.equal(grid.get('max-verstappen'), 2);
  assert.equal(grid.get('lando-norris'), 8);
});

test('parseStartingGrid assigns Barcelona pit-lane starter Alonso to P22', () => {
  const text = `
19
11Sergio PEREZ
Cadillac Formula 1 Team
1:17.545
21
18Lance STROLL
Aston Martin Aramco F1 Team
1:18.758
DRIVERS REQUIRED TO START FROM THE PIT LANE
14Fernando ALONSO *
Aston Martin Aramco F1 Team
1:18.815
* PENALTIES
document no. 52
`;

  const grid = parseStartingGrid(text);
  assert.equal(grid.get('sergio-perez'), 19);
  assert.equal(grid.get('lance-stroll'), 21);
  assert.equal(grid.get('fernando-alonso'), 22);
});

test('parseStartingGrid handles a pit-lane car number split from the driver name', () => {
  const text = `
21
5Gabriel BORTOLETO
Audi Revolut F1 Team
DRIVERS REQUIRED TO START FROM THE PIT LANE
6
Isack HADJAR *
Oracle Red Bull Racing
NOTES
Car 6 - Permitted to start
`;

  const grid = parseStartingGrid(text);
  assert.equal(grid.get('gabriel-bortoleto'), 21);
  assert.equal(grid.get('isack-hadjar'), 22);
});

test('parseStartingGrid gives multiple pit-lane starters ordered virtual positions', () => {
  const text = `
19
11Sergio PEREZ
Cadillac Formula 1 Team
20
18Lance STROLL
Aston Martin Aramco F1 Team
DRIVERS REQUIRED TO START FROM THE PIT LANE
14Fernando ALONSO *
Aston Martin Aramco F1 Team
6
Isack HADJAR *
Oracle Red Bull Racing
* PENALTIES
`;

  const grid = parseStartingGrid(text);
  assert.equal(grid.get('fernando-alonso'), 21);
  assert.equal(grid.get('isack-hadjar'), 22);
});

test('parseGridPenalties reads a single numbered grid penalty', () => {
  // Britain's final starting grid footer.
  const penalties = parseGridPenalties([
    '* PENALTIES',
    "Car 10 - 3 place grid penalty - Impeding another driver - Stewards' document no. 60",
  ].join('\n'));
  assert.equal(penalties.get('pierre-gasly'), 3);
  assert.equal(penalties.size, 1);
});

test('parseGridPenalties expands a penalty shared by several cars', () => {
  // Belgium lists three cars on one line; scoring all three depends on expanding it.
  // Missing this is what left Sainz without his 10 places (see #84 Q2).
  const penalties = parseGridPenalties([
    '* PENALTIES',
    "Cars 18, 1 & 55 - 10 place grid penalties - Additional power unit element has been used - Stewards' document nos. 22, 23 & 54",
  ].join('\n'));
  assert.equal(penalties.get('lance-stroll'), 10);
  assert.equal(penalties.get('lando-norris'), 10);
  assert.equal(penalties.get('carlos-sainz'), 10);
  assert.equal(penalties.size, 3);
});

test('parseGridPenalties keeps the raw place count above the scoring cap', () => {
  // Belgium's Hadjar accumulated 30 places. The §2.4 10-point cap belongs to
  // scoreGridPenalty; storing 10 here would lose the underlying fact.
  const penalties = parseGridPenalties([
    '* PENALTIES',
    "Car 6 - 30 place grid penalty - Additional power unit elements have been used - Stewards' document no. 44",
  ].join('\n'));
  assert.equal(penalties.get('isack-hadjar'), 30);
});

test('parseGridPenalties ignores a pit-lane start, which carries no place count', () => {
  // Inventing a number here would silently encode a rule Martin has not given us
  // (see #84 Q1). A pit-lane starter must come back with no grid penalty at all.
  const penalties = parseGridPenalties([
    '* PENALTIES',
    "Car 6 - Required to start from the pit lane - Car modified whilst under Parc Fermé conditions - Stewards' document no. 75",
  ].join('\n'));
  assert.equal(penalties.size, 0);
});

test('parseGridPenalties sums two penalties applied to the same car', () => {
  const penalties = parseGridPenalties([
    '* PENALTIES',
    'Car 18 - 5 place grid penalty - Additional power unit elements have been used',
    'Car 18 - 3 place grid penalty - Impeding another driver',
  ].join('\n'));
  assert.equal(penalties.get('lance-stroll'), 8);
});

test('parseGridPenalties reads nothing from a grid with no penalties section', () => {
  assert.equal(parseGridPenalties('1\n63George RUSSELL Mercedes 1:29.000').size, 0);
});

test('parseFinalClassification reads a time penalty behind a lead-in clause', () => {
  // Miami's footer describes Leclerc's penalty as a converted drive-through. The
  // seconds do not follow the dash directly, which is why it was never ingested
  // while Verstappen's plainly-worded penalty on the next line was (#63).
  const text = [
    '1 16Charles LECLERC Scuderia Ferrari HP 90',
    '* PENALTIES',
    "Car 16 - Drive through penalty converted to 20 second time penalty - Leaving the track without a justifiable reason multiple times - Stewards' document no. 97",
    "Car 3 - 5 second time penalty - Crossing the white line at the pit exit - Stewards' document no. 99",
  ].join('\n');
  const { penalties } = parseFinalClassification(text);
  assert.equal(penalties.get('charles-leclerc'), 20);
  assert.equal(penalties.get('max-verstappen'), 5);
});

test('parseFinalClassification does not let one car\'s lead-in swallow the next car', () => {
  // Guard against a greedy lead-in matching across entries: a car with no seconds
  // of its own must not absorb the following car's penalty.
  const text = [
    '* PENALTIES',
    'Car 16 - Reprimand - Impeding',
    'Car 3 - 5 second time penalty - Track limits',
  ].join('\n');
  const { penalties } = parseFinalClassification(text);
  assert.equal(penalties.get('charles-leclerc'), undefined);
  assert.equal(penalties.get('max-verstappen'), 5);
});

test('fetchRaceResults reports an unavailable starting grid as null, not an empty map', () => {
  // The distinction the normalizer depends on: null means "document unavailable,
  // fall back", {} means "document parsed, authoritatively no penalties".
  // Boolean({}) is true, so returning {} for a failed download would silently
  // present an empty result as authoritative.
  const race = { date: '2026-03-08', id: 'australia', meetingName: 'Australian Grand Prix', isSprintWeekend: false };
  const options = {
    maxAttempts: 1,
    retryDelayMs: 0,
    fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
    fetchPdfTextImpl: async () => { throw new Error('404'); },
  };
  return fetchRaceResults(race, options).then((results) => {
    assert.equal(results.gridPenaltyPlaces, null);
  });
});

test('fetchRaceResults reports a parsed grid with no penalties as an empty map', () => {
  const race = { date: '2026-03-08', id: 'australia', meetingName: 'Australian Grand Prix', isSprintWeekend: false };
  const options = {
    maxAttempts: 1,
    retryDelayMs: 0,
    fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
    fetchPdfTextImpl: async () => '1\n63George RUSSELL Mercedes 1:29.000',
  };
  return fetchRaceResults(race, options).then((results) => {
    assert.deepEqual(results.gridPenaltyPlaces, {});
  });
});

test('fetchRaceResults on sprint weekends fetches and parses sprint classification', async () => {
  const sprintRace = { date: '2026-03-15', id: 'china', meetingName: 'Chinese Grand Prix', isSprintWeekend: true };
  const texts = {
    final_race_classification: '163George RUSSELL Mercedes 1:30.000',
    final_starting_grid: '1\n63George RUSSELL Mercedes 1:29.000',
    final_sprint_classification: '144Lewis HAMILTON Ferrari 30:00.000\n* PENALTIES\nCar 63 - 5 second time penalty',
  };
  const options = {
    fetchPdfTextImpl: async (url) => {
      if (url.includes('final_sprint_classification')) return texts.final_sprint_classification;
      if (url.includes('final_starting_grid')) return texts.final_starting_grid;
      return texts.final_race_classification;
    },
  };

  const results = await fetchRaceResults(sprintRace, options);
  assert.equal(results.finishingPositions['george-russell'], 1);
  assert.equal(results.sprintPositions['lewis-hamilton'], 1);
  assert.equal(results.gridPositions['george-russell'], 1);
});

test('parseStartingGrid handles pit-lane starters in split-line number and name format', () => {
  const text = [
    '1',
    '63George RUSSELL Mercedes 1:29.000',
    'DRIVERS REQUIRED TO START FROM THE PIT LANE',
    '14',
    'Fernando ALONSO Aston Martin',
  ].join('\n');

  const grid = parseStartingGrid(text);
  assert.equal(grid.get('george-russell'), 1);
  assert.equal(grid.get('fernando-alonso'), 2);
});

test('parseFinalClassification parses penalty multiplier and parseStartingGrid ignores out of bounds positions', async () => {
  const text = [
    '163George RUSSELL Mercedes',
    'PENALTIES',
    'Car 16 - 2 x 5 second time penalties - track limits',
  ].join('\n');

  const classification = parseFinalClassification(text);
  assert.equal(classification.penalties.get('charles-leclerc'), 10);

  // Out-of-bounds grid position (e.g. position 50)
  const invalidGrid = parseStartingGrid([
    '50',
    '63George RUSSELL Mercedes',
  ].join('\n'));
  assert.equal(invalidGrid.has('george-russell'), false);

  // fetchRaceResults with missing grid text
  const race = { date: '2026-03-08', meetingName: 'Australian Grand Prix' };
  const res = await fetchRaceResults(race, {
    fetchPdfTextImpl: async (url) => {
      if (url.includes('starting_grid')) throw new Error('404');
      return '163George RUSSELL Mercedes';
    },
  });
  assert.equal(res.gridPenaltyPlaces, null);
});


