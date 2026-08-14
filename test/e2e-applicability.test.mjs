import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import playwrightConfig from '../playwright.config.js';

// Applicability moved out of the specs and into the filename, selected by
// per-project `testMatch` in playwright.config.js. That removes 32 runtime skips,
// but it introduces quieter failures of its own, and each one below is a way the
// suite can stop covering something while every automated check stays green:
//
//   - a spec whose suffix matches no project simply never runs;
//   - a suffix claimed by the *wrong* project keeps the totals identical while
//     silently changing which device a scenario is exercised on;
//   - a misnamed spec in a subdirectory is invisible to a non-recursive check,
//     though Playwright's own discovery is recursive.
//
// These are unit tests rather than Playwright ones, so any of the above fails
// `npm test` immediately instead of waiting for an e2e run nobody reads closely.

const E2E_DIR = 'e2e';
const SUFFIXES = ['shared', 'desktop', 'mobile', 'iphone'];
const SPEC = /\.(shared|desktop|mobile|iphone)\.spec\.js$/;

// The matrix, pinned. Deliberately written out here rather than imported from a
// shared constant: a single source both sides read would let the config and its
// test drift together, which is precisely the mistake this guards. Moving a
// suffix between projects must fail here.
const EXPECTED_TEST_MATCH = {
  chromium: ['**/*.desktop.spec.js', '**/*.shared.spec.js'],
  'mobile-iphone-14': ['**/*.iphone.spec.js', '**/*.mobile.spec.js', '**/*.shared.spec.js'],
  'mobile-pixel-7': ['**/*.mobile.spec.js', '**/*.shared.spec.js'],
};

// Playwright discovers specs recursively under testDir, so this must too — a
// misnamed spec one directory down would otherwise be excluded by testMatch
// without anything noticing.
function specFiles(directory = E2E_DIR, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return specFiles(join(directory, entry.name), `${prefix}${entry.name}/`);
    return entry.name.endsWith('.spec.js') ? [`${prefix}${entry.name}`] : [];
  });
}

test('every e2e spec declares its applicability in the filename', () => {
  const misnamed = specFiles().filter((name) => !SPEC.test(name));
  assert.deepEqual(
    misnamed,
    [],
    `spec(s) with no recognised applicability suffix (${SUFFIXES.join(', ')}) would match no project and never run`,
  );
});

test('spec discovery matches Playwright, including nested directories', () => {
  // Pins the recursion itself. A flat readdirSync would return only the top level
  // and quietly stop guarding anything filed under a feature directory later.
  assert.equal(playwrightConfig.testDir, './e2e');
  const nested = specFiles().filter((name) => name.includes('/'));
  for (const name of nested) assert.match(name, SPEC, `nested spec ${name} must still carry a suffix`);
  assert.ok(specFiles().length > 0);
});

test('each project claims exactly the suffixes it should', () => {
  // The failure this exists for: moving the iPhone suffix to the Pixel project
  // leaves the total at 76 and every test passing, while the matrix silently
  // shifts from 21/33/22 to 21/22/33. Totals cannot see that; this can.
  const actual = Object.fromEntries(
    playwrightConfig.projects.map((project) => [project.name, [...project.testMatch].sort()]),
  );
  const expected = Object.fromEntries(
    Object.entries(EXPECTED_TEST_MATCH).map(([name, globs]) => [name, [...globs].sort()]),
  );
  assert.deepEqual(actual, expected);
});

test('every applicability suffix is claimed by at least one project', () => {
  const claimed = new Set(playwrightConfig.projects.flatMap((project) => project.testMatch));
  for (const suffix of SUFFIXES) {
    assert.ok(
      claimed.has(`**/*.${suffix}.spec.js`),
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
