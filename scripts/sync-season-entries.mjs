#!/usr/bin/env node

import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { pathToFileURL } from 'url';
import { CANONICAL_DRIVERS, CANONICAL_TEAMS, resolveCircuitId, resolveDriver, resolveTeam } from '../lib/canonical.js';
import { configPath, ensureSeasonDirs, readJson, writeJson } from '../lib/season-store.js';
import { rebuildScoreboard } from '../lib/publish-scoreboard.js';

const DRIVER_COST_BY_ID = new Map(CANONICAL_DRIVERS.map((driver) => [driver.id, Number(driver.cost)]));
const TEAM_COST_BY_ID = new Map(CANONICAL_TEAMS.map((team) => [team.id, Number(team.cost)]));
const BUDGET_CAP = 50;

function normalizeCellValue(value) {
  if (value == null) return null;

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value.formula === 'string') {
    return normalizeCellValue(value.result);
  }

  if (Array.isArray(value.richText)) {
    return value.richText.map((segment) => segment.text || '').join('');
  }

  if (typeof value.text === 'string') {
    return value.text;
  }

  if (typeof value.hyperlink === 'string' && typeof value.text === 'string') {
    return value.text;
  }

  return null;
}

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet('Starting Roster');
  if (!worksheet) {
    throw new Error('Expected a "Starting Roster" worksheet in the roster workbook');
  }

  const rows = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const maxColumns = Math.max(row.cellCount, row.actualCellCount);
    if (maxColumns === 0) {
      rows.push([]);
      continue;
    }

    const normalizedRow = [];
    for (let columnNumber = 1; columnNumber <= maxColumns; columnNumber += 1) {
      normalizedRow.push(normalizeCellValue(row.getCell(columnNumber).value));
    }
    rows.push(normalizedRow);
  }
  return rows;
}

function assertResolvedDriver(value, fieldName, principalName) {
  const driver = resolveDriver(value);
  if (!driver) {
    throw new Error(`Unable to resolve ${fieldName} "${value}" for ${principalName}`);
  }
  return driver.id;
}

function assertResolvedTeam(value, fieldName, principalName) {
  const team = resolveTeam(value);
  if (!team) {
    throw new Error(`Unable to resolve ${fieldName} "${value}" for ${principalName}`);
  }
  return team.id;
}

function sumRosterCost(selectedIds, costLookup, entityLabel, principalName) {
  return selectedIds.reduce((total, id) => {
    const cost = costLookup.get(id);
    if (!Number.isFinite(cost)) {
      throw new Error(`Missing canonical ${entityLabel} cost for ${id} while importing ${principalName}`);
    }
    return total + cost;
  }, 0);
}

