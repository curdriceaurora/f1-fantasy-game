import { CANONICAL_DRIVERS, CANONICAL_TEAMS } from './canonical.js';

export const SEAT_SESSIONS = ['qualifying', 'sprint', 'race'];

const seats = [];
const seatByOwner = new Map();
const seatsByTeam = new Map();

// Baseline from Martin's Race 1 results table, not the calculator's preseason
// display labels. In particular, Martin starts 2026 with Hadjar at Red Bull and
// Lawson at Racing Bulls and scores their named results from that baseline.
const TEAM_SEAT_OWNER_IDS = {
  mclaren: ['lando-norris', 'oscar-piastri'],
  mercedes: ['george-russell', 'kimi-antonelli'],
  'red-bull': ['max-verstappen', 'isack-hadjar'],
  ferrari: ['charles-leclerc', 'lewis-hamilton'],
  williams: ['carlos-sainz', 'alex-albon'],
  'racing-bulls': ['liam-lawson', 'arvid-lindblad'],
  'aston-martin': ['fernando-alonso', 'lance-stroll'],
  haas: ['esteban-ocon', 'oliver-bearman'],
  audi: ['nico-hulkenberg', 'gabriel-bortoleto'],
  alpine: ['pierre-gasly', 'franco-colapinto'],
  cadillac: ['sergio-perez', 'valtteri-bottas'],
};

for (const [teamId, ownerDriverIds] of Object.entries(TEAM_SEAT_OWNER_IDS)) {
  const teamSeats = ownerDriverIds.map((ownerDriverId, index) => {
    const seat = Object.freeze({
      id: `${teamId}:${index + 1}`,
      teamId,
      ownerDriverId,
    });
    seatByOwner.set(ownerDriverId, seat);
    seats.push(seat);
    return seat;
  });
  seatsByTeam.set(teamId, teamSeats);
}

export const CANONICAL_SEATS = Object.freeze(seats);

for (const team of CANONICAL_TEAMS) {
  if (seatsForTeam(team.id).length !== 2) {
    throw new Error(`Canonical team ${team.id} must define exactly two seats`);
  }
}
if (seatByOwner.size !== CANONICAL_DRIVERS.length) {
  throw new Error('Every canonical driver must own exactly one baseline seat');
}

export function seatForDriver(driverId) {
  return seatByOwner.get(driverId) || null;
}

export function seatsForTeam(teamId) {
  return [...(seatsByTeam.get(teamId) || [])];
}

export function resolveSeatOccupants(driverId, overrides = {}, inferredRaceOccupants = {}) {
  const seat = seatForDriver(driverId);
  if (!seat) throw new Error(`No canonical seat found for driver "${driverId}"`);
  const configured = overrides?.[seat.id];
  if (configured != null && (typeof configured !== 'object' || Array.isArray(configured))) {
    throw new Error(`Seat occupant override for ${seat.id} must be an object`);
  }

  const occupants = {};
  for (const session of SEAT_SESSIONS) {
    occupants[session] = configured && Object.hasOwn(configured, session)
      ? configured[session]
      : inferredRaceOccupants[seat.id] || seat.ownerDriverId;
  }
  return { seat, occupants };
}

export function inferRaceSeatOccupants(raceTeams, overrides = {}, raceId = 'race') {
  const occupants = {};
  for (const [teamId, raceTeam] of Object.entries(raceTeams || {})) {
    const teamSeats = seatsForTeam(teamId);
    if (!teamSeats.length) continue;
    const actualDriverIds = [...new Set(raceTeam.driverIds || [])];
    if (actualDriverIds.length !== teamSeats.length) {
      throw new Error(
        `Cannot resolve ${teamId} seats for ${raceId}: expected ${teamSeats.length} race occupants, found ${actualDriverIds.length}`,
      );
    }

    const unfilledSeats = [];
    const unmatchedDrivers = new Set(actualDriverIds);
    for (const seat of teamSeats) {
      if (unmatchedDrivers.delete(seat.ownerDriverId)) {
        occupants[seat.id] = seat.ownerDriverId;
      } else if (overrides?.[seat.id] && Object.hasOwn(overrides[seat.id], 'race')) {
        occupants[seat.id] = overrides[seat.id].race;
        unmatchedDrivers.delete(overrides[seat.id].race);
      } else {
        unfilledSeats.push(seat);
      }
    }

    if (unfilledSeats.length === 1 && unmatchedDrivers.size === 1) {
      occupants[unfilledSeats[0].id] = [...unmatchedDrivers][0];
      continue;
    }
    if (unfilledSeats.length || unmatchedDrivers.size) {
      throw new Error(
        `Cannot unambiguously resolve ${teamId} seat changes for ${raceId}; add explicit race seatOccupants overrides`,
      );
    }
  }
  return occupants;
}

export function validateSeatOccupantOverrides(overrides, availableDriverIds, raceId = 'race') {
  if (overrides == null) return;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error(`seatOccupants for ${raceId} must be an object keyed by seat id`);
  }

  const knownSeatIds = new Set(CANONICAL_SEATS.map((seat) => seat.id));
  const availableDrivers = Array.isArray(availableDriverIds)
    ? Object.fromEntries(availableDriverIds.map((driverId) => [driverId, null]))
    : availableDriverIds;
  for (const [seatId, configured] of Object.entries(overrides)) {
    if (!knownSeatIds.has(seatId)) {
      throw new Error(`seatOccupants for ${raceId} names unknown seat "${seatId}"`);
    }
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
      throw new Error(`Seat occupant override for ${seatId} must be an object`);
    }
    for (const [session, occupantDriverId] of Object.entries(configured)) {
      if (!SEAT_SESSIONS.includes(session)) {
        throw new Error(`Seat occupant override for ${seatId} uses unknown session "${session}"`);
      }
      if (occupantDriverId == null) {
        throw new Error(
          `Seat ${seatId} is empty for ${session} at ${raceId}; empty-seat scoring is blocked pending Martin's ruling`,
        );
      }
      if (typeof occupantDriverId !== 'string' || !Object.hasOwn(availableDrivers, occupantDriverId)) {
        throw new Error(
          `Seat ${seatId} names unavailable ${session} occupant "${occupantDriverId}" for ${raceId}`,
        );
      }
    }
  }
}
