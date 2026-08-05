import { test, expect } from '@playwright/test';

// Deterministic standings so the podium, chips, and summary values are fixed.
const STANDINGS = [
  { rank: 1, teamId: 'alpha', displayName: 'Alpha Racing', principalName: 'A One', totalPoints: 100, latestRacePoints: 20, completedRaces: 2, wowDelta: 2 },
  { rank: 2, teamId: 'bravo', displayName: 'Bravo Racing', principalName: 'B Two', totalPoints: 90, latestRacePoints: 10, completedRaces: 2, wowDelta: 0 },
  { rank: 3, teamId: 'charlie', displayName: 'Charlie Racing', principalName: 'C Three', totalPoints: 80, latestRacePoints: -3, completedRaces: 2, wowDelta: -1 },
];

function mockStandings(page, races) {
  return page.route('**/api/dashboard/standings', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: '2026-08-05T00:00:00Z', races, standings: STANDINGS }),
  }));
}

test('summary tiles, podium colours, and change chips reflect the data', async ({ page }) => {
  await mockStandings(page, [
    { id: 'r1', name: 'One', date: '2026-03-08', status: 'finalized', round: 1 },
    { id: 'r2', name: 'Two', date: '2026-03-15', status: 'finalized', round: 2 },
    { id: 'nl', name: 'Netherlands', date: '2026-08-23', status: 'not run', round: 3 },
  ]);
  await page.goto('/dashboard.html');

  const tiles = page.locator('#season-summary .summary-tile');
  await expect(tiles).toHaveCount(4);
  const lead = page.locator('#season-summary .summary-tile-lead');
  await expect(lead).toContainText('Alpha Racing');
  await expect(lead).toContainText('100 pts');
  await expect(tiles.nth(1)).toContainText('2');
  await expect(tiles.nth(1)).toContainText('of 3');
  await expect(tiles.nth(2)).toContainText('R3 · Netherlands');
  await expect(tiles.nth(3)).toContainText('3');

  // Podium: only the top three carry a medal class.
  await expect(page.locator('#standings-body tr:nth-child(1) .rank-pill-p1')).toHaveCount(1);
  await expect(page.locator('#standings-body tr:nth-child(2) .rank-pill-p2')).toHaveCount(1);
  await expect(page.locator('#standings-body tr:nth-child(3) .rank-pill-p3')).toHaveCount(1);
  await expect(page.locator('#standings-body .rank-pill-p1, #standings-body .rank-pill-p2, #standings-body .rank-pill-p3')).toHaveCount(3);

  // Change chips carry direction in shape + class, not just sign.
  await expect(page.locator('#standings-body tr:nth-child(1) .delta-chip.delta-up')).toHaveText('▲ 2');
  await expect(page.locator('#standings-body tr:nth-child(2) .delta-chip.delta-flat')).toHaveText('No change');
  await expect(page.locator('#standings-body tr:nth-child(3) .delta-chip.delta-down')).toHaveText('▼ 1');
});

test('a postponed race with no firm date reads "To be confirmed", not "Season complete"', async ({ page }) => {
  await mockStandings(page, [
    { id: 'r1', name: 'One', date: '2026-03-08', status: 'finalized', round: 1 },
    { id: 'pending', name: 'Pending', date: null, status: 'postponed', round: null },
  ]);
  await page.goto('/dashboard.html');

  const nextTile = page.locator('#season-summary .summary-tile').nth(2);
  await expect(nextTile).toContainText('To be confirmed');
  await expect(nextTile).not.toContainText('Season complete');
});

test('a race that has run but is not scored reads "Results pending", not a TBC date', async ({ page }) => {
  await mockStandings(page, [
    { id: 'r1', name: 'One', date: '2026-03-08', status: 'finalized', round: 1 },
    { id: 'r2', name: 'Two', date: '2026-03-15', status: 'awaiting Monday scoring', round: 2 },
  ]);
  await page.goto('/dashboard.html');

  const nextTile = page.locator('#season-summary .summary-tile').nth(2);
  await expect(nextTile).toContainText('Results pending');
  await expect(nextTile).toContainText('R2 · Two');
  await expect(nextTile).not.toContainText('To be confirmed');
});

test('a race awaiting fine review also reads "Results pending"', async ({ page }) => {
  await mockStandings(page, [
    { id: 'r1', name: 'One', date: '2026-03-08', status: 'finalized', round: 1 },
    { id: 'r2', name: 'Two', date: '2026-03-15', status: 'awaiting fine review', round: 2 },
  ]);
  await page.goto('/dashboard.html');

  await expect(page.locator('#season-summary .summary-tile').nth(2)).toContainText('Results pending');
});

test('a fully finalized season reads "Season complete"', async ({ page }) => {
  await mockStandings(page, [
    { id: 'r1', name: 'One', date: '2026-03-08', status: 'finalized', round: 1 },
    { id: 'r2', name: 'Two', date: '2026-03-15', status: 'finalized', round: 2 },
    { id: 'x', name: 'Scrapped', date: '2026-04-01', status: 'cancelled', round: null },
  ]);
  await page.goto('/dashboard.html');

  await expect(page.locator('#season-summary .summary-tile').nth(2)).toContainText('Season complete');
});

test('summary stays a compact 2x2 grid on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/dashboard.html');

  const tiles = page.locator('#season-summary .summary-tile');
  await expect(tiles).toHaveCount(4);
  const [a, b, c] = await Promise.all([
    tiles.nth(0).boundingBox(),
    tiles.nth(1).boundingBox(),
    tiles.nth(2).boundingBox(),
  ]);
  // Two per row: tiles 0 and 1 share a row (same top), tile 1 is to the right,
  // and tile 2 wraps onto a second row.
  expect(Math.abs(a.y - b.y)).toBeLessThan(4);
  expect(b.x).toBeGreaterThan(a.x + 4);
  expect(c.y).toBeGreaterThan(a.y + 4);
});
