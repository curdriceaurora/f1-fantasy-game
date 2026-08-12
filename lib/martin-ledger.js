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
  return [entry.race, entry.kind, entry.id, entry.field, entry.ours, entry.martin].join('|');
}

// One row per comparable field, not just the total. Two input errors that cancel
// out leave the total intact — #62's missing grid penalties were exactly that
// shape of problem — so the inputs are compared in their own right.
function flattenRace(raceId, race) {
  const rows = [];
  for (const kind of ['driver', 'team']) {
    const record = kind === 'driver' ? race?.drivers : race?.teams;
    for (const [id, fields] of Object.entries(record || {})) {
      for (const [field, value] of Object.entries(fields || {})) {
        rows.push({ race: raceId, kind, id, field, value });
      }
    }
  }
  return rows;
}

// Compare our scored artifacts against the ledger, netting off the accepted
// divergences. Returns:
//   unexplained     — disagreements not covered by the manifest: the failure signal
//   resolved        — manifest entries that now agree, so the manifest can shrink
//   missingRaces    — races the ledger covers that we have not scored
//   unledgeredRaces — races we score that the ledger does not cover
//
// The race sets are compared in both directions. Walking only the ledger would
// let the next completed round be scored and published against a ledger that
// predates it, with reconciliation green the whole time — the gate would be
// checking a shrinking share of the season without ever saying so.
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
      const mine = (row.kind === 'driver' ? ours.drivers : ours.teams)?.[row.id];
      // A row the ledger covers but we do not score at all is a coverage failure,
      // not something to skip: it means the gate has stopped checking a seat.
      if (mine === undefined) {
        unexplained.push({ race: row.race, kind: row.kind, id: row.id, field: row.field, ours: null, martin: row.value });
        continue;
      }
      const ourValue = mine[row.field] ?? null;
      if (ourValue === row.value) continue;
      const entry = { race: row.race, kind: row.kind, id: row.id, field: row.field, ours: ourValue, martin: row.value };
      const key = divergenceKey(entry);
      if (accepted.has(key)) {
        matchedAccepted.add(key);
        continue;
      }
      unexplained.push(entry);
    }
  }

  const resolved = [...accepted.values()].filter((entry) => !matchedAccepted.has(divergenceKey(entry)));
  const unledgeredRaces = Object.keys(scoredByRace).filter((raceId) => !ledger?.races?.[raceId]);
  return { unexplained, resolved, missingRaces, unledgeredRaces };
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

// Sorts nested field keys too, so a rebuild cannot diff on ordering alone.
function sortedEntries(record) {
  return Object.fromEntries(
    Object.entries(record || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        value && typeof value === 'object' && !Array.isArray(value) ? sortedEntries(value) : value,
      ]),
  );
}
