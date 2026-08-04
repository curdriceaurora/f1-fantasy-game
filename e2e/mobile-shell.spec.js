/* global document, window, getComputedStyle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { monitorPage } from './helpers.js';

const leader = JSON.parse(
  readFileSync(join(process.cwd(), 'season/scored/standings.json'), 'utf8'),
).standings[0];

const mobilePages = [
  'http://127.0.0.1:3457/index.html',
  'http://127.0.0.1:3457/calculator.html',
  'http://127.0.0.1:3456/dashboard.html',
  `http://127.0.0.1:3456/team.html?team=${encodeURIComponent(leader.teamId)}`,
  'http://127.0.0.1:3456/rules.html',
];

test.describe('mobile navigation shell', () => {
  test('uses a 50px safe-area-aware header and prevents horizontal overflow', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile project only');
    const assertHealthy = await monitorPage(page);

    for (const url of mobilePages) {
      await page.goto(url);
      await expect(page.locator('.mobile-menu-btn')).toBeVisible();

      const headerContentHeight = await page.locator('.site-banner').evaluate((header) => {
        const style = getComputedStyle(header);
        return header.getBoundingClientRect().height
          - parseFloat(style.paddingTop)
          - parseFloat(style.paddingBottom)
          - parseFloat(style.borderTopWidth)
          - parseFloat(style.borderBottomWidth);
      });
      expect(headerContentHeight).toBeCloseTo(50, 0);

      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow, `${url} should not scroll horizontally`).toBe(false);
    }

    await page.waitForLoadState('networkidle');
    assertHealthy();
  });

  test('traps focus in the drawer and restores it after Escape', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile project only');
    const assertHealthy = await monitorPage(page);
    await page.goto('http://127.0.0.1:3457/index.html');

    const menuButton = page.locator('.mobile-menu-btn');
    const drawer = page.locator('#mobile-nav-drawer');
    await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer).toBeVisible();
    await expect(page.locator('.mobile-drawer-close')).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.mobile-drawer-links a').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.mobile-drawer-close')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(menuButton).toBeFocused();

    assertHealthy();
  });

  test('hides the rules sub-navigation on downward scroll and reveals it upward', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile-'), 'mobile project only');
    const assertHealthy = await monitorPage(page);
    await page.goto('http://127.0.0.1:3456/rules.html');
    const rulesNav = page.locator('.rules-nav');

    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(rulesNav).toHaveClass(/rules-nav-hidden/);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(rulesNav).not.toHaveClass(/rules-nav-hidden/);

    assertHealthy();
  });
});

test('desktop navigation remains visible and unchanged', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'desktop project only');
  const assertHealthy = await monitorPage(page);
  await page.goto('http://127.0.0.1:3456/dashboard.html');

  await expect(page.locator('.global-nav')).toBeVisible();
  await expect(page.locator('.global-nav')).toHaveCSS('display', 'flex');
  await expect(page.locator('.mobile-menu-btn')).toBeHidden();
  await expect(page.locator('.site-banner')).toHaveCSS('position', 'fixed');

  assertHealthy();
});
