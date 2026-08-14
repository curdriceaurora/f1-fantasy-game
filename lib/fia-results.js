import { resolveDriverByCarNumber } from './canonical.js';
import {
  fetchFiaDecisionUrls, fiaEventName, isPotentialFineDocument, meetingToFiaSlug,
} from './fia-documents.js';
import { fetchPdfText } from './fines.js';

const FIA_DECISION_DOCS = 'https://www.fia.com/system/files/decision-document';

// Fetch and parse the FIA final-classification and starting-grid documents for a
// race, returning JSON-serializable maps keyed by canonical driver id (so they
// survive the raw-data cache). A missing document degrades to an empty map, which
// normalizeRaceWeekend reads as "fall back to OpenF1 for this field".
export async function fetchRaceResults(race, options = {}) {
  const year = race.date.slice(0, 4);
  const slug = meetingToFiaSlug(fiaEventName(race));
  const fetchPdfTextImpl = options.fetchPdfTextImpl || fetchPdfText;
  const doc = (name) => fetchPdfTextImpl(`${FIA_DECISION_DOCS}/${year}_${slug}_-_${name}.pdf`, options).catch(() => null);
  const [classificationText, gridText, sprintText] = await Promise.all([
    doc('final_race_classification'),
    doc('final_starting_grid'),
    // Sprint weekends publish a separate final sprint classification.
    race.isSprintWeekend ? doc('final_sprint_classification') : Promise.resolve(null),
  ]);

  const classification = classificationText
    ? parseFinalClassification(classificationText)
    : { positions: new Map(), penalties: new Map(), disqualified: new Set() };
  const grid = gridText
    ? parseStartingGrid(gridText)
    : { positions: new Map(), pitLaneStarters: new Map() };
  const gridPenalties = gridText ? parseGridPenalties(gridText) : new Map();
  const pitLaneGridPenalties = gridText
    ? await resolvePitLaneGridPenalties(race, grid.pitLaneStarters, options)
    : null;

  for (const [driverId, resolution] of Object.entries(pitLaneGridPenalties || {})) {
    if (gridPenalties.has(driverId)) {
      throw new Error(`Pit-lane starter "${driverId}" also has a numbered starting-grid penalty; the sources are expected to be disjoint`);
    }
    if (resolution.status === 'resolved') gridPenalties.set(driverId, resolution.places);
  }
  const sprint = sprintText
    ? parseFinalClassification(sprintText)
    : { positions: new Map(), penalties: new Map(), disqualified: new Set() };

  return {
    finishingPositions: Object.fromEntries(classification.positions),
    disqualifiedDrivers: classificationText ? [...classification.disqualified] : null,
    penaltySeconds: Object.fromEntries(classification.penalties),
    gridPositions: Object.fromEntries(grid.positions),
    // null when the starting grid could not be fetched, matching disqualifiedDrivers
    // above: the normalizer treats null as "fall back to OpenF1" and {} as "the
    // document was read and nobody was penalised". Returning {} in both cases would
    // make a failed download look authoritative, since Boolean({}) is true.
    gridPenaltyPlaces: gridText ? Object.fromEntries(gridPenalties) : null,
    pitLaneGridPenalties,
    sprintPositions: Object.fromEntries(sprint.positions),
    sprintDisqualifiedDrivers: sprintText ? [...sprint.disqualified] : null,
  };
}

// The FIA final-classification and starting-grid documents are the definitive
// source Martin scores from; OpenF1 only ever stood in for them. Both parse from
// the plain text of the PDF (see fetchPdfText). Cars are matched by number, which
// resolves cleanly even though the extracted text glues the name to the entrant.

const RESULT_ROW = /^(\d+)[A-Za-z]/;
// PDF extraction often glues the terminal status to the entrant name
// (e.g. "Scuderia Ferrari HPDQ"). Match only at the end of the row so a
// driver or entrant token containing the same letters cannot become a DSQ.
const DISQUALIFIED_ROW = /(?:DISQUALIFIED|DSQ|DQ)\s*$/i;

