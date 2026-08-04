import { test, expect } from '@playwright/test';
import { monitorPage } from './helpers.js';

const DASHBOARD_URL = 'http://127.0.0.1:3456/dashboard.html';

function formatDelta(value) {
  if (value == null) return '—';
  if (value === 0) return 'No change';
  return value > 0 ? `+${value}` : String(value);
}

function signedPoints(value) {
  return `${value > 0 ? '+' : ''}${value}`;
}

test('renders standings as API-backed mobile cards without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-iphone-14', 'iPhone mobile project only');
  const assertHealthy = await monitorPage(page);
  const standingsResponse = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/dashboard/standings'
  ));

  await page.goto(DASHBOARD_URL);
  const standings = await (await standingsResponse).json();
  const leader = standings.standings[0];
  const rows = page.locator('#standings-body tr');
  await expect(rows).toHaveCount(standings.standings.length);

  const overflow = await page.locator('.standings-table-wrap').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  await page.setViewportSize({ width: 320, height: 568 });
  const compactOverflow = await page.locator('.standings-table-wrap').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(compactOverflow.scrollWidth).toBeLessThanOrEqual(compactOverflow.clientWidth);

  const firstRow = rows.first();
  await expect(firstRow).toHaveCSS('display', 'grid');
  await expect(firstRow.locator('.standing-rank')).toHaveText(`#${leader.rank}`);
  await expect(firstRow.locator('.standing-name')).toHaveText(leader.displayName);
  await expect(firstRow.locator('.standing-principal')).toHaveText(leader.principalName);
  await expect(firstRow.locator('.standing-total')).toHaveText(String(leader.totalPoints));
  await expect(firstRow.locator('.standing-latest')).toHaveText(signedPoints(leader.latestRacePoints));
  await expect(firstRow.locator('.standing-delta')).toHaveText(formatDelta(leader.wowDelta));

  const topRowCells = await Promise.all([
    firstRow.locator('.standing-rank').boundingBox(),
    firstRow.locator('.standing-name').boundingBox(),
    firstRow.locator('.standing-total').boundingBox(),
  ]);
  const bottomRowCells = await Promise.all([
    firstRow.locator('.standing-principal').boundingBox(),
    firstRow.locator('.standing-delta').boundingBox(),
    firstRow.locator('.standing-latest').boundingBox(),
  ]);
  expect(Math.max(...topRowCells.map(box => box.y)) - Math.min(...topRowCells.map(box => box.y)))
    .toBeLessThan(8);
  expect(Math.min(...bottomRowCells.map(box => box.y)))
    .toBeGreaterThan(Math.max(...topRowCells.map(box => box.y)));

  await firstRow.click();
  await expect(page).toHaveURL(
    `http://127.0.0.1:3456/team.html?team=${encodeURIComponent(leader.teamId)}`,
  );

  await page.waitForLoadState('networkidle');
  assertHealthy();
});
