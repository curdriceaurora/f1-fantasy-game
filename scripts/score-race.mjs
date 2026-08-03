#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { fetchFineSummary } from '../lib/fines.js';
import { fetchRaceResults } from '../lib/fia-results.js';
import { fetchRaceWeekend, normalizeRaceWeekend } from '../lib/openf1.js';
import { rebuildScoreboard } from '../lib/publish-scoreboard.js';
import { evaluateRaceWorkflow } from '../lib/race-workflow.js';
import { ensureSeasonDirs, loadCalendar, loadEntries, loadFineReview, normalizedRacePath, rawRacePath, scoredRacePath, writeJson } from '../lib/season-store.js';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--race') {
      args.race = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function assertFineReviewReady(raceId, fineReview) {
  if (!fineReview.reviewed) {
    throw new Error(`Fine review for ${raceId} is incomplete. Mark the race as reviewed in season/config/fine-documents.json before Monday scoring.`);
  }
}

function assertRaceReadyForScoring(raceId, workflow, fineReview) {
  if (workflow.state === 'scheduled') {
    throw new Error(`Race ${raceId} is not yet eligible for Monday scoring. Earliest publication time is ${workflow.publicationAt.toISOString()}.`);
  }
  if (workflow.state === 'awaiting_fine_review') {
    assertFineReviewReady(raceId, fineReview);
  }
}

export async function scoreRace(raceId, services = {}) {
  ensureSeasonDirs();

  const entries = loadEntries();
  if (!entries.length) {
    throw new Error(`No imported entries found. Run "npm run sync:entries" first.`);
  }

  const calendar = loadCalendar();
  const calendarRace = calendar.find((race) => race.id === raceId);
  if (!calendarRace) {
    throw new Error(`Unknown race id "${raceId}".`);
  }

  const fineReview = loadFineReview(calendarRace.id);
  const workflow = evaluateRaceWorkflow({
    race: calendarRace,
    now: services.now || new Date(),
    fineReview,
    normalizedExists: existsSync(normalizedRacePath(calendarRace.id)),
    scoredExists: existsSync(scoredRacePath(calendarRace.id)),
  });
  assertRaceReadyForScoring(calendarRace.id, workflow, fineReview);

  const fetchRaceWeekendImpl = services.fetchRaceWeekend || fetchRaceWeekend;
  const fetchFineSummaryImpl = services.fetchFineSummary || fetchFineSummary;
  const fetchRaceResultsImpl = services.fetchRaceResults || fetchRaceResults;
  const fetchedRace = await fetchRaceWeekendImpl(calendarRace);
  // The FIA final-classification and starting-grid documents are the definitive
  // grid/finish/penalty source; normalizeRaceWeekend prefers them over OpenF1.
  // Skip the fetch when the weekend data already carries them (cached re-scores
  // and tests supply their own).
  fetchedRace.fiaResults = fetchedRace.fiaResults ?? await fetchRaceResultsImpl(calendarRace);
  writeJson(rawRacePath(calendarRace.id, 'openf1.json'), fetchedRace);

  assertFineReviewReady(calendarRace.id, fineReview);
  const fineSummary = await fetchFineSummaryImpl(calendarRace.id, fineReview.documents);
  if (fineSummary.warnings.length) {
    writeJson(rawRacePath(calendarRace.id, 'fines.json'), fineSummary);
    throw new Error(`FIA fine parsing is incomplete for ${calendarRace.id}: ${fineSummary.warnings.join('; ')}`);
  }
  writeJson(rawRacePath(calendarRace.id, 'fines.json'), fineSummary);

  const normalized = normalizeRaceWeekend(calendarRace, fetchedRace, fineSummary);
  writeJson(normalizedRacePath(calendarRace.id), normalized);

  const scoreboard = rebuildScoreboard();
  return {
    race: calendarRace,
    fineSummary,
    scoreboard,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.race) {
    throw new Error('Usage: npm run score:race -- --race <raceId>');
  }

  const result = await scoreRace(args.race);
  console.log(`Scored ${result.race.name}.`);
  console.log(`Applied ${result.fineSummary.documents.length} FIA fine document(s).`);
  console.log(`Standings rebuilt for ${result.scoreboard.standings.length} teams.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
