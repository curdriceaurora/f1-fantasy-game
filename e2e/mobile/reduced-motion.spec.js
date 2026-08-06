import { test, expect } from '@playwright/test';
import { monitorPage } from '../helpers.js';

// The rules sub-navigation only slides on the mobile shell, so its
// reduced-motion behavior lives here rather than in the shared suite.
test('honors reduced motion when hiding the rules sub-navigation', async ({ page }) => {
  const assertHealthy = await monitorPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:3456/rules.html');

  await page.locator('.rules-nav').evaluate(element => element.classList.add('rules-nav-hidden'));
  await expect(page.locator('.rules-nav')).toHaveCSS('transition-duration', '0s');

  assertHealthy();
});
