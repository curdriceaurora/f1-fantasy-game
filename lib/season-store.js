import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { evaluateRaceWorkflow } from './race-workflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const CALENDAR_FILE_PATTERN = /^(\d{4})-calendar\.json$/;

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
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, data) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export function removeFile(filePath) {
  rmSync(filePath, { force: true });
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

function listCalendarFiles() {
  const configDir = seasonPaths().config;
  if (!existsSync(configDir)) {
    return [];
  }

  return readdirSync(configDir)
    .map((fileName) => {
      const match = fileName.match(CALENDAR_FILE_PATTERN);
      if (!match) return null;
      return { fileName, year: Number.parseInt(match[1], 10) };
    })
    .filter(Boolean)
    .sort((left, right) => right.year - left.year);
}

export function resolveCalendarFileName(now = new Date()) {
  const configuredYear = process.env.F1_FANTASY_SEASON_YEAR;
  if (configuredYear != null && configuredYear !== '') {
    if (!/^\d{4}$/.test(String(configuredYear))) {
      throw new Error(`Invalid F1_FANTASY_SEASON_YEAR "${configuredYear}". Expected a four-digit year.`);
    }

    const configuredFileName = `${configuredYear}-calendar.json`;
    if (!existsSync(configPath(configuredFileName))) {
      throw new Error(`Configured calendar file "${configuredFileName}" was not found in season/config.`);
    }
    return configuredFileName;
  }

  const files = listCalendarFiles();
  if (!files.length) {
    return null;
  }

  const currentYear = now.getUTCFullYear();
  const currentYearFile = files.find((entry) => entry.year === currentYear);
  if (currentYearFile) {
    return currentYearFile.fileName;
  }

  return files[0].fileName;
}

// Sort key for a calendar entry: its running date, falling back to the original
// date for a race with no confirmed new one (postponed). A race with neither date
// sorts to the end rather than to 1970 (which `new Date(null)` would produce).
function calendarDateKey(race) {
  const date = race.date ?? race.originalDate;
  const time = date ? new Date(date).getTime() : NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function loadCalendar() {
  const calendarFileName = resolveCalendarFileName();
  if (!calendarFileName) {
    return [];
  }
  const calendar = readJson(configPath(calendarFileName), []);
  if (!Array.isArray(calendar)) return [];
  // Order by date so no consumer depends on the physical JSON order. A race whose
  // date changes (e.g. a mid-season reschedule) is then re-sequenced everywhere —
  // the schedule grid, the dashboard "next race", and the scoreboard — automatically.
  // Ties (and undated races) fall back to round for a deterministic order.
  return [...calendar].sort((left, right) => {
    const leftDate = calendarDateKey(left);
    const rightDate = calendarDateKey(right);
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    const leftRound = left.round ?? Number.POSITIVE_INFINITY;
    const rightRound = right.round ?? Number.POSITIVE_INFINITY;
    if (leftRound !== rightRound) return leftRound < rightRound ? -1 : 1;
    return 0;
  });
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
