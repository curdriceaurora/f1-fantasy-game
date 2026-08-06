/* global getComputedStyle */
import { test, expect } from '@playwright/test';
import { monitorPage } from '../helpers.js';

const CALCULATOR_URL = 'http://127.0.0.1:3457/calculator.html';

test.describe('mobile prediction sliders', () => {
  test('exposes synchronized ARIA values and semantic step controls', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    await page.goto(CALCULATOR_URL);

    const classified = page.locator('#cs-classified');
    await expect(classified).toHaveAttribute('role', 'slider');
    await expect(classified).toHaveAttribute('aria-valuemin', '0');
    await expect(classified).toHaveAttribute('aria-valuemax', '528');
    await expect(classified).toHaveAttribute('aria-valuenow', '440');

    const classifiedPlus = page.locator('#cs-classified + .btn-plus');
    const plusBox = await classifiedPlus.boundingBox();
    expect(plusBox.width).toBeGreaterThanOrEqual(44);
    expect(plusBox.height).toBeGreaterThanOrEqual(44);
    await classifiedPlus.click();
    await expect(classified).toHaveAttribute('aria-valuenow', '441');
    await expect(page.locator('#pred-classified-val')).toHaveText('441');

    const colapinto = page.locator('#cs-colapinto');
    await expect(colapinto).toHaveAttribute('role', 'slider');
    await expect(colapinto).toHaveAttribute('aria-valuenow', '12');
    await expect(colapinto).toHaveAttribute('aria-valuetext', 'Position 12');

    await page.locator('#cs-colapinto + .btn-plus').click();
    await expect(colapinto).toHaveAttribute('aria-valuenow', '11');
    await expect(colapinto).toHaveAttribute('aria-valuetext', 'Position 11');
    await expect(page.locator('#pred-cola-val')).toHaveText('P11');

    assertHealthy();
  });

  test('applies logical keyboard semantics to standard and inverted values', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    await page.goto(CALCULATOR_URL);

    const classified = page.locator('#cs-classified');
    await classified.focus();
    await page.keyboard.press('ArrowRight');
    await expect(classified).toHaveAttribute('aria-valuenow', '441');

    const colapinto = page.locator('#cs-colapinto');
    await colapinto.focus();
    await page.keyboard.press('ArrowRight');
    await expect(colapinto).toHaveAttribute('aria-valuenow', '11');
    await page.keyboard.press('ArrowLeft');
    await expect(colapinto).toHaveAttribute('aria-valuenow', '12');
    await page.keyboard.press('Home');
    await expect(colapinto).toHaveAttribute('aria-valuenow', '22');
    const worstPositionTooltip = await page.locator('#pred-cola-val').boundingBox();
    expect(worstPositionTooltip.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('End');
    await expect(colapinto).toHaveAttribute('aria-valuenow', '1');
    const bestPositionTooltip = await page.locator('#pred-cola-val').boundingBox();
    expect(bestPositionTooltip.x + bestPositionTooltip.width)
      .toBeLessThanOrEqual(page.viewportSize().width);

    assertHealthy();
  });

  test('positions the visible tooltip above the focused thumb', async ({ page }) => {
    const assertHealthy = await monitorPage(page);
    await page.goto(CALCULATOR_URL);

    const slider = page.locator('#cs-classified');
    const tooltip = page.locator('#pred-classified-val');
    const thumb = slider.locator('.cs-thumb');
    await slider.focus();
    await expect(tooltip).toBeVisible();

    const position = await tooltip.evaluate((element) => getComputedStyle(element).top);
    expect(position).toBe('-36px');
    const tooltipBox = await tooltip.boundingBox();
    const thumbBox = await thumb.boundingBox();
    expect(tooltipBox.y + tooltipBox.height).toBeLessThan(thumbBox.y);

    assertHealthy();
  });
});
