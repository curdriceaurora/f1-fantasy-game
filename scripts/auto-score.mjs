#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { discoverMonetaryFinePdfs, discoverPotentialPenaltyPdfs } from '../lib/fia-documents.js';
import { isRaceScoreable, mondayPublicationDate } from '../lib/race-workflow.js';
import {
  configPath,
  ensureSeasonDirs,
  loadCalendar,
  loadFineDocuments,
  loadFineReview,
  normalizedRacePath,
  removeFile,
  scoredRacePath,
  writeJson,
} from '../lib/season-store.js';
import { scoreRace } from './score-race.mjs';
import { recordFiaDocumentBaseline } from './check-late-fia-documents.mjs';

function findMostRecentEligibleRace(calendar, now) {
  return calendar
    .filter(isRaceScoreable)
    .filter((race) => now >= mondayPublicationDate(race.date))
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

export async function autoScore(services = {}) {
  ensureSeasonDirs();
  const now = services.now || new Date();
  const discoverFinePdfs = services.discoverMonetaryFinePdfs || discoverMonetaryFinePdfs;
  const discoverPenaltyPdfs = services.discoverPotentialPenaltyPdfs || discoverPotentialPenaltyPdfs;
  const scoreRaceImpl = services.scoreRace || scoreRace;
  const calendar = loadCalendar();

  const race = findMostRecentEligibleRace(calendar, now);
  if (!race) {
    console.log('No races eligible for scoring yet.');
    return;
  }

  console.log(`Checking ${race.name} (Round ${race.round})...`);

  const isFinalized = existsSync(normalizedRacePath(race.id)) && existsSync(scoredRacePath(race.id));

  let fineUrls;
  try {
    fineUrls = await discoverFinePdfs(race);
  } catch (error) {
    // A stored review is only trustworthy when FIA actually answered, so never
    // fall through and record "no fines found" off the back of a failed fetch.
    if (isFinalized) {
      console.log(`FIA document discovery failed: ${error.message}`);
      console.log(`${race.name} is already finalized; keeping the stored fine review and retrying on the next run.`);
      return;
    }
    throw new Error(`FIA document discovery failed for ${race.name}: ${error.message}`);
  }
  console.log(`Discovered ${fineUrls.length} FIA monetary fine document(s).`);

  const storedReview = loadFineReview(race.id);
  const storedSorted = [...storedReview.documents].sort().join(',');
  const discoveredSorted = [...fineUrls].sort().join(',');

  const docsChanged = storedSorted !== discoveredSorted;

  if (!docsChanged && isFinalized) {
    console.log(`${race.name} is already finalized with up-to-date fine documents. Nothing to do.`);
    return;
  }

  // Capture the exact FIA document set at first publication. The daily monitor
  // can then distinguish a genuinely late document from the original set.
  const publicationDocuments = isFinalized ? null : await discoverPenaltyPdfs(race);

  const fineDocuments = loadFineDocuments();
  fineDocuments[race.id] = {
    reviewed: true,
    documents: fineUrls,
    notes: fineUrls.length
      ? `Auto-discovered ${fineUrls.length} FIA monetary fine document(s).`
      : 'Auto-reviewed: no FIA monetary fines found for this race.',
    reviewedAt: now.toISOString(),
  };
  writeJson(configPath('fine-documents.json'), fineDocuments);

  removeFile(normalizedRacePath(race.id));

  const result = await scoreRaceImpl(race.id);
  if (!isFinalized) recordFiaDocumentBaseline(race, publicationDocuments, now);
  console.log(`Scored ${result.race.name}.`);
  console.log(`Applied ${result.fineSummary.documents.length} FIA fine document(s).`);
  console.log(`Standings rebuilt for ${result.scoreboard.standings.length} teams.`);
}

export async function runAutoScoreCli(services = {}) {
  await autoScore(services);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAutoScoreCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

