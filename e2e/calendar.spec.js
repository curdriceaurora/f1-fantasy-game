import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { monitorPage } from './helpers.js';

function readJson(path) {
  return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8'));
}

// The rules-page calendar grid is rendered client-side from /api/dashboard/calendar,
// which is sourced from this config — so the committed calendar is the source of truth.
const calendar = readJson('season/config/2026-calendar.json');
const chronological = [...calendar].sort((left, right) => new Date(left.date) - new Date(right.date));
const activeRaces = chronological.filter((race) => race.status !== 'cancelled');
const cancelledRaces = chronological.filter((race) => race.status === 'cancelled');
const rescheduledRaces = chronological.filter((race) => race.status === 'rescheduled');

test('calendar grid renders every race from config in date order', async ({ page }) => {
  const assertHealthy = await monitorPage(page);

  await page.goto('/rules.html');

  const items = page.locator('#calendar-grid .calendar-item');
  await expect(items).toHaveCount(chronological.length);
  await expect(items.first().locator('.race-country')).toContainText(chronological[0].name);
  await expect(items.last().locator('.race-country')).toContainText(chronological[chronological.length - 1].name);
  await expect(page.locator('#calendar-count')).toHaveText(String(activeRaces.length));

  await page.waitForLoadState('networkidle');
  assertHealthy();
});

test('cancelled races render as visually inactive', async ({ page }) => {
  const assertHealthy = await monitorPage(page);
  expect(cancelledRaces.length).toBeGreaterThan(0);

  await page.goto('/rules.html');

  const cancelledItems = page.locator('#calendar-grid .calendar-item.cancelled');
  await expect(cancelledItems).toHaveCount(cancelledRaces.length);
  for (const race of cancelledRaces) {
    const item = page.locator('#calendar-grid .calendar-item.cancelled', { hasText: race.name });
    await expect(item.locator('.cancelled-badge')).toHaveText(/cancelled/i);
  }

  await page.waitForLoadState('networkidle');
  assertHealthy();
});

test('rescheduled races show a rescheduled badge and relocated venue', async ({ page }) => {
  const assertHealthy = await monitorPage(page);
  expect(rescheduledRaces.length).toBeGreaterThan(0);

  await page.goto('/rules.html');

  for (const race of rescheduledRaces) {
    const item = page.locator('#calendar-grid .calendar-item', { hasText: race.name });
    await expect(item.locator('.rescheduled-badge')).toHaveText(/rescheduled/i);
    if (race.venue) await expect(item).toContainText(race.venue);
  }

  await page.waitForLoadState('networkidle');
  assertHealthy();
});

// No race is currently postponed, so mock the endpoint to verify the distinct
// treatment renders whenever that status is next used.
test('a postponed race renders a distinct inactive treatment', async ({ page }) => {
  const assertHealthy = await monitorPage(page);

  await page.route('**/api/dashboard/calendar', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      activeCount: 1,
      races: [{
        id: 'test-postponed', round: 1, name: 'Test Grand Prix', date: null,
        flag: '🏁', isSprintWeekend: false, status: 'postponed', venue: null,
      }],
    }),
  }));

  await page.goto('/rules.html');

  const item = page.locator('#calendar-grid .calendar-item.postponed', { hasText: 'Test Grand Prix' });
  await expect(item).toHaveCount(1);
  await expect(item.locator('.postponed-badge')).toHaveText(/postponed/i);
  await expect(item.locator('.race-date')).toHaveText('Postponed — date TBC');

  await page.waitForLoadState('networkidle');
  assertHealthy();
});
