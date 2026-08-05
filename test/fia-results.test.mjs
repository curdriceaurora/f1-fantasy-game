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

test('parseFinalClassification identifies every FIA disqualified row', () => {
  const text = `
112Kimi ANTONELLIMercedes-AMG PETRONAS F1 Team7825
NOT CLASSIFIED
14Fernando ALONSOAston Martin Aramco F1 Team4DNF
16Charles LECLERCScuderia Ferrari HPDQ
44Lewis HAMILTONScuderia Ferrari HPDSQ
10Pierre GASLYBWT Alpine F1 TeamDISQUALIFIED
FASTEST LAP
`;

  const { positions, disqualified } = parseFinalClassification(text);
  assert.equal(positions.get('charles-leclerc'), 3);
  assert.deepEqual(
    [...disqualified].sort(),
    ['charles-leclerc', 'lewis-hamilton', 'pierre-gasly'],
  );
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