function parseWorkbookTotalCost(value, principalName) {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid Total Cost "${value}" for ${principalName}`);
  }
  return numeric;
}

function computeRosterCost(selectedDriverIds, selectedConstructorIds, principalName) {
  return sumRosterCost(selectedDriverIds, DRIVER_COST_BY_ID, 'driver', principalName)
    + sumRosterCost(selectedConstructorIds, TEAM_COST_BY_ID, 'constructor', principalName);
}

function stableSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'team';
}

function normalizeIdentityKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function existingTeamIdLookup(existingEntries = [], selector = (entry) => entry.principalName) {
  const lookup = new Map();
  for (const entry of existingEntries) {
    const identityKey = normalizeIdentityKey(selector(entry));
    if (identityKey && !lookup.has(identityKey) && entry.teamId) {
      lookup.set(identityKey, entry.teamId);
    }
  }
  return lookup;
}

function ensureArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeIdentityKey(value))
    .filter(Boolean);
}

export function normalizeTeamIdMap(rawMap = null) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return { entries: [] };
  }

  const rawEntries = Array.isArray(rawMap.entries) ? rawMap.entries : [];
  const seenTeamIds = new Set();
  const entries = [];

  for (const rawEntry of rawEntries) {
    if (!rawEntry || typeof rawEntry !== 'object' || !rawEntry.teamId) continue;
    if (seenTeamIds.has(rawEntry.teamId)) continue;
    seenTeamIds.add(rawEntry.teamId);
    entries.push({
      teamId: rawEntry.teamId,
      principalKeys: ensureArray(rawEntry.principalKeys),
      displayKeys: ensureArray(rawEntry.displayKeys),
      rowNumbers: Array.isArray(rawEntry.rowNumbers)
        ? rawEntry.rowNumbers.filter((value) => Number.isInteger(value) && value > 0)
        : [],
    });
  }

  return { entries };
}

function buildTeamIdMapIndex(teamIdMap = { entries: [] }) {
  const byTeamId = new Map();
  const byPrincipalKey = new Map();
  const byDisplayKey = new Map();
  const byRowNumber = new Map();

  for (const entry of teamIdMap.entries) {
    byTeamId.set(entry.teamId, entry);
    for (const principalKey of entry.principalKeys) {
      if (!byPrincipalKey.has(principalKey)) {
        byPrincipalKey.set(principalKey, entry.teamId);
      }
    }
    for (const displayKey of entry.displayKeys) {
      if (!byDisplayKey.has(displayKey)) {
        byDisplayKey.set(displayKey, entry.teamId);
      }
    }
    for (const rowNumber of entry.rowNumbers) {
      if (!byRowNumber.has(rowNumber)) {
        byRowNumber.set(rowNumber, entry.teamId);
      }
    }
  }

  return { byTeamId, byPrincipalKey, byDisplayKey, byRowNumber };
}

function upsertTeamIdMapEntry(index, teamId, principalKey, displayKey, rowNumber) {
  let entry = index.byTeamId.get(teamId);
  if (!entry) {
    entry = {
      teamId,
      principalKeys: [],
      displayKeys: [],
      rowNumbers: [],
    };
    index.byTeamId.set(teamId, entry);
  }

  if (principalKey && !entry.principalKeys.includes(principalKey)) {
    entry.principalKeys.push(principalKey);
    if (!index.byPrincipalKey.has(principalKey)) {
      index.byPrincipalKey.set(principalKey, teamId);
    }
  }
  if (displayKey && !entry.displayKeys.includes(displayKey)) {
    entry.displayKeys.push(displayKey);
    if (!index.byDisplayKey.has(displayKey)) {
      index.byDisplayKey.set(displayKey, teamId);
    }
  }
  if (Number.isInteger(rowNumber) && rowNumber > 0 && !entry.rowNumbers.includes(rowNumber)) {
    entry.rowNumbers.push(rowNumber);
    if (!index.byRowNumber.has(rowNumber)) {
      index.byRowNumber.set(rowNumber, teamId);
    }
  }
}

function resolveTeamIdForRow({ principalKey, displayKey, rowNumber }, teamIdMapIndex, fallbackLookups, seenTeamIds) {
  const candidates = [
    teamIdMapIndex.byRowNumber.get(rowNumber),
    teamIdMapIndex.byPrincipalKey.get(principalKey),
    teamIdMapIndex.byDisplayKey.get(displayKey),
    fallbackLookups.byPrincipal.get(principalKey),
    fallbackLookups.byDisplay.get(displayKey),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!seenTeamIds.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function serializeTeamIdMap(teamIdMapIndex) {
  const entries = [...teamIdMapIndex.byTeamId.values()]
    .map((entry) => ({
      teamId: entry.teamId,
      principalKeys: [...entry.principalKeys].sort(),
      displayKeys: [...entry.displayKeys].sort(),
      rowNumbers: [...entry.rowNumbers].sort((left, right) => left - right),
    }))
    .sort((left, right) => left.teamId.localeCompare(right.teamId));

  return { entries };
}

export function createStableTeamId(principalName, existingTeamId = null) {
  if (existingTeamId) {
    return existingTeamId;
  }
  const base = stableSlug(principalName);
  const fingerprint = createHash('sha1')
    .update(normalizeIdentityKey(principalName))
    .digest('hex')
    .slice(0, 8);
  return `${base}-${fingerprint}`;
}

export function buildEntriesWithMap(rows, workbookPath, existingEntries = [], previousTeamIdMap = null) {
  const entries = [];
  const seenTeamIds = new Set();
  const fallbackLookups = {
    byPrincipal: existingTeamIdLookup(existingEntries, (entry) => entry.principalName),
    byDisplay: existingTeamIdLookup(existingEntries, (entry) => entry.displayName),
  };
  const teamIdMapIndex = buildTeamIdMapIndex(normalizeTeamIdMap(previousTeamIdMap));

  for (const existingEntry of existingEntries) {
    upsertTeamIdMapEntry(
      teamIdMapIndex,
      existingEntry.teamId,
      normalizeIdentityKey(existingEntry.principalName),
      normalizeIdentityKey(existingEntry.displayName),
      Number.isInteger(existingEntry?.source?.rowNumber) ? existingEntry.source.rowNumber : null,
    );
  }

  for (let index = 4; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || !row[1] || !row[2]) continue;

    const principalName = String(row[1]).trim();
    const displayName = String(row[2]).trim();
    const principalKey = normalizeIdentityKey(principalName);
    const displayKey = normalizeIdentityKey(displayName);
    const rowNumber = index + 1;

    const selectedDriverIds = [
      assertResolvedDriver(row[3], 'Driver 1', principalName),
      assertResolvedDriver(row[4], 'Driver 2', principalName),
      assertResolvedDriver(row[5], 'Driver 3', principalName),
    ];
    const selectedConstructorIds = [
      assertResolvedTeam(row[6], 'Team 1', principalName),
      assertResolvedTeam(row[7], 'Team 2', principalName),
      assertResolvedTeam(row[8], 'Team 3', principalName),
    ];
    const homeCircuitId = resolveCircuitId(row[9]);
    if (!homeCircuitId) {
      throw new Error(`Unable to resolve Home Circuit "${row[9]}" for ${principalName}`);
    }

    const computedTotalCost = computeRosterCost(selectedDriverIds, selectedConstructorIds, principalName);
    const workbookTotalCost = parseWorkbookTotalCost(row[14], principalName);

    if (workbookTotalCost != null && workbookTotalCost !== computedTotalCost) {
      throw new Error(`Workbook Total Cost mismatch for ${principalName}: workbook shows ${workbookTotalCost} but selected roster costs ${computedTotalCost}`);
    }
    if (computedTotalCost > BUDGET_CAP) {
      throw new Error(`Roster for ${principalName} is over budget: ${computedTotalCost} exceeds £${BUDGET_CAP}m`);
    }

    const investmentBonusPerRace = Math.floor(Math.max(0, BUDGET_CAP - computedTotalCost) / 2);
    const existingTeamId = resolveTeamIdForRow(
      { principalKey, displayKey, rowNumber },
      teamIdMapIndex,
      fallbackLookups,
      seenTeamIds,
    );
    const teamId = createStableTeamId(principalName, existingTeamId || null);
    if (seenTeamIds.has(teamId)) {
      throw new Error(`Duplicate stable team id "${teamId}" generated for ${principalName}. Principal/display names must be unique.`);
    }
    seenTeamIds.add(teamId);
    upsertTeamIdMapEntry(teamIdMapIndex, teamId, principalKey, displayKey, rowNumber);

    entries.push({
      teamId,
      principalName,
      displayName,
      selectedDriverIds,
      selectedConstructorIds,
      homeCircuitId,
      investmentBonusPerRace,
      predictions: {
        totalClassified: Number(row[10] || 0),
        driverChampion: resolveDriver(row[11])?.id || null,
        constructorChampion: resolveTeam(row[12])?.id || null,
        colapintoBestFinish: row[13] != null ? Number(row[13]) : null,
      },
      source: {
        workbook: workbookPath,
        rowNumber,
        computedTotalCost,
      },
    });
  }

  if (!entries.length) {
    throw new Error('No team entries found in the workbook');
  }

  return {
    entries,
    teamIdMap: serializeTeamIdMap(teamIdMapIndex),
  };
}

export function buildEntries(rows, workbookPath, existingEntries = [], previousTeamIdMap = null) {
  return buildEntriesWithMap(rows, workbookPath, existingEntries, previousTeamIdMap).entries;
}

export function buildCatalog() {
  return {
    drivers: CANONICAL_DRIVERS.map((driver) => ({
      id: driver.id,
      name: driver.fullName,
      teamName: driver.team,
      rank: driver.rank,
      imageSlug: driver.imageSlug,
    })),
    teams: CANONICAL_TEAMS.map((team) => ({
      id: team.id,
      name: team.name,
      imageSlug: team.imageSlug,
    })),
  };
}

function resolveWorkbookPath(workbookPath) {
  const resolvedPath = workbookPath || process.argv[2] || process.env.ROSTER_XLSX_PATH;
  if (!resolvedPath) {
    throw new Error('Roster workbook path is required. Pass it as the first argument or set ROSTER_XLSX_PATH.');
  }
  return resolvedPath;
}

export async function syncSeasonEntries(workbookPath) {
  ensureSeasonDirs();
  const resolvedWorkbookPath = resolveWorkbookPath(workbookPath);
  const rows = await readWorkbook(resolvedWorkbookPath);
  const existingEntries = readJson(configPath('entries.json'), []);
  const previousTeamIdMap = readJson(configPath('team-id-map.json'), { entries: [] });
  const { entries, teamIdMap } = buildEntriesWithMap(rows, resolvedWorkbookPath, existingEntries, previousTeamIdMap);
  writeJson(configPath('entries.json'), entries);
  writeJson(configPath('team-id-map.json'), teamIdMap);
  writeJson(configPath('catalog.json'), buildCatalog());
  const scoreboard = rebuildScoreboard();
  return { workbookPath: resolvedWorkbookPath, entries, scoreboard };
}

async function main() {
  const result = await syncSeasonEntries();
  console.log(`Imported ${result.entries.length} team entries from ${result.workbookPath}`);
  console.log(`Standings regenerated for ${result.scoreboard.standings.length} teams.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
