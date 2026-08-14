import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
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

// Both filter-based tests below reduce to `assert.deepEqual([], [])` if discovery
// returns nothing, so they would pass while guarding an empty set. Asserting the
// set is non-empty first is the difference between checking every spec and
// checking no specs — the same vacuity that made the recursion test hollow.
function discoveredSpecs() {
  const files = specFiles();
  assert.ok(files.length > 0, 'no e2e specs discovered — these guards would pass vacuously');
  return files;
}

test('every e2e spec declares its applicability in the filename', () => {
  const misnamed = discoveredSpecs().filter((name) => !SPEC.test(name));
  assert.deepEqual(
    misnamed,
    [],
    `spec(s) with no recognised applicability suffix (${SUFFIXES.join(', ')}) would match no project and never run`,
  );
});

test('spec discovery recurses, matching Playwright\'s own testDir walk', () => {
  // Built against a fixture tree rather than against e2e/, which has no nested
  // specs today. Filtering the real directory for nested paths iterates zero
  // times and passes whether or not specFiles recurses at all — a guard that
  // asserts nothing while looking like it asserts something.
  assert.equal(playwrightConfig.testDir, './e2e');

  const root = mkdtempSync(join(tmpdir(), 'e2e-discovery-'));
  try {
    writeFileSync(join(root, 'top.shared.spec.js'), '');
    mkdirSync(join(root, 'feature', 'deep'), { recursive: true });
    writeFileSync(join(root, 'feature', 'example.iphone.spec.js'), '');
    writeFileSync(join(root, 'feature', 'deep', 'buried.mobile.spec.js'), '');
    writeFileSync(join(root, 'feature', 'notes.md'), '');

    assert.deepEqual(specFiles(root).sort(), [
      'feature/deep/buried.mobile.spec.js',
      'feature/example.iphone.spec.js',
      'top.shared.spec.js',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
  const offenders = discoveredSpecs().filter((name) => {
    const source = readFileSync(join(E2E_DIR, name), 'utf8');
    return /test\.skip\(\s*!?testInfo\.project\.name/.test(source);
  });
  assert.deepEqual(offenders, [], 'applicability belongs in the filename suffix, not in a runtime test.skip');
});
