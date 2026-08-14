import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Applicability moved out of the specs and into the filename, selected by
// per-project `testMatch` in playwright.config.js. That removes 32 runtime skips,
// but it introduces a quiet failure of its own: a spec whose suffix matches no
// project simply never runs, and a suite that silently stops executing a file
// looks exactly like one that passes.
//
// So the naming convention is enforced rather than documented. These are unit
// tests, not Playwright ones, so a misnamed spec fails `npm test` immediately
// instead of waiting for an e2e run nobody reads closely.

const E2E_DIR = 'e2e';
const SUFFIXES = ['shared', 'desktop', 'mobile', 'iphone'];
const SPEC = /\.(shared|desktop|mobile|iphone)\.spec\.js$/;

function specFiles() {
  return readdirSync(E2E_DIR).filter((name) => name.endsWith('.spec.js'));
}

test('every e2e spec declares its applicability in the filename', () => {
  const misnamed = specFiles().filter((name) => !SPEC.test(name));
  assert.deepEqual(
    misnamed,
    [],
    `spec(s) with no recognised applicability suffix (${SUFFIXES.join(', ')}) would match no project and never run`,
  );
});

test('every applicability suffix is claimed by at least one project', () => {
  // Guards the other direction: a suffix used by a spec but absent from the
  // config is the same silent non-execution, approached from the config side.
  const config = readFileSync('playwright.config.js', 'utf8');
  for (const suffix of SUFFIXES) {
    assert.match(
      config,
      new RegExp(`\\*\\*/\\*\\.${suffix}\\.spec\\.js`),
      `suffix "${suffix}" is not referenced by any project testMatch`,
    );
  }
});

test('no spec still guards applicability at runtime', () => {
  // The thing this change removed. A reintroduced project guard would restore the
  // skips and put the mapping back somewhere only readable test-by-test.
  const offenders = specFiles().filter((name) => {
    const source = readFileSync(join(E2E_DIR, name), 'utf8');
    return /test\.skip\(\s*!?testInfo\.project\.name/.test(source);
  });
  assert.deepEqual(offenders, [], 'applicability belongs in the filename suffix, not in a runtime test.skip');
});
