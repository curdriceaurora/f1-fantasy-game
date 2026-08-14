/* global document, window */
import { test, expect } from '@playwright/test';
import { monitorPage } from './helpers.js';

const CALCULATOR_URL = 'http://127.0.0.1:3457/calculator.html';

async function scrollPastReceipt(page) {
  const receipt = page.locator('.calc-totals-receipt');
  await receipt.scrollIntoViewIfNeeded();
  await expect(receipt).toBeInViewport();
  await page.evaluate(() => new Promise(resolve => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  }));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

test.describe('mobile calculator', () => {
  test('selects a driver through an accessible bottom sheet', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    await page.goto(CALCULATOR_URL);

    const trigger = page.locator('#cs-driver-1 .cs-trigger');
    const sheet = page.locator('#cs-bottom-sheet');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await trigger.click();

    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('.cs-sheet-close')).toBeFocused();
    await expect(page.locator('body')).toHaveClass(/calc-sheet-open/);

    await page.keyboard.press('Shift+Tab');
    await expect(sheet.locator('.cs-option').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator('.cs-sheet-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await sheet.locator('.cs-driver-opt', { hasText: 'Charles Leclerc' }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText('Charles Leclerc');
    await expect(page.locator('#cost-d1')).toHaveText('£11m');
    await expect(page.locator('body')).not.toHaveClass(/calc-sheet-open/);

    assertHealthy();
  });

  test('shows normal, optimal, and over-budget sticky states', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    const stickyBar = page.locator('#sticky-budget-bar');

    await page.goto(CALCULATOR_URL);
    await scrollPastReceipt(page);
    await expect(stickyBar).toBeVisible();
    await expect(stickyBar).toHaveAttribute('data-state', 'normal');
    await expect(stickyBar).toHaveText('£0m / £50m · +25 pts/race');

    await page.goto(`${CALCULATOR_URL}?d1=2&d2=4&d3=5`);
    await expect(page.locator('#calc-spent')).toHaveText('£48m / £50m');
    await scrollPastReceipt(page);
    await expect(stickyBar).toBeVisible();
    await expect(stickyBar).toHaveAttribute('data-state', 'optimal');
    await expect(stickyBar).toHaveText('£48m / £50m · +1 pts/race ✅ OK');

    await page.goto(`${CALCULATOR_URL}?d1=2&d2=4&d3=5&t1=2`);
    await expect(page.locator('#calc-spent')).toHaveText('£63m / £50m');
    await scrollPastReceipt(page);
    await expect(stickyBar).toBeVisible();
    await expect(stickyBar).toHaveAttribute('data-state', 'over');
    await expect(stickyBar).toHaveText('❌ Over budget by £13m');

    assertHealthy();
  });
});
