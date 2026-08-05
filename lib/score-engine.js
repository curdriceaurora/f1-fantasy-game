import { driverById, teamById } from './canonical.js';

// Each team's designated Lead Driver from Martin's rules roster. Constructor
// points weight the lead 3x and the second driver 2x (see buildConstructorContribution).
const LEAD_DRIVER_IDS = new Set([
  'lando-norris', 'george-russell', 'max-verstappen', 'liam-lawson', 'charles-leclerc',
  'carlos-sainz', 'fernando-alonso', 'esteban-ocon', 'nico-hulkenberg', 'pierre-gasly', 'sergio-perez',
]);

const QUALIFYING_MATRIX = {
  Champion: { pole: 0, top5: -2, top10: -4, top14: -6, top18: -9, rest: -13, dnq: -20 },
  Contender: { pole: 3, top5: 0, top10: -2, top14: -4, top18: -6, rest: -9, dnq: -13 },
  'Top Ten': { pole: 6, top5: 3, top10: 0, top14: -2, top18: -4, rest: -6, dnq: -9 },
  'Mid Runner': { pole: 9, top5: 6, top10: 3, top14: 0, top18: -2, rest: -4, dnq: -6 },
  Outsider: { pole: 12, top5: 9, top10: 6, top14: 3, top18: 0, rest: 2, dnq: -4 },
  'No Hoper': { pole: 15, top5: 12, top10: 9, top14: 6, top18: 3, rest: 0, dnq: -3 },
};

const RACE_POINTS = new Map([
  [1, 25],
  [2, 18],
  [3, 15],
  [4, 12],
  [5, 10],
  [6, 8],
  [7, 6],
  [8, 4],
  [9, 2],
  [10, 1],
]);

const SPRINT_POINTS = new Map([
  [1, 8],
  [2, 7],
  [3, 6],
  [4, 5],
  [5, 4],
  [6, 3],
  [7, 2],
  [8, 1],
]);

function qualifyingBand(position) {
  if (!position || position < 1) return 'dnq';
  if (position === 1) return 'pole';
  if (position <= 5) return 'top5';
  if (position <= 10) return 'top10';
  if (position <= 14) return 'top14';
  if (position <= 18) return 'top18';
  return 'rest';
}

export function scoreQualifying(rank, position) {
  const table = QUALIFYING_MATRIX[rank];
  if (!table) {
    throw new Error(`Unsupported driver rank: ${rank}`);
  }
  return table[qualifyingBand(position)];
}

export function scoreRaceFinish(position) {
  return RACE_POINTS.get(position) || 0;
}

export function scoreSprintFinish(position) {
  return SPRINT_POINTS.get(position) || 0;
}

export function scorePositionChange(gridStart, finishPosition) {
  if (!gridStart || !finishPosition) return 0;
  return (gridStart - finishPosition) * 2;
}

export function scoreGridPenalty(places) {
  return -Math.min(10, Math.max(0, places || 0));
}

export function scoreTimePenalty(seconds) {
  return -Math.min(10, Math.max(0, seconds || 0));
}

export function scoreFinePoints(activeFineAmount) {
  if (!activeFineAmount || activeFineAmount <= 0) return 0;
  return -Math.min(100, Math.ceil(activeFineAmount / 2000));
}

function sumComponents(components) {
  return components.reduce((total, component) => total + component.points, 0);
}

export function buildDriverContribution(driverId, raceDriver, raceContext) {
  const driver = driverById(driverId);
  if (!driver) {
    throw new Error(`Unknown driver: ${driverId}`);
  }

  if (!raceDriver) {
    throw new Error(`No normalized result found for ${driver.fullName}`);
  }

  // Qualifying points are scored on the official grid position the driver starts
  // from (per Martin's rules), not the qualifying-session result — so a grid
  // penalty moves them into a worse band. Grid start also captures DNQ (ruled to
  // the back of the grid). Falls back to the qualifying position if no grid is set.
  const startPosition = raceDriver.gridStart ?? raceDriver.qualifyingPosition;
  const components = [
    {
      label: `Qualifying (grid P${startPosition ?? 'DNQ'})`,
      points: scoreQualifying(driver.rank, startPosition),
    },
  ];

  if (raceDriver.sprintPosition) {
    components.push({
      label: `Sprint P${raceDriver.sprintPosition}`,
      points: scoreSprintFinish(raceDriver.sprintPosition),
    });
  }

  components.push({
    label: `Race finish P${raceDriver.racePosition ?? 'NC'}`,
    points: scoreRaceFinish(raceDriver.racePosition),
  });

  // Position change scores against the improvement baseline, which equals the grid
  // start for everyone except drivers disqualified in qualifying — they are measured
  // from the last grid slot (field size). The factual grid start is kept for the
  // qualifying band. Falls back to gridStart when no baseline is set.
  const improvementGrid = raceDriver.improvementGrid ?? raceDriver.gridStart;
  const positionChangeExceptional = improvementGrid != null && improvementGrid !== raceDriver.gridStart;
  components.push({
    // Label the exception so a scored artifact is self-explaining (e.g. a P20 start
    // scoring a change of 32 is measured from P22 after a qualifying DSQ).
    label: positionChangeExceptional ? `Position change (from P${improvementGrid})` : 'Position change',
    points: scorePositionChange(improvementGrid, raceDriver.racePosition),
  });

  if (raceDriver.fastestLap) {
    components.push({
      label: 'Fastest lap',
      points: 2,
    });
  }

  if (raceDriver.gridPenaltyPlaces) {
    components.push({
      label: 'Grid penalty',
      points: scoreGridPenalty(raceDriver.gridPenaltyPlaces),
    });
  }

  if (raceDriver.timePenaltySeconds) {
    components.push({
      label: 'Race time penalty',
      points: scoreTimePenalty(raceDriver.timePenaltySeconds),
    });
  }

  if (raceDriver.finePoints) {
    components.push({
      label: 'FIA monetary fines',
      points: raceDriver.finePoints,
    });
  }

  return {
    driverId,
    name: driver.fullName,
    teamName: driver.team,
    imageSlug: driver.imageSlug,
    rank: driver.rank,
    qualifyingPosition: raceDriver.qualifyingPosition,
    sprintPosition: raceDriver.sprintPosition,
    gridStart: raceDriver.gridStart,
    improvementGrid,
    racePosition: raceDriver.racePosition,
    classified: raceDriver.classified,
    totalPoints: sumComponents(components),
    components,
    raceContext,
  };
}

