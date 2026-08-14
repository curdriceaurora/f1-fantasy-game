#!/usr/bin/env node

import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { discoverPotentialPenaltyPdfs } from '../lib/fia-documents.js';
import {
  configPath,
  ensureSeasonDirs,
  loadCalendar,
  normalizedRacePath,
  readJson,
  scoredRacePath,
  writeJson,
} from '../lib/season-store.js';
const SNAPSHOT_FILE = 'fia-document-snapshots.json';

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

export function newlyPublishedDocuments(previous, current) {
  const seen = new Set(previous || []);
  return sortedUnique(current || []).filter((url) => !seen.has(url));
}

export function finalizedRaces(calendar) {
  return calendar.filter(
    (race) => existsSync(normalizedRacePath(race.id)) && existsSync(scoredRacePath(race.id)),
  );
}

export function recordFiaDocumentBaseline(race, documents, recordedAt = new Date()) {
  const snapshotPath = configPath(SNAPSHOT_FILE);
  const snapshots = readJson(snapshotPath, {});
  if (snapshots[race.id]) return false;

  snapshots[race.id] = {
    documents: sortedUnique(documents),
    recordedAt: recordedAt.toISOString(),
  };
  writeJson(snapshotPath, snapshots);
  return true;
}

export function buildLateDocumentReport(alerts, failures = []) {
  const lines = alerts.length
    ? [
      '## Late FIA result documents detected',
      '',
      'These documents appeared after the stored post-publication snapshot. Review them manually; no race was rescored.',
      '',
    ]
    : ['## No late FIA result documents detected', ''];

  for (const alert of alerts) {
    lines.push(`### ${alert.race.name} (Round ${alert.race.round})`, '');
    for (const url of alert.documents) {
      lines.push(`- [${decodeURIComponent(url.split('/').pop()).replace(/[_-]+/g, ' ')}](${url})`);
    }
    lines.push('');
  }

  if (failures.length) {
    lines.push('## Scan failures', '');
    for (const failure of failures) {
      lines.push(`- **${failure.raceName}:** ${failure.reason}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export async function checkLateFiaDocuments(services = {}) {
  ensureSeasonDirs();
  const now = services.now || new Date();
  const discoverDocuments = services.discoverPotentialPenaltyPdfs || discoverPotentialPenaltyPdfs;
  const snapshotPath = configPath(SNAPSHOT_FILE);
  const snapshots = readJson(snapshotPath, {});
  const alerts = [];
  const initialized = [];
  const unchanged = [];
  const failures = [];
  let changed = false;

  for (const race of finalizedRaces(loadCalendar())) {
    try {
      const currentDocuments = sortedUnique(await discoverDocuments(race));
      const previous = snapshots[race.id];

      if (!previous) {
        snapshots[race.id] = { documents: currentDocuments, recordedAt: now.toISOString() };
        initialized.push(race.id);
        changed = true;
        console.log(`Recorded FIA document baseline for ${race.name} (${currentDocuments.length} document(s)).`);
        continue;
      }

      const added = newlyPublishedDocuments(previous.documents, currentDocuments);
      if (!added.length) {
        unchanged.push(race.id);
        continue;
      }

      snapshots[race.id] = {
        ...previous,
        documents: sortedUnique([...(previous.documents || []), ...currentDocuments]),
        updatedAt: now.toISOString(),
      };
      alerts.push({ race, documents: added });
      changed = true;
      console.log(`Late FIA document(s) detected for ${race.name}:`);
      added.forEach((url) => console.log(`  ${url}`));
    } catch (error) {
      failures.push({ raceId: race.id, raceName: race.name, reason: error.message });
      console.error(`Unable to scan ${race.name}: ${error.message}`);
    }
  }

  if (changed) writeJson(snapshotPath, snapshots);
  return { alerts, initialized, unchanged, failures, snapshotChanged: changed };
}

export function publishGitHubOutputs(result) {
  const report = buildLateDocumentReport(result.alerts, result.failures);
  const reportPath = join(process.env.RUNNER_TEMP || tmpdir(), 'late-fia-documents.md');

  writeFileSync(reportPath, report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `detected=${result.alerts.length > 0}`,
      `failed=${result.failures.length > 0}`,
      `report_path=${reportPath}`,
      '',
    ].join('\n'));
  }
}

export async function runCheckLateFiaDocumentsCli(services = {}) {
  const result = await checkLateFiaDocuments(services);
  publishGitHubOutputs(result);
  console.log(`Late-document alerts: ${result.alerts.length}; scan failures: ${result.failures.length}.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCheckLateFiaDocumentsCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
