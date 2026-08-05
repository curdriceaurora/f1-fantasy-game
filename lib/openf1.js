import { normalizeText, resolveDriver, resolveTeam } from './canonical.js';

const API_BASE = 'https://api.openf1.org/v1';

async function fetchJson(pathname, params = {}) {
  const search = new URLSearchParams(params);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${API_BASE}/${pathname}?${search.toString()}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (response.ok) {
      return response.json();
    }
    if (response.status !== 429 || attempt === 2) {
      throw new Error(`OpenF1 request failed for ${pathname}: ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  return [];
}

function sortSessionsByStartDesc(sessions) {
  return [...sessions].sort((left, right) => new Date(right.date_start).getTime() - new Date(left.date_start).getTime());
}

function pickLatestSession(sessions) {
  return sortSessionsByStartDesc(sessions)[0] || null;
}

function sessionNameEquals(session, value) {
  return normalizeText(session.session_name) === normalizeText(value);
}

function sessionNameIncludes(session, value) {
  return normalizeText(session.session_name).includes(normalizeText(value));
}

export function selectWeekendSessions(sessions) {
  const raceTypeSessions = sessions.filter((session) => normalizeText(session.session_type) === 'race');
  const qualifyingTypeSessions = sessions.filter((session) => normalizeText(session.session_type) === 'qualifying');

  const raceSession = pickLatestSession(
    raceTypeSessions.filter((session) => sessionNameEquals(session, 'race') || sessionNameEquals(session, 'grand prix')),
  ) || pickLatestSession(
    raceTypeSessions.filter((session) => !sessionNameIncludes(session, 'sprint')),
  ) || pickLatestSession(raceTypeSessions);

  const qualifyingSession = pickLatestSession(
    qualifyingTypeSessions.filter((session) => sessionNameEquals(session, 'qualifying')),
  ) || pickLatestSession(
    qualifyingTypeSessions.filter((session) => !sessionNameIncludes(session, 'sprint')),
  ) || pickLatestSession(qualifyingTypeSessions);

  const sprintSession = pickLatestSession(
    sessions.filter((session) => {
      const normalizedType = normalizeText(session.session_type);
      const normalizedName = normalizeText(session.session_name);
      const isSprintByType = normalizedType === 'sprint';
      const isSprintByName = normalizedName === 'sprint' || normalizedName === 'sprint race';
      const isSprintQualifier = normalizedName.includes('qualifying') || normalizedName.includes('shootout');
      return (isSprintByType || isSprintByName) && !isSprintQualifier;
    }),
  );

  return {
    raceSession,
    qualifyingSession,
    sprintSession,
  };
}

// A meeting name is not a unique key: the 2026 Bahrain Grand Prix appears twice
// — the April event that never ran, and the October running of the same race at
// Sepang. Only a meeting close to the calendar date can be the right one, so
// anything further out is rejected rather than picked as the nearest match.
const MEETING_DATE_TOLERANCE_DAYS = 10;

export function openf1MeetingName(calendarRace) {
  return calendarRace.sources?.openf1MeetingName || calendarRace.meetingName;
}

function daysFromRaceDate(meeting, calendarRace) {
  const targetDate = new Date(`${calendarRace.date}T00:00:00Z`).getTime();
  return Math.abs(new Date(meeting.date_start).getTime() - targetDate) / 86400000;
}

function pickMeeting(meetings, calendarRace) {
  return [...meetings]
    .sort((left, right) => daysFromRaceDate(left, calendarRace) - daysFromRaceDate(right, calendarRace))[0];
}

const TIME_PENALTY_MESSAGE = /(PENALTY SERVED\s*-\s*)?(\d+)\s+SECOND TIME PENALTY FOR CAR\s+(\d+)(?:\s+\([^)]+\))?(?:\s*-\s*(.*))?$/i;

function normalizePenaltyReason(reason) {
  return normalizeText(String(reason || '').replace(/\(\d{1,2}:\d{2}:\d{2}\)/g, ''));
}

export function parseTimePenaltyEvents(messages) {
  const events = [];
  for (const message of messages) {
    const match = String(message.message || '').match(TIME_PENALTY_MESSAGE);
    if (!match) continue;
    const seconds = Number.parseInt(match[2], 10);
    const driverNumber = Number.parseInt(match[3], 10);
    const reason = normalizePenaltyReason(match[4]);
    events.push({
      driverNumber,
      seconds,
      reason,
      served: Boolean(match[1]),
      key: `${driverNumber}:${seconds}:${reason}`,
      message: message.message,
    });
  }
  return events;
}

export function inferUnservedTimePenalties(messages) {
  const events = parseTimePenaltyEvents(messages);
  const issuedCounts = new Map();
  const servedCounts = new Map();
  for (const event of events) {
    const counts = event.served ? servedCounts : issuedCounts;
    counts.set(event.key, (counts.get(event.key) || 0) + 1);
  }

  const totals = new Map();
  const processedKeys = new Set();
  for (const event of events.filter((entry) => !entry.served)) {
    const unservedCount = Math.max(
      0,
      (issuedCounts.get(event.key) || 0) - (servedCounts.get(event.key) || 0),
    );
    if (!unservedCount || processedKeys.has(event.key)) continue;
    processedKeys.add(event.key);
    totals.set(
      event.driverNumber,
      (totals.get(event.driverNumber) || 0) + (event.seconds * unservedCount),
    );
  }
  return { events, totals };
}

function parseGridPenaltyMessages(messages) {
  const penalties = new Map();
  for (const message of messages) {
    const match = String(message.message || '').match(/(?:CAR\s+(\d+).+?(\d+)\s+PLACE GRID PENALTY|(\d+)\s+PLACE GRID PENALTY FOR CAR\s+(\d+))/i);
    if (!match) continue;
    const driverNumber = Number.parseInt(match[1] || match[4], 10);
    const places = Number.parseInt(match[2] || match[3], 10);
    penalties.set(driverNumber, (penalties.get(driverNumber) || 0) + places);
  }
  return penalties;
}

function indexFastestLapByDriver(laps) {
  const fastest = new Map();
  for (const lap of laps) {
    if (lap.is_pit_out_lap || !lap.lap_duration) continue;
    const current = fastest.get(lap.driver_number);
    if (!current || lap.lap_duration < current) {
      fastest.set(lap.driver_number, lap.lap_duration);
    }
  }
  return fastest;
}

function deriveGridStarts(positionFeed) {
  if (!Array.isArray(positionFeed) || !positionFeed.length) {
    throw new Error('OpenF1 position feed is missing; cannot determine official race grid starts.');
  }

  const earliest = new Map();
  for (const row of positionFeed) {
    const current = earliest.get(row.driver_number);
    if (!current || new Date(row.date) < new Date(current.date)) {
      earliest.set(row.driver_number, row);
    }
  }

  const gridStarts = new Map();
  for (const [driverNumber, row] of earliest.entries()) {
    gridStarts.set(driverNumber, row.position);
  }
  return gridStarts;
}

// The FIA final classification lists finishers by position, then everyone else
// ranked by laps completed — a driver out on lap 60 is classified ahead of one
// out on lap 20, and two cars on the same lap keep results order (which the
// stable sort below preserves). OpenF1 mirrors that split but leaves every
// non-finisher with a null position, which would zero their grid-improvement
// penalty. Rebuild the order Martin scores against: keep the classified
// positions, then append the rest by descending laps. Note OpenF1's `dns` flag
// is unreliable — it marks lap-one retirements (0 laps) that the FIA still
// classifies at the back. Disqualified cars are a separate case: Martin scores
// every one of them at the same last-place position (the field size).
export function deriveFinishingPositions(raceResultRows) {
  const classified = raceResultRows.filter((row) => row.position != null && !row.dsq);
  const lastClassified = classified.reduce((max, row) => Math.max(max, row.position), 0);
  const retired = raceResultRows
    .filter((row) => row.position == null && !row.dsq)
    .sort((left, right) => (right.number_of_laps || 0) - (left.number_of_laps || 0));
  const disqualified = raceResultRows.filter((row) => row.dsq);
  const lastPlace = raceResultRows.length;

  const positions = new Map();
  for (const row of classified) {
    positions.set(row.driver_number, row.position);
  }
  retired.forEach((row, index) => {
    positions.set(row.driver_number, lastClassified + 1 + index);
  });
  for (const row of disqualified) {
    positions.set(row.driver_number, lastPlace);
  }
  return positions;
}

function canonicalizeDriverName(driver) {
  const direct = resolveDriver(`${driver.first_name || ''} ${driver.last_name || ''}`.trim());
  if (direct) return direct;
  return resolveDriver(driver.full_name) || resolveDriver(driver.broadcast_name);
}

function canonicalizeTeamName(teamName) {
  return resolveTeam(teamName);
}

function sortMessagesByDate(messages) {
  return [...messages].sort((left, right) => new Date(left.date) - new Date(right.date));
}

function raceYear(calendarRace) {
  const raceDate = new Date(`${calendarRace.date}T00:00:00Z`);
  if (Number.isNaN(raceDate.getTime())) {
    throw new Error(`Race ${calendarRace.id} has an invalid date "${calendarRace.date}"`);
  }
  return String(raceDate.getUTCFullYear());
}

export async function fetchRaceWeekend(calendarRace) {
  const year = raceYear(calendarRace);
  const meetingName = openf1MeetingName(calendarRace);
  let meetings = await fetchJson('meetings', {
    year,
    meeting_name: meetingName,
  });

  if (!meetings.length) {
    meetings = await fetchJson('meetings', { year });
  }

  const namedMeetings = meetings.filter((meeting) => {
    const meetingNameMatches = normalizeText(meeting.meeting_name).includes(normalizeText(meetingName));
    const dateMatches = String(meeting.date_start || '').startsWith(calendarRace.date);
    return meetingNameMatches || dateMatches;
  });

  if (!namedMeetings.length) {
    throw new Error(`No OpenF1 meeting found for ${meetingName}`);
  }

  const matchingMeetings = namedMeetings.filter(
    (meeting) => daysFromRaceDate(meeting, calendarRace) <= MEETING_DATE_TOLERANCE_DAYS,
  );

  if (!matchingMeetings.length) {
    const nearest = pickMeeting(namedMeetings, calendarRace);
    throw new Error(
      `OpenF1 has no "${meetingName}" meeting near ${calendarRace.date} for ${calendarRace.id}; `
      + `the closest is "${nearest.meeting_name}" starting ${String(nearest.date_start).slice(0, 10)}. `
      + 'Update the calendar date, or set sources.openf1MeetingName if the race was relocated or renamed.',
    );
  }

  const meeting = pickMeeting(matchingMeetings, calendarRace);
  const sessions = await fetchJson('sessions', { meeting_key: String(meeting.meeting_key) });
  const { raceSession, qualifyingSession, sprintSession } = selectWeekendSessions(sessions);

  if (!raceSession || !qualifyingSession) {
    throw new Error(`OpenF1 sessions incomplete for ${calendarRace.id}`);
  }
  // A missing OpenF1 sprint session is not fatal here: the FIA final sprint
  // classification is the primary source and is attached before normalization,
  // which validates that sprint data exists from one source or the other.

  const gridRaceControlBatches = await Promise.all(
    sessions
      .filter((session) => session.session_key != null)
      .map((session) => fetchJson('race_control', { session_key: String(session.session_key) })),
  );
  const raceTimePenaltyMessages = await fetchJson('race_control', { session_key: String(raceSession.session_key) });

  const [
    drivers,
    raceResultRows,
    qualifyingResultRows,
    sprintResultRows,
    laps,
    positionFeed,
  ] = await Promise.all([
    fetchJson('drivers', { session_key: String(raceSession.session_key) }),
    fetchJson('session_result', { session_key: String(raceSession.session_key) }),
    fetchJson('session_result', { session_key: String(qualifyingSession.session_key) }),
    sprintSession ? fetchJson('session_result', { session_key: String(sprintSession.session_key) }) : Promise.resolve([]),
    fetchJson('laps', { session_key: String(raceSession.session_key) }),
    fetchJson('position', { session_key: String(raceSession.session_key) }),
  ]);

  return {
    meeting,
    sessions: {
      qualifying: qualifyingSession,
      sprint: sprintSession,
      race: raceSession,
    },
    drivers,
    raceResultRows,
    qualifyingResultRows,
    sprintResultRows,
    laps,
    gridPenaltyMessages: sortMessagesByDate(gridRaceControlBatches.flat()),
    raceTimePenaltyMessages: sortMessagesByDate(raceTimePenaltyMessages),
    positionFeed,
  };
}

export function normalizeRaceWeekend(calendarRace, fetchedRace, fineSummary = { drivers: {}, teams: {}, documents: [] }) {
  if (!Array.isArray(fetchedRace.raceResultRows) || !fetchedRace.raceResultRows.length) {
    throw new Error(`OpenF1 race results are missing for ${calendarRace.id}`);
  }
  if (!Array.isArray(fetchedRace.qualifyingResultRows) || !fetchedRace.qualifyingResultRows.length) {
    throw new Error(`OpenF1 qualifying results are missing for ${calendarRace.id}`);
  }
  // Sprint data may come from the FIA final sprint classification (primary) or
  // OpenF1 (fallback); only fail when a sprint weekend has neither.
  const hasOpenF1Sprint = Array.isArray(fetchedRace.sprintResultRows) && fetchedRace.sprintResultRows.length > 0;
  const hasFiaSprint = Object.keys(fetchedRace.fiaResults?.sprintPositions || {}).length > 0;
  if (calendarRace.isSprintWeekend && !hasOpenF1Sprint && !hasFiaSprint) {
    throw new Error(`sprint results are missing (OpenF1 and FIA) for sprint weekend ${calendarRace.id}`);
  }

  const driverDirectory = new Map();
  for (const driver of fetchedRace.drivers) {
    const canonicalDriver = canonicalizeDriverName(driver);
    if (!canonicalDriver) {
      throw new Error(`Unable to map OpenF1 driver "${driver.full_name}" to canonical constants`);
    }
    const canonicalTeam = canonicalizeTeamName(driver.team_name) || resolveTeam(canonicalDriver.team);
    if (!canonicalTeam) {
      throw new Error(`Unable to map OpenF1 team "${driver.team_name}" to canonical constants`);
    }
    driverDirectory.set(driver.driver_number, {
      ...driver,
      canonicalDriverId: canonicalDriver.id,
      canonicalTeamId: canonicalTeam.id,
    });
  }

  const qualifyingMap = new Map();
  for (const result of fetchedRace.qualifyingResultRows) {
    qualifyingMap.set(result.driver_number, result.position);
  }

  const sprintResultMap = new Map();
  for (const result of fetchedRace.sprintResultRows) {
    sprintResultMap.set(result.driver_number, result);
  }

  const raceMap = new Map();
  for (const result of fetchedRace.raceResultRows) {
    raceMap.set(result.driver_number, result);
  }

  const gridPenaltyMap = parseGridPenaltyMessages(fetchedRace.gridPenaltyMessages || []);
  const timePenaltyMap = inferUnservedTimePenalties(
    fetchedRace.raceTimePenaltyMessages || [],
  ).totals;
  const fastestLapByDriver = indexFastestLapByDriver(fetchedRace.laps);
  const fastestLap = [...fastestLapByDriver.entries()].sort((left, right) => left[1] - right[1])[0]?.[0] || null;
  if (!fastestLap) {
    throw new Error(`OpenF1 lap data is missing; cannot determine fastest lap for ${calendarRace.id}`);
  }
  const gridStarts = deriveGridStarts(fetchedRace.positionFeed);
  const finishingPositions = deriveFinishingPositions(fetchedRace.raceResultRows);
  const sprintPositions = deriveFinishingPositions(fetchedRace.sprintResultRows);

  // The FIA final-classification and starting-grid documents are definitive;
  // OpenF1 is only the fallback when a document is unavailable. When the FIA
  // documents are present they are authoritative in full — including which cars
  // carry a time penalty, so an OpenF1 penalty the FIA never issued is dropped.
  const fia = fetchedRace.fiaResults || {};
  const fiaFinish = fia.finishingPositions || {};
  const fiaGrid = fia.gridPositions || {};
  const fiaPenalties = fia.penaltySeconds || {};
  const fiaSprint = fia.sprintPositions || {};
  // New FIA caches carry explicit DSQ lists parsed from the final classification.
  // Older caches lack these fields and fall back to OpenF1's status flags.
  const fiaRaceDisqualified = Array.isArray(fia.disqualifiedDrivers)
    ? new Set(fia.disqualifiedDrivers)
    : null;
  const fiaSprintDisqualified = Array.isArray(fia.sprintDisqualifiedDrivers)
    ? new Set(fia.sprintDisqualifiedDrivers)
    : null;

  for (const directoryEntry of driverDirectory.values()) {
    const hasGrid = directoryEntry.canonicalDriverId in fiaGrid || gridStarts.has(directoryEntry.driver_number);
    if (!hasGrid) {
      throw new Error(`Missing official grid start for driver number ${directoryEntry.driver_number}`);
    }
  }

  const drivers = {};
  const teams = {};

  // Drivers disqualified in qualifying but allowed to start are measured from the
  // last grid slot for the improvement calc (Martin's rule); each such driver, not
  // their real back-row slot. The field size is the number of entrants for the race.
  // This override is the sole source of the ruling, so validate it strictly — a
  // typo'd or unknown id must fail loudly rather than silently publish wrong scores.
  const configuredQualifyingDisqualified = calendarRace.qualifyingDisqualified;
  if (configuredQualifyingDisqualified != null && !Array.isArray(configuredQualifyingDisqualified)) {
    throw new Error(`qualifyingDisqualified for ${calendarRace.id} must be an array of driver ids`);
  }
  const entrantDriverIds = new Set([...driverDirectory.values()].map((entry) => entry.canonicalDriverId));
  for (const driverId of configuredQualifyingDisqualified || []) {
    if (!entrantDriverIds.has(driverId)) {
      throw new Error(`qualifyingDisqualified for ${calendarRace.id} names "${driverId}", who is not in the race entry list`);
    }
  }
  const qualifyingDisqualified = new Set(configuredQualifyingDisqualified || []);
  const fieldSize = driverDirectory.size;
  const sprintFieldSize = fetchedRace.sprintResultRows.length
    || Object.keys(fiaSprint).length
    || fieldSize;

  for (const directoryEntry of driverDirectory.values()) {
    const raceResult = raceMap.get(directoryEntry.driver_number);
    if (!raceResult) {
      throw new Error(`Missing race classification for driver number ${directoryEntry.driver_number}`);
    }

    const driverFine = fineSummary.drivers?.[directoryEntry.canonicalDriverId] || 0;
    const gridStart = fiaGrid[directoryEntry.canonicalDriverId] ?? gridStarts.get(directoryEntry.driver_number) ?? null;
    const sprintResult = sprintResultMap.get(directoryEntry.driver_number);
    const sprintDisqualified = fiaSprintDisqualified
      ? fiaSprintDisqualified.has(directoryEntry.canonicalDriverId)
      : Boolean(sprintResult?.dsq);
    const raceDisqualified = fiaRaceDisqualified
      ? fiaRaceDisqualified.has(directoryEntry.canonicalDriverId)
      : Boolean(raceResult.dsq);
    const sprintPosition = sprintDisqualified
      ? sprintFieldSize
      : fiaSprint[directoryEntry.canonicalDriverId]
        ?? sprintPositions.get(directoryEntry.driver_number) ?? null;
    const racePosition = raceDisqualified
      ? fieldSize
      : fiaFinish[directoryEntry.canonicalDriverId]
        ?? finishingPositions.get(directoryEntry.driver_number) ?? null;
    drivers[directoryEntry.canonicalDriverId] = {
      driverId: directoryEntry.canonicalDriverId,
      teamId: directoryEntry.canonicalTeamId,
      driverNumber: directoryEntry.driver_number,
      qualifyingPosition: qualifyingMap.get(directoryEntry.driver_number) || null,
      // The FIA final sprint classification is definitive (it reflects sprint
      // penalties, which shift the order rather than being served); fall back to
      // OpenF1 only when the document is unavailable.
      sprintPosition,
      gridStart,
      // Separate baseline for position change; equals gridStart unless the driver
      // was disqualified in qualifying, in which case it is the last grid slot.
      improvementGrid: qualifyingDisqualified.has(directoryEntry.canonicalDriverId) ? fieldSize : gridStart,
      racePosition,
      classified: !raceResult.dns && !raceDisqualified,
      dnf: Boolean(raceResult.dnf),
      dns: Boolean(raceResult.dns),
      dsq: raceDisqualified,
      fastestLap: directoryEntry.driver_number === fastestLap,
      gridPenaltyPlaces: gridPenaltyMap.get(directoryEntry.driver_number) || 0,
      // A driver present in the FIA classification takes the FIA penalty (0 when
      // the FIA issued none, so an OpenF1 phantom is dropped); only fall back to
      // OpenF1 for a driver the FIA document did not cover.
      timePenaltySeconds: directoryEntry.canonicalDriverId in fiaFinish
        ? (fiaPenalties[directoryEntry.canonicalDriverId] || 0)
        : (timePenaltyMap.get(directoryEntry.driver_number) || 0),
      fineEuros: driverFine,
      finePoints: 0,
    };

    if (!teams[directoryEntry.canonicalTeamId]) {
      teams[directoryEntry.canonicalTeamId] = {
        teamId: directoryEntry.canonicalTeamId,
        driverIds: [],
        fineEuros: fineSummary.teams?.[directoryEntry.canonicalTeamId] || 0,
        finePoints: 0,
      };
    }
    teams[directoryEntry.canonicalTeamId].driverIds.push(directoryEntry.canonicalDriverId);
  }

  return {
    raceId: calendarRace.id,
    raceName: calendarRace.name,
    date: calendarRace.date,
    round: calendarRace.round,
    sprintWeekend: Boolean(calendarRace.isSprintWeekend),
    documents: fineSummary.documents || [],
    drivers,
    teams,
    meta: {
      meetingKey: fetchedRace.meeting.meeting_key,
      sessions: {
        qualifying: fetchedRace.sessions.qualifying.session_key,
        sprint: fetchedRace.sessions.sprint?.session_key || null,
        race: fetchedRace.sessions.race.session_key,
      },
      generatedAt: new Date().toISOString(),
    },
  };
}
