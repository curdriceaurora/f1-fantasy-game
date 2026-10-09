import { normalizeText } from './canonical.js';
import { configPath, readJson } from './season-store.js';

// A reserve driver races without owning a season seat. They are kept out of the
// canonical roster on purpose: canonical drivers carry a rank and own exactly
// one seat, and a stand-in has neither. Scoring reaches a reserve only through
// the seat they filled (lib/seats.js), so all this registry has to do is let the
// two ingestion readers name them — OpenF1 by driver name, FIA by car number.
export function loadReserves() {
  const stored = readJson(configPath('reserve-drivers.json'), {});
  const reserves = Array.isArray(stored) ? stored : stored?.reserves;
  return Array.isArray(reserves) ? reserves : [];
}

export function reserveByCarNumber(carNumber) {
  const wanted = Number(carNumber);
  if (!Number.isFinite(wanted)) return null;
  return loadReserves().find((reserve) => Number(reserve.driverNumber) === wanted) || null;
}

export function reserveByName(value) {
  const wanted = normalizeText(value);
  if (!wanted) return null;
  return loadReserves().find((reserve) => normalizeText(reserve.fullName) === wanted) || null;
}

// OpenF1 names a driver several ways; try the ones a reserve entry can match.
export function resolveReserve(driver) {
  return reserveByCarNumber(driver?.driver_number)
    || reserveByName(driver?.full_name)
    || reserveByName(`${driver?.first_name || ''} ${driver?.last_name || ''}`.trim())
    || null;
}
