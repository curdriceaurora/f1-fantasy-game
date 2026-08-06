import { test, expect } from '@playwright/test';
import { monitorPage } from '../helpers.js';

test('desktop navigation remains visible and unchanged', async ({ page }) => {
  const assertHealthy = await monitorPage(page);
  await page.goto('http://127.0.0.1:3456/dashboard.html');

  await expect(page.locator('.global-nav')).toBeVisible();
  await expect(page.locator('.global-nav')).toHaveCSS('display', 'flex');
  await expect(page.locator('.mobile-menu-btn')).toBeHidden();
  await expect(page.locator('.site-banner')).toHaveCSS('position', 'fixed');

  assertHealthy();
});
