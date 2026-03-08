import { cpSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

export function historicalFixturePath(year) {
  return join(ROOT, 'test', 'fixtures', 'historical-seasons', String(year));
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export async function withFixtureSeason(year, callback) {
  const sourceRoot = historicalFixturePath(year);
  const workingRoot = mkdtempSync(join(tmpdir(), `f1-fixture-${year}-`));
  cpSync(sourceRoot, workingRoot, { recursive: true });

  const previousSeasonDir = process.env.F1_FANTASY_SEASON_DIR;
  process.env.F1_FANTASY_SEASON_DIR = join(workingRoot, 'season');

  try {
    return await callback({
      workingRoot,
      seasonDir: process.env.F1_FANTASY_SEASON_DIR,
    });
  } finally {
    if (previousSeasonDir == null) {
      delete process.env.F1_FANTASY_SEASON_DIR;
    } else {
      process.env.F1_FANTASY_SEASON_DIR = previousSeasonDir;
    }
    rmSync(workingRoot, { recursive: true, force: true });
  }
}
