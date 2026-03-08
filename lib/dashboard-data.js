import { existsSync } from 'fs';
import { displayDriverName, displayTeamName, driverById, teamById } from './canonical.js';
import { standingsPath, loadCalendar, loadEntries, readJson, scoredRacePath, teamScorePath, getRaceStatus } from './season-store.js';

function compareStandings(left, right) {
  if (right.totalPoints !== left.totalPoints) {
    return right.totalPoints - left.totalPoints;
  }
  if (right.latestRacePoints !== left.latestRacePoints) {
    return right.latestRacePoints - left.latestRacePoints;
  }
  return left.displayName.localeCompare(right.displayName);
}

function buildWeekOverWeekDelta(entries, standingsRows) {
  const scoredTeams = entries
    .map((entry) => ({
      entry,
      stored: readJson(teamScorePath(entry.teamId), null),
    }))
    .filter(({ stored }) => stored?.completedRaces > 1);

  if (scoredTeams.length === 0) {
    return new Map();
  }

  const previousStandings = scoredTeams
    .map(({ entry, stored }) => {
      const previousRace = stored.races?.[stored.completedRaces - 2];
      if (!previousRace) return null;
      return {
        teamId: entry.teamId,
        displayName: entry.displayName,
        totalPoints: previousRace.runningTotal,
        latestRacePoints: previousRace.totalPoints,
      };
    })
    .filter(Boolean)
    .sort(compareStandings)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const previousRankByTeamId = new Map(previousStandings.map((row) => [row.teamId, row.rank]));
  return new Map(
    standingsRows.map((row) => {
      const previousRank = previousRankByTeamId.get(row.teamId);
      return [row.teamId, previousRank ? previousRank - row.rank : null];
    }),
  );
}

function enrichSelections(entry) {
  return {
    drivers: entry.selectedDriverIds.map((driverId) => {
      const driver = driverById(driverId);
      return {
        id: driverId,
        name: displayDriverName(driverId),
        teamName: driver?.team || '',
        imageSlug: driver?.imageSlug || null,
      };
    }),
    constructors: entry.selectedConstructorIds.map((teamId) => {
      const team = teamById(teamId);
      return {
        id: teamId,
        name: displayTeamName(teamId),
        imageSlug: team?.imageSlug || null,
      };
    }),
  };
}

function resolveRaceName(calendar, raceId) {
  return calendar.find((race) => race.id === raceId)?.name || raceId || '—';
}

export function loadStandingsData() {
  const standings = readJson(standingsPath(), null);
  const entries = loadEntries();
  const calendar = loadCalendar();

  const fallbackStandings = entries.map((entry) => ({
    teamId: entry.teamId,
    principalName: entry.principalName,
    displayName: entry.displayName,
      totalPoints: 0,
      latestRacePoints: 0,
      completedRaces: 0,
      wowDelta: null,
    }));

  const resolvedStandings = standings?.standings || fallbackStandings;
  const wowDeltaByTeamId = buildWeekOverWeekDelta(entries, resolvedStandings);

  return {
    generatedAt: standings?.generatedAt || null,
    races: calendar.map((race) => ({
      id: race.id,
      name: race.name,
      date: race.date,
      status: getRaceStatus(race),
      round: race.round,
    })),
    standings: resolvedStandings.map((row) => ({
      ...row,
      wowDelta: wowDeltaByTeamId.get(row.teamId) ?? null,
    })),
  };
}

export function loadTeamListData() {
  const standings = loadStandingsData().standings;
  const entries = loadEntries();
  return entries.map((entry) => {
    const standing = standings.find((row) => row.teamId === entry.teamId);
    return {
      ...entry,
      ...enrichSelections(entry),
      totalPoints: standing?.totalPoints || 0,
      latestRacePoints: standing?.latestRacePoints || 0,
      completedRaces: standing?.completedRaces || 0,
      wowDelta: standing?.wowDelta ?? null,
    };
  });
}

export function loadTeamDetail(teamId) {
  const entries = loadEntries();
  const entry = entries.find((item) => item.teamId === teamId);
  if (!entry) {
    return null;
  }

  const stored = readJson(teamScorePath(teamId), null);
  const calendar = loadCalendar();

  const raceBreakdown = calendar.map((race) => {
    const scoredRace = stored?.races?.find((item) => item.raceId === race.id);
    return {
      raceId: race.id,
      raceName: race.name,
      raceDate: race.date,
      status: getRaceStatus(race),
      totalPoints: scoredRace?.totalPoints ?? null,
      runningTotal: scoredRace?.runningTotal ?? null,
      detail: scoredRace || null,
    };
  });

  return {
    ...entry,
    ...enrichSelections(entry),
    seasonSelections: {
      homeCircuit: resolveRaceName(calendar, entry.homeCircuitId),
      investmentBonusPerRace: entry.investmentBonusPerRace,
      totalClassified: entry.predictions?.totalClassified ?? null,
      driverChampion: entry.predictions?.driverChampion ? displayDriverName(entry.predictions.driverChampion) : '—',
      constructorChampion: entry.predictions?.constructorChampion ? displayTeamName(entry.predictions.constructorChampion) : '—',
      colapintoBestFinish: entry.predictions?.colapintoBestFinish ?? null,
    },
    standings: {
      totalPoints: stored?.totalPoints || 0,
      completedRaces: stored?.completedRaces || 0,
      latestRacePoints: stored?.latestRacePoints || 0,
    },
    races: raceBreakdown,
  };
}

export function loadRaceDetail(raceId) {
  if (!existsSync(scoredRacePath(raceId))) {
    return null;
  }
  return readJson(scoredRacePath(raceId), null);
}
