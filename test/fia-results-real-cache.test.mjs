import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  parsePitLaneGridPenaltyDecision, parseStartingGrid,
} from '../lib/fia-results.js';
import { scoreGridPenalty } from '../lib/score-engine.js';

// These are the complete pdf-parse outputs produced by fetchPdfText, retained in
// the same cache path the production reader uses. They are intentionally not
// shortened fixtures: line breaks and non-breaking spaces are part of the parser
// surface, and synthetic snippets have hidden that class of failure before.
const CASES = [
  {
    race: 'miami', driverId: 'isack-hadjar', status: 'resolved', places: 20,
    grid: '2026_miami_grand_prix_-_final_starting_grid.pdf.txt',
    decision: '2026_miami_grand_prix_-_infringement_-_car_6_-_pu_elements_changed_under_parc_ferme.pdf.txt',
  },
  {
    race: 'canada', driverId: 'lance-stroll', status: 'resolved', places: 20,
    grid: '2026_canadian_grand_prix_-_final_starting_grid.pdf.txt',
    decision: '2026_canadian_grand_prix_-_infringement_-_car_18_-_pu_elements_changed_under_parc_ferme.pdf.txt',
  },
  {
    race: 'barcelona-catalunya', driverId: 'fernando-alonso', status: 'resolved', places: 30,
    grid: '2026_barcelona-catalunya_grand_prix_-_final_starting_grid.pdf.txt',
    decision: '2026_barcelona-catalunya_grand_prix_-_infringement_-_car_14_-_pu_elements_and_changes_used_during_parc_ferme.pdf.txt',
  },
  {
    race: 'china', driverId: 'alex-albon', status: 'unresolved',
    grid: '2026_chinese_grand_prix_-_final_starting_grid.pdf.txt',
    decision: '2026_chinese_grand_prix_-_infringement_-_car_23_-_changes_made_during_parc_ferme_0.pdf.txt',
  },
  {
    race: 'hungary', driverId: 'sergio-perez', status: 'unresolved',
    grid: '2026_hungarian_grand_prix_-_final_starting_grid.pdf.txt',
    decision: '2026_hungarian_grand_prix_-_infringement_-_car_11_-_changes_made_under_parc_ferme.pdf.txt',
  },
];

const cachePath = (name) => fileURLToPath(new URL(`../.fia-cache/${name}`, import.meta.url));

test('all five real cached grids expose their pit-lane starter before filtering', () => {
  assert.ok(CASES.length > 0, 'real-document case list must not be empty');
  for (const entry of CASES) {
    const text = readFileSync(cachePath(entry.grid), 'utf8');
    assert.ok(text.length > 0, `${entry.race}: cached starting grid is empty`);
    const { pitLaneStarters } = parseStartingGrid(text);
    assert.ok(pitLaneStarters.size > 0, `${entry.race}: no pit-lane starters parsed`);
    assert.ok(pitLaneStarters.has(entry.driverId), `${entry.race}: ${entry.driverId} not identified as a pit-lane starter`);
  }
});

test('real cached decisions resolve 20, 20 and 30 places while setup changes stay unresolved', () => {
  assert.ok(CASES.length > 0, 'real-document case list must not be empty');
  for (const entry of CASES) {
    const text = readFileSync(cachePath(entry.decision), 'utf8');
    assert.ok(text.length > 0, `${entry.race}: cached steward decision is empty`);
    const resolution = parsePitLaneGridPenaltyDecision(text);
    assert.ok(resolution, `${entry.race}: decision was not identified as a Race pit-lane start`);
    assert.equal(resolution.status, entry.status, `${entry.race}: wrong resolution state`);
    if (entry.status === 'resolved') {
      assert.equal(resolution.places, entry.places, `${entry.race}: wrong place count`);
      assert.equal(scoreGridPenalty(resolution.places), -10, `${entry.race}: §2.4 cap not applied`);
    } else {
      assert.equal('places' in resolution, false, `${entry.race}: unresolved decision must not default to zero`);
    }
  }
});
