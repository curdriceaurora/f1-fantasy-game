// Test site configuration module
import { test } from 'node:test';
import assert from 'node:assert';
import { getSiteMode, isPreseasonMode, isSeasonMode, getDefaultLandingPage, SITE_MODES } from '../lib/site-config.js';

test('getSiteMode returns season by default', () => {
  const originalMode = process.env.SITE_MODE;
  delete process.env.SITE_MODE;

  assert.strictEqual(getSiteMode(), SITE_MODES.SEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  }
});

test('getSiteMode returns preseason when SITE_MODE=preseason', () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'preseason';

  assert.strictEqual(getSiteMode(), SITE_MODES.PRESEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
});

test('getSiteMode returns season when SITE_MODE=season', () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'season';

  assert.strictEqual(getSiteMode(), SITE_MODES.SEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
});

test('getSiteMode defaults to season for invalid mode', () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'invalid-mode';

  assert.strictEqual(getSiteMode(), SITE_MODES.SEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
});

test('isPreseasonMode returns true when in preseason mode', () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'preseason';

  assert.strictEqual(isPreseasonMode(), true);
  assert.strictEqual(isSeasonMode(), false);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
});

test('isSeasonMode returns true when in season mode', () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'season';

  assert.strictEqual(isSeasonMode(), true);
  assert.strictEqual(isPreseasonMode(), false);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
});

test('getDefaultLandingPage returns index.html in preseason mode', () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'preseason';

  assert.strictEqual(getDefaultLandingPage(), '/index.html');

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
});

test('getDefaultLandingPage returns dashboard.html in season mode', () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'season';

  assert.strictEqual(getDefaultLandingPage(), '/dashboard.html');

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
});
