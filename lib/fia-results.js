import { resolveDriverByCarNumber } from './canonical.js';
import { fetchFiaDecisionUrls, fiaEventName, isPotentialFineDocument, meetingToFiaSlug } from './fia-documents.js';
import { fetchPdfText, gridPenaltyFromText, timePenaltyFromText } from './fines.js';

const FIA_DECISION_DOCS = 'https://www.fia.com/system/files/decision-document';

// Fetch and parse the FIA final-classification and starting-grid documents for a
// race, returning JSON-serializable maps keyed by canonical driver id (so they
// survive the raw-data cache). A missing document degrades to an empty map, which
// normalizeRaceWeekend reads as "fall back to OpenF1 for this field".
export async function fetchRaceResults(race, options = {}) {
  const year = race.date.slice(0, 4);
  const slug = meetingToFiaSlug(fiaEventName(race));
  const doc = (name) => fetchPdfText(`${FIA_DECISION_DOCS}/${year}_${slug}_-_${name}.pdf`, options).catch(() => null);
  const [classificationText, gridText, sprintText] = await Promise.all([
    doc('final_race_classification'),
    doc('final_starting_grid'),
    // Sprint weekends publish a separate final sprint classification.
    race.isSprintWeekend ? doc('final_sprint_classification') : Promise.resolve(null),
  ]);

  const classification = classificationText
    ? parseFinalClassification(classificationText)
    : { positions: new Map(), penalties: new Map(), disqualified: new Set() };
  const grid = gridText ? parseStartingGrid(gridText) : new Map();
  const sprint = sprintText
    ? parseFinalClassification(sprintText)
    : { positions: new Map(), penalties: new Map(), disqualified: new Set() };

  return {
    finishingPositions: Object.fromEntries(classification.positions),
    disqualifiedDrivers: classificationText ? [...classification.disqualified] : null,
    penaltySeconds: Object.fromEntries(classification.penalties),
    gridPositions: Object.fromEntries(grid),
    sprintPositions: Object.fromEntries(sprint.positions),
    sprintDisqualifiedDrivers: sprintText ? [...sprint.disqualified] : null,
  };
}

// Scan a race's FIA decision documents once for time and grid penalties, each
// summed per driver. Each infringement/decision names the penalised car in its
// title, so the car number resolves the driver; a driver with two penalties (or
// a "2 x 5 second") is totalled. scoreTimePenalty/scoreGridPenalty apply the cap.
export async function fetchDecisionPenalties(race, options = {}) {
  const urls = (await fetchFiaDecisionUrls(race, options).catch(() => [])).filter(isPotentialFineDocument);
  const timePenalties = {};
  const gridPenalties = {};
  for (const url of urls) {
    const carMatch = url.match(/car[_-](\d{1,2})(?!\d)/i);
    const driver = carMatch && resolveDriverByCarNumber(carMatch[1]);
    if (!driver) continue;
    const text = await fetchPdfText(url, options).catch(() => '');
    const seconds = timePenaltyFromText(text);
    if (seconds) timePenalties[driver.id] = (timePenalties[driver.id] || 0) + seconds;
    const places = gridPenaltyFromText(text);
    if (places) gridPenalties[driver.id] = Math.max(gridPenalties[driver.id] || 0, places);
  }
  return { timePenalties, gridPenalties };
}

// The FIA final-classification and starting-grid documents are the definitive
// source Martin scores from; OpenF1 only ever stood in for them. Both parse from
// the plain text of the PDF (see fetchPdfText). Cars are matched by number, which
// resolves cleanly even though the extracted text glues the name to the entrant.

const RESULT_ROW = /^(\d+)[A-Za-z]/;
// PDF extraction often glues the terminal status to the entrant name, so only
// require a boundary after the marker (e.g. "Scuderia Ferrari HPDQ").
const DISQUALIFIED_ROW = /(?:DQ|DSQ|DISQUALIFIED)(?:\s|$)/i;

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
  const pattern = /Car\s+(\d{1,2})\s*[-–—]\s*(?:(\d+)\s*x\s*)?(\d+)\s*second/gi;
  for (const match of section.matchAll(pattern)) {
    const seconds = Number(match[3]) * (match[2] ? Number(match[2]) : 1);
    const driver = resolveDriverByCarNumber(match[1]);
    if (driver) penalties.set(driver.id, (penalties.get(driver.id) || 0) + seconds);
  }
  return penalties;
}

// A FIA "Final Starting Grid" prints each slot as a position line ("4") followed
// by a "{carNumber}{name}" line. Pit-lane starters appear in a separate unnumbered
// section; give them consecutive virtual positions after the numbered grid, in
// the order the FIA lists them (one starter is P22; two are P21 and P22).
// Returns a map of grid position keyed by driver id.
export function parseStartingGrid(text) {
  const source = String(text || '');
  const lines = source.split('\n').map((line) => line.trim());
  const grid = new Map();
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
        pitLaneDrivers.push(driver);
        seenDriverIds.add(driver.id);
      }
    }

    const firstPitLanePosition = Math.max(0, ...grid.values()) + 1;
    pitLaneDrivers.forEach((driver, index) => grid.set(driver.id, firstPitLanePosition + index));
  }

  return grid;
}
