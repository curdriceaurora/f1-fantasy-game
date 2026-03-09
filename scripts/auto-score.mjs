#!/usr/bin/env node

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { discoverMonetaryFinePdfs } from '../lib/fia-documents.js';
import { mondayPublicationDate } from '../lib/race-workflow.js';
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

function findMostRecentEligibleRace(calendar, now) {
  return calendar
    .filter((race) => now >= mondayPublicationDate(race.date))
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

async function autoScore() {
  ensureSeasonDirs();
  const now = new Date();
  const calendar = loadCalendar();

  const race = findMostRecentEligibleRace(calendar, now);
  if (!race) {
    console.log('No races eligible for scoring yet.');
    return;
  }

  console.log(`Checking ${race.name} (Round ${race.round})...`);

  const fineUrls = await discoverMonetaryFinePdfs(race);
  console.log(`Discovered ${fineUrls.length} FIA monetary fine document(s).`);

  const storedReview = loadFineReview(race.id);
  const storedSorted = [...storedReview.documents].sort().join(',');
  const discoveredSorted = [...fineUrls].sort().join(',');

  const docsChanged = storedSorted !== discoveredSorted;
  const isFinalized = existsSync(normalizedRacePath(race.id)) && existsSync(scoredRacePath(race.id));

  if (!docsChanged && isFinalized) {
    console.log(`${race.name} is already finalized with up-to-date fine documents. Nothing to do.`);
    return;
  }

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

  const result = await scoreRace(race.id);
  console.log(`Scored ${result.race.name}.`);
  console.log(`Applied ${result.fineSummary.documents.length} FIA fine document(s).`);
  console.log(`Standings rebuilt for ${result.scoreboard.standings.length} teams.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  autoScore().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