export function buildConstructorContribution(teamId, raceTeam, driverContributions) {
  const team = teamById(teamId);
  if (!team) {
    throw new Error(`Unknown team: ${teamId}`);
  }
  if (!raceTeam) {
    throw new Error(`No normalized constructor result found for ${team.name}`);
  }

  // The lead driver is fixed by Martin's roster, not chosen per race, so the
  // weighting favours the designated lead even in a race where the second driver
  // outscored them. Fall back to the higher scorer only when neither of the
  // constructor's two drivers is a designated lead (e.g. a reserve stands in).
  const leadDriver = driverContributions.find((driver) => LEAD_DRIVER_IDS.has(driver.driverId))
    || [...driverContributions].sort((left, right) => right.totalPoints - left.totalPoints)[0]
    || null;
  const secondDriver = driverContributions.find((driver) => driver !== leadDriver) || null;
  const lead = leadDriver?.totalPoints || 0;
  const second = secondDriver?.totalPoints || 0;
  const weightedRaw = ((3 * lead) + (2 * second)) / 5;
  const weighted = Math.ceil(weightedRaw);

  const components = [
    {
      label: 'Weighted driver total',
      points: weighted,
    },
  ];

  if (raceTeam.finePoints) {
    components.push({
      label: 'FIA monetary fines',
      points: raceTeam.finePoints,
    });
  }

  return {
    teamId,
    name: team.name,
    imageSlug: team.imageSlug,
    driverIds: raceTeam.driverIds,
    totalPoints: sumComponents(components),
    weightingBreakdown: {
      leadDriverId: leadDriver?.driverId || null,
      leadDriverName: leadDriver?.name || null,
      leadDriverPoints: lead,
      secondDriverId: secondDriver?.driverId || null,
      secondDriverName: secondDriver?.name || null,
      secondDriverPoints: second,
      formula: `ceil((3×${lead} + 2×${second}) ÷ 5)`,
      weightedRawPoints: weightedRaw,
      weightedPoints: weighted,
    },
    components,
  };
}

export function scoreFantasyTeam(entry, normalizedRace) {
  const driverContributions = entry.selectedDriverIds.map((driverId) =>
    buildDriverContribution(driverId, normalizedRace.drivers[driverId], {
      raceId: normalizedRace.raceId,
      raceName: normalizedRace.raceName,
    }),
  );

  const constructorContributions = entry.selectedConstructorIds.map((teamId) => {
    const raceTeam = normalizedRace.teams[teamId];
    const constructorDrivers = raceTeam.driverIds.map((driverId) =>
      buildDriverContribution(driverId, normalizedRace.drivers[driverId], {
        raceId: normalizedRace.raceId,
        raceName: normalizedRace.raceName,
      }),
    );
    return buildConstructorContribution(teamId, raceTeam, constructorDrivers);
  });

  const driverSubtotal = driverContributions.reduce((total, item) => total + item.totalPoints, 0);
  const constructorSubtotal = constructorContributions.reduce((total, item) => total + item.totalPoints, 0);
  const baseSubtotal = driverSubtotal + constructorSubtotal;

  let subtotalAfterHomeCircuit = baseSubtotal;
  let homeCircuitBonusPoints = 0;
  if (entry.homeCircuitId === normalizedRace.raceId) {
    subtotalAfterHomeCircuit = baseSubtotal * 2;
    if (subtotalAfterHomeCircuit < 0) {
      homeCircuitBonusPoints = -baseSubtotal;
      subtotalAfterHomeCircuit = 0;
    } else {
      homeCircuitBonusPoints = baseSubtotal;
    }
  }

  const totalPoints = subtotalAfterHomeCircuit + entry.investmentBonusPerRace;

  return {
    raceId: normalizedRace.raceId,
    raceName: normalizedRace.raceName,
    raceDate: normalizedRace.date,
    baseSubtotal,
    driverSubtotal,
    constructorSubtotal,
    homeCircuitApplied: entry.homeCircuitId === normalizedRace.raceId,
    homeCircuitBonusPoints,
    investmentBonusPoints: entry.investmentBonusPerRace,
    totalPoints,
    drivers: driverContributions,
    constructors: constructorContributions,
  };
}
