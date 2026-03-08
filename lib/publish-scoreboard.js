import { loadCalendar, loadEntries, normalizedRacePath, readJson, scoredRacePath, standingsPath, teamScorePath, writeJson } from './season-store.js';
import { scoreFantasyTeam, scoreFinePoints } from './score-engine.js';

function compareStandings(left, right) {
  if (right.totalPoints !== left.totalPoints) {
    return right.totalPoints - left.totalPoints;
  }
  if (right.latestRacePoints !== left.latestRacePoints) {
    return right.latestRacePoints - left.latestRacePoints;
  }
  return left.displayName.localeCompare(right.displayName);
}

export function rebuildScoreboard() {
  const calendar = loadCalendar();
  const entries = loadEntries();
  const normalizedRaces = calendar
    .map((race) => readJson(normalizedRacePath(race.id), null))
    .filter(Boolean)
    .map((race) => ({
      ...race,
      drivers: Object.fromEntries(
        Object.entries(race.drivers).map(([driverId, driver]) => [
          driverId,
          { ...driver, finePoints: scoreFinePoints(driver.fineEuros) },
        ]),
      ),
      teams: Object.fromEntries(
        Object.entries(race.teams).map(([teamId, team]) => [
          teamId,
          { ...team, finePoints: scoreFinePoints(team.fineEuros) },
        ]),
      ),
    }))
    .sort((left, right) => left.round - right.round);

  const teamFiles = new Map();
  for (const entry of entries) {
    teamFiles.set(entry.teamId, {
      teamId: entry.teamId,
      principalName: entry.principalName,
      displayName: entry.displayName,
      totalPoints: 0,
      completedRaces: 0,
      latestRacePoints: 0,
      races: [],
    });
  }

  for (const normalizedRace of normalizedRaces) {
    const raceOutput = {
      raceId: normalizedRace.raceId,
      raceName: normalizedRace.raceName,
      date: normalizedRace.date,
      round: normalizedRace.round,
      generatedAt: new Date().toISOString(),
      documents: normalizedRace.documents || [],
      teams: [],
    };

    for (const entry of entries) {
      const teamFile = teamFiles.get(entry.teamId);
      const breakdown = scoreFantasyTeam(entry, normalizedRace);
      teamFile.totalPoints += breakdown.totalPoints;
      teamFile.completedRaces += 1;
      teamFile.latestRacePoints = breakdown.totalPoints;
      teamFile.races.push({
        ...breakdown,
        runningTotal: teamFile.totalPoints,
      });

      raceOutput.teams.push({
        teamId: entry.teamId,
        principalName: entry.principalName,
        displayName: entry.displayName,
        ...breakdown,
        runningTotal: teamFile.totalPoints,
      });
    }

    raceOutput.teams.sort((left, right) => right.totalPoints - left.totalPoints || left.displayName.localeCompare(right.displayName));
    writeJson(scoredRacePath(normalizedRace.raceId), raceOutput);
  }

  const standings = [...teamFiles.values()]
    .map((teamFile) => ({
      teamId: teamFile.teamId,
      principalName: teamFile.principalName,
      displayName: teamFile.displayName,
      totalPoints: teamFile.totalPoints,
      completedRaces: teamFile.completedRaces,
      latestRacePoints: teamFile.latestRacePoints,
    }))
    .sort(compareStandings)
    .map((row, index) => ({ rank: index + 1, ...row }));

  for (const teamFile of teamFiles.values()) {
    writeJson(teamScorePath(teamFile.teamId), teamFile);
  }

  writeJson(standingsPath(), {
    generatedAt: new Date().toISOString(),
    standings,
  });

  return { standings, normalizedRaces: normalizedRaces.map((race) => race.raceId) };
}
