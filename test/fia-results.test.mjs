import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFinalClassification, parseStartingGrid } from '../lib/fia-results.js';

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
