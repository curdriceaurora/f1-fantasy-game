import { test, expect } from '@playwright/test';
import { monitorPage } from './helpers.js';

test.describe('mobile tank aiming', () => {
  async function enterGame(page) {
    const assertHealthy = await monitorPage(page);
    await page.goto('http://127.0.0.1:3457/index.html');
    await page.locator('#input-name').fill('Lewis Hamilton');
    await page.locator('#btn-play').click();
    await expect(page.locator('#screen-game')).toHaveClass(/active/);
    return assertHealthy;
  }

  async function dispatchTouch(page, type, x, y) {
    await page.locator('#game-canvas').dispatchEvent(type, {
      touches: ['touchend', 'touchcancel'].includes(type)
        ? []
        : [{ identifier: 1, clientX: x, clientY: y }],
      changedTouches: [{ identifier: 1, clientX: x, clientY: y }],
    });
  }

  test('ignores drags that start outside the tank activation radius', async ({ page }) => {
    const assertHealthy = await enterGame(page);
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    const angle = page.locator('#slider-angle');
    const power = page.locator('#slider-power');
    const initialAngle = await angle.inputValue();
    const initialPower = await power.inputValue();

    await dispatchTouch(page, 'touchstart', box.x + box.width * 0.8, box.y + 20);
    await dispatchTouch(page, 'touchmove', box.x + box.width * 0.6, box.y + 80);

    await expect(angle).toHaveValue(initialAngle);
    await expect(power).toHaveValue(initialPower);
    assertHealthy();
  });

  test('syncs a direct canvas aim and launches the projectile', async ({ page }) => {
    const assertHealthy = await enterGame(page);
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    const origin = await canvas.evaluate(element => {
      return {
        x: Number(element.dataset.aimOriginX),
        y: Number(element.dataset.aimOriginY),
      };
    });

    // Start close to the rendered car, then drag up and right.
    const target = { x: origin.x + 100, y: Math.max(1, origin.y - 60) };
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const expectedAngle = Math.round(Math.min(85, Math.max(5,
      Math.atan2(-dy, dx) * (180 / Math.PI))));
    const expectedPower = Math.round(Math.min(100, Math.max(1, Math.hypot(dx, dy) / 2)));
    await dispatchTouch(page, 'touchstart', box.x + origin.x, box.y + origin.y);
    await dispatchTouch(page, 'touchmove', box.x + target.x, box.y + target.y);

    await expect(page.locator('#slider-angle')).toHaveValue(String(expectedAngle));
    await expect(page.locator('#slider-power')).toHaveValue(String(expectedPower));
    const angle = await page.locator('#slider-angle').inputValue();
    const power = await page.locator('#slider-power').inputValue();
    await expect(page.locator('#val-angle')).toHaveText(`${angle}°`);
    await expect(page.locator('#val-power')).toHaveText(`${power}%`);

    const fire = page.locator('#btn-fire');
    await expect(fire).toBeEnabled();
    await expect(fire).toHaveCSS('min-height', '52px');
    await fire.click();
    await expect(fire).toBeDisabled();
    assertHealthy();
  });

  test('cancels the preview when the touch leaves the top boundary', async ({ page }) => {
    const assertHealthy = await enterGame(page);
    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    const origin = await canvas.evaluate(element => ({
      x: Number(element.dataset.aimOriginX),
      y: Number(element.dataset.aimOriginY),
    }));
    const originX = box.x + origin.x;
    const originY = box.y + origin.y;

    await dispatchTouch(page, 'touchstart', originX, originY);
    await dispatchTouch(page, 'touchmove', originX + 60, box.y - 1);
    await dispatchTouch(page, 'touchmove', originX + 100, originY - 100);

    await expect(page.locator('#slider-angle')).toHaveValue('45');
    await expect(page.locator('#slider-power')).toHaveValue('50');

    await dispatchTouch(page, 'touchstart', originX, originY);
    await dispatchTouch(page, 'touchcancel', originX, originY);
    await dispatchTouch(page, 'touchmove', originX + 80, originY - 120);
    await expect(page.locator('#slider-angle')).toHaveValue('45');
    await expect(page.locator('#slider-power')).toHaveValue('50');
    assertHealthy();
  });
});
