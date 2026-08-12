// Martin's workbook is the definitive record for this competition, but it lives
// outside the repository (`martins-calculations/` is gitignored), so CI can never
// read it. The ledger is the bridge: a committed, derived record of what his
// sheets say, which CI can check our scored artifacts against without the source.
//
// It answers two questions, not one:
//   1. do our numbers still match Martin's?          -> compareToLedger
//   2. are we still reading the Martin we think?     -> detectSourceRegression
//
// Question 2 exists because a reissued workbook can be *older* than the master it
// appears to supersede — the 10 August Monaco file was byte-identical to the
// 2 August one and predated Martin's own corrections (#79). Filename and email
// date both hide that; the internal modified timestamp does not.

// Divergences we knowingly carry, keyed tightly enough that the entry excuses one
// specific disagreement and nothing else. A manifest entry that merely named a
// driver would swallow a later, different bug on the same driver.
function divergenceKey(entry) {
  return [entry.race, entry.kind, entry.id, entry.ours, entry.martin].join('|');
}

function flattenRace(raceId, race) {
  const rows = [];
  for (const [id, points] of Object.entries(race?.drivers || {})) {
    rows.push({ race: raceId, kind: 'driver', id, points });
  }
  for (const [id, points] of Object.entries(race?.teams || {})) {
    rows.push({ race: raceId, kind: 'team', id, points });
  }
  return rows;
}

// Compare our scored artifacts against the ledger, netting off the accepted
// divergences. Returns:
//   unexplained  — disagreements not covered by the manifest: the failure signal
//   resolved     — manifest entries that now agree, so the manifest can shrink
//   missingRaces — races the ledger covers that we have not scored
//
// `resolved` matters as much as `unexplained`: a stale manifest entry is a hole
// in the gate, because it goes on excusing a driver-race after the real gap has
// been fixed.
export function compareToLedger(scoredByRace, ledger, acceptedDivergences) {
  const accepted = new Map(
    (acceptedDivergences?.divergences || []).map((entry) => [divergenceKey(entry), entry]),
  );
  const matchedAccepted = new Set();
  const unexplained = [];
  const missingRaces = [];

  for (const [raceId, expected] of Object.entries(ledger?.races || {})) {
    const ours = scoredByRace[raceId];
    if (!ours) {
      missingRaces.push(raceId);
      continue;
    }
    for (const row of flattenRace(raceId, expected)) {
      const ourPoints = (row.kind === 'driver' ? ours.drivers : ours.teams)?.[row.id];
      // A driver nobody selected is absent from the scored artifacts. That is not
      // a disagreement — there is nothing to disagree with.
      if (ourPoints === undefined) continue;
      if (ourPoints === row.points) continue;
      const key = divergenceKey({ race: row.race, kind: row.kind, id: row.id, ours: ourPoints, martin: row.points });
      if (accepted.has(key)) {
        matchedAccepted.add(key);
        continue;
      }
      unexplained.push({ race: row.race, kind: row.kind, id: row.id, ours: ourPoints, martin: row.points });
    }
  }

  const resolved = [...accepted.values()].filter((entry) => !matchedAccepted.has(divergenceKey(entry)));
  return { unexplained, resolved, missingRaces };
}

// Guard against regenerating the ledger from a workbook older than the one it
// already cites for that race. Same-or-newer is fine; older means someone has
// pointed the generator at a stale reissue.
export function detectSourceRegression(previousProvenance, nextProvenance) {
  const previous = previousProvenance?.races || {};
  const next = nextProvenance?.races || {};
  const regressions = [];
  for (const [raceId, source] of Object.entries(next)) {
    const before = previous[raceId];
    if (!before?.workbookModified || !source?.workbookModified) continue;
    if (new Date(source.workbookModified) >= new Date(before.workbookModified)) continue;
    regressions.push({
      race: raceId,
      previous: before,
      next: source,
      message: `${raceId}: ${source.workbook} (modified ${source.workbookModified}) is older than the recorded ${before.workbook} (modified ${before.workbookModified})`,
    });
  }
  return regressions;
}

// The comparable body of the ledger: scores only, key-sorted, with provenance and
// timestamps excluded. Regenerating from the same workbook must produce a
// byte-identical body, or every rebuild diffs and the signal is lost.
export function ledgerBody(ledger) {
  const races = {};
  for (const raceId of Object.keys(ledger?.races || {}).sort()) {
    const race = ledger.races[raceId];
    races[raceId] = {
      drivers: sortedEntries(race?.drivers),
      teams: sortedEntries(race?.teams),
    };
  }
  return JSON.stringify({ races }, null, 2);
}

function sortedEntries(record) {
  return Object.fromEntries(Object.entries(record || {}).sort(([left], [right]) => left.localeCompare(right)));
}
