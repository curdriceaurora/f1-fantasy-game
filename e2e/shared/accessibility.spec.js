/* global getComputedStyle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { monitorPage } from '../helpers.js';

const leader = JSON.parse(
  readFileSync(join(process.cwd(), 'season/scored/standings.json'), 'utf8'),
).standings[0];

const pages = [
  'http://127.0.0.1:3457/index.html',
  'http://127.0.0.1:3457/calculator.html',
  'http://127.0.0.1:3456/dashboard.html',
  `http://127.0.0.1:3456/team.html?team=${encodeURIComponent(leader.teamId)}`,
  'http://127.0.0.1:3456/rules.html',
];

test.describe('core accessibility', () => {
  test('provides a keyboard-operable skip link on every primary page', async ({ page }) => {
    const assertHealthy = await monitorPage(page);

    for (const url of pages) {
      await page.goto(url);
      const skipLink = page.locator('.skip-link');
      const main = page.locator('#main-content');
      await expect(skipLink).toHaveCount(1);
      await expect(main).toHaveCount(1);

      await page.keyboard.press('Tab');
      await expect(skipLink).toBeFocused();
      await expect.poll(async () => (await skipLink.boundingBox()).y)
        .toBeGreaterThanOrEqual(0);

      await page.keyboard.press('Enter');
      await expect(main).toBeFocused();
      await expect(page).toHaveURL(/#main-content$/);
    }

    assertHealthy();
  });

  test('announces calculator status through one consolidated live region', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    await page.goto('http://127.0.0.1:3457/calculator.html');

    const status = page.locator('#calc-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveAttribute('aria-atomic', 'true');
    await expect(page.locator('#calc-spent')).not.toHaveAttribute('aria-live');

    assertHealthy();
  });

  test('exposes welcome validation state without changing its rules', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    await page.goto('http://127.0.0.1:3457/index.html');

    const name = page.locator('#input-name');
    await expect(name).toHaveAttribute('aria-describedby', 'validation-msg');
    await expect(page.locator('#input-team')).toHaveAttribute('aria-describedby', 'validation-msg');
    await expect(page.locator('#validation-msg')).toHaveAttribute('role', 'status');
    await expect(name).toHaveAttribute('aria-invalid', 'false');

    await name.focus();
    await page.keyboard.press('Tab');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await name.fill('A');
    await expect(name).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('#btn-play')).toBeEnabled();

    assertHealthy();
  });

  test('honors reduced-motion preferences for animated UI feedback', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:3457/index.html');

    await expect(page.locator('html')).toHaveCSS('--text-muted', '#8c8ca6');
    const hintAnimation = await page.locator('.investment-hint')
      .evaluate(element => getComputedStyle(element).animationName);
    expect(hintAnimation).toBe('none');

    await page.locator('#btn-regen-team').hover();
    await expect(page.locator('#btn-regen-team')).toHaveCSS('transform', 'none');

    await page.goto(`http://127.0.0.1:3456/team.html?team=${encodeURIComponent(leader.teamId)}`);
    const detailArrowTransition = await page.locator('.race-item summary').first()
      .evaluate(element => getComputedStyle(element, '::after').transitionDuration);
    expect(detailArrowTransition).toBe('0s');
    await page.locator('.race-item summary').first().click();
    const detailArrowTransform = await page.locator('.race-item summary').first()
      .evaluate(element => getComputedStyle(element, '::after').transform);
    expect(detailArrowTransform).toBe('none');

    assertHealthy();
  });
});
