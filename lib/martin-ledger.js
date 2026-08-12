import { MARTIN_SHEET_BY_RACE } from './martin-workbook.js';

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
//   unmatched       — entities or fields we score that the ledger does not carry
//
// The invariant is symmetry, at every level: races, entities and fields must be
// the same set on both sides. Walking the ledger alone means anything present
// only on our side is never compared — a new round, a reserve driver, a new
// scoring input — and the gate quietly checks a shrinking share of what we
// publish while staying green. Enforcing symmetry rather than patching each
// level separately is what stops this recurring one nesting depth lower.
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
  return { unexplained, resolved, missingRaces, unledgeredRaces, unmatched: findUnmatched(scoredByRace, ledger) };
}

// The other direction: everything we score must have something in the ledger to
// be compared against. scoredByRace is the comparison projection, so anything
// appearing there is either checked or is a hole.
function findUnmatched(scoredByRace, ledger) {
  const unmatched = [];
  for (const [raceId, ours] of Object.entries(scoredByRace || {})) {
    const expected = ledger?.races?.[raceId];
    // A race missing entirely is already reported as unledgered; do not repeat it
    // once per entity.
    if (!expected) continue;
    for (const kind of ['driver', 'team']) {
      const mineByKind = kind === 'driver' ? ours.drivers : ours.teams;
      const theirsByKind = kind === 'driver' ? expected.drivers : expected.teams;
      for (const [id, fields] of Object.entries(mineByKind || {})) {
        if (!theirsByKind?.[id]) {
          unmatched.push({ race: raceId, kind, id, field: null });
          continue;
        }
        for (const field of Object.keys(fields || {})) {
          if (!(field in theirsByKind[id])) unmatched.push({ race: raceId, kind, id, field });
        }
      }
    }
  }
  return unmatched;
}

// Provenance is the other half of the artifact, and the half that answers "are we
// still reading the Martin we think we are". detectSourceRegression compares a
// candidate source against the entry recorded for that race, so a missing or
// malformed entry does not fail — it simply removes the protection, silently.
// Deleting Monaco's entry is enough to let an older Monaco workbook back in.
//
// Every race in the ledger must therefore have a complete, well-formed entry,
// and no entry may exist for a race the ledger does not carry.
const SHA256 = /^[0-9a-f]{64}$/;

export function validateProvenance(ledger, sheetForRace = MARTIN_SHEET_BY_RACE) {
  const provenance = ledger?.provenance?.races;
  if (!provenance || typeof provenance !== 'object') {
    return ['the ledger has no provenance — regenerate it; stale-source protection is inoperative without it'];
  }
  const problems = [];
  for (const raceId of Object.keys(ledger?.races || {})) {
    if (!provenance[raceId]) problems.push(`${raceId}: scored in the ledger but has no provenance entry`);
  }
  for (const [raceId, source] of Object.entries(provenance)) {
    if (!ledger?.races?.[raceId]) {
      problems.push(`${raceId}: has provenance but no race data in the ledger`);
      continue;
    }
    if (!source.workbook || typeof source.workbook !== 'string') {
      problems.push(`${raceId}: provenance is missing the source workbook name`);
    }
    if (!SHA256.test(String(source.sha256 || ''))) {
      problems.push(`${raceId}: provenance sha256 is missing or malformed`);
    }
    if (!source.workbookModified || Number.isNaN(new Date(source.workbookModified).getTime())) {
      problems.push(`${raceId}: provenance workbookModified is missing or unparseable — stale-source protection needs it`);
    }
    const expectedSheet = sheetForRace[raceId] ? `Race ${sheetForRace[raceId]}` : null;
    if (expectedSheet && source.sheet !== expectedSheet) {
      problems.push(`${raceId}: provenance names sheet "${source.sheet}", expected "${expectedSheet}"`);
    }
  }
  return problems;
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