// A FIA "Final Race Classification" lists finishers as "{position}{carNumber}{name}..."
// (e.g. "1263..." = P12, car 63), then a NOT CLASSIFIED block that gives only the
// car number and continues the numbering in the order the FIA prints — descending
// laps. Returns { positions, penalties }, both maps keyed by canonical driver id.
export function parseFinalClassification(text) {
  const source = String(text || '');
  const body = source.split(/\n\s*(?:FASTEST LAP|NOTES|\*?\s*PENALTIES)\b/i)[0];
  const cutoff = body.search(/NOT CLASSIFIED/i);
  const classifiedText = cutoff >= 0 ? body.slice(0, cutoff) : body;
  const retiredText = cutoff >= 0 ? body.slice(cutoff) : '';

  const positions = new Map();
  const disqualified = new Set();
  let position = 0;

  for (const line of classifiedText.split('\n')) {
    const match = line.trim().match(RESULT_ROW);
    if (!match) continue;
    position += 1;
    // Strip the leading position digits to leave the car number.
    const carNumber = match[1].slice(String(position).length);
    const driver = carNumber && resolveDriverByCarNumber(carNumber);
    if (driver) {
      positions.set(driver.id, position);
      if (DISQUALIFIED_ROW.test(line)) disqualified.add(driver.id);
    }
  }

  for (const line of retiredText.split('\n')) {
    const match = line.trim().match(RESULT_ROW);
    if (!match) continue;
    position += 1;
    const driver = resolveDriverByCarNumber(match[1]);
    if (driver) {
      positions.set(driver.id, position);
      if (DISQUALIFIED_ROW.test(line)) disqualified.add(driver.id);
    }
  }

  return { positions, penalties: parsePenalties(source), disqualified };
}

function parsePenalties(text) {
  const section = String(text).split(/PENALTIES/i).slice(1).join(' ');
  const penalties = new Map();
  // The seconds do not always follow the dash directly: Miami describes Leclerc's
  // as "Drive through penalty converted to 20 second time penalty". Allow a lead-in
  // clause, but stop it at the next "Car N" so an entry with no seconds of its own
  // cannot swallow the following car's penalty.
  const pattern = /Car\s+(\d{1,2})\s*[-–—]\s*(?:(?!Car\s+\d)[^\n])*?(?:(\d+)\s*x\s*)?(\d+)\s*second/gi;
  for (const match of section.matchAll(pattern)) {
    const seconds = Number(match[3]) * (match[2] ? Number(match[2]) : 1);
    const driver = resolveDriverByCarNumber(match[1]);
    if (driver) penalties.set(driver.id, (penalties.get(driver.id) || 0) + seconds);
  }
  return penalties;
}

// Grid penalties are published in the PENALTIES footer of the FIA final starting
// grid, and nowhere else we ingest: OpenF1's race-control feed carries none at all
// (0 across every 2026 round), which is why gridPenaltyPlaces had never been set
// for any driver before this parser existed. See #62.
//
// One line can cover several cars — "Cars 18, 1 & 55 - 10 place grid penalties" —
// and failing to expand that is what left Sainz unpenalised at Belgium.
//
// Place counts are returned raw, including accumulations above 10. The §2.4 cap is
// scoring's job (scoreGridPenalty), not the parser's; capping here would discard
// the published fact.
//
// Pit-lane starts carry no place count in this document. They are deliberately
// absent from this parser and resolved separately from their steward decisions;
// collapsing an unrecognised form to zero is indistinguishable from no penalty.
const GRID_PENALTY_LINE = /Cars?\s+([\d,\s&and]+?)\s*[-–—]\s*(\d+)\s*place\s+grid\s+penalt/gi;

export function parseGridPenalties(text) {
  // Scanned whole-document rather than after a split on the "PENALTIES" header:
  // the plural line "10 place grid penalties" contains that word, so splitting on
  // it cuts the line in half and loses the match. The pattern is specific enough
  // to need no section anchor.
  const penalties = new Map();
  for (const match of String(text || '').matchAll(GRID_PENALTY_LINE)) {
    const places = Number(match[2]);
    const carNumbers = match[1].split(/[,&]|\band\b/i).map((part) => part.trim()).filter(Boolean);
    for (const carNumber of carNumbers) {
      const driver = resolveDriverByCarNumber(carNumber);
      if (driver) penalties.set(driver.id, (penalties.get(driver.id) || 0) + places);
    }
  }
  return penalties;
}

