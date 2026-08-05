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
