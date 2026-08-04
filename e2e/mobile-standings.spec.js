/* global document, window */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { monitorPage } from './helpers.js';

const DASHBOARD_URL = 'http://127.0.0.1:3456/dashboard.html';
const committedStandings = JSON.parse(
  readFileSync(join(process.cwd(), 'season/scored/standings.json'), 'utf8'),
).standings;
const filterTarget = committedStandings[2];
const LAYOUT_TOLERANCE_PX = 1;

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

  const firstRow = rows.first();
  const firstTeamLink = firstRow.locator('.team-link');

  for (const width of [320, 393, 640, 641, 768, 920, 921, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const containment = await page.evaluate(() => {
      const bounds = selector => {
        const element = document.querySelector(selector);
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      return {
        innerWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        tableOverflow: {
          clientWidth: document.querySelector('.standings-table-wrap').clientWidth,
          scrollWidth: document.querySelector('.standings-table-wrap').scrollWidth,
        },
        standings: bounds('#standings-section'),
        movers: bounds('#big-movers-section'),
        schedule: bounds('#schedule-section'),
      };
    });
    expect(containment.documentWidth, `${width}px document width`)
      .toBeLessThanOrEqual(width + LAYOUT_TOLERANCE_PX);
    expect(containment.tableOverflow.scrollWidth, `${width}px standings table width`)
      .toBeLessThanOrEqual(containment.tableOverflow.clientWidth + LAYOUT_TOLERANCE_PX);
    for (const [name, bounds] of Object.entries({
      standings: containment.standings,
      movers: containment.movers,
      schedule: containment.schedule,
    })) {
      expect(bounds.left, `${name} left edge at ${width}px`)
        .toBeGreaterThanOrEqual(-LAYOUT_TOLERANCE_PX);
      expect(bounds.right, `${name} right edge at ${width}px`)
        .toBeLessThanOrEqual(width + LAYOUT_TOLERANCE_PX);
    }
  }

  await page.setViewportSize({ width: 393, height: 852 });
  await expect(firstRow).toHaveCSS('display', 'grid');
  await expect(firstRow).not.toHaveAttribute('role');
  await expect(firstTeamLink).toHaveAttribute(
    'href',
    `team.html?team=${encodeURIComponent(leader.teamId)}`,
  );
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

  const hierarchy = await page.evaluate(() => ({
    schedule: document.querySelector('#schedule-section').getBoundingClientRect().top,
    movers: document.querySelector('#big-movers-section').getBoundingClientRect().top,
    standings: document.querySelector('#standings-section').getBoundingClientRect().top,
  }));
  expect(hierarchy.schedule).toBeLessThan(hierarchy.movers);
  expect(hierarchy.movers).toBeLessThan(hierarchy.standings);

  await firstTeamLink.click();
  await expect(page).toHaveURL(
    `http://127.0.0.1:3456/team.html?team=${encodeURIComponent(leader.teamId)}`,
  );

  await page.waitForLoadState('networkidle');
  assertHealthy();
});

test('filters standings by team or principal without reloading', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-iphone-14', 'iPhone mobile project only');
  const assertHealthy = await monitorPage(page);
  await page.goto(DASHBOARD_URL);

  const rows = page.locator('#standings-body tr');
  await expect(rows).toHaveCount(committedStandings.length);
  const filter = page.locator('#standings-filter');
  await expect(filter).toBeEnabled();
  await filter.fill(filterTarget.principalName);
  await expect(page.locator('#standings-filter-status')).toHaveText('1 team found');
  const visibleRows = page.locator('#standings-body tr:not([hidden])');
  await expect(visibleRows).toHaveCount(1);
  await expect(visibleRows.locator('.standing-name')).toHaveText(filterTarget.displayName);

  assertHealthy();
});

test('exposes a loading state until dashboard data is ready', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-iphone-14', 'iPhone mobile project only');
  const assertHealthy = await monitorPage(page);
  let releaseResponse = () => {};
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  await page.route('**/api/dashboard/standings', async route => {
    await responseGate;
    await route.continue();
  });

  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dashboard-status')).toHaveText('Loading season dashboard…');
  await expect(page.locator('.dashboard-grid-standings')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#standings-filter')).toBeDisabled();

  releaseResponse();
  await expect(page.locator('#standings-body tr')).toHaveCount(committedStandings.length);
  await expect(page.locator('.dashboard-grid-standings')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#dashboard-status')).toHaveText('Season dashboard loaded.');
  await expect(page.locator('#standings-filter')).toBeEnabled();

  assertHealthy();
});