// A FIA "Final Starting Grid" prints each slot as a position line ("4") followed
// by a "{carNumber}{name}" line. Pit-lane starters appear in a separate unnumbered
// section; give them consecutive virtual positions after the numbered grid, in
// the order the FIA lists them (one starter is P22; two are P21 and P22).
// Returns both representations. Keeping the starter set after assigning virtual
// positions is what lets the caller require a resolved-or-explicitly-unresolved
// grid-penalty result for every pit-lane starter.
export function parseStartingGrid(text) {
  const source = String(text || '');
  const lines = source.split('\n').map((line) => line.trim());
  const grid = new Map();
  const pitLaneStarters = new Map();
  for (let index = 1; index < lines.length; index += 1) {
    if (!/^\d{1,2}$/.test(lines[index - 1])) continue;
    const entry = lines[index].match(RESULT_ROW);
    if (!entry) continue;
    const position = Number(lines[index - 1]);
    const driver = resolveDriverByCarNumber(entry[1]);
    if (driver && position >= 1 && position <= 30) grid.set(driver.id, position);
  }

  const pitLaneStart = source.search(/DRIVERS REQUIRED TO START FROM THE PIT LANE/i);
  if (pitLaneStart >= 0) {
    const pitLaneText = source
      .slice(pitLaneStart)
      .split(/\n\s*(?:NOTES|\*?\s*PENALTIES)\b/i)[0];
    const pitLaneLines = pitLaneText.split('\n').map((line) => line.trim());
    const pitLaneDrivers = [];
    const seenDriverIds = new Set();

    for (let index = 1; index < pitLaneLines.length; index += 1) {
      const compactEntry = pitLaneLines[index].match(RESULT_ROW);
      const splitCarNumber = /^\d{1,2}$/.test(pitLaneLines[index])
        && /^[A-Za-z]/.test(pitLaneLines[index + 1] || '')
        ? pitLaneLines[index]
        : null;
      const carNumber = compactEntry?.[1] || splitCarNumber;
      const driver = carNumber && resolveDriverByCarNumber(carNumber);
      if (driver && !seenDriverIds.has(driver.id)) {
        pitLaneDrivers.push({ driver, carNumber: Number(carNumber) });
        seenDriverIds.add(driver.id);
      }
    }

    const firstPitLanePosition = Math.max(0, ...grid.values()) + 1;
    pitLaneDrivers.forEach(({ driver, carNumber }, index) => {
      grid.set(driver.id, firstPitLanePosition + index);
      pitLaneStarters.set(driver.id, carNumber);
    });
  }

  return { positions: grid, pitLaneStarters };
}

function normalizedDecisionText(text) {
  return String(text || '').replace(/\u00a0/g, ' ');
}

// A result is returned only for a decision that explicitly orders this car to
// start the Race (not a Sprint) from the pit lane. Once that representation is
// recognised there is no zero-valued default: the place count is either resolved
// from the decision or carried forward as an explicit unresolved state.
export function parsePitLaneGridPenaltyDecision(text) {
  const source = normalizedDecisionText(text);
  if (!/Required\s+to\s+start\s+the\s+Race\s+from\s+(?:the\s+)?pit\s+lane/i.test(source)) return null;

  const stated = source.match(/accumulation\s+of\s+(\d+)\s+places/i);
  if (stated) return { status: 'resolved', places: Number(stated[1]), method: 'stated-accumulation' };

  const fact = source.match(/Fact\s+The following Power Unit elements have been used:\s*([\s\S]*?)\s+Infringement\b/i)?.[1] || '';
  const additionalElements = [...fact.matchAll(/^\s*\d+(?:st|nd|rd|th)\s+[^\n]+$/gim)];
  if (additionalElements.length) {
    return {
      status: 'resolved',
      places: additionalElements.length * 10,
      method: 'power-unit-elements',
    };
  }

  return { status: 'unresolved', reason: 'no-place-count-in-race-decision' };
}

export async function resolvePitLaneGridPenalties(race, pitLaneStarters, options = {}) {
  if (!pitLaneStarters.size) return {};

  const fetchFiaDecisionUrlsImpl = options.fetchFiaDecisionUrlsImpl || fetchFiaDecisionUrls;
  const fetchPdfTextImpl = options.fetchPdfTextImpl || fetchPdfText;
  const urls = await fetchFiaDecisionUrlsImpl(race, options);
  const resolutions = {};

  for (const [driverId, carNumber] of pitLaneStarters) {
    const carPattern = new RegExp(`car[_-]${carNumber}(?!\\d)`, 'i');
    const candidates = urls.filter((url) => carPattern.test(url) && isPotentialFineDocument(url));
    const matches = [];
    for (const url of candidates) {
      try {
        const parsed = parsePitLaneGridPenaltyDecision(await fetchPdfTextImpl(url, options));
        if (parsed) matches.push({ ...parsed, sourceUrl: url });
      } catch {
        // An unreadable candidate is not proof that no penalty exists. If no
        // readable race decision remains, the starter is marked unresolved.
      }
    }

    const resolved = matches.filter((match) => match.status === 'resolved');
    const distinctCounts = new Set(resolved.map((match) => match.places));
    if (distinctCounts.size > 1) {
      throw new Error(`Conflicting pit-lane grid-penalty counts for ${driverId}: ${[...distinctCounts].join(', ')}`);
    }
    resolutions[driverId] = resolved[0]
      || matches[0]
      || { status: 'unresolved', reason: 'race-decision-not-found' };
  }

  if (Object.keys(resolutions).length !== pitLaneStarters.size) {
    throw new Error(`Resolved ${Object.keys(resolutions).length} of ${pitLaneStarters.size} pit-lane starters`);
  }
  return resolutions;
}
