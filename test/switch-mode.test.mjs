import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const vercelJsonPath = join(projectRoot, 'vercel.json');
const vercelPreseasonPath = join(projectRoot, 'vercel.preseason.json');
const vercelSeasonPath = join(projectRoot, 'vercel.season.json');
const vercelBackupPath = join(projectRoot, 'vercel.json.backup');

test('switch-mode script switches to preseason mode', () => {
  // Backup current vercel.json
  if (existsSync(vercelJsonPath)) {
    const backup = readFileSync(vercelJsonPath, 'utf-8');
    writeFileSync(vercelBackupPath, backup);
  }

  try {
    // Run the switch-mode script
    execSync('node scripts/switch-mode.mjs preseason', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    // Read the updated vercel.json
    const updatedConfig = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));
    const expectedConfig = JSON.parse(readFileSync(vercelPreseasonPath, 'utf-8'));

    // Verify redirects match preseason config
    assert.deepStrictEqual(updatedConfig.redirects, expectedConfig.redirects);
    assert.strictEqual(updatedConfig.redirects[0].destination, '/index.html');
  } finally {
    // Restore backup
    if (existsSync(vercelBackupPath)) {
      const backup = readFileSync(vercelBackupPath, 'utf-8');
      writeFileSync(vercelJsonPath, backup);
      unlinkSync(vercelBackupPath);
    }
  }
});

test('switch-mode script switches to season mode', () => {
  // Backup current vercel.json
  if (existsSync(vercelJsonPath)) {
    const backup = readFileSync(vercelJsonPath, 'utf-8');
    writeFileSync(vercelBackupPath, backup);
  }

  try {
    // Run the switch-mode script
    execSync('node scripts/switch-mode.mjs season', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    // Read the updated vercel.json
    const updatedConfig = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));
    const expectedConfig = JSON.parse(readFileSync(vercelSeasonPath, 'utf-8'));

    // Verify redirects match season config
    assert.deepStrictEqual(updatedConfig.redirects, expectedConfig.redirects);
    assert.strictEqual(updatedConfig.redirects[0].destination, '/dashboard.html');
  } finally {
    // Restore backup
    if (existsSync(vercelBackupPath)) {
      const backup = readFileSync(vercelBackupPath, 'utf-8');
      writeFileSync(vercelJsonPath, backup);
      unlinkSync(vercelBackupPath);
    }
  }
});

test('switch-mode script preserves non-redirect vercel.json config', () => {
  // Backup current vercel.json
  if (existsSync(vercelJsonPath)) {
    const backup = readFileSync(vercelJsonPath, 'utf-8');
    writeFileSync(vercelBackupPath, backup);
  }

  try {
    // Switch to preseason
    execSync('node scripts/switch-mode.mjs preseason', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    const preseasonResult = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));

    // Verify functions and headers are preserved
    assert.ok(preseasonResult.functions, 'functions config should be preserved');
    assert.ok(preseasonResult.headers, 'headers config should be preserved');
    assert.strictEqual(preseasonResult.functions['api/**/*.js'].memory, 256);

    // Switch to season
    execSync('node scripts/switch-mode.mjs season', {
      cwd: projectRoot,
      encoding: 'utf-8',
    });

    const seasonResult = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));

    // Verify functions and headers are preserved
    assert.ok(seasonResult.functions, 'functions config should be preserved');
    assert.ok(seasonResult.headers, 'headers config should be preserved');
    assert.strictEqual(seasonResult.functions['api/**/*.js'].memory, 256);
  } finally {
    // Restore backup
    if (existsSync(vercelBackupPath)) {
      const backup = readFileSync(vercelBackupPath, 'utf-8');
      writeFileSync(vercelJsonPath, backup);
      unlinkSync(vercelBackupPath);
    }
  }
});

test('switch-mode script fails with invalid mode', () => {
  assert.throws(
    () => {
      execSync('node scripts/switch-mode.mjs invalid', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
    },
    {
      message: /Usage/,
    }
  );
});
