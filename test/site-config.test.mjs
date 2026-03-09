// Test site configuration module
// These tests modify global state (process.env.SITE_MODE) and should run serially
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSiteMode, isPreseasonMode, isSeasonMode, getDefaultLandingPage, SITE_MODES, resetSiteModeCache } from '../lib/site-config.js';

// Tests that mutate process.env must run serially to avoid race conditions
test('getSiteMode returns season by default', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  delete process.env.SITE_MODE;
  resetSiteModeCache();

  assert.strictEqual(getSiteMode(), SITE_MODES.SEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  }
  resetSiteModeCache();
});

test('getSiteMode returns preseason when SITE_MODE=preseason', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'preseason';
  resetSiteModeCache();

  assert.strictEqual(getSiteMode(), SITE_MODES.PRESEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
  resetSiteModeCache();
});

test('getSiteMode returns season when SITE_MODE=season', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'season';
  resetSiteModeCache();

  assert.strictEqual(getSiteMode(), SITE_MODES.SEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
  resetSiteModeCache();
});

test('getSiteMode defaults to season for invalid mode', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'invalid-mode';
  resetSiteModeCache();

  assert.strictEqual(getSiteMode(), SITE_MODES.SEASON);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
  resetSiteModeCache();
});

test('isPreseasonMode returns true when in preseason mode', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'preseason';
  resetSiteModeCache();

  assert.strictEqual(isPreseasonMode(), true);
  assert.strictEqual(isSeasonMode(), false);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
  resetSiteModeCache();
});

test('isSeasonMode returns true when in season mode', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'season';
  resetSiteModeCache();

  assert.strictEqual(isSeasonMode(), true);
  assert.strictEqual(isPreseasonMode(), false);

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
  resetSiteModeCache();
});

test('getDefaultLandingPage returns index.html in preseason mode', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'preseason';
  resetSiteModeCache();

  assert.strictEqual(getDefaultLandingPage(), '/index.html');

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
  resetSiteModeCache();
});

test('getDefaultLandingPage returns dashboard.html in season mode', { concurrency: false }, () => {
  const originalMode = process.env.SITE_MODE;
  process.env.SITE_MODE = 'season';
  resetSiteModeCache();

  assert.strictEqual(getDefaultLandingPage(), '/dashboard.html');

  if (originalMode !== undefined) {
    process.env.SITE_MODE = originalMode;
  } else {
    delete process.env.SITE_MODE;
  }
  resetSiteModeCache();
});
