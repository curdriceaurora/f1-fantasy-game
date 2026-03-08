import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { evaluateRaceWorkflow } from './race-workflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

function seasonRoot() {
  const override = process.env.F1_FANTASY_SEASON_DIR;
  if (!override) {
    return join(ROOT, 'season');
  }
  return isAbsolute(override) ? override : resolve(process.cwd(), override);
}

export function seasonPaths() {
  const season = seasonRoot();
  return {
    root: ROOT,
    season,
    config: join(season, 'config'),
    raw: join(season, 'raw'),
    normalized: join(season, 'normalized'),
    scored: join(season, 'scored'),
    scoredTeams: join(season, 'scored', 'teams'),
  };
}

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function ensureSeasonDirs() {
  Object.values(seasonPaths()).forEach((dirPath) => ensureDir(dirPath));
}

export function readJson(filePath, fallback = null) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, data) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export function configPath(fileName) {
  return join(seasonPaths().config, fileName);
}

export function rawRacePath(raceId, fileName) {
  return join(seasonPaths().raw, raceId, fileName);
}

export function normalizedRacePath(raceId) {
  return join(seasonPaths().normalized, `${raceId}.json`);
}

export function scoredRacePath(raceId) {
  return join(seasonPaths().scored, `${raceId}.json`);
}

export function teamScorePath(teamId) {
  return join(seasonPaths().scoredTeams, `${teamId}.json`);
}

export function standingsPath() {
  return join(seasonPaths().scored, 'standings.json');
}

export function loadCalendar() {
  const calendar = readJson(configPath('2026-calendar.json'), []);
  return Array.isArray(calendar) ? calendar : [];
}

export function loadEntries() {
  const entries = readJson(configPath('entries.json'), []);
  return Array.isArray(entries) ? entries : [];
}

export function loadFineDocuments() {
  const fineDocuments = readJson(configPath('fine-documents.json'), {});
  return fineDocuments && typeof fineDocuments === 'object' ? fineDocuments : {};
}

function normalizeFineReviewEntry(raceId, value) {
  if (!value) {
    return {
      raceId,
      reviewed: false,
      documents: [],
      notes: '',
      reviewedAt: null,
    };
  }

  if (Array.isArray(value)) {
    throw new Error(`Fine review config for ${raceId} uses the deprecated array format. Replace it with an object containing "reviewed" and "documents".`);
  }

  if (typeof value !== 'object') {
    throw new Error(`Fine review config for ${raceId} must be an object.`);
  }

  if (!Array.isArray(value.documents)) {
    throw new Error(`Fine review config for ${raceId} must include a "documents" array.`);
  }

  return {
    raceId,
    reviewed: Boolean(value.reviewed),
    documents: value.documents.filter(Boolean),
    notes: value.notes ? String(value.notes) : '',
    reviewedAt: value.reviewedAt ? String(value.reviewedAt) : null,
  };
}

export function loadFineReviews() {
  const raw = readJson(configPath('fine-documents.json'), {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('season/config/fine-documents.json must be an object keyed by race id.');
  }

  return Object.fromEntries(
    Object.entries(raw).map(([raceId, value]) => [raceId, normalizeFineReviewEntry(raceId, value)]),
  );
}

export function loadFineReview(raceId) {
  const fineReviews = loadFineReviews();
  return normalizeFineReviewEntry(raceId, fineReviews[raceId]);
}

export function listNormalizedRaceIds() {
  const paths = seasonPaths();
  if (!existsSync(paths.normalized)) {
    return [];
  }
  return readdirSync(paths.normalized)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => fileName.replace(/\.json$/, ''));
}

export function getRaceStatus(race, now = new Date()) {
  const workflow = evaluateRaceWorkflow({
    race,
    now,
    fineReview: loadFineReview(race.id),
    normalizedExists: existsSync(normalizedRacePath(race.id)),
    scoredExists: existsSync(scoredRacePath(race.id)),
  });
  return workflow.publicStatus;
}
