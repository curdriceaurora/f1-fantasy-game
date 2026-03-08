#!/usr/bin/env node

import { createHash } from 'crypto';
import xlsx from 'xlsx';
import { pathToFileURL } from 'url';
import { CANONICAL_DRIVERS, CANONICAL_TEAMS, resolveCircuitId, resolveDriver, resolveTeam } from '../lib/canonical.js';
import { configPath, ensureSeasonDirs, readJson, writeJson } from '../lib/season-store.js';
import { rebuildScoreboard } from '../lib/publish-scoreboard.js';

const DRIVER_COST_BY_ID = new Map(CANONICAL_DRIVERS.map((driver) => [driver.id, Number(driver.cost)]));
const TEAM_COST_BY_ID = new Map(CANONICAL_TEAMS.map((team) => [team.id, Number(team.cost)]));
const BUDGET_CAP = 50;

function readWorkbook(filePath) {
  const workbook = xlsx.readFile(filePath);
  const worksheet = workbook.Sheets['Starting Roster'];
  if (!worksheet) {
    throw new Error('Expected a "Starting Roster" worksheet in the roster workbook');
  }
  return xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: null });
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

function existingTeamIdLookup(existingEntries = []) {
  const lookup = new Map();
  for (const entry of existingEntries) {
    const identityKey = normalizeIdentityKey(entry.principalName);
    if (identityKey && !lookup.has(identityKey) && entry.teamId) {
      lookup.set(identityKey, entry.teamId);
    }
  }
  return lookup;
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

export function buildEntries(rows, workbookPath, existingEntries = []) {
  const entries = [];
  const seenTeamIds = new Set();
  const teamIdByPrincipal = existingTeamIdLookup(existingEntries);
  for (let index = 4; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || !row[1] || !row[2]) continue;

    const principalName = String(row[1]).trim();
    const displayName = String(row[2]).trim();
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
    const teamId = createStableTeamId(principalName, teamIdByPrincipal.get(normalizeIdentityKey(principalName)) || null);
    if (seenTeamIds.has(teamId)) {
      throw new Error(`Duplicate stable team id "${teamId}" generated for ${principalName}. Principal/display names must be unique.`);
    }
    seenTeamIds.add(teamId);

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
        rowNumber: index + 1,
        computedTotalCost,
      },
    });
  }

  if (!entries.length) {
    throw new Error('No team entries found in the workbook');
  }

  return entries;
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

export function syncSeasonEntries(workbookPath) {
  ensureSeasonDirs();
  const resolvedWorkbookPath = resolveWorkbookPath(workbookPath);
  const rows = readWorkbook(resolvedWorkbookPath);
  const existingEntries = readJson(configPath('entries.json'), []);
  const entries = buildEntries(rows, resolvedWorkbookPath, existingEntries);
  writeJson(configPath('entries.json'), entries);
  writeJson(configPath('catalog.json'), buildCatalog());
  const scoreboard = rebuildScoreboard();
  return { workbookPath: resolvedWorkbookPath, entries, scoreboard };
}

function main() {
  const result = syncSeasonEntries();
  console.log(`Imported ${result.entries.length} team entries from ${result.workbookPath}`);
  console.log(`Standings regenerated for ${result.scoreboard.standings.length} teams.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
