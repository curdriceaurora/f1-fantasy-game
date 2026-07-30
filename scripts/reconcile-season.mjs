#!/usr/bin/env node

// Catch-up pass over the whole calendar. auto-score.mjs only ever looks at the
// most recent eligible race, so a race whose scheduled runs all failed stays
// unscored once the next race becomes eligible. This walks every eligible race
// in calendar order, re-runs FIA discovery for each, and rescores the ones that
// are unscored or whose fine ledger no longer matches what FIA has published.

import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { discoverMonetaryFinePdfs } from '../lib/fia-documents.js';
import { isRaceScoreable, mondayPublicationDate, raceStatus } from '../lib/race-workflow.js';
import {
  configPath,
  ensureSeasonDirs,
  loadCalendar,
  loadFineDocuments,
  normalizedRacePath,
  removeFile,
  scoredRacePath,
  writeJson,
} from '../lib/season-store.js';
import { scoreRace } from './score-race.mjs';

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    // Rescore even when the published document set is unchanged — needed after
    // a change to how fine documents are parsed or attributed.
    force: argv.includes('--force'),
  };
}

export function eligibleRaces(calendar, now) {
  return calendar
    .filter(isRaceScoreable)
    .filter((race) => now >= mondayPublicationDate(race.date))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

export function unraceableRaces(calendar) {
  return calendar.filter((race) => !isRaceScoreable(race));
}

export function isFinalized(raceId) {
  return existsSync(normalizedRacePath(raceId)) && existsSync(scoredRacePath(raceId));
}

export async function reconcileSeason(services = {}) {
  ensureSeasonDirs();
  const now = services.now || new Date();
  const discoverFinePdfs = services.discoverMonetaryFinePdfs || discoverMonetaryFinePdfs;
  const scoreRaceImpl = services.scoreRace || scoreRace;
  const dryRun = Boolean(services.dryRun);
  const force = Boolean(services.force);

  const eligible = eligibleRaces(loadCalendar(), now);
  if (!eligible.length) {
    console.log('No races are eligible for scoring yet. Nothing to reconcile.');
    return { scored: [], unchanged: [], failed: [] };
  }

  const pending = eligible.filter((race) => !isFinalized(race.id));
  console.log(`${eligible.length} eligible race(s); ${pending.length} not yet finalized: ${pending.map((race) => race.id).join(', ') || 'none'}`);

  const offCalendar = unraceableRaces(loadCalendar());
  for (const race of offCalendar) {
    console.log(`Not scoreable: ${race.id} is ${raceStatus(race)}${race.notes ? ` — ${race.notes}` : ''}`);
  }
  if (dryRun) {
    return { scored: [], unchanged: [], failed: [] };
  }

  const scored = [];
  const unchanged = [];
  const failed = [];

  for (const race of eligible) {
    console.log(`\n--- ${race.name} (Round ${race.round}) ---`);
    try {
      const fineUrls = await discoverFinePdfs(race);
      console.log(`Discovered ${fineUrls.length} FIA monetary fine document(s).`);

      const fineDocuments = loadFineDocuments();
      const storedDocuments = fineDocuments[race.id]?.documents || [];
      const documentsMatch = [...storedDocuments].sort().join(',') === [...fineUrls].sort().join(',');
      if (documentsMatch && isFinalized(race.id) && !force) {
        console.log('Already finalized against the published fine documents.');
        unchanged.push(race.id);
        continue;
      }

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
      console.log(`Scored ${result.race.name} with ${result.fineSummary.documents.length} FIA fine document(s).`);
      scored.push(race.id);
    } catch (error) {
      // One unscoreable race must not strand the rest of the catch-up.
      console.error(`Skipping ${race.id}: ${error.message}`);
      failed.push({ raceId: race.id, reason: error.message });
    }
  }

  console.log(`\nRescored ${scored.length} race(s): ${scored.join(', ') || 'none'}`);
  console.log(`Already up to date: ${unchanged.join(', ') || 'none'}`);
  if (failed.length) {
    console.log(`Still pending (${failed.length}):`);
    for (const failure of failed) {
      console.log(`  - ${failure.raceId}: ${failure.reason}`);
    }
  }
  return { scored, unchanged, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  reconcileSeason({ dryRun: args.dryRun, force: args.force })
    .then(({ failed }) => {
      if (failed.length) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
