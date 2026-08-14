#!/usr/bin/env node

import { appendFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolveDriver, resolveDriverByCarNumber } from '../lib/canonical.js';
import { inferUnservedTimePenalties } from '../lib/openf1.js';
import {
  loadCalendar,
  rawRacePath,
  readJson,
  scoredRacePath,
} from '../lib/season-store.js';

function driverName(driverId, driverNumber) {
  return resolveDriverByCarNumber(driverNumber)?.fullName
    || resolveDriver(driverId)?.fullName
    || driverId
    || `Car ${driverNumber}`;
}

export function compareTimePenaltyLedgers(race, fetchedRace) {
  const messages = fetchedRace.raceTimePenaltyMessages || [];
  const inferred = inferUnservedTimePenalties(messages);
  const fiaLedger = fetchedRace.fiaResults?.penaltySeconds || {};
  const openf1Ledger = {};

  for (const [driverNumber, seconds] of inferred.totals) {
    const driver = resolveDriverByCarNumber(driverNumber);
    const driverId = driver?.id || `car-${driverNumber}`;
    openf1Ledger[driverId] = (openf1Ledger[driverId] || 0) + seconds;
  }

  const driverIds = new Set([...Object.keys(fiaLedger), ...Object.keys(openf1Ledger)]);
  const mismatches = [];
  for (const driverId of [...driverIds].sort()) {
    const fiaSeconds = fiaLedger[driverId] || 0;
    const openf1Seconds = openf1Ledger[driverId] || 0;
    if (fiaSeconds === openf1Seconds) continue;
    const event = inferred.events.find((entry) => resolveDriverByCarNumber(entry.driverNumber)?.id === driverId);
    mismatches.push({
      driverId,
      driverName: driverName(driverId, event?.driverNumber),
      fiaSeconds,
      openf1Seconds,
    });
  }

  return { race, mismatches, fiaLedger, openf1Ledger };
}

export function buildTimePenaltyAuditReport(results, failures = []) {
  const mismatched = results.filter((result) => result.mismatches.length);
  const lines = [
    '# Time-penalty source audit',
    '',
    'Read-only comparison: FIA final-classification footer (authoritative) vs. OpenF1 issued-minus-served inference. No scoring data was changed.',
    '',
    `Checked ${results.length} finalized race(s); ${mismatched.length} race(s) differ.`,
    '',
  ];

  for (const result of mismatched) {
    lines.push(`## ${result.race.name} (Round ${result.race.round})`, '');
    for (const mismatch of result.mismatches) {
      lines.push(`- **${mismatch.driverName}:** FIA footer ${mismatch.fiaSeconds}s; OpenF1 inference ${mismatch.openf1Seconds}s`);
    }
    lines.push('');
  }

  if (!mismatched.length) lines.push('No ledger mismatches found.', '');
  if (failures.length) {
    lines.push('## Audit failures', '');
    for (const failure of failures) lines.push(`- **${failure.raceName}:** ${failure.reason}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export function auditTimePenalties() {
  const results = [];
  const failures = [];
  for (const race of loadCalendar()) {
    const openf1Path = rawRacePath(race.id, 'openf1.json');
    if (!existsSync(scoredRacePath(race.id)) || !existsSync(openf1Path)) continue;
    try {
      const fetchedRace = readJson(openf1Path);
      if (!fetchedRace?.fiaResults?.penaltySeconds) {
        throw new Error('cached race data has no FIA penalty footer ledger');
      }
      results.push(compareTimePenaltyLedgers(race, fetchedRace));
    } catch (error) {
      failures.push({ raceId: race.id, raceName: race.name, reason: error.message });
    }
  }
  return { results, failures, report: buildTimePenaltyAuditReport(results, failures) };
}

export function runAuditTimePenaltiesCli(options = {}) {
  const stdout = options.stdout || process.stdout;
  const audit = (options.auditTimePenalties || auditTimePenalties)();
  stdout.write(audit.report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, audit.report);
  }
  if (audit.failures.length && options.setExitCode !== false) {
    process.exitCode = 1;
  }
  return audit;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAuditTimePenaltiesCli();
}

