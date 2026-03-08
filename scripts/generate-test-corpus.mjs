#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { CANONICAL_DRIVERS, CANONICAL_TEAMS } from '../lib/canonical.js';
import { createStableTeamId } from './sync-season-entries.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const OUTPUT_ROOT = join(ROOT, 'test', 'fixtures', 'historical-seasons');
const YEARS = [2023, 2024, 2025];
const API_BASE = 'https://api.jolpi.ca/ergast/f1';
const OMITTED_TEAM_IDS = new Set(['cadillac']);
const SIMULATED_TEAMS = CANONICAL_TEAMS.filter((team) => !OMITTED_TEAM_IDS.has(team.id));
const SIMULATED_DRIVERS = CANONICAL_DRIVERS.filter((driver) => SIMULATED_TEAMS.some((team) => team.name === driver.team));

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, seed) {
  const output = [...values];
  const random = mulberry32(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

async function fetchJson(pathname) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${API_BASE}/${pathname}`);
    if (response.ok) {
      return response.json();
    }
    if (response.status !== 429 || attempt === 4) {
      throw new Error(`Unable to fetch ${pathname}: ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw new Error(`Unable to fetch ${pathname}`);
}

function seasonRoot(year) {
  return join(OUTPUT_ROOT, String(year), 'season');
}

function teamDriverPairs() {
  const pairs = new Map();
  for (const team of SIMULATED_TEAMS) {
    pairs.set(team.id, SIMULATED_DRIVERS.filter((driver) => driver.team === team.name).map((driver) => driver.id));
  }
  return pairs;
}

async function loadHistoricalSeason(year) {
  const scheduleData = await fetchJson(`${year}.json?limit=100`);
  const schedule = scheduleData.MRData.RaceTable.Races;
  const races = [];
  for (const race of schedule) {
    const resultData = await fetchJson(`${year}/${race.round}/results.json?limit=100`);
    const qualifyingData = await fetchJson(`${year}/${race.round}/qualifying.json?limit=100`);
    const sprintData = await fetchJson(`${year}/${race.round}/sprint.json?limit=100`);

    races.push({
      round: Number(race.round),
      raceId: `sim-${year}-${race.round}-${race.Circuit.circuitId}`,
      raceName: race.raceName,
      date: race.date,
      circuitId: race.Circuit.circuitId,
      results: resultData.MRData.RaceTable.Races[0]?.Results || [],
      qualifying: qualifyingData.MRData.RaceTable.Races[0]?.QualifyingResults || [],
      sprint: sprintData.MRData.RaceTable.Races[0]?.SprintResults || [],
    });
  }
  return races;
}

function buildHistoricalConstructorSeats(races) {
  const counts = new Map();
  for (const race of races) {
    for (const row of race.results) {
      const constructorId = row.Constructor.constructorId;
      const driverId = row.Driver.driverId;
      if (!counts.has(constructorId)) counts.set(constructorId, new Map());
      const constructorCounts = counts.get(constructorId);
      constructorCounts.set(driverId, (constructorCounts.get(driverId) || 0) + 1);
    }
  }

  return new Map(
    [...counts.entries()].map(([constructorId, driverCounts]) => [
      constructorId,
      [...driverCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([driverId]) => driverId),
    ]),
  );
}

function buildSeasonMapping(year, races) {
  const currentTeamIds = SIMULATED_TEAMS.map((team) => team.id);
  const historicalConstructors = [...new Set(races.flatMap((race) => race.results.map((row) => row.Constructor.constructorId)))];
  if (historicalConstructors.length !== currentTeamIds.length) {
    throw new Error(`Expected ${currentTeamIds.length} historical constructors for ${year}, found ${historicalConstructors.length}`);
  }

  const shuffledConstructors = shuffle(historicalConstructors, year * 17);
  const constructorSeats = buildHistoricalConstructorSeats(races);
  const currentPairs = teamDriverPairs();
  const currentTeamToHistorical = new Map();
  const historicalTeamToCurrent = new Map();

  currentTeamIds.forEach((teamId, index) => {
    const historicalConstructorId = shuffledConstructors[index];
    currentTeamToHistorical.set(teamId, historicalConstructorId);
    historicalTeamToCurrent.set(historicalConstructorId, teamId);
  });

  const driverMap = new Map();
  for (const teamId of currentTeamIds) {
    const currentDrivers = currentPairs.get(teamId) || [];
    const historicalDrivers = constructorSeats.get(currentTeamToHistorical.get(teamId)) || [];
    currentDrivers.forEach((currentDriverId, index) => {
      driverMap.set(currentDriverId, historicalDrivers[index] || historicalDrivers[0]);
    });
  }

  return {
    currentTeamToHistorical,
    historicalTeamToCurrent,
    driverMap,
  };
}

function normalizePosition(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRacePosition(row) {
  if (row.positionText === 'R' || row.positionText === 'W' || row.positionText === 'F') {
    return null;
  }
  return normalizePosition(row.position);
}

function fastestLapDriverId(results) {
  const fastest = results.find((row) => row.FastestLap?.rank === '1');
  return fastest?.Driver?.driverId || null;
}

function pickHistoricalRow(rows, constructorId, seatDriverIds, seatIndex) {
  const matching = rows.filter((row) => row.Constructor.constructorId === constructorId);
  const preferredDriverId = seatDriverIds[seatIndex];
  if (preferredDriverId) {
    const preferred = matching.find((row) => row.Driver.driverId === preferredDriverId);
    if (preferred) return preferred;
  }
  return matching[seatIndex] || matching[0] || null;
}

function syntheticPenaltySeed(year, round, slot) {
  return (year * 100) + (round * 10) + slot;
}

function injectSyntheticAdjustments(year, round, currentDriverId, currentTeamId, seatIndex) {
  const seed = syntheticPenaltySeed(year, round, seatIndex + currentDriverId.length + currentTeamId.length);
  return {
    gridPenaltyPlaces: seed % 19 === 0 ? 5 : 0,
    timePenaltySeconds: seed % 23 === 0 ? 5 : 0,
    driverFineEuros: seed % 29 === 0 ? 3500 : 0,
    teamFineEuros: seatIndex === 0 && seed % 31 === 0 ? 6000 : 0,
  };
}

function buildNormalizedRace(year, race, mapping) {
  const currentPairs = teamDriverPairs();
  const drivers = {};
  const teams = {};
  const fastestHistoricalDriver = fastestLapDriverId(race.results);

  for (const team of SIMULATED_TEAMS) {
    const currentDriverIds = currentPairs.get(team.id) || [];
    const historicalConstructorId = mapping.currentTeamToHistorical.get(team.id);
    const historicalSeatDriverIds = currentDriverIds.map((driverId) => mapping.driverMap.get(driverId));

    teams[team.id] = {
      teamId: team.id,
      driverIds: currentDriverIds,
      fineEuros: 0,
      finePoints: 0,
    };

    currentDriverIds.forEach((driverId, seatIndex) => {
      const resultRow = pickHistoricalRow(race.results, historicalConstructorId, historicalSeatDriverIds, seatIndex);
      const qualifyingRow = pickHistoricalRow(race.qualifying, historicalConstructorId, historicalSeatDriverIds, seatIndex);
      const sprintRow = pickHistoricalRow(race.sprint, historicalConstructorId, historicalSeatDriverIds, seatIndex);
      if (!resultRow) {
        throw new Error(`Incomplete historical data for ${year} round ${race.round}, team ${team.id}`);
      }

      const adjustments = injectSyntheticAdjustments(year, race.round, driverId, team.id, seatIndex);
      drivers[driverId] = {
        driverId,
        teamId: team.id,
        driverNumber: normalizePosition(resultRow.number) || (seatIndex + 1),
        qualifyingPosition: normalizePosition(qualifyingRow?.position),
        sprintPosition: normalizePosition(sprintRow?.position),
        gridStart: normalizePosition(resultRow.grid),
        racePosition: normalizeRacePosition(resultRow),
        classified: resultRow.status !== 'Disqualified' && resultRow.status !== 'Did not start',
        dnf: /Accident|Engine|Collision|Gearbox|Hydraulics|Spun off|Suspension|Transmission|Power Unit|Water leak|Electrical|Damage|Retired/i.test(resultRow.status),
        dns: resultRow.status === 'Did not start',
        dsq: resultRow.status === 'Disqualified',
        fastestLap: resultRow.Driver.driverId === fastestHistoricalDriver,
        gridPenaltyPlaces: adjustments.gridPenaltyPlaces,
        timePenaltySeconds: adjustments.timePenaltySeconds,
        fineEuros: adjustments.driverFineEuros,
        finePoints: 0,
      };

      teams[team.id].fineEuros += adjustments.teamFineEuros;
    });
  }

  return {
    raceId: race.raceId,
    raceName: `${race.raceName} (${year})`,
    date: race.date,
    round: race.round,
    sprintWeekend: race.sprint.length > 0,
    documents: [],
    drivers,
    teams,
    meta: {
      historicalSeason: year,
      historicalRound: race.round,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function syntheticEntries(calendar) {
  const entryBlueprints = [
    ['Ava Patel', 'Slipstream Syndicate'],
    ['Leo Carter', 'Parc Ferme'],
    ['Maya Chen', 'Late Brakers'],
    ['Noah Brooks', 'Sector Purple'],
    ['Ivy Turner', 'Formation Lap'],
    ['Ethan Bell', 'Overcut Club'],
    ['Zoe Foster', 'Track Limits'],
    ['Miles Reed', 'Undercut Union'],
  ];
  const drivers = SIMULATED_DRIVERS.map((driver) => driver.id);
  const teams = SIMULATED_TEAMS.map((team) => team.id);

  return entryBlueprints.map(([principalName, displayName], index) => ({
    // Historical fixtures should exercise the same principal-based ID generation
    // as the real workbook importer instead of baking display labels into IDs.
    teamId: createStableTeamId(principalName),
    principalName,
    displayName,
    selectedDriverIds: [drivers[index], drivers[index + 4], drivers[(index + 8) % drivers.length]],
    selectedConstructorIds: [teams[index % teams.length], teams[(index + 3) % teams.length], teams[(index + 6) % teams.length]],
    homeCircuitId: calendar[index % calendar.length].id,
    investmentBonusPerRace: index % 5,
    predictions: {
      totalClassified: 380 + index,
      driverChampion: drivers[index % drivers.length],
      constructorChampion: teams[index % teams.length],
      colapintoBestFinish: 6 + (index % 8),
    },
    source: {
      workbook: 'synthetic-test-corpus',
      rowNumber: index + 1,
    },
  }));
}

async function generateSeasonFixture(year) {
  const historicalRaces = await loadHistoricalSeason(year);
  const mapping = buildSeasonMapping(year, historicalRaces);
  const calendar = historicalRaces.map((race) => ({
    id: race.raceId,
    round: race.round,
    name: `${race.raceName} (${year})`,
    meetingName: race.raceName.replace(/ Grand Prix$/, ''),
    date: race.date,
    isSprintWeekend: race.sprint.length > 0,
  }));
  const seasonDir = seasonRoot(year);

  rmSync(join(OUTPUT_ROOT, String(year)), { recursive: true, force: true });
  writeJson(join(seasonDir, 'config', '2026-calendar.json'), calendar);
  writeJson(join(seasonDir, 'config', 'entries.json'), syntheticEntries(calendar));
  writeJson(
    join(seasonDir, 'config', 'fine-documents.json'),
    Object.fromEntries(calendar.map((race) => [race.id, { reviewed: true, documents: [], notes: 'Synthetic fixture', reviewedAt: `${race.date}T12:00:00Z` }])),
  );

  for (const race of historicalRaces) {
    const normalized = buildNormalizedRace(year, race, mapping);
    writeJson(join(seasonDir, 'normalized', `${race.raceId}.json`), normalized);
  }

  writeJson(join(OUTPUT_ROOT, String(year), 'manifest.json'), {
    generatedAt: new Date().toISOString(),
    historicalSeason: year,
    source: 'https://api.jolpi.ca/ergast/f1',
    races: historicalRaces.length,
    omittedTeamIds: [...OMITTED_TEAM_IDS],
  });
}

async function main() {
  for (const year of YEARS) {
    await generateSeasonFixture(year);
    console.log(`Generated synthetic fixture season for ${year}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
