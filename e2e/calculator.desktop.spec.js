import { test, expect } from '@playwright/test';
import { monitorPage } from './helpers.js';

const CALCULATOR_URL = 'http://127.0.0.1:3457/calculator.html';

test('keeps the existing anchored dropdown behavior on desktop', async ({ page }) => {
  const assertHealthy = await monitorPage(page);
  await page.goto(CALCULATOR_URL);

  const trigger = page.locator('#cs-driver-1 .cs-trigger');
  const panel = page.locator('#cs-driver-1 .cs-panel');
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  await trigger.click();

  await expect(panel).toBeVisible();
  await expect(page.locator('#cs-bottom-sheet')).toBeHidden();
  await panel.locator('.cs-driver-opt', { hasText: 'Charles Leclerc' }).click();
  await expect(trigger).toContainText('Charles Leclerc');
  await expect(page.locator('#cost-d1')).toHaveText('£11m');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

  assertHealthy();
});

test('ignores malformed or out-of-range URL prefill indices', async ({ page }) => {
  const assertHealthy = await monitorPage(page);
  await page.goto(`${CALCULATOR_URL}?d1=-1&d2=invalid&d3=999&t1=-1&t2=NaN&t3=999`);

  await expect(page.locator('#calc-spent')).toHaveText('£0m / £50m');
  await expect(page.locator('.cs-driver-opt.cs-selected')).toHaveCount(0);
  await expect(page.locator('.cs-team-opt.cs-selected')).toHaveCount(0);
  await expect(page).toHaveURL(CALCULATOR_URL);

  assertHealthy();
});
