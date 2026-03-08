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

function sessionByType(sessions, sessionType) {
  return sessions.find((session) => normalizeText(session.session_type || session.session_name) === normalizeText(sessionType)) || null;
}

function pickMeeting(meetings, calendarRace) {
  const targetDate = new Date(`${calendarRace.date}T00:00:00Z`).getTime();
  return [...meetings].sort((left, right) => {
    const leftDistance = Math.abs(new Date(left.date_start).getTime() - targetDate);
    const rightDistance = Math.abs(new Date(right.date_start).getTime() - targetDate);
    return leftDistance - rightDistance;
  })[0];
}

function parseTimePenaltyMessages(messages) {
  const penalties = new Map();
  for (const message of messages) {
    const match = String(message.message || '').match(/(\d+)\s+SECOND TIME PENALTY FOR CAR\s+(\d+)/i);
    if (!match) continue;
    const seconds = Number.parseInt(match[1], 10);
    const driverNumber = Number.parseInt(match[2], 10);
    penalties.set(driverNumber, (penalties.get(driverNumber) || 0) + seconds);
  }
  return penalties;
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

function canonicalizeDriverName(driver) {
  const direct = resolveDriver(`${driver.first_name || ''} ${driver.last_name || ''}`.trim());
  if (direct) return direct;
  return resolveDriver(driver.full_name) || resolveDriver(driver.broadcast_name);
}

function canonicalizeTeamName(teamName) {
  return resolveTeam(teamName);
}

export async function fetchRaceWeekend(calendarRace) {
  let meetings = await fetchJson('meetings', {
    year: '2026',
    meeting_name: calendarRace.meetingName,
  });

  if (!meetings.length) {
    meetings = await fetchJson('meetings', { year: '2026' });
  }

  const matchingMeetings = meetings.filter((meeting) => {
    const meetingNameMatches = normalizeText(meeting.meeting_name).includes(normalizeText(calendarRace.meetingName));
    const dateMatches = String(meeting.date_start || '').startsWith(calendarRace.date);
    return meetingNameMatches || dateMatches;
  });

  if (!matchingMeetings.length) {
    throw new Error(`No OpenF1 meeting found for ${calendarRace.meetingName}`);
  }

  const meeting = pickMeeting(matchingMeetings, calendarRace);
  const sessions = await fetchJson('sessions', { meeting_key: String(meeting.meeting_key) });
  const raceSession = sessionByType(sessions, 'Race');
  const qualifyingSession = sessionByType(sessions, 'Qualifying');
  const sprintSession = sessionByType(sessions, 'Sprint');

  if (!raceSession || !qualifyingSession) {
    throw new Error(`OpenF1 sessions incomplete for ${calendarRace.id}`);
  }

  const raceControlBatches = await Promise.all(
    sessions
      .filter((session) => session.session_key != null)
      .map((session) => fetchJson('race_control', { session_key: String(session.session_key) })),
  );

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
    raceControlMessages: raceControlBatches.flat().sort((left, right) => new Date(left.date) - new Date(right.date)),
    positionFeed,
  };
}

export function normalizeRaceWeekend(calendarRace, fetchedRace, fineSummary = { drivers: {}, teams: {}, documents: [] }) {
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

  const sprintMap = new Map();
  for (const result of fetchedRace.sprintResultRows) {
    sprintMap.set(result.driver_number, result.position);
  }

  const raceMap = new Map();
  for (const result of fetchedRace.raceResultRows) {
    raceMap.set(result.driver_number, result);
  }

  const gridPenaltyMap = parseGridPenaltyMessages(fetchedRace.raceControlMessages);
  const timePenaltyMap = parseTimePenaltyMessages(fetchedRace.raceControlMessages);
  const fastestLapByDriver = indexFastestLapByDriver(fetchedRace.laps);
  const fastestLap = [...fastestLapByDriver.entries()].sort((left, right) => left[1] - right[1])[0]?.[0] || null;
  const gridStarts = deriveGridStarts(fetchedRace.positionFeed);

  for (const driverNumber of driverDirectory.keys()) {
    if (!gridStarts.has(driverNumber)) {
      throw new Error(`Missing official grid start for driver number ${driverNumber}`);
    }
  }

  const drivers = {};
  const teams = {};

  for (const directoryEntry of driverDirectory.values()) {
    const raceResult = raceMap.get(directoryEntry.driver_number);
    if (!raceResult) {
      throw new Error(`Missing race classification for driver number ${directoryEntry.driver_number}`);
    }

    const driverFine = fineSummary.drivers?.[directoryEntry.canonicalDriverId] || 0;
    drivers[directoryEntry.canonicalDriverId] = {
      driverId: directoryEntry.canonicalDriverId,
      teamId: directoryEntry.canonicalTeamId,
      driverNumber: directoryEntry.driver_number,
      qualifyingPosition: qualifyingMap.get(directoryEntry.driver_number) || null,
      sprintPosition: sprintMap.get(directoryEntry.driver_number) || null,
      gridStart: gridStarts.get(directoryEntry.driver_number) || null,
      racePosition: raceResult.position || null,
      classified: !raceResult.dns && !raceResult.dsq,
      dnf: Boolean(raceResult.dnf),
      dns: Boolean(raceResult.dns),
      dsq: Boolean(raceResult.dsq),
      fastestLap: directoryEntry.driver_number === fastestLap,
      gridPenaltyPlaces: gridPenaltyMap.get(directoryEntry.driver_number) || 0,
      timePenaltySeconds: timePenaltyMap.get(directoryEntry.driver_number) || 0,
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
