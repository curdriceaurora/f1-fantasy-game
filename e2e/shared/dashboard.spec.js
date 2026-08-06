import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { monitorPage, signedPoints } from '../helpers.js';

function readJson(path) {
  return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8'));
}

const standings = readJson('season/scored/standings.json').standings;
const leader = standings[0];
const leaderScore = readJson(`season/scored/teams/${leader.teamId}.json`);
const firstScoredRace = leaderScore.races[0];

test('dashboard standings match the committed standings data', async ({ page }) => {
  const assertHealthy = await monitorPage(page);

  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard\.html$/);

  const rows = page.locator('#standings-body tr');
  await expect(rows).toHaveCount(standings.length);

  const cells = rows.first().locator('td');
  await expect(cells.nth(0)).toHaveText(`#${leader.rank}`);
  await expect(cells.nth(1)).toHaveText(leader.displayName);
  await expect(cells.nth(2)).toHaveText(leader.principalName);
  await expect(cells.nth(3)).toHaveText(String(leader.totalPoints));

  await page.waitForLoadState('networkidle');
  assertHealthy();
});

test('team race breakdown matches the committed team score', async ({ page }) => {
  const assertHealthy = await monitorPage(page);

  await page.goto(`/team.html?team=${encodeURIComponent(leader.teamId)}`);
  await expect(page.locator('#team-page-title')).toHaveText(leader.displayName);
  await expect(page.locator('#team-total-points')).toHaveText(String(leader.totalPoints));

  const race = page.locator('#team-races details').first();
  await expect(race.locator('summary')).toContainText(firstScoredRace.raceName);
  await expect(race.locator('summary')).toContainText(`${firstScoredRace.totalPoints} pts`);
  await race.locator('summary').click();

  const sections = race.locator('.breakdown-section');
  const driverSection = sections.nth(0);
  const constructorSection = sections.nth(1);
  await expect(driverSection.locator('.breakdown-section-header > strong'))
    .toHaveText(signedPoints(firstScoredRace.driverSubtotal));
  await expect(constructorSection.locator('.breakdown-section-header > strong'))
    .toHaveText(signedPoints(firstScoredRace.constructorSubtotal));

  const drivers = driverSection.locator('.breakdown-entity');
  await expect(drivers).toHaveCount(firstScoredRace.drivers.length);
  for (const [index, driver] of firstScoredRace.drivers.entries()) {
    await expect(drivers.nth(index).locator('h5')).toContainText(driver.name);
    await expect(drivers.nth(index).locator('.breakdown-entity-points strong'))
      .toHaveText(signedPoints(driver.totalPoints));
  }

  const constructors = constructorSection.locator('.breakdown-entity');
  await expect(constructors).toHaveCount(firstScoredRace.constructors.length);
  for (const [index, constructor] of firstScoredRace.constructors.entries()) {
    await expect(constructors.nth(index).locator('h5')).toContainText(constructor.name);
    await expect(constructors.nth(index).locator('.breakdown-entity-points strong'))
      .toHaveText(signedPoints(constructor.totalPoints));
  }

  await page.waitForLoadState('networkidle');
  assertHealthy();
});

test('site mode sends each root URL to the correct experience', async ({ page }) => {
  const assertHealthy = await monitorPage(page);

  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard\.html$/);
  await expect(page.locator('h1')).toHaveText('League standings');

  await page.goto('http://127.0.0.1:3457/');
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator('#screen-welcome')).toHaveClass(/active/);
  await expect(page.locator('#btn-play')).toBeDisabled();

  await page.waitForLoadState('networkidle');
  assertHealthy();
});
